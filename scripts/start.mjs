#!/usr/bin/env node
/**
 * Drinko dev launcher
 * - Reads .env
 * - Writes web/config.js with real credentials
 * - Starts a local HTTP server on port 3000
 * - Opens the browser
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT || 3000;

// ── 1. Load .env ─────────────────────────────────────────────────────────────
const envPath = path.join(ROOT, '.env');
if (!fs.existsSync(envPath)) {
  const example = path.join(ROOT, '.env.example');
  fs.copyFileSync(example, envPath);
  console.log('\n⚠  Created .env from .env.example');
  console.log('   Open .env and fill in your Supabase URL and anon key, then run "npm start" again.\n');
  process.exit(1);
}

const env = {};
fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
  const m = line.match(/^([A-Z_]+)\s*=\s*(.+)$/);
  if (m) env[m[1]] = m[2].trim();
});

const url   = env.SUPABASE_URL   || '';
const anon  = env.SUPABASE_ANON_KEY || '';
const club  = env.DEFAULT_CLUB   || 'aurora';

// ── 2. Check credentials are filled in ───────────────────────────────────────
const isPlaceholder = url.includes('YOURPROJECT') || anon.includes('your-anon-key') || !url || !anon;
if (isPlaceholder) {
  console.log('\n⚠  .env is not configured yet.');
  console.log('   Open .env and set SUPABASE_URL and SUPABASE_ANON_KEY.');
  console.log('   Find them in your Supabase project → Settings → API.\n');
  process.exit(1);
}

// ── 3. Write web/config.js ───────────────────────────────────────────────────
const configJs = `window.APP = {
  name: 'Drinko',
  supabaseUrl: '${url}',
  anonKey: '${anon}',
  defaultClub: '${club}'
};\n`;

const configPath = path.join(ROOT, 'web', 'config.js');
fs.writeFileSync(configPath, configJs, 'utf8');
console.log('✓  web/config.js updated');

// ── 4. Serve web/ ─────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.json': 'application/json',
  '.woff2':'font/woff2',
};

const webDir = path.join(ROOT, 'web');

const server = http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.join(webDir, urlPath);

  // Security: stay inside web/
  if (!filePath.startsWith(webDir)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // Try adding .html
    const withHtml = filePath + '.html';
    if (fs.existsSync(withHtml)) {
      serve(res, withHtml); return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found: ' + urlPath);
    return;
  }
  serve(res, filePath);
});

function serve(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const ct = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': ct });
  fs.createReadStream(filePath).pipe(res);
}

server.listen(PORT, () => {
  const localUrl = `http://localhost:${PORT}`;
  console.log(`\n🍹 Drinko running at ${localUrl}`);
  console.log(`   Customer:  ${localUrl}/?club=${club}`);
  console.log(`   Bar staff: ${localUrl}/bar.html`);
  console.log(`   Venue:     ${localUrl}/venue/`);
  console.log(`   QR codes:  ${localUrl}/qr.html`);
  console.log('\n   Press Ctrl+C to stop.\n');
  openBrowser(localUrl + '/?club=' + club);
});

// ── 5. Open browser ───────────────────────────────────────────────────────────
function openBrowser(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, () => {});
}
