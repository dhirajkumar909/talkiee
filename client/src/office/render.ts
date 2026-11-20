import type { LayoutItem, OfficeLayout, PresenceState, ReactionPayload } from '../types';
import { CELL, AVATAR_RADIUS, HEARING_RANGE, ITEM_META, speakerRanges } from './layout';

const avatarImageCache = new Map<string, HTMLImageElement>();
function getAvatarImage(url: string | null | undefined): HTMLImageElement | null {
  if (!url) return null;
  if (avatarImageCache.has(url)) return avatarImageCache.get(url)!;
  
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  avatarImageCache.set(url, img);
  return img;
}

/** Highlight the audio room the viewer is currently standing in. */
export function highlightRoom(ctx: CanvasRenderingContext2D, room: LayoutItem) {
  const x = room.x * CELL;
  const y = room.y * CELL;
  const w = room.w * CELL;
  const h = room.h * CELL;
  ctx.save();
  ctx.fillStyle = 'rgba(16,185,129,0.14)';
  roundRect(ctx, x + 2, y + 2, w - 4, h - 4, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(16,185,129,0.8)';
  ctx.lineWidth = 2.5;
  roundRect(ctx, x + 2, y + 2, w - 4, h - 4, 10);
  ctx.stroke();
  ctx.fillStyle = 'rgba(16,185,129,0.95)';
  ctx.font = '600 12px Inter, system-ui';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText('🔇 private room', x + w - 10, y + 10);
  ctx.restore();
}

export interface DrawOptions {
  grid?: boolean;
  selectedId?: string | null;
  selectedIds?: Set<string>;
}

/** Draw the office floor, grid, and all placed items. */
export function drawFloor(
  ctx: CanvasRenderingContext2D,
  layout: OfficeLayout,
  opts: DrawOptions = {},
) {
  const w = layout.width * CELL;
  const h = layout.height * CELL;

  // Floor.
  ctx.fillStyle = '#0b1120';
  ctx.fillRect(0, 0, w, h);

  // Grid lines (editor only).
  if (opts.grid) {
    ctx.strokeStyle = 'rgba(148,163,184,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= layout.width; x++) {
      ctx.moveTo(x * CELL, 0);
      ctx.lineTo(x * CELL, h);
    }
    for (let y = 0; y <= layout.height; y++) {
      ctx.moveTo(0, y * CELL);
      ctx.lineTo(w, y * CELL);
    }
    ctx.stroke();
  }

  // Layering: zones → floor décor (rugs) → furniture → connected barriers.
  const isSelected = (id: string) => opts.selectedId === id || !!opts.selectedIds?.has(id);
  const zones = layout.items.filter((i) => ITEM_META[i.type].zone);
  const rugs = layout.items.filter((i) => i.type === 'rug');
  const furniture = layout.items.filter(
    (i) => !ITEM_META[i.type].zone && !ITEM_META[i.type].connects && i.type !== 'rug',
  );
  for (const item of zones) drawZone(ctx, item);
  for (const item of rugs) drawRug(ctx, item);
  for (const item of furniture) drawObject(ctx, item);
  drawBarriers(ctx, layout);

  // Selection outlines on top of everything.
  for (const item of layout.items) if (isSelected(item.id)) drawSelection(ctx, item);
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

function drawZone(ctx: CanvasRenderingContext2D, item: LayoutItem) {
  const meta = ITEM_META[item.type];
  const x = item.x * CELL;
  const y = item.y * CELL;
  const w = item.w * CELL;
  const h = item.h * CELL;
  ctx.save();
  ctx.fillStyle = meta.color + '40';
  roundRect(ctx, x + 2, y + 2, w - 4, h - 4, 10);
  ctx.fill();
  ctx.strokeStyle = meta.color + 'cc';
  ctx.lineWidth = 2;
  ctx.setLineDash(meta.audioRoom ? [] : [8, 6]);
  roundRect(ctx, x + 2, y + 2, w - 4, h - 4, 10);
  ctx.stroke();
  ctx.setLineDash([]);

  // Label pill.
  const text = `${meta.icon} ${item.label ?? meta.label}`;
  ctx.font = '600 12px Inter, system-ui';
  const tw = Math.min(ctx.measureText(text).width, w - 24);
  ctx.fillStyle = 'rgba(2,6,23,0.55)';
  roundRect(ctx, x + 8, y + 8, tw + 14, 20, 6);
  ctx.fill();
  ctx.fillStyle = 'rgba(241,245,249,0.95)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 15, y + 18, w - 24);
  if (meta.audioRoom && w >= CELL * 3) {
    ctx.font = '500 10px Inter, system-ui';
    ctx.fillStyle = 'rgba(226,232,240,0.6)';
    ctx.textAlign = 'right';
    ctx.fillText('private audio', x + w - 10, y + h - 12);
  }
  ctx.restore();
}

function drawRug(ctx: CanvasRenderingContext2D, item: LayoutItem) {
  const meta = ITEM_META[item.type];
  const x = item.x * CELL;
  const y = item.y * CELL;
  const w = item.w * CELL;
  const h = item.h * CELL;
  ctx.save();
  ctx.fillStyle = meta.color + 'aa';
  roundRect(ctx, x + 4, y + 4, w - 8, h - 8, 8);
  ctx.fill();
  ctx.strokeStyle = 'rgba(254,215,170,0.35)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  roundRect(ctx, x + 9, y + 9, w - 18, h - 18, 5);
  ctx.stroke();
  ctx.restore();
}

/** Furniture: a raised block with a darker front face for depth, plus its icon. */
function drawObject(ctx: CanvasRenderingContext2D, item: LayoutItem) {
  const meta = ITEM_META[item.type];
  const x = item.x * CELL;
  const y = item.y * CELL;
  const w = item.w * CELL;
  const h = item.h * CELL;
  const depth = meta.solid ? 5 : 3;
  const inset = item.type === 'chair' || item.type === 'spawn' || item.type === 'speaker' ? 7 : 4;
  ctx.save();
  // Front face (shadowed).
  ctx.fillStyle = meta.color;
  roundRect(ctx, x + inset, y + inset + depth, w - inset * 2, h - inset * 2 - depth, 7);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  roundRect(ctx, x + inset, y + inset + depth, w - inset * 2, h - inset * 2 - depth, 7);
  ctx.fill();
  // Top face.
  ctx.fillStyle = meta.color;
  roundRect(ctx, x + inset, y + inset, w - inset * 2, h - inset * 2 - depth, 7);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  roundRect(ctx, x + inset + 0.5, y + inset + 0.5, w - inset * 2 - 1, h - inset * 2 - depth - 1, 6.5);
  ctx.stroke();
  // Icon.
  ctx.font = `${Math.min(w, h) * 0.45}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(meta.icon, x + w / 2, y + (h - depth) / 2 + 2);
  ctx.restore();
}

function drawSelection(ctx: CanvasRenderingContext2D, item: LayoutItem) {
  const x = item.x * CELL;
  const y = item.y * CELL;
  const w = item.w * CELL;
  const h = item.h * CELL;
  ctx.save();
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 2.5;
  roundRect(ctx, x + 1, y + 1, w - 2, h - 2, 8);
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Connected barriers (walls / glass / doors)
//
// Connection logic: a barrier tile links to each orthogonal neighbour that is
// also a barrier. Each family is then stroked as ONE path through the tile
// centres with round joins, so touching tiles read as a single continuous
// wall — corners, T-junctions and crosses come for free, with no seams.
// ---------------------------------------------------------------------------

type Barrier = 'wall' | 'glass' | 'door';
type Tile = { cx: number; cy: number; type: Barrier };

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

function barrierMap(layout: OfficeLayout): Map<string, Barrier> {
  const map = new Map<string, Barrier>();
  for (const it of layout.items) {
    if (!ITEM_META[it.type].connects) continue;
    for (let cx = it.x; cx < it.x + it.w; cx++)
      for (let cy = it.y; cy < it.y + it.h; cy++) map.set(`${cx},${cy}`, it.type as Barrier);
  }
  return map;
}

/**
 * Build the path for one barrier family. Links to a tile of the same family go
 * centre→centre (added once per pair); links to a different barrier (wall↔door,
 * wall↔glass) stop at the shared edge so each family owns its half.
 */
function familyPath(tiles: Tile[], map: Map<string, Barrier>, family: Barrier): Path2D {
  const path = new Path2D();
  for (const t of tiles) {
    if (t.type !== family) continue;
    const mx = (t.cx + 0.5) * CELL;
    const my = (t.cy + 0.5) * CELL;
    let linked = false;
    for (const [dx, dy] of DIRS) {
      const n = map.get(`${t.cx + dx},${t.cy + dy}`);
      if (!n) continue;
      linked = true;
      if (n === family) {
        if (dx < 0 || dy < 0) continue; // the neighbour draws this shared link
        path.moveTo(mx, my);
        path.lineTo(mx + dx * CELL, my + dy * CELL);
      } else {
        path.moveTo(mx, my);
        path.lineTo(mx + (dx * CELL) / 2, my + (dy * CELL) / 2);
      }
    }
    if (!linked) {
      // A lone tile: a short stub so the round caps render it as a pill/post.
      path.moveTo(mx - 0.01, my);
      path.lineTo(mx + 0.01, my);
    }
  }
  return path;
}

function drawBarriers(ctx: CanvasRenderingContext2D, layout: OfficeLayout) {
  const map = barrierMap(layout);
  if (map.size === 0) return;
  const tiles: Tile[] = [...map.entries()].map(([k, type]) => {
    const [cx, cy] = k.split(',').map(Number);
    return { cx, cy, type };
  });

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Doors sit under the wall ends so the wall caps act as door frames.
  for (const t of tiles) {
    if (t.type !== 'door') continue;
    const has = (dx: number, dy: number) => map.has(`${t.cx + dx},${t.cy + dy}`);
    drawDoor(ctx, t.cx, t.cy, has(-1, 0) || has(1, 0) || !(has(0, -1) || has(0, 1)));
  }

  // Glass: a soft tinted pane with a crisp highlight line through it.
  const glass = familyPath(tiles, map, 'glass');
  ctx.strokeStyle = 'rgba(34,211,238,0.22)';
  ctx.lineWidth = 12;
  ctx.stroke(glass);
  ctx.strokeStyle = 'rgba(165,243,252,0.95)';
  ctx.lineWidth = 2;
  ctx.stroke(glass);

  // Walls: soft drop shadow, a solid body, then a fine inner rule.
  const walls = familyPath(tiles, map, 'wall');
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 3;
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 14;
  ctx.stroke(walls);
  ctx.restore();
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 10;
  ctx.stroke(walls);
  ctx.strokeStyle = 'rgba(100,116,139,0.55)';
  ctx.lineWidth = 1.5;
  ctx.stroke(walls);

  ctx.restore();
}

/** A doorway: one leaf swung open with its sweep arc, aligned to the wall run. */
function drawDoor(ctx: CanvasRenderingContext2D, cx: number, cy: number, horizontal: boolean) {
  const x = cx * CELL;
  const y = cy * CELL;
  const inset = 7; // where the wall caps end
  const span = CELL - inset * 2;
  ctx.save();
  ctx.translate(x + CELL / 2, y + CELL / 2);
  if (!horizontal) ctx.rotate(Math.PI / 2);
  // Sweep area.
  ctx.beginPath();
  ctx.moveTo(-CELL / 2 + inset, 0);
  ctx.arc(-CELL / 2 + inset, 0, span, -Math.PI / 2, 0);
  ctx.closePath();
  ctx.fillStyle = 'rgba(251,191,36,0.08)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(251,191,36,0.45)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.arc(-CELL / 2 + inset, 0, span, -Math.PI / 2, 0);
  ctx.stroke();
  ctx.setLineDash([]);
  // Leaf.
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-CELL / 2 + inset, 0);
  ctx.lineTo(-CELL / 2 + inset, -span);
  ctx.stroke();
  ctx.restore();
}

/**
 * Faint coverage rings around each speaker (editor aid): a filled inner disc for
 * the full-volume radius and a dashed outer ring for the edge of audibility.
 */
export function drawSpeakerRanges(ctx: CanvasRenderingContext2D, layout: OfficeLayout) {
  const speakers = layout.items.filter((i) => i.type === 'speaker');
  if (speakers.length === 0) return;
  ctx.save();
  for (const s of speakers) {
    const cx = (s.x + s.w / 2) * CELL;
    const cy = (s.y + s.h / 2) * CELL;
    const { hearing, full } = speakerRanges(s);

    // Outer: edge of audibility (dashed, with a soft radial fill).
    const grad = ctx.createRadialGradient(cx, cy, full, cx, cy, hearing);
    grad.addColorStop(0, 'rgba(139,92,246,0.14)');
    grad.addColorStop(1, 'rgba(139,92,246,0)');
    ctx.beginPath();
    ctx.arc(cx, cy, hearing, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = 'rgba(139,92,246,0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Inner: full-volume radius (solid faint ring).
    ctx.beginPath();
    ctx.arc(cx, cy, full, 0, Math.PI * 2);
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(139,92,246,0.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Animated concentric rings radiating from each speaker while music plays.
 * Speakers the viewer has muted (in `muted`) get a 🔇 marker instead of rings.
 */
export function drawSpeakerPulses(
  ctx: CanvasRenderingContext2D,
  layout: OfficeLayout,
  timeMs: number,
  muted?: Set<string>,
  /** Only these speakers pulse; omit to pulse all. */
  playing?: Set<string>,
) {
  const speakers = layout.items.filter((i) => i.type === 'speaker');
  if (speakers.length === 0) return;
  ctx.save();
  for (const s of speakers) {
    const cx = (s.x + s.w / 2) * CELL;
    const cy = (s.y + s.h / 2) * CELL;
    if (muted?.has(s.id)) {
      drawMutedMarker(ctx, cx, cy);
      continue;
    }
    if (playing && !playing.has(s.id)) continue;
    for (let k = 0; k < 3; k++) {
      // Each ring expands over ~1.6s then resets; staggered by k.
      const phase = ((timeMs / 1600 + k / 3) % 1 + 1) % 1;
      const radius = 16 + phase * 90;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(139,92,246,${0.45 * (1 - phase)})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Mark speakers the viewer has muted (shown even when music isn't playing). */
export function drawMutedSpeakers(
  ctx: CanvasRenderingContext2D,
  layout: OfficeLayout,
  muted: Set<string>,
) {
  if (muted.size === 0) return;
  ctx.save();
  for (const s of layout.items) {
    if (s.type !== 'speaker' || !muted.has(s.id)) continue;
    drawMutedMarker(ctx, (s.x + s.w / 2) * CELL, (s.y + s.h / 2) * CELL);
  }
  ctx.restore();
}

function drawMutedMarker(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  const r = 11;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(239,68,68,0.9)';
  ctx.fill();
  // Diagonal slash.
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.6, cy - r * 0.6);
  ctx.lineTo(cx + r * 0.6, cy + r * 0.6);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2.5;
  ctx.stroke();
}

/** Draw avatars + name labels on top of the floor (room view). */
export function drawAvatars(
  ctx: CanvasRenderingContext2D,
  players: Map<string, PresenceState>,
  selfId: string,
  connected: Set<string>,
  showHearingRange = true,
  followingId?: string | null,
  hearingRange = HEARING_RANGE,
) {
  // Use the smoothed on-screen position (falls back to the authoritative one).
  const rx = (q: PresenceState) => q.rx ?? q.x;
  const ry = (q: PresenceState) => q.ry ?? q.y;
  const me = players.get(selfId);

  if (me) {
    // Hearing radius (hidden when isolated inside an audio room).
    if (showHearingRange) {
      ctx.beginPath();
      ctx.arc(rx(me), ry(me), hearingRange, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(56,189,248,0.05)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(56,189,248,0.22)';
      ctx.setLineDash([6, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Links to peers in earshot.
    for (const [id, p] of players) {
      if (connected.has(id)) {
        ctx.beginPath();
        ctx.moveTo(rx(me), ry(me));
        ctx.lineTo(rx(p), ry(p));
        ctx.strokeStyle = 'rgba(34,197,94,0.5)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  for (const [id, p] of players) {
    const isSelf = id === selfId;
    const x = rx(p);
    const y = ry(p);

    // Amber dashed ring around whoever we're following.
    if (id === followingId) {
      ctx.beginPath();
      ctx.arc(x, y, AVATAR_RADIUS + 6, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(245,158,11,0.95)';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.beginPath();
    ctx.arc(x, y, AVATAR_RADIUS, 0, Math.PI * 2);
    
    const avatarImg = getAvatarImage(p.avatar_url);
    if (avatarImg && avatarImg.complete && avatarImg.naturalWidth > 0) {
      ctx.save();
      ctx.clip(); // clip to the circle
      ctx.drawImage(avatarImg, x - AVATAR_RADIUS, y - AVATAR_RADIUS, AVATAR_RADIUS * 2, AVATAR_RADIUS * 2);
      ctx.restore();
    } else {
      ctx.fillStyle = p.color;
      ctx.fill();
      // Draw initials if no image
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px Inter, system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const initials = p.name.split(/\s+/).map((n) => n[0]).slice(0, 2).join('').toUpperCase();
      ctx.fillText(initials || '?', x, y + 1);
    }
    
    ctx.lineWidth = isSelf ? 3.5 : 2;
    ctx.strokeStyle = isSelf ? '#ffffff' : 'rgba(255,255,255,0.45)';
    ctx.stroke();

    // DND strict badge directly on the canvas avatar (red circle with white minus)
    if (p.dnd) {
      const badgeX = x + AVATAR_RADIUS * 0.7;
      const badgeY = y - AVATAR_RADIUS * 0.7;
      
      ctx.beginPath();
      ctx.arc(badgeX, badgeY, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#ef4444'; // Red-500
      ctx.fill();
      ctx.strokeStyle = '#18181b'; // zinc-900 border
      ctx.lineWidth = 1.5;
      ctx.stroke();
      
      ctx.beginPath();
      ctx.moveTo(badgeX - 3, badgeY);
      ctx.lineTo(badgeX + 3, badgeY);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    ctx.font = isSelf ? '600 13px Inter, system-ui' : '12px Inter, system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const w = ctx.measureText(p.name).width;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    roundRect(ctx, x - w / 2 - 5, y - AVATAR_RADIUS - 22, w + 10, 17, 5);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(p.name, x, y - AVATAR_RADIUS - 7);

    // Mute/deafen badge at the lower-right of the avatar (deafen implies mute).
    if (p.deafened) drawStatusBadge(ctx, x + AVATAR_RADIUS * 0.75, y + AVATAR_RADIUS * 0.75, 'deafened');
    else if (p.muted) drawStatusBadge(ctx, x + AVATAR_RADIUS * 0.75, y + AVATAR_RADIUS * 0.75, 'muted');
  }
}

/** Small red badge showing a crossed-out mic (muted) or headphones (deafened). */
function drawStatusBadge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  kind: 'muted' | 'deafened',
) {
  const r = 8;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#ef4444';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.stroke();

  ctx.strokeStyle = '#fff';
  ctx.fillStyle = '#fff';
  ctx.lineWidth = 1.4;
  if (kind === 'muted') {
    // Mic: capsule body + stand.
    ctx.beginPath();
    roundRect(ctx, cx - 1.6, cy - 4, 3.2, 5, 1.6);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy + 3);
    ctx.lineTo(cx, cy + 4.5);
    ctx.stroke();
  } else {
    // Headphones: band arc + two earcups.
    ctx.beginPath();
    ctx.arc(cx, cy, 3.4, Math.PI, 2 * Math.PI);
    ctx.stroke();
    ctx.fillRect(cx - 4.4, cy - 0.6, 2, 3.4);
    ctx.fillRect(cx + 2.4, cy - 0.6, 2, 3.4);
  }
  // Diagonal slash = "off".
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.7, cy - r * 0.7);
  ctx.lineTo(cx + r * 0.7, cy + r * 0.7);
  ctx.stroke();
  ctx.restore();
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}


export function drawReactions(
  ctx: CanvasRenderingContext2D,
  players: Map<string, PresenceState>,
  reactions: ReactionPayload[],
  now: number
) {
  // Reaction duration in ms
  const DURATION = 2000;
  // Distance to float up (in pixels)
  const FLOAT_DIST = 60;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  
  for (const r of reactions) {
    const p = players.get(r.userId);
    if (!p) continue;
    
    const elapsed = now - r.timestamp;
    if (elapsed > DURATION) continue;

    const progress = elapsed / DURATION;
    
    // Fade in quickly, then fade out
    let alpha = 1;
    if (progress < 0.1) alpha = progress / 0.1;
    else if (progress > 0.7) alpha = 1 - (progress - 0.7) / 0.3;

    // Float upwards over time
    const yOffset = -progress * FLOAT_DIST;

    const px = p.rx ?? p.x;
    const py = (p.ry ?? p.y) + yOffset;

    ctx.globalAlpha = alpha;
    
    // Small popping animation at the start
    const scale = progress < 0.1 ? 0.5 + (progress / 0.1) * 0.5 : 1;
    
    ctx.save();
    // Center transformation on the emoji position to scale properly
    ctx.translate(px, py);
    ctx.scale(scale, scale);
    
    // Emoji size and cross-browser font stack (Chrome sometimes needs explicit emoji fonts on canvas)
    ctx.font = '28px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'; 
    
    // Add a slight drop shadow for visibility over various backgrounds
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;
    
    ctx.fillText(r.emoji, 0, -30); // Slightly above the avatar head
    ctx.restore();
  }
  
  ctx.restore();
}
