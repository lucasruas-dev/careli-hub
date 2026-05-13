-- Temporary beta policies for assigning operational users in Setup Central.
-- Execute after 0005_setup_beta_access_policies.sql while the app is in beta.

begin;

grant update on public.hub_users to authenticated;

grant insert, update on
  public.hub_user_assignments
to authenticated;

drop policy if exists "setup beta update hub users" on public.hub_users;
create policy "setup beta update hub users"
  on public.hub_users
  for update
  to authenticated
  using (true)
  with check (true);

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
