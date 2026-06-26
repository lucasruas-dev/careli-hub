-- Hades / Guardian - Motor da Cobranca: Acordos & Promessas + Regua de lembretes.
-- Fundacao de dados do motor (A1/A2). Hades REGISTRA o compromisso; o C2X continua
-- COBRANDO (gera boleto/Asaas) -- o elo e o payment_c2x_id nas parcelas.
-- NAO referencia as tabelas de read-model c2x_* por FK: elas rotacionam no sync
-- (is_current), entao usamos as chaves estaveis (client_c2x_id bigint, hub_users.id).

begin;

create extension if not exists pgcrypto;

-- Protocolo sequencial PR-* (promessa) / AC-* (acordo). Mesmo padrao dos demais
-- protocolos (sequence + funcao com lpad de 6 digitos), numero compartilhado.
create sequence if not exists public.guardian_compromisso_protocol_seq
  as bigint
  increment by 1
  minvalue 1
  start with 1
  cache 1;

create or replace function public.next_guardian_compromisso_protocol(p_kind text)
returns text
language plpgsql
set search_path = public
as $$
declare
  next_number bigint;
  prefix text;
begin
  if p_kind = 'promessa' then
    prefix := 'PR-';
  elsif p_kind = 'acordo' then
    prefix := 'AC-';
  else
    raise exception 'Tipo de compromisso invalido: %', p_kind;
  end if;

  next_number := nextval('public.guardian_compromisso_protocol_seq');

  return prefix || lpad(next_number::text, 6, '0');
end;
$$;

comment on function public.next_guardian_compromisso_protocol(text) is
  'Gera protocolos sequenciais PR-*/AC-* para compromissos de cobranca do Hades.';

revoke all on function public.next_guardian_compromisso_protocol(text) from public;
grant execute on function public.next_guardian_compromisso_protocol(text) to service_role;
grant usage, select on sequence public.guardian_compromisso_protocol_seq to service_role;

-- 1) Entidade central: o compromisso (promessa ou acordo).
create table if not exists public.guardian_compromissos (
  id uuid primary key default gen_random_uuid(),
  protocol text not null unique,
  kind text not null,
  status text not null default 'ativo',
  stage text not null,
  client_c2x_id bigint not null,
  acquisition_request_c2x_id bigint,
  attendance_protocol text,
  cobranca_protocol text,
  channel text not null default 'manual',
  total_amount numeric(14, 2) not null default 0,
  installments_count integer not null default 1,
  promised_date date,
  first_due_date date,
  risk_score integer,
  priority text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references public.hub_users(id) on delete set null,
  updated_by_user_id uuid references public.hub_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  fulfilled_at timestamptz,
  broken_at timestamptz,
  constraint guardian_compromissos_kind_check check (kind in ('promessa', 'acordo')),
  constraint guardian_compromissos_status_check check (
    status in ('ativo', 'cumprido', 'quebrado', 'cancelado')
  ),
  constraint guardian_compromissos_stage_check check (
    stage in ('aguardando_pagamento', 'aguardando_emissao', 'emitido', 'enviado')
  ),
  constraint guardian_compromissos_channel_not_blank check (btrim(channel) <> ''),
  constraint guardian_compromissos_client_positive check (client_c2x_id > 0),
  constraint guardian_compromissos_installments_positive check (installments_count >= 1),
  constraint guardian_compromissos_amount_non_negative check (total_amount >= 0),
  constraint guardian_compromissos_risk_range check (
    risk_score is null or risk_score between 0 and 100
  ),
  constraint guardian_compromissos_priority_check check (
    priority is null or priority in ('low', 'medium', 'high', 'critical')
  ),
  -- Coerencia da maquina de estados: promessa usa aguardando_pagamento; acordo
  -- usa o ciclo aguardando_emissao -> emitido -> enviado.
  constraint guardian_compromissos_kind_stage_coherent check (
    (kind = 'promessa' and stage = 'aguardando_pagamento')
    or (kind = 'acordo' and stage in ('aguardando_emissao', 'emitido', 'enviado'))
  )
);

comment on table public.guardian_compromissos is
  'Acordos e promessas de pagamento da cobranca (Hades). Hades registra; o C2X gera o boleto.';
