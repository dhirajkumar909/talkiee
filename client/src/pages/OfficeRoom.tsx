import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Bell,
  BellOff,
  ChevronDown,
  Disc3,
  Headphones,
  HeadphoneOff,
  Footprints,
  Info,
  ListMusic,
  Mic,
  MicOff,
  Music,
  Pencil,
  Play,
  Radio,
  Search,
  SlidersHorizontal,
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
import {
  isNotificationSupported,
  getNotificationPermission,
  requestNotificationPermission,
  notifyMemberJoin,
  notifyMemberLeave,
} from '../lib/notifications';
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '../components/ui/dropdown-menu';
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
  const [musicTab, setMusicTab] = useState<'radio' | 'search'>('radio');
  const [showVolumes, setShowVolumes] = useState(false);
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

  const [notifyPerm, setNotifyPerm] = useState<NotificationPermission>(() => getNotificationPermission());
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('talkiee:notifications') !== 'false';
    } catch {
      return true;
    }
  });
  const notificationsEnabledRef = useRef(notificationsEnabled);
  useEffect(() => {
    notificationsEnabledRef.current = notificationsEnabled;
  }, [notificationsEnabled]);
  const namesRef = useRef<Map<string, string>>(new Map());

  const handleNotificationToggle = async () => {
    if (!isNotificationSupported()) {
      toast.error('Notifications are not supported by your browser');
      return;
    }

    if (notifyPerm === 'default') {
      const res = await requestNotificationPermission();
      setNotifyPerm(res);
      if (res === 'granted') {
        setNotificationsEnabled(true);
        try {
          localStorage.setItem('talkiee:notifications', 'true');
        } catch {
          /* ignore */
        }
        toast.success('Desktop notifications enabled');
        return;
      } else if (res === 'denied') {
        toast.error('Notifications were blocked in your browser settings');
        return;
      }
    }

    const next = !notificationsEnabled;
    setNotificationsEnabled(next);
    try {
      localStorage.setItem('talkiee:notifications', String(next));
    } catch {
      /* ignore */
    }
    if (next) {
      toast.success('Notifications unmuted');
    } else {
      toast.info('Notifications muted');
    }
  };

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
        for (const s of states) {
          namesRef.current.set(s.userId, s.name);
        }
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
      onJoin: (user) => {
        namesRef.current.set(user.userId, user.name);
        if (notificationsEnabledRef.current) {
          notifyMemberJoin(user.name, officeRef.current?.name);
        }
      },
      onLeave: ({ userId, name }) => {
        const displayName = name || namesRef.current.get(userId) || playersRef.current.get(userId)?.name || 'Someone';
        namesRef.current.delete(userId);
        if (notificationsEnabledRef.current) {
          notifyMemberLeave(displayName, officeRef.current?.name);
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
      namesRef.current.clear();
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
  const speakers = office.layout.items.filter((it) => it.type === 'speaker');

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
          {isNotificationSupported() && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleNotificationToggle}
              title={
                notifyPerm === 'denied'
                  ? 'Notifications blocked by browser settings'
                  : notifyPerm === 'default'
                  ? 'Enable desktop notifications'
                  : notificationsEnabled
                  ? 'Notifications enabled (click to mute)'
                  : 'Notifications muted (click to unmute)'
              }
              aria-label="Toggle notifications"
            >
              {notifyPerm === 'denied' || !notificationsEnabled ? (
                <BellOff className="h-4 w-4 text-muted-foreground" />
              ) : (
                <Bell className={cn('h-4 w-4', notifyPerm === 'granted' ? 'text-primary' : 'text-foreground')} />
              )}
            </Button>
          )}
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
            'flex-col overflow-hidden border-border bg-background',
            // Desktop: fixed side panel.
            'hidden shrink-0 md:flex md:w-80 md:border-l',
            // Mobile: slide-up drawer, toggled by the People button.
            showRoster &&
              'absolute inset-x-0 bottom-0 z-40 flex max-h-[75%] rounded-t-2xl border-t shadow-2xl',
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
            <div className="min-w-0">
              <h2 className="text-base font-semibold leading-tight">In this office</h2>
              <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                <span className="tabular-nums">{roster.length} here</span>
                <span aria-hidden>·</span>
                <span className="flex items-center gap-1 tabular-nums">
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                  {connectedCount} in earshot
                </span>
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                    aria-label="How it works"
                    title="How it works"
                  >
                    <Info className="size-[18px]" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72 p-0">
                  <div className="border-b px-4 py-3">
                    <p className="text-sm font-semibold">How it works</p>
                  </div>
                  <ul className="space-y-2.5 px-4 py-3 text-sm text-muted-foreground">
                    <li className="flex gap-2.5">
                      <Footprints className="mt-0.5 size-4 shrink-0 text-foreground" />
                      <span>
                        <span className="md:hidden">Drag the joystick to move.</span>
                        <span className="hidden md:inline">
                          Move with <Kbd>WASD</Kbd> or the arrow keys.
                        </span>
                      </span>
                    </li>
                    <li className="flex gap-2.5">
                      <Mic className="mt-0.5 size-4 shrink-0 text-foreground" />
                      <span>Walk up to someone to talk — voice fades with distance.</span>
                    </li>
                    <li className="flex gap-2.5">
                      <Users className="mt-0.5 size-4 shrink-0 text-foreground" />
                      <span>Tap an avatar to follow them. Tap a name in the list to mute them for yourself.</span>
                    </li>
                    <li className="flex gap-2.5">
                      <Music className="mt-0.5 size-4 shrink-0 text-foreground" />
                      <span>Music gets louder near a 🔊 speaker. Tap a speaker on the floor to mute it.</span>
                    </li>
                  </ul>
                  <div className="hidden border-t px-4 py-3 md:block">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Shortcuts
                    </p>
                    <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-sm">
                      <Kbd>M</Kbd>
                      <span className="text-muted-foreground">Mute / unmute mic</span>
                      <Kbd>⇧ M</Kbd>
                      <span className="text-muted-foreground">Deafen</span>
                    </div>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
              <button
                onClick={() => setShowRoster(false)}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent md:hidden"
                aria-label="Close"
              >
                <X className="size-[18px]" />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {/* Status banners */}
            {(!micOk || inRoom || following) && (
              <div className="space-y-2 px-5 pt-4">
                {!micOk && (
                  <div className="flex gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm">
                    <MicOff className="mt-0.5 size-4 shrink-0 text-destructive" />
                    <p className="text-destructive">Mic unavailable — others can't hear you.</p>
                  </div>
                )}
                {inRoom && (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5">
                    <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">🔇 In {inRoom}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      Private room — only people inside can hear each other.
                    </p>
                  </div>
                )}
                {following && (
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 py-2 pl-3 pr-2">
                    <p className="flex min-w-0 items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
                      <Footprints className="size-4 shrink-0" />
                      <span className="truncate font-medium">
                        Following {roster.find((r) => r.id === following)?.name ?? 'someone'}
                      </span>
                    </p>
                    <Button size="sm" variant="secondary" className="h-7 shrink-0 px-2.5" onClick={() => setFollowing(null)}>
                      Stop
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* People */}
            <section className="px-5 py-4">
              <div className="mb-2 flex items-center justify-between">
                <SectionLabel>People</SectionLabel>
                {mutedPeers.size > 0 && (
                  <button
                    onClick={() => setMutedPeers(new Set())}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Unmute {mutedPeers.size}
                  </button>
                )}
              </div>
              {/* Capped height so a big roster never pushes the music section out of view. */}
              <ul className="-mx-2 max-h-[min(20rem,35vh)] space-y-0.5 overflow-y-auto overscroll-contain">

                {roster.map((r) => {
                  const isSelf = r.id === profile?.id;
                  const peerMuted = mutedPeers.has(r.id);
                  return (
                    <li
                      key={r.id}
                      className={cn(
                        'flex items-center gap-3 rounded-lg px-2 py-2',
                        !isSelf && 'cursor-pointer transition hover:bg-accent',
                      )}
                      onClick={isSelf ? undefined : () => togglePeerMute(r.id)}
                      title={isSelf ? undefined : peerMuted ? 'Unmute for yourself' : 'Mute for yourself'}
                    >
                      <Avatar name={r.name} color={r.color} className="size-8" />
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            'truncate text-sm font-medium leading-tight',
                            peerMuted && 'text-muted-foreground line-through',
                          )}
                        >
                          {r.name}
                          {isSelf && <span className="ml-1 font-normal text-muted-foreground">(you)</span>}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{r.zone}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
                        {following === r.id && !isSelf && (
                          <Footprints className="size-4 text-amber-500" aria-label="Following" />
                        )}
                        {r.deafened ? (
                          <HeadphoneOff className="size-4" aria-label="Deafened themselves" />
                        ) : r.muted ? (
                          <MicOff className="size-4" aria-label="Muted themselves" />
                        ) : null}
                        {!isSelf && peerMuted ? (
                          <VolumeX className="size-4 text-destructive" aria-label="Muted for you" />
                        ) : r.connected ? (
                          <Badge variant="success" className="px-2">
                            <Volume2 className="size-3.5" />
                          </Badge>
                        ) : !isSelf ? (
                          <Volume2 className="size-4 opacity-30" aria-label="Out of earshot" />
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>

            {/* Speaker music */}
            <section className="border-t px-5 py-4">
              <div className="mb-3 flex items-center gap-2">
                <Music className="size-4 text-muted-foreground" />
                <SectionLabel>Speaker music</SectionLabel>
              </div>
              {!officeHasSpeaker ? (
                <p className="rounded-lg border border-dashed px-3 py-3 text-sm leading-relaxed text-muted-foreground">
                  No speaker yet. {isOwner ? 'Add a 🔊 Speaker in the editor' : 'Ask the owner to add a 🔊 Speaker'} to
                  play music.
                </p>
              ) : (
                <div className="overflow-hidden rounded-xl border">
                  {/* Now playing */}
                  <div
                    className={cn(
                      'flex items-center gap-3 p-3',
                      music.playing && 'bg-gradient-to-br from-violet-500/15 to-fuchsia-500/5',
                    )}
                  >
                    <div
                      className={cn(
                        'flex size-10 shrink-0 items-center justify-center rounded-lg',
                        music.playing ? 'bg-violet-500 text-white' : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {!music.playing ? (
                        <Music className="size-5" />
                      ) : music.kind === 'stream' ? (
                        <Radio className="size-5" />
                      ) : music.kind === 'youtube_playlist' ? (
                        <ListMusic className="size-5" />
                      ) : (
                        <Disc3 className="size-5 animate-[spin_3s_linear_infinite]" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      {music.playing ? (
                        <>
                          <p className="truncate text-sm font-semibold">{nowPlaying || music.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {deafened
                              ? 'Un-deafen to hear it'
                              : `${music.kind === 'stream' ? 'Radio' : music.kind === 'youtube_playlist' ? 'Playlist' : 'YouTube'} · ${
                                  music.by === profile?.id ? 'started by you' : 'shared with everyone'
                                }`}
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="text-sm font-medium">Nothing playing</p>
                          <p className="text-xs text-muted-foreground">Pick a station or search a song</p>
                        </>
                      )}
                    </div>
                    {music.playing && (
                      <button
                        onClick={stopMusic}
                        title="Stop for everyone"
                        aria-label="Stop music"
                        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition hover:opacity-80"
                      >
                        <Square className="size-3.5 fill-current" />
                      </button>
                    )}
                  </div>

                  {/* Source tabs */}
                  <div className="border-t p-3">
                    <div className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1" role="tablist">
                      {(
                        [
                          ['radio', Radio, 'Radio'],
                          ['search', Search, 'Search'],
                        ] as const
                      ).map(([key, Icon, label]) => (
                        <button
                          key={key}
                          role="tab"
                          aria-selected={musicTab === key}
                          onClick={() => setMusicTab(key)}
                          className={cn(
                            'flex h-8 items-center justify-center gap-1.5 rounded-md text-sm font-medium transition',
                            musicTab === key
                              ? 'bg-background text-foreground shadow-sm'
                              : 'text-muted-foreground hover:text-foreground',
                          )}
                        >
                          <Icon className="size-4" /> {label}
                        </button>
                      ))}
                    </div>

                    {musicTab === 'radio' ? (
                      <div className="grid grid-cols-2 gap-2">
                        {STATIONS.map((s) => {
                          const active = music.playing && music.src === s.url;
                          return (
                            <button
                              key={s.id}
                              onClick={() => (active ? stopMusic() : changeMusic('stream', s.url, s.name))}
                              title={active ? 'Stop' : `Play ${s.name}`}
                              className={cn(
                                'flex flex-col items-start gap-1 rounded-lg border p-2.5 text-left transition',
                                active
                                  ? 'border-violet-500 bg-violet-500/10 ring-1 ring-violet-500'
                                  : 'hover:border-foreground/20 hover:bg-accent',
                              )}
                            >
                              <span className="flex w-full items-center justify-between">
                                <span className="text-xl leading-none">{s.icon}</span>
                                {active && <EqBars />}
                              </span>
                              <span
                                className={cn(
                                  'w-full truncate text-xs font-medium',
                                  active && 'text-violet-700 dark:text-violet-300',
                                )}
                              >
                                {s.name}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void playCustom();
                        }}
                      >
                        <div className="relative">
                          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                          <input
                            autoFocus
                            value={customUrl}
                            onChange={(e) => setCustomUrl(e.target.value)}
                            placeholder="Song name or YouTube link"
                            className="h-10 w-full rounded-lg border bg-transparent pl-9 pr-3 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
                          />
                        </div>
                        <Button type="submit" className="mt-2 h-9 w-full" disabled={searching || !customUrl.trim()}>
                          {searching ? (
                            'Searching…'
                          ) : (
                            <>
                              <Play className="size-4 fill-current" /> Play for everyone
                            </>
                          )}
                        </Button>
                        <p className="mt-2 text-center text-xs text-muted-foreground">
                          Works with videos and playlists
                        </p>
                      </form>
                    )}
                  </div>

                  {/* Personal volume (collapsible) */}
                  <div className="border-t">
                    <button
                      onClick={() => setShowVolumes((v) => !v)}
                      aria-expanded={showVolumes}
                      className="flex w-full items-center justify-between px-3 py-2.5 text-sm text-muted-foreground transition hover:bg-accent hover:text-foreground"
                    >
                      <span className="flex items-center gap-2">
                        <SlidersHorizontal className="size-4" />
                        My volume
                        {mutedSpeakers.size > 0 && (
                          <span className="rounded-full bg-destructive/15 px-1.5 text-xs font-medium text-destructive">
                            {mutedSpeakers.size} muted
                          </span>
                        )}
                      </span>
                      <ChevronDown className={cn('size-4 transition-transform', showVolumes && 'rotate-180')} />
                    </button>
                    {showVolumes && (
                      <div className="space-y-2.5 px-3 pb-3">
                        {speakers.map((sp, i) => {
                          const spMuted = mutedSpeakers.has(sp.id);
                          const vol = spMuted ? 0 : Math.round((speakerVolumes.get(sp.id) ?? 1) * 100);
                          return (
                            <div key={sp.id} className="flex items-center gap-2.5">
                              <button
                                onClick={() => toggleSpeakerMute(sp.id)}
                                title={spMuted ? 'Unmute for yourself' : 'Mute for yourself'}
                                className="shrink-0 rounded-md p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                              >
                                {spMuted ? <VolumeX className="size-4 text-destructive" /> : <Volume2 className="size-4" />}
                              </button>
                              {speakers.length > 1 && <span className="w-6 shrink-0 text-xs text-muted-foreground">#{i + 1}</span>}
                              <input
                                type="range"
                                min={0}
                                max={100}
                                value={vol}
                                aria-label={`Speaker ${i + 1} volume`}
                                onChange={(e) => {
                                  const v = Number(e.target.value) / 100;
                                  // Dragging the slider off 0 also un-mutes it.
                                  if (spMuted && v > 0) toggleSpeakerMute(sp.id);
                                  setSpeakerVolume(sp.id, v);
                                }}
                                className="h-1 min-w-0 flex-1 cursor-pointer accent-violet-500"
                              />
                              <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                                {vol}%
                              </span>
                            </div>
                          );
                        })}
                        <p className="text-xs text-muted-foreground">Only affects what you hear.</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </section>
          </div>
        </aside>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</h3>;
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border bg-muted px-1.5 font-mono text-[11px] font-medium text-foreground">
      {children}
    </kbd>
  );
}

/** Tiny animated equalizer shown on the active station. */
function EqBars() {
  return (
    <span className="flex h-3.5 items-end gap-[2px]" aria-label="Playing">
      {[0, 0.2, 0.4].map((d) => (
        <span
          key={d}
          className="h-full w-[3px] origin-bottom animate-eq rounded-full bg-violet-500"
          style={{ animationDelay: `${d}s` }}
        />
      ))}
    </span>
  );
}
