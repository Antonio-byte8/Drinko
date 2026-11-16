// Prova delle schermate in un browser vero, con Supabase e Stripe finti (nessuna rete).
// Si lancia con:  node tests/ui.test.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');
const SB = 'https://incolla-qui.supabase.co'; // il browser scrive gli indirizzi in minuscolo

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('ok   ' + name); }
  catch (e) { console.error('FAIL ' + name + '\n' + (e.stack || e)); process.exitCode = 1; }
}
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

const MENU = [
  { id: 'aurora-c1', club_id: 'aurora', category: 'Cocktail', name: 'Gin Tonic', description: 'Gin, tonica', price_cents: 1000, image_url: null, glass: 'hb', color: '#e9f6f2', garnish: '#9bd66b', sort: 10 },
  { id: 'aurora-c4', club_id: 'aurora', category: 'Cocktail', name: 'Spritz', description: 'Prosecco', price_cents: 800, image_url: null, glass: 'hb', color: '#ff9a3d', garnish: '#ff7a1a', sort: 40 },
  { id: 'aurora-s1', club_id: 'aurora', category: 'Shot', name: 'Shot tequila', description: 'Con sale', price_cents: 400, image_url: null, glass: 'sh', color: '#f0d27a', garnish: '', sort: 60 },
];
const ORDER_ID = '11111111-1111-4111-8111-111111111111', TOKEN = '22222222-2222-4222-8222-222222222222';

const BARMENU = [
  { id: 'aurora-c1', name: 'Gin Tonic', category: 'Cocktail', available: true },
  { id: 'aurora-c4', name: 'Spritz', category: 'Cocktail', available: true },
];
const browser = await chromium.launch();

async function newPage(mock, locale = 'it-IT') {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 900 }, locale });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('**/*', async (route) => {
    const req = route.request(), u = req.url();
    if (u.startsWith('file:')) return route.continue();
    if (u.startsWith(SB)) {
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      return mock(route, req, u);
    }
    if (u.startsWith('https://checkout.stripe.com')) return route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Stripe finto</h1>' });
    return route.abort(); // font e altro: niente rete
  });
  return { page, ctx, errors };
}

// ---------- CLIENTE ----------
await test('cliente: menu, carrello, costo del servizio, pagamento verso Stripe', async () => {
  let sent = null;
  const { page, errors } = await newPage(async (route, req, u) => {
    if (u.includes('/rest/v1/clubs?')) return json(route, [{ id: 'aurora', name: 'Club Aurora', service_fee_cents: 49 }]);
    if (u.includes('/rest/v1/menu_items?')) return json(route, MENU);
    if (u.endsWith('/functions/v1/create-checkout')) { sent = JSON.parse(req.postData()); return json(route, { url: 'https://checkout.stripe.com/c/pay/cs_test', order_id: ORDER_ID, token: TOKEN }); }
    throw new Error('chiamata inattesa ' + u);
  });
  await page.goto('file://' + WEB + '/index.html?club=aurora&table=12');
  await page.waitForSelector('.item');
  assert.equal(await page.locator('h1').innerText(), 'Club Aurora');
  assert.equal(await page.locator('.chip').innerText(), 'Tavolo 12');
  assert.equal(await page.locator('.item').count(), 2);
  assert.ok(await page.locator('.thumb svg').count() >= 2, 'disegni dei drink');
  await page.click('button[aria-label="Aggiungi Gin Tonic"]');
  await page.click('button[aria-label="Aggiungi Gin Tonic"]');
  await page.click('button[aria-label="Aggiungi Spritz"]');
  assert.match(await page.locator('.cartbar').innerText(), /28,00/);
  await page.click('.cartbar');
  const txt = await page.locator('.phone').innerText();
  assert.match(txt, /Costo del servizio/); assert.match(txt, /0,49/); assert.match(txt, /28,49/);
  await page.click('.pay');
  assert.match(await page.locator('#err').innerText(), /almeno 18 anni/);
  assert.equal(sent, null, 'senza conferma dei 18 anni non parte nessun pagamento');
  await page.fill('#note', 'senza ghiaccio');
  await page.click('input[data-act="age"]');
  await page.click('.pay');
  await page.waitForURL('https://checkout.stripe.com/**');
  assert.deepEqual(sent, { club: 'aurora', table: '12', mode: 'tavolo', age_ok: true, note: 'senza ghiaccio', items: [{ id: 'aurora-c1', q: 2 }, { id: 'aurora-c4', q: 1 }] });
  assert.deepEqual(errors, []);
});