comment on column public.guardian_compromissos.client_c2x_id is
  'Chave estavel do cliente no C2X (c2x_users.c2x_id). Sem FK: o read-model rotaciona no sync.';
comment on column public.guardian_compromissos.cobranca_protocol is
  'Protocolo da instancia do workflow de cobranca (CB-*) que originou o compromisso.';
comment on column public.guardian_compromissos.stage is
  'Sub-estado operacional: promessa=aguardando_pagamento; acordo=aguardando_emissao/emitido/enviado.';

create index if not exists guardian_compromissos_client_idx
  on public.guardian_compromissos (client_c2x_id);

create index if not exists guardian_compromissos_status_idx
  on public.guardian_compromissos (status, kind, stage);

create index if not exists guardian_compromissos_cobranca_idx
  on public.guardian_compromissos (cobranca_protocol)
  where cobranca_protocol is not null;

drop trigger if exists set_guardian_compromissos_updated_at
  on public.guardian_compromissos;
create trigger set_guardian_compromissos_updated_at
before update on public.guardian_compromissos
for each row execute function public.set_hub_updated_at();

-- 2) Parcelas do acordo (1 linha por parcela; promessa pode ter 1).
create table if not exists public.guardian_compromisso_parcelas (
  id uuid primary key default gen_random_uuid(),
  compromisso_id uuid not null
    references public.guardian_compromissos(id) on delete cascade,
  sequence integer not null,
  due_date date not null,
  amount numeric(14, 2) not null default 0,
  status text not null default 'pendente',
  payment_c2x_id bigint,
  boleto_url text,
  paid_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint guardian_compromisso_parcelas_sequence_positive check (sequence >= 1),
  constraint guardian_compromisso_parcelas_amount_non_negative check (amount >= 0),
  constraint guardian_compromisso_parcelas_status_check check (
    status in ('pendente', 'emitida', 'enviada', 'paga', 'vencida', 'cancelada')
  )
);

comment on table public.guardian_compromisso_parcelas is
  'Parcelas de um compromisso. payment_c2x_id liga a parcela ao pagamento real do C2X/Asaas.';

create unique index if not exists guardian_compromisso_parcelas_seq_uidx
  on public.guardian_compromisso_parcelas (compromisso_id, sequence);

create index if not exists guardian_compromisso_parcelas_due_idx
  on public.guardian_compromisso_parcelas (status, due_date);

create index if not exists guardian_compromisso_parcelas_payment_idx
  on public.guardian_compromisso_parcelas (payment_c2x_id)
  where payment_c2x_id is not null;

drop trigger if exists set_guardian_compromisso_parcelas_updated_at
  on public.guardian_compromisso_parcelas;
create trigger set_guardian_compromisso_parcelas_updated_at
before update on public.guardian_compromisso_parcelas
for each row execute function public.set_hub_updated_at();

-- 3) Regua de lembretes (idempotente). O cron diario consome os pendentes.
create table if not exists public.guardian_compromisso_lembretes (
  id uuid primary key default gen_random_uuid(),
  compromisso_id uuid not null
    references public.guardian_compromissos(id) on delete cascade,
  parcela_id uuid
    references public.guardian_compromisso_parcelas(id) on delete cascade,
  kind text not null,
  scheduled_for date not null,
  channel text not null default 'whatsapp',
  meta_template text,
  status text not null default 'pendente',
  sent_at timestamptz,
  message_id text,
  failure_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint guardian_compromisso_lembretes_kind_check check (
    kind in ('D-3', 'D-2', 'D-1', 'D0')
  ),
  constraint guardian_compromisso_lembretes_status_check check (
    status in ('pendente', 'enviado', 'falhou', 'cancelado')
  ),
  constraint guardian_compromisso_lembretes_channel_not_blank check (btrim(channel) <> '')
);

comment on table public.guardian_compromisso_lembretes is
  'Regua de lembretes (D-3/D-2/D-1/D0) por compromisso/parcela. Disparada por cron diario.';

