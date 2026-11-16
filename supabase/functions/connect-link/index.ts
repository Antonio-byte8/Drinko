// Crea il link con cui un locale si collega a Stripe (documenti e IBAN) per ricevere i pagamenti.
// Lo usi tu dalla pagina admin.html, protetto dalla tua chiave admin.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

type Env = Record<string, string | undefined>;

export async function handle(req: Request, env: Env, fetchFn: typeof fetch = fetch): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Metodo non consentito.' }, 405);

  const SB = env.SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY, STRIPE = env.STRIPE_SECRET_KEY;
  const ADMIN = env.ADMIN_KEY, SITE = (env.SITE_URL ?? '').replace(/\/+$/, '');
  if (!SB || !KEY || !STRIPE || !ADMIN || !SITE) return json({ error: 'Il servizio non è ancora configurato.' }, 500);

  const given = req.headers.get('x-admin-key') ?? '';
  if (!timingSafeEqual(given, ADMIN)) return json({ error: 'Chiave admin errata.' }, 401);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Richiesta non valida.' }, 400); }
  const clubId = String(body?.club ?? '');
  if (!/^[a-z0-9-]{2,30}$/.test(clubId)) return json({ error: 'Locale non valido.' }, 400);

  const sb = (path: string, init: RequestInit = {}) =>
    fetchFn(`${SB}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
  const stripe = (path: string, params: Record<string, string>) =>
    fetchFn(`https://api.stripe.com/v1/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${STRIPE}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });

  const club = (await (await sb(`clubs?id=eq.${clubId}&select=id,name,stripe_account_id`)).json())?.[0];
  if (!club) return json({ error: 'Locale non trovato. Crealo prima nel database.' }, 404);

  let account: string | null = club.stripe_account_id;
  if (!account) {
    // account Stripe "Standard": il locale ha la sua dashboard e paga lui le commissioni di pagamento
    const acc = await (await stripe('accounts', { type: 'standard', country: 'IT', 'metadata[club_id]': clubId })).json();
    if (!acc?.id) { console.error('Stripe', JSON.stringify(acc?.error ?? acc)); return json({ error: 'Stripe non ha creato l’account. Controlla che Connect sia attivo.' }, 502); }
    account = acc.id as string;
    await sb(`clubs?id=eq.${clubId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ stripe_account_id: account }) });
  }

  const link = await (await stripe('account_links', {
    account: account!, type: 'account_onboarding',
    refresh_url: `${SITE}/admin.html?refresh=1`, return_url: `${SITE}/admin.html?done=1`,
  })).json();
  if (!link?.url) { console.error('Stripe', JSON.stringify(link?.error ?? link)); return json({ error: 'Non sono riuscito a creare il link.' }, 502); }

  return json({ url: link.url, account });
}

// @ts-ignore: Deno esiste solo su Supabase
if (typeof Deno !== 'undefined') Deno.serve((req: Request) => handle(req, Deno.env.toObject()));
