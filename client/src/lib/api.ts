import { supabase } from "./supabase";
import type { Office, OfficeInvite, OfficeLayout, Profile } from "../types";
import { DEFAULT_LAYOUT } from "../types";

/** Offices the current user owns or is a member of. */
export async function listMyOffices(
  userId: string,
): Promise<(Office & { myRole: string })[]> {
  const { data, error } = await supabase
    .from("office_members")
    .select("role, office:offices(*)")
    .eq("user_id", userId);
  if (error) throw error;
  return (data as unknown as { role: string; office: Office }[])
    .map((d) => ({ ...d.office, myRole: d.role }))
    .sort(
      (a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );
}

export async function getOffice(id: string): Promise<Office> {
  const { data, error } = await supabase
    .from("offices")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as Office;
}

export async function createOffice(
  ownerId: string,
  name: string,
): Promise<Office> {
  const { data, error } = await supabase
    .from("offices")
    .insert({ owner_id: ownerId, name, layout: DEFAULT_LAYOUT })
    .select("*")
    .single();
  if (error) throw error;
  return data as Office;
}

export async function saveOfficeLayout(
  id: string,
  name: string,
  layout: OfficeLayout,
) {
  const { error } = await supabase
    .from("offices")
    .update({ name, layout, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteOffice(id: string) {
  const { error } = await supabase.from("offices").delete().eq("id", id);
  if (error) throw error;
}

/** Members of an office, joined with their profile. */
export async function listOfficeMembers(
  officeId: string,
): Promise<{ role: string; profile: Profile }[]> {
  const { data, error } = await supabase
    .from("office_members")
    .select("role, profile:profiles(*)")
    .eq("office_id", officeId);
  if (error) throw error;
  return (data as unknown as { role: string; profile: Profile }[]) ?? [];
}

export async function updateOfficeMemberRole(
  officeId: string,
  userId: string,
  role: string,
) {
  const { error } = await supabase
    .from("office_members")
    .update({ role })
    .match({ office_id: officeId, user_id: userId });
  if (error) throw error;

  // Verify it actually worked (in case RLS silently ignored it)
  const { data: verifyData } = await supabase
    .from("office_members")
    .select("role")
    .match({ office_id: officeId, user_id: userId })
    .single();

  if (verifyData?.role !== role) {
    throw new Error("You do not have permission to update this role");
  }
}

export async function getMyRole(
  officeId: string,
  userId: string,
): Promise<string> {
  const { data } = await supabase
    .from("office_members")
    .select("role")
    .match({ office_id: officeId, user_id: userId })
    .maybeSingle();
  return data?.role || "member";
}

export async function findProfileByUsername(
  username: string,
): Promise<Profile | null> {
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .ilike("username", username.trim())
    .maybeSingle();
  return (data as Profile) ?? null;
}

export async function updateProfile(id: string, updates: Partial<Profile>) {
  const { error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", id);
  if (error) throw error;
}

export async function uploadAvatar(
  userId: string,
  file: File,
): Promise<string> {
  const ext = file.name.split(".").pop() || "png";
  const path = `${userId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("avatars").upload(path, file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  return data.publicUrl;
}

export async function inviteToOffice(
  officeId: string,
  inviterId: string,
  inviteeId: string,
) {
  const { error } = await supabase
    .from("office_invites")
    .insert({
      office_id: officeId,
      inviter_id: inviterId,
      invitee_id: inviteeId,
      status: "pending",
    });
  if (error) throw error;
}

/** Pending invites addressed to the current user, with office + inviter info. */
export async function listMyInvites(): Promise<
  (OfficeInvite & {
    office: Pick<Office, "id" | "name">;
    inviter: Pick<Profile, "display_name">;
  })[]
> {
  const { data, error } = await supabase
    .from("office_invites")
    .select(
      "*, office:offices(id, name), inviter:profiles!office_invites_inviter_id_fkey(display_name)",
    )
    .eq("status", "pending");
  if (error) throw error;
  return (data as never) ?? [];
}

/** Get a LiveKit join token for an office from the Edge Function. */
export async function getLivekitToken(
  officeId: string,
): Promise<{ token: string; url: string }> {
  const { data, error } = await supabase.functions.invoke("livekit-token", {
    body: { room: officeId },
  });
  if (error) throw error;
  if (!data?.token || !data?.url)
    throw new Error(data?.error || "No token returned");
  return data as { token: string; url: string };
}

export async function acceptInvite(inviteId: string) {
  const { error } = await supabase.rpc("accept_invite", {
    p_invite_id: inviteId,
  });
  if (error) throw error;
}

export async function declineInvite(inviteId: string) {
  const { error } = await supabase.rpc("decline_invite", {
    p_invite_id: inviteId,
  });
  if (error) throw error;
}
