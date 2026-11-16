// Stripe avvisa qui quando un cliente ha pagato. Solo allora l'ordine passa al barista.
// Va collegato in Stripe come webhook per gli "account collegati" (Connect).

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Controlla che il messaggio arrivi davvero da Stripe (firma HMAC-SHA256 con il segreto del webhook)
export async function verifyStripeSignature(
  rawBody: string, header: string | null, secret: string,
  toleranceSec = 300, nowSec = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!header || !secret) return false;
  const parts = header.split(',').map((p) => p.trim().split('='));
  const t = parts.find((p) => p[0] === 't')?.[1];
  const sigs = parts.filter((p) => p[0] === 'v1').map((p) => p[1]);
  if (!t || sigs.length === 0) return false;
  if (!Number.isFinite(Number(t)) || Math.abs(nowSec - Number(t)) > toleranceSec) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${rawBody}`));
  const expected = hex(new Uint8Array(mac));
  return sigs.some((s) => timingSafeEqual(s, expected));
}

type Env = Record<string, string | undefined>;

export async function handle(req: Request, env: Env, fetchFn: typeof fetch = fetch, nowSec?: number): Promise<Response> {
  if (req.method !== 'POST') return new Response('Metodo non consentito', { status: 405 });
  const SB = env.SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY, SECRET = env.STRIPE_WEBHOOK_SECRET;
  if (!SB || !KEY || !SECRET) return new Response('Non configurato', { status: 500 });

  const raw = await req.text();
  const ok = await verifyStripeSignature(raw, req.headers.get('stripe-signature'), SECRET, 300, nowSec);
  if (!ok) return new Response('Firma non valida', { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let event: any;
  try { event = JSON.parse(raw); } catch { return new Response('JSON non valido', { status: 400 }); }

  const sb = (path: string, init: RequestInit = {}) =>
    fetchFn(`${SB}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });

  const type: string = event?.type ?? '';
  const session = event?.data?.object;
  const orderId: string | undefined = session?.metadata?.order_id ?? session?.client_reference_id;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!orderId || !uuid.test(orderId)) return new Response('ok (nessun ordine)', { status: 200 });

  if (type === 'checkout.session.completed' || type === 'checkout.session.async_payment_succeeded') {
    if (session.payment_status !== 'paid') return new Response('ok (non ancora pagato)', { status: 200 });

    const orders = await (await sb(`orders?id=eq.${orderId}&select=id,club_id,subtotal_cents,fee_cents,status`)).json();
    const order = orders?.[0];
    if (!order) return new Response('ok (ordine sconosciuto)', { status: 200 });
    if (order.status !== 'pending_payment') return new Response('ok (già gestito)', { status: 200 });

    // controlli di sicurezza: importo e conto del locale devono combaciare
    const clubs = await (await sb(`clubs?id=eq.${order.club_id}&select=stripe_account_id`)).json();
    const accountOk = clubs?.[0]?.stripe_account_id && clubs[0].stripe_account_id === event.account;
    const amountOk = session.amount_total === order.subtotal_cents + order.fee_cents && session.currency === 'eur';
    if (!accountOk || !amountOk) {
      console.error('Pagamento non coerente con l\'ordine', orderId, session.amount_total, event.account);
      return new Response('ok (non coerente)', { status: 200 });
    }

    const upd = await sb(`orders?id=eq.${orderId}&status=eq.pending_payment`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'new', paid_at: new Date().toISOString() }),
    });
    if (!upd.ok) return new Response('Errore di salvataggio', { status: 500 }); // Stripe riprova da solo
    return new Response('ok', { status: 200 });
  }

  if (type === 'checkout.session.expired') {
    await sb(`orders?id=eq.${orderId}&status=eq.pending_payment`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'canceled' }),
    });
  }
  return new Response('ok', { status: 200 });
}

// @ts-ignore: Deno esiste solo su Supabase
if (typeof Deno !== 'undefined') Deno.serve((req: Request) => handle(req, Deno.env.toObject()));
