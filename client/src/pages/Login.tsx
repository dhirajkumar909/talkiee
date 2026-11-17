import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '../auth/AuthProvider';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { ThemeToggle } from '../components/ThemeToggle';

export function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await signIn(email, password);
      navigate('/dashboard');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not sign in');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-dots p-6">
      <ThemeToggle className="absolute right-4 top-4" />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Welcome back</CardTitle>
          <CardDescription>Log in to your talkiee offices.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Logging in…' : 'Log in'}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            No account?{' '}
            <Link to="/signup" className="text-foreground underline">
              Sign up
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
