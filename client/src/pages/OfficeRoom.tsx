import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Headphones,
  HeadphoneOff,
  Footprints,
  Mic,
  MicOff,
  Music,
  Pencil,
  Square,
  Users,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { getOffice, getLivekitToken } from '../lib/api';
import type { MusicState, Office, PresenceState } from '../types';
import { OfficeChannel } from '../office/realtime';
import { LiveKitVoice } from '../office/voice-livekit';
import { SpeakerAudio, parseYouTubeId, parseYouTubePlaylistId } from '../office/music';
import { searchSong } from '../office/search';
import { STATIONS } from '../office/stations';
import {
  drawFloor,
  drawAvatars,
  drawSpeakerPulses,
  drawMutedSpeakers,
  highlightRoom,
} from '../office/render';
import {
  AVATAR_RADIUS,
  CELL,
  MOVE_SPEED_PX,
  audioDistance,
  findPath,
  hasSpeaker,
  lineBlockedBySolids,
  resolveMove,
  roomAt,
  spawnPoint,
  speakerAt,
  speakerVolumeAt,
  voiceRanges,
  zoneLabelAt,
} from '../office/layout';
import { Button } from '../components/ui/button';
import { Avatar } from '../components/ui/avatar';
import { Badge } from '../components/ui/badge';
import { Joystick } from '../components/Joystick';
import { ThemeToggle } from '../components/ThemeToggle';
import { cn } from '../lib/utils';

/** How close (px) to trail behind someone you're following. */
const FOLLOW_GAP = CELL * 0.9;
/**
 * Max follow speed (px/frame). Faster than normal movement so a follower can
 * *catch up* and close any gap that opens when the target's position arrives
 * late/teleports — otherwise, moving at the same speed, the lag never shrinks
 * and they drift out of earshot.
 */
const FOLLOW_MAX_SPEED = MOVE_SPEED_PX * 5.75;
/** Beyond this gap (px), snap straight to the target rather than crawl after it. */
const FOLLOW_SNAP_DIST = CELL * 14;

const musicKey = (officeId: string) => `talkiee:music:${officeId}`;

function saveMusic(officeId: string, state: MusicState) {
  try {
    localStorage.setItem(musicKey(officeId), JSON.stringify(state));
  } catch {
    /* storage unavailable (private mode / quota) — non-fatal */
  }
}

function loadSavedMusic(officeId: string): MusicState | null {
  try {
    const raw = localStorage.getItem(musicKey(officeId));
    return raw ? (JSON.parse(raw) as MusicState) : null;
  } catch {
    return null;
  }
}

