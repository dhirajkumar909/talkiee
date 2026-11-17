import { Room, RoomEvent, RemoteTrack, Track } from 'livekit-client';
import { HEARING_RANGE, FULL_VOLUME_RANGE, volumeForDistance } from './layout';

/**
 * Proximity audio on top of a LiveKit SFU. Each client publishes its mic once;
 * the server forwards streams. We keep talkiee's spatial model by only
 * *subscribing* to participants within hearing range (our audioDistance already
 * encodes room isolation) and setting per-participant volume by distance. This
 * scales to large offices because you only ever pull a few nearby streams.
 */
export class LiveKitVoice {
  readonly room: Room;
  private muted = true;
  private deafened = false;
  private connected = false;
  /** Peers this user has muted just for themselves (by userId / identity). */
  private mutedPeers = new Set<string>();
  // Per-office proximity radii (pixels); default to the global constants.
  private hearingRange = HEARING_RANGE;
  private fullRange = FULL_VOLUME_RANGE;
  /** One <audio> element per remote participant we're subscribed to. */
  private audioEls = new Map<string, HTMLAudioElement>();

  onConnectedChange?: (audiblePeerIds: string[]) => void;
  /** Fired when the browser blocks audio autoplay until a user gesture. */
  onAudioBlocked?: (blocked: boolean) => void;

  constructor() {
    this.room = new Room({ adaptiveStream: false, dynacast: false });

    this.room
      .on(RoomEvent.TrackSubscribed, (track, _pub, p) => {
        if (track.kind === Track.Kind.Audio) this.attachAudio(p.identity, track);
        this.onAudioBlocked?.(!this.room.canPlaybackAudio);
        this.emitAudible();
      })
      .on(RoomEvent.TrackUnsubscribed, (track, _pub, p) => {
        if (track.kind === Track.Kind.Audio) this.detachAudio(p.identity, track);
        this.emitAudible();
      })
      .on(RoomEvent.ParticipantDisconnected, (p) => {
        this.removeAudioEl(p.identity);
        this.emitAudible();
      })
      .on(RoomEvent.AudioPlaybackStatusChanged, () => {
        this.onAudioBlocked?.(!this.room.canPlaybackAudio);
      });
  }

  /** Attach a remote audio track to a hidden <audio> element so it plays. */
  private attachAudio(identity: string, track: RemoteTrack) {
    let el = this.audioEls.get(identity);
    if (!el) {
      el = document.createElement('audio');
      el.autoplay = true;
      el.style.display = 'none';
      document.body.appendChild(el);
      this.audioEls.set(identity, el);
    }
    if (this.deafened) el.volume = 0;
    track.attach(el);
    void el.play().catch(() => {
      this.onAudioBlocked?.(true); // surface the "click to enable sound" button
    });
  }

  private detachAudio(identity: string, track: RemoteTrack) {
    track.detach();
    this.removeAudioEl(identity);
  }

  private removeAudioEl(identity: string) {
    const el = this.audioEls.get(identity);
    if (el) {
      el.srcObject = null;
      el.remove();
      this.audioEls.delete(identity);
    }
  }

  async connect(url: string, token: string) {
    // autoSubscribe:false — proximity decides what we actually pull.
    await this.room.connect(url, token, { autoSubscribe: false });
    this.connected = true;
    // Best-effort: may be blocked until a user gesture (handled by resumeAudio).
    void this.room.startAudio().catch(() => {});
  }

  /** Request + publish the microphone. Returns false if denied/unavailable. */
  async enableMic(): Promise<boolean> {
    try {
      await this.room.localParticipant.setMicrophoneEnabled(true);
      this.muted = false;
      return true;
    } catch (err) {
      console.warn('Microphone unavailable:', err);
      return false;
    }
  }

  async setMuted(muted: boolean) {
    this.muted = muted;
    if (this.connected) {
      try {
        await this.room.localParticipant.setMicrophoneEnabled(!muted);
      } catch (err) {
        console.warn('Could not toggle mic:', err);
      }
    }
  }

  isMuted() {
    return this.muted;
  }

  /** Deafen: silence every remote participant (the next proximity tick keeps it at 0). */
  setDeafened(deafened: boolean) {
    this.deafened = deafened;
    if (deafened) for (const el of this.audioEls.values()) el.volume = 0;
  }

  /** Set this office's proximity radii (pixels). Takes effect on the next tick. */
  setRanges(hearing: number, full: number) {
    this.hearingRange = hearing;
    this.fullRange = full;
  }

  /** Replace the set of locally-muted peers; takes effect on the next proximity tick. */
  setMutedPeers(ids: Set<string>) {
    this.mutedPeers = ids;
    for (const [id, el] of this.audioEls) if (ids.has(id)) el.volume = 0;
  }

  /** Must be called from a user gesture if the browser blocked audio. */
  async resumeAudio() {
    try {
      await this.room.startAudio();
    } catch {
      /* ignored */
    }
    // Also (re)start our own elements, which the same gesture now unblocks.
    for (const el of this.audioEls.values()) void el.play().catch(() => {});
  }

  /**
   * Reconcile subscriptions + volume with proximity. `distances` maps each
   * other player's id (= LiveKit identity) to their effective audio distance.
   */
  updateProximity(distances: Map<string, number>) {
    if (!this.connected) return;
    for (const participant of this.room.remoteParticipants.values()) {
      const dist = distances.get(participant.identity);
      const within = dist !== undefined && dist <= this.hearingRange;
      for (const pub of participant.audioTrackPublications.values()) {
        if (pub.isSubscribed !== within) pub.setSubscribed(within);
      }
      if (within) {
        const el = this.audioEls.get(participant.identity);
        const silenced = this.deafened || this.mutedPeers.has(participant.identity);
        if (el) el.volume = silenced ? 0 : this.volumeForDistance(dist!);
      }
    }
  }

  private volumeForDistance(dist: number) {
    return volumeForDistance(dist, this.fullRange, this.hearingRange);
  }

  private emitAudible() {
    const ids: string[] = [];
    for (const p of this.room.remoteParticipants.values()) {
      for (const pub of p.audioTrackPublications.values()) {
        if (pub.isSubscribed) {
          ids.push(p.identity);
          break;
        }
      }
    }
    this.onConnectedChange?.(ids);
  }

  async destroy() {
    this.connected = false;
    for (const id of [...this.audioEls.keys()]) this.removeAudioEl(id);
    await this.room.disconnect();
  }
}
