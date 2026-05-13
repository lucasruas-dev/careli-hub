-- Temporary beta policies for PulseX group participants.
-- Execute after 0006_setup_user_assignment_access.sql while the app is in beta.

begin;

grant select, insert, update, delete on
  public.pulsex_channel_members
to authenticated;

drop policy if exists "setup beta read pulsex channel members" on public.pulsex_channel_members;
create policy "setup beta read pulsex channel members"
  on public.pulsex_channel_members
  for select
  to authenticated
  using (true);

drop policy if exists "setup beta insert pulsex channel members" on public.pulsex_channel_members;
create policy "setup beta insert pulsex channel members"
  on public.pulsex_channel_members
  for insert
  to authenticated
  with check (true);

drop policy if exists "setup beta update pulsex channel members" on public.pulsex_channel_members;
create policy "setup beta update pulsex channel members"
  on public.pulsex_channel_members
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "setup beta delete pulsex channel members" on public.pulsex_channel_members;
create policy "setup beta delete pulsex channel members"
  on public.pulsex_channel_members
  for delete
  to authenticated
  using (true);

commit;
