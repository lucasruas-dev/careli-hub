-- IRIS: fecha o SELECT das conversas, hoje aberto para qualquer usuário logado.
--
-- ⚠️ O PROBLEMA. Todas as tabelas `caredesk_*` têm RLS ligado, mas a policy de leitura é
-- `caredesk authenticated read ... USING (true)`: QUALQUER usuário autenticado lê TODAS as
-- conversas, de todas as filas. A restrição por fila existe só no CLIENTE, em JavaScript
-- (`canSeeResource`, iris-data-client.ts:133) — e o próprio `access-scope.ts:18` já registrava
-- que "a segurança de verdade é a camada de RLS, tratada à parte". É esta camada.
--
-- Na prática: um leader restrito ao seu setor lê o Jurídico inteiro chamando o PostgREST
-- direto, sem passar pela tela.
--
-- 🎯 E É PRÉ-REQUISITO DO REALTIME. O Supabase Realtime respeita RLS: publicar as tabelas com
-- `USING (true)` mandaria toda mensagem nova para todo mundo. Por isso a policy vem ANTES.
--
-- ── ESCOPO DESTA MIGRATION ───────────────────────────────────────────────────
-- Fecha as três tabelas que carregam CONTEÚDO de conversa: tickets, mensagens e anexos.
-- Catálogo (filas, canais, templates, perfis, vínculos) segue legível de propósito: não tem
-- dado de cliente, e o cliente precisa dele para montar a própria régua. Contatos e o resto
-- ficam para um segundo passo, medido à parte.

-- ── A RÉGUA, EM SQL ──────────────────────────────────────────────────────────
-- Espelha `canSeeResource` (lib/hub/access-scope.ts):
--   adm            -> tudo
--   cdr            -> filas com vínculo de um departamento seu
--   op1/op2/op3/ldr-> filas com vínculo do seu setor, ou de departamento inteiro que seja seu
--   fila SEM vínculo -> só adm
--
-- SECURITY DEFINER porque precisa ler `hub_users` e `hub_user_assignments` sem esbarrar na RLS
-- delas (e sem exigir que o usuário tenha permissão de leitura nessas tabelas).
-- STABLE + retorno em ARRAY para o Postgres avaliar UMA vez por query, e não por linha: com
-- `IN (subquery)` numa tabela de 2.600 tickets isso pesaria.
create or replace function public.iris_filas_visiveis()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  with eu as (
    select operational_profile::text as perfil
      from public.hub_users
     where id = auth.uid() and status = 'active'
  ),
  meus as (
    select array_remove(array_agg(distinct department_id), null) as deptos,
           array_remove(array_agg(distinct sector_id), null)     as setores
      from public.hub_user_assignments
     where user_id = auth.uid() and status = 'active'
  )
  select coalesce(array_agg(q.id), '{}'::uuid[])
    from public.caredesk_queues q, eu, meus
   where eu.perfil = 'adm'
      or exists (
           select 1
             from public.caredesk_queue_scopes s
            where s.queue_id = q.id
              and case
                    when eu.perfil = 'cdr'
                      then s.department_id = any(meus.deptos)
                    else s.sector_id = any(meus.setores)
                      or (s.sector_id is null and s.department_id = any(meus.deptos))
                  end);
$$;

revoke all on function public.iris_filas_visiveis() from public;
grant execute on function public.iris_filas_visiveis() to authenticated;

comment on function public.iris_filas_visiveis() is
  'Filas da Iris que o usuário logado enxerga. Espelha canSeeResource (lib/hub/access-scope.ts). Usada pelas policies de SELECT de caredesk_tickets/messages/message_attachments.';

-- ── TICKETS ──────────────────────────────────────────────────────────────────
-- Ticket SEM fila entra para todo mundo, de propósito: é ticket órfão, e escondê-lo atrás de
-- uma policy enterraria um problema de dado em vez de mostrá-lo. Mesma decisão do recorte de
-- central na tela.
drop policy if exists "caredesk authenticated read" on public.caredesk_tickets;
create policy "caredesk tickets read por fila"
  on public.caredesk_tickets for select to authenticated
  using (queue_id is null or queue_id = any (public.iris_filas_visiveis()));

-- ── MENSAGENS ────────────────────────────────────────────────────────────────
-- Vai pelo ticket. Mensagem sem ticket (não deveria existir) fica visível pelo mesmo motivo.
drop policy if exists "caredesk authenticated read" on public.caredesk_messages;
create policy "caredesk messages read por fila"
  on public.caredesk_messages for select to authenticated
  using (
    ticket_id is null
    or exists (
      select 1 from public.caredesk_tickets t
       where t.id = caredesk_messages.ticket_id
         and (t.queue_id is null or t.queue_id = any (public.iris_filas_visiveis()))
    )
  );

-- ── ANEXOS ───────────────────────────────────────────────────────────────────
drop policy if exists "caredesk authenticated read" on public.caredesk_message_attachments;
create policy "caredesk attachments read por fila"
  on public.caredesk_message_attachments for select to authenticated
  using (
    exists (
      select 1
        from public.caredesk_messages m
        left join public.caredesk_tickets t on t.id = m.ticket_id
       where m.id = caredesk_message_attachments.message_id
         and (m.ticket_id is null or t.queue_id is null
              or t.queue_id = any (public.iris_filas_visiveis()))
    )
  );

-- ⚠️ NOTA SOBRE ESCRITA: as policies `... operation manage` (cmd ALL) continuam como estavam e
-- NÃO restringem por fila. Fechar a escrita é um passo à parte, porque mexe no fluxo de
-- atender, e não é o que destrava o realtime. Registrado como pendência.
