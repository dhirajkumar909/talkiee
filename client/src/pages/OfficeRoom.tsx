import { playFootstep, resumeAudioContext } from '../office/sfx';
import { RemoteTrack } from 'livekit-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
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
  ArrowLeft,
  Maximize2,
  Minimize2,
  Monitor,
  MonitorOff,
  PencilRuler,
  MapPin,
  Play,
  Radio,
  Search,
  Square,
  Users,
  Volume2,
  VolumeX,
  MessageCircle,
  MinusCircle,
  Send,
  X,
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { getOffice, getLivekitToken } from '../lib/api';
import type { MusicState, Office, PresenceState, ReactionPayload, ChatMessagePayload } from '../types';
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
  highlightRoom,
  drawReactions,
} from '../office/render';
import {
  AVATAR_RADIUS,
  CELL,
  MOVE_SPEED_PX,
  audioDistance,
  findPath,
  lineBlockedBySolids,
  resolveMove,
  roomAt,
  spawnPoint,
  speakerAt,
  speakerDistance,
  speakerProximity,
  voiceRanges,
  zoneLabelAt,
} from '../office/layout';
import { Button } from '../components/ui/button';
import { Avatar } from '../components/ui/avatar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '../components/ui/dropdown-menu';
import { Joystick } from '../components/Joystick';
import { ThemeToggle } from '../components/ThemeToggle';
import { InviteDialog } from '../components/InviteDialog';
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

/** Music per speaker, keyed by speaker item id. */
type SpeakerMusic = Record<string, MusicState>;

/**
 * Two playing speakers whose distances differ by less than this (px) count as
 * "equally close": one is picked at random and kept until that changes.
 */
const SPEAKER_TIE_DIST = CELL;

const musicKey = (officeId: string) => `talkiee:music:v2:${officeId}`;

function saveMusic(officeId: string, all: SpeakerMusic) {
  try {
    localStorage.setItem(musicKey(officeId), JSON.stringify(all));
  } catch {
    /* storage unavailable (private mode / quota) — non-fatal */
  }
}

function loadSavedMusic(officeId: string): SpeakerMusic {
  try {
    const raw = localStorage.getItem(musicKey(officeId));
    return raw ? (JSON.parse(raw) as SpeakerMusic) : {};
  } catch {
    return {};
  }
}

