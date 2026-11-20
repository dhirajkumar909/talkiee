import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { DoorOpen, Pencil, Plus, Trash2, Check, X } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import {
  acceptInvite,
  createOffice,
  declineInvite,
  deleteOffice,
  listMyInvites,
  listMyOffices,
} from '../lib/api';
import type { Office } from '../types';
import { Navbar } from '../components/Navbar';
import { InviteDialog } from '../components/InviteDialog';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { MembersDialog } from '../components/MembersDialog';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../components/ui/dialog';

type Invite = Awaited<ReturnType<typeof listMyInvites>>[number];

export function Dashboard() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [offices, setOffices] = useState<(Office & { myRole: string })[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    if (!profile) return;
    try {
      const [o, i] = await Promise.all([listMyOffices(profile.id), listMyInvites()]);
      setOffices(o);
      setInvites(i);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, [profile]);

  const onAccept = async (id: string) => {
    await acceptInvite(id);
    toast.success('Joined office');
    refresh();
  };
  const onDecline = async (id: string) => {
    await declineInvite(id);
    refresh();
  };
  const onDelete = async (office: Office) => {
    if (!confirm(`Delete "${office.name}"? This can't be undone.`)) return;
    await deleteOffice(office.id);
    toast.success('Office deleted');
    refresh();
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="mx-auto max-w-6xl px-6 py-10">
        {invites.length > 0 && (
          <section className="mb-10">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Pending invites
            </h2>
            <div className="space-y-2">
              {invites.map((inv) => (
                <Card key={inv.id}>
                  <CardContent className="flex items-center justify-between gap-4 py-4">
                    <div>
                      <p className="font-medium">{inv.office?.name}</p>
                      <p className="text-sm text-muted-foreground">
                        Invited by {inv.inviter?.display_name}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => onAccept(inv.id)}>
                        <Check /> Accept
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => onDecline(inv.id)}>
                        <X /> Decline
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}

        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">Your offices</h1>
          <CreateOfficeDialog
            onCreated={(office) => navigate(`/office/${office.id}/edit`)}
          />
        </div>

        {loading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : offices.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
              <p className="text-muted-foreground">You don't have any offices yet.</p>
              <CreateOfficeDialog onCreated={(o) => navigate(`/office/${o.id}/edit`)} />
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 items-start">
            {offices.map((office) => {
              const isOwner = office.owner_id === profile?.id;
              const isAdmin = office.myRole === 'admin';
              const canInvite = isOwner || isAdmin;
              const displayRole = office.myRole.charAt(0).toUpperCase() + office.myRole.slice(1);
              return (
                <Card key={office.id} className="flex flex-col">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle>{office.name}</CardTitle>
                      <Badge variant={isOwner ? 'default' : isAdmin ? 'outline' : 'secondary'}>
                        {displayRole}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => navigate(`/office/${office.id}`)}>
                        <DoorOpen /> Enter
                      </Button>
                      {canInvite && (
                        <InviteDialog officeId={office.id} officeName={office.name} />
                      )}
                    </div>
                    {isOwner && (
                      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/50">
                        <MembersDialog officeId={office.id} officeName={office.name} />
                        <Button size="sm" variant="outline" onClick={() => navigate(`/office/${office.id}/edit`)}>
                          <Pencil /> Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="ml-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => onDelete(office)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

function CreateOfficeDialog({ onCreated }: { onCreated: (office: Office) => void }) {
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setBusy(true);
    try {
      const office = await createOffice(profile.id, name.trim() || 'My Office');
      setOpen(false);
      setName('');
      onCreated(office);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create office');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> New office
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create an office</DialogTitle>
        </DialogHeader>
        <form onSubmit={create} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Office name</Label>
            <Input
              id="name"
              autoFocus
              placeholder="Acme HQ"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy ? 'Creating…' : 'Create & design'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
