import { Moon, Sun } from 'lucide-react';
import { Button } from './ui/button';
import { useTheme } from '../lib/theme';

/** Sun/moon button that flips between light and dark mode. */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      className={className}
      title={`Switch to ${next} mode`}
      aria-label={`Switch to ${next} mode`}
    >
      {theme === 'dark' ? <Sun /> : <Moon />}
    </Button>
  );
}
