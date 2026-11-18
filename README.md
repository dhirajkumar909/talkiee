# talkiee

A platform for **persistent, designable virtual offices** with proximity-based
voice chat. Create an account, design one or more offices on a grid like a game,
invite teammates, and just walk your avatar up to someone to talk — voice
connects by proximity and fades with distance, like a real room.

## Features

- **Accounts** — email/password auth (Supabase).
- **Multiple offices per user** — owned offices + ones you've been invited to.
- **Grid office designer** — place walls, desks, chairs, meeting rooms, lounges,
  plants, rugs, doors, spawn points, and **speakers** on a snap-to-grid floor;
  resize the floor; save.
  - **Multi-select & group move** — click, Shift-click, or drag a marquee box to
    select many items, then drag any of them to move the whole group at once.
  - **Undo / redo** — full history (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Ctrl+Y).
  - **No stacking** — one object per cell (zones & rugs stay overlappable so you
    can furnish inside a room or on a rug); occupied spots show a red ghost.
  - **Customizable ranges** — set each office's **voice hearing range** and each
    **speaker's music range**, previewed live as rings on the floor.
- **Live spatial room** — move with WASD/arrows (or an **on-screen joystick on
  mobile**), see everyone in real time, and a "who's where" roster.
- **Proximity voice** — audio auto-connects to nearby people and scales volume
  with distance; walls occlude sound and meeting rooms isolate audio.
- **Speaker music** — drop speaker items and play shared, proximity-scaled music
  through them: free internet-radio stations, a **song-name search**, or any
  **YouTube video / playlist** link — synced across everyone in the office.
- **Follow a user** — click someone's avatar to auto-walk after them (pathfinds
  around walls, catches up if they dash off); click again or move to stop.
- **Personal mixing** — mute any individual person's voice or any speaker *just
  for yourself*; mute / deafen your own audio.
- **Invites** — invite any user by username; they accept/decline from their
  dashboard.

> Local listening preferences (per-person mutes, per-speaker mutes, follow) are
> yours alone — they aren't broadcast. The playing track persists per office, so
> a refresh resumes the music rather than stopping it.

## Stack

- **Frontend** — Vite + React + TypeScript, Tailwind + shadcn-style components,
  HTML5 Canvas for the floor, `lucide-react` icons, `sonner` toasts.
- **Backend** — **Supabase** (Postgres + Auth + Realtime). No custom server:
  data + auth use Supabase with Row-Level Security; movement, presence, and
  shared music state run over Supabase Realtime channels.
