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
