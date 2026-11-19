import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { MovePayload, MusicState, PresenceState, SignalPayload, StatusPayload } from '../types';

export interface OfficeChannelHandlers {
  /** Full roster from presence state (join/leave/position sync). */
  onRoster: (states: PresenceState[]) => void;
  /** High-frequency position update broadcast by a peer. */
  onMove: (move: MovePayload) => void;
  /** WebRTC signaling message addressed to us. */
  onSignal: (from: string, data: unknown) => void;
  /** A speaker's music changed (someone pressed play/stop on it). */
  onMusic: (state: MusicState) => void;
  /** A peer toggled their own mic-mute / deafen. */
  onStatus: (status: StatusPayload) => void;
  /** Another member joined the office. */
  onJoin?: (user: PresenceState) => void;
  /** Another member left the office. */
  onLeave?: (user: { userId: string; name?: string }) => void;
}

/**
 * Wraps a Supabase Realtime channel for one office: presence for the roster,
 * broadcast for live movement and WebRTC signaling. No custom server needed.
 */
export class OfficeChannel {
  private channel: RealtimeChannel;
  private me: PresenceState;
  private ready = false;
  /** Last known music state per speaker, re-sent to late joiners so they sync up. */
  private music = new Map<string, MusicState>();
  /** Our own mute/deafen status, re-sent to late joiners. */
  private status: StatusPayload | null = null;
  /** Tracks whether the initial presence sync has completed to avoid join spam on room entry. */
  private initialSyncDone = false;
  /** Active remote members tracked to deduplicate join/leave events. */
  private activeMembers = new Set<string>();
  private syncTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(officeId: string, me: PresenceState, handlers: OfficeChannelHandlers) {
    this.me = me;

    const topic = `office:${officeId}`;
    // Remove any stale channel for this office (HMR zombies / remounts). Two
    // channels sharing a topic on one socket knock each other offline.
    for (const ch of supabase.getChannels()) {
      if (ch.topic.includes(topic)) void supabase.removeChannel(ch);
    }

    this.channel = supabase.channel(topic, {
      config: { presence: { key: me.userId }, broadcast: { self: false } },
    });

    this.channel
      .on('presence', { event: 'sync' }, () => {
        const state = this.channel.presenceState<PresenceState>();
        const roster = Object.values(state)
          .map((entries) => entries[0])
          .filter(Boolean);
        handlers.onRoster(roster);

        if (!this.initialSyncDone) {
          for (const user of roster) {
            if (user.userId !== this.me.userId) {
              this.activeMembers.add(user.userId);
            }
          }
          if (this.syncTimer) clearTimeout(this.syncTimer);
          this.syncTimer = setTimeout(() => {
            this.initialSyncDone = true;
          }, 800);
        }
      })
      .on<PresenceState>('presence', { event: 'join' }, ({ key, currentPresences, newPresences }) => {
        // When someone new arrives, re-broadcast our current position so they
        // see us where we actually are (presence only carries our spawn point,
        // and we deliberately never re-track — repeated track() drops the channel).
        if (key !== this.me.userId) {
          this.sendMove(this.me.x, this.me.y);
          // Re-sync every playing speaker to the newcomer.
          for (const m of this.music.values()) if (m.playing) void this.rawSendMusic(m);
          // Let the newcomer know our current mute/deafen state.
          if (this.status) void this.rawSendStatus(this.status);

          // If initial sync has completed, alert for members joining
          if (this.initialSyncDone) {
            const isFirst = !currentPresences || currentPresences.length === 0;
            if (isFirst || !this.activeMembers.has(key)) {
              this.activeMembers.add(key);
              const user = (newPresences as PresenceState[])?.[0];
              if (user) {
                handlers.onJoin?.(user);
              }
            }
          }
        }
      })
      .on<PresenceState>('presence', { event: 'leave' }, ({ key, currentPresences, leftPresences }) => {
        if (key !== this.me.userId && this.initialSyncDone) {
          const hasRemaining = currentPresences && currentPresences.length > 0;
          if (!hasRemaining && this.activeMembers.has(key)) {
            this.activeMembers.delete(key);
            const user = (leftPresences as PresenceState[])?.[0];
            handlers.onLeave?.({ userId: key, name: user?.name });
          }
        }
      })
      .on('broadcast', { event: 'move' }, ({ payload }) => {
        handlers.onMove(payload as MovePayload);
      })
      .on('broadcast', { event: 'signal' }, ({ payload }) => {
        const sig = payload as SignalPayload;
        if (sig.to === this.me.userId) handlers.onSignal(sig.from, sig.data);
      })
      .on('broadcast', { event: 'music' }, ({ payload }) => {
        // Remember what's playing so *we* can re-sync future joiners too — not
        // only the person who originally started it. Payloads without a
        // speakerId come from older clients (one office-wide channel); ignore.
        const state = payload as MusicState;
        if (!state?.speakerId) return;
        this.music.set(state.speakerId, state);
        handlers.onMusic(state);
      })
      .on('broadcast', { event: 'status' }, ({ payload }) => {
        handlers.onStatus(payload as StatusPayload);
      });
  }

  async join() {
    await new Promise<void>((resolve) => {
      this.channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await this.channel.track(this.me);
          this.ready = true;
          // Announce our current mute/deafen status to people already here.
          if (this.status) void this.rawSendStatus(this.status);
          resolve();
        }
      });
    });
  }

  /** Broadcast a live position (high frequency; does not touch presence). */
  sendMove(x: number, y: number) {
    if (!this.ready) return;
    this.me.x = x;
    this.me.y = y;
    void this.channel.send({
      type: 'broadcast',
      event: 'move',
      payload: { userId: this.me.userId, x, y } satisfies MovePayload,
    });
  }


  /** Broadcast a change to one speaker's music (play/stop/station). */
  sendMusic(state: MusicState) {
    this.music.set(state.speakerId, state);
    void this.rawSendMusic(state);
  }

  private async rawSendMusic(state: MusicState) {
    if (!this.ready) return;
    await this.channel.send({ type: 'broadcast', event: 'music', payload: state });
  }

  /** Broadcast our own mic-mute / deafen state (stored so late joiners get it). */
  sendStatus(muted: boolean, deafened: boolean) {
    this.status = { userId: this.me.userId, muted, deafened };
    void this.rawSendStatus(this.status);
  }

  private async rawSendStatus(status: StatusPayload) {
    if (!this.ready) return;
    await this.channel.send({ type: 'broadcast', event: 'status', payload: status });
  }

  sendSignal(to: string, data: unknown) {
    void this.channel.send({
      type: 'broadcast',
      event: 'signal',
      payload: { to, from: this.me.userId, data } satisfies SignalPayload,
    });
  }

  async leave() {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
    this.ready = false;
    this.activeMembers.clear();
    await this.channel.untrack();
    await supabase.removeChannel(this.channel);
  }
}
