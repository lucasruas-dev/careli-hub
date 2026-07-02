-- 0041 — Hardening das policies "setup beta" (P0 do diagnostico de 2/jul/2026)
--
-- Contexto: os advisors do Supabase apontaram policies de escrita com
-- USING (true) / WITH CHECK (true) para QUALQUER usuario autenticado. Como o
-- Setup escreve nessas tabelas direto do browser (sessao do usuario, REST do
-- Supabase), isso significava escrita irrestrita por fora do gate do proxy.ts.
--
-- O caso mais grave: "setup beta update hub users" (migration 0006) permitia a
-- qualquer logado editar QUALQUER linha de hub_users — inclusive o proprio
-- role = escalacao de privilegio para admin.
--
-- Correcao: escrita passa a exigir role='admin' ativo (mesmo padrao das
-- policies "setup authenticated manage *" da 0003, que ja cobrem
-- hub_departments/hub_sectors/pulsex_channels — nessas, basta dropar as beta).
-- Leituras NAO mudam. A tela de Setup e fluxo de admin, entao nada quebra.
--
-- ⚠️ Aplicar em prod SO com OK explicito do Lucas (regra-mae do CLAUDE.md).

begin;

-- 1) Derruba as policies de escrita abertas ----------------------------------

drop policy if exists "setup beta insert departments" on public.hub_departments;
drop policy if exists "setup beta update departments" on public.hub_departments;

drop policy if exists "setup beta insert sectors" on public.hub_sectors;
drop policy if exists "setup beta update sectors" on public.hub_sectors;

drop policy if exists "setup beta insert pulsex channels" on public.pulsex_channels;
drop policy if exists "setup beta update pulsex channels" on public.pulsex_channels;

drop policy if exists "setup beta update hub users" on public.hub_users;

drop policy if exists "setup beta insert user assignments" on public.hub_user_assignments;
drop policy if exists "setup beta update user assignments" on public.hub_user_assignments;

drop policy if exists "setup beta insert pulsex channel members" on public.pulsex_channel_members;
drop policy if exists "setup beta update pulsex channel members" on public.pulsex_channel_members;
drop policy if exists "setup beta delete pulsex channel members" on public.pulsex_channel_members;

-- 2) Escrita admin-only onde a 0003 ainda nao cobria --------------------------
-- (select auth.uid()) em vez de auth.uid() direto: evita reavaliacao por linha
-- (advisor auth_rls_initplan).

drop policy if exists "setup admin update hub users" on public.hub_users;
create policy "setup admin update hub users"
  on public.hub_users
  for update
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

drop policy if exists "setup admin manage user assignments" on public.hub_user_assignments;
create policy "setup admin manage user assignments"
  on public.hub_user_assignments
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

drop policy if exists "setup admin manage pulsex channel members" on public.pulsex_channel_members;
create policy "setup admin manage pulsex channel members"
  on public.pulsex_channel_members
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

-- 3) Funcoes SECURITY DEFINER expostas via /rest/v1/rpc -----------------------
-- sync_hub_user_from_auth: interna (trigger em auth.users) — nenhum código do
-- app chama via rpc; o trigger nao depende de EXECUTE dos roles de API.
-- has_chronos_permission: usada em policies `to authenticated` — anon nunca
-- deveria executar.

revoke execute on function public.sync_hub_user_from_auth() from anon, authenticated;
revoke execute on function public.has_chronos_permission(text) from anon;

commit;
