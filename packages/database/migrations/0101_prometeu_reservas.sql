-- 0101 · Reservas de unidade do LANÇAMENTO (tela touch do Prometeu).
--
-- O processo novo (Lucas, 24/08/2026): o cliente bipa a etiqueta na posição de reserva,
-- escolhe os lotes no touch, confirma e sai um CUPOM com QR; o cupom imprime as folhas de PA
-- (uma por unidade) e a secretária lança a proposta em cima. O telão pinta o masterplan por
-- estas linhas em tempo quase real.
--
-- Modelo: UMA LINHA POR UNIDADE reservada; as unidades confirmadas juntas compartilham o
-- `grupo_id` (o cupom — é ele que vira QR). `prometeu_unidades` (0053) fica como está: nunca
-- foi escrita em produção (0 linhas) e não tem trava; esta tabela é a fonte da reserva do
-- evento, com trava real por unidade.
--
-- ⚠️ A situação cadastral do C2X (sale_status_id) NÃO é tocada aqui: o C2X recebe a reserva
-- por sincronização própria, fora do caminho do evento.

create table if not exists public.prometeu_reservas (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references public.prometeu_eventos (id) on delete cascade,
  credenciado_id uuid not null references public.prometeu_credenciados (id) on delete cascade,
  -- O cupom: as unidades confirmadas no mesmo toque compartilham este id (QR do comprovante).
  grupo_id uuid not null,
  -- enterprise_unities.id no C2X, quando conhecido (bigint do MySQL viaja como texto).
  unidade_c2x_id text,
  -- `codigo` = o `name` da unidade no C2X (VLO0212, RVPA23) — LIDO do banco, nunca montado.
  -- Normalizado (trim + maiúsculas) na gravação; a trava única depende disso.
  codigo text not null,
  quadra text not null,
  lote text not null,
  area text,
  preco_tabela numeric,
  -- reservada | cancelada. Marcos do funil ficam em colunas próprias (uma linha conta a
  -- história: reservou → PA impressa → proposta lançada).
  situacao text not null default 'reservada',
  pa_impressa_em timestamptz,
  pa_impressa_vezes integer not null default 0,
  proposta_lancada_em timestamptz,
  proposta_lancada_por text,
  cancelada_em timestamptz,
  cancelada_motivo text,
  criado_por text,
  criado_por_nome text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists prometeu_reservas_evento_idx
  on public.prometeu_reservas (evento_id, created_at desc);

create index if not exists prometeu_reservas_credenciado_idx
  on public.prometeu_reservas (credenciado_id);

create index if not exists prometeu_reservas_grupo_idx
  on public.prometeu_reservas (grupo_id);

-- A TRAVA: uma reserva VIVA por unidade por evento. Parcial de propósito — cancelou, o lote
-- volta e pode ser reservado de novo (o ciclo real do lançamento: devolve a PA, pega outra).
create unique index if not exists prometeu_reservas_unidade_viva
  on public.prometeu_reservas (evento_id, codigo)
  where situacao = 'reservada';

-- Mesmo padrão de RLS das demais prometeu_* (0053): deny por padrão; leitura para o time
-- logado; escrita SÓ pelo service role das rotas (o telão público lê pela rota com token).
alter table public.prometeu_reservas enable row level security;

drop policy if exists prometeu_reservas_select on public.prometeu_reservas;
create policy prometeu_reservas_select
  on public.prometeu_reservas for select
  to authenticated
  using (true);
