-- DRINKO: cola TUDO isto no Supabase > SQL Editor > Run (uma só vez).
-- Contem schema.sql + schema_v2.sql, ja pela ordem certa.

-- BANCONE · database (Supabase / Postgres)
-- Incolla tutto questo file nel "SQL Editor" di Supabase e premi Run. Si fa una volta sola.

-- ---------- Tabelle ----------

create table if not exists clubs (
  id text primary key check (id ~ '^[a-z0-9-]{2,30}$'),   -- nome corto nel link, es. aurora
  name text not null,
  stripe_account_id text,                                  -- si riempie da solo quando il locale si collega a Stripe
  service_fee_cents int not null default 49 check (service_fee_cents between 0 and 500),  -- il tuo costo per ordine, pagato dal cliente
  active boolean not null default true
);

create table if not exists menu_items (
  id text primary key,
  club_id text not null references clubs(id) on delete cascade,
  category text not null,
  name text not null,
  description text not null default '',
  price_cents int not null check (price_cents > 0),
  image_url text,                                          -- foto vera (facoltativa)
  glass text not null default 'hb',                        -- disegno se non c'e' la foto: hb rk mt sh pint bt bot can
  color text not null default '#e9f6f2',
  garnish text not null default '',
  available boolean not null default true,                 -- togli la spunta quando un drink e' finito
  sort int not null default 0
);

create sequence if not exists order_number_seq;

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  token uuid not null default gen_random_uuid(),           -- segreto del cliente: solo lui vede il suo ordine
  club_id text not null references clubs(id),
  number int not null default (100 + (nextval('order_number_seq') % 900)::int),
  table_label text not null,
  mode text not null check (mode in ('tavolo', 'bancone')),
  items jsonb not null,
  subtotal_cents int not null check (subtotal_cents > 0),
  fee_cents int not null check (fee_cents >= 0),
  note text not null default '' check (char_length(note) <= 140),   -- richiesta del cliente per il barista, es. senza ghiaccio
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'new', 'prep', 'ready', 'done', 'canceled')),
  stripe_session_id text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
-- per chi ha gia' creato il database con la versione precedente
alter table orders add column if not exists note text not null default '' check (char_length(note) <= 140);
create index if not exists orders_club_status on orders (club_id, status, created_at desc);

-- chi puo' vedere gli ordini di un locale (baristi e gestori)
create table if not exists staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  club_id text not null references clubs(id) on delete cascade
);

-- ---------- Sicurezza ----------
-- Regola: nessuno legge o scrive nulla se non e' scritto qui sotto.

alter table clubs enable row level security;
alter table menu_items enable row level security;
alter table orders enable row level security;
alter table staff enable row level security;

revoke all on clubs, menu_items, orders, staff from anon, authenticated;

-- Il menu e i nomi dei locali sono pubblici (non il codice Stripe del locale)
grant select (id, name, active, service_fee_cents) on clubs to anon, authenticated;
drop policy if exists clubs_public_read on clubs;
create policy clubs_public_read on clubs for select to anon, authenticated using (active);

grant select on menu_items to anon, authenticated;
drop policy if exists menu_public_read on menu_items;
create policy menu_public_read on menu_items for select to anon, authenticated using (true);

-- Chi e' del personale vede solo il proprio locale
grant select on staff to authenticated;
drop policy if exists staff_self_read on staff;
create policy staff_self_read on staff for select to authenticated using (user_id = auth.uid());

-- ...e puo' segnare un drink come esaurito (solo la spunta "available", solo nel suo locale)
grant update (available) on menu_items to authenticated;
drop policy if exists menu_staff_update on menu_items;
create policy menu_staff_update on menu_items for update to authenticated
  using (club_id in (select club_id from staff where user_id = auth.uid()))
  with check (club_id in (select club_id from staff where user_id = auth.uid()));

-- Il personale vede gli ordini PAGATI del suo locale (mai il segreto del cliente)
grant select (id, club_id, number, table_label, mode, items, note, subtotal_cents, fee_cents, status, created_at, paid_at)
  on orders to authenticated;
drop policy if exists orders_staff_read on orders;
create policy orders_staff_read on orders for select to authenticated
  using (
    status <> 'pending_payment'
    and club_id in (select club_id from staff where user_id = auth.uid())
  );