await test('cliente: senza tavolo nel QR chiede il numero e rifiuta se manca', async () => {
  let called = false;
  const { page } = await newPage(async (route, req, u) => {
    if (u.includes('/rest/v1/clubs?')) return json(route, [{ id: 'aurora', name: 'Club Aurora', service_fee_cents: 49 }]);
    if (u.includes('/rest/v1/menu_items?')) return json(route, MENU);
    if (u.endsWith('/functions/v1/create-checkout')) { called = true; return json(route, { error: 'x' }, 400); }
    throw new Error('inattesa');
  });
  await page.goto('file://' + WEB + '/index.html?club=aurora');
  await page.waitForSelector('.item');
  await page.click('button[aria-label="Aggiungi Shot tequila"]').catch(async () => { await page.click('button[data-v="Shot"]'); await page.click('button[aria-label="Aggiungi Shot tequila"]'); });
  await page.click('.cartbar');
  // senza tavolo il modo predefinito e' bancone: scelgo "Al tavolo" e non scrivo nulla
  await page.click('button[data-v="tavolo"]');
  await page.click('.pay');
  assert.match(await page.locator('#err').innerText(), /numero del tuo tavolo/);
  assert.equal(called, false);
});

await test('cliente: dopo il pagamento segue l’ordine e avvisa quando è pronto', async () => {
  const steps = ['pending_payment', 'new', 'prep', 'ready'];
  let i = 0;
  const { page, errors } = await newPage(async (route, req, u) => {
    if (u.includes('/rest/v1/clubs?')) return json(route, [{ id: 'aurora', name: 'Club Aurora', service_fee_cents: 49 }]);
    if (u.includes('/rest/v1/menu_items?')) return json(route, MENU);
    if (u.endsWith('/rest/v1/rpc/get_order')) {
      const b = JSON.parse(req.postData()); assert.equal(b.p_id, ORDER_ID); assert.equal(b.p_token, TOKEN);
      const status = steps[Math.min(i++, steps.length - 1)];
      return json(route, [{ id: ORDER_ID, club_id: 'aurora', number: 321, table_label: '12', mode: 'tavolo', status, items: [{ name: 'Gin Tonic', q: 2 }], subtotal_cents: 2800, fee_cents: 49, created_at: new Date().toISOString() }]);
    }
    throw new Error('inattesa ' + u);
  });
  await page.clock.install();
  await page.goto(`file://${WEB}/index.html?club=aurora&table=12&order=${ORDER_ID}&t=${TOKEN}`);
  await page.waitForSelector('.sheet');
  assert.match(await page.locator('.sheet').innerText(), /confermando il pagamento/);
  assert.ok(!page.url().includes('t=' + TOKEN), 'il segreto non resta nell’indirizzo');
  await page.clock.runFor(4100);
  await page.waitForFunction(() => document.querySelector('.big-num'));
  assert.equal(await page.locator('.big-num').innerText(), '#321');
  assert.match(await page.locator('.steps li.now').innerText(), /Ordine ricevuto/);
  await page.clock.runFor(4100);
  await page.waitForFunction(() => /In preparazione/.test((document.querySelector('.steps li.now') || {}).innerText || ''));
  assert.match(await page.locator('.steps li.now').innerText(), /In preparazione/);
  assert.equal(await page.locator('#toast').isHidden(), true);
  await page.clock.runFor(4100);
  await page.waitForFunction(() => !document.getElementById('toast').hidden);
  assert.match(await page.locator('#toast').innerText(), /drink è pronto/);
  assert.match(await page.locator('.ready-box').innerText(), /pronto/);
  assert.deepEqual(errors, []);
});

