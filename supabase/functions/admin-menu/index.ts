// Crea un locale e carica il suo menu incollando un elenco di testo, senza toccare il database a mano.
// Lo usi tu dalla pagina admin.html, protetto dalla tua chiave admin.
// Una riga = un drink:  Categoria | Nome | Descrizione | Prezzo | (facoltativo) indirizzo https della foto

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

export type ParsedItem = {
  category: string; name: string; description: string; price_cents: number; image_url: string | null;
  glass: string; color: string; garnish: string; sort: number;
};

// "10", "10,5", "10.50", "€ 12" -> centesimi
export function parsePrice(raw: string): number | null {
  const t = raw.replace(/€|eur(o)?/gi, '').replace(/\s/g, '').replace(',', '.');
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(t)) return null;
  const cents = Math.round(parseFloat(t) * 100);
  return cents >= 50 && cents <= 500000 ? cents : null;
}

// disegno e colori di partenza, scelti dalle parole del menu (si cambiano poi o si sostituiscono con una foto)
export function guessArt(category: string, name: string): { glass: string; color: string; garnish: string } {
  const t = `${category} ${name}`.toLowerCase();
  if (/shot|shottin|chupito/.test(t)) return { glass: 'sh', color: '#f0d27a', garnish: '' };
  if (/bottigli|magnum|champagne|prosecco|vodka premium/.test(t) && /bottigli|magnum|tavolo|premium/.test(t)) return { glass: 'bot', color: '#dfe9ee', garnish: '#1f3b55' };
  if (/birra|beer|lager|ipa|pils/.test(t)) return /bottigli|33|bt\b/.test(t) ? { glass: 'bt', color: '#7a4b12', garnish: '#d9a441' } : { glass: 'pint', color: '#f2b53a', garnish: '' };
  if (/energy|red ?bull|lattin/.test(t)) return { glass: 'can', color: '#35d07f', garnish: '' };
  if (/acqua|water/.test(t)) return { glass: 'bt', color: '#8ecbff', garnish: '#ffffff' };
  if (/negroni|old fashioned|whisk|rum|cognac|amaro/.test(t)) return { glass: 'rk', color: '#b3202e', garnish: '' };
  if (/martini|cosmopolitan|margarita|daiquiri/.test(t)) return { glass: 'mt', color: '#f4e9a8', garnish: '#9bd66b' };
  if (/spritz|aperol|campari/.test(t)) return { glass: 'hb', color: '#ff9a3d', garnish: '#ff7a1a' };
  if (/cola|coca|pepsi/.test(t)) return { glass: 'hb', color: '#3a1f14', garnish: '' };
  return { glass: 'hb', color: '#e9f6f2', garnish: '#9bd66b' };
}

export function parseMenu(text: string): { items: ParsedItem[]; errors: string[] } {
  const items: ParsedItem[] = []; const errors: string[] = [];
  const lines = String(text ?? '').split(/\r?\n/);
  lines.forEach((line, idx) => {
    const l = line.trim();
    if (!l || l.startsWith('#')) return;
    const parts = l.split(/\s*[|;\t]\s*/);
    const n = idx + 1;
    if (parts.length < 4) { errors.push(`Riga ${n}: servono almeno Categoria | Nome | Descrizione | Prezzo`); return; }
    const [category, name, description, priceRaw, img] = parts;
    const price = parsePrice(priceRaw);
    if (!category || category.length > 30) { errors.push(`Riga ${n}: categoria mancante o troppo lunga`); return; }
    if (!name || name.length > 60) { errors.push(`Riga ${n}: nome mancante o troppo lungo`); return; }
    if ((description ?? '').length > 120) { errors.push(`Riga ${n}: descrizione troppo lunga (massimo 120 caratteri)`); return; }
    if (price === null) { errors.push(`Riga ${n}: prezzo non valido ("${priceRaw}"), scrivilo come 10 oppure 10,50`); return; }
    if (img && !/^https:\/\/\S+$/.test(img)) { errors.push(`Riga ${n}: l’indirizzo della foto deve iniziare con https://`); return; }
    items.push({ category, name, description: description ?? '', price_cents: price, image_url: img || null, ...guessArt(category, name), sort: 0 });
  });
  if (items.length === 0 && errors.length === 0) errors.push('Il menu è vuoto: scrivi almeno un drink.');
  if (items.length > 200) errors.push('Troppi drink: massimo 200.');
  items.forEach((it, i) => { it.sort = (i + 1) * 10; });
  return { items, errors };
}