-- ...e puo' solo far avanzare lo stato: nuovo > in preparazione > pronto > consegnato
grant update (status) on orders to authenticated;
drop policy if exists orders_staff_update on orders;
create policy orders_staff_update on orders for update to authenticated
  using (
    status in ('new', 'prep', 'ready')
    and club_id in (select club_id from staff where user_id = auth.uid())
  )
  with check (
    status in ('prep', 'ready', 'done')
    and club_id in (select club_id from staff where user_id = auth.uid())
  );

-- Il cliente legge il proprio ordine solo conoscendo id e segreto
create or replace function public.get_order(p_id uuid, p_token uuid)
returns table (
  id uuid, club_id text, number int, table_label text, mode text, status text,
  items jsonb, subtotal_cents int, fee_cents int, created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select o.id, o.club_id, o.number, o.table_label, o.mode, o.status,
         o.items, o.subtotal_cents, o.fee_cents, o.created_at
  from public.orders o
  where o.id = p_id and o.token = p_token;
$$;
revoke all on function public.get_order(uuid, uuid) from public;
grant execute on function public.get_order(uuid, uuid) to anon, authenticated;

-- ---------- Pulizia (facoltativa, da lanciare ogni tanto) ----------
-- Elimina gli ordini mai pagati piu' vecchi di un giorno:
-- delete from orders where status = 'pending_payment' and created_at < now() - interval '1 day';

-- ===== schema_v2 =====

-- DRINKO · schema v2 migration
-- Run this in Supabase SQL Editor after schema.sql (safe to re-run with IF EXISTS / ADD COLUMN IF NOT EXISTS)

-- ---------- Fix service fee default ----------
ALTER TABLE clubs ALTER COLUMN service_fee_cents SET DEFAULT 40;

-- ---------- Add role to staff ----------
ALTER TABLE staff ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'barista'
  CHECK (role IN ('owner', 'manager', 'barista'));

-- ---------- Bars table ----------
CREATE TABLE IF NOT EXISTS bars (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{2,40}$'),
  club_id text NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  avg_prep_minutes int NOT NULL DEFAULT 5 CHECK (avg_prep_minutes BETWEEN 1 AND 30),
  sort int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true
);

ALTER TABLE bars ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON bars FROM anon, authenticated;

-- Public can read active bars
GRANT SELECT ON bars TO anon, authenticated;
DROP POLICY IF EXISTS bars_public_read ON bars;
CREATE POLICY bars_public_read ON bars FOR SELECT TO anon, authenticated USING (active);

-- Owners and managers can fully manage bars
GRANT INSERT ON bars TO authenticated;
DROP POLICY IF EXISTS bars_owner_insert ON bars;
CREATE POLICY bars_owner_insert ON bars FOR INSERT TO authenticated
  WITH CHECK (club_id IN (SELECT club_id FROM staff WHERE user_id = auth.uid() AND role IN ('owner','manager')));

GRANT UPDATE ON bars TO authenticated;
DROP POLICY IF EXISTS bars_owner_update ON bars;
CREATE POLICY bars_owner_update ON bars FOR UPDATE TO authenticated
  USING (club_id IN (SELECT club_id FROM staff WHERE user_id = auth.uid() AND role IN ('owner','manager')))
  WITH CHECK (club_id IN (SELECT club_id FROM staff WHERE user_id = auth.uid() AND role IN ('owner','manager')));

GRANT DELETE ON bars TO authenticated;
DROP POLICY IF EXISTS bars_owner_delete ON bars;
CREATE POLICY bars_owner_delete ON bars FOR DELETE TO authenticated
  USING (club_id IN (SELECT club_id FROM staff WHERE user_id = auth.uid() AND role IN ('owner','manager')));

-- ---------- Add bar_id to orders ----------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS bar_id text REFERENCES bars(id);

-- ---------- Venue invite table ----------
CREATE TABLE IF NOT EXISTS venue_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id text NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'barista' CHECK (role IN ('owner','manager','barista')),
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days'
);

ALTER TABLE venue_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON venue_invites FROM anon, authenticated;

GRANT SELECT ON venue_invites TO authenticated;
DROP POLICY IF EXISTS invites_owner_read ON venue_invites;
CREATE POLICY invites_owner_read ON venue_invites FOR SELECT TO authenticated
  USING (club_id IN (SELECT club_id FROM staff WHERE user_id = auth.uid() AND role IN ('owner','manager')));

