import type { ItemType, LayoutItem, OfficeLayout } from "../types";

/** Pixel size of one grid cell. */
export const CELL = 40;
export const AVATAR_RADIUS = 14;
/** Avatar movement speed, pixels per animation frame. */
export const MOVE_SPEED_PX = 3.4;

// Proximity voice tuning, in pixels (CELL = 40, so these are ~tiles).
// Full volume out to ~4 tiles, fading to silence by ~8 tiles — generous enough
// that walking near someone is clearly audible, not a faint whisper.
export const HEARING_RANGE = 320;
export const FULL_VOLUME_RANGE = 160;
export const DEFAULT_HEARING_RANGE_TILES = HEARING_RANGE / CELL; // 8
export const VOICE_FULL_FRACTION = FULL_VOLUME_RANGE / HEARING_RANGE; // 0.5
export const MIN_HEARING_RANGE_TILES = 2;
export const MAX_HEARING_RANGE_TILES = 40;

/** An office's voice hearing + full-volume radii in pixels (honors layout.hearingRange). */
export function voiceRanges(layout: { hearingRange?: number }): {
  tiles: number;
  hearing: number;
  full: number;
} {
  const tiles = layout.hearingRange ?? DEFAULT_HEARING_RANGE_TILES;
  const hearing = tiles * CELL;
  return { tiles, hearing, full: hearing * VOICE_FULL_FRACTION };
}

// Speaker (music) proximity, in pixels. Music carries further than a voice:
// full volume within ~3 tiles, fading to silence by ~12 tiles. Each speaker's
// reach is customizable per item (LayoutItem.range, in tiles); these are the
// defaults and the fixed inner/outer ratio used when scaling a custom range.
export const SPEAKER_HEARING_RANGE = 480;
export const SPEAKER_FULL_VOLUME_RANGE = 120;
export const DEFAULT_SPEAKER_RANGE_TILES = SPEAKER_HEARING_RANGE / CELL; // 12
export const SPEAKER_FULL_FRACTION =
  SPEAKER_FULL_VOLUME_RANGE / SPEAKER_HEARING_RANGE; // 0.25
export const MIN_SPEAKER_RANGE_TILES = 2;
export const MAX_SPEAKER_RANGE_TILES = 40;

/** A speaker's hearing radius and full-volume radius in pixels (honors item.range). */
export function speakerRanges(item: { range?: number }): {
  tiles: number;
  hearing: number;
  full: number;
} {
  const tiles = item.range ?? DEFAULT_SPEAKER_RANGE_TILES;
  const hearing = tiles * CELL;
  return { tiles, hearing, full: hearing * SPEAKER_FULL_FRACTION };
}

/**
 * Linear volume falloff between a full-volume radius and a silence radius.
 * Shared by proximity voice and speaker music so they behave consistently.
 */
export function volumeForDistance(
  dist: number,
  fullRange: number,
  hearingRange: number,
): number {
  if (dist <= fullRange) return 1;
  if (dist >= hearingRange) return 0;
  return 1 - (dist - fullRange) / (hearingRange - fullRange);
}

export interface ItemMeta {
  type: ItemType;
  label: string;
  /** Fill color on the canvas. */
  color: string;
  /** Default footprint in cells when placed from the palette. */
  defaultW: number;
  defaultH: number;
  /** Blocks movement (avatars cannot walk through it). */
  solid: boolean;
  /** A labeled area rather than an object. */
  zone: boolean;
  /** An enclosed audio room: occupants only hear others in the same room. */
  audioRoom: boolean;
  icon: string;
}

