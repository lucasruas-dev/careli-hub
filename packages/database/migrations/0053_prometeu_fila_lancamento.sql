-- Prometeu: a fila do dia do lancamento (fim do mockup — vira modulo de verdade).
--
-- O processo, tirado dos mockups ja validados pelo Lucas:
--   Recepcao -> Negociacao -> Reserva -> Secretaria -> Proposta -> Pagamento -> Concluido
--   (+ Cancelado)
-- No dia, o credenciado chega, entra na fila, e vai sendo CHAMADO para uma MESA de cada zona.
-- O cockpit acompanha quanto tempo cada um esta no evento e no estagio atual.
--
-- Regra que define a ordem (Lucas 18/jul): a posicao na fila sai da DATA/HORA DO PAGAMENTO
-- do PIX de pre-venda — por isso `pago_em` e o carimbo mais importante daqui.
--
-- O empreendimento vive no C2X (nao e entidade do Apolo), entao entra como texto/id, no mesmo
-- padrao de apolo_enterprise_settings. O credenciado aponta pra entidade do Apolo quando ela
-- existe (importacao/cadastro), mas o evento tem que rodar mesmo sem esse vinculo.
--
-- Nao aplicar sem autorizacao expressa do Lucas (regra-mae: migration = operacao sensivel).

-- ---------------------------------------------------------------- evento
create table if not exists public.prometeu_eventos (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'careli',
  -- Empreendimento do C2X (id) + sigla, pra nao depender do legado numa consulta simples.
  enterprise_id text,
  enterprise_code text,
  nome text not null,
  data_evento timestamptz,
  -- rascunho | ativo | encerrado
  status text not null default 'rascunho',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists prometeu_eventos_status_idx
  on public.prometeu_eventos (status, data_evento);

-- ---------------------------------------------------------- credenciado
create table if not exists public.prometeu_credenciados (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references public.prometeu_eventos (id) on delete cascade,
  -- Entidade do Apolo, quando existe. Fica nulo pra credenciado avulso do dia.
  entity_id uuid,
  nome text not null,
  documento text,
  -- Imobiliaria e corretor: guardamos o NOME (o dia do evento nao pode depender de join)
  -- e o vinculo com a entidade quando ele existir.
  imobiliaria text,
  imobiliaria_entity_id uuid,
  corretor text,
  corretor_entity_id uuid,
  -- recepcao | negociacao | reserva | secretaria | proposta | pagamento | concluido | cancelado
  etapa text not null default 'recepcao',
  -- Chegada ao evento e entrada no estagio atual: e o que o cockpit cronometra.
  entrou_em timestamptz not null default now(),
  etapa_desde timestamptz not null default now(),
  -- PIX da pre-venda: ORDENA A FILA. Nulo = ainda nao pagou.
  pago_em timestamptz,
  posicao integer,
  -- De onde veio (asana/apolo/manual) + referencia externa pra nao importar duas vezes.
  origem text not null default 'manual',
  origem_ref text,
  etiqueta_impressa_em timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists prometeu_credenciados_evento_idx
  on public.prometeu_credenciados (evento_id, etapa);
create index if not exists prometeu_credenciados_fila_idx
  on public.prometeu_credenciados (evento_id, pago_em nulls last);
create index if not exists prometeu_credenciados_entity_idx
  on public.prometeu_credenciados (entity_id);
-- Idempotencia da importacao: a mesma origem nao entra duas vezes no mesmo evento.
create unique index if not exists prometeu_credenciados_origem_uk
  on public.prometeu_credenciados (evento_id, origem, origem_ref)
  where origem_ref is not null;

-- ------------------------------------------------------------- unidades
-- Unidades de interesse do credenciado (VOR + quadra + lote). Um credenciado pode querer varias.
create table if not exists public.prometeu_unidades (
  id uuid primary key default gen_random_uuid(),
  credenciado_id uuid not null references public.prometeu_credenciados (id) on delete cascade,
  codigo text not null,
  quadra text,
  lote text,
  -- interesse | reservada | vendida | liberada
  situacao text not null default 'interesse',
  created_at timestamptz not null default now()
);

create index if not exists prometeu_unidades_credenciado_idx
  on public.prometeu_unidades (credenciado_id);

-- ----------------------------------------------------------------- mesas
create table if not exists public.prometeu_mesas (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references public.prometeu_eventos (id) on delete cascade,
  -- Zona = etapa atendida ali (Secretaria, Negociacao...).
  zona text not null,
  numero text not null,
  -- livre | ocupada | atendimento
  estado text not null default 'livre',
  atendente_user_id uuid,
  credenciado_id uuid references public.prometeu_credenciados (id) on delete set null,
  updated_at timestamptz not null default now()
);

create unique index if not exists prometeu_mesas_uk
  on public.prometeu_mesas (evento_id, zona, numero);

-- -------------------------------------------------------------- chamadas
-- Historico de chamadas (alimenta telao e locutor, e prova quem foi chamado quando).
create table if not exists public.prometeu_chamadas (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references public.prometeu_eventos (id) on delete cascade,
  credenciado_id uuid not null references public.prometeu_credenciados (id) on delete cascade,
  mesa_id uuid references public.prometeu_mesas (id) on delete set null,
  zona text,
  chamado_em timestamptz not null default now(),
  chamado_por uuid,
  atendido_em timestamptz
);

create index if not exists prometeu_chamadas_evento_idx
  on public.prometeu_chamadas (evento_id, chamado_em desc);

-- --------------------------------------------------------- movimentacoes
-- Troca de etapa: e daqui que saem os tempos por estagio e a auditoria do dia.
create table if not exists public.prometeu_movimentacoes (
  id uuid primary key default gen_random_uuid(),
  credenciado_id uuid not null references public.prometeu_credenciados (id) on delete cascade,
  de_etapa text,
  para_etapa text not null,
  motivo text,
  em timestamptz not null default now(),
  por uuid
);

create index if not exists prometeu_movimentacoes_credenciado_idx
  on public.prometeu_movimentacoes (credenciado_id, em desc);

-- ------------------------------------------------------------------ RLS
-- Mesmo padrao das apolo_*: leitura pra usuario autenticado do Hub; escrita so via service
-- role (rotas server-side), que bypassa RLS.
alter table public.prometeu_eventos        enable row level security;
alter table public.prometeu_credenciados   enable row level security;
alter table public.prometeu_unidades       enable row level security;
alter table public.prometeu_mesas          enable row level security;
alter table public.prometeu_chamadas       enable row level security;
alter table public.prometeu_movimentacoes  enable row level security;

drop policy if exists prometeu_eventos_read on public.prometeu_eventos;
create policy prometeu_eventos_read
  on public.prometeu_eventos for select to authenticated using (true);

drop policy if exists prometeu_credenciados_read on public.prometeu_credenciados;
create policy prometeu_credenciados_read
  on public.prometeu_credenciados for select to authenticated using (true);

drop policy if exists prometeu_unidades_read on public.prometeu_unidades;
create policy prometeu_unidades_read
  on public.prometeu_unidades for select to authenticated using (true);

drop policy if exists prometeu_mesas_read on public.prometeu_mesas;
create policy prometeu_mesas_read
  on public.prometeu_mesas for select to authenticated using (true);

drop policy if exists prometeu_chamadas_read on public.prometeu_chamadas;
create policy prometeu_chamadas_read
  on public.prometeu_chamadas for select to authenticated using (true);

drop policy if exists prometeu_movimentacoes_read on public.prometeu_movimentacoes;
create policy prometeu_movimentacoes_read
  on public.prometeu_movimentacoes for select to authenticated using (true);
