// Creates a new venue (club + staff row with role='owner') for an authenticated user.
// Called by the venue portal signup flow. Requires a valid Supabase JWT.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

type Env = Record<string, string | undefined>;

export async function handle(req: Request, env: Env, fetchFn: typeof fetch = fetch): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const SB = env.SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SB || !KEY) return json({ error: 'Service not configured.' }, 500);

  // Verify JWT and get user_id
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Not authenticated.' }, 401);

  const userRes = await fetchFn(`${SB}/auth/v1/user`, {
    headers: { apikey: KEY, Authorization: `Bearer ${token}` },
  });
  const user = await userRes.json();
  if (!userRes.ok || !user?.id) return json({ error: 'Invalid session.' }, 401);
  const userId: string = user.id;

  let body: { name?: string; slug?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid request.' }, 400); }

  const name = String(body?.name ?? '').trim();
  const slug = String(body?.slug ?? '').trim().toLowerCase();

  if (!name || name.length > 60) return json({ error: 'Venue name must be 1–60 characters.' }, 400);
  if (!/^[a-z0-9-]{2,30}$/.test(slug)) return json({ error: 'Venue ID must be 2–30 lowercase letters, numbers, or hyphens.' }, 400);

  const sb = (path: string, init: RequestInit = {}) =>
    fetchFn(`${SB}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });

  // Rate limit: user can't already be in a venue
  const existingStaff = await (await sb(`staff?user_id=eq.${userId}&select=club_id`)).json();
  if (Array.isArray(existingStaff) && existingStaff.length > 0) {
    return json({ error: 'You already have a venue.' }, 409);
  }

  // Check slug is free
  const existing = await (await sb(`clubs?id=eq.${slug}&select=id`)).json();
  if (Array.isArray(existing) && existing.length > 0) {
    return json({ error: 'That venue ID is already taken. Try a different one.' }, 409);
  }

  // Create club
  const clubRes = await sb('clubs', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ id: slug, name, service_fee_cents: 40 }),
  });
  const club = (await clubRes.json())?.[0];
  if (!clubRes.ok || !club) return json({ error: 'Could not create venue. Please try again.' }, 500);

  // Create staff row with role='owner'
  const staffRes = await sb('staff', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ user_id: userId, club_id: slug, role: 'owner' }),
  });
  if (!staffRes.ok) {
    // Rollback: delete the club
    await sb(`clubs?id=eq.${slug}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    return json({ error: 'Could not set up staff access. Please try again.' }, 500);
  }

  return json({ club_id: slug, name });
}

// @ts-ignore: Deno exists only on Supabase
if (typeof Deno !== 'undefined') Deno.serve((req: Request) => handle(req, Deno.env.toObject()));
