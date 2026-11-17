import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { ThemeToggle } from '../components/ThemeToggle';
import { cn } from '../lib/utils';

const COLORS = ['#4f46e5', '#db2777', '#ea580c', '#16a34a', '#0891b2', '#7c3aed', '#dc2626', '#ca8a04'];

export function Signup() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '', username: '', displayName: '' });
  const [color, setColor] = useState(COLORS[0]);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await signUp({
        email: form.email,
        password: form.password,
        username: form.username.trim().toLowerCase(),
        displayName: form.displayName.trim() || form.username,
        color,
      });
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        navigate('/dashboard');
      } else {
        toast.success('Account created — check your email to confirm, then log in.');
        navigate('/login');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not sign up');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-dots p-6">
      <ThemeToggle className="absolute right-4 top-4" />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Create your account</CardTitle>
          <CardDescription>Design offices and talk by walking up to people.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input id="username" required placeholder="jane" value={form.username} onChange={set('username')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="display">Display name</Label>
                <Input id="display" placeholder="Jane Doe" value={form.displayName} onChange={set('displayName')} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={form.email} onChange={set('email')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" required minLength={6} value={form.password} onChange={set('password')} />
            </div>
            <div className="space-y-2">
              <Label>Avatar color</Label>
              <div className="flex gap-2">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={cn(
                      'size-7 rounded-full ring-offset-2 ring-offset-background transition',
                      color === c && 'ring-2 ring-ring',
                    )}
                    style={{ background: c }}
                    aria-label={`Pick ${c}`}
                  />
                ))}
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Creating…' : 'Create account'}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link to="/login" className="text-foreground underline">
              Log in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
