-- 0044 — Conserto do drift repo<->prod exposto pela 0041 (2/jul/2026)
--
-- A migration 0003_setup_operational_access.sql (policies admin "manage" de
-- hub_departments/hub_sectors/pulsex_channels) NUNCA foi aplicada em prod --
-- o repo tem DUAS migrations numeradas 0003 e so a outra rodou. As policies
-- "setup beta" eram a UNICA via de escrita dessas tabelas; quando a 0041 as
-- derrubou, o Setup parou de salvar ("Nao foi possivel salvar departamento").
-- Cria as policies admin-only que a 0003 deveria ter criado, no padrao da
-- 0041 ((select auth.uid()) para nao reavaliar por linha).

begin;

drop policy if exists "setup admin manage departments" on public.hub_departments;
create policy "setup admin manage departments"
  on public.hub_departments
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = (select auth.uid())
        and user_profile.role = 'admin'
        and user_profile.status = 'active'
    )
  )
  with check (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = (select auth.uid())
        and user_profile.role = 'admin'
        and user_profile.status = 'active'
    )
  );

drop policy if exists "setup admin manage sectors" on public.hub_sectors;
create policy "setup admin manage sectors"
  on public.hub_sectors
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = (select auth.uid())
        and user_profile.role = 'admin'
        and user_profile.status = 'active'
    )
  )
  with check (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = (select auth.uid())
        and user_profile.role = 'admin'
        and user_profile.status = 'active'
    )
  );

drop policy if exists "setup admin manage pulsex channels" on public.pulsex_channels;
create policy "setup admin manage pulsex channels"
  on public.pulsex_channels
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = (select auth.uid())
        and user_profile.role = 'admin'
        and user_profile.status = 'active'
    )
  )
  with check (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = (select auth.uid())
        and user_profile.role = 'admin'
        and user_profile.status = 'active'
    )
  );

commit;
