-- Hades / Guardian - Motor da Cobranca (Fase 2): workflow de APROVACAO das
-- propostas + thread de comentarios.
--
-- Promove o estado de aprovacao que a Fase 1 guardava em metadata jsonb
-- (metadata.approval_status) para colunas reais em guardian_compromissos, e
-- adiciona a tabela de comentarios da Central do gestor (auditavel).
--
-- Toda proposta (promessa E acordo) nasce em elaboracao -> e ENVIADA (pendente)
-- -> Admin APROVA ou REPROVA (com motivo obrigatorio). So Admin aprova/reprova;
-- operador/leader podem comentar. Financeiro (juros/multa/desconto/entrada/
-- forma) continua no metadata jsonb (sem coluna).
--
-- Puramente ADITIVA: nada deixa de funcionar; a Fase 1 (metadata) e relida no
-- backfill. Mesmo padrao da 0036 (begin/commit, set_hub_updated_at, hub_users,
-- RLS por papel como defesa em profundidade).

begin;

-- 1) Colunas de aprovacao em guardian_compromissos.
alter table public.guardian_compromissos
  add column if not exists approval_status text not null default 'em_elaboracao',
  add column if not exists approved_by_user_id uuid
    references public.hub_users(id) on delete set null,
  add column if not exists approval_reason text,
  add column if not exists submitted_at timestamptz,
  add column if not exists approved_at timestamptz;

-- CHECK do estado de aprovacao (idempotente: cria so se ainda nao existir).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'guardian_compromissos_approval_status_check'
  ) then
    alter table public.guardian_compromissos
      add constraint guardian_compromissos_approval_status_check check (
        approval_status in ('em_elaboracao', 'pendente', 'aprovado', 'reprovado')
      );
  end if;
end;
$$;

comment on column public.guardian_compromissos.approval_status is
  'Workflow de aprovacao: em_elaboracao -> pendente (enviada) -> aprovado/reprovado. So Admin decide.';
comment on column public.guardian_compromissos.approved_by_user_id is
  'Admin (hub_users) que aprovou ou reprovou a proposta.';
comment on column public.guardian_compromissos.approval_reason is
  'Motivo obrigatorio na reprovacao (e opcional na aprovacao).';

-- 2) Backfill: promove metadata.approval_status (Fase 1) para a coluna.
-- A Fase 1 grava metadata.approval_status='pendente' ao enviar; tratamos o
-- valor legado 'elaboracao' como 'em_elaboracao'. submitted_at = created_at
-- para o que ja estava enviado (pendente/aprovado/reprovado).
update public.guardian_compromissos
set
  approval_status = case
    when metadata->>'approval_status' = 'aprovado' then 'aprovado'
    when metadata->>'approval_status' = 'reprovado' then 'reprovado'
    when metadata->>'approval_status' in ('elaboracao', 'em_elaboracao') then 'em_elaboracao'
    when metadata->>'approval_status' = 'pendente' then 'pendente'
    -- Sem marca no metadata: se ja existe e nao e rascunho, assume enviada.
    else 'pendente'
  end,
  submitted_at = coalesce(
    submitted_at,
    case
      when coalesce(metadata->>'approval_status', 'pendente') in ('elaboracao', 'em_elaboracao')
        then null
      else created_at
    end
  )
where approval_status = 'em_elaboracao';

-- Indice da Central do gestor: lista todas as propostas PENDENTES (todos os
-- clientes) por data de envio. Parcial = so o que importa pra fila de aprovacao.
create index if not exists guardian_compromissos_pending_idx
  on public.guardian_compromissos (submitted_at desc)
  where approval_status = 'pendente';

create index if not exists guardian_compromissos_approval_idx
  on public.guardian_compromissos (approval_status, created_at desc);

-- 3) Thread de comentarios da Central do gestor (auditavel, imutavel).
create table if not exists public.guardian_compromisso_comments (
  id uuid primary key default gen_random_uuid(),
  compromisso_id uuid not null
    references public.guardian_compromissos(id) on delete cascade,
  author_user_id uuid references public.hub_users(id) on delete set null,
  kind text not null default 'comment',
  body text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint guardian_compromisso_comments_kind_check check (
    kind in ('comment', 'aprovacao', 'reprovacao', 'sistema')
  ),
  constraint guardian_compromisso_comments_body_not_blank check (btrim(body) <> '')
);

comment on table public.guardian_compromisso_comments is
  'Thread de comentarios das propostas (Central do gestor). kind marca nota humana vs evento de aprovacao/reprovacao. Imutavel (auditavel).';

create index if not exists guardian_compromisso_comments_compromisso_idx
  on public.guardian_compromisso_comments (compromisso_id, created_at);

-- RLS: defesa em profundidade (o app usa service_role e valida a sessao em
-- codigo). Leitura: admin/leader/operator/viewer. Escrita (insert): admin/
-- leader/operator. Sem update/delete (thread imutavel).
alter table public.guardian_compromisso_comments enable row level security;

revoke all privileges on table public.guardian_compromisso_comments
  from anon, authenticated, service_role;

grant select, insert on table public.guardian_compromisso_comments
  to authenticated, service_role;

drop policy if exists "guardian compromisso comments read"
  on public.guardian_compromisso_comments;
create policy "guardian compromisso comments read"
  on public.guardian_compromisso_comments
  for select
  to authenticated
  using (
    exists (
      select 1 from public.hub_users u
      where u.id = auth.uid()
        and u.status = 'active'
        and u.role in ('admin', 'leader', 'operator', 'viewer')
    )
  );

drop policy if exists "guardian compromisso comments insert"
  on public.guardian_compromisso_comments;
create policy "guardian compromisso comments insert"
  on public.guardian_compromisso_comments
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.hub_users u
      where u.id = auth.uid()
        and u.status = 'active'
        and u.role in ('admin', 'leader', 'operator')
    )
  );

alter table public.guardian_compromisso_comments replica identity full;

commit;
