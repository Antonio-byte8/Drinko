# Drinko

Customers order drinks by scanning a QR code and pay from their phone — no queuing at the bar.

**Business model:** Free for venues. Drinko charges customers €0.40/order service fee via Stripe Connect.

---

## Running locally

```bash
npm start
```

The first time, it creates a `.env` file for you. Fill it in (see below), then run `npm start` again. It opens the browser automatically.

**URLs:**
| Page | URL |
|------|-----|
| Customer app | `http://localhost:3000/?club=YOUR_VENUE_ID` |
| Bar staff | `http://localhost:3000/bar.html` |
| Venue portal | `http://localhost:3000/venue/` |
| QR generator | `http://localhost:3000/qr.html` |

---

## First-time setup (one-off, ~15 minutes)

### 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) → New project
2. Note your **Project URL** and **anon key** (Settings → API)
3. Note your **Service Role key** (Settings → API → keep secret)

### 2. Run the database schema

In Supabase → SQL Editor, run these two files in order:
1. `supabase/schema.sql`
2. `supabase/schema_v2.sql`

### 3. Fill in .env

```bash
cp .env.example .env
# Then open .env and fill in:
#   SUPABASE_URL
#   SUPABASE_ANON_KEY
#   SUPABASE_SERVICE_ROLE_KEY
#   STRIPE_SECRET_KEY
#   STRIPE_WEBHOOK_SECRET
#   SITE_URL (use http://localhost:3000 for local dev)
#   ADMIN_KEY (invent a secret string)
```

### 4. Deploy Supabase Edge Functions

```bash
# Install Supabase CLI first: https://supabase.com/docs/guides/cli
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF

# Set env vars on the functions
npx supabase secrets set \
  STRIPE_SECRET_KEY=sk_test_... \
  STRIPE_WEBHOOK_SECRET=whsec_... \
  SITE_URL=http://localhost:3000 \
  ADMIN_KEY=your-secret

# Deploy all functions
npm run deploy:functions
```

### 5. Create a Stripe account and enable Connect

1. Go to [dashboard.stripe.com](https://dashboard.stripe.com) → Connect → Get started
2. Set Connect type to **Standard**
3. In Developers → Webhooks, add the endpoint:
   `https://YOUR_PROJECT.supabase.co/functions/v1/stripe-webhook`
   Listen for: `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`
4. Copy the webhook signing secret to `STRIPE_WEBHOOK_SECRET`

---

## Venue setup (per nightclub)

1. Venue owner goes to `/venue/` → creates account → creates venue
2. Connect Stripe via Settings → the owner enters their documents and IBAN on Stripe
3. Add menu items and bar areas
4. Print QR codes → stick on tables

---

## Project structure

```
web/
  index.html      Customer app (menu → cart → pay → track)
  bar.html        Bar staff view (Kanban, refunds, availability)
  venue/          Venue self-service portal
    index.html    Dashboard + login
    menu.html     Manage drinks
    bars.html     Configure bar areas
    qr.html       Generate QR codes
    setup.html    Stripe + settings
    staff.html    Invite staff
  style.css       Design system (dark theme)
  config.js       Supabase URL + anon key (auto-written by npm start)
supabase/
  schema.sql      Database (run once)
  schema_v2.sql   Migration (run after schema.sql)
  functions/      Supabase Edge Functions (Deno/TypeScript)
scripts/
  start.mjs       Local dev launcher
```