await test('cliente: locale sconosciuto mostra un messaggio chiaro', async () => {
  const { page } = await newPage(async (route, req, u) => {
    if (u.includes('/rest/v1/clubs?')) return json(route, []);
    if (u.includes('/rest/v1/menu_items?')) return json(route, []);
    throw new Error('inattesa');
  });
  await page.goto('file://' + WEB + '/index.html?club=nonesiste&table=1');
  await page.waitForSelector('.sheet');
  assert.match(await page.locator('.sheet').innerText(), /Locale non trovato/);
});

await test('cliente: con il telefono in inglese il sito è in inglese e si può cambiare lingua', async () => {
  const { page, errors } = await newPage(async (route, req, u) => {
    if (u.includes('/rest/v1/clubs?')) return json(route, [{ id: 'aurora', name: 'Club Aurora', service_fee_cents: 49 }]);
    if (u.includes('/rest/v1/menu_items?')) return json(route, MENU);
    throw new Error('inattesa ' + u);
  }, 'en-GB');
  await page.goto('file://' + WEB + '/index.html?club=aurora&table=12');
  await page.waitForSelector('.item');
  await page.click('button[aria-label="Add Gin Tonic"]');
  assert.match(await page.locator('.cartbar').innerText(), /Go to payment/);
  await page.click('.cartbar');
  const t = await page.locator('.phone').innerText();
  assert.match(t, /Your order/); assert.match(t, /Service fee/); assert.match(t, /at least 18/); assert.match(t, /Pay/);
  await page.click('button[data-act="back"]');
  await page.click('button[data-act="lang"]');
  assert.match(await page.locator('.cartbar').innerText(), /Vai al pagamento/);
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'it');
  assert.deepEqual(errors, []);
});

// ---------- BARISTA ----------
await test('barista: accesso, nuovi ordini, avanzamento di stato', async () => {
  const orders = [
    { id: 'o1', number: 321, table_label: '12', mode: 'tavolo', items: [{ name: 'Gin Tonic', q: 2 }], subtotal_cents: 2000, fee_cents: 49, note: 'senza ghiaccio', status: 'new', created_at: new Date(Date.now() - 400000).toISOString() },
    { id: 'o2', number: 322, table_label: 'Bancone', mode: 'bancone', items: [{ name: 'Spritz', q: 1 }], subtotal_cents: 800, fee_cents: 49, status: 'ready', created_at: new Date(Date.now() - 600000).toISOString() },
  ];
  const patches = []; let authBody = null;
  const { page, errors } = await newPage(async (route, req, u) => {
    if (u.includes('/auth/v1/token?grant_type=password')) { authBody = JSON.parse(req.postData()); return json(route, { access_token: 'jwt', refresh_token: 'r', expires_in: 3600 }); }
    if (u.includes('/rest/v1/staff?')) { assert.equal(req.headers().authorization, 'Bearer jwt'); return json(route, [{ club_id: 'aurora' }]); }
    if (u.includes('/rest/v1/clubs?')) return json(route, [{ id: 'aurora', name: 'Club Aurora' }]);
    if (u.includes('/rest/v1/menu_items?')) return json(route, BARMENU.map((m) => ({ ...m })));
    if (u.includes('/rest/v1/orders?') && req.method() === 'PATCH') {
      const id = new URL(u).searchParams.get('id').replace('eq.', ''); const b = JSON.parse(req.postData()); patches.push([id, b.status]);
      orders.find((o) => o.id === id).status = b.status; return route.fulfill({ status: 204, headers: cors });
    }
    if (u.includes('status=eq.canceled')) return json(route, []);
    if (u.includes('status=in.')) return json(route, orders.filter((o) => ['new', 'prep', 'ready'].includes(o.status)));
    if (u.includes('status=eq.done')) return json(route, orders.filter((o) => o.status === 'done').map((o) => ({ subtotal_cents: o.subtotal_cents, fee_cents: o.fee_cents })));
    throw new Error('inattesa ' + u);
  });
  await page.goto('file://' + WEB + '/bar.html');
  await page.fill('#email', 'barista@aurora.it'); await page.fill('#pw', 'segreta123');
  await page.click('button[type=submit]');
  await page.waitForSelector('.board');
  assert.deepEqual(authBody, { email: 'barista@aurora.it', password: 'segreta123' });
  assert.match(await page.locator('h1').innerText(), /Club Aurora/);
  assert.equal(await page.locator('.col').nth(0).locator('.order').count(), 1);   // nuovi
  assert.match(await page.locator('.note-line').first().innerText(), /senza ghiaccio/);
  assert.equal(await page.locator('.order.late').count(), 1, 'ordine in attesa da piu di 5 minuti evidenziato');
  assert.equal(await page.locator('.col').nth(2).locator('.order').count(), 1);   // pronti
  await page.click('.col:nth-child(1) .adv');
  await page.waitForFunction(() => document.querySelectorAll('.col')[1].querySelectorAll('.order').length === 1);
  await page.click('.col:nth-child(2) .adv');
  await page.waitForFunction(() => document.querySelectorAll('.col')[2].querySelectorAll('.order').length === 2);
  await page.click('.col:nth-child(3) .order.s-ready >> nth=0');   // tocco sulla scheda: nessun effetto
  assert.deepEqual(patches, [['o1', 'prep'], ['o1', 'ready']]);
  assert.deepEqual(errors, []);
});

