-- ===========================================================================
-- talkiee schema — run this once in your Supabase project's SQL editor.
-- (Supabase dashboard → SQL Editor → New query → paste → Run)
-- Safe to re-run: drops and recreates policies/functions.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  username    text unique not null,
  display_name text not null,
  color       text not null default '#4f46e5',
  avatar_url  text,
  created_at  timestamptz not null default now()
);

create table if not exists public.offices (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  name        text not null,
  layout      jsonb not null default '{"width":24,"height":16,"items":[]}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.office_members (
  office_id   uuid not null references public.offices(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  role        text not null default 'member',
  created_at  timestamptz not null default now(),
  primary key (office_id, user_id)
);

create table if not exists public.office_invites (
  id          uuid primary key default gen_random_uuid(),
  office_id   uuid not null references public.offices(id) on delete cascade,
  inviter_id  uuid not null references public.profiles(id) on delete cascade,
  invitee_id  uuid not null references public.profiles(id) on delete cascade,
  status      text not null default 'pending',
  created_at  timestamptz not null default now(),
  unique (office_id, invitee_id)
);

-- ---------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER to avoid RLS recursion)
-- ---------------------------------------------------------------------------
create or replace function public.is_office_member(oid uuid, uid uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.office_members m where m.office_id = oid and m.user_id = uid);
$$;

create or replace function public.is_office_owner(oid uuid, uid uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.offices o where o.id = oid and o.owner_id = uid);
$$;

-- ---------------------------------------------------------------------------
-- Triggers: create a profile on signup; add owner as a member on office create
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, display_name, color)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'color', '#4f46e5')
  )
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.handle_new_office()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.office_members (office_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict do nothing;
  return new;
end; $$;

drop trigger if exists on_office_created on public.offices;
create trigger on_office_created
  after insert on public.offices
  for each row execute function public.handle_new_office();

-- ---------------------------------------------------------------------------
-- Invite RPCs (SECURITY DEFINER)
-- ---------------------------------------------------------------------------
create or replace function public.accept_invite(p_invite_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare inv public.office_invites;
begin
  select * into inv from public.office_invites
    where id = p_invite_id and invitee_id = auth.uid() and status = 'pending';
  if not found then raise exception 'Invite not found or not pending'; end if;

  insert into public.office_members (office_id, user_id, role)
  values (inv.office_id, inv.invitee_id, 'member')
  on conflict do nothing;

  update public.office_invites set status = 'accepted' where id = p_invite_id;
end; $$;

create or replace function public.decline_invite(p_invite_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.office_invites set status = 'declined'
    where id = p_invite_id and invitee_id = auth.uid() and status = 'pending';
end; $$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles       enable row level security;
alter table public.offices        enable row level security;
alter table public.office_members enable row level security;
alter table public.office_invites enable row level security;

-- profiles: any authenticated user can read (needed to search/invite); self can edit
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (true);

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated with check (id = auth.uid());

-- offices: members can read; only owner can create / modify / delete.
-- NOTE: `owner_id = auth.uid()` must be included directly (not only via the
-- is_office_member helper) so the owner can read a row back immediately after
-- INSERT ... RETURNING — the STABLE helper can't see the membership row the
-- on_office_created trigger inserts in the same statement.
drop policy if exists offices_select on public.offices;
create policy offices_select on public.offices
  for select to authenticated
  using (owner_id = auth.uid() or public.is_office_member(id, auth.uid()));

drop policy if exists offices_insert on public.offices;
create policy offices_insert on public.offices
  for insert to authenticated with check (owner_id = auth.uid());

drop policy if exists offices_update on public.offices;
create policy offices_update on public.offices
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists offices_delete on public.offices;
create policy offices_delete on public.offices
  for delete to authenticated using (owner_id = auth.uid());

-- office_members: co-members can see each other; owner manages; self can leave
drop policy if exists members_select on public.office_members;
create policy members_select on public.office_members
  for select to authenticated using (public.is_office_member(office_id, auth.uid()));

drop policy if exists members_insert on public.office_members;
create policy members_insert on public.office_members
  for insert to authenticated with check (public.is_office_owner(office_id, auth.uid()));

drop policy if exists members_delete on public.office_members;
create policy members_delete on public.office_members
  for delete to authenticated
  using (public.is_office_owner(office_id, auth.uid()) or user_id = auth.uid());

-- office_invites: the invitee or the office owner can see; owner creates
drop policy if exists invites_select on public.office_invites;
create policy invites_select on public.office_invites
  for select to authenticated
  using (invitee_id = auth.uid() or public.is_office_owner(office_id, auth.uid()));

drop policy if exists invites_insert on public.office_invites;
create policy invites_insert on public.office_invites
  for insert to authenticated
  with check (inviter_id = auth.uid() and public.is_office_owner(office_id, auth.uid()));

drop policy if exists invites_delete on public.office_invites;
create policy invites_delete on public.office_invites
  for delete to authenticated using (public.is_office_owner(office_id, auth.uid()));

-- ---------------------------------------------------------------------------
-- Storage setup for avatars
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public) 
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "Avatars are publicly accessible."
  on storage.objects for select
  using ( bucket_id = 'avatars' );

create policy "Users can upload their own avatar."
  on storage.objects for insert
  with check ( bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1] );

create policy "Users can update their own avatar."
  on storage.objects for update
  using ( bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1] );