export const ITEM_META: Record<ItemType, ItemMeta> = {
  wall: {
    type: "wall",
    label: "Wall",
    color: "#334155",
    defaultW: 1,
    defaultH: 1,
    solid: true,
    zone: false,
    audioRoom: false,
    icon: "🧱",
  },
  desk: {
    type: "desk",
    label: "Desk",
    color: "#92400e",
    defaultW: 2,
    defaultH: 1,
    solid: false,
    zone: false,
    audioRoom: false,
    icon: "🖥️",
  },
  chair: {
    type: "chair",
    label: "Chair",
    color: "#1f2937",
    defaultW: 1,
    defaultH: 1,
    solid: false,
    zone: false,
    audioRoom: false,
    icon: "🪑",
  },
  meeting: {
    type: "meeting",
    label: "Meeting Room",
    color: "#1e3a8a",
    defaultW: 5,
    defaultH: 4,
    solid: false,
    zone: true,
    audioRoom: true,
    icon: "📋",
  },
  lounge: {
    type: "lounge",
    label: "Lounge",
    color: "#3f3f46",
    defaultW: 4,
    defaultH: 3,
    solid: false,
    zone: true,
    audioRoom: false,
    icon: "🛋️",
  },
  plant: {
    type: "plant",
    label: "Plant",
    color: "#166534",
    defaultW: 1,
    defaultH: 1,
    solid: true,
    zone: false,
    audioRoom: false,
    icon: "🪴",
  },
  rug: {
    type: "rug",
    label: "Rug",
    color: "#7c2d12",
    defaultW: 3,
    defaultH: 2,
    solid: false,
    zone: false,
    audioRoom: false,
    icon: "🟫",
  },
  door: {
    type: "door",
    label: "Door",
    color: "#a16207",
    defaultW: 1,
    defaultH: 1,
    solid: false,
    zone: false,
    audioRoom: false,
    icon: "🚪",
  },
  spawn: {
    type: "spawn",
    label: "Spawn Point",
    color: "#0891b2",
    defaultW: 1,
    defaultH: 1,
    solid: false,
    zone: false,
    audioRoom: false,
    icon: "📍",
  },
  speaker: {
    type: "speaker",
    label: "Speaker",
    color: "#6d28d9",
    defaultW: 1,
    defaultH: 1,
    solid: false,
    zone: false,
    audioRoom: false,
    icon: "🔊",
  },
};

export const PALETTE: ItemType[] = [
  "wall",
  "desk",
  "chair",
  "meeting",
  "lounge",
  "plant",
  "rug",
  "door",
  "spawn",
  "speaker",
];

export function makeItem(type: ItemType, x: number, y: number): LayoutItem {
  const meta = ITEM_META[type];
  return {
    id: crypto.randomUUID(),
    type,
    x,
    y,
    w: meta.defaultW,
    h: meta.defaultH,
    label: meta.zone ? meta.label : undefined,
  };
}

/**
 * Procedurally generate a plausible office: a couple of wall-framed meeting
 * rooms (each with a door + an audio zone inside), a lounge, desk/chair
 * clusters, scattered plants, and a spawn point — all collision-free.
 */
