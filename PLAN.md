# Drinko — MVP Plan

## 1. MVP Scope

### In scope (demo-ready)
- Customer flow: QR scan → menu → cart → Stripe payment → live order status → notification when ready → pick up at bar X/Y/Z
- Venue self-service portal: sign up, configure menu (UI-based), manage multiple bar areas, generate QR codes, connect Stripe, see live orders
- Bar staff view: per-bar kanban board (new → prep → ready → done), availability toggle, refund
- Estimated wait time: shown to customer based on queue depth + configurable avg prep time
- Multi-bar support: venues can define 2+ named bar areas; each order is routed to a specific bar; customer sees which bar to collect from
- QR codes: one per table (linking to menu + table number), one per bar area (for walk-up orders)

### Out of scope for MVP
- Mobile native app (PWA optional but web-first)
- Venue-to-venue analytics / Drinko admin dashboard
- Loyalty / tab system
- Pre-ordering before arriving
- Table service (staff delivering to tables) — routing logic deferred
- Multi-language admin portal (EN for demos is enough)

---

## 2. Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Frontend | Vanilla JS + HTML/CSS | No build step, fast to iterate, already working |
| Database | Supabase (Postgres) | Already set up, RLS works well |
| Auth | Supabase Auth | Email/password for venue owners + staff |
| Realtime | Supabase polling (4s) | Simple, no websocket complexity for MVP |
| Edge functions | Supabase Deno functions | Stripe logic lives server-side |
| Payments | Stripe Connect (Standard) | Already working, application_fee_amount |
| Hosting | Static files (Netlify / Vercel / GitHub Pages) | Zero infra |
| QR codes | qr-lib.js (client-side) | Already working |

**No framework change needed.** The existing pattern is clean enough for MVP.

---

## 3. Database Schema Changes

### Fix: service fee default
```sql
ALTER TABLE clubs ALTER COLUMN service_fee_cents SET DEFAULT 40;
```

### New: bars table
```sql
CREATE TABLE IF NOT EXISTS bars (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{2,40}$'),
  club_id text NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  avg_prep_minutes int NOT NULL DEFAULT 5 CHECK (avg_prep_minutes BETWEEN 1 AND 30),
  sort int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true
);
-- RLS
ALTER TABLE bars ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON bars TO anon, authenticated;
CREATE POLICY bars_public_read ON bars FOR SELECT TO anon, authenticated USING (active);
GRANT UPDATE (avg_prep_minutes, active) ON bars TO authenticated;
CREATE POLICY bars_staff_update ON bars FOR UPDATE TO authenticated
  USING (club_id IN (SELECT club_id FROM staff WHERE user_id = auth.uid()))
  WITH CHECK (club_id IN (SELECT club_id FROM staff WHERE user_id = auth.uid()));
```

### Add: bar_id to orders
```sql
ALTER TABLE orders ADD COLUMN IF NOT EXISTS bar_id text REFERENCES bars(id);
```

### Add: role to staff
```sql
ALTER TABLE staff ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'barista'
  CHECK (role IN ('owner', 'manager', 'barista'));
```

### New: venue_invites table (for inviting staff)
```sql
CREATE TABLE IF NOT EXISTS venue_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id text NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'barista' CHECK (role IN ('owner', 'manager', 'barista')),
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days'
);
```

### New: wait time estimation function
```sql
CREATE OR REPLACE FUNCTION public.get_wait_minutes(p_club_id text, p_bar_id text)
RETURNS int
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT COALESCE(
    (SELECT COUNT(*)::int * b.avg_prep_minutes
     FROM orders o
     JOIN bars b ON b.id = p_bar_id
     WHERE o.club_id = p_club_id
       AND o.bar_id = p_bar_id
       AND o.status IN ('new', 'prep')
    ),
    0
  );
$$;
GRANT EXECUTE ON FUNCTION public.get_wait_minutes(text, text) TO anon, authenticated;
```

---

## 4. Pages to Build

