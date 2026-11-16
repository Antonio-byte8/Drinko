// Genera supabase/seed.sql: il locale di esempio e il suo menu. Si lancia con: node tests/make-seed.mjs
import { writeFileSync } from 'node:fs';
const rows = [
  ['c1','Cocktail','Gin Tonic','Gin, tonica, scorza di limone',1000,'hb','#e9f6f2','#9bd66b'],
  ['c2','Cocktail','Negroni','Gin, vermut rosso, bitter',1000,'rk','#b3202e',''],
  ['c3','Cocktail','Moscow Mule','Vodka, ginger beer, lime',1000,'hb','#f2e6b8','#9bd66b'],
  ['c4','Cocktail','Spritz','Prosecco, aperitivo, soda',800,'hb','#ff9a3d','#ff7a1a'],
  ['c5','Cocktail','Long Island','Cinque distillati, cola, limone',1200,'hb','#8a4a1f','#f3e07a'],
  ['s1','Shot','Shot tequila','Con sale e limone',400,'sh','#f0d27a','#9bd66b'],
  ['s2','Shot','Shot vodka','Ghiacciato',400,'sh','#e9f6f2',''],
  ['s3','Shot','Shot amaro alle erbe','Servito freddo',400,'sh','#3b2412',''],
  ['b1','Birre','Birra alla spina','Media, 0,4 l',600,'pint','#f2b53a',''],
  ['b2','Birre','Birra in bottiglia','Lager, 33 cl',600,'bt','#7a4b12','#d9a441'],
  ['a1','Analcolici','Acqua','Naturale o frizzante, 0,5 l',300,'bt','#8ecbff','#ffffff'],
  ['a2','Analcolici','Energy drink','Lattina 25 cl',500,'can','#35d07f',''],
  ['a3','Analcolici','Cola','Vetro 33 cl',400,'hb','#3a1f14',''],
  ['k1','Bottiglie','Bottiglia vodka premium','Con 6 mixer a scelta e ghiaccio',18000,'bot','#dfe9ee','#1f3b55'],
  ['k2','Bottiglie','Bottiglia gin','Con 6 toniche e ghiaccio',16000,'bot','#cfe8df','#2e6b4f'],
  ['k3','Bottiglie','Bottiglia prosecco','Brut, 75 cl',6000,'bot','#2d5a3a','#d9b24a'],
];
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
let sql = `-- Locale di esempio e suo menu. Incolla nel SQL Editor di Supabase dopo schema.sql.
-- Cambia nome, drink e prezzi (in centesimi: 1000 = 10,00 euro) dalla pagina "Table Editor" di Supabase.

insert into clubs (id, name) values ('aurora', 'Club Aurora') on conflict (id) do nothing;

insert into menu_items (id, club_id, category, name, description, price_cents, glass, color, garnish, sort) values\n`;
sql += rows.map((r, i) => `  (${q('aurora-' + r[0])}, 'aurora', ${q(r[1])}, ${q(r[2])}, ${q(r[3])}, ${r[4]}, ${q(r[5])}, ${q(r[6])}, ${q(r[7])}, ${(i + 1) * 10})`).join(',\n');
sql += `\non conflict (id) do nothing;\n`;
writeFileSync(new URL('../supabase/seed.sql', import.meta.url), sql);
console.log('seed.sql scritto con', rows.length, 'drink');