-- Idempotencia: um unico lembrete por (compromisso, parcela, janela). NULLS NOT
-- DISTINCT trata a promessa (parcela_id null) como chave unica de verdade.
create unique index if not exists guardian_compromisso_lembretes_idem_uidx
  on public.guardian_compromisso_lembretes (compromisso_id, parcela_id, kind)
  nulls not distinct;

create index if not exists guardian_compromisso_lembretes_due_idx
  on public.guardian_compromisso_lembretes (scheduled_for, status);

create index if not exists guardian_compromisso_lembretes_compromisso_idx
  on public.guardian_compromisso_lembretes (compromisso_id);

drop trigger if exists set_guardian_compromisso_lembretes_updated_at
  on public.guardian_compromisso_lembretes;
create trigger set_guardian_compromisso_lembretes_updated_at
before update on public.guardian_compromisso_lembretes
for each row execute function public.set_hub_updated_at();

-- RLS: app usa service_role (valida a sessao em codigo via authorizeHadesRead),
-- mas habilitamos RLS + policias por papel como defesa em profundidade para
-- qualquer acesso autenticado direto. Leitura: admin/leader/operator/viewer.
-- Escrita: admin/leader/operator (quem opera a cobranca).
alter table public.guardian_compromissos enable row level security;
alter table public.guardian_compromisso_parcelas enable row level security;
alter table public.guardian_compromisso_lembretes enable row level security;

revoke all privileges on table
  public.guardian_compromissos,
  public.guardian_compromisso_parcelas,
  public.guardian_compromisso_lembretes
from anon, authenticated, service_role;

grant select, insert, update, delete on table
  public.guardian_compromissos,
  public.guardian_compromisso_parcelas,
  public.guardian_compromisso_lembretes
to authenticated, service_role;

-- guardian_compromissos
drop policy if exists "guardian compromissos read" on public.guardian_compromissos;
create policy "guardian compromissos read"
  on public.guardian_compromissos
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

drop policy if exists "guardian compromissos manage" on public.guardian_compromissos;
create policy "guardian compromissos manage"
  on public.guardian_compromissos
  for all
  to authenticated
  using (
    exists (
      select 1 from public.hub_users u
      where u.id = auth.uid()
        and u.status = 'active'
        and u.role in ('admin', 'leader', 'operator')
    )
  )
  with check (
    exists (
      select 1 from public.hub_users u
      where u.id = auth.uid()
        and u.status = 'active'
        and u.role in ('admin', 'leader', 'operator')
    )
  );

-- guardian_compromisso_parcelas
drop policy if exists "guardian compromisso parcelas read" on public.guardian_compromisso_parcelas;
create policy "guardian compromisso parcelas read"
  on public.guardian_compromisso_parcelas
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

drop policy if exists "guardian compromisso parcelas manage" on public.guardian_compromisso_parcelas;
create policy "guardian compromisso parcelas manage"
  on public.guardian_compromisso_parcelas
  for all
  to authenticated
  using (
    exists (
      select 1 from public.hub_users u
      where u.id = auth.uid()
        and u.status = 'active'
        and u.role in ('admin', 'leader', 'operator')
    )
  )
  with check (
    exists (
      select 1 from public.hub_users u
      where u.id = auth.uid()
        and u.status = 'active'
        and u.role in ('admin', 'leader', 'operator')
    )
  );

-- guardian_compromisso_lembretes
drop policy if exists "guardian compromisso lembretes read" on public.guardian_compromisso_lembretes;
create policy "guardian compromisso lembretes read"
  on public.guardian_compromisso_lembretes
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

drop policy if exists "guardian compromisso lembretes manage" on public.guardian_compromisso_lembretes;
create policy "guardian compromisso lembretes manage"
  on public.guardian_compromisso_lembretes
  for all
  to authenticated
  using (
    exists (
      select 1 from public.hub_users u
      where u.id = auth.uid()
        and u.status = 'active'
        and u.role in ('admin', 'leader', 'operator')
    )
  )
  with check (
    exists (
      select 1 from public.hub_users u
      where u.id = auth.uid()
        and u.status = 'active'
        and u.role in ('admin', 'leader', 'operator')
    )
  );

alter table public.guardian_compromissos replica identity full;
alter table public.guardian_compromisso_parcelas replica identity full;
alter table public.guardian_compromisso_lembretes replica identity full;

commit;
