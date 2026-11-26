// Prove automatiche delle tre funzioni (senza Internet: Supabase e Stripe sono finti).
// Si lanciano con:  node --experimental-strip-types tests/functions.test.mjs
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import * as checkout from '../supabase/functions/create-checkout/index.ts';
import * as webhook from '../supabase/functions/stripe-webhook/index.ts';
import * as link from '../supabase/functions/connect-link/index.ts';
import * as adminMenu from '../supabase/functions/admin-menu/index.ts';
import * as refund from '../supabase/functions/refund-order/index.ts';
import * as acceptInvite from '../supabase/functions/accept-invite/index.ts';

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('ok   ' + name); }
  catch (e) { console.error('FAIL ' + name + '\n' + (e.stack || e)); process.exitCode = 1; }
}

const ENV = {
  SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'srv',
  STRIPE_SECRET_KEY: 'sk_test_123', STRIPE_WEBHOOK_SECRET: 'whsec_test', SITE_URL: 'https://bancone.example/', ADMIN_KEY: 'chiave-admin',
};
const MENU = [
  { id: 'a1', name: 'Gin Tonic', price_cents: 1000, available: true },
  { id: 'a2', name: 'Shot tequila', price_cents: 400, available: true },
  { id: 'a3', name: 'Finito', price_cents: 500, available: false },
];
const ok = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
const post = (url, body, headers = {}) =>
  new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

// ---------- create-checkout ----------
await test('toForm annida come vuole Stripe', () => {
  const s = new URLSearchParams(checkout.toForm({ line_items: [{ quantity: 2, price_data: { currency: 'eur', unit_amount: 1000 } }], payment_intent_data: { application_fee_amount: 49 } }));
  assert.equal(s.get('line_items[0][quantity]'), '2');
  assert.equal(s.get('line_items[0][price_data][unit_amount]'), '1000');
  assert.equal(s.get('payment_intent_data[application_fee_amount]'), '49');
});

await test('priceCart somma, unisce i doppioni e usa i prezzi del menu', () => {
  const r = checkout.priceCart([{ id: 'a1', q: 2 }, { id: 'a2', q: 3 }, { id: 'a1', q: 1 }], MENU);
  assert.equal(r.subtotal_cents, 3 * 1000 + 3 * 400);
  assert.equal(r.items.length, 2);
});
await test('priceCart rifiuta carrello vuoto, quantità 0, drink finito e id sconosciuto', () => {
  assert.throws(() => checkout.priceCart([], MENU));
  assert.throws(() => checkout.priceCart([{ id: 'a1', q: 0 }], MENU));
  assert.throws(() => checkout.priceCart([{ id: 'a3', q: 1 }], MENU));
  assert.throws(() => checkout.priceCart([{ id: 'zzz', q: 1 }], MENU));
  assert.throws(() => checkout.priceCart([{ id: 'a1', q: 31 }], MENU));
});

function makeCheckoutFetch({ stripeAccount = 'acct_club1', stripeOk = true, pending = 0 } = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const u = String(url);
    if (u.includes('/rest/v1/clubs?')) return ok([{ id: 'aurora', name: 'Aurora', stripe_account_id: stripeAccount, service_fee_cents: 49, active: true }]);
    if (u.includes('/rest/v1/menu_items?')) return ok(MENU);
    if (u.includes('/rest/v1/orders?club_id=eq.')) return ok(Array.from({ length: pending }, (_, i) => ({ id: 'p' + i })));
    if (u.endsWith('/rest/v1/orders') && init.method === 'POST') {
      const b = JSON.parse(init.body);
      return ok([{ id: '11111111-1111-4111-8111-111111111111', token: '22222222-2222-4222-8222-222222222222', number: 321, ...b }]);
    }
    if (u.includes('/rest/v1/orders?id=eq.')) return new Response(null, { status: 204 });
    if (u === 'https://api.stripe.com/v1/checkout/sessions') {
      return stripeOk ? ok({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }) : new Response(JSON.stringify({ error: { message: 'boom' } }), { status: 400 });
    }
    throw new Error('chiamata inattesa ' + u);
  };
  return { f, calls };
}