- **Voice** — [LiveKit](https://livekit.io) SFU, proximity-gated (see below).
- **Music** — client-side playback: internet-radio streams via `<audio>`, and
  YouTube videos/playlists via the YouTube IFrame API (volume driven by
  proximity). Song-name search uses public Piped / Invidious instances, or the
  official YouTube Data API if a key is provided.

## Setup (one-time, ~3 minutes)

1. **Create a Supabase project** at [supabase.com](https://supabase.com) (free tier is fine).
2. **Run the schema:** open `supabase/schema.sql` from this repo, paste it into
   the Supabase **SQL Editor** (left sidebar → SQL Editor → New query), and Run.
   It creates the tables, RLS policies, triggers, and invite functions.
3. **Add your keys:** copy `client/.env.example` → `client/.env` and fill in:
   ```
   VITE_SUPABASE_URL=...        # Project Settings → API → Project URL
   VITE_SUPABASE_ANON_KEY=...   # Project Settings → API → anon public key
   VITE_YT_API_KEY=...          # optional — YouTube Data API key for song search
   ```
   `VITE_YT_API_KEY` is optional: without it, song-name search falls back to
   public Piped/Invidious instances (pasting YouTube links always works).
4. **(Recommended for local dev)** In Supabase → **Authentication → Providers →
   Email**, turn **off** "Confirm email" so you can sign up and log in instantly
   without the email round-trip. (Leave it on for production.)

Until `.env` is filled, the app shows an in-app setup checklist instead of crashing.

## Voice (LiveKit SFU)

Voice runs over a [LiveKit](https://livekit.io) SFU so it scales past a handful
of people: each client publishes its mic once, and talkiee only *subscribes* to
nearby people (proximity + room isolation drive subscriptions and per-person
volume). If LiveKit isn't configured, the app still works — you just won't have
audio (movement, presence, and the editor are unaffected).

1. Create a free project at [LiveKit Cloud](https://cloud.livekit.io). Note the
   **WebSocket URL** (`wss://<you>.livekit.cloud`), **API Key**, and **API Secret**.
2. Install the Supabase CLI and link your project:
   ```bash
   npm i -g supabase
   supabase login
   supabase link --project-ref <your-project-ref>
   ```
3. Set the function secrets and deploy the token minter:
   ```bash
   supabase secrets set LIVEKIT_URL=wss://<you>.livekit.cloud \
                        LIVEKIT_API_KEY=<key> LIVEKIT_API_SECRET=<secret>
   supabase functions deploy livekit-token
   ```

The API secret lives only in the Edge Function (`supabase/functions/livekit-token`);
the browser receives a short-lived join token, and the function refuses to issue
one unless you're a verified member of that office.

## Music (speakers)

Add one or more **Speaker** items in the editor, then in the room's right panel
pick a station, type a song name, or paste a **YouTube video / playlist** link.
Playback is shared: whoever presses play broadcasts the track over the office's
realtime channel, and every client plays it locally at a volume scaled by
proximity to the nearest (non-muted) speaker — walls and meeting-room isolation
apply just like voice. Each speaker's reach is set by its own range in the
editor.

- **Radio stations** stream directly from SomaFM (live, so everyone stays in
  sync). **YouTube** videos seek late-joiners to the live position; playlists
  auto-advance and loop. No backend/"bot" — it's all in the browser.
- **Autoplay**: a remote listener's browser may hold audio until their first tap;
  the in-room *"Click to enable sound"* button resumes both voice and music.

## Run it

```bash
npm install     # once
npm run dev     # Vite dev server (http://localhost:5173)
```

Open two browser profiles/tabs, sign up as two users, have one create an office
and invite the other (by username), both **Enter** it, allow mics, and walk
toward each other with **WASD** — audio connects as you get close.

> Mics need a secure context. `localhost` works directly; to test across
> machines — or **on your phone** — serve over HTTPS via a tunnel
> (`cloudflared tunnel --url http://localhost:5173`, or ngrok) and open the
> `https://…` URL. The Vite dev server already allows common tunnel hosts, and
> mobile gets an on-screen joystick for movement.

## Project layout

```
supabase/schema.sql               Postgres schema + RLS + triggers + invite RPCs
supabase/functions/livekit-token  Edge Function: mints LiveKit join tokens
client/src/
  lib/supabase.ts            Supabase client
  lib/api.ts                 Data access (offices, members, invites, LiveKit token)
  auth/                      AuthProvider, ProtectedRoute
  pages/                     Landing, Login, Signup, Dashboard, OfficeRoom, OfficeEditor
  office/
    layout.ts                Grid model, palette, collision, zones, audio rooms,
                             pathfinding, speaker/voice ranges
    realtime.ts              Supabase channel: presence + movement + music state
    voice-livekit.ts         Proximity voice over the LiveKit SFU
    music.ts                 Speaker playback (radio <audio> + YouTube IFrame)
    stations.ts              Curated free internet-radio stations
    search.ts                Song-name → YouTube resolver (Piped/Invidious/API)
    render.ts                Canvas drawing (floor, items, avatars, rings)
  components/
    Joystick.tsx             On-screen joystick for touch/mobile
    ui/                      shadcn-style primitives (button, dialog, card, …)
```

## Data model

- `profiles` — one per user (username, display name, avatar color).
- `offices` — owner + a `layout` JSON (grid size, placed items, per-office
  `hearingRange`; speaker items carry their own `range`).
- `office_members` — who's in each office (owner/member).
- `office_invites` — pending/accepted/declined invites.

RLS ensures you only ever read offices you own or belong to.

## Roadmap ideas

- ✅ Room-based audio isolation (meeting rooms mute the outside world)
- ✅ SFU for larger groups (LiveKit — mesh no longer the bottleneck)
- ✅ Shared proximity music via placeable speakers (radio / YouTube)
- ✅ Follow another user (with wall-aware pathfinding)
- ✅ Mobile support (responsive layout + on-screen joystick)
- ✅ Editor: multi-select, group move, undo/redo, customizable ranges
- ✅ Smooth interpolation of remote avatar movement between updates
- Server-authoritative movement + interest management (for very large rooms / anti-cheat)
- Social login (Google/GitHub), real-time dashboard updates
- Screen share & video
- Camera/viewport panning for very large offices
```
