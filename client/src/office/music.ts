import type { MusicState } from '../types';

/**
 * Plays the office speaker's music — either a direct audio stream (radio) via a
 * hidden <audio> element, or a YouTube video via the YouTube IFrame API — with
 * volume set externally from proximity to the nearest speaker item.
 *
 * Playback is driven by shared MusicState broadcast over the realtime channel:
 * every client (including whoever pressed Play) runs its own SpeakerAudio, so
 * each hears the music at its own proximity-correct volume. For YouTube, clients
 * seek to `now - startedAt` so everyone stays roughly in sync.
 */

/** Extract a YouTube video id from a URL or bare id, else null. */
export function parseYouTubeId(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const patterns = [
    /(?:youtube\.com\/watch\?[^#]*\bv=)([\w-]{11})/,
    /(?:youtu\.be\/)([\w-]{11})/,
    /(?:youtube\.com\/(?:embed|shorts|live)\/)([\w-]{11})/,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) return m[1];
  }
  return null;
}

/** Extract a YouTube playlist id from a URL (the `list=` param), else null. */
export function parseYouTubePlaylistId(input: string): string | null {
  const m = input.trim().match(/[?&]list=([\w-]+)/);
  // Ignore the private "Watch Later" list, which the IFrame API can't load.
  if (!m || m[1] === 'WL') return null;
  return m[1];
}

// -- YouTube IFrame API loader (singleton) ---------------------------------
declare global {
  interface Window {
    YT?: { Player: new (el: Element | string, opts: unknown) => YTPlayer; PlayerState: { PLAYING: number } };
    onYouTubeIframeAPIReady?: () => void;
  }
}
interface YTPlayer {
  loadVideoById(id: string, startSeconds?: number): void;
  loadPlaylist(opts: { list: string; listType: string; index?: number; startSeconds?: number }): void;
  setLoop(loop: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  setVolume(v: number): void;
  getPlayerState(): number;
  getVideoData(): { title?: string };
  destroy(): void;
}

let ytApi: Promise<void> | null = null;
function loadYouTubeApi(): Promise<void> {
  if (ytApi) return ytApi;
  ytApi = new Promise<void>((resolve) => {
    if (window.YT?.Player) return resolve();
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  });
  return ytApi;
}

export class SpeakerAudio {
  private el: HTMLAudioElement;
  private container: HTMLDivElement;
  private yt: YTPlayer | null = null;
  private ytReady = false;
  private pendingYt: { playlist: boolean; value: string; startSeconds: number } | null = null;

  private kind: MusicState['kind'] | null = null;
  private src = '';
  private proximityVolume = 0;
  private deafened = false;

  /** Fired when the browser blocks autoplay until a user gesture. */
  onBlocked?: (blocked: boolean) => void;
  /** Fired when a YouTube title becomes known, for local display. */
  onTitle?: (title: string) => void;

  constructor() {
    this.el = document.createElement('audio');
    this.el.crossOrigin = 'anonymous';
    this.el.preload = 'none';
    this.el.style.display = 'none';
    this.el.volume = 0;
    document.body.appendChild(this.el);

    // Hidden host for the YouTube iframe (0×0, off-screen).
    this.container = document.createElement('div');
    this.container.style.cssText = 'position:fixed;width:0;height:0;left:-9999px;top:-9999px;overflow:hidden';
    const mount = document.createElement('div');
    this.container.appendChild(mount);
    document.body.appendChild(this.container);
    void this.initYouTube(mount);
  }

  private async initYouTube(mount: HTMLDivElement) {
    await loadYouTubeApi();
    this.yt = new window.YT!.Player(mount, {
      width: '0',
      height: '0',
      playerVars: { autoplay: 1, controls: 0, disablekb: 1, playsinline: 1, rel: 0 },
      events: {
        onReady: () => {
          this.ytReady = true;
          if (this.pendingYt) {
            const p = this.pendingYt;
            this.pendingYt = null;
            this.startYouTube(p.playlist, p.value, p.startSeconds);
          }
        },
        onStateChange: (e: { data: number }) => {
          if (e.data === window.YT?.PlayerState.PLAYING) {
            this.onBlocked?.(false);
            this.applyVolume();
            const title = this.yt?.getVideoData().title;
            if (title) this.onTitle?.(title);
          }
        },
        onError: () => this.onBlocked?.(true),
      },
    });
  }

  /** Apply shared state: switch source, start/stop, seek YouTube to the live position. */
  play(state: MusicState) {
    if (!state.playing || !state.src) return this.stopAll();

    if (state.kind === 'youtube' || state.kind === 'youtube_playlist') {
      this.el.pause();
      const playlist = state.kind === 'youtube_playlist';
      this.kind = state.kind;
      this.src = state.src;
      // Playlists span many videos of unknown length, so we can't seek to a
      // shared position — everyone starts the list from the top. A single video
      // seeks to the live offset so latecomers sync up.
      const startSeconds = playlist ? 0 : Math.max(0, Math.floor((Date.now() - state.startedAt) / 1000));
      if (this.ytReady) this.startYouTube(playlist, state.src, startSeconds);
      else this.pendingYt = { playlist, value: state.src, startSeconds };
      return;
    }

    // Direct audio stream (radio etc.).
    this.yt?.stopVideo();
    this.kind = 'stream';
    if (state.src === this.src) return;
    this.src = state.src;
    this.el.src = state.src;
    this.el.play().then(
      () => this.onBlocked?.(false),
      () => this.onBlocked?.(true), // autoplay blocked (common for remote listeners)
    );
  }

  private startYouTube(playlist: boolean, value: string, startSeconds: number) {
    if (!this.yt) return;
    if (playlist) {
      this.yt.loadPlaylist({ list: value, listType: 'playlist', startSeconds });
      this.yt.setLoop(true); // keep the office music going after the last track
    } else {
      this.yt.loadVideoById(value, startSeconds);
    }
    this.applyVolume();
    // If it hasn't started shortly, autoplay was likely blocked — offer the gesture.
    window.setTimeout(() => {
      const isYt = this.kind === 'youtube' || this.kind === 'youtube_playlist';
      if (isYt && this.yt && this.yt.getPlayerState() !== window.YT?.PlayerState.PLAYING) {
        this.onBlocked?.(true);
      }
    }, 1200);
  }

  stop() {
    this.stopAll();
  }

  private stopAll() {
    this.kind = null;
    this.src = '';
    this.el.pause();
    this.el.removeAttribute('src');
    this.el.load();
    this.pendingYt = null;
    this.yt?.stopVideo();
  }

  setProximityVolume(v: number) {
    this.proximityVolume = Math.max(0, Math.min(1, v));
    this.applyVolume();
  }

  setDeafened(deafened: boolean) {
    this.deafened = deafened;
    this.applyVolume();
  }

  private applyVolume() {
    const v = this.deafened ? 0 : this.proximityVolume;
    this.el.volume = v;
    this.yt?.setVolume(Math.round(v * 100));
  }

  /** Call from a user gesture to recover from a blocked autoplay. */
  resume() {
    if (!this.kind) return;
    if (this.kind === 'youtube' || this.kind === 'youtube_playlist') {
      this.yt?.playVideo();
    } else {
      this.el.play().then(
        () => this.onBlocked?.(false),
        () => {},
      );
    }
  }

  destroy() {
    this.stopAll();
    this.el.remove();
    this.yt?.destroy();
    this.container.remove();
  }
}