await test('create-checkout: ordine e pagamento sul conto del locale con 0,49 € di commissione', async () => {
  const { f, calls } = makeCheckoutFetch();
  const res = await checkout.handle(post('https://f/create-checkout', { club: 'aurora', table: '12', mode: 'tavolo', age_ok: true, items: [{ id: 'a1', q: 2 }, { id: 'a2', q: 1 }], prezzo: 1 }), ENV, f);
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.url, 'https://checkout.stripe.com/c/pay/cs_test_1');
  assert.equal(out.order_id, '11111111-1111-4111-8111-111111111111');

  const ins = calls.find((c) => c.url.endsWith('/rest/v1/orders') && c.init.method === 'POST');
  const order = JSON.parse(ins.init.body);
  assert.equal(order.subtotal_cents, 2400);
  assert.equal(order.fee_cents, 49);

  const st = calls.find((c) => c.url === 'https://api.stripe.com/v1/checkout/sessions');
  assert.equal(st.init.headers['Stripe-Account'], 'acct_club1');
  assert.equal(st.init.headers.Authorization, 'Bearer sk_test_123');
  const f2 = new URLSearchParams(st.init.body);
  assert.equal(f2.get('payment_intent_data[application_fee_amount]'), '49');
  assert.equal(f2.get('line_items[0][price_data][unit_amount]'), '1000');
  assert.equal(f2.get('line_items[0][quantity]'), '2');
  assert.equal(f2.get('line_items[2][price_data][unit_amount]'), '49');
  assert.equal(f2.get('metadata[order_id]'), '11111111-1111-4111-8111-111111111111');
  assert.ok(f2.get('success_url').startsWith('https://bancone.example/index.html?club=aurora&table=12&order='));
  // importo totale delle righe = subtotale + commissione
  let tot = 0; for (let i = 0; f2.get(`line_items[${i}][quantity]`); i++) tot += Number(f2.get(`line_items[${i}][quantity]`)) * Number(f2.get(`line_items[${i}][price_data][unit_amount]`));
  assert.equal(tot, 2400 + 49);
});

await test('create-checkout: locale senza Stripe collegato = 409', async () => {
  const { f } = makeCheckoutFetch({ stripeAccount: null });
  const res = await checkout.handle(post('https://f', { club: 'aurora', table: '1', mode: 'tavolo', age_ok: true, items: [{ id: 'a1', q: 1 }] }), ENV, f);
  assert.equal(res.status, 409);
});
await test('create-checkout: dati sbagliati = 400', async () => {
  const { f } = makeCheckoutFetch();
  for (const b of [
    { club: 'Aurora!', table: '1', mode: 'tavolo', age_ok: true, items: [{ id: 'a1', q: 1 }] },
    { club: 'aurora', table: '1', mode: 'altro', items: [{ id: 'a1', q: 1 }] },
    { club: 'aurora', table: '<script>', mode: 'tavolo', age_ok: true, items: [{ id: 'a1', q: 1 }] },
    { club: 'aurora', table: '1', mode: 'tavolo', age_ok: true, items: [{ id: 'a3', q: 1 }] },
  ]) assert.equal((await checkout.handle(post('https://f', b), ENV, f)).status, 400);
});
await test('create-checkout: senza conferma dei 18 anni = 400, e la sessione Stripe scade', async () => {
  const { f, calls } = makeCheckoutFetch();
  const no = await checkout.handle(post('https://f', { club: 'aurora', table: '1', mode: 'tavolo', items: [{ id: 'a1', q: 1 }] }), ENV, f);
  assert.equal(no.status, 400);
  assert.equal(calls.length, 0, 'nessuna chiamata a database o Stripe senza conferma');
  const ok = makeCheckoutFetch();
  await checkout.handle(post('https://f', { club: 'aurora', table: '1', mode: 'tavolo', age_ok: true, items: [{ id: 'a1', q: 1 }] }), ENV, ok.f);
  const st = ok.calls.find((c) => String(c.url).includes('api.stripe.com'));
  const exp = Number(new URLSearchParams(st.init.body).get('expires_at'));
  assert.ok(exp > Date.now() / 1000 + 30 * 60 && exp < Date.now() / 1000 + 40 * 60, 'scade tra circa 30 minuti');
});
await test('create-checkout: troppi ordini non pagati in pochi minuti = 429, nessun ordine creato', async () => {
  const { f, calls } = makeCheckoutFetch({ pending: 40 });
  const res = await checkout.handle(post('https://f', { club: 'aurora', table: '1', mode: 'tavolo', age_ok: true, items: [{ id: 'a1', q: 1 }] }), ENV, f);
  assert.equal(res.status, 429);
  assert.equal(calls.some((c) => c.init.method === 'POST'), false);
});
await test('create-checkout: la nota del cliente viene pulita e accorciata a 140 caratteri', async () => {
  const { f, calls } = makeCheckoutFetch();
  await checkout.handle(post('https://f', { club: 'aurora', table: '1', mode: 'tavolo', age_ok: true, note: '  senza\nghiaccio ' + 'x'.repeat(300), items: [{ id: 'a1', q: 1 }] }), ENV, f);
  const ins = calls.find((c) => c.url.endsWith('/rest/v1/orders') && c.init.method === 'POST');
  const note = JSON.parse(ins.init.body).note;
  assert.ok(note.length <= 140); assert.ok(note.startsWith('senza ghiaccio')); assert.ok(!/[\n]/.test(note));
});
await test('create-checkout: se Stripe rifiuta, l’ordine viene annullato', async () => {
  const { f, calls } = makeCheckoutFetch({ stripeOk: false });
  const res = await checkout.handle(post('https://f', { club: 'aurora', table: '1', mode: 'bancone', age_ok: true, items: [{ id: 'a1', q: 1 }] }), ENV, f);
  assert.equal(res.status, 502);
  const patch = calls.find((c) => c.init.method === 'PATCH');
  assert.equal(JSON.parse(patch.init.body).status, 'canceled');
});

