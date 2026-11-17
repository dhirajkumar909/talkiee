import { useCallback, useRef, useState } from 'react';
import { cn } from '../lib/utils';

const BASE = 112; // px, diameter of the joystick base
const KNOB = 48; // px, diameter of the draggable knob
const MAX = (BASE - KNOB) / 2; // max knob travel from center

/**
 * On-screen analog joystick for touch devices. Reports a normalized direction
 * vector (dx, dy) in [-1, 1]; (0, 0) when released. Uses pointer events so it
 * also works with a mouse for testing.
 */
export function Joystick({
  onChange,
  className,
}: {
  onChange: (dx: number, dy: number) => void;
  className?: string;
}) {
  const baseRef = useRef<HTMLDivElement>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [active, setActive] = useState(false);

  const update = useCallback(
    (clientX: number, clientY: number) => {
      const origin = originRef.current;
      if (!origin) return;
      let dx = clientX - origin.x;
      let dy = clientY - origin.y;
      const dist = Math.hypot(dx, dy);
      if (dist > MAX) {
        dx = (dx / dist) * MAX;
        dy = (dy / dist) * MAX;
      }
      setKnob({ x: dx, y: dy });
      onChange(dx / MAX, dy / MAX);
    },
    [onChange],
  );

  const start = useCallback(
    (e: React.PointerEvent) => {
      const rect = baseRef.current?.getBoundingClientRect();
      if (!rect) return;
      originRef.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      e.currentTarget.setPointerCapture(e.pointerId);
      setActive(true);
      update(e.clientX, e.clientY);
    },
    [update],
  );

  const move = useCallback(
    (e: React.PointerEvent) => {
      if (!originRef.current) return;
      update(e.clientX, e.clientY);
    },
    [update],
  );

  const end = useCallback(() => {
    originRef.current = null;
    setActive(false);
    setKnob({ x: 0, y: 0 });
    onChange(0, 0);
  }, [onChange]);

  return (
    <div
      ref={baseRef}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onContextMenu={(e) => e.preventDefault()}
      style={{ width: BASE, height: BASE, touchAction: 'none' }}
      className={cn(
        'relative flex items-center justify-center rounded-full border border-border/60',
        'bg-background/70 shadow-lg backdrop-blur-sm select-none',
        active && 'bg-background/90',
        className,
      )}
    >
      <div
        style={{
          width: KNOB,
          height: KNOB,
          transform: `translate(${knob.x}px, ${knob.y}px)`,
        }}
        className={cn(
          'rounded-full bg-primary/80 shadow-md transition-transform',
          active ? 'duration-0' : 'duration-150',
        )}
      />
    </div>
  );
}
