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

export type ItemCategory = "structure" | "furniture" | "area" | "utility";

export interface ItemMeta {
  type: ItemType;
  label: string;
  /** One-line explanation of what the item *does* in the office. */
  description: string;
  category: ItemCategory;
  /** Fill color on the canvas. */
  color: string;
  /** Default footprint in cells when placed from the palette. */
  defaultW: number;
  defaultH: number;
  /** Blocks movement (avatars cannot walk through it). */
  solid: boolean;
  /** Blocks voice and music passing through it (walls, shelves). */
  blocksSound: boolean;
  /** A labeled area rather than an object. */
  zone: boolean;
  /** An enclosed audio room: occupants only hear others in the same room. */
  audioRoom: boolean;
  /** Part of the barrier family that visually joins to its neighbours (walls, glass, doors). */
  connects: boolean;
  /** Can be drag-painted in the editor (one tile per cell). */
  paintable: boolean;
  icon: string;
}

const base = {
  solid: false,
  blocksSound: false,
  zone: false,
  audioRoom: false,
  connects: false,
  paintable: false,
} as const;

export const ITEM_META: Record<ItemType, ItemMeta> = {
  // ── Structure ────────────────────────────────────────────────────────────
  wall: {
    ...base,
    type: "wall",
    label: "Wall",
    description: "Nobody can walk or talk through it. Use it to split the floor into spaces.",
    category: "structure",
    color: "#475569",
    defaultW: 1,
    defaultH: 1,
    solid: true,
    blocksSound: true,
    connects: true,
    paintable: true,
    icon: "🧱",
  },
  glass: {
    ...base,
    type: "glass",
    label: "Glass Wall",
    description: "See-through partition. Blocks walking, but voices carry across it.",
    category: "structure",
    color: "#0e7490",
    defaultW: 1,
    defaultH: 1,
    solid: true,
    connects: true,
    paintable: true,
    icon: "🪟",
  },
  door: {
    ...base,
    type: "door",
    label: "Door",
    description: "A gap in a wall people can walk through. It snaps into the wall line around it.",
    category: "structure",
    color: "#b45309",
    defaultW: 1,
    defaultH: 1,
    connects: true,
    icon: "🚪",
  },
  // ── Furniture ────────────────────────────────────────────────────────────
  desk: {
    ...base,
    type: "desk",
    label: "Desk",
    description: "A workstation. Pair it with a chair to mark where someone sits.",
    category: "furniture",
    color: "#92400e",
    defaultW: 2,
    defaultH: 1,
    icon: "🖥️",
  },
  chair: {
    ...base,
    type: "chair",
    label: "Chair",
    description: "A seat. Walkable, so people can stand right where they work.",
    category: "furniture",
    color: "#374151",
    defaultW: 1,
    defaultH: 1,
    icon: "🪑",
  },
  shelf: {
    ...base,
    type: "shelf",
    label: "Bookshelf",
    description: "Tall storage that soaks up sound. Use it as a quiet divider between desk groups.",
    category: "furniture",
    color: "#78350f",
    defaultW: 2,
    defaultH: 1,
    solid: true,
    blocksSound: true,
    icon: "📚",
  },
  whiteboard: {
    ...base,
    type: "whiteboard",
    label: "Whiteboard",
    description: "A spot to gather around and brainstorm. Blocks walking, not voices.",
    category: "furniture",
    color: "#64748b",
    defaultW: 2,
    defaultH: 1,
    solid: true,
    icon: "📝",
  },
  coffee: {
    ...base,
    type: "coffee",
    label: "Coffee Bar",
    description: "A counter where people bump into each other for a quick chat.",
    category: "furniture",
    color: "#7c2d12",
    defaultW: 2,
    defaultH: 1,
    solid: true,
    icon: "☕",
  },
  plant: {
    ...base,
    type: "plant",
    label: "Plant",
    description: "Decoration that blocks walking. Good for framing paths and corners.",
    category: "furniture",
    color: "#166534",
    defaultW: 1,
    defaultH: 1,
    solid: true,
    icon: "🪴",
  },
  rug: {
    ...base,
    type: "rug",
    label: "Rug",
    description: "Floor decoration. Furniture can sit on top of it.",
    category: "furniture",
    color: "#7c2d12",
    defaultW: 3,
    defaultH: 2,
    icon: "🟫",
  },
  // ── Areas ────────────────────────────────────────────────────────────────
  meeting: {
    ...base,
    type: "meeting",
    label: "Meeting Room",
    description: "Private audio. Everyone inside hears each other at full volume and nobody outside can listen in.",
    category: "area",
    color: "#1e40af",
    defaultW: 5,
    defaultH: 4,
    zone: true,
    audioRoom: true,
    icon: "📋",
  },
  booth: {
    ...base,
    type: "booth",
    label: "Phone Booth",
    description: "A tiny private room for 1:1s or calls. Works like a meeting room, sized for two.",
    category: "area",
    color: "#0f766e",
    defaultW: 2,
    defaultH: 2,
    zone: true,
    audioRoom: true,
    icon: "📞",
  },
  lounge: {
    ...base,
    type: "lounge",
    label: "Lounge",
    description: "A named open area. Shows up as people's location, but sound works normally.",
    category: "area",
    color: "#52525b",
    defaultW: 4,
    defaultH: 3,
    zone: true,
    icon: "🛋️",
  },
  // ── Utility ──────────────────────────────────────────────────────────────
  speaker: {
    ...base,
    type: "speaker",
    label: "Speaker",
    description: "Plays shared music to everyone in range. Walls and rooms block it like voices.",
    category: "utility",
    color: "#6d28d9",
    defaultW: 1,
    defaultH: 1,
    icon: "🔊",
  },
  spawn: {
    ...base,
    type: "spawn",
    label: "Spawn Point",
    description: "Where people appear when they join the office.",
    category: "utility",
    color: "#0891b2",
    defaultW: 1,
    defaultH: 1,
    icon: "📍",
  },
};