export function randomLayout(): OfficeLayout {
  const width = 22 + Math.floor(Math.random() * 10); // 22–31
  const height = 14 + Math.floor(Math.random() * 6); // 14–19
  const items: LayoutItem[] = [];
  const occupied = new Set<string>();

  const key = (x: number, y: number) => `${x},${y}`;
  const inBounds = (x: number, y: number, w: number, h: number) =>
    x >= 0 && y >= 0 && x + w <= width && y + h <= height;
  const isFree = (x: number, y: number, w: number, h: number) => {
    if (!inBounds(x, y, w, h)) return false;
    for (let i = x; i < x + w; i++)
      for (let j = y; j < y + h; j++) if (occupied.has(key(i, j))) return false;
    return true;
  };
  const place = (
    type: ItemType,
    x: number,
    y: number,
    w: number,
    h: number,
    label?: string,
  ) => {
    items.push({ id: crypto.randomUUID(), type, x, y, w, h, label });
    for (let i = x; i < x + w; i++)
      for (let j = y; j < y + h; j++) occupied.add(key(i, j));
  };
  const findFree = (w: number, h: number, tries = 60) => {
    for (let t = 0; t < tries; t++) {
      const x = 1 + Math.floor(Math.random() * (width - w - 1));
      const y = 1 + Math.floor(Math.random() * (height - h - 1));
      if (isFree(x, y, w, h)) return { x, y };
    }
    return null;
  };

  const frameRoom = (rx: number, ry: number, rw: number, rh: number) => {
    const side = Math.floor(Math.random() * 4); // 0 top, 1 bottom, 2 left, 3 right
    const doorX = rx + 1 + Math.floor(Math.random() * (rw - 2));
    const doorY = ry + 1 + Math.floor(Math.random() * (rh - 2));
    for (let x = rx; x < rx + rw; x++) {
      if (side === 0 && x === doorX) place("door", x, ry, 1, 1);
      else place("wall", x, ry, 1, 1);
      if (side === 1 && x === doorX) place("door", x, ry + rh - 1, 1, 1);
      else place("wall", x, ry + rh - 1, 1, 1);
    }
    for (let y = ry + 1; y < ry + rh - 1; y++) {
      if (side === 2 && y === doorY) place("door", rx, y, 1, 1);
      else place("wall", rx, y, 1, 1);
      if (side === 3 && y === doorY) place("door", rx + rw - 1, y, 1, 1);
      else place("wall", rx + rw - 1, y, 1, 1);
    }
    place("meeting", rx + 1, ry + 1, rw - 2, rh - 2, "Meeting Room");
  };

  // Meeting rooms in a shuffled subset of corners.
  const rw = 6 + Math.floor(Math.random() * 2);
  const rh = 4 + Math.floor(Math.random() * 2);
  const corners = [
    { rx: 1, ry: 1 },
    { rx: width - 1 - rw, ry: 1 },
    { rx: 1, ry: height - 1 - rh },
    { rx: width - 1 - rw, ry: height - 1 - rh },
  ].sort(() => Math.random() - 0.5);
  const roomCount = 1 + Math.floor(Math.random() * 2);
  let roomsMade = 0;
  for (const c of corners) {
    if (roomsMade >= roomCount) break;
    if (c.rx >= 1 && c.ry >= 1 && isFree(c.rx, c.ry, rw, rh)) {
      frameRoom(c.rx, c.ry, rw, rh);
      roomsMade++;
    }
  }

  // Lounge.
  const lounge = findFree(5, 3);
  if (lounge) place("lounge", lounge.x, lounge.y, 5, 3, "Lounge");

  // Desk + chair clusters.
  const deskCount = 5 + Math.floor(Math.random() * 5);
  for (let i = 0; i < deskCount; i++) {
    const spot = findFree(2, 2);
    if (!spot) continue;
    place("desk", spot.x, spot.y, 2, 1);
    place("chair", spot.x, spot.y + 1, 1, 1);
  }

  // Plants.
  const plantCount = 3 + Math.floor(Math.random() * 4);
  for (let i = 0; i < plantCount; i++) {
    const spot = findFree(1, 1);
    if (spot) place("plant", spot.x, spot.y, 1, 1);
  }

  // Spawn point.
  const spawn = findFree(1, 1);
  if (spawn) place("spawn", spawn.x, spawn.y, 1, 1);

  return { width, height, items };
}

/** The pixel point where avatars should spawn (first spawn item, else center). */
export function spawnPoint(layout: OfficeLayout): { x: number; y: number } {
  const spawn = layout.items.find((i) => i.type === "spawn");
  if (spawn) {
    return {
      x: (spawn.x + spawn.w / 2) * CELL,
      y: (spawn.y + spawn.h / 2) * CELL,
    };
  }
  return { x: (layout.width * CELL) / 2, y: (layout.height * CELL) / 2 };
}

/**
 * Resolve a desired move against solid items using axis-separated AABB
 * collision, so avatars slide along walls instead of sticking.
 */