// ---------- refund-order ----------
const OID = '11111111-1111-4111-8111-111111111111', UID = '33333333-3333-4333-8333-333333333333';
function makeRefundFetch({ userOk = true, isStaff = true, status = 'new', refundCode = null } = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    const u = String(url); calls.push({ url: u, init });
    if (u.endsWith('/auth/v1/user')) return userOk ? ok({ id: UID }) : new Response('{}', { status: 401 });
    if (u.includes('/rest/v1/orders?id=eq.') && (init.method ?? 'GET') === 'GET') return ok([{ id: OID, club_id: 'aurora', status, stripe_session_id: 'cs_test_1' }]);
    if (u.includes('/rest/v1/staff?')) return ok(isStaff ? [{ user_id: UID }] : []);
    if (u.includes('/rest/v1/clubs?')) return ok([{ stripe_account_id: 'acct_club1' }]);
    if (u.startsWith('https://api.stripe.com/v1/checkout/sessions/')) return ok({ id: 'cs_test_1', payment_intent: 'pi_123' });
    if (u === 'https://api.stripe.com/v1/refunds') return refundCode ? new Response(JSON.stringify({ error: { code: refundCode } }), { status: 400 }) : ok({ id: 're_1' });
    if (u.includes('/rest/v1/orders?id=eq.') && init.method === 'PATCH') return new Response(null, { status: 204 });
    throw new Error('chiamata inattesa ' + u);
  };
  return { f, calls };
}
const rpost = (body, auth = 'Bearer staff-jwt') => post('https://f/refund-order', body, auth ? { Authorization: auth } : {});

await test('refund-order: il personale annulla un ordine pagato e rimborsa tutto, anche il costo del servizio', async () => {
  const { f, calls } = makeRefundFetch();
  const res = await refund.handle(rpost({ order_id: OID }), ENV, f);
  assert.equal(res.status, 200);
  const r = calls.find((c) => c.url === 'https://api.stripe.com/v1/refunds');
  const form = new URLSearchParams(r.init.body);
  assert.equal(form.get('payment_intent'), 'pi_123'); assert.equal(form.get('refund_application_fee'), 'true');
  assert.equal(r.init.headers['Stripe-Account'], 'acct_club1');
  const patch = calls.find((c) => c.init.method === 'PATCH');
  assert.equal(JSON.parse(patch.init.body).status, 'canceled');
  assert.match(patch.url, /status=in\.\(new,prep,ready\)/);
});
await test('refund-order: senza accesso, non del personale o ordine già chiuso = nessun rimborso', async () => {
  for (const [opts, auth, code] of [[{}, null, 401], [{ userOk: false }, 'Bearer x', 401], [{ isStaff: false }, 'Bearer x', 403], [{ status: 'done' }, 'Bearer x', 409], [{ status: 'canceled' }, 'Bearer x', 409]]) {
    const { f, calls } = makeRefundFetch(opts);
    const res = await refund.handle(rpost({ order_id: OID }, auth), ENV, f);
    assert.equal(res.status, code, JSON.stringify(opts));
    assert.equal(calls.some((c) => c.url.endsWith('/v1/refunds')), false);
  }
  const { f } = makeRefundFetch();
  assert.equal((await refund.handle(rpost({ order_id: 'non-un-id' }), ENV, f)).status, 400);
});
await test('refund-order: già rimborsato su Stripe = ok; altro errore = 502 e l’ordine resta aperto', async () => {
  const a = makeRefundFetch({ refundCode: 'charge_already_refunded' });
  assert.equal((await refund.handle(rpost({ order_id: OID }), ENV, a.f)).status, 200);
  const b = makeRefundFetch({ refundCode: 'something_else' });
  assert.equal((await refund.handle(rpost({ order_id: OID }), ENV, b.f)).status, 502);
  assert.equal(b.calls.some((c) => c.init.method === 'PATCH'), false);
});