export const CATEGORIES: { id: ItemCategory; label: string; items: ItemType[] }[] = [
  { id: "structure", label: "Structure", items: ["wall", "glass", "door"] },
  {
    id: "furniture",
    label: "Furniture",
    items: ["desk", "chair", "shelf", "whiteboard", "coffee", "plant", "rug"],
  },
  { id: "area", label: "Areas", items: ["meeting", "booth", "lounge"] },
  { id: "utility", label: "Utility", items: ["speaker", "spawn"] },
];

export const PALETTE: ItemType[] = CATEGORIES.flatMap((c) => c.items);

export type EffectTone = "block" | "sound" | "private" | "open";

/** Human-readable gameplay effects of an item, for the editor UI. */
export function itemEffects(type: ItemType): { label: string; tone: EffectTone }[] {
  const m = ITEM_META[type];
  const out: { label: string; tone: EffectTone }[] = [];
  if (m.audioRoom) out.push({ label: "Private audio", tone: "private" });
  if (m.solid) out.push({ label: "Blocks movement", tone: "block" });
  else if (!m.zone) out.push({ label: "Walkable", tone: "open" });
  if (m.blocksSound) out.push({ label: "Blocks sound", tone: "sound" });
  else if (m.solid) out.push({ label: "Sound passes", tone: "open" });
  return out;
}

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

/**
 * A hand-designed 32×20 office that showcases every item:
 *
 *   ┌ Boardroom ─┬ Booth ┬ Booth ┬─────────────┬ Café ──────────┐
 *   │ whiteboard │ glass │ glass │  open desks │ coffee · rug   │
 *   ├────door────┴──door─┴──door─┘             │ speaker        │
 *   │                                          └─glass─(open)───┤
 *   │ plants          desk pods         plants                  │
 *   ├ shelves ─┐                              ┌────── Huddle ───┤
 *   │ Library  │          reception rug       door   table      │
 *   └──────────┴───────────── door door ──────┴─────────────────┘
 */