export function resolveMove(
  layout: OfficeLayout,
  from: { x: number; y: number },
  to: { x: number; y: number },
): { x: number; y: number } {
  const solids = layout.items.filter((i) => ITEM_META[i.type].solid);
  const r = AVATAR_RADIUS;
  const maxX = layout.width * CELL;
  const maxY = layout.height * CELL;

  const hits = (px: number, py: number) =>
    solids.some((s) => {
      const left = s.x * CELL;
      const top = s.y * CELL;
      const right = (s.x + s.w) * CELL;
      const bottom = (s.y + s.h) * CELL;
      return px + r > left && px - r < right && py + r > top && py - r < bottom;
    });

  let nx = Math.max(r, Math.min(maxX - r, to.x));
  let ny = Math.max(r, Math.min(maxY - r, to.y));

  // Try X movement, then Y movement independently.
  if (hits(nx, from.y)) nx = from.x;
  if (hits(nx, ny)) ny = from.y;
  return { x: nx, y: ny };
}

/** Which zone (meeting/lounge) a point falls inside, for the "who's where" list. */
export function zoneLabelAt(
  layout: OfficeLayout,
  x: number,
  y: number,
): string {
  const zone = layout.items.find((i) => {
    if (!ITEM_META[i.type].zone) return false;
    const left = i.x * CELL;
    const top = i.y * CELL;
    return (
      x >= left && x <= left + i.w * CELL && y >= top && y <= top + i.h * CELL
    );
  });
  if (!zone) return "Open floor";
  return zone.label ?? ITEM_META[zone.type].label;
}

/** The enclosed audio room (e.g. meeting room) containing a point, if any. */
export function roomAt(
  layout: OfficeLayout,
  x: number,
  y: number,
): LayoutItem | null {
  // Iterate topmost-first so nested/overlapping rooms resolve predictably.
  for (let i = layout.items.length - 1; i >= 0; i--) {
    const it = layout.items[i];
    if (!ITEM_META[it.type].audioRoom) continue;
    const left = it.x * CELL;
    const top = it.y * CELL;
    if (
      x >= left &&
      x <= left + it.w * CELL &&
      y >= top &&
      y <= top + it.h * CELL
    )
      return it;
  }
  return null;
}

// Cache the set of solid grid cells per layout (stable during a room session).
let _solidCache: { layout: OfficeLayout; cells: Set<string> } | null = null;
function solidCells(layout: OfficeLayout): Set<string> {
  if (_solidCache?.layout === layout) return _solidCache.cells;
  const cells = new Set<string>();
  for (const it of layout.items) {
    if (!ITEM_META[it.type].solid) continue;
    for (let cx = it.x; cx < it.x + it.w; cx++)
      for (let cy = it.y; cy < it.y + it.h; cy++) cells.add(`${cx},${cy}`);
  }
  _solidCache = { layout, cells };
  return cells;
}

/** True if any solid object (wall, desk, chair, plant, …) sits on the straight line a→b. */
export function lineBlockedBySolids(
  layout: OfficeLayout,
  a: { x: number; y: number },
  b: { x: number; y: number },
): boolean {
  const cells = solidCells(layout);
  if (cells.size === 0) return false;
  const dist = Math.hypot(a.x - b.x, a.y - b.y);
  const steps = Math.max(2, Math.ceil(dist / (CELL / 4)));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const px = a.x + (b.x - a.x) * t;
    const py = a.y + (b.y - a.y) * t;
    if (cells.has(`${Math.floor(px / CELL)},${Math.floor(py / CELL)}`))
      return true;
  }
  return false;
}

/**
 * Grid BFS path (as pixel waypoints, excluding the start cell) from `from` to
 * `to`, routing around solid objects. 8-directional with no corner-cutting.
 * Returns null if unreachable. Used to make "follow" walk around walls.
 */