// ---------- admin-menu ----------
const MENU_TEXT = `# Menu di prova
Cocktail | Gin Tonic | Gin, tonica | 10
Cocktail | Spritz | Prosecco, aperitivo | 8,50
Shot | Shot tequila | Con sale e limone | € 4
Birre | Birra alla spina | Media 0,4 l | 6.00 | https://example.com/birra.jpg
Bottiglie | Bottiglia vodka premium | Con 6 mixer | 180
`;
function makeAdminFetch({ exists = false } = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    const u = String(url); calls.push({ url: u, init });
    if (u.includes('/rest/v1/clubs?id=eq.') && (init.method ?? 'GET') === 'GET') return ok(exists ? [{ id: 'notte', name: 'Vecchio nome' }] : []);
    if (u.endsWith('/rest/v1/clubs') && init.method === 'POST') return new Response(null, { status: 201 });
    if (u.includes('/rest/v1/clubs?id=eq.') && init.method === 'PATCH') return new Response(null, { status: 204 });
    if (u.endsWith('/rest/v1/menu_items') && init.method === 'POST') return new Response(null, { status: 201 });
    if (u.includes('/rest/v1/menu_items?club_id=eq.') && init.method === 'DELETE') return new Response(null, { status: 204 });
    throw new Error('chiamata inattesa ' + u);
  };
  return { f, calls };
}
const apost = (body, key = 'chiave-admin') => post('https://f/admin-menu', body, key ? { 'x-admin-key': key } : {});