### P0 — Must for demo

| File | Description | Status |
|------|-------------|--------|
| `web/index.html` | Customer app — needs bar_id in order, estimated wait | Exists, needs update |
| `web/bar.html` | Bar staff view — needs bar selector, English | Exists, needs update |
| `web/venue/index.html` | Venue portal home (login + dashboard) | **Build** |
| `web/venue/menu.html` | Menu management UI (add/edit/delete items, toggle availability) | **Build** |
| `web/venue/bars.html` | Configure bar areas (name, avg prep time) | **Build** |
| `web/venue/qr.html` | Generate & print QR codes (integrated, per venue+bar) | **Build** (refactor qr.html) |
| `web/venue/setup.html` | Stripe Connect onboarding + venue settings | **Build** |
| `web/venue/staff.html` | Invite/manage staff accounts | **Build** |
| `supabase/schema.sql` | Add bars, role, invites, fix fee default | Update |

### P1 — Good to have for demos

| File | Description |
|------|-------------|
| `web/venue/analytics.html` | Revenue + order analytics (last 7/30 days) |
| `web/venue/orders.html` | Full order history with filter/export |
| PWA manifest + service worker | Installable on phone |
| `web/landing.html` | Drinko marketing/pitch page for outreach |

---

## 5. Edge Function Changes

### Modify: `create-checkout`
- Accept `bar_id` in request body
- Validate `bar_id` belongs to `club_id`
- Store `bar_id` on the order

### New: `venue-register`
- Creates a new club + Supabase Auth user (venue owner)
- Sends email verification via Supabase
- Protected by rate limiting (not admin key — public endpoint)

### New: `invite-staff`
- Creates a `venue_invites` row
- Sends invite email (Supabase email or Resend)
- Only callable by authenticated owner/manager

### New: `accept-invite`
- Called when staff member clicks invite link
- Creates Supabase Auth user (or links existing)
- Creates `staff` row with role

### Modify: `admin-menu`
- Keep for internal use
- Also expose a venue-auth version for self-service menu updates

---

## 6. Venue Owner UX Flow

```
1. Visit drinko.app/venue → Sign up (email + password)
2. Create venue: name, short ID (slug), city
3. Connect Stripe → Stripe Connect onboarding (documents + IBAN)
4. Create bar areas: "Main Bar", "Rooftop Bar" (name + avg prep time)
5. Build menu: category → item (name, description, price, photo optional)
6. Generate QR codes → Print sheet (one per table + one per bar)
7. Invite staff: bartenders get emailed a link → they log in → see only bar.html
8. Go live: paste QRs on tables → customers start ordering
```

---

## 7. Customer UX Flow

```
1. Scan QR code on table or bar area
2. App loads: venue name + menu (filtered by category)
3. Add drinks to cart
4. Tap "Go to payment" → see order summary + €0.40 service fee
5. Choose delivery: "To my table" or "Pick up at [Bar Name]"
6. See estimated wait time: "~8 min (3 orders ahead)"
7. Confirm age (18+) → Stripe Checkout (card / Apple Pay / Google Pay)
8. Return to app → order status screen with live updates
9. Notification (sound + vibration) when status = "ready"
10. Collect drink at the right bar, show order number #XXX
```

---

## 8. Bugs / Issues to Fix

| Issue | File | Fix |
|-------|------|-----|
| `service_fee_cents` default is 49, should be 40 | schema.sql | `ALTER TABLE clubs ALTER COLUMN service_fee_cents SET DEFAULT 40` |
| `bar.html` is entirely in Italian | bar.html | Add EN strings + language toggle |
| `admin.html` is unusable by venues | admin.html | Keep as internal tool, build separate venue portal |
| No bar selector in bar staff view | bar.html | Add bar dropdown when venue has 2+ bars |
| Order number resets across nights | schema.sql | Sequence is per-deploy, not per-night — OK for now |
| `mode: 'bancone'` hardcoded, no named bar | index.html | Add `bar_id` to order payload + display bar name |
| No self-service signup for venues | — | Build `venue-register` edge function + venue/index.html |
| Menu IDs are `${clubId}-m1`, `${clubId}-m2` — replace on re-upload | admin-menu/index.ts | Use `merge-duplicates` (already done), fine for now |

