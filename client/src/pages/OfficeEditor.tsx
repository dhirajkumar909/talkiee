import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, Save, Trash2, MousePointer2, Minus, Plus, Dices, Undo2, Redo2 } from 'lucide-react';
import { getOffice, saveOfficeLayout } from '../lib/api';
import type { ItemType, LayoutItem, Office, OfficeLayout } from '../types';
import {
  CELL,
  DEFAULT_HEARING_RANGE_TILES,
  DEFAULT_SPEAKER_RANGE_TILES,
  ITEM_META,
  MAX_HEARING_RANGE_TILES,
  MAX_SPEAKER_RANGE_TILES,
  MIN_HEARING_RANGE_TILES,
  MIN_SPEAKER_RANGE_TILES,
  PALETTE,
  footprintFree,
  makeItem,
  randomLayout,
  spawnPoint,
  voiceRanges,
} from '../office/layout';
import { drawFloor, drawSpeakerRanges } from '../office/render';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { ThemeToggle } from '../components/ThemeToggle';
import { cn } from '../lib/utils';

type Tool = ItemType | 'select';

export function OfficeEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [office, setOffice] = useState<Office | null>(null);
  const [name, setName] = useState('');
  // `layout` is the present state; `past`/`future` are the undo/redo stacks.
  const [layout, setLayout] = useState<OfficeLayout | null>(null);
  const [past, setPast] = useState<OfficeLayout[]>([]);
  const [future, setFuture] = useState<OfficeLayout[]>([]);
  const [tool, setTool] = useState<Tool>('wall');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [saving, setSaving] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Group drag: cursor offset from the grabbed item + each selected item's origin cell.
  const dragRef = useRef<{
    anchorId: string;
    offX: number;
    offY: number;
    origin: Map<string, { x: number; y: number }>;
  } | null>(null);
  // Marquee box-select: selection to union with (empty unless Shift was held).
  const marqueeBaseRef = useRef<Set<string>>(new Set());

  // Fresh snapshots for event handlers that shouldn't close over stale state.
  const layoutRef = useRef<OfficeLayout | null>(null);
  layoutRef.current = layout;
  const pastRef = useRef<OfficeLayout[]>([]);
  pastRef.current = past;
  const futureRef = useRef<OfficeLayout[]>([]);
  futureRef.current = future;

  // Record a discrete, undoable change.
  const commit = useCallback((next: OfficeLayout) => {
    if (layoutRef.current) setPast((p) => [...p, layoutRef.current!]);
    setFuture([]);
    setLayout(next);
  }, []);

  // A "live" edit (drag, typing a label) should produce ONE history entry for
  // the whole gesture: capture a baseline, then push it only on the first real
  // change and update the present directly thereafter.
  const liveBaseline = useRef<OfficeLayout | null>(null);
  const liveDirty = useRef(false);
  const beginLive = useCallback(() => {
    liveBaseline.current = layoutRef.current;
    liveDirty.current = false;
  }, []);
  const liveSet = useCallback((next: OfficeLayout) => {
    if (!liveDirty.current) {
      liveDirty.current = true;
      if (liveBaseline.current) setPast((p) => [...p, liveBaseline.current!]);
      setFuture([]);
    }
    setLayout(next);
  }, []);

  const undo = useCallback(() => {
    const p = pastRef.current;
    if (p.length === 0 || !layoutRef.current) return;
    setFuture([layoutRef.current, ...futureRef.current]);
    setLayout(p[p.length - 1]);
    setPast(p.slice(0, -1));
    setSelectedIds(new Set());
  }, []);
  const redo = useCallback(() => {
    const f = futureRef.current;
    if (f.length === 0 || !layoutRef.current) return;
    setPast([...pastRef.current, layoutRef.current]);
    setLayout(f[0]);
    setFuture(f.slice(1));
    setSelectedIds(new Set());
  }, []);

  useEffect(() => {
    if (!id) return;
    getOffice(id)
      .then((o) => {
        setOffice(o);
        setName(o.name);
        setLayout(o.layout);
        setPast([]);
        setFuture([]);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Could not open office'));
  }, [id]);

  // A single selected item (for the per-item Properties controls); null when 0 or many.
  const selected =
    selectedIds.size === 1 ? layout?.items.find((i) => selectedIds.has(i.id)) ?? null : null;

  // Redraw whenever layout / selection / hover changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !layout) return;
    const ctx = canvas.getContext('2d')!;
    drawFloor(ctx, layout, { grid: true, selectedIds });
    drawSpeakerRanges(ctx, layout);

    // Voice hearing-range preview, centered on the spawn point.
    const spawn = spawnPoint(layout);
    ctx.save();
    ctx.beginPath();
    ctx.arc(spawn.x, spawn.y, voiceRanges(layout).hearing, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(56,189,248,0.05)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(56,189,248,0.4)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 6]);
    ctx.stroke();
    ctx.restore();

    // Ghost preview of placement (red when the spot is occupied).
    if (hover && tool !== 'select') {
      const meta = ITEM_META[tool];
      const free = footprintFree(layout, hover.x, hover.y, meta.defaultW, meta.defaultH, tool);
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = free ? meta.color : '#ef4444';
      ctx.fillRect(hover.x * CELL, hover.y * CELL, meta.defaultW * CELL, meta.defaultH * CELL);
      ctx.restore();
    }

    // Marquee box-select rectangle.
    if (marquee) {
      const x = Math.min(marquee.x0, marquee.x1);
      const y = Math.min(marquee.y0, marquee.y1);
      const w = Math.abs(marquee.x1 - marquee.x0);
      const h = Math.abs(marquee.y1 - marquee.y0);
      ctx.save();
      ctx.fillStyle = 'rgba(56,189,248,0.12)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(56,189,248,0.8)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(x, y, w, h);
      ctx.restore();
    }
  }, [layout, selectedIds, hover, tool, marquee]);

  const pixelFromEvent = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  }, []);

  const cellFromEvent = useCallback(
    (e: React.MouseEvent) => {
      const { x, y } = pixelFromEvent(e);
      return { x: Math.floor(x / CELL), y: Math.floor(y / CELL) };
    },
    [pixelFromEvent],
  );

  const itemAt = (cx: number, cy: number): LayoutItem | null => {
    if (!layout) return null;
    // Topmost first (objects drawn after zones).
    for (let i = layout.items.length - 1; i >= 0; i--) {
      const it = layout.items[i];
      if (cx >= it.x && cx < it.x + it.w && cy >= it.y && cy < it.y + it.h) return it;
    }
    return null;
  };

  const patch = (l: OfficeLayout, itemId: string, p: Partial<LayoutItem>): OfficeLayout => ({
    ...l,
    items: l.items.map((i) => (i.id === itemId ? { ...i, ...p } : i)),
  });

  const onMouseDown = (e: React.MouseEvent) => {
    if (!layout) return;
    const { x, y } = cellFromEvent(e);

    if (tool === 'select') {
      const additive = e.shiftKey || e.metaKey || e.ctrlKey;
      const hit = itemAt(x, y);

      if (hit) {
        // Decide the resulting selection, then (if the hit item is in it) drag the group.
        let next: Set<string>;
        if (additive) {
          next = new Set(selectedIds);
          if (next.has(hit.id)) next.delete(hit.id);
          else next.add(hit.id);
        } else if (selectedIds.has(hit.id)) {
          next = selectedIds; // keep the group so it can be dragged as one
        } else {
          next = new Set([hit.id]);
        }
        setSelectedIds(next);

        if (next.has(hit.id)) {
          const origin = new Map<string, { x: number; y: number }>();
          for (const it of layout.items) if (next.has(it.id)) origin.set(it.id, { x: it.x, y: it.y });
          dragRef.current = { anchorId: hit.id, offX: x - hit.x, offY: y - hit.y, origin };
          beginLive(); // one history entry per drag
        }
        return;
      }

      // Empty space → start a marquee box-select.
      if (!additive) setSelectedIds(new Set());
      marqueeBaseRef.current = additive ? new Set(selectedIds) : new Set();
      const p = pixelFromEvent(e);
      setMarquee({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      return;
    }

    // Placement: clamp so the item fits on the floor.
    const meta = ITEM_META[tool];
    const nx = Math.min(Math.max(0, x), layout.width - meta.defaultW);
    const ny = Math.min(Math.max(0, y), layout.height - meta.defaultH);
    if (!footprintFree(layout, nx, ny, meta.defaultW, meta.defaultH, tool)) {
      toast.error("Something's already there", { id: 'occupied' });
      return;
    }
    const item = makeItem(tool, nx, ny);
    commit({ ...layout, items: [...layout.items, item] });
    setSelectedIds(new Set([item.id]));
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!layout) return;
    const { x, y } = cellFromEvent(e);
    setHover({ x, y });

    const drag = dragRef.current;
    if (drag) {
      const anchorOrigin = drag.origin.get(drag.anchorId);
      if (!anchorOrigin) return;
      // Desired move of the whole group, clamped so every member stays in bounds.
      let dcx = x - drag.offX - anchorOrigin.x;
      let dcy = y - drag.offY - anchorOrigin.y;
      for (const [itemId, o] of drag.origin) {
        const it = layout.items.find((i) => i.id === itemId);
        if (!it) continue;
        dcx = Math.max(-o.x, Math.min(layout.width - it.w - o.x, dcx));
        dcy = Math.max(-o.y, Math.min(layout.height - it.h - o.y, dcy));
      }
      // Reject the step if any member would land on an occupied (non-selected) cell.
      for (const [itemId, o] of drag.origin) {
        const it = layout.items.find((i) => i.id === itemId);
        if (it && !footprintFree(layout, o.x + dcx, o.y + dcy, it.w, it.h, it.type, selectedIds)) return;
      }
      let next = layout;
      let changed = false;
      for (const [itemId, o] of drag.origin) {
        const it = next.items.find((i) => i.id === itemId);
        if (it && (it.x !== o.x + dcx || it.y !== o.y + dcy)) {
          next = patch(next, itemId, { x: o.x + dcx, y: o.y + dcy });
          changed = true;
        }
      }
      if (changed) liveSet(next);
      return;
    }

    if (marquee) {
      const p = pixelFromEvent(e);
      setMarquee((m) => (m ? { ...m, x1: p.x, y1: p.y } : m));
    }
  };

  const finishMarquee = () => {
    if (!marquee || !layout) return;
    const x0 = Math.min(marquee.x0, marquee.x1);
    const x1 = Math.max(marquee.x0, marquee.x1);
    const y0 = Math.min(marquee.y0, marquee.y1);
    const y1 = Math.max(marquee.y0, marquee.y1);
    const hits = new Set(marqueeBaseRef.current);
    for (const it of layout.items) {
      const l = it.x * CELL;
      const t = it.y * CELL;
      const r = (it.x + it.w) * CELL;
      const b = (it.y + it.h) * CELL;
      if (l < x1 && r > x0 && t < y1 && b > y0) hits.add(it.id);
    }
    setSelectedIds(hits);
    setMarquee(null);
  };

  const onMouseUp = () => {
    if (dragRef.current) {
      dragRef.current = null;
      return;
    }
    if (marquee) finishMarquee();
  };

  const deleteSelected = useCallback(() => {
    const l = layoutRef.current;
    if (!l || selectedIds.size === 0) return;
    commit({ ...l, items: l.items.filter((i) => !selectedIds.has(i.id)) });
    setSelectedIds(new Set());
  }, [selectedIds, commit]);

  // Delete key removes the whole selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0) {
        if (document.activeElement instanceof HTMLInputElement) return;
        deleteSelected();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedIds, deleteSelected]);

  // Undo / redo keyboard shortcuts (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Ctrl+Y).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (k === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const resize = (dim: 'w' | 'h', delta: number) => {
    if (!selected || !layout) return;
    const max = dim === 'w' ? layout.width - selected.x : layout.height - selected.y;
    const next = Math.min(Math.max(1, selected[dim] + delta), max);
    const w = dim === 'w' ? next : selected.w;
    const h = dim === 'h' ? next : selected.h;
    // Growing into an occupied cell isn't allowed; shrinking always is.
    if (next > selected[dim] && !footprintFree(layout, selected.x, selected.y, w, h, selected.type, selected.id)) {
      toast.error('No room to grow that way', { id: 'occupied' });
      return;
    }
    commit(patch(layout, selected.id, { [dim]: next }));
  };

  const resizeFloor = (dim: 'width' | 'height', delta: number) => {
    if (!layout) return;
    commit({ ...layout, [dim]: Math.min(Math.max(10, layout[dim] + delta), 40) });
  };

  const setSpeakerRange = (delta: number) => {
    if (!selected || !layout) return;
    const cur = selected.range ?? DEFAULT_SPEAKER_RANGE_TILES;
    const next = Math.min(Math.max(MIN_SPEAKER_RANGE_TILES, cur + delta), MAX_SPEAKER_RANGE_TILES);
    commit(patch(layout, selected.id, { range: next }));
  };

  const setHearingRange = (delta: number) => {
    if (!layout) return;
    const cur = layout.hearingRange ?? DEFAULT_HEARING_RANGE_TILES;
    const next = Math.min(Math.max(MIN_HEARING_RANGE_TILES, cur + delta), MAX_HEARING_RANGE_TILES);
    commit({ ...layout, hearingRange: next });
  };

  const save = async () => {
    if (!layout || !id) return;
    setSaving(true);
    try {
      await saveOfficeLayout(id, name.trim() || 'My Office', layout);
      toast.success('Office saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  if (!office || !layout) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading editor…</div>;
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex h-14 items-center justify-between border-b px-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')}>
            <ArrowLeft /> Back
          </Button>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 w-56 font-semibold" />
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button
            size="icon"
            variant="outline"
            className="size-8"
            onClick={undo}
            disabled={past.length === 0}
            title="Undo (Ctrl/Cmd+Z)"
          >
            <Undo2 />
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="size-8"
            onClick={redo}
            disabled={future.length === 0}
            title="Redo (Ctrl/Cmd+Shift+Z)"
          >
            <Redo2 />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              commit(randomLayout());
              setSelectedIds(new Set());
            }}
            title="Generate a random office layout"
          >
            <Dices /> Randomize
          </Button>
          <Button size="sm" variant="outline" onClick={() => navigate(`/office/${office.id}`)}>
            Enter office
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            <Save /> {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Palette */}
        <aside className="w-52 shrink-0 overflow-y-auto border-r p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tools</p>
          <button
            onClick={() => setTool('select')}
            className={cn(
              'mb-3 flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm transition',
              tool === 'select' ? 'border-primary bg-accent' : 'hover:bg-accent',
            )}
          >
            <MousePointer2 className="size-4" /> Select / Move
          </button>

          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Furniture</p>
          <div className="grid grid-cols-2 gap-2">
            {PALETTE.map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTool(t);
                  setSelectedIds(new Set());
                }}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-xs transition',
                  tool === t ? 'border-primary bg-accent' : 'hover:bg-accent',
                )}
              >
                <span className="text-lg">{ITEM_META[t].icon}</span>
                {ITEM_META[t].label}
              </button>
            ))}
          </div>
        </aside>

        {/* Canvas */}
        <main className="flex flex-1 items-center justify-center overflow-auto bg-dots p-4">
          <canvas
            ref={canvasRef}
            width={layout.width * CELL}
            height={layout.height * CELL}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={() => {
              onMouseUp();
              setHover(null);
            }}
            className="max-h-full max-w-full rounded-xl border shadow-sm"
            style={{ cursor: tool === 'select' ? 'default' : 'crosshair' }}
          />
        </main>

        {/* Properties */}
        <aside className="w-64 shrink-0 overflow-y-auto border-l p-4">
          <h2 className="mb-3 text-sm font-semibold">Properties</h2>
          {selected ? (
            <div className="space-y-4">
              <div>
                <p className="text-xs text-muted-foreground">Type</p>
                <p className="font-medium">
                  {ITEM_META[selected.type].icon} {ITEM_META[selected.type].label}
                </p>
              </div>
              {ITEM_META[selected.type].zone && (
                <div className="space-y-2">
                  <Label htmlFor="lbl">Label</Label>
                  <Input
                    id="lbl"
                    value={selected.label ?? ''}
                    onFocus={beginLive}
                    onChange={(e) => liveSet(patch(layout, selected.id, { label: e.target.value }))}
                  />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Stepper label="Width" value={selected.w} onChange={(d) => resize('w', d)} />
                <Stepper label="Height" value={selected.h} onChange={(d) => resize('h', d)} />
              </div>
              {selected.type === 'speaker' && (
                <div>
                  <Stepper
                    label="Music range (tiles)"
                    value={selected.range ?? DEFAULT_SPEAKER_RANGE_TILES}
                    onChange={setSpeakerRange}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    How far the music carries. The violet rings show full-volume and fade-out reach.
                  </p>
                </div>
              )}
              <Button
                variant="outline"
                className="w-full text-destructive hover:text-destructive"
                onClick={deleteSelected}
              >
                <Trash2 /> Delete item
              </Button>
            </div>
          ) : selectedIds.size > 1 ? (
            <div className="space-y-4">
              <p className="text-sm font-medium">{selectedIds.size} items selected</p>
              <p className="text-xs text-muted-foreground">
                Drag any selected item to move them all together.
              </p>
              <Button
                variant="outline"
                className="w-full text-destructive hover:text-destructive"
                onClick={deleteSelected}
              >
                <Trash2 /> Delete {selectedIds.size} items
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Pick furniture and click the floor to place it. With <b>Select / Move</b>: click an item to
              select, <b>Shift-click</b> to add more, or <b>drag a box</b> on empty floor to select many —
              then drag any of them to move the group.
            </p>
          )}

          <div className="mt-6 border-t pt-4">
            <h3 className="mb-3 text-sm font-semibold">Floor size</h3>
            <div className="grid grid-cols-2 gap-3">
              <Stepper label="Width" value={layout.width} onChange={(d) => resizeFloor('width', d)} />
              <Stepper label="Height" value={layout.height} onChange={(d) => resizeFloor('height', d)} />
            </div>
          </div>

          <div className="mt-6 border-t pt-4">
            <h3 className="mb-3 text-sm font-semibold">Voice hearing range</h3>
            <Stepper
              label="Range (tiles)"
              value={layout.hearingRange ?? DEFAULT_HEARING_RANGE_TILES}
              onChange={setHearingRange}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              How close people must be to hear each other's voice. The sky-blue ring shows it
              around the spawn point.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Stepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (delta: number) => void;
}) {
  return (
    <div>
      <p className="mb-1 text-xs text-muted-foreground">{label}</p>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" className="size-7" onClick={() => onChange(-1)}>
          <Minus />
        </Button>
        <span className="w-8 text-center text-sm font-medium">{value}</span>
        <Button variant="outline" size="icon" className="size-7" onClick={() => onChange(1)}>
          <Plus />
        </Button>
      </div>
    </div>
  );
}