function ScreenSharePlayer({ track, name, onClose }: { track: RemoteTrack; name: string; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (videoRef.current) {
      track.attach(videoRef.current);
    }
    return () => {
      track.detach();
    };
  }, [track]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch((err) => {
        console.warn(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/90 p-4 backdrop-blur-sm">
      <div 
        ref={containerRef} 
        className={cn(
          "flex flex-col w-full",
          isFullscreen ? "h-screen bg-black" : "max-w-5xl"
        )}
      >
        {!isFullscreen && (
          <div className="flex w-full items-center justify-between rounded-t-lg bg-card p-3 shadow-sm border border-b-0">
            <h3 className="font-medium">{name}'s Screen</h3>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={toggleFullscreen} title="Full screen">
                <Maximize2 className="size-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={onClose} title="Close">
                <X className="size-4" />
              </Button>
            </div>
          </div>
        )}
        <div className={cn(
          "group relative flex w-full items-center justify-center overflow-hidden bg-black",
          isFullscreen ? "h-full" : "rounded-b-lg border shadow-lg"
        )}>
          <video 
            ref={videoRef} 
            autoPlay 
            playsInline 
            className={cn(
              "w-full object-contain",
              isFullscreen ? "h-full" : "max-h-[80vh]"
            )} 
          />
          {isFullscreen && (
            <Button 
              variant="secondary" 
              size="icon" 
              onClick={toggleFullscreen} 
              className="absolute top-4 right-4 opacity-0 transition-opacity group-hover:opacity-100"
              title="Exit full screen"
            >
              <Minimize2 className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function OfficeRoom() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [office, setOffice] = useState<Office | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [micOk, setMicOk] = useState(false);
  const [muted, setMuted] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);
  const [remoteScreenShares, setRemoteScreenShares] = useState<Map<string, RemoteTrack>>(new Map());
  const [messages, setMessages] = useState<ChatMessagePayload[]>([]);
  const [activeTab, setActiveTab] = useState<"people" | "chat">("people");
  const chatScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, activeTab]);
  const [chatInput, setChatInput] = useState('');
  const [viewingScreenShare, setViewingScreenShare] = useState<string | null>(null);
  const [roster, setRoster] = useState<RosterPerson[]>([]);
  const [inRoom, setInRoom] = useState<string | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [dnd, setDnd] = useState(false);
  const [showRoster, setShowRoster] = useState(false);
  const [musicBySpeaker, setMusicBySpeaker] = useState<SpeakerMusic>({});
  /** YouTube titles resolved locally, per speaker. */
  const [titles, setTitles] = useState<Record<string, string>>({});
  /** Speakers you're within earshot of, loudest first. */
  const [inRange, setInRange] = useState<string[]>([]);
  /** Which in-range speaker the music popup controls (null = loudest). */
  const [pickedSpeaker, setPickedSpeaker] = useState<string | null>(null);
  /** The single speaker you actually hear (closest playing one in range). */
  const [audibleSpeaker, setAudibleSpeaker] = useState<string | null>(null);
  const [showMusic, setShowMusic] = useState(false);
  const [customUrl, setCustomUrl] = useState('');
  const [searching, setSearching] = useState(false);
  const [mutedSpeakers, setMutedSpeakers] = useState<Set<string>>(new Set());
  const [speakerVolumes, setSpeakerVolumes] = useState<Map<string, number>>(new Map());
  const [mutedPeers, setMutedPeers] = useState<Set<string>>(new Set());
  const [following, setFollowing] = useState<string | null>(null);
  const [musicTab, setMusicTab] = useState<'radio' | 'search'>('radio');
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
  /** One audio player per speaker, created lazily the first time it plays. */
  const musicPlayersRef = useRef<Map<string, SpeakerAudio>>(new Map());
  const musicBySpeakerRef = useRef<SpeakerMusic>({});
  const audibleSpeakerRef = useRef<string | null>(null);
  const connectedRef = useRef<Set<string>>(new Set());
  const officeRef = useRef<Office | null>(null);
  const lastEmit = useRef(0);
  const lastFrame = useRef(0);
  const micOkRef = useRef(false);
  const deafenedRef = useRef(false);
  const dndRef = useRef(false);
  const reactionsRef = useRef<ReactionPayload[]>([]);
  /** Speakers currently playing (read by the render loop for pulses). */
  const playingSpeakersRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    musicBySpeakerRef.current = musicBySpeaker;
    playingSpeakersRef.current = new Set(
      Object.values(musicBySpeaker)
        .filter((m) => m.playing)
        .map((m) => m.speakerId),
    );
  }, [musicBySpeaker]);
  // Per-user, per-speaker local mutes (read by the render + proximity loops).
  const mutedSpeakersRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    mutedSpeakersRef.current = mutedSpeakers;
  }, [mutedSpeakers]);
  const speakerVolumesRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    speakerVolumesRef.current = speakerVolumes;
  }, [speakerVolumes]);
  // Speakers a peer has told us about — suppresses the localStorage
  // restore so we don't revive a song others have already moved on from.
  const musicReceivedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    micOkRef.current = micOk;
  }, [micOk]);
  useEffect(() => {
    deafenedRef.current = deafened;
  }, [deafened]);
  useEffect(() => {
    dndRef.current = dnd;
  }, [dnd]);

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
    if (deafenedRef.current || dndRef.current || !micOkRef.current) return;
    void voiceRef.current?.resumeAudio();
    setMuted((m) => !m);
  }, []);

  const toggleDeafen = useCallback(() => {
    if (dndRef.current) return;
    void voiceRef.current?.resumeAudio();
    setDeafened((d) => {
      const next = !d;
      setMuted(next ? true : !micOkRef.current);
      return next;
    });
  }, []);

  const toggleDnd = useCallback(() => {
    void voiceRef.current?.resumeAudio();
    setDnd((d) => {
      const next = !d;
      if (next) {
        setDeafened(true);
        setMuted(true);
      } else {
        setDeafened(false);
        setMuted(!micOkRef.current);
      }
      return next;
    });
  }, []);

  const toggleScreenShare = useCallback(async () => {
    if (!voiceRef.current) return;
    const isCurrentlySharing = screenSharing;
    const success = await voiceRef.current.setScreenShareEnabled(!isCurrentlySharing);
    if (success) {
      setScreenSharing(!isCurrentlySharing);
    }
  }, [screenSharing]);

  // Keyboard shortcuts: M = mute, Shift+M = deafen (avoids the WASD movement keys).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      resumeAudioContext();
      if (e.target instanceof HTMLInputElement) return;
      if (e.key.toLowerCase() === 'm') {
        e.preventDefault();
        if (e.shiftKey) toggleDeafen();
        else toggleMute();
      }
    };
    const onClick = () => resumeAudioContext();
    
    window.addEventListener('keydown', onKey);
    window.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', onClick);
    };
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
      avatar_url: profile.avatar_url,
      x: spawn.x,
      y: spawn.y,
    };
    playersRef.current.set(me.userId, { ...me });

    const voice = new LiveKitVoice();
    voice.onConnectedChange = (ids) => (connectedRef.current = new Set(ids));
    voice.onAudioBlocked = (blocked) => setAudioBlocked(blocked);
    voice.onScreenShareSubscribed = (identity, track) => {
      setRemoteScreenShares((prev) => {
        const next = new Map(prev);
        next.set(identity, track);
        return next;
      });
      const sharerName = playersRef.current.get(identity)?.name || 'Someone';
      toast.info(`${sharerName} is sharing their screen nearby.`, {
        action: { label: 'View', onClick: () => setViewingScreenShare(identity) },
      });
    };
    voice.onScreenShareUnsubscribed = (identity) => {
      setRemoteScreenShares((prev) => {
        const next = new Map(prev);
        next.delete(identity);
        return next;
      });
      setViewingScreenShare((prev) => (prev === identity ? null : prev));
    };
    const vr = voiceRanges(office.layout);
    voice.setRanges(vr.hearing, vr.full);
    voiceRef.current = voice;


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
        musicReceivedRef.current.add(state.speakerId);
        applyMusic(state);
      },
      onStatus: ({ userId, muted: m, deafened: d, dnd }) => {
        const p = playersRef.current.get(userId);
        if (p) {
          p.muted = m;
          p.deafened = d;
          p.dnd = dnd;
        }
      },
      onReaction: (r) => {
        reactionsRef.current.push(r);
      },
      onChat: (msg) => {
        setMessages((prev) => [...prev, msg].slice(-100));
      },
    });
    channelRef.current = channel;
    musicReceivedRef.current = new Set();
    void channel.join();

    // Resume music after a refresh. Give peers a moment to re-broadcast what
    // each speaker is playing; for any speaker nobody reported (e.g. you're
    // alone), restore the last-known state we persisted locally.
    const restoreTimer = window.setTimeout(() => {
      const speakerIds = new Set(office.layout.items.filter((it) => it.type === 'speaker').map((it) => it.id));
      for (const saved of Object.values(loadSavedMusic(id))) {
        if (!saved?.playing || !saved.src || !speakerIds.has(saved.speakerId)) continue;
        if (musicReceivedRef.current.has(saved.speakerId)) continue;
        applyMusic(saved);
        channelRef.current?.sendMusic(saved);
      }
    }, 1500);

    return () => {
      window.clearTimeout(restoreTimer);
      void channel.leave();
      void voice.destroy();
      for (const player of musicPlayersRef.current.values()) player.destroy();
      musicPlayersRef.current.clear();
      channelRef.current = null;
      voiceRef.current = null;
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
    for (const player of musicPlayersRef.current.values()) player.setDeafened(deafened);
  }, [deafened]);

  useEffect(() => {
    voiceRef.current?.setMutedPeers(mutedPeers);
  }, [mutedPeers]);

  // Broadcast our own mute/deafen/dnd so others see it on our avatar + roster, and
  // reflect it on our own local entry too.
  useEffect(() => {
    const me = profile ? playersRef.current.get(profile.id) : undefined;
    if (me) {
      me.muted = muted;
      me.deafened = deafened;
      me.dnd = dnd;
    }
    channelRef.current?.sendStatus(muted, deafened, dnd);
  }, [muted, deafened, dnd, ready, profile]);

  // Mute or unmute another person's voice — just for yourself.
  const togglePeerMute = useCallback((userId: string) => {
    setMutedPeers((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }, []);

  // Wire up a speaker's player on first use (each speaker has its own channel).
  function playerFor(speakerId: string): SpeakerAudio {
    let player = musicPlayersRef.current.get(speakerId);
    if (!player) {
      player = new SpeakerAudio();
      player.onBlocked = (blocked) => blocked && setAudioBlocked(true);
      player.onTitle = (title) => setTitles((t) => ({ ...t, [speakerId]: title }));
      player.setDeafened(deafenedRef.current);
      musicPlayersRef.current.set(speakerId, player);
    }
    return player;
  }

  // Apply one speaker's state locally (from us or a peer) and persist it.
  function applyMusic(state: MusicState) {
    const next = { ...musicBySpeakerRef.current, [state.speakerId]: state };
    musicBySpeakerRef.current = next;
    setMusicBySpeaker(next);
    setTitles((t) => ({ ...t, [state.speakerId]: state.playing ? state.name : '' }));
    // Only the speaker you're hearing actually plays; the proximity loop picks
    // (and starts) the right one. Re-apply here if it's the one you hear.
    if (state.speakerId === audibleSpeakerRef.current) {
      if (state.playing) playerFor(state.speakerId).play(state);
      else {
        musicPlayersRef.current.get(state.speakerId)?.stop();
        audibleSpeakerRef.current = null; // let the loop fall back to the next-closest
        setAudibleSpeaker(null);
      }
    }
    if (id) saveMusic(id, next);
  }

  const resumeAllAudio = () => {
    void voiceRef.current?.resumeAudio();
    for (const player of musicPlayersRef.current.values()) player.resume();
  };

  // Change one speaker's music: play locally + broadcast to the office.
  const changeMusic = useCallback(
    (speakerId: string, kind: MusicState['kind'], src: string, name: string) => {
      if (!profile) return;
      void voiceRef.current?.resumeAudio();
      const state: MusicState = {
        speakerId,
        playing: Boolean(src),
        kind,
        src,
        name,
        by: profile.id,
        startedAt: Date.now(),
      };
      applyMusic(state);
      channelRef.current?.sendMusic(state);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profile, id],
  );

  // The speaker the music popup controls: your pick if still in range, else the loudest.
  const activeSpeakerId =
    pickedSpeaker && inRange.includes(pickedSpeaker)
      ? pickedSpeaker
      : audibleSpeaker && inRange.includes(audibleSpeaker)
      ? audibleSpeaker
      : inRange[0] ?? null;

  const speakerName = (speakerId: string) => {
    const list = officeRef.current?.layout.items.filter((it) => it.type === 'speaker') ?? [];
    const idx = list.findIndex((it) => it.id === speakerId);
    return list[idx]?.label || `Speaker ${idx + 1}`;
  };

  useEffect(() => {
    if (!showMusic) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setShowMusic(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showMusic]);

  // Leaving every speaker's range closes the popup.
  useEffect(() => {
    if (inRange.length === 0) setShowMusic(false);
  }, [inRange.length]);

  // The box accepts a YouTube link/id, a direct audio stream URL, or — anything
  // else — a song name, which we resolve to the top YouTube match and play.
  const playCustom = useCallback(async () => {
    const input = customUrl.trim();
    const speakerId = activeSpeakerId;
    if (!input || searching || !speakerId) return;

    // A playlist link (…?list=…) wins over a single-video id on the same URL.
    const playlistId = parseYouTubePlaylistId(input);
    if (playlistId) {
      changeMusic(speakerId, 'youtube_playlist', playlistId, 'YouTube playlist');
      setCustomUrl('');
      return;
    }
    const ytId = parseYouTubeId(input);
    if (ytId) {
      changeMusic(speakerId, 'youtube', ytId, 'YouTube');
      setCustomUrl('');
      return;
    }
    if (/^https?:\/\//i.test(input)) {
      changeMusic(speakerId, 'stream', input, 'Custom stream');
      setCustomUrl('');
      return;
    }

    // Treat as a song name → search YouTube.
    setSearching(true);
    try {
      const res = await searchSong(input);
      if (res) {
        changeMusic(speakerId, 'youtube', res.id, res.title);
        setCustomUrl('');
      } else {
        toast.error('No match found — try pasting a YouTube link instead.');
      }
    } catch {
      toast.error('Search failed — try pasting a YouTube link instead.');
    } finally {
      setSearching(false);
    }
  }, [customUrl, searching, changeMusic, activeSpeakerId]);

  const stopMusic = useCallback(
    (speakerId: string) => changeMusic(speakerId, 'stream', '', ''),
    [changeMusic],
  );

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
      resumeAllAudio();
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
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      keysRef.current.add(e.key.toLowerCase());

      let key = e.key;
      if (e.code === 'Digit1' || e.code === 'Numpad1') key = '1';
      if (e.code === 'Digit2' || e.code === 'Numpad2') key = '2';
      if (e.code === 'Digit3' || e.code === 'Numpad3') key = '3';

      if (['1', '2', '3'].includes(key)) {
        const emojis = { '1': '❤️', '2': '👍', '3': '😂' };
        const emoji = emojis[key as keyof typeof emojis];
        channelRef.current?.sendReaction(emoji);
        if (profile?.id) {
          reactionsRef.current.push({ userId: profile.id, emoji, timestamp: Date.now() });
        }
      }
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
  }, [profile?.id]);

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

      // Speaker music: you hear exactly ONE speaker — the closest one in range
      // that's playing (and not muted by you). Ties go to a random pick that
      // sticks, so the music doesn't flip-flop as you move. Out of range = silence.
      const near: { id: string; d: number; v: number }[] = [];
      for (const item of layout.items) {
        if (item.type !== 'speaker') continue;
        const v = speakerProximity(layout, me, item);
        if (v > 0) near.push({ id: item.id, d: speakerDistance(layout, me, item), v });
      }
      near.sort((a, b) => a.d - b.d);

      const gainOf = (sid: string) =>
        mutedSpeakersRef.current.has(sid) ? 0 : speakerVolumesRef.current.get(sid) ?? 1;
      const candidates = near.filter((s) => musicBySpeakerRef.current[s.id]?.playing && gainOf(s.id) > 0);
      let pick: string | null = null;
      if (candidates.length) {
        const closest = candidates[0].d;
        const tied = candidates.filter((s) => s.d - closest < SPEAKER_TIE_DIST);
        const current = audibleSpeakerRef.current;
        pick = current && tied.some((s) => s.id === current)
          ? current
          : tied[Math.floor(Math.random() * tied.length)].id;
      }

      if (pick !== audibleSpeakerRef.current) {
        const prev = audibleSpeakerRef.current;
        if (prev) musicPlayersRef.current.get(prev)?.stop();
        audibleSpeakerRef.current = pick;
        setAudibleSpeaker(pick);
        // (Re)start from the shared state — YouTube seeks to the live position.
        if (pick) playerFor(pick).play(musicBySpeakerRef.current[pick]);
      }
      if (pick) {
        const v = near.find((s) => s.id === pick)?.v ?? 0;
        musicPlayersRef.current.get(pick)?.setProximityVolume(v * gainOf(pick));
      }

      const nextInRange = near.map((s) => s.id);
      setInRange((prev) =>
        prev.length === nextInRange.length && prev.every((x, i) => x === nextInRange[i]) ? prev : nextInRange,
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
            avatar_url: p.avatar_url,
            zone: zoneLabelAt(layout, p.x, p.y),
            connected: connected.has(p.userId),
            muted: !!p.muted,
            deafened: !!p.deafened,
            dnd: !!p.dnd,
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
          
          const moved = Math.hypot(next.x - me.x, next.y - me.y);
          if (moved > 0.1) {
            me.distWalked = (me.distWalked || 0) + moved;
            if (me.distWalked > 45) {
              me.distWalked = 0;
              playFootstep(0, 100, 200); // hear our own footsteps fully
            }
          }
          
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
            p.distWalked = 0;
          } else if (Math.hypot(p.x - p.rx, p.y - p.ry) > CELL * 4) {
            p.rx = p.x; // big jump (join/teleport) → snap, don't glide across the floor
            p.ry = p.y;
          } else {
            const dx = (p.x - p.rx) * smooth;
            const dy = (p.y - p.ry) * smooth;
            p.rx += dx;
            p.ry += dy;

            const moved = Math.hypot(dx, dy);
            if (moved > 0.1) {
              p.distWalked = (p.distWalked || 0) + moved;
              // A footstep every ~45 pixels walked
              if (p.distWalked > 45) {
                p.distWalked = 0;
                const dist = audioDistance(layout, me, p);
                const vr = voiceRanges(layout);
                playFootstep(dist, vr.full, vr.hearing);
              }
            }
          }
        }

        drawFloor(ctx, layout);
        drawSpeakerPulses(ctx, layout, performance.now(), mutedSpeakersRef.current, playingSpeakersRef.current);
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

        const currentMs = Date.now();
        reactionsRef.current = reactionsRef.current.filter((r) => currentMs - r.timestamp < 3000);
        drawReactions(ctx, playersRef.current, reactionsRef.current, currentMs);
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
  const myZone = roster.find((r) => r.id === profile?.id)?.zone;
  const me = roster.find((r) => r.id === profile?.id);
  const others = roster.filter((r) => r.id !== profile?.id);
  const earshot = others.filter((r) => r.connected);
  const away = others.filter((r) => !r.connected);
  const talking = roster.filter((r) => !r.muted && !r.deafened).length;

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="relative z-40 flex h-16 shrink-0 items-center gap-3 border-b bg-background px-3 sm:px-4">
        {/* Leave + office identity */}
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            title="Leave office"
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 pl-2 pr-3 text-sm font-semibold text-destructive outline-none transition-colors hover:border-destructive hover:bg-destructive hover:text-destructive-foreground focus-visible:ring-2 focus-visible:ring-destructive"
          >
            <ArrowLeft className="size-[18px]" strokeWidth={2.25} />
            Leave
          </button>
          <span className="hidden h-6 w-px bg-border sm:block" aria-hidden="true" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[15px] font-semibold leading-5">{office.name}</h1>
              {isOwner && (
                <span className="hidden rounded-md border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:inline">
                  Owner
                </span>
              )}
            </div>
            <p className="flex items-center gap-1.5 truncate text-xs leading-4 text-muted-foreground">
              <MapPin className="size-3 shrink-0" />
              <span className="truncate">{myZone || 'Walking around'}</span>
            </p>
          </div>
        </div>

        {/* Presence: who's here */}
        <div
          className="mx-auto hidden items-center gap-2.5 rounded-full border bg-muted/40 py-1 pl-1 pr-3 md:flex"
          title={`${roster.length} in this office`}
        >
          <div className="flex -space-x-2">
            {roster.slice(0, 5).map((r) => (
              <Avatar key={r.id} name={r.name.replace(' (you)', '')} color={r.color} className="size-7 text-[10px]" />
            ))}
            {roster.length > 5 && (
              <span className="inline-flex size-7 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground ring-2 ring-background">
                +{roster.length - 5}
              </span>
            )}
          </div>
          <span className="flex items-center gap-1.5 text-xs font-medium tabular-nums">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
            </span>
            {roster.length} online
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2 md:ml-0">
          {/* Voice controls */}
          <div className="flex items-center gap-1 rounded-xl border bg-muted/40 p-1">
            <button
              type="button"
              disabled={!micOk || deafened}
              onClick={toggleMute}
              title={micOk ? (muted ? 'Unmute microphone (M)' : 'Mute microphone (M)') : 'Microphone unavailable'}
              aria-pressed={!muted}
              className={cn(
                'flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
                muted
                  ? 'text-muted-foreground hover:bg-background hover:text-foreground'
                  : 'bg-emerald-500 text-white shadow-sm hover:bg-emerald-500/90',
              )}
            >
              {muted ? <MicOff className="size-[18px]" strokeWidth={1.75} /> : <Mic className="size-[18px]" strokeWidth={1.75} />}
              <span className="hidden lg:inline">{muted ? 'Muted' : 'Live'}</span>
            </button>
            <button
              type="button"
              onClick={toggleDeafen}
              title={deafened ? 'Undeafen (Shift+M)' : 'Deafen — silence everyone (Shift+M)'}
              aria-pressed={deafened}
              className={cn(
                'flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                deafened
                  ? 'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90'
                  : 'text-muted-foreground hover:bg-background hover:text-foreground',
              )}
            >
              {deafened ? (
                <HeadphoneOff className="size-[18px]" strokeWidth={1.75} />
              ) : (
                <Headphones className="size-[18px]" strokeWidth={1.75} />
              )}
              <span className="hidden lg:inline">{deafened ? 'Deafened' : 'Deafen'}</span>
            </button>
            <button
              type="button"
              onClick={toggleDnd}
              title={dnd ? 'Turn off Do Not Disturb' : 'Do Not Disturb — mute, deafen, and show focus bubble'}
              aria-pressed={dnd}
              className={cn(
                'flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                dnd
                  ? 'bg-amber-500 text-amber-950 shadow-sm hover:bg-amber-500/90'
                  : 'text-muted-foreground hover:bg-background hover:text-foreground',
              )}
            >
              <MinusCircle className="size-[18px]" strokeWidth={1.75} />
              <span className="hidden lg:inline">DND</span>
            </button>
            <button
              type="button"
              onClick={toggleScreenShare}
              title={screenSharing ? 'Stop sharing screen' : 'Share screen'}
              aria-pressed={screenSharing}
              className={cn(
                'flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                screenSharing
                  ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90'
                  : 'text-muted-foreground hover:bg-background hover:text-foreground',
              )}
            >
              {screenSharing ? (
                <MonitorOff className="size-[18px]" strokeWidth={1.75} />
              ) : (
                <Monitor className="size-[18px]" strokeWidth={1.75} />
              )}
              <span className="hidden lg:inline">{screenSharing ? 'Stop' : 'Share'}</span>
            </button>
          </div>

          {/* Utilities */}
          <div className="flex items-center">
            {isNotificationSupported() && (
              <button
                type="button"
                onClick={handleNotificationToggle}
                title={
                  notifyPerm === 'denied'
                    ? 'Notifications blocked by browser settings'
                    : notifyPerm === 'default'
                    ? 'Enable desktop notifications'
                    : notificationsEnabled
                    ? 'Notifications on (click to mute)'
                    : 'Notifications muted (click to unmute)'
                }
                aria-label="Toggle notifications"
                className="grid size-9 place-items-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                {notifyPerm === 'denied' || !notificationsEnabled ? (
                  <BellOff className="size-[18px]" strokeWidth={1.75} />
                ) : (
                  <Bell className="size-[18px]" strokeWidth={1.75} />
                )}
              </button>
            )}
            <ThemeToggle className="rounded-lg text-muted-foreground hover:text-foreground [&_svg]:size-[18px]" />
            {isOwner && (
              <button
                type="button"
                onClick={() => navigate(`/office/${office.id}/edit`)}
                title="Edit office layout"
                aria-label="Edit office layout"
                className="grid size-9 place-items-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <PencilRuler className="size-[18px]" strokeWidth={1.75} />
              </button>
            )}
          </div>

        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <main className="relative flex flex-1 items-center justify-center overflow-hidden bg-dots p-2 sm:p-4">
          {audioBlocked && (
            <button
              onClick={() => {
                resumeAllAudio();
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

          {/* Speaker music: a disc appears while you're in range of a speaker */}
          {activeSpeakerId && (() => {
            const sid = activeSpeakerId;
            const m = musicBySpeaker[sid];
            const playing = Boolean(m?.playing);
            const spMuted = mutedSpeakers.has(sid);
            const vol = spMuted ? 0 : Math.round((speakerVolumes.get(sid) ?? 1) * 100);
            const title = titles[sid] || m?.name;
            const sourceLabel =
              m?.kind === 'stream' ? 'Radio' : m?.kind === 'youtube_playlist' ? 'Playlist' : 'YouTube';
            return (
              <div className="absolute bottom-40 left-5 z-30 flex flex-col items-start gap-3 md:bottom-6 md:left-6">
                {showMusic && (
                  <div
                    role="dialog"
                    aria-label={`${speakerName(sid)} music`}
                    className="flex max-h-[min(36rem,calc(100vh-22rem))] w-[22rem] max-w-[calc(100vw-2.5rem)] origin-bottom-left md:max-h-[min(36rem,calc(100vh-16rem))] animate-slide-up flex-col overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-2xl"
                  >
                    {/* Header: which speaker */}
                    <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Nearby speaker
                        </p>
                        {inRange.length > 1 ? (
                          <div className="relative mt-0.5">
                            <select
                              value={sid}
                              onChange={(e) => setPickedSpeaker(e.target.value)}
                              className="max-w-full cursor-pointer appearance-none bg-transparent pr-6 text-base font-semibold outline-none"
                              aria-label="Choose speaker"
                            >
                              {inRange.map((id) => (
                                <option key={id} value={id} className="bg-popover text-sm">
                                  {speakerName(id)}
                                  {id === audibleSpeaker ? ' · hearing' : musicBySpeaker[id]?.playing ? ' ♫' : ''}
                                </option>
                              ))}
                            </select>
                            <ChevronDown className="pointer-events-none absolute right-0 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                          </div>
                        ) : (
                          <p className="mt-0.5 text-base font-semibold">🔊 {speakerName(sid)}</p>
                        )}
                        {audibleSpeaker && audibleSpeaker !== sid && (
                          <button
                            onClick={() => setPickedSpeaker(audibleSpeaker)}
                            className="mt-0.5 block text-xs text-violet-600 hover:underline dark:text-violet-300"
                          >
                            You're hearing {speakerName(audibleSpeaker)} — switch
                          </button>
                        )}
                      </div>
                      <button
                        onClick={() => setShowMusic(false)}
                        className="shrink-0 rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                        aria-label="Close music"
                      >
                        <X className="size-[18px]" />
                      </button>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto">
                      {/* Now playing + your volume for this speaker */}
                      <div
                        className={cn(
                          'space-y-3 p-4',
                          playing && 'bg-gradient-to-br from-violet-500/15 to-fuchsia-500/5',
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={cn(
                              'flex size-11 shrink-0 items-center justify-center rounded-lg',
                              playing ? 'bg-violet-500 text-white' : 'bg-muted text-muted-foreground',
                            )}
                          >
                            {!playing ? (
                              <Music className="size-5" />
                            ) : m?.kind === 'stream' ? (
                              <Radio className="size-5" />
                            ) : m?.kind === 'youtube_playlist' ? (
                              <ListMusic className="size-5" />
                            ) : (
                              <Disc3 className="size-5 animate-[spin_3s_linear_infinite]" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            {playing ? (
                              <>
                                <p className="truncate text-sm font-semibold">{title}</p>
                                <p className="truncate text-xs text-muted-foreground">
                                  {deafened
                                    ? 'Un-deafen to hear it'
                                    : `${sourceLabel} · ${m?.by === profile?.id ? 'started by you' : 'shared with everyone'}`}
                                </p>
                              </>
                            ) : (
                              <>
                                <p className="text-sm font-medium">Nothing playing</p>
                                <p className="text-xs text-muted-foreground">Pick a station or search a song</p>
                              </>
                            )}
                          </div>
                          {playing && (
                            <button
                              onClick={() => stopMusic(sid)}
                              title="Stop for everyone"
                              aria-label="Stop music"
                              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition hover:opacity-80"
                            >
                              <Square className="size-3.5 fill-current" />
                            </button>
                          )}
                        </div>

                        <div className="flex items-center gap-2.5">
                          <button
                            onClick={() => toggleSpeakerMute(sid)}
                            title={spMuted ? 'Unmute for yourself' : 'Mute for yourself'}
                            className="shrink-0 rounded-md p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                          >
                            {spMuted ? <VolumeX className="size-4 text-destructive" /> : <Volume2 className="size-4" />}
                          </button>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            value={vol}
                            aria-label="My volume for this speaker"
                            title="Only affects what you hear"
                            onChange={(e) => {
                              const v = Number(e.target.value) / 100;
                              // Dragging the slider off 0 also un-mutes it.
                              if (spMuted && v > 0) toggleSpeakerMute(sid);
                              setSpeakerVolume(sid, v);
                            }}
                            className="h-1 min-w-0 flex-1 cursor-pointer accent-violet-500"
                          />
                          <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                            {vol}%
                          </span>
                        </div>
                      </div>

                      {/* Source tabs */}
                      <div className="border-t p-4">
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
                              const active = playing && m?.src === s.url;
                              return (
                                <button
                                  key={s.id}
                                  onClick={() => (active ? stopMusic(sid) : changeMusic(sid, 'stream', s.url, s.name))}
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
                                  <Play className="size-4 fill-current" /> Play on this speaker
                                </>
                              )}
                            </Button>
                            <p className="mt-2 text-center text-xs text-muted-foreground">
                              Works with videos and playlists
                            </p>
                          </form>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* The disc */}
                <button
                  onClick={() => {
                    resumeAllAudio();
                    setShowMusic((v) => !v);
                  }}
                  aria-label={showMusic ? 'Close music controls' : `Open music for ${speakerName(sid)}`}
                  aria-expanded={showMusic}
                  title={playing ? `♫ ${title}` : `${speakerName(sid)} — tap to play music`}
                  className="group relative size-20 animate-fade-in rounded-full shadow-xl outline-none ring-offset-2 ring-offset-background transition hover:scale-105 focus-visible:ring-2 focus-visible:ring-violet-500"
                >
                  {playing && !spMuted && (
                    <span className="absolute inset-0 animate-disc-pulse rounded-full bg-violet-500/30" />
                  )}
                  <span
                    className={cn(
                      'absolute inset-0 rounded-full border border-white/10',
                      '[background:repeating-radial-gradient(circle_at_center,#18181b_0px,#18181b_2px,#27272a_3px,#18181b_4px)]',
                      playing && 'animate-[spin_4s_linear_infinite]',
                      spMuted && 'opacity-60',
                    )}
                  >
                    {/* label + highlight so the spin is visible */}
                    <span className="absolute inset-0 rounded-full bg-[conic-gradient(from_0deg,transparent_0deg,rgba(255,255,255,0.18)_40deg,transparent_80deg,transparent_180deg,rgba(255,255,255,0.12)_220deg,transparent_260deg)]" />
                    <span
                      className={cn(
                        'absolute left-1/2 top-1/2 size-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-zinc-900',
                        playing ? 'bg-gradient-to-br from-violet-400 to-fuchsia-500' : 'bg-zinc-500',
                      )}
                    />
                  </span>
                  {showMusic ? (
                    <span className="absolute right-0 top-0 flex size-6 items-center justify-center rounded-full bg-foreground text-background shadow">
                      <X className="size-3.5" />
                    </span>
                  ) : spMuted ? (
                    <span className="absolute right-0 top-0 flex size-6 items-center justify-center rounded-full bg-destructive text-white shadow">
                      <VolumeX className="size-3.5" />
                    </span>
                  ) : (
                    !playing && (
                      <span className="absolute right-0 top-0 flex size-6 items-center justify-center rounded-full bg-violet-500 text-white shadow">
                        <Music className="size-3.5" />
                      </span>
                    )
                  )}
                </button>
              </div>
            );
          })()}

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
          <div className="border-b px-5 pb-4 pt-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex gap-4">
                <button
                  onClick={() => setActiveTab('people')}
                  className={cn(
                    "text-lg font-semibold leading-tight tracking-tight pb-1 border-b-2 transition-colors",
                    activeTab === 'people' ? "border-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  People
                </button>
                <button
                  onClick={() => setActiveTab('chat')}
                  className={cn(
                    "text-lg font-semibold leading-tight tracking-tight pb-1 border-b-2 transition-colors",
                    activeTab === 'chat' ? "border-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  Chat
                </button>
              </div>
              <div className="-mr-1.5 -mt-1 flex shrink-0 items-center gap-2">
              <InviteDialog officeId={office.id} officeName={office.name} />
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
                      <span>Tap an avatar to follow them. Use the buttons next to a name to follow or mute someone just for you.</span>
                    </li>
                    <li className="flex gap-2.5">
                      <Music className="mt-0.5 size-4 shrink-0 text-foreground" />
                      <span>Each 🔊 speaker plays its own music — you hear the closest one. Walk near one and tap the disc in the corner to choose what it plays.</span>
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
            {/* Stats */}
            <div className="mt-4 grid grid-cols-3 gap-2">
              <Stat label="In office" value={roster.length} />
              <Stat label="In earshot" value={earshot.length} tone="emerald" />
              <Stat label="Mic on" value={talking} tone="violet" />
            </div>
          </div>

          <div className="min-h-0 flex-1 flex flex-col">
            {activeTab === 'people' ? (
              <div className="flex-1 overflow-y-auto pb-6">
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

            {/* You */}
            {me && (
              <section className="px-5 pt-4">
                <div className="relative overflow-hidden rounded-xl border bg-gradient-to-br from-muted/70 to-background p-3">
                  <div
                    className="pointer-events-none absolute -right-8 -top-8 size-24 rounded-full opacity-20 blur-2xl"
                    style={{ background: me.color }}
                  />
                  <div className="relative flex items-center gap-3">
                    <PersonAvatar person={me} size="lg" live={!muted && !deafened} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{stripYou(me.name)}</p>
                      <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                        <MapPin className="size-3 shrink-0" />
                        {me.zone}
                      </p>
                    </div>
                    <span
                      className={cn(
                        'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold',
                        dnd
                          ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                          : deafened
                          ? 'bg-destructive/15 text-destructive'
                          : muted
                          ? 'bg-muted text-muted-foreground'
                          : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
                      )}
                    >
                      {dnd ? (
                        <MinusCircle className="size-3" />
                      ) : deafened ? (
                        <HeadphoneOff className="size-3" />
                      ) : muted ? (
                        <MicOff className="size-3" />
                      ) : (
                        <Mic className="size-3" />
                      )}
                      {dnd ? 'Focusing' : deafened ? 'Deafened' : muted ? 'Muted' : 'Live'}
                    </span>
                  </div>
                </div>
              </section>
            )}

            {others.length === 0 ? (
              <div className="flex flex-col items-center px-8 py-12 text-center">
                <div className="mb-3 grid size-12 place-items-center rounded-full bg-muted">
                  <Users className="size-5 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium">It's quiet in here</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  You're the only one in {office.name} right now. Teammates show up here as soon as they join.
                </p>
              </div>
            ) : (
              <>
                {mutedPeers.size > 0 && (
                  <div className="mx-5 mt-4 flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2 text-xs">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <VolumeX className="size-3.5" />
                      {mutedPeers.size} muted for you
                    </span>
                    <button
                      onClick={() => setMutedPeers(new Set())}
                      className="font-semibold text-foreground hover:underline"
                    >
                      Unmute all
                    </button>
                  </div>
                )}
                <PeopleGroup
                  title="Within earshot"
                  hint="They can hear you"
                  dot="bg-emerald-500"
                  people={earshot}
                  following={following}
                  mutedPeers={mutedPeers}
                  onFollow={(id) => setFollowing((cur) => (cur === id ? null : id))}
                  onMute={togglePeerMute}
                  screenShares={remoteScreenShares}
                  onViewScreen={(id) => setViewingScreenShare(id)}
                />
                <PeopleGroup
                  title="Out of range"
                  hint="Walk closer to talk"
                  dot="bg-muted-foreground/40"
                  people={away}
                  following={following}
                  mutedPeers={mutedPeers}
                  onFollow={(id) => setFollowing((cur) => (cur === id ? null : id))}
                  onMute={togglePeerMute}
                  screenShares={remoteScreenShares}
                  onViewScreen={(id) => setViewingScreenShare(id)}
                />
              </>
            )}
              </div>
            ) : (
              <div className="flex flex-1 flex-col min-h-0">
                <div ref={chatScrollRef} className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
                  {messages.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground">
                      <MessageCircle className="mb-2 size-8 opacity-20" />
                      <p className="text-sm">No messages yet.</p>
                      <p className="mt-1 text-xs">Chat with anyone currently in the office.</p>
                    </div>
                  ) : (
                    messages.map((msg, i) => (
                      <div key={i} className={cn("flex flex-col max-w-[85%]", msg.userId === profile?.id ? "ml-auto items-end" : "mr-auto items-start")}>
                        <span className="text-[10px] text-muted-foreground mb-1 ml-1">{msg.name}</span>
                        <div className={cn("rounded-2xl px-3 py-2 text-sm", msg.userId === profile?.id ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-muted text-foreground rounded-bl-sm")}>
                          {msg.text}
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!chatInput.trim()) return;
                    channelRef.current?.sendChat(chatInput, profile?.display_name || 'Someone');
                    setMessages((prev) => [...prev, { userId: profile?.id || '', name: profile?.display_name || 'Me', text: chatInput, timestamp: Date.now() }].slice(-100));
                    setChatInput('');
                  }}
                  className="border-t p-3"
                >
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Type a message..."
                      className="flex-1 rounded-full border bg-background px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                    />
                    <Button type="submit" size="icon" className="shrink-0 rounded-full" disabled={!chatInput.trim()}>
                      <Send className="size-4" />
                    </Button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </aside>
      </div>
      {viewingScreenShare && remoteScreenShares.has(viewingScreenShare) && (
        <ScreenSharePlayer
          track={remoteScreenShares.get(viewingScreenShare)!}
          name={playersRef.current.get(viewingScreenShare)?.name || 'Someone'}
          onClose={() => setViewingScreenShare(null)}
        />
      )}
    </div>
  );
}

type RosterPerson = {
  id: string;
  name: string;
  color: string;
  avatar_url?: string | null;
  zone: string;
  connected: boolean;
  muted: boolean;
  deafened: boolean;
  dnd: boolean;
};

const stripYou = (name: string) => name.replace(/ \(you\)$/, '');

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'emerald' | 'violet' }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-2.5 py-2">
      <p
        className={cn(
          'text-lg font-semibold leading-none tabular-nums',
          tone === 'emerald' && 'text-emerald-600 dark:text-emerald-400',
          tone === 'violet' && 'text-violet-600 dark:text-violet-400',
        )}
      >
        {value}
      </p>
      <p className="mt-1 truncate text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

/** Avatar with a presence dot and a tiny mic/headphone badge. */
function PersonAvatar({
  person,
  size = 'md',
  live,
}: {
  person: RosterPerson;
  size?: 'md' | 'lg';
  live?: boolean;
}) {
  const isLive = live ?? (!person.muted && !person.deafened);
  return (
    <span className="relative shrink-0">
      <Avatar
        name={stripYou(person.name)}
        color={person.color}
        src={person.avatar_url ?? undefined}
        className={cn(size === 'lg' ? 'size-11 text-sm' : 'size-9', isLive && 'ring-2 ring-emerald-500/70 ring-offset-2 ring-offset-background')}
      />
      {(person.muted || person.deafened || person.dnd) && (
        <span className={cn(
          "absolute -bottom-0.5 -right-0.5 grid size-4 place-items-center rounded-full border-2 border-background",
          person.dnd ? "bg-amber-500 text-amber-950" : "bg-muted text-muted-foreground"
        )}>
          {person.dnd ? <MinusCircle className="size-2.5" /> : person.deafened ? <HeadphoneOff className="size-2.5" /> : <MicOff className="size-2.5" />}
        </span>
      )}
    </span>
  );
}

function PeopleGroup({
  title,
  hint,
  dot,
  people,
  following,
  mutedPeers,
  onFollow,
  onMute,
  screenShares,
  onViewScreen,
}: {
  title: string;
  hint: string;
  dot: string;
  people: RosterPerson[];
  following: string | null;
  mutedPeers: Set<string>;
  onFollow: (id: string) => void;
  onMute: (id: string) => void;
  screenShares?: Map<string, RemoteTrack>;
  onViewScreen?: (id: string) => void;
}) {
  if (people.length === 0) return null;
  return (
    <section className="px-5 pt-5 last:pb-5">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <span className={cn('size-1.5 rounded-full', dot)} />
          {title}
          <span className="rounded-full bg-muted px-1.5 py-px text-[10px] tabular-nums">{people.length}</span>
        </h3>
        <span className="text-[11px] text-muted-foreground/80">{hint}</span>
      </div>
      <ul className="-mx-2 space-y-0.5">
        {people.map((r) => {
          const peerMuted = mutedPeers.has(r.id);
          const isFollowing = following === r.id;
          return (
            <li
              key={r.id}
              className={cn(
                'group flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-accent/70',
                isFollowing && 'bg-amber-500/10 hover:bg-amber-500/15',
                !r.connected && 'opacity-70 hover:opacity-100',
              )}
            >
              <PersonAvatar person={r} />
              <div className="min-w-0 flex-1">
                <p className={cn('truncate text-sm font-medium leading-tight', peerMuted && 'text-muted-foreground line-through')}>
                  {r.name}
                </p>
                <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                  {isFollowing ? (
                    <span className="flex items-center gap-1 font-medium text-amber-600 dark:text-amber-400">
                      <Footprints className="size-3" /> Following
                    </span>
                  ) : (
                    <>
                      <MapPin className="size-3 shrink-0" />
                      <span className="truncate">{r.zone}</span>
                    </>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                {screenShares?.has(r.id) && onViewScreen && (
                  <RowAction
                    active={true}
                    activeClass="bg-primary/15 text-primary"
                    label={`View ${r.name}'s screen`}
                    onClick={() => onViewScreen(r.id)}
                  >
                    <Monitor className="size-4" />
                  </RowAction>
                )}
                <RowAction
                  active={isFollowing}
                  activeClass="bg-amber-500/15 text-amber-600 dark:text-amber-400"
                  label={isFollowing ? 'Stop following' : `Follow ${r.name}`}
                  onClick={() => onFollow(r.id)}
                >
                  <Footprints className="size-4" />
                </RowAction>
                <RowAction
                  active={peerMuted}
                  activeClass="bg-destructive/15 text-destructive"
                  label={peerMuted ? 'Unmute for yourself' : 'Mute for yourself'}
                  onClick={() => onMute(r.id)}
                >
                  {peerMuted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
                </RowAction>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function RowAction({
  active,
  activeClass,
  label,
  onClick,
  children,
}: {
  active: boolean;
  activeClass: string;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'grid size-8 place-items-center rounded-lg outline-none transition focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? activeClass
          : 'text-muted-foreground opacity-100 hover:bg-background hover:text-foreground md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100',
      )}
    >
      {children}
    </button>
  );
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
