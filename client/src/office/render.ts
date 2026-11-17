import type { LayoutItem, OfficeLayout, PresenceState } from '../types';
import { CELL, AVATAR_RADIUS, HEARING_RANGE, ITEM_META, speakerRanges } from './layout';

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

  // Draw zones first (so objects sit on top), then objects.
  const zones = layout.items.filter((i) => ITEM_META[i.type].zone);
  const objects = layout.items.filter((i) => !ITEM_META[i.type].zone);
  const isSelected = (id: string) => opts.selectedId === id || !!opts.selectedIds?.has(id);
  for (const item of [...zones, ...objects]) drawItem(ctx, item, isSelected(item.id));
}

function drawItem(ctx: CanvasRenderingContext2D, item: LayoutItem, selected: boolean) {
  const meta = ITEM_META[item.type];
  const x = item.x * CELL;
  const y = item.y * CELL;
  const w = item.w * CELL;
  const h = item.h * CELL;

  ctx.save();
  if (meta.zone) {
    // Translucent area with a dashed border + label.
    ctx.fillStyle = meta.color + '55';
    roundRect(ctx, x + 2, y + 2, w - 4, h - 4, 10);
    ctx.fill();
    ctx.strokeStyle = meta.color;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    roundRect(ctx, x + 2, y + 2, w - 4, h - 4, 10);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(226,232,240,0.9)';
    ctx.font = '600 13px Inter, system-ui';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`${meta.icon} ${item.label ?? meta.label}`, x + 10, y + 10);
  } else {
    ctx.fillStyle = meta.color;
    roundRect(ctx, x + 3, y + 3, w - 6, h - 6, 6);
    ctx.fill();
    // Icon centered.
    ctx.font = `${Math.min(w, h) * 0.5}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(meta.icon, x + w / 2, y + h / 2 + 2);
  }

  if (selected) {
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.5;
    roundRect(ctx, x + 1, y + 1, w - 2, h - 2, 8);
    ctx.stroke();
  }
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
  const me = players.get(selfId);

  if (me) {
    // Hearing radius (hidden when isolated inside an audio room).
    if (showHearingRange) {
      ctx.beginPath();
      ctx.arc(me.x, me.y, hearingRange, 0, Math.PI * 2);
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
        ctx.moveTo(me.x, me.y);
        ctx.lineTo(p.x, p.y);
        ctx.strokeStyle = 'rgba(34,197,94,0.5)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  for (const [id, p] of players) {
    const isSelf = id === selfId;

    // Amber dashed ring around whoever we're following.
    if (id === followingId) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, AVATAR_RADIUS + 6, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(245,158,11,0.95)';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.beginPath();
    ctx.arc(p.x, p.y, AVATAR_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();
    ctx.lineWidth = isSelf ? 3.5 : 2;
    ctx.strokeStyle = isSelf ? '#ffffff' : 'rgba(255,255,255,0.45)';
    ctx.stroke();

    ctx.font = isSelf ? '600 13px Inter, system-ui' : '12px Inter, system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const w = ctx.measureText(p.name).width;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    roundRect(ctx, p.x - w / 2 - 5, p.y - AVATAR_RADIUS - 22, w + 10, 17, 5);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(p.name, p.x, p.y - AVATAR_RADIUS - 7);

    // Mute/deafen badge at the lower-right of the avatar (deafen implies mute).
    if (p.deafened) drawStatusBadge(ctx, p.x + AVATAR_RADIUS * 0.75, p.y + AVATAR_RADIUS * 0.75, 'deafened');
    else if (p.muted) drawStatusBadge(ctx, p.x + AVATAR_RADIUS * 0.75, p.y + AVATAR_RADIUS * 0.75, 'muted');
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