---

## 9. Demo Checklist

Before showing to a nightclub:

- [ ] Venue can sign up without calling us
- [ ] Venue can connect Stripe in < 5 min
- [ ] Venue can create menu: 3 categories, 10+ items, with prices
- [ ] 2 bar areas configured: "Main Bar", "Rooftop Bar"
- [ ] QR codes printable as a sheet (A4)
- [ ] Customer scans QR → sees menu in < 2s
- [ ] Cart + payment flow works end-to-end (use Stripe test mode)
- [ ] Order appears in bar.html within 5s of payment
- [ ] Bar staff can advance order: new → prep → ready → done
- [ ] Customer phone receives "ready" notification (sound + vibration)
- [ ] Customer sees which bar to collect from
- [ ] Estimated wait time visible before paying
- [ ] Drink availability toggle works (item disappears from customer menu)
- [ ] Refund flow works (bar staff can cancel + refund)
- [ ] Works on iPhone Safari + Android Chrome
- [ ] Drinko fee (€0.40) is visible in Stripe dashboard

---

## 10. File Structure

```
Drinko/
├── web/
│   ├── index.html          # Customer app
│   ├── bar.html            # Bar staff view (per bar)
│   ├── qr.html             # QR generator (internal/legacy)
│   ├── admin.html          # Internal Drinko admin
│   ├── privacy.html        # Legal
│   ├── style.css           # Shared design system
│   ├── config.js           # Supabase URL + anon key
│   ├── art.js              # SVG drink illustrations
│   ├── qr-lib.js           # QR code library
│   └── venue/
│       ├── index.html      # Venue portal login + dashboard
│       ├── menu.html       # Menu management
│       ├── bars.html       # Bar area configuration
│       ├── qr.html         # QR code generator (venue self-service)
│       ├── setup.html      # Stripe onboarding + settings
│       ├── staff.html      # Staff management + invites
│       └── analytics.html  # Revenue dashboard (P1)
├── supabase/
│   ├── schema.sql          # Full schema (run once + migrations)
│   ├── seed.sql            # Sample data for demos
│   └── functions/
│       ├── create-checkout/    # Stripe checkout (add bar_id)
│       ├── stripe-webhook/     # Payment confirmation
│       ├── refund-order/       # Refund
│       ├── admin-menu/         # Internal menu admin
│       ├── connect-link/       # Stripe Connect onboarding
│       ├── venue-register/     # NEW: self-service venue signup
│       ├── invite-staff/       # NEW: invite staff member
│       └── accept-invite/      # NEW: accept staff invite
├── tests/
│   ├── functions.test.mjs
│   ├── qr.test.mjs
│   └── ui.test.mjs
├── PLAN.md                 # This file
├── README.md               # Setup guide
└── GUIDA.html              # Step-by-step configuration guide
```

---

## 11. Architecture Decisions

**Q: Should venues manage their own menu without calling Drinko?**
Yes — build a full self-service venue portal. The current admin.html stays as an internal tool.

**Q: Stripe Connect Standard vs Express?**
Keep Standard — venues get their own Stripe dashboard, handle disputes themselves. Less support burden for Drinko.

**Q: Real-time orders via Supabase Realtime or polling?**
Keep polling (3-4s) for MVP. Supabase Realtime adds complexity; polling is reliable and already tested.

**Q: Single-page app or multi-page?**
Keep multi-page (each HTML file is a page). No build step, easy to link, works with Supabase auth tokens in localStorage.

**Q: How does venue portal auth work?**
Supabase Auth email/password. Venue owner registers → gets JWT → stored in localStorage → used in all API calls. Same pattern as bar.html already uses.
