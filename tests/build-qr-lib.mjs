// Prepara web/qr-lib.js: la libreria QR (MIT, Kazuhiko Arase) in un solo file per il browser.
import { readFileSync, writeFileSync } from 'node:fs';
const D = '/opt/node22/lib/node_modules/npm/node_modules/qrcode-terminal/vendor/QRCode/';
const names = ['QRMode', 'QRErrorCorrectLevel', 'QRMaskPattern', 'QRMath', 'QRPolynomial', 'QRBitBuffer', 'QR8bitByte', 'QRRSBlock', 'QRUtil', 'index'];
let out = `/* Libreria QR code: QRCode for JavaScript, Copyright (c) 2009 Kazuhiko Arase, licenza MIT (http://www.opensource.org/licenses/mit-license.php).
   "QR Code" e' un marchio registrato di DENSO WAVE INCORPORATED. Raccolta in un solo file per il browser. */
(function () {
var defs = {};
var cache = {};
function req(n) {
  n = n.replace(/^\\.\\//, '');
  if (!cache[n]) { var m = { exports: {} }; cache[n] = m; defs[n](m, m.exports, req); }
  return cache[n].exports;
}
`;
for (const n of names) out += `defs[${JSON.stringify(n)}] = function (module, exports, require) {\n${readFileSync(D + n + '.js', 'utf8')}\n};\n`;
out += `window.QRCodeLib = { QRCode: req('index'), QRErrorCorrectLevel: req('QRErrorCorrectLevel') };\n})();\n`;
writeFileSync(new URL('../web/qr-lib.js', import.meta.url), out);
console.log('qr-lib.js', out.length, 'byte');