export function findPath(
  layout: OfficeLayout,
  from: { x: number; y: number },
  to: { x: number; y: number },
): { x: number; y: number }[] | null {
  const W = layout.width;
  const H = layout.height;
  const cells = solidCells(layout);
  const blocked = (x: number, y: number) =>
    x < 0 || y < 0 || x >= W || y >= H || cells.has(`${x},${y}`);
  const key = (x: number, y: number) => `${x},${y}`;
  const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, v));

  // Snap start/target to the nearest free cell if they sit on a solid.
  const nearestFree = (cx: number, cy: number): [number, number] | null => {
    if (!blocked(cx, cy)) return [cx, cy];
    for (let r = 1; r <= 4; r++)
      for (let dx = -r; dx <= r; dx++)
        for (let dy = -r; dy <= r; dy++)
          if (
            Math.max(Math.abs(dx), Math.abs(dy)) === r &&
            !blocked(cx + dx, cy + dy)
          )
            return [cx + dx, cy + dy];
    return null;
  };

  const s = nearestFree(
    clamp(Math.floor(from.x / CELL), W - 1),
    clamp(Math.floor(from.y / CELL), H - 1),
  );
  const t = nearestFree(
    clamp(Math.floor(to.x / CELL), W - 1),
    clamp(Math.floor(to.y / CELL), H - 1),
  );
  if (!s || !t) return null;
  const [sx, sy] = s;
  const [tx, ty] = t;
  if (sx === tx && sy === ty) return [];

  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  const prev = new Map<string, string | null>();
  prev.set(key(sx, sy), null);
  const queue: [number, number][] = [[sx, sy]];
  let found = false;
  for (let head = 0; head < queue.length; head++) {
    const [x, y] = queue[head];
    if (x === tx && y === ty) {
      found = true;
      break;
    }
    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (blocked(nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (blocked(x + dx, y) || blocked(x, y + dy)))
        continue;
      const k = key(nx, ny);
      if (prev.has(k)) continue;
      prev.set(k, key(x, y));
      queue.push([nx, ny]);
    }
  }
  if (!found) return null;

  const path: { x: number; y: number }[] = [];
  let cur: string | null = key(tx, ty);
  while (cur) {
    const [cx, cy] = cur.split(",").map(Number);
    path.push({ x: (cx + 0.5) * CELL, y: (cy + 0.5) * CELL });
    cur = prev.get(cur) ?? null;
  }
  path.reverse();
  path.shift(); // drop the start cell
  return path;
}

/** True if a wall sits on the straight line between two points (sound occlusion). */
export function wallBetween(
  layout: OfficeLayout,
  a: { x: number; y: number },
  b: { x: number; y: number },
): boolean {
  const walls = layout.items.filter((i) => i.type === "wall");
  if (walls.length === 0) return false;
  const wallCells = new Set<string>();
  for (const w of walls) {
    for (let cx = w.x; cx < w.x + w.w; cx++) {
      for (let cy = w.y; cy < w.y + w.h; cy++) wallCells.add(`${cx},${cy}`);
    }
  }
  // Sample along the segment; if any sample lands in a wall cell, it's blocked.
  const dist = Math.hypot(a.x - b.x, a.y - b.y);
  const steps = Math.max(2, Math.ceil(dist / (CELL / 4)));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const px = a.x + (b.x - a.x) * t;
    const py = a.y + (b.y - a.y) * t;
    if (wallCells.has(`${Math.floor(px / CELL)},${Math.floor(py / CELL)}`))
      return true;
  }
  return false;
}

/**
 * Effective distance for proximity voice, accounting for rooms and walls.
 * - Both in the same meeting room → 0 (full volume anywhere in the room).
 * - One in a room, the other elsewhere / a different room → Infinity (blocked).
 * - A wall between the two of them → Infinity (walls block sound).
 * - Otherwise → true physical distance.
 */