await test('admin-menu: leggere prezzi e righe del menu', () => {
  assert.equal(adminMenu.parsePrice('10'), 1000); assert.equal(adminMenu.parsePrice('8,50'), 850);
  assert.equal(adminMenu.parsePrice('€ 4'), 400); assert.equal(adminMenu.parsePrice('6.00'), 600);
  for (const bad of ['', 'abc', '0', '0,10', '-5', '10,555', '999999']) assert.equal(adminMenu.parsePrice(bad), null, bad);
  const r = adminMenu.parseMenu(MENU_TEXT);
  assert.deepEqual(r.errors, []); assert.equal(r.items.length, 5);
  assert.equal(r.items[1].price_cents, 850); assert.equal(r.items[3].image_url, 'https://example.com/birra.jpg');
  assert.equal(r.items[2].glass, 'sh'); assert.equal(r.items[3].glass, 'pint'); assert.equal(r.items[4].glass, 'bot');
  const bad = adminMenu.parseMenu('Cocktail | Gin | x | dieci\nSolo due | colonne\nShot | Tequila | x | 4 | http://foto');
  assert.equal(bad.errors.length, 3); assert.match(bad.errors[0], /Riga 1/);
});
await test('admin-menu: crea il locale e salva il menu, i drink tolti dall’elenco spariscono', async () => {
  const { f, calls } = makeAdminFetch();
  const res = await adminMenu.handle(apost({ club: 'notte', name: 'Club Notte', menu_text: MENU_TEXT }), ENV, f);
  assert.equal(res.status, 200); assert.deepEqual(await res.json(), { club: 'notte', created: true, items: 5 });
  const club = JSON.parse(calls.find((c) => c.url.endsWith('/rest/v1/clubs') && c.init.method === 'POST').init.body);
  assert.equal(club.id, 'notte'); assert.equal(club.name, 'Club Notte');
  const menu = JSON.parse(calls.find((c) => c.url.endsWith('/rest/v1/menu_items')).init.body);
  assert.equal(menu[0].id, 'notte-m1'); assert.equal(menu[0].club_id, 'notte'); assert.equal(menu[0].price_cents, 1000); assert.equal(menu[0].available, true);
  const del = calls.find((c) => c.init.method === 'DELETE');
  assert.match(decodeURIComponent(del.url), /id=not\.in\.\(notte-m1,notte-m2,notte-m3,notte-m4,notte-m5\)/);
});
await test('admin-menu: un errore nel testo non scrive nulla; chiave sbagliata = 401; dati strani = 400', async () => {
  const a = makeAdminFetch();
  const res = await adminMenu.handle(apost({ club: 'notte', name: 'Club Notte', menu_text: 'Cocktail | Gin | x | dieci' }), ENV, a.f);
  assert.equal(res.status, 400); assert.equal(a.calls.length, 0);
  assert.equal((await adminMenu.handle(apost({ club: 'notte' }, 'sbagliata'), ENV, makeAdminFetch().f)).status, 401);
  assert.equal((await adminMenu.handle(apost({ club: 'notte' }, null), ENV, makeAdminFetch().f)).status, 401);
  for (const b of [{ club: 'Notte!' }, { club: 'notte', name: 'x'.repeat(61) }, { club: 'notte', fee_cents: 9999 }, { club: 'notte', menu_text: 'Cocktail|Gin|x|10' }]) {
    assert.equal((await adminMenu.handle(apost(b), ENV, makeAdminFetch().f)).status, 400, JSON.stringify(b));
  }
});
await test('admin-menu: locale esistente = aggiorna nome e costo del servizio senza ricrearlo', async () => {
  const { f, calls } = makeAdminFetch({ exists: true });
  const res = await adminMenu.handle(apost({ club: 'notte', name: 'Club Notte 2', fee_cents: 99 }), ENV, f);
  assert.deepEqual(await res.json(), { club: 'notte', created: false, items: 0 });
  assert.deepEqual(JSON.parse(calls.find((c) => c.init.method === 'PATCH').init.body), { name: 'Club Notte 2', service_fee_cents: 99 });
  assert.equal(calls.some((c) => c.init.method === 'POST'), false);
});

// ---------- stripe-webhook ----------
const sign = (payload, secret = 'whsec_test', t = 1_800_000_000) =>
  `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')}`;
const NOW = 1_800_000_100;
const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const eventBody = (over = {}, obj = {}) => JSON.stringify({
  type: 'checkout.session.completed', account: 'acct_club1',
  data: { object: { payment_status: 'paid', amount_total: 2449, currency: 'eur', metadata: { order_id: ORDER_ID }, ...obj } }, ...over,
});

function makeHookFetch({ status = 'pending_payment', account = 'acct_club1' } = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const u = String(url);
    if (u.includes('/rest/v1/orders?id=eq.') && !init.method) return ok([{ id: ORDER_ID, club_id: 'aurora', subtotal_cents: 2400, fee_cents: 49, status }]);
    if (u.includes('/rest/v1/clubs?')) return ok([{ stripe_account_id: account }]);
    if (u.includes('/rest/v1/orders?id=eq.') && init.method === 'PATCH') return new Response(null, { status: 204 });
    throw new Error('chiamata inattesa ' + u);
  };
  return { f, calls };
}
const hook = (body, sig) => new Request('https://f/stripe-webhook', { method: 'POST', headers: { 'stripe-signature': sig }, body });
const patches = (calls) => calls.filter((c) => c.init.method === 'PATCH');