await test('barista: password sbagliata mostra l’errore e resta sul modulo', async () => {
  const { page } = await newPage(async (route, req, u) => {
    if (u.includes('/auth/v1/token')) return json(route, { error_description: 'Invalid login credentials' }, 400);
    throw new Error('inattesa');
  });
  await page.goto('file://' + WEB + '/bar.html');
  await page.fill('#email', 'x@y.it'); await page.fill('#pw', 'no');
  await page.click('button[type=submit]');
  await page.waitForSelector('.err');
  assert.match(await page.locator('.err').innerText(), /Email o password errate/);
  assert.equal(await page.locator('#login').count(), 1);
});

await test('barista: segna un drink come esaurito e può rimetterlo disponibile', async () => {
  const menuPatches = []; let avail = { 'aurora-c1': true, 'aurora-c4': true };
  const { page, errors } = await newPage(async (route, req, u) => {
    if (u.includes('/auth/v1/token')) return json(route, { access_token: 'jwt', refresh_token: 'r', expires_in: 3600 });
    if (u.includes('/rest/v1/staff?')) return json(route, [{ club_id: 'aurora' }]);
    if (u.includes('/rest/v1/clubs?')) return json(route, [{ id: 'aurora', name: 'Club Aurora' }]);
    if (u.includes('/rest/v1/menu_items?') && req.method() === 'PATCH') {
      const id = new URL(u).searchParams.get('id').replace('eq.', ''); const b = JSON.parse(req.postData()); menuPatches.push([id, b]); avail[id] = b.available;
      return route.fulfill({ status: 204, headers: cors });
    }
    if (u.includes('/rest/v1/menu_items?')) return json(route, BARMENU.map((m) => ({ ...m, available: avail[m.id] })));
    if (u.includes('status=eq.canceled')) return json(route, []);
    if (u.includes('status=in.') || u.includes('status=eq.done')) return json(route, []);
    throw new Error('inattesa ' + u);
  });
  await page.goto('file://' + WEB + '/bar.html');
  await page.fill('#email', 'b@a.it'); await page.fill('#pw', 'x');
  await page.click('button[type=submit]');
  await page.waitForSelector('.board');
  await page.click('button[data-act="menu"]');
  await page.click('button[data-act="toggle"][data-id="aurora-c4"]');
  await page.waitForFunction(() => /1 esaurito/.test(document.querySelector('.menu-admin').innerText));
  await page.click('button[data-act="toggle"][data-id="aurora-c4"]');
  await page.waitForFunction(() => !/esaurito/.test(document.querySelector('.menu-admin > button').innerText));
  assert.deepEqual(menuPatches, [['aurora-c4', { available: false }], ['aurora-c4', { available: true }]]);
  assert.deepEqual(errors, []);
});

