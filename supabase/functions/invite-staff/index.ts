// Creates a staff invite for a venue. Requires the caller to be an authenticated owner/manager.
// Optionally sends an email via Supabase's built-in mailer (or logs the link in dev mode).

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
  const SITE = (env.SITE_URL ?? '').replace(/\/+$/, '');
  if (!SB || !KEY) return json({ error: 'Service not configured.' }, 500);

  // Verify JWT
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Not authenticated.' }, 401);

  const userRes = await fetchFn(`${SB}/auth/v1/user`, {
    headers: { apikey: KEY, Authorization: `Bearer ${token}` },
  });
  const user = await userRes.json();
  if (!userRes.ok || !user?.id) return json({ error: 'Invalid session.' }, 401);
  const userId: string = user.id;

  let body: { club_id?: string; email?: string; role?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid request.' }, 400); }

  const clubId = String(body?.club_id ?? '');
  const email = String(body?.email ?? '').trim().toLowerCase();
  const role = body?.role ?? 'barista';

  if (!clubId || !email || !['barista', 'manager'].includes(role as string)) {
    return json({ error: 'Invalid parameters.' }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Invalid email address.' }, 400);

  const sb = (path: string, init: RequestInit = {}) =>
    fetchFn(`${SB}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });

  // Check caller has owner/manager access to this club
  const staffCheck = await (await sb(`staff?user_id=eq.${userId}&club_id=eq.${clubId}&role=in.(owner,manager)&select=role`)).json();
  if (!Array.isArray(staffCheck) || !staffCheck.length) {
    return json({ error: 'Not authorised.' }, 403);
  }

  // Create invite
  const invRes = await sb('venue_invites', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ club_id: clubId, email, role }),
  });
  const invite = (await invRes.json())?.[0];
  if (!invRes.ok || !invite) return json({ error: 'Could not create invite.' }, 500);

  const inviteUrl = `${SITE}/venue/accept-invite.html?token=${invite.token}`;

  // Try to send email via Supabase auth invite (best-effort)
  try {
    await fetchFn(`${SB}/auth/v1/invite`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, data: { invite_url: inviteUrl, club_id: clubId, role } }),
    });
  } catch { /* email is best-effort; link is returned anyway */ }

  console.log('Invite link (dev):', inviteUrl);
  return json({ invite_id: invite.id, url: inviteUrl });
}

// @ts-ignore: Deno exists only on Supabase
if (typeof Deno !== 'undefined') Deno.serve((req: Request) => handle(req, Deno.env.toObject()));
