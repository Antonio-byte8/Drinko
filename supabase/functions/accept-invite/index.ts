// Accepts a staff invite: links the logged-in user to the venue with the invited role.
// The caller must be authenticated AND their account email must match the invited email.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

type Env = Record<string, string | undefined>;

export async function handle(req: Request, env: Env, fetchFn: typeof fetch = fetch, now: number = Date.now()): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const SB = env.SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SB || !KEY) return json({ error: 'Service not configured.' }, 500);

  // Verify JWT
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Not authenticated.' }, 401);

  const userRes = await fetchFn(`${SB}/auth/v1/user`, {
    headers: { apikey: KEY, Authorization: `Bearer ${token}` },
  });
  const user = await userRes.json();
  if (!userRes.ok || !user?.id) return json({ error: 'Invalid session.' }, 401);
  const userId: string = user.id;
  const userEmail = String(user.email ?? '').trim().toLowerCase();

  let body: { token?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  const inviteToken = String(body?.token ?? '').trim();
  if (!/^[a-f0-9]{16,64}$/.test(inviteToken)) return json({ error: 'Invalid invite link.' }, 400);

  const sb = (path: string, init: RequestInit = {}) =>
    fetchFn(`${SB}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });

  // Look up the invite
  const rows = await (await sb(`venue_invites?token=eq.${inviteToken}&select=id,club_id,email,role,used_at,expires_at`)).json();
  const invite = Array.isArray(rows) ? rows[0] : null;
  if (!invite) return json({ error: 'This invite link is not valid.' }, 404);
  if (invite.used_at) return json({ error: 'This invite has already been used.' }, 410);
  if (new Date(invite.expires_at).getTime() < now) return json({ error: 'This invite has expired. Ask for a new one.' }, 410);

  // The invite is tied to one email address
  if (!userEmail || userEmail !== String(invite.email).trim().toLowerCase()) {
    return json({ error: 'This invite was sent to a different email address. Sign in with the invited email.' }, 403);
  }

  // One venue per account
  const existing = await (await sb(`staff?user_id=eq.${userId}&select=club_id`)).json();
  if (Array.isArray(existing) && existing.length > 0) {
    return json({ error: 'This account already belongs to a venue.' }, 409);
  }

  // Claim the invite first (only succeeds if still unused), so it cannot be accepted twice
  const claim = await sb(`venue_invites?id=eq.${invite.id}&used_at=is.null`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ used_at: new Date(now).toISOString() }),
  });
  const claimed = await claim.json();
  if (!claim.ok || !Array.isArray(claimed) || !claimed.length) {
    return json({ error: 'This invite has already been used.' }, 410);
  }

  // Create the staff row
  const staffRes = await sb('staff', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ user_id: userId, club_id: invite.club_id, role: invite.role }),
  });
  if (!staffRes.ok) {
    // Release the invite so it can be retried
    await sb(`venue_invites?id=eq.${invite.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ used_at: null }),
    });
    return json({ error: 'Could not join the venue. Please try again.' }, 500);
  }

  return json({ club_id: invite.club_id, role: invite.role });
}

// @ts-ignore: Deno exists only on Supabase
if (typeof Deno !== 'undefined') Deno.serve((req: Request) => handle(req, Deno.env.toObject()));