await test('cliente: un vecchio ordine consegnato non compare quando si scansiona di nuovo il QR', async () => {
  const { page, errors } = await newPage(async (route, req, u) => {
    if (u.includes('/rest/v1/clubs?')) return json(route, [{ id: 'aurora', name: 'Club Aurora', service_fee_cents: 49 }]);
    if (u.includes('/rest/v1/menu_items?')) return json(route, MENU);
    if (u.endsWith('/rest/v1/rpc/get_order')) return json(route, [{ id: ORDER_ID, club_id: 'aurora', number: 321, table_label: '12', mode: 'tavolo', status: 'done', items: [{ name: 'Gin Tonic', q: 2 }], subtotal_cents: 2800, fee_cents: 49, created_at: new Date(Date.now() - 86400000).toISOString() }]);
    throw new Error('inattesa ' + u);
  });
  await page.addInitScript((o) => localStorage.setItem('bancone_order', JSON.stringify(o)), { id: ORDER_ID, t: TOKEN, club: 'aurora' });
  await page.goto('file://' + WEB + '/index.html?club=aurora&table=12');
  await page.waitForSelector('.item');
  assert.equal(await page.locator('h1').innerText(), 'Club Aurora');
  assert.equal(await page.evaluate(() => localStorage.getItem('bancone_order')), null);
  assert.deepEqual(errors, []);
});

