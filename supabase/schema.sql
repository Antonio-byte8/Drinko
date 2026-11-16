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
