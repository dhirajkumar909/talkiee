import { cn } from '../../lib/utils';

/** Simple initial-based avatar with a tinted background. */
export function Avatar({
  name,
  color,
  src,
  className,
}: {
  name: string;
  color?: string;
  src?: string;
  className?: string;
}) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <span
      className={cn(
        'relative inline-flex items-center justify-center overflow-hidden shrink-0 rounded-full text-xs font-semibold text-white ring-2 ring-background',
        className,
      )}
      style={{ background: color ?? '#4f46e5' }}
    >
      {src ? (
        <img src={src} alt={name} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        initials || '?'
      )}
    </span>
  );
}
