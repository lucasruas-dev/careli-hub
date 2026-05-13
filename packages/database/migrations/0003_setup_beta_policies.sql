-- Temporary beta policies for Setup Central authenticated access.
-- Execute after 0002_setup_and_pulsex_core.sql if RLS is enabled.

begin;

grant select on
  public.hub_departments,
  public.hub_sectors,
  public.pulsex_channels,
  public.hub_modules,
  public.hub_permissions,
  public.hub_users,
  public.hub_user_assignments
to authenticated;

grant insert, update on
  public.hub_departments,
  public.hub_sectors,
  public.pulsex_channels,
  public.hub_user_assignments
to authenticated;

drop policy if exists "setup beta read departments" on public.hub_departments;
create policy "setup beta read departments"
  on public.hub_departments
  for select
  to authenticated
  using (true);

drop policy if exists "setup beta insert departments" on public.hub_departments;
create policy "setup beta insert departments"
  on public.hub_departments
  for insert
  to authenticated
  with check (true);

drop policy if exists "setup beta update departments" on public.hub_departments;
create policy "setup beta update departments"
  on public.hub_departments
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "setup beta read sectors" on public.hub_sectors;
create policy "setup beta read sectors"
  on public.hub_sectors
  for select
  to authenticated
  using (true);

drop policy if exists "setup beta insert sectors" on public.hub_sectors;
create policy "setup beta insert sectors"
  on public.hub_sectors
  for insert
  to authenticated
  with check (true);

drop policy if exists "setup beta update sectors" on public.hub_sectors;
create policy "setup beta update sectors"
  on public.hub_sectors
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "setup beta read pulsex channels" on public.pulsex_channels;
create policy "setup beta read pulsex channels"
  on public.pulsex_channels
  for select
  to authenticated
  using (true);

drop policy if exists "setup beta insert pulsex channels" on public.pulsex_channels;
create policy "setup beta insert pulsex channels"
  on public.pulsex_channels
  for insert
  to authenticated
  with check (true);

drop policy if exists "setup beta update pulsex channels" on public.pulsex_channels;
create policy "setup beta update pulsex channels"
  on public.pulsex_channels
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "setup beta read modules" on public.hub_modules;
create policy "setup beta read modules"
  on public.hub_modules
  for select
  to authenticated
  using (true);

drop policy if exists "setup beta read permissions" on public.hub_permissions;
create policy "setup beta read permissions"
  on public.hub_permissions
  for select
  to authenticated
  using (true);

drop policy if exists "setup beta read users" on public.hub_users;
create policy "setup beta read users"
  on public.hub_users
  for select
  to authenticated
  using (true);

drop policy if exists "setup beta read user assignments" on public.hub_user_assignments;
create policy "setup beta read user assignments"
  on public.hub_user_assignments
  for select
  to authenticated
  using (true);

drop policy if exists "setup beta insert user assignments" on public.hub_user_assignments;
create policy "setup beta insert user assignments"
  on public.hub_user_assignments
  for insert
  to authenticated
  with check (true);

drop policy if exists "setup beta update user assignments" on public.hub_user_assignments;
create policy "setup beta update user assignments"
  on public.hub_user_assignments
  for update
  to authenticated
  using (true)
  with check (true);

commit;
