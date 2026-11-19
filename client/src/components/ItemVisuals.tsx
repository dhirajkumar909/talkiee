import {
  Armchair,
  BrickWall,
  Coffee,
  DoorOpen,
  Grid2x2,
  Library,
  MapPin,
  Monitor,
  PhoneCall,
  Presentation,
  RectangleHorizontal,
  Sofa,
  Speaker,
  Sprout,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { ItemType } from '../types';
import { ITEM_META, itemEffects, type EffectTone } from '../office/layout';
import { cn } from '../lib/utils';

export const ITEM_ICONS: Record<ItemType, LucideIcon> = {
  wall: BrickWall,
  glass: Grid2x2,
  door: DoorOpen,
  desk: Monitor,
  chair: Armchair,
  shelf: Library,
  whiteboard: Presentation,
  coffee: Coffee,
  plant: Sprout,
  rug: RectangleHorizontal,
  meeting: Users,
  booth: PhoneCall,
  lounge: Sofa,
  speaker: Speaker,
  spawn: MapPin,
};

/** Tinted rounded chip with the item's icon in its own colour. */
export function ItemIcon({ type, className }: { type: ItemType; className?: string }) {
  const Icon = ITEM_ICONS[type];
  const color = ITEM_META[type].color;
  return (
    <span
      className={cn('grid size-8 shrink-0 place-items-center rounded-lg', className)}
      style={{ background: `${color}26`, color, boxShadow: `inset 0 0 0 1px ${color}40` }}
    >
      <Icon className="size-4 dark:brightness-[1.8]" strokeWidth={2} />
    </span>
  );
}

const TONE: Record<EffectTone, string> = {
  block: 'bg-orange-500/10 text-orange-700 dark:text-orange-300',
  sound: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
  private: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  open: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
};

export function EffectChips({ type, className }: { type: ItemType; className?: string }) {
  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {itemEffects(type).map((e) => (
        <span key={e.label} className={cn('rounded-md px-1.5 py-0.5 text-[11px] font-medium', TONE[e.tone])}>
          {e.label}
        </span>
      ))}
    </div>
  );
}