export function officeTemplate(): OfficeLayout {
  const width = 32;
  const height = 20;
  const items: LayoutItem[] = [];
  const add = (type: ItemType, x: number, y: number, w = 1, h = 1, extra: Partial<LayoutItem> = {}) =>
    items.push({ id: crypto.randomUUID(), type, x, y, w, h, ...extra });
  /** A straight 1-tile-thick barrier line; `doors` are cells that become doors instead. */
  const line = (
    type: "wall" | "glass",
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    doors: [number, number][] = [],
  ) => {
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        add(doors.some(([dx, dy]) => dx === x && dy === y) ? "door" : type, x, y);
  };

  // ── Outer shell, entrance at the bottom centre ──────────────────────────
  line("wall", 0, 0, width - 1, 0);
  line("wall", 0, height - 1, width - 1, height - 1, [
    [15, height - 1],
    [16, height - 1],
  ]);
  line("wall", 0, 1, 0, height - 2);
  line("wall", width - 1, 1, width - 1, height - 2);

  // ── Boardroom (top-left): private audio, whiteboard + long table ────────
  line("wall", 9, 1, 9, 6);
  line("wall", 1, 6, 8, 6, [[5, 6]]);
  add("meeting", 1, 1, 8, 5, { label: "Boardroom" });
  add("whiteboard", 4, 1, 3, 1);
  add("desk", 4, 3, 3, 1);
  for (const x of [4, 5, 6]) {
    add("chair", x, 2);
    add("chair", x, 4);
  }
  add("chair", 3, 3);
  add("chair", 7, 3);
  add("plant", 1, 5);
  add("plant", 8, 1);

  // ── Phone booths (glass-fronted, private audio) ─────────────────────────
  line("glass", 13, 1, 13, 2);
  line("wall", 17, 1, 17, 3);
  line("glass", 10, 3, 16, 3, [
    [11, 3],
    [15, 3],
  ]);
  add("booth", 10, 1, 3, 2, { label: "Booth 1" });
  add("booth", 14, 1, 3, 2, { label: "Booth 2" });
  add("chair", 10, 2);
  add("chair", 14, 2);

  // ── Café (top-right): glass-walled, coffee bar, rug seating, speaker ────
  line("glass", 21, 1, 21, 7, [[21, 4]]);
  line("glass", 22, 7, 30, 7, [[26, 7]]);
  add("lounge", 22, 1, 9, 6, { label: "Café" });
  add("coffee", 26, 1, 4, 1);
  add("rug", 24, 3, 5, 3);
  for (const [x, y] of [
    [24, 3],
    [28, 3],
    [24, 5],
    [28, 5],
  ])
    add("chair", x, y);
  add("desk", 26, 4, 1, 1);
  add("plant", 30, 1);
  add("plant", 22, 6);
  add("speaker", 30, 5, 1, 1, { range: 6 });

  // ── Open desk area (centre): six face-to-face pods ──────────────────────
  for (const x of [11, 14, 17]) {
    for (const top of [5, 10]) {
      add("chair", x, top);
      add("chair", x + 1, top);
      add("desk", x, top + 1, 2, 1);
      add("desk", x, top + 2, 2, 1);
      add("chair", x, top + 3);
      add("chair", x + 1, top + 3);
    }
  }
  add("plant", 10, 7);
  add("plant", 20, 7);
  add("plant", 10, 12);
  add("plant", 20, 12);

  // ── Quiet library (bottom-left): shelves block noise from the floor ─────
  add("shelf", 1, 12, 2, 1);
  add("shelf", 3, 12, 2, 1);
  add("shelf", 7, 12, 2, 1);
  line("wall", 9, 12, 9, 18);
  add("lounge", 1, 13, 8, 5, { label: "Quiet Library" });
  add("desk", 2, 15, 2, 1);
  add("desk", 5, 15, 3, 1);
  for (const x of [2, 3, 5, 6, 7]) add("chair", x, 16);
  add("plant", 8, 13);
  add("shelf", 1, 18, 4, 1);
  add("shelf", 5, 18, 4, 1);

  // ── Huddle room (bottom-right) ──────────────────────────────────────────
  line("wall", 23, 12, 30, 12);
  line("wall", 23, 13, 23, 18, [[23, 15]]);
  add("meeting", 24, 13, 7, 6, { label: "Huddle Room" });
  add("desk", 26, 15, 3, 2);
  for (const x of [26, 27, 28]) {
    add("chair", x, 14);
    add("chair", x, 17);
  }
  add("whiteboard", 30, 14, 1, 3);
  add("plant", 24, 18);

  // ── Reception (bottom centre): welcome rug, spawn, plants ───────────────
  add("rug", 13, 15, 6, 3);
  add("spawn", 15, 16);
  add("plant", 11, 17);
  add("plant", 20, 17);

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

type Box = { l: number; t: number; r: number; b: number };

/** Collision half-thickness of walls/glass — matches how they're drawn. */
const WALL_HALF = 7;
/** How far (px) movement will auto-slide sideways to line you up with a gap. */
const CORNER_ASSIST = 24;

/**
 * Collision boxes for every solid item. Walls and glass use their *drawn*
 * shape — a thin post plus arms toward neighbouring barriers — rather than the
 * whole 40px tile, so doorways are as wide as they look. Arms toward a door
 * stop at the tile edge, leaving the full door tile open.
 */
let _boxCache: { layout: OfficeLayout; boxes: Box[] } | null = null;
function collisionBoxes(layout: OfficeLayout): Box[] {
  if (_boxCache?.layout === layout) return _boxCache.boxes;
  const boxes: Box[] = [];
  const barrier = new Map<string, ItemType>();
  for (const it of layout.items) {
    if (!ITEM_META[it.type].connects) continue;
    for (let cx = it.x; cx < it.x + it.w; cx++)
      for (let cy = it.y; cy < it.y + it.h; cy++) barrier.set(`${cx},${cy}`, it.type);
  }
  for (const it of layout.items) {
    const meta = ITEM_META[it.type];
    if (!meta.solid) continue;
    if (!meta.connects) {
      boxes.push({ l: it.x * CELL, t: it.y * CELL, r: (it.x + it.w) * CELL, b: (it.y + it.h) * CELL });
      continue;
    }
    for (let cx = it.x; cx < it.x + it.w; cx++)
      for (let cy = it.y; cy < it.y + it.h; cy++) {
        const mx = (cx + 0.5) * CELL;
        const my = (cy + 0.5) * CELL;
        const h = WALL_HALF;
        boxes.push({ l: mx - h, t: my - h, r: mx + h, b: my + h });
        const linked = (dx: number, dy: number) => barrier.has(`${cx + dx},${cy + dy}`);
        if (linked(-1, 0)) boxes.push({ l: cx * CELL, t: my - h, r: mx, b: my + h });
        if (linked(1, 0)) boxes.push({ l: mx, t: my - h, r: (cx + 1) * CELL, b: my + h });
        if (linked(0, -1)) boxes.push({ l: mx - h, t: cy * CELL, r: mx + h, b: my });
        if (linked(0, 1)) boxes.push({ l: mx - h, t: my, r: mx + h, b: (cy + 1) * CELL });
      }
  }
  _boxCache = { layout, boxes };
  return boxes;
}

/**
 * Resolve a desired move against solid items. Avatars are circles tested
 * against boxes, axis-separated so they slide along walls. When a straight-on
 * move is blocked by a corner (e.g. a door frame), the avatar is nudged
 * sideways toward the nearest opening so doors don't need pixel precision.
 */
export function resolveMove(
  layout: OfficeLayout,
  from: { x: number; y: number },
  to: { x: number; y: number },
): { x: number; y: number } {
  const boxes = collisionBoxes(layout);
  const r = AVATAR_RADIUS;
  const maxX = layout.width * CELL;
  const maxY = layout.height * CELL;

  const hits = (px: number, py: number) =>
    boxes.some((s) => {
      const qx = Math.max(s.l, Math.min(px, s.r));
      const qy = Math.max(s.t, Math.min(py, s.b));
      return (px - qx) ** 2 + (py - qy) ** 2 < r * r;
    });

  const tx = Math.max(r, Math.min(maxX - r, to.x));
  const ty = Math.max(r, Math.min(maxY - r, to.y));
  const dx = tx - from.x;
  const dy = ty - from.y;
  const speed = Math.max(Math.abs(dx), Math.abs(dy));

  let nx = tx;
  let ny = ty;
  if (hits(nx, from.y)) nx = from.x;
  if (hits(nx, ny)) ny = from.y;

  // Corner assist: moving mostly along one axis but blocked → find the nearest
  // sideways offset where the move would succeed and drift toward it.
  const assist = (blockedAlong: "x" | "y") => {
    for (let s = 1; s <= CORNER_ASSIST; s++) {
      for (const sign of [1, -1]) {
        const off = s * sign;
        const ok =
          blockedAlong === "x"
            ? !hits(from.x, from.y + off) && !hits(tx, from.y + off)
            : !hits(from.x + off, from.y) && !hits(from.x + off, ty);
        if (ok) return Math.sign(off) * Math.min(s, speed);
      }
    }
    return 0;
  };
  if (nx === from.x && Math.abs(dx) > 0 && Math.abs(dy) < Math.abs(dx) * 0.5) {
    const shift = assist("x");
    if (shift && !hits(from.x, from.y + shift)) ny = from.y + shift;
  } else if (ny === from.y && Math.abs(dy) > 0 && Math.abs(dx) < Math.abs(dy) * 0.5) {
    const shift = assist("y");
    if (shift && !hits(from.x + shift, from.y)) nx = from.x + shift;
  }
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

/** True if a sound-blocking item (wall, shelf) sits between two points (sound occlusion). */
export function wallBetween(
  layout: OfficeLayout,
  a: { x: number; y: number },
  b: { x: number; y: number },
): boolean {
  const walls = layout.items.filter((i) => ITEM_META[i.type].blocksSound);
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
