-- Locale di esempio e suo menu. Incolla nel SQL Editor di Supabase dopo schema.sql.
-- Cambia nome, drink e prezzi (in centesimi: 1000 = 10,00 euro) dalla pagina "Table Editor" di Supabase.

insert into clubs (id, name) values ('aurora', 'Club Aurora') on conflict (id) do nothing;

insert into menu_items (id, club_id, category, name, description, price_cents, glass, color, garnish, sort) values
  ('aurora-c1', 'aurora', 'Cocktail', 'Gin Tonic', 'Gin, tonica, scorza di limone', 1000, 'hb', '#e9f6f2', '#9bd66b', 10),
  ('aurora-c2', 'aurora', 'Cocktail', 'Negroni', 'Gin, vermut rosso, bitter', 1000, 'rk', '#b3202e', '', 20),
  ('aurora-c3', 'aurora', 'Cocktail', 'Moscow Mule', 'Vodka, ginger beer, lime', 1000, 'hb', '#f2e6b8', '#9bd66b', 30),
  ('aurora-c4', 'aurora', 'Cocktail', 'Spritz', 'Prosecco, aperitivo, soda', 800, 'hb', '#ff9a3d', '#ff7a1a', 40),
  ('aurora-c5', 'aurora', 'Cocktail', 'Long Island', 'Cinque distillati, cola, limone', 1200, 'hb', '#8a4a1f', '#f3e07a', 50),
  ('aurora-s1', 'aurora', 'Shot', 'Shot tequila', 'Con sale e limone', 400, 'sh', '#f0d27a', '#9bd66b', 60),
  ('aurora-s2', 'aurora', 'Shot', 'Shot vodka', 'Ghiacciato', 400, 'sh', '#e9f6f2', '', 70),
  ('aurora-s3', 'aurora', 'Shot', 'Shot amaro alle erbe', 'Servito freddo', 400, 'sh', '#3b2412', '', 80),
  ('aurora-b1', 'aurora', 'Birre', 'Birra alla spina', 'Media, 0,4 l', 600, 'pint', '#f2b53a', '', 90),
  ('aurora-b2', 'aurora', 'Birre', 'Birra in bottiglia', 'Lager, 33 cl', 600, 'bt', '#7a4b12', '#d9a441', 100),
  ('aurora-a1', 'aurora', 'Analcolici', 'Acqua', 'Naturale o frizzante, 0,5 l', 300, 'bt', '#8ecbff', '#ffffff', 110),
  ('aurora-a2', 'aurora', 'Analcolici', 'Energy drink', 'Lattina 25 cl', 500, 'can', '#35d07f', '', 120),
  ('aurora-a3', 'aurora', 'Analcolici', 'Cola', 'Vetro 33 cl', 400, 'hb', '#3a1f14', '', 130),
  ('aurora-k1', 'aurora', 'Bottiglie', 'Bottiglia vodka premium', 'Con 6 mixer a scelta e ghiaccio', 18000, 'bot', '#dfe9ee', '#1f3b55', 140),
  ('aurora-k2', 'aurora', 'Bottiglie', 'Bottiglia gin', 'Con 6 toniche e ghiaccio', 16000, 'bot', '#cfe8df', '#2e6b4f', 150),
  ('aurora-k3', 'aurora', 'Bottiglie', 'Bottiglia prosecco', 'Brut, 75 cl', 6000, 'bot', '#2d5a3a', '#d9b24a', 160)
on conflict (id) do nothing;
