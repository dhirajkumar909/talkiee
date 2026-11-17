import { Link, useNavigate } from 'react-router-dom';
import { LogOut, User } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { Avatar } from './ui/avatar';
import { ThemeToggle } from './ThemeToggle';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

export function Navbar() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <Link to="/dashboard" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid size-6 place-items-center rounded-md bg-primary text-xs text-primary-foreground">
            t
          </span>
          talkiee
        </Link>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          {profile && (
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Avatar name={profile.display_name} color={profile.color} className="size-8" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="flex flex-col">
                <span>{profile.display_name}</span>
                <span className="text-xs font-normal text-muted-foreground">@{profile.username}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate('/dashboard')}>
                <User /> Dashboard
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={async () => {
                  await signOut();
                  navigate('/');
                }}
              >
                <LogOut /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          )}
        </div>
      </div>
    </header>
  );
}
