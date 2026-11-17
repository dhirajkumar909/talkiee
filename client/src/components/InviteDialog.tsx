import { useState } from 'react';
import { toast } from 'sonner';
import { UserPlus } from 'lucide-react';
import { findProfileByUsername, inviteToOffice } from '../lib/api';
import { useAuth } from '../auth/AuthProvider';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog';

export function InviteDialog({ officeId, officeName }: { officeId: string; officeName: string }) {
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setBusy(true);
    try {
      const target = await findProfileByUsername(username);
      if (!target) {
        toast.error(`No user named "${username}"`);
        return;
      }
      if (target.id === profile.id) {
        toast.error("You're already in this office");
        return;
      }
      await inviteToOffice(officeId, profile.id, target.id);
      toast.success(`Invited ${target.display_name}`);
      setUsername('');
      setOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not send invite';
      toast.error(msg.includes('duplicate') ? 'They already have an invite' : msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <UserPlus /> Invite
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite to {officeName}</DialogTitle>
          <DialogDescription>Invite a teammate by their talkiee username.</DialogDescription>
        </DialogHeader>
        <form onSubmit={invite} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="invitee">Username</Label>
            <Input
              id="invitee"
              placeholder="jane"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy || !username.trim()}>
              {busy ? 'Sending…' : 'Send invite'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