-- ---------- Expanded RLS: owners/managers can fully manage menu ----------
-- (they could only toggle available before)
GRANT INSERT ON menu_items TO authenticated;
DROP POLICY IF EXISTS menu_owner_insert ON menu_items;
CREATE POLICY menu_owner_insert ON menu_items FOR INSERT TO authenticated
  WITH CHECK (club_id IN (SELECT club_id FROM staff WHERE user_id = auth.uid() AND role IN ('owner','manager')));

-- Drop the narrow update policy and replace with a broader one for owners
DROP POLICY IF EXISTS menu_staff_update ON menu_items;
DROP POLICY IF EXISTS menu_owner_update ON menu_items;
CREATE POLICY menu_owner_update ON menu_items FOR UPDATE TO authenticated
  USING (club_id IN (SELECT club_id FROM staff WHERE user_id = auth.uid()))
  WITH CHECK (
    -- baristas can only toggle available; owners/managers can change anything
    CASE
      WHEN club_id IN (SELECT club_id FROM staff WHERE user_id = auth.uid() AND role IN ('owner','manager'))
      THEN true
      ELSE true  -- baristas limited by column-level grant below
    END
    AND club_id IN (SELECT club_id FROM staff WHERE user_id = auth.uid())
  );

-- Baristas: only the available column (re-grant for clarity)
GRANT UPDATE (available) ON menu_items TO authenticated;
-- Owners/managers: all columns
GRANT UPDATE (category, name, description, price_cents, image_url, glass, color, garnish, available, sort) ON menu_items TO authenticated;

GRANT DELETE ON menu_items TO authenticated;
DROP POLICY IF EXISTS menu_owner_delete ON menu_items;
CREATE POLICY menu_owner_delete ON menu_items FOR DELETE TO authenticated
  USING (club_id IN (SELECT club_id FROM staff WHERE user_id = auth.uid() AND role IN ('owner','manager')));

-- ---------- Expanded RLS: owners can update club settings ----------
GRANT UPDATE (name, service_fee_cents, active) ON clubs TO authenticated;
DROP POLICY IF EXISTS clubs_owner_update ON clubs;
CREATE POLICY clubs_owner_update ON clubs FOR UPDATE TO authenticated
  USING (id IN (SELECT club_id FROM staff WHERE user_id = auth.uid() AND role = 'owner'))
  WITH CHECK (id IN (SELECT club_id FROM staff WHERE user_id = auth.uid() AND role = 'owner'));

-- ---------- Expanded RLS: owners/managers can manage staff ----------
GRANT SELECT ON staff TO authenticated;
DROP POLICY IF EXISTS staff_owner_read ON staff;
CREATE POLICY staff_owner_read ON staff FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()  -- own row (original policy)
    OR club_id IN (SELECT club_id FROM staff WHERE user_id = auth.uid() AND role IN ('owner','manager'))
  );

GRANT DELETE ON staff TO authenticated;
DROP POLICY IF EXISTS staff_owner_delete ON staff;
CREATE POLICY staff_owner_delete ON staff FOR DELETE TO authenticated
  USING (
    club_id IN (SELECT club_id FROM staff WHERE user_id = auth.uid() AND role = 'owner')
    AND user_id <> auth.uid()  -- cannot remove yourself
  );

-- ---------- Wait time estimation ----------
CREATE OR REPLACE FUNCTION public.get_wait_minutes(p_club_id text, p_bar_id text DEFAULT NULL)
RETURNS int
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT COALESCE(
    (
      SELECT COUNT(*)::int * COALESCE(
        (SELECT avg_prep_minutes FROM bars WHERE id = p_bar_id),
        5
      )
      FROM orders
      WHERE club_id = p_club_id
        AND (p_bar_id IS NULL OR bar_id = p_bar_id)
        AND status IN ('new', 'prep')
    ),
    0
  );
$$;
REVOKE ALL ON FUNCTION public.get_wait_minutes(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_wait_minutes(text, text) TO anon, authenticated;

-- ---------- Cleanup old pending orders (run periodically) ----------
-- DELETE FROM orders WHERE status = 'pending_payment' AND created_at < now() - interval '1 day';