await test('webhook: pagamento valido porta l’ordine ai baristi', async () => {
  const { f, calls } = makeHookFetch(); const body = eventBody();
  const res = await webhook.handle(hook(body, sign(body)), ENV, f, NOW);
  assert.equal(res.status, 200);
  assert.equal(patches(calls).length, 1);
  assert.equal(JSON.parse(patches(calls)[0].init.body).status, 'new');
});
await test('webhook: firma sbagliata o scaduta = rifiutato', async () => {
  const { f, calls } = makeHookFetch(); const body = eventBody();
  assert.equal((await webhook.handle(hook(body, sign(body, 'whsec_altro')), ENV, f, NOW)).status, 400);
  assert.equal((await webhook.handle(hook(body, sign(body, 'whsec_test', 1_000_000_000)), ENV, f, NOW)).status, 400);
  assert.equal((await webhook.handle(hook(body, sign(body + ' ')), ENV, f, NOW)).status, 400);
  assert.equal((await webhook.handle(hook(body, null), ENV, f, NOW)).status, 400);
  assert.equal(patches(calls).length, 0);
});
await test('webhook: importo diverso, conto Stripe diverso o ordine già gestito = nessuna modifica', async () => {
  for (const [opts, body] of [
    [{}, eventBody({}, { amount_total: 100 })],
    [{ account: 'acct_altro' }, eventBody()],
    [{ status: 'new' }, eventBody()],
    [{}, eventBody({}, { payment_status: 'unpaid' })],
  ]) {
    const { f, calls } = makeHookFetch(opts);
    const res = await webhook.handle(hook(body, sign(body)), ENV, f, NOW);
    assert.equal(res.status, 200);
    assert.equal(patches(calls).length, 0);
  }
});
await test('webhook: sessione scaduta annulla l’ordine non pagato', async () => {
  const { f, calls } = makeHookFetch(); const body = eventBody({ type: 'checkout.session.expired' });
  await webhook.handle(hook(body, sign(body)), ENV, f, NOW);
  assert.equal(JSON.parse(patches(calls)[0].init.body).status, 'canceled');
});

// ---------- connect-link ----------
function makeLinkFetch({ account = null } = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const u = String(url);
    if (u.includes('/rest/v1/clubs?') && !init.method) return ok([{ id: 'aurora', name: 'Aurora', stripe_account_id: account }]);
    if (u.includes('/rest/v1/clubs?') && init.method === 'PATCH') return new Response(null, { status: 204 });
    if (u === 'https://api.stripe.com/v1/accounts') return ok({ id: 'acct_nuovo' });
    if (u === 'https://api.stripe.com/v1/account_links') return ok({ url: 'https://connect.stripe.com/setup/e/xyz' });
    throw new Error('chiamata inattesa ' + u);
  };
  return { f, calls };
}
await test('connect-link: senza chiave admin = 401', async () => {
  const { f } = makeLinkFetch();
  assert.equal((await link.handle(post('https://f', { club: 'aurora' }), ENV, f)).status, 401);
  assert.equal((await link.handle(post('https://f', { club: 'aurora' }, { 'x-admin-key': 'sbagliata' }), ENV, f)).status, 401);
});
await test('connect-link: crea l’account Standard e restituisce il link', async () => {
  const { f, calls } = makeLinkFetch();
  const res = await link.handle(post('https://f', { club: 'aurora' }, { 'x-admin-key': 'chiave-admin' }), ENV, f);
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.url, 'https://connect.stripe.com/setup/e/xyz');
  assert.equal(out.account, 'acct_nuovo');
  const acc = calls.find((c) => c.url.endsWith('/v1/accounts'));
  const p = new URLSearchParams(acc.init.body);
  assert.equal(p.get('type'), 'standard'); assert.equal(p.get('country'), 'IT');
  assert.equal(JSON.parse(calls.find((c) => c.init.method === 'PATCH').init.body).stripe_account_id, 'acct_nuovo');
});
await test('connect-link: se il locale ha già l’account non ne crea un altro', async () => {
  const { f, calls } = makeLinkFetch({ account: 'acct_esistente' });
  const res = await link.handle(post('https://f', { club: 'aurora' }, { 'x-admin-key': 'chiave-admin' }), ENV, f);
  assert.equal((await res.json()).account, 'acct_esistente');
  assert.ok(!calls.some((c) => c.url.endsWith('/v1/accounts')));
});

// ---------- accept-invite ----------
const INVITE_TOKEN = 'a'.repeat(48);
const NOW_INV = Date.parse('2026-11-26T12:00:00Z');
function makeInviteFetch({ email = 'staff@bar.it', invite = {}, inStaff = false, claimOk = true, staffOk = true } = {}) {
  const calls = [];
  const inv = { id: 'inv1', club_id: 'aurora', email: 'staff@bar.it', role: 'barista', used_at: null, expires_at: '2026-12-01T00:00:00Z', ...invite };
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const u = String(url);
    if (u.endsWith('/auth/v1/user')) return ok({ id: 'user1', email });
    if (u.includes('/rest/v1/venue_invites?token=')) return ok(invite === null ? [] : [inv]);
    if (u.includes('/rest/v1/staff?user_id=')) return ok(inStaff ? [{ club_id: 'altro' }] : []);
    if (u.includes('/rest/v1/venue_invites?id=') && init.method === 'PATCH') {
      const isClaim = JSON.parse(init.body).used_at !== null;
      return isClaim ? ok(claimOk ? [{ id: 'inv1' }] : []) : new Response(null, { status: 204 });
    }
    if (u.endsWith('/rest/v1/staff') && init.method === 'POST') return staffOk ? new Response(null, { status: 201 }) : new Response('{}', { status: 500 });
    return new Response('{}', { status: 404 });
  };
  return { f, calls };
}
const acceptReq = (token = INVITE_TOKEN, auth = 'Bearer jwt') =>
  post('https://f', { token }, auth ? { authorization: auth } : {});

