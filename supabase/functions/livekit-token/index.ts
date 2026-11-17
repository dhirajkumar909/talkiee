// Supabase Edge Function (Deno): mints a LiveKit join token for a caller who
// is a verified member of the requested office. The LiveKit API secret stays
// server-side here and never reaches the browser.
//
// Deploy:   supabase functions deploy livekit-token
// Secrets:  supabase secrets set LIVEKIT_URL=wss://xxx.livekit.cloud \
//                                LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=...
import { createClient } from 'npm:@supabase/supabase-js@2';
import { AccessToken } from 'npm:livekit-server-sdk@2';

const LIVEKIT_URL = Deno.env.get('LIVEKIT_URL')!;
const LIVEKIT_API_KEY = Deno.env.get('LIVEKIT_API_KEY')!;
const LIVEKIT_API_SECRET = Deno.env.get('LIVEKIT_API_SECRET')!;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    if (!jwt) return json({ error: 'Missing Authorization' }, 401);

    const { room } = await req.json().catch(() => ({ room: null }));
    if (!room) return json({ error: 'room (office id) is required' }, 400);

    // Service-role client to verify identity + membership past RLS.
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData.user) return json({ error: 'Unauthorized' }, 401);
    const user = userData.user;

    const { data: member } = await supabase
      .from('office_members')
      .select('office_id')
      .eq('office_id', room)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!member) return json({ error: 'Not a member of this office' }, 403);

    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', user.id)
      .maybeSingle();

    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: user.id,
      name: profile?.display_name ?? 'Guest',
      ttl: '2h',
    });
    at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });

    const token = await at.toJwt();
    return json({ token, url: LIVEKIT_URL });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
