import { useState, useRef } from 'react';
import { toast } from 'sonner';
import { Camera, Loader2 } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { updateProfile, uploadAvatar } from '../lib/api';
import { Avatar } from './ui/avatar';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

/** Resize and crop image to a 256x256 jpeg before upload to save bandwidth. */
async function compressImage(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const size = 256;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas not supported'));
      
      // Crop to center square
      const min = Math.min(img.width, img.height);
      const sx = (img.width - min) / 2;
      const sy = (img.height - min) / 2;
      ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
      
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error('Failed to compress image'));
        resolve(new File([blob], 'avatar.jpg', { type: 'image/jpeg' }));
      }, 'image/jpeg', 0.85); // 85% quality JPEG
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
}

export function ProfileDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { profile, refreshProfile } = useAuth();
  const [busy, setBusy] = useState(false);
  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!profile) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setBusy(true);
    try {
      const compressed = await compressImage(file);
      const url = await uploadAvatar(profile.id, compressed);
      await updateProfile(profile.id, { avatar_url: url });
      await refreshProfile();
      toast.success('Profile picture updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to upload picture');
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) return;
    setBusy(true);
    try {
      await updateProfile(profile.id, { display_name: displayName.trim() });
      await refreshProfile();
      toast.success('Profile updated');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit Profile</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center py-4">
          <div className="relative mb-6 group">
            <Avatar
              name={profile.display_name}
              color={profile.color}
              src={profile.avatar_url ?? undefined}
              className="size-24 text-2xl"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              className="absolute bottom-0 right-0 p-2 bg-background border rounded-full text-foreground shadow-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
            </button>
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>

          <form onSubmit={handleSave} className="w-full space-y-4">
            <div className="space-y-2">
              <Label htmlFor="displayName">Display Name</Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="How you appear to others"
                maxLength={50}
              />
            </div>

            <Button type="submit" className="w-full" disabled={busy || !displayName.trim()}>
              Save changes
            </Button>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