await test('accept-invite: collega l’utente al locale con il ruolo invitato', async () => {
  const { f, calls } = makeInviteFetch();
  const res = await acceptInvite.handle(acceptReq(), ENV, f, NOW_INV);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { club_id: 'aurora', role: 'barista' });
  const ins = calls.find((c) => c.url.endsWith('/rest/v1/staff') && c.init.method === 'POST');
  assert.deepEqual(JSON.parse(ins.init.body), { user_id: 'user1', club_id: 'aurora', role: 'barista' });
});
await test('accept-invite: senza login risponde 401', async () => {
  const { f } = makeInviteFetch();
  assert.equal((await acceptInvite.handle(acceptReq(INVITE_TOKEN, ''), ENV, f, NOW_INV)).status, 401);
});
await test('accept-invite: rifiuta un token malformato', async () => {
  const { f } = makeInviteFetch();
  assert.equal((await acceptInvite.handle(acceptReq('../x'), ENV, f, NOW_INV)).status, 400);
});
await test('accept-invite: token sconosciuto → 404', async () => {
  const { f } = makeInviteFetch({ invite: null });
  assert.equal((await acceptInvite.handle(acceptReq(), ENV, f, NOW_INV)).status, 404);
});
await test('accept-invite: invito scaduto → 410', async () => {
  const { f } = makeInviteFetch({ invite: { expires_at: '2026-11-01T00:00:00Z' } });
  assert.equal((await acceptInvite.handle(acceptReq(), ENV, f, NOW_INV)).status, 410);
});
await test('accept-invite: invito già usato → 410', async () => {
  const { f } = makeInviteFetch({ invite: { used_at: '2026-11-25T00:00:00Z' } });
  assert.equal((await acceptInvite.handle(acceptReq(), ENV, f, NOW_INV)).status, 410);
});
await test('accept-invite: email diversa da quella invitata → 403, nessuna scrittura', async () => {
  const { f, calls } = makeInviteFetch({ email: 'altro@bar.it' });
  assert.equal((await acceptInvite.handle(acceptReq(), ENV, f, NOW_INV)).status, 403);
  assert.ok(!calls.some((c) => c.init.method === 'PATCH' || c.init.method === 'POST'));
});
await test('accept-invite: l’email si confronta senza badare alle maiuscole', async () => {
  const { f } = makeInviteFetch({ email: 'Staff@Bar.IT' });
  assert.equal((await acceptInvite.handle(acceptReq(), ENV, f, NOW_INV)).status, 200);
});
await test('accept-invite: chi ha già un locale → 409', async () => {
  const { f } = makeInviteFetch({ inStaff: true });
  assert.equal((await acceptInvite.handle(acceptReq(), ENV, f, NOW_INV)).status, 409);
});
await test('accept-invite: se qualcuno lo usa nel frattempo → 410 e nessuna riga staff', async () => {
  const { f, calls } = makeInviteFetch({ claimOk: false });
  assert.equal((await acceptInvite.handle(acceptReq(), ENV, f, NOW_INV)).status, 410);
  assert.ok(!calls.some((c) => c.url.endsWith('/rest/v1/staff') && c.init.method === 'POST'));
});
await test('accept-invite: se la riga staff fallisce, l’invito torna utilizzabile', async () => {
  const { f, calls } = makeInviteFetch({ staffOk: false });
  assert.equal((await acceptInvite.handle(acceptReq(), ENV, f, NOW_INV)).status, 500);
  const patches = calls.filter((c) => c.init.method === 'PATCH');
  assert.equal(JSON.parse(patches[patches.length - 1].init.body).used_at, null);
});

console.log(`\n${passed} prove superate`);
