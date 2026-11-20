import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Users, Loader2 } from 'lucide-react';
import { listOfficeMembers, updateOfficeMemberRole } from '../lib/api';
import type { Profile } from '../types';
import { Button } from './ui/button';
import { Avatar } from './ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog';

type MemberInfo = { role: string; profile: Profile };

export function MembersDialog({ officeId, officeName }: { officeId: string; officeName: string }) {
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<MemberInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyRole, setBusyRole] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setLoading(true);
      listOfficeMembers(officeId)
        .then(setMembers)
        .catch(() => toast.error('Failed to load members'))
        .finally(() => setLoading(false));
    }
  }, [open, officeId]);

  const toggleRole = async (userId: string, currentRole: string) => {
    const nextRole = currentRole === 'admin' ? 'member' : 'admin';
    setBusyRole(userId);
    try {
      await updateOfficeMemberRole(officeId, userId, nextRole);
      setMembers((prev) =>
        prev.map((m) => (m.profile.id === userId ? { ...m, role: nextRole } : m)),
      );
      toast.success(`Role updated to ${nextRole}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change role');
    } finally {
      setBusyRole(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Users className="size-4 mr-2" /> Members
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Manage Members in {officeName}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto pr-2 -mr-2 mt-4 space-y-4">
          {loading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : members.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center">No members found.</p>
          ) : (
            members.map((m) => (
              <div key={m.profile.id} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar
                    name={m.profile.display_name}
                    color={m.profile.color}
                    src={m.profile.avatar_url ?? undefined}
                    className="size-9"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{m.profile.display_name}</p>
                    <p className="text-xs text-muted-foreground truncate">@{m.profile.username}</p>
                  </div>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  {m.role === 'owner' ? (
                    <span className="text-xs font-semibold uppercase text-muted-foreground bg-muted px-2 py-1 rounded">
                      Owner
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant={m.role === 'admin' ? 'default' : 'secondary'}
                      disabled={busyRole === m.profile.id}
                      onClick={() => toggleRole(m.profile.id, m.role)}
                      className="text-xs h-7"
                    >
                      {busyRole === m.profile.id && <Loader2 className="mr-1 size-3 animate-spin" />}
                      {m.role === 'admin' ? 'Admin' : 'Member'}
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
