import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronDown, Download, LayoutGrid, LogOut, User } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { Avatar } from './ui/avatar';
import { Button } from './ui/button';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';
import { usePWAInstall } from '../lib/pwa';
import { ProfileDialog } from './ProfileDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

export function Navbar() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const { canInstall, install } = usePWAInstall();
  const [profileOpen, setProfileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 border-b bg-background">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-6">
        <Link
          to="/dashboard"
          className="-ml-1 rounded-md px-1 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Logo />
        </Link>

        <div className="ml-auto flex items-center gap-1">
          {canInstall && (
            <Button
              variant="ghost"
              size="sm"
              onClick={install}
              className="h-9 gap-2 px-3 text-sm text-muted-foreground hover:text-foreground"
              title="Install Talkiee as an app"
            >
              <Download />
              <span className="hidden sm:inline">Install</span>
            </Button>
          )}
          <ThemeToggle className="text-muted-foreground hover:text-foreground" />
        </div>

        {profile && (
          <>
            <span className="h-6 w-px bg-border" aria-hidden="true" />
            <DropdownMenu>
              <DropdownMenuTrigger className="group -mr-2 flex h-10 items-center gap-2.5 rounded-lg pl-1.5 pr-2 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent">
                <Avatar
                  name={profile.display_name}
                  color={profile.color}
                  src={profile.avatar_url ?? undefined}
                  className="size-7 text-[11px] ring-0"
                />
                <span className="hidden max-w-[10rem] truncate text-sm font-medium sm:block">
                  {profile.display_name}
                </span>
                <ChevronDown className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={8} className="w-60">
                <div className="flex items-center gap-3 px-2 py-2">
                  <Avatar
                    name={profile.display_name}
                    color={profile.color}
                    src={profile.avatar_url ?? undefined}
                    className="size-9 shrink-0 ring-0"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium leading-5">{profile.display_name}</p>
                    <p className="truncate text-xs leading-4 text-muted-foreground">
                      @{profile.username}
                    </p>
                  </div>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setProfileOpen(true)}>
                  <User className="text-muted-foreground" /> Edit profile
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate('/dashboard', {replace: true})}>
                  <LayoutGrid className="text-muted-foreground" /> Your offices
                </DropdownMenuItem>
                {canInstall && (
                  <DropdownMenuItem onClick={install}>
                    <Download className="text-muted-foreground" /> Install app
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                  onClick={async () => {
                    await signOut();
                    navigate('/', {replace: true});
                  }}
                >
                  <LogOut /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <ProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />
          </>
        )}
      </div>
    </header>
  );
}
