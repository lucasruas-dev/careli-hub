-- Minimum authenticated access for Setup Central operational data.
-- Execute after 0002_setup_and_pulsex_core.sql.

begin;

grant select on
  public.hub_departments,
  public.hub_sectors,
  public.hub_user_assignments,
  public.hub_department_modules,
  public.hub_modules,
  public.hub_permissions,
  public.hub_users,
  public.pulsex_channels
to authenticated;

grant insert, update on
  public.hub_departments,
  public.hub_sectors,
  public.pulsex_channels
to authenticated;

drop policy if exists "setup authenticated read departments" on public.hub_departments;
create policy "setup authenticated read departments"
  on public.hub_departments
  for select
  to authenticated
  using (true);

drop policy if exists "setup authenticated manage departments" on public.hub_departments;
create policy "setup authenticated manage departments"
  on public.hub_departments
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.role = 'admin'
        and user_profile.status = 'active'
    )
  )
  with check (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.role = 'admin'
        and user_profile.status = 'active'
    )
  );

drop policy if exists "setup authenticated read sectors" on public.hub_sectors;
create policy "setup authenticated read sectors"
  on public.hub_sectors
  for select
  to authenticated
  using (true);

drop policy if exists "setup authenticated manage sectors" on public.hub_sectors;
create policy "setup authenticated manage sectors"
  on public.hub_sectors
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.role = 'admin'
        and user_profile.status = 'active'
    )
  )
  with check (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.role = 'admin'
        and user_profile.status = 'active'
    )
  );

drop policy if exists "setup authenticated read pulsex channels" on public.pulsex_channels;
create policy "setup authenticated read pulsex channels"
  on public.pulsex_channels
  for select
  to authenticated
  using (true);

drop policy if exists "setup authenticated manage pulsex channels" on public.pulsex_channels;
create policy "setup authenticated manage pulsex channels"
  on public.pulsex_channels
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.role = 'admin'
        and user_profile.status = 'active'
    )
  )
  with check (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.role = 'admin'
        and user_profile.status = 'active'
    )
  );

drop policy if exists "setup authenticated read modules" on public.hub_modules;
create policy "setup authenticated read modules"
  on public.hub_modules
  for select
  to authenticated
  using (true);

drop policy if exists "setup authenticated read permissions" on public.hub_permissions;
create policy "setup authenticated read permissions"
  on public.hub_permissions
  for select
  to authenticated
  using (true);

drop policy if exists "setup authenticated read user profiles" on public.hub_users;
create policy "setup authenticated read user profiles"
  on public.hub_users
  for select
  to authenticated
  using (
    status = 'active'
    or id = auth.uid()
  );

drop policy if exists "setup authenticated read user assignments" on public.hub_user_assignments;
create policy "setup authenticated read user assignments"
  on public.hub_user_assignments
  for select
  to authenticated
  using (
    status = 'active'
    or user_id = auth.uid()
    or exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.role = 'admin'
        and user_profile.status = 'active'
    )
  );

drop policy if exists "setup authenticated read department modules" on public.hub_department_modules;
create policy "setup authenticated read department modules"
  on public.hub_department_modules
  for select
  to authenticated
  using (true);

commit;