await test('barista: annulla e rimborsa un ordine, con conferma', async () => {
  const orders = [{ id: 'o1', number: 321, table_label: '12', mode: 'tavolo', items: [{ name: 'Gin Tonic', q: 2 }], subtotal_cents: 2000, fee_cents: 49, status: 'prep', created_at: new Date(Date.now() - 120000).toISOString() }];
  let refundBody = null, refundAuth = null;
  const { page, errors } = await newPage(async (route, req, u) => {
    if (u.includes('/auth/v1/token')) return json(route, { access_token: 'jwt', refresh_token: 'r', expires_in: 3600 });
    if (u.includes('/rest/v1/staff?')) return json(route, [{ club_id: 'aurora' }]);
    if (u.includes('/rest/v1/clubs?')) return json(route, [{ id: 'aurora', name: 'Club Aurora' }]);
    if (u.includes('/rest/v1/menu_items?')) return json(route, BARMENU);
    if (u.endsWith('/functions/v1/refund-order')) { refundBody = JSON.parse(req.postData()); refundAuth = req.headers().authorization; orders[0].status = 'canceled'; return json(route, { ok: true }); }
    if (u.includes('status=eq.canceled')) return json(route, []);
    if (u.includes('status=in.')) return json(route, orders.filter((o) => ['new', 'prep', 'ready'].includes(o.status)));
    if (u.includes('status=eq.done')) return json(route, []);
    throw new Error('inattesa ' + u);
  });
  await page.goto('file://' + WEB + '/bar.html');
  await page.fill('#email', 'b@a.it'); await page.fill('#pw', 'x');
  await page.click('button[type=submit]');
  await page.waitForSelector('.order');
  await page.click('button[data-act="cancel-ask"]');
  assert.match(await page.locator('.confirm').innerText(), /Rimborsare l’ordine #321/);
  await page.click('button[data-act="cancel-no"]');
  assert.equal(refundBody, null, 'senza conferma nessun rimborso');
  await page.click('button[data-act="cancel-ask"]');
  await page.click('button[data-act="cancel-yes"]');
  await page.waitForFunction(() => document.querySelectorAll('.order').length === 0);
  assert.deepEqual(refundBody, { order_id: 'o1' }); assert.equal(refundAuth, 'Bearer jwt');
  assert.deepEqual(errors, []);
});

await test('barista: riepilogo serata con incasso, costo del servizio e netto stimato', async () => {
  const { page, errors } = await newPage(async (route, req, u) => {
    if (u.includes('/auth/v1/token')) return json(route, { access_token: 'jwt', refresh_token: 'r', expires_in: 3600 });
    if (u.includes('/rest/v1/staff?')) return json(route, [{ club_id: 'aurora' }]);
    if (u.includes('/rest/v1/clubs?')) return json(route, [{ id: 'aurora', name: 'Club Aurora' }]);
    if (u.includes('/rest/v1/menu_items?')) return json(route, BARMENU);
    if (u.includes('status=eq.canceled')) return json(route, [{ subtotal_cents: 500, fee_cents: 49 }]);
    if (u.includes('status=in.')) return json(route, [{ id: 'o1', number: 321, table_label: '12', mode: 'tavolo', items: [{ name: 'Gin Tonic', q: 2 }], subtotal_cents: 2000, fee_cents: 49, status: 'new', created_at: new Date().toISOString() }]);
    if (u.includes('status=eq.done')) return json(route, [{ subtotal_cents: 1000, fee_cents: 49 }, { subtotal_cents: 1000, fee_cents: 49 }]);
    throw new Error('inattesa ' + u);
  });
  await page.goto('file://' + WEB + '/bar.html');
  await page.fill('#email', 'b@a.it'); await page.fill('#pw', 'x');
  await page.click('button[type=submit]');
  await page.waitForSelector('.board');
  await page.click('button[data-act="sum"]');
  const t = await page.locator('ul.summary').innerText();
  assert.match(t, /Ordini pagati\s*3/); assert.match(t, /40,00/); assert.match(t, /1,47/);
  assert.match(t, /1,37/); assert.match(t, /38,63/); assert.match(t, /Ordini rimborsati\s*1/);
  assert.deepEqual(errors, []);
});

// ---------- ADMIN ----------
await test('admin: crea il link Stripe per il gestore con la chiave admin', async () => {
  let headers = null, body = null;
  const { page } = await newPage(async (route, req, u) => {
    if (u.endsWith('/functions/v1/connect-link')) { headers = req.headers(); body = JSON.parse(req.postData()); return json(route, { url: 'https://connect.stripe.com/setup/e/abc', account: 'acct_123' }); }
    throw new Error('inattesa');
  });
  await page.goto('file://' + WEB + '/admin.html');
  await page.fill('#club', 'Aurora'); await page.fill('#key', 'chiave-admin');
  await page.click('#go');
  await page.waitForSelector('#out:not([hidden])');
  assert.equal(await page.locator('#url').innerText(), 'https://connect.stripe.com/setup/e/abc');
  assert.equal(headers['x-admin-key'], 'chiave-admin'); assert.deepEqual(body, { club: 'aurora' });
});

await test('admin: crea il locale e carica il menu incollando l’elenco; gli errori si vedono', async () => {
  let headers = null, body = null, fail = false;
  const { page } = await newPage(async (route, req, u) => {
    if (u.endsWith('/functions/v1/admin-menu')) {
      headers = req.headers(); body = JSON.parse(req.postData());
      return fail ? json(route, { error: 'Riga 2: prezzo non valido ("dieci")' }, 400) : json(route, { club: 'notte', created: true, items: 2 });
    }
    throw new Error('inattesa ' + u);
  });
  await page.goto('file://' + WEB + '/admin.html');
  await page.fill('#key', 'chiave-admin');
  assert.equal(await page.inputValue('#mkey'), 'chiave-admin', 'la chiave si copia nel secondo modulo');
  await page.fill('#mclub', 'Notte'); await page.fill('#mname', 'Club Notte'); await page.fill('#mfee', '49');
  await page.fill('#mtext', 'Cocktail | Gin Tonic | Gin, tonica | 10\nShot | Tequila | Sale e limone | 4');
  await page.click('#mgo');
  await page.waitForSelector('#mok:not([hidden])');
  assert.deepEqual(body, { club: 'notte', name: 'Club Notte', menu_text: 'Cocktail | Gin Tonic | Gin, tonica | 10\nShot | Tequila | Sale e limone | 4', fee_cents: 49 });
  assert.equal(headers['x-admin-key'], 'chiave-admin');
  assert.match(await page.locator('#mok').innerText(), /Locale creato\. 2 drink salvati\..*index\.html\?club=notte/);
  fail = true;
  await page.click('#mgo');
  await page.waitForSelector('#merr:not([hidden])');
  assert.match(await page.locator('#merr').innerText(), /Riga 2/);
});

await browser.close();
console.log(`\n${passed} prove superate`);