type Env = Record<string, string | undefined>;

export async function handle(req: Request, env: Env, fetchFn: typeof fetch = fetch): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Metodo non consentito.' }, 405);

  const SB = env.SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY, ADMIN = env.ADMIN_KEY;
  if (!SB || !KEY || !ADMIN) return json({ error: 'Il servizio non è ancora configurato.' }, 500);
  if (!timingSafeEqual(req.headers.get('x-admin-key') ?? '', ADMIN)) return json({ error: 'Chiave admin errata.' }, 401);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Richiesta non valida.' }, 400); }

  const clubId = String(body?.club ?? '');
  if (!/^[a-z0-9-]{2,30}$/.test(clubId)) return json({ error: 'Il nome corto può avere solo lettere minuscole, numeri e trattini (da 2 a 30 caratteri).' }, 400);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (name.length > 60) return json({ error: 'Il nome del locale è troppo lungo.' }, 400);
  const fee = body?.fee_cents === undefined || body?.fee_cents === '' ? null : Number(body.fee_cents);
  if (fee !== null && !(Number.isInteger(fee) && fee >= 0 && fee <= 500)) return json({ error: 'Il costo del servizio deve essere tra 0 e 500 centesimi.' }, 400);

  const hasMenu = typeof body?.menu_text === 'string' && body.menu_text.trim() !== '';
  let parsed: ReturnType<typeof parseMenu> | null = null;
  if (hasMenu) {
    parsed = parseMenu(body.menu_text);
    if (parsed.errors.length) return json({ error: parsed.errors.slice(0, 8).join('\n') }, 400);   // niente viene scritto se c'e' un errore
  }

  const sb = (path: string, init: RequestInit = {}) =>
    fetchFn(`${SB}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });

  const existing = (await (await sb(`clubs?id=eq.${clubId}&select=id,name`)).json())?.[0];
  let created = false;
  if (!existing) {
    if (!name) return json({ error: 'Questo locale non esiste ancora: scrivi anche il nome da mostrare.' }, 400);
    const ins = await sb('clubs', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ id: clubId, name, ...(fee !== null ? { service_fee_cents: fee } : {}) }) });
    if (!ins.ok) return json({ error: 'Non sono riuscito a creare il locale.' }, 500);
    created = true;
  } else if (name || fee !== null) {
    const patch = { ...(name ? { name } : {}), ...(fee !== null ? { service_fee_cents: fee } : {}) };
    const up = await sb(`clubs?id=eq.${clubId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
    if (!up.ok) return json({ error: 'Non sono riuscito ad aggiornare il locale.' }, 500);
  }

  let count = 0;
  if (parsed) {
    const rows = parsed.items.map((it, i) => ({ id: `${clubId}-m${i + 1}`, club_id: clubId, available: true, ...it }));
    const up = await sb('menu_items', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows) });
    if (!up.ok) return json({ error: 'Non sono riuscito a salvare il menu.' }, 500);
    // i drink che non sono piu' nell'elenco spariscono (gli ordini vecchi conservano comunque nome e prezzo)
    const keep = rows.map((r) => r.id).join(',');
    await sb(`menu_items?club_id=eq.${clubId}&id=not.in.(${keep})`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    count = rows.length;
  }
  return json({ club: clubId, created, items: count });
}

// @ts-ignore: Deno esiste solo su Supabase
if (typeof Deno !== 'undefined') Deno.serve((req: Request) => handle(req, Deno.env.toObject()));
