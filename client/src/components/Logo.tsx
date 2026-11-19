import { cn } from '../lib/utils';

/** Brand mark (same glyph as the app icon) plus the wordmark. */
export function Logo({ className, showWordmark = true }: { className?: string; showWordmark?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <svg viewBox="0 0 512 512" className="size-7 shrink-0" aria-hidden="true">
        <rect width="512" height="512" rx="120" className="fill-foreground" />
        <path
          d="M 244 156 L 280 156 L 280 196 L 318 196 L 318 230 L 280 230 L 280 304 C 280 322 289 330 306 330 C 312 330 318 329 324 327 L 324 362 C 313 365 300 367 288 367 C 254 367 244 347 244 312 L 244 230 L 214 230 L 214 196 L 244 196 Z"
          className="fill-background"
        />
        <circle cx="352" cy="164" r="26" fill="#6366f1" />
      </svg>
      {showWordmark && (
        <span className="text-[15px] font-semibold leading-none tracking-[-0.02em]">talkiee</span>
      )}
    </span>
  );
}
