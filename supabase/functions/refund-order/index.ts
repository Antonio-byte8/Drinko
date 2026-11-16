// Il barista annulla un ordine GIA' PAGATO e il cliente viene rimborsato per intero
// (drink + costo del servizio) dal conto Stripe del locale.
// Chi chiama deve essere del personale di quel locale: lo controlliamo qui, con il suo accesso.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

type Env = Record<string, string | undefined>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handle(req: Request, env: Env, fetchFn: typeof fetch = fetch): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Metodo non consentito.' }, 405);

  const SB = env.SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY, STRIPE = env.STRIPE_SECRET_KEY;
  if (!SB || !KEY || !STRIPE) return json({ error: 'Il servizio non è ancora configurato.' }, 500);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Richiesta non valida.' }, 400); }
  const orderId = String(body?.order_id ?? '');
  if (!UUID.test(orderId)) return json({ error: 'Ordine non valido.' }, 400);

  // 1) chi sei?
  const auth = req.headers.get('authorization') ?? '';
  if (!/^Bearer\s+\S+/.test(auth)) return json({ error: 'Accesso richiesto.' }, 401);
  const who = await fetchFn(`${SB}/auth/v1/user`, { headers: { apikey: KEY, Authorization: auth } });
  const user = who.ok ? await who.json() : null;
  if (!user?.id || !UUID.test(String(user.id))) return json({ error: 'Accesso non valido.' }, 401);

  const sb = (path: string, init: RequestInit = {}) =>
    fetchFn(`${SB}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });

  // 2) l'ordine esiste e tu sei del personale di quel locale?
  const order = (await (await sb(`orders?id=eq.${orderId}&select=id,club_id,status,stripe_session_id`)).json())?.[0];
  if (!order) return json({ error: 'Ordine non trovato.' }, 404);
  const staff = (await (await sb(`staff?user_id=eq.${user.id}&club_id=eq.${encodeURIComponent(order.club_id)}&select=user_id`)).json())?.[0];
  if (!staff) return json({ error: 'Non puoi annullare gli ordini di questo locale.' }, 403);
  if (!['new', 'prep', 'ready'].includes(order.status)) return json({ error: 'Questo ordine non si può più annullare.' }, 409);
  if (!order.stripe_session_id) return json({ error: 'Ordine senza pagamento.' }, 409);

  const club = (await (await sb(`clubs?id=eq.${encodeURIComponent(order.club_id)}&select=stripe_account_id`)).json())?.[0];
  if (!club?.stripe_account_id) return json({ error: 'Locale non collegato a Stripe.' }, 409);
  const stripeHeaders = { Authorization: `Bearer ${STRIPE}`, 'Stripe-Account': club.stripe_account_id };

  // 3) trova il pagamento e rimborsa tutto, compreso il costo del servizio
  const sess = await fetchFn(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(order.stripe_session_id)}`, { headers: stripeHeaders });
  const sessJson = await sess.json();
  const pi = typeof sessJson?.payment_intent === 'string' ? sessJson.payment_intent : sessJson?.payment_intent?.id;
  if (!sess.ok || !pi) return json({ error: 'Non trovo il pagamento di questo ordine.' }, 502);

  const refund = await fetchFn('https://api.stripe.com/v1/refunds', {
    method: 'POST',
    headers: { ...stripeHeaders, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': `refund-${order.id}` },
    body: new URLSearchParams({ payment_intent: pi, refund_application_fee: 'true' }).toString(),
  });
  const refundJson = await refund.json();
  if (!refund.ok && refundJson?.error?.code !== 'charge_already_refunded') {
    console.error('Refund error', JSON.stringify(refundJson?.error ?? refundJson));
    return json({ error: 'Il rimborso non è riuscito. Riprova o rimborsa dalla dashboard Stripe.' }, 502);
  }

  // 4) segna l'ordine come annullato (solo se e' ancora aperto)
  await sb(`orders?id=eq.${order.id}&status=in.(new,prep,ready)`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'canceled' }),
  });
  return json({ ok: true });
}

// @ts-ignore: Deno esiste solo su Supabase
if (typeof Deno !== 'undefined') Deno.serve((req: Request) => handle(req, Deno.env.toObject()));
