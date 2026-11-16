// Crea l'ordine e la pagina di pagamento Stripe sul conto del LOCALE.
// Il prezzo viene sempre ricalcolato qui dal menu nel database: il telefono del cliente non decide mai l'importo.
// Il tuo costo per ordine (service_fee_cents) viene trattenuto come "application fee".

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// Trasforma un oggetto nel formato che Stripe vuole: a[b][0][c]=valore
export function flatten(value: unknown, prefix: string, out: [string, string][] = []): [string, string][] {
  if (value === null || value === undefined) return out;
  if (Array.isArray(value)) value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
  else if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) flatten(v, prefix ? `${prefix}[${k}]` : k, out);
  } else out.push([prefix, String(value)]);
  return out;
}
export const toForm = (obj: object) => new URLSearchParams(flatten(obj, '')).toString();

export type CartLine = { id: string; q: number };
export type MenuRow = { id: string; name: string; price_cents: number; available: boolean };

export function priceCart(cart: CartLine[], menu: MenuRow[]) {
  if (!Array.isArray(cart) || cart.length === 0) throw new Error('Il carrello è vuoto.');
  if (cart.length > 40) throw new Error('Troppi articoli.');
  const byId = new Map(menu.map((m) => [m.id, m]));
  const merged = new Map<string, number>();
  for (const l of cart) {
    const q = Math.floor(Number(l?.q));
    if (!l || typeof l.id !== 'string' || !(q >= 1 && q <= 30)) throw new Error('Articolo non valido.');
    merged.set(l.id, (merged.get(l.id) ?? 0) + q);
  }
  const items: { id: string; name: string; q: number; price_cents: number }[] = [];
  let subtotal = 0;
  for (const [id, q] of merged) {
    const m = byId.get(id);
    if (!m || !m.available) throw new Error('Un drink non è più disponibile.');
    if (q > 30) throw new Error('Quantità troppo alta.');
    items.push({ id, name: m.name, q, price_cents: m.price_cents });
    subtotal += q * m.price_cents;
  }
  if (subtotal > 200000) throw new Error('Importo troppo alto per un solo ordine.');
  return { items, subtotal_cents: subtotal };
}

type Env = Record<string, string | undefined>;

export async function handle(req: Request, env: Env, fetchFn: typeof fetch = fetch): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Metodo non consentito.' }, 405);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Richiesta non valida.' }, 400); }

  const clubId = String(body?.club ?? '');
  const table = String(body?.table ?? '').trim();
  const mode = body?.mode;
  if (!/^[a-z0-9-]{2,30}$/.test(clubId)) return json({ error: 'Locale non valido.' }, 400);
  if (mode !== 'tavolo' && mode !== 'bancone') return json({ error: 'Scegli se vuoi il drink al tavolo o al bancone.' }, 400);
  if (!/^[A-Za-z0-9 \-]{1,20}$/.test(table)) return json({ error: 'Numero del tavolo non valido.' }, 400);
  const note = String(body?.note ?? '').replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, 140);
  if (body?.age_ok !== true) return json({ error: 'Devi confermare di avere almeno 18 anni.' }, 400);

  const SB = env.SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;
  const STRIPE = env.STRIPE_SECRET_KEY, SITE = (env.SITE_URL ?? '').replace(/\/+$/, '');
  if (!SB || !KEY || !STRIPE || !SITE) return json({ error: 'Il servizio non è ancora configurato.' }, 500);

  const sb = (path: string, init: RequestInit = {}) =>
    fetchFn(`${SB}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });

  const clubRes = await sb(`clubs?id=eq.${clubId}&select=id,name,stripe_account_id,service_fee_cents,active`);
  const club = (await clubRes.json())?.[0];
  if (!club || !club.active) return json({ error: 'Locale non trovato.' }, 404);
  if (!club.stripe_account_id) return json({ error: 'Questo locale non può ancora ricevere pagamenti.' }, 409);

  // freno agli abusi: troppi ordini non pagati in pochi minuti = qualcuno sta spammando
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const recent = await (await sb(`orders?club_id=eq.${clubId}&status=eq.pending_payment&created_at=gte.${encodeURIComponent(since)}&select=id&limit=60`)).json();
  if (Array.isArray(recent) && recent.length >= 40) return json({ error: 'Troppe richieste in questo momento. Riprova tra qualche minuto.' }, 429);

  const menuRes = await sb(`menu_items?club_id=eq.${clubId}&select=id,name,price_cents,available`);
  const menu: MenuRow[] = await menuRes.json();

  let priced;
  try { priced = priceCart(body?.items, menu); } catch (e) { return json({ error: (e as Error).message }, 400); }

  const fee = Number(club.service_fee_cents) || 0;

  // 1) salva l'ordine come "in attesa di pagamento": il barista non lo vede finché non è pagato
  const insRes = await sb('orders', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      club_id: clubId, table_label: table, mode, note,
      items: priced.items, subtotal_cents: priced.subtotal_cents, fee_cents: fee,
    }),
  });
  const order = (await insRes.json())?.[0];
  if (!insRes.ok || !order) return json({ error: 'Non sono riuscito a salvare l’ordine. Riprova.' }, 500);

  // 2) crea la pagina di pagamento Stripe sul conto del locale (direct charge)
  const qs = `club=${encodeURIComponent(clubId)}&table=${encodeURIComponent(table)}`;
  const session: Record<string, unknown> = {
    mode: 'payment',
    locale: 'it',
    client_reference_id: order.id,
    expires_at: Math.floor(Date.now() / 1000) + 31 * 60, // l'ordine non pagato scade dopo 30 minuti (minimo di Stripe)
    success_url: `${SITE}/index.html?${qs}&order=${order.id}&t=${order.token}`,
    cancel_url: `${SITE}/index.html?${qs}&canceled=1`,
    metadata: { order_id: order.id, club_id: clubId },
    line_items: [
      ...priced.items.map((i) => ({
        quantity: i.q,
        price_data: { currency: 'eur', unit_amount: i.price_cents, product_data: { name: i.name } },
      })),
      ...(fee > 0
        ? [{ quantity: 1, price_data: { currency: 'eur', unit_amount: fee, product_data: { name: 'Costo del servizio' } } }]
        : []),
    ],
    payment_intent_data: {
      description: `Ordine #${order.number} - ${mode === 'tavolo' ? 'tavolo ' + table : 'bancone'}`,
      metadata: { order_id: order.id },
      ...(fee > 0 ? { application_fee_amount: fee } : {}),
    },
  };

  const stripeRes = await fetchFn('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRIPE}`,
      'Stripe-Account': club.stripe_account_id,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': order.id,
    },
    body: toForm(session),
  });
  const stripeJson = await stripeRes.json();
  if (!stripeRes.ok || !stripeJson?.url) {
    await sb(`orders?id=eq.${order.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'canceled' }) });
    console.error('Stripe error', JSON.stringify(stripeJson?.error ?? stripeJson));
    return json({ error: 'Il pagamento non è disponibile in questo momento. Riprova.' }, 502);
  }

  await sb(`orders?id=eq.${order.id}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ stripe_session_id: stripeJson.id }),
  });

  return json({ url: stripeJson.url, order_id: order.id, token: order.token });
}

// @ts-ignore: Deno esiste solo su Supabase
if (typeof Deno !== 'undefined') Deno.serve((req: Request) => handle(req, Deno.env.toObject()));