export function audioDistance(
  layout: OfficeLayout,
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const roomA = roomAt(layout, a.x, a.y);
  const roomB = roomAt(layout, b.x, b.y);
  if (roomA || roomB) {
    return roomA && roomB && roomA.id === roomB.id ? 0 : Infinity;
  }
  if (wallBetween(layout, a, b)) return Infinity;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Effective distance (pixels) from a listener to the nearest speaker item,
 * using the same room/wall occlusion as proximity voice. Infinity when no
 * speaker is audible (none placed, all walled off, or wrong room).
 */
/**
 * Loudest speaker-music volume (0..1) a listener should hear — the max across
 * every speaker, each using its own range and the same room/wall occlusion as
 * voice. Speakers in `muted` are skipped (this listener silenced them).
 */
export function speakerVolumeAt(
  layout: OfficeLayout,
  listener: { x: number; y: number },
  muted?: Set<string>,
  gains?: Map<string, number>,
): number {
  let vol = 0;
  for (const item of layout.items) {
    if (item.type !== "speaker") continue;
    if (muted?.has(item.id)) continue;
    const gain = gains?.get(item.id) ?? 1;
    if (gain <= 0) continue; // this listener turned it all the way down
    const center = {
      x: (item.x + item.w / 2) * CELL,
      y: (item.y + item.h / 2) * CELL,
    };
    const dist = audioDistance(layout, listener, center);
    const { hearing, full } = speakerRanges(item);
    vol = Math.max(vol, volumeForDistance(dist, full, hearing) * gain);
    if (vol >= 1) break;
  }
  return vol;
}

/** How loud one speaker is for a listener (0..1), before any personal gain/mute. */
export function speakerProximity(
  layout: OfficeLayout,
  listener: { x: number; y: number },
  item: LayoutItem,
): number {
  const { hearing, full } = speakerRanges(item);
  return volumeForDistance(speakerDistance(layout, listener, item), full, hearing);
}

/** Audio distance (px) from a listener to a speaker's center — Infinity through walls / room boundaries. */
export function speakerDistance(
  layout: OfficeLayout,
  listener: { x: number; y: number },
  item: LayoutItem,
): number {
  const center = {
    x: (item.x + item.w / 2) * CELL,
    y: (item.y + item.h / 2) * CELL,
  };
  return audioDistance(layout, listener, center);
}

/** The speaker item at a pixel point (with a little padding for easy tapping), else null. */
export function speakerAt(
  layout: OfficeLayout,
  x: number,
  y: number,
  pad = CELL * 0.35,
): LayoutItem | null {
  for (let i = layout.items.length - 1; i >= 0; i--) {
    const it = layout.items[i];
    if (it.type !== "speaker") continue;
    const left = it.x * CELL - pad;
    const top = it.y * CELL - pad;
    const right = (it.x + it.w) * CELL + pad;
    const bottom = (it.y + it.h) * CELL + pad;
    if (x >= left && x <= right && y >= top && y <= bottom) return it;
  }
  return null;
}

/** True if the layout has at least one speaker item placed. */
export function hasSpeaker(layout: OfficeLayout): boolean {
  return layout.items.some((i) => i.type === "speaker");
}

/**
 * Whether an item occupies its cells exclusively for placement. Zones (meeting
 * rooms, lounges) and rugs are floor areas you can put furniture on top of, so
 * they don't block; every other object (walls, desks, chairs, plants, doors,
 * spawn, speaker) can't overlap another blocking object.
 */
export function placementBlocks(type: ItemType): boolean {
  return !ITEM_META[type].zone && type !== "rug";
}

/**
 * True if a footprint (in cells) is free of blocking objects, so an item of
 * `type` may be placed/moved/resized there. `ignoreId` skips the item itself.
 */
export function footprintFree(
  layout: OfficeLayout,
  x: number,
  y: number,
  w: number,
  h: number,
  type: ItemType,
  ignore?: string | Set<string>,
): boolean {
  if (!placementBlocks(type)) return true; // zones & rugs may overlap freely
  const ignored = (id: string) =>
    typeof ignore === "string" ? id === ignore : !!ignore?.has(id);
  for (const it of layout.items) {
    if (ignored(it.id) || !placementBlocks(it.type)) continue;
    const overlap =
      x < it.x + it.w && x + w > it.x && y < it.y + it.h && y + h > it.y;
    if (overlap) return false;
  }
  return true;
}
