import { Link } from 'react-router-dom';
import { ArrowRight, Download, Users, Map, Mic } from 'lucide-react';
import { Button } from '../components/ui/button';
import { ThemeToggle } from '../components/ThemeToggle';
import { Logo } from '../components/Logo';
import { useAuth } from '../auth/AuthProvider';
import { usePWAInstall } from '../lib/pwa';

export function Landing() {
  const { session } = useAuth();
  const { canInstall, install } = usePWAInstall();

  return (
    <div className="min-h-screen bg-dots">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Logo />
        <nav className="flex items-center gap-2">
          {canInstall && (
            <Button
              variant="outline"
              size="sm"
              onClick={install}
              className="gap-1.5"
              title="Install Talkiee as an app"
            >
              <Download className="size-4" />
              <span className="hidden sm:inline">Install app</span>
              <span className="sm:hidden">Install</span>
            </Button>
          )}
          <ThemeToggle />
          {session ? (
            <Button asChild>
              <Link to="/dashboard">
                Open app <ArrowRight />
              </Link>
            </Button>
          ) : (
            <>
              <Button variant="ghost" asChild>
                <Link to="/login">Log in</Link>
              </Button>
              <Button asChild>
                <Link to="/signup">Get started</Link>
              </Button>
            </>
          )}
        </nav>
      </header>

      <main className="mx-auto max-w-4xl px-6 pb-24 pt-20 text-center">
        <div className="mb-5 inline-flex items-center rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground">
          Spatial voice · design-your-own offices
        </div>
        <h1 className="text-balance text-5xl font-bold tracking-tight sm:text-6xl">
          Your team's office, <span className="text-muted-foreground">reimagined as a space.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-balance text-lg text-muted-foreground">
          Design a virtual office, invite your people, and just walk up to someone to talk. Voice
          connects by proximity — the way it works in a real room.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Button size="lg" asChild>
            <Link to={session ? '/dashboard' : '/signup'}>
              {session ? 'Go to your offices' : 'Create your office'} <ArrowRight />
            </Link>
          </Button>
        </div>

        <div className="mt-20 grid gap-5 text-left sm:grid-cols-3">
          {[
            { icon: Map, title: 'Design it like a game', desc: 'Drag desks, rooms, and walls onto a grid to build your floor.' },
            { icon: Mic, title: 'Proximity voice', desc: 'Walk up to someone and your mics connect. Step away and they fade.' },
            { icon: Users, title: 'Invite anyone', desc: 'Bring teammates into your office and see who’s where, live.' },
          ].map((f) => (
            <div key={f.title} className="rounded-xl border bg-card p-5">
              <f.icon className="size-5 text-muted-foreground" />
              <h3 className="mt-3 font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
