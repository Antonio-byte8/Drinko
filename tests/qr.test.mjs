// Prova della pagina QR: genera i QR, li fotografa e li LEGGE con un lettore di QR per controllare l'indirizzo.
// Si lancia con:  node tests/qr.test.mjs   (serve Python con OpenCV)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');
const dir = mkdtempSync(path.join(tmpdir(), 'qr-'));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 2 });
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
await page.route('**/*', (r) => r.request().url().startsWith('file:') ? r.continue() : r.abort());
await page.goto('file://' + WEB + '/qr.html');
await page.fill('#base', 'https://bancone.example/app/');
await page.fill('#club', 'aurora'); await page.fill('#from', '1'); await page.fill('#to', '3');
await page.waitForFunction(() => document.querySelectorAll('.tag').length === 4);   // bancone + 3 tavoli
const tags = page.locator('.tag');
const expected = [];
for (let i = 0; i < 4; i++) {
  const url = await tags.nth(i).getAttribute('data-url');
  const file = path.join(dir, `q${i}.png`);
  await tags.nth(i).locator('svg').screenshot({ path: file });
  expected.push([file, url]);
}
await browser.close();
assert.deepEqual(expected.map((e) => e[1]), [
  'https://bancone.example/app/index.html?club=aurora',
  'https://bancone.example/app/index.html?club=aurora&table=1',
  'https://bancone.example/app/index.html?club=aurora&table=2',
  'https://bancone.example/app/index.html?club=aurora&table=3',
]);
const py = `
import cv2, sys, json
out = []
for f in sys.argv[1:]:
    img = cv2.imread(f)
    val, pts, _ = cv2.QRCodeDetector().detectAndDecode(img)
    out.append(val)
print(json.dumps(out))
`;
const decoded = JSON.parse(execFileSync('python3', ['-I', '-c', py, ...expected.map((e) => e[0])]).toString());
assert.deepEqual(decoded, expected.map((e) => e[1]));
assert.deepEqual(errors, []);
console.log('ok   i 4 QR si leggono e portano all’indirizzo giusto:\n     ' + decoded.join('\n     '));
