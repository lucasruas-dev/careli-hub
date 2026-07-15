-- FIX da 0045: caredesk_whatsapp_groups ficou com RLS habilitado e ZERO politicas,
-- assumindo acesso so por service-role. Mas o carregamento da Iris roda no NAVEGADOR
-- (client Supabase do usuario), entao a tabela devolvia zero linhas e o grupo nunca
-- aparecia na tela. Espelha o padrao das demais tabelas caredesk:
--   leitura  -> qualquer autenticado
--   escrita  -> operador/lider/admin ativo (o servidor usa service-role e ignora RLS)

begin;

drop policy if exists "caredesk authenticated read"
  on public.caredesk_whatsapp_groups;

create policy "caredesk authenticated read"
  on public.caredesk_whatsapp_groups
  for select
  to authenticated
  using (true);

drop policy if exists "caredesk authenticated operation manage"
  on public.caredesk_whatsapp_groups;

create policy "caredesk authenticated operation manage"
  on public.caredesk_whatsapp_groups
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'::public.hub_record_status
        and user_profile.role = any (
          array[
            'admin'::public.hub_user_role,
            'leader'::public.hub_user_role,
            'operator'::public.hub_user_role
          ]
        )
    )
  )
  with check (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'::public.hub_record_status
        and user_profile.role = any (
          array[
            'admin'::public.hub_user_role,
            'leader'::public.hub_user_role,
            'operator'::public.hub_user_role
          ]
        )
    )
  );

commit;