export function OfficeRoom() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [office, setOffice] = useState<Office | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [micOk, setMicOk] = useState(false);
  const [muted, setMuted] = useState(true);
  const [roster, setRoster] = useState<
    {
      id: string;
      name: string;
      color: string;
      zone: string;
      connected: boolean;
      muted: boolean;
      deafened: boolean;
    }[]
  >([]);
  const [inRoom, setInRoom] = useState<string | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [showRoster, setShowRoster] = useState(false);
  const [music, setMusic] = useState<MusicState>({
    playing: false,
    kind: 'stream',
    src: '',
    name: '',
    by: '',
    startedAt: 0,
  });
  const [nowPlaying, setNowPlaying] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [searching, setSearching] = useState(false);
  const [mutedSpeakers, setMutedSpeakers] = useState<Set<string>>(new Set());
  const [speakerVolumes, setSpeakerVolumes] = useState<Map<string, number>>(new Map());
  const [mutedPeers, setMutedPeers] = useState<Set<string>>(new Set());
  const [following, setFollowing] = useState<string | null>(null);
  const followingRef = useRef<string | null>(null);
  useEffect(() => {
    followingRef.current = following;
  }, [following]);
  // Cached follow path (pixel waypoints) + when it was last recomputed.
  const pathRef = useRef<{ x: number; y: number }[]>([]);
  const lastPathAt = useRef(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playersRef = useRef<Map<string, PresenceState>>(new Map());
  const keysRef = useRef<Set<string>>(new Set());
  const touchDirRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const channelRef = useRef<OfficeChannel | null>(null);
  const voiceRef = useRef<LiveKitVoice | null>(null);
  const musicRef = useRef<SpeakerAudio | null>(null);
  const connectedRef = useRef<Set<string>>(new Set());
  const officeRef = useRef<Office | null>(null);
  const lastEmit = useRef(0);
  const lastFrame = useRef(0);
  const micOkRef = useRef(false);
  const deafenedRef = useRef(false);
  const musicPlayingRef = useRef(false);
  useEffect(() => {
    musicPlayingRef.current = music.playing;
  }, [music.playing]);
  // Per-user, per-speaker local mutes (read by the render + proximity loops).
  const mutedSpeakersRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    mutedSpeakersRef.current = mutedSpeakers;
  }, [mutedSpeakers]);
  const speakerVolumesRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    speakerVolumesRef.current = speakerVolumes;
  }, [speakerVolumes]);
  // True once a peer has told us what's playing — suppresses the localStorage
  // restore so we don't revive a song others have already moved on from.
  const musicReceivedRef = useRef(false);
  useEffect(() => {
    micOkRef.current = micOk;
  }, [micOk]);
  useEffect(() => {
    deafenedRef.current = deafened;
  }, [deafened]);

  // Toggle mic mute. Deafen couples the mic (deafen → mute, undeafen → unmute
  // if a mic is available), mirroring Discord. Effects below sync the voice layer.
  const toggleMute = useCallback(() => {
    if (deafenedRef.current || !micOkRef.current) return;
    void voiceRef.current?.resumeAudio();
    setMuted((m) => !m);
  }, []);

  const toggleDeafen = useCallback(() => {
    void voiceRef.current?.resumeAudio();
    setDeafened((d) => {
      const next = !d;
      setMuted(next ? true : !micOkRef.current);
      return next;
    });
  }, []);

  // Keyboard shortcuts: M = mute, Shift+M = deafen (avoids the WASD movement keys).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key.toLowerCase() === 'm') {
        e.preventDefault();
        if (e.shiftKey) toggleDeafen();
        else toggleMute();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleMute, toggleDeafen]);

  // Load the office record.
  useEffect(() => {
    if (!id) return;
    getOffice(id)
      .then((o) => {
        setOffice(o);
        officeRef.current = o;
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not open office'));
  }, [id]);

  // Set up realtime + voice exactly once, when office + profile are ready.
  // Gating on this one-shot boolean (not the office/profile objects) prevents
  // React re-renders from re-running the effect and thrashing the channel/SFU.
  const ready = Boolean(office && profile && id);
  useEffect(() => {
    if (!office || !profile || !id) return;

    const spawn = spawnPoint(office.layout);
    const me: PresenceState = {
      userId: profile.id,
      name: profile.display_name,
      color: profile.color,
      x: spawn.x,
      y: spawn.y,
    };
    playersRef.current.set(me.userId, { ...me });

    const voice = new LiveKitVoice();
    voice.onConnectedChange = (ids) => (connectedRef.current = new Set(ids));
    voice.onAudioBlocked = (blocked) => setAudioBlocked(blocked);
    const vr = voiceRanges(office.layout);
    voice.setRanges(vr.hearing, vr.full);
    voiceRef.current = voice;

    const musicPlayer = new SpeakerAudio();
    musicPlayer.onBlocked = (blocked) => blocked && setAudioBlocked(true);
    musicPlayer.onTitle = (title) => setNowPlaying(title);
    musicRef.current = musicPlayer;

    // Fetch a LiveKit token from the Edge Function, connect to the SFU, publish mic.
    (async () => {
      try {
        const { token, url } = await getLivekitToken(id);
        await voice.connect(url, token);
        const ok = await voice.enableMic();
        setMicOk(ok);
        setMuted(!ok);
        await voice.setMuted(!ok);
      } catch (err) {
        console.warn('Voice unavailable:', err);
        setMicOk(false);
        toast.error('Voice is unavailable (LiveKit not configured). You can still move and see others.');
      }
    })();

    const channel = new OfficeChannel(id, me, {
      onRoster: (states) => {
        const present = new Set(states.map((s) => s.userId));
        for (const uid of [...playersRef.current.keys()]) {
          if (uid !== me.userId && !present.has(uid)) playersRef.current.delete(uid);
        }
        for (const s of states) {
          if (s.userId === me.userId) continue;
          const existing = playersRef.current.get(s.userId);
          if (existing) {
            existing.name = s.name;
            existing.color = s.color;
          } else {
            playersRef.current.set(s.userId, { ...s });
          }
        }
      },
      onMove: ({ userId, x, y }) => {
        const p = playersRef.current.get(userId);
        if (p) {
          p.x = x;
          p.y = y;
        }
      },
      // WebRTC signaling is handled by LiveKit now; this stays a no-op.
      onSignal: () => {},
      onMusic: (state) => {
        musicReceivedRef.current = true;
        setMusic(state);
        setNowPlaying(state.playing ? state.name : '');
        musicRef.current?.play(state);
        saveMusic(id, state);
      },
      onStatus: ({ userId, muted: m, deafened: d }) => {
        const p = playersRef.current.get(userId);
        if (p) {
          p.muted = m;
          p.deafened = d;
        }
      },
    });
    channelRef.current = channel;
    musicReceivedRef.current = false;
    void channel.join();

    // Resume music after a refresh. Give peers a moment to re-broadcast the
    // current song; if none does (e.g. you're alone), restore the last-known
    // state we persisted locally so it doesn't just stop.
    const restoreTimer = window.setTimeout(() => {
      if (musicReceivedRef.current) return;
      const saved = loadSavedMusic(id);
      if (saved?.playing && saved.src) {
        setMusic(saved);
        setNowPlaying(saved.name);
        musicRef.current?.play(saved);
        channelRef.current?.sendMusic(saved);
      }
    }, 1500);

    return () => {
      window.clearTimeout(restoreTimer);
      void channel.leave();
      void voice.destroy();
      musicPlayer.destroy();
      channelRef.current = null;
      voiceRef.current = null;
      musicRef.current = null;
      playersRef.current.clear();
      connectedRef.current.clear();
    };
    // Only (re)run when readiness flips — never on object-identity churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  useEffect(() => {
    void voiceRef.current?.setMuted(muted);
  }, [muted]);

  useEffect(() => {
    voiceRef.current?.setDeafened(deafened);
    musicRef.current?.setDeafened(deafened);
  }, [deafened]);

  useEffect(() => {
    voiceRef.current?.setMutedPeers(mutedPeers);
  }, [mutedPeers]);

  // Broadcast our own mute/deafen so others see it on our avatar + roster, and
  // reflect it on our own local entry too.
  useEffect(() => {
    const me = profile ? playersRef.current.get(profile.id) : undefined;
    if (me) {
      me.muted = muted;
      me.deafened = deafened;
    }
    channelRef.current?.sendStatus(muted, deafened);
  }, [muted, deafened, ready, profile]);

  // Mute or unmute another person's voice — just for yourself.
  const togglePeerMute = useCallback((userId: string) => {
    setMutedPeers((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }, []);

  // Change the shared speaker music: play locally + broadcast to the office.
  const changeMusic = useCallback(
    (kind: MusicState['kind'], src: string, name: string) => {
      if (!profile) return;
      void voiceRef.current?.resumeAudio();
      const state: MusicState = {
        playing: Boolean(src),
        kind,
        src,
        name,
        by: profile.id,
        startedAt: Date.now(),
      };
      setMusic(state);
      setNowPlaying(src ? name : '');
      musicRef.current?.play(state);
      channelRef.current?.sendMusic(state);
      saveMusic(id!, state);
    },
    [profile, id],
  );

  // The box accepts a YouTube link/id, a direct audio stream URL, or — anything
  // else — a song name, which we resolve to the top YouTube match and play.
  const playCustom = useCallback(async () => {
    const input = customUrl.trim();
    if (!input || searching) return;

    // A playlist link (…?list=…) wins over a single-video id on the same URL.
    const playlistId = parseYouTubePlaylistId(input);
    if (playlistId) {
      changeMusic('youtube_playlist', playlistId, 'YouTube playlist');
      setCustomUrl('');
      return;
    }
    const ytId = parseYouTubeId(input);
    if (ytId) {
      changeMusic('youtube', ytId, 'YouTube');
      setCustomUrl('');
      return;
    }
    if (/^https?:\/\//i.test(input)) {
      changeMusic('stream', input, 'Custom stream');
      setCustomUrl('');
      return;
    }

    // Treat as a song name → search YouTube.
    setSearching(true);
    try {
      const res = await searchSong(input);
      if (res) {
        changeMusic('youtube', res.id, res.title);
        setCustomUrl('');
      } else {
        toast.error('No match found — try pasting a YouTube link instead.');
      }
    } catch {
      toast.error('Search failed — try pasting a YouTube link instead.');
    } finally {
      setSearching(false);
    }
  }, [customUrl, searching, changeMusic]);

  const stopMusic = useCallback(() => changeMusic('stream', '', ''), [changeMusic]);

  // Per-speaker local volume (0..1) + mute — just for yourself.
  const setSpeakerVolume = useCallback((speakerId: string, v: number) => {
    setSpeakerVolumes((prev) => {
      const next = new Map(prev);
      next.set(speakerId, v);
      return next;
    });
  }, []);
  const toggleSpeakerMute = useCallback((speakerId: string) => {
    setMutedSpeakers((prev) => {
      const next = new Set(prev);
      if (next.has(speakerId)) next.delete(speakerId);
      else next.add(speakerId);
      return next;
    });
  }, []);

  // Find another player whose avatar is at a canvas point (for follow).
  const playerAt = useCallback(
    (px: number, py: number): string | null => {
      let bestId: string | null = null;
      let bestD = AVATAR_RADIUS + 10;
      for (const [uid, p] of playersRef.current) {
        if (uid === profile?.id) continue;
        const d = Math.hypot(px - p.x, py - p.y);
        if (d <= bestD) {
          bestD = d;
          bestId = uid;
        }
      }
      return bestId;
    },
    [profile?.id],
  );

  // Click/tap the floor: an avatar toggles follow; a speaker toggles mute (yours).
  const onCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      const layout = officeRef.current?.layout;
      if (!canvas || !layout) return;
      const rect = canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) * (canvas.width / rect.width);
      const py = (e.clientY - rect.top) * (canvas.height / rect.height);

      const hitUser = playerAt(px, py);
      if (hitUser) {
        setFollowing((cur) => (cur === hitUser ? null : hitUser));
        return;
      }

      const hit = speakerAt(layout, px, py);
      if (!hit) return;
      void voiceRef.current?.resumeAudio();
      void musicRef.current?.resume();
      setMutedSpeakers((prev) => {
        const next = new Set(prev);
        if (next.has(hit.id)) next.delete(hit.id);
        else next.add(hit.id);
        return next;
      });
    },
    [playerAt],
  );

  // Keyboard.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      keysRef.current.add(e.key.toLowerCase());
    };
    const up = (e: KeyboardEvent) => keysRef.current.delete(e.key.toLowerCase());
    const blur = () => keysRef.current.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // Proximity + roster refresh (every 250ms). Presence is tracked once on
  // join — never on a timer — because repeated track() drops the channel.
  useEffect(() => {
    if (!profile) return;
    const interval = setInterval(() => {
      const layout = officeRef.current?.layout;
      const me = playersRef.current.get(profile.id);
      if (!me || !layout) return;

      const distances = new Map<string, number>();
      for (const [uid, p] of playersRef.current) {
        if (uid === profile.id) continue;
        // audioDistance applies room isolation: 0 (same room), Infinity
        // (blocked by a room boundary), or physical distance on open floor.
        distances.set(uid, audioDistance(layout, me, p));
      }
      voiceRef.current?.updateProximity(distances);

      // Speaker music: loudest audible speaker wins, each with its own range
      // (ones this user muted are skipped).
      musicRef.current?.setProximityVolume(
        speakerVolumeAt(layout, me, mutedSpeakersRef.current, speakerVolumesRef.current),
      );

      const myRoom = roomAt(layout, me.x, me.y);
      setInRoom(myRoom ? myRoom.label ?? 'Meeting Room' : null);

      const connected = connectedRef.current;
      setRoster(
        [...playersRef.current.values()]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((p) => ({
            id: p.userId,
            name: p.userId === profile.id ? `${p.name} (you)` : p.name,
            color: p.color,
            zone: zoneLabelAt(layout, p.x, p.y),
            connected: connected.has(p.userId),
            muted: !!p.muted,
            deafened: !!p.deafened,
          })),
      );
    }, 250);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  // Render + movement loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !office || !profile) return;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;

    const tick = () => {
      const layout = officeRef.current?.layout;
      const me = playersRef.current.get(profile.id);
      if (me && layout) {
        const k = keysRef.current;
        let dx = 0;
        let dy = 0;
        if (k.has('arrowup') || k.has('w')) dy -= 1;
        if (k.has('arrowdown') || k.has('s')) dy += 1;
        if (k.has('arrowleft') || k.has('a')) dx -= 1;
        if (k.has('arrowright') || k.has('d')) dx += 1;
        // Analog touch joystick adds to the keyboard vector.
        dx += touchDirRef.current.dx;
        dy += touchDirRef.current.dy;

        const manual = Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01;
        // Manual input cancels a follow; otherwise steer toward whoever we follow.
        let speed = MOVE_SPEED_PX;
        if (manual) {
          if (followingRef.current) {
            followingRef.current = null;
            setFollowing(null);
          }
        } else if (followingRef.current) {
          const target = playersRef.current.get(followingRef.current);
          if (!target) {
            followingRef.current = null;
            setFollowing(null);
          } else {
            const d = Math.hypot(target.x - me.x, target.y - me.y);
            if (d > FOLLOW_GAP) {
              let aim = target as { x: number; y: number };
              if (lineBlockedBySolids(layout, me, target)) {
                // Obstacle between us — walk the BFS path around it.
                const now = performance.now();
                if (now - lastPathAt.current > 200 || pathRef.current.length === 0) {
                  pathRef.current = findPath(layout, me, target) ?? [];
                  lastPathAt.current = now;
                }
                const path = pathRef.current;
                while (path.length && Math.hypot(path[0].x - me.x, path[0].y - me.y) < CELL * 0.4) {
                  path.shift();
                }
                if (path.length) aim = path[0];
                // Way behind with a clear-ish shot? Snap along the path so a
                // fast-moving target never leaves us stranded out of range.
                else if (d > FOLLOW_SNAP_DIST) aim = target;
              } else {
                pathRef.current = []; // clear line → go straight
              }
              const ax = aim.x - me.x;
              const ay = aim.y - me.y;
              const ad = Math.hypot(ax, ay) || 1;
              dx = ax / ad;
              dy = ay / ad;
              // Catch-up speed: fast when far behind, easing to a stop at the gap.
              speed = Math.min(FOLLOW_MAX_SPEED, Math.max(0, d - FOLLOW_GAP));
            }
          }
        }

        if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
          const len = Math.hypot(dx, dy) || 1;
          const target = {
            x: me.x + (dx / len) * speed,
            y: me.y + (dy / len) * speed,
          };
          const next = resolveMove(layout, me, target);
          me.x = next.x;
          me.y = next.y;
          const now = performance.now();
          if (now - lastEmit.current > 50) {
            channelRef.current?.sendMove(me.x, me.y);
            lastEmit.current = now;
          }
        }
        // Smoothly interpolate remote avatars toward their latest position so
        // the ~50ms broadcast steps don't look like teleporting. Self is drawn
        // at its true position (already updated every frame locally).
        const now = performance.now();
        const dt = lastFrame.current ? Math.min(0.1, (now - lastFrame.current) / 1000) : 0;
        lastFrame.current = now;
        const smooth = 1 - Math.exp(-dt / 0.08); // ~time-constant 80ms
        for (const [uid, p] of playersRef.current) {
          if (uid === profile.id) {
            p.rx = p.x;
            p.ry = p.y;
            continue;
          }
          if (p.rx === undefined || p.ry === undefined) {
            p.rx = p.x;
            p.ry = p.y;
          } else if (Math.hypot(p.x - p.rx, p.y - p.ry) > CELL * 4) {
            p.rx = p.x; // big jump (join/teleport) → snap, don't glide across the floor
            p.ry = p.y;
          } else {
            p.rx += (p.x - p.rx) * smooth;
            p.ry += (p.y - p.ry) * smooth;
          }
        }

        drawFloor(ctx, layout);
        if (musicPlayingRef.current) {
          drawSpeakerPulses(ctx, layout, performance.now(), mutedSpeakersRef.current);
        } else {
          drawMutedSpeakers(ctx, layout, mutedSpeakersRef.current);
        }
        const myRoom = roomAt(layout, me.x, me.y);
        if (myRoom) highlightRoom(ctx, myRoom);
        drawAvatars(
          ctx,
          playersRef.current,
          profile.id,
          connectedRef.current,
          !myRoom,
          followingRef.current,
          voiceRanges(layout).hearing,
        );
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [office?.id, profile?.id]);

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">{error}</p>
        <Button onClick={() => navigate('/dashboard')}>Back to dashboard</Button>
      </div>
    );
  }
  if (!office) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Opening office…</div>;
  }

  const isOwner = office.owner_id === profile?.id;
  const connectedCount = roster.filter((r) => r.connected).length;
  const officeHasSpeaker = hasSpeaker(office.layout);

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex h-14 items-center justify-between border-b px-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')}>
            <ArrowLeft /> Leave
          </Button>
          <h1 className="font-semibold">{office.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {isOwner && (
            <Button variant="outline" size="sm" onClick={() => navigate(`/office/${office.id}/edit`)}>
              <Pencil /> Edit
            </Button>
          )}
          <Button
            size="sm"
            variant={muted ? 'secondary' : 'default'}
            disabled={!micOk || deafened}
            onClick={toggleMute}
            title={micOk ? 'Toggle microphone (M)' : 'Microphone unavailable'}
          >
            {muted ? <MicOff /> : <Mic />}
            {muted ? 'Muted' : 'Live'}
          </Button>
          <Button
            size="sm"
            variant={deafened ? 'destructive' : 'secondary'}
            onClick={toggleDeafen}
            title="Toggle deafen — silence everyone (Shift+M)"
          >
            {deafened ? <HeadphoneOff /> : <Headphones />}
            {deafened ? 'Deafened' : 'Deafen'}
          </Button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <main className="relative flex flex-1 items-center justify-center overflow-auto bg-dots p-2 sm:p-4">
          {audioBlocked && (
            <button
              onClick={() => {
                void voiceRef.current?.resumeAudio();
                void musicRef.current?.resume();
                setAudioBlocked(false);
              }}
              className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg"
            >
              🔊 Click to enable sound
            </button>
          )}
          <canvas
            ref={canvasRef}
            width={office.layout.width * CELL}
            height={office.layout.height * CELL}
            onClick={onCanvasClick}
            onMouseMove={(e) => {
              const canvas = canvasRef.current;
              const layout = officeRef.current?.layout;
              if (!canvas || !layout) return;
              const rect = canvas.getBoundingClientRect();
              const px = (e.clientX - rect.left) * (canvas.width / rect.width);
              const py = (e.clientY - rect.top) * (canvas.height / rect.height);
              canvas.style.cursor = playerAt(px, py) || speakerAt(layout, px, py) ? 'pointer' : 'default';
            }}
            className="max-h-full max-w-full rounded-xl border shadow-sm"
          />

          {/* Touch controls (mobile only) */}
          <Joystick
            className="absolute bottom-5 left-5 z-20 md:hidden"
            onChange={(dx, dy) => {
              touchDirRef.current = { dx, dy };
            }}
          />

          {/* People toggle (mobile only) */}
          <button
            onClick={() => setShowRoster(true)}
            className="absolute bottom-6 right-5 z-20 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-lg md:hidden"
          >
            <Users className="size-4" />
            {roster.length}
          </button>
        </main>

        {/* Backdrop behind the mobile roster drawer */}
        {showRoster && (
          <div
            onClick={() => setShowRoster(false)}
            className="absolute inset-0 z-30 bg-black/40 md:hidden"
          />
        )}

        <aside
          className={cn(
            'overflow-y-auto border-border bg-background p-4',
            // Desktop: fixed side panel.
            'hidden shrink-0 md:block md:w-72 md:border-l',
            // Mobile: slide-up drawer, toggled by the People button.
            showRoster &&
              'absolute inset-x-0 bottom-0 z-40 block max-h-[70%] rounded-t-2xl border-t shadow-2xl',
          )}
        >
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-sm font-semibold">In this office</h2>
              <p className="mb-4 text-xs text-muted-foreground">
                {roster.length} here · {connectedCount} in earshot
              </p>
            </div>
            <button
              onClick={() => setShowRoster(false)}
              className="-mr-1 -mt-1 rounded-md p-1 text-muted-foreground hover:bg-accent md:hidden"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </div>
          {inRoom && (
            <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs">
              <p className="font-medium text-emerald-600 dark:text-emerald-400">🔇 In {inRoom}</p>
              <p className="mt-0.5 text-muted-foreground">
                Private room — you only hear others inside it, and they only hear you.
              </p>
            </div>
          )}
          {following && (
            <div className="mb-4 flex items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs">
              <p className="flex min-w-0 items-center gap-1.5 text-amber-600 dark:text-amber-400">
                <Footprints className="size-4 shrink-0" />
                <span className="truncate font-medium">
                  Following {roster.find((r) => r.id === following)?.name ?? 'someone'}
                </span>
              </p>
              <Button size="sm" variant="secondary" className="h-7 shrink-0 px-2" onClick={() => setFollowing(null)}>
                Stop
              </Button>
            </div>
          )}
          <ul className="space-y-1.5">
            {roster.map((r) => {
              const isSelf = r.id === profile?.id;
              const peerMuted = mutedPeers.has(r.id);
              return (
                <li
                  key={r.id}
                  className={cn(
                    'flex items-center gap-2 rounded-lg px-2 py-1.5',
                    !isSelf && 'cursor-pointer hover:bg-accent',
                  )}
                  onClick={isSelf ? undefined : () => togglePeerMute(r.id)}
                  title={isSelf ? undefined : peerMuted ? 'Unmute for yourself' : 'Mute for yourself'}
                >
                  <Avatar name={r.name} color={r.color} className="size-7" />
                  <div className="min-w-0 flex-1">
                    <p className={cn('truncate text-sm font-medium', peerMuted && 'text-muted-foreground line-through')}>
                      {r.name}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{r.zone}</p>
                  </div>
                  {following === r.id && !isSelf && (
                    <Footprints className="size-4 shrink-0 text-amber-500" aria-label="Following" />
                  )}
                  {r.deafened ? (
                    <HeadphoneOff className="size-4 shrink-0 text-muted-foreground" aria-label="Deafened themselves" />
                  ) : r.muted ? (
                    <MicOff className="size-4 shrink-0 text-muted-foreground" aria-label="Muted themselves" />
                  ) : null}
                  {!isSelf && peerMuted ? (
                    <VolumeX className="size-4 shrink-0 text-destructive" />
                  ) : r.connected ? (
                    <Badge variant="success">🔊</Badge>
                  ) : !isSelf ? (
                    <Volume2 className="size-4 shrink-0 text-muted-foreground/40" />
                  ) : null}
                </li>
              );
            })}
          </ul>
          {mutedPeers.size > 0 && (
            <button
              onClick={() => setMutedPeers(new Set())}
              className="mt-2 text-xs font-medium text-primary hover:underline"
            >
              Unmute {mutedPeers.size} muted {mutedPeers.size > 1 ? 'people' : 'person'}
            </button>
          )}

          {/* Speaker music */}
          <div className="mt-6 border-t pt-4">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <Music className="size-4" /> Speaker music
            </h3>
            {!officeHasSpeaker ? (
              <p className="mt-2 text-xs text-muted-foreground">
                No speaker placed yet. {isOwner ? 'Add a 🔊 Speaker in the editor' : 'Ask the owner to add a 🔊 Speaker'} —
                then music plays louder as you walk toward it.
              </p>
            ) : (
              <>
                {music.playing ? (
                  <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-violet-500/30 bg-violet-500/10 p-2.5">
                    <p className="min-w-0 truncate text-xs">
                      <span className="font-medium text-violet-600 dark:text-violet-300">
                        ♫ {nowPlaying || music.name}
                      </span>
                      <span className="text-muted-foreground"> · {music.by === profile?.id ? 'you' : 'playing'}</span>
                    </p>
                    <Button size="sm" variant="secondary" className="h-7 shrink-0 px-2" onClick={stopMusic}>
                      <Square className="size-3.5" /> Stop
                    </Button>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Type a song name, or pick a station — everyone in earshot of a speaker hears it.
                  </p>
                )}

                <div className="mt-3 grid grid-cols-2 gap-1.5">
                  {STATIONS.map((s) => {
                    const active = music.playing && music.src === s.url;
                    return (
                      <button
                        key={s.id}
                        onClick={() => changeMusic('stream', s.url, s.name)}
                        className={cn(
                          'flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left text-xs transition',
                          active ? 'border-violet-500 bg-violet-500/10' : 'hover:bg-accent',
                        )}
                      >
                        <span className="text-base leading-none">{s.icon}</span>
                        <span className="truncate">{s.name}</span>
                      </button>
                    );
                  })}
                </div>

                <form
                  className="mt-2 flex gap-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void playCustom();
                  }}
                >
                  <input
                    value={customUrl}
                    onChange={(e) => setCustomUrl(e.target.value)}
                    placeholder="Song name, YouTube link, or stream URL…"
                    className="h-8 min-w-0 flex-1 rounded-md border bg-transparent px-2 text-xs outline-none focus:border-primary"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    variant="outline"
                    className="h-8 px-2 text-xs"
                    disabled={searching || !customUrl.trim()}
                  >
                    {searching ? '…' : 'Play'}
                  </Button>
                </form>
                {deafened && music.playing && (
                  <p className="mt-2 text-xs text-muted-foreground">Un-deafen to hear the music.</p>
                )}

                {/* Per-speaker volume, local to you */}
                <div className="mt-4 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Speaker volume (just for you)</p>
                  {office.layout.items
                    .filter((it) => it.type === 'speaker')
                    .map((sp, i) => {
                      const spMuted = mutedSpeakers.has(sp.id);
                      const vol = spMuted ? 0 : Math.round((speakerVolumes.get(sp.id) ?? 1) * 100);
                      return (
                        <div key={sp.id} className="flex items-center gap-2">
                          <button
                            onClick={() => toggleSpeakerMute(sp.id)}
                            title={spMuted ? 'Unmute for yourself' : 'Mute for yourself'}
                            className="shrink-0 text-muted-foreground hover:text-foreground"
                          >
                            {spMuted ? (
                              <VolumeX className="size-4 text-destructive" />
                            ) : (
                              <Volume2 className="size-4" />
                            )}
                          </button>
                          <span className="w-16 shrink-0 text-xs">🔊 Speaker {i + 1}</span>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            value={vol}
                            onChange={(e) => {
                              const v = Number(e.target.value) / 100;
                              // Dragging the slider off 0 also un-mutes it.
                              if (spMuted && v > 0) toggleSpeakerMute(sp.id);
                              setSpeakerVolume(sp.id, v);
                            }}
                            className="h-1 flex-1 cursor-pointer accent-violet-500"
                          />
                          <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                            {vol}%
                          </span>
                        </div>
                      );
                    })}
                  <p className="text-xs text-muted-foreground">
                    Or tap a 🔊 speaker on the floor to mute it.
                  </p>
                </div>
              </>
            )}
          </div>

          <p className="mt-6 text-xs text-muted-foreground">
            <span className="md:hidden">Drag the joystick to move. </span>
            <span className="hidden md:inline">
              Move with <kbd className="rounded border px-1">WASD</kbd> or arrow keys.{' '}
            </span>
            Walk up to someone to talk. Tap their avatar to follow them.
          </p>
          <p className="mt-2 hidden text-xs text-muted-foreground md:block">
            <kbd className="rounded border px-1">M</kbd> mute ·{' '}
            <kbd className="rounded border px-1">⇧M</kbd> deafen
          </p>
          {!micOk && (
            <p className="mt-3 text-xs text-destructive">
              Mic unavailable — you can move and see others, but can't be heard.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
