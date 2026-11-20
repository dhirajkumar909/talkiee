// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  color: string;
  created_at: string;
}

export interface Office {
  id: string;
  owner_id: string;
  name: string;
  layout: OfficeLayout;
  created_at: string;
  updated_at: string;
}

export interface OfficeMember {
  office_id: string;
  user_id: string;
  role: 'owner' | 'member';
  created_at: string;
}

export interface OfficeInvite {
  id: string;
  office_id: string;
  inviter_id: string;
  invitee_id: string;
  status: 'pending' | 'accepted' | 'declined';
  created_at: string;
}

// ---------------------------------------------------------------------------
// Office layout (stored as JSON in offices.layout)
// ---------------------------------------------------------------------------

export type ItemType =
  | 'wall'
  | 'desk'
  | 'chair'
  | 'meeting'
  | 'lounge'
  | 'plant'
  | 'rug'
  | 'door'
  | 'spawn'
  | 'speaker'
  | 'glass'
  | 'shelf'
  | 'whiteboard'
  | 'coffee'
  | 'booth';

export interface LayoutItem {
  id: string;
  type: ItemType;
  /** Grid coordinates (cells), top-left origin. */
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
  /** Speaker only: hearing radius in tiles (defaults to DEFAULT_SPEAKER_RANGE_TILES). */
  range?: number;
}

export interface OfficeLayout {
  /** Floor size in grid cells. */
  width: number;
  height: number;
  items: LayoutItem[];
  /** Voice hearing radius in tiles (defaults to DEFAULT_HEARING_RANGE_TILES). */
  hearingRange?: number;
}

export const DEFAULT_LAYOUT: OfficeLayout = { width: 24, height: 16, items: [] };

// ---------------------------------------------------------------------------
// Realtime wire types (Supabase broadcast / presence)
// ---------------------------------------------------------------------------

export interface PresenceState {
  userId: string;
  name: string;
  color: string;
  x: number;
  y: number;
  /** Smoothed on-screen position (interpolates toward x/y); set by the renderer. */
  rx?: number;
  ry?: number;
  /** Their own mic muted? (broadcast; shown on their avatar) */
  muted?: boolean;
  /** They've deafened themselves? (broadcast; shown on their avatar) */
  deafened?: boolean;
  /** They are in Do Not Disturb mode? (broadcast; visual bubble) */
  dnd?: boolean;
  /** Accumulated distance walked on-screen (used for footstep sfx). */
  distWalked?: number;
}

/** Broadcast when a user toggles their own mic-mute / deafen / dnd. */
export interface StatusPayload {
  userId: string;
  muted: boolean;
  deafened: boolean;
  dnd: boolean;
}

export interface MovePayload {
  userId: string;
  x: number;
  y: number;
}

export interface SignalPayload {
  to: string;
  from: string;
  data: unknown;
}

export interface ChatMessagePayload {
  userId: string;
  name: string;
  text: string;
  timestamp: number;
}

/** Broadcast when a user reacts with an emoji. */
export interface ReactionPayload {
  userId: string;
  emoji: string;
  timestamp: number;
}

/**
 * "Now playing" state for ONE speaker, broadcast over the realtime channel.
 * Every speaker has its own channel: when `playing` is true, every client plays
 * `src` locally at a volume scaled by proximity to that speaker.
 */
export interface MusicState {
  /** The speaker item this state belongs to. */
  speakerId: string;
  playing: boolean;
  /**
   * 'stream' = direct audio URL (radio); 'youtube' = a single video id;
   * 'youtube_playlist' = a playlist id (plays the whole list, looping).
   */
  kind: 'stream' | 'youtube' | 'youtube_playlist';
  /** Stream URL, YouTube video id, or playlist id (empty when stopped). */
  src: string;
  /** Human label shown in the panel ("Lofi Beats", "YouTube", …). */
  name: string;
  /** userId of whoever last changed the music. */
  by: string;
  /** Epoch ms when playback started — lets late joiners seek a YouTube video to the right spot. */
  startedAt: number;
}

// ---------------------------------------------------------------------------
// Supabase typed schema (subset sufficient for our queries)
// ---------------------------------------------------------------------------

type Row<T> = T;
type Insert<T> = Partial<T>;
type Update<T> = Partial<T>;

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Row<Profile>;
        Insert: Insert<Profile>;
        Update: Update<Profile>;
        Relationships: [];
      };
      offices: {
        Row: Row<Office>;
        Insert: Insert<Omit<Office, 'id' | 'created_at' | 'updated_at'>>;
        Update: Update<Office>;
        Relationships: [];
      };
      office_members: {
        Row: Row<OfficeMember>;
        Insert: Insert<OfficeMember>;
        Update: Update<OfficeMember>;
        Relationships: [];
      };
      office_invites: {
        Row: Row<OfficeInvite>;
        Insert: Insert<Omit<OfficeInvite, 'id' | 'created_at'>>;
        Update: Update<OfficeInvite>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      accept_invite: { Args: { p_invite_id: string }; Returns: undefined };
      decline_invite: { Args: { p_invite_id: string }; Returns: undefined };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
