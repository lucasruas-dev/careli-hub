-- 0106 · A etapa do workflow que o OPERADOR escolheu — e que precisa sobreviver ao sync.
--
-- O defeito (auditoria de 25/08/2026): o card "Workflow operacional" tem seletor de etapa, motivo
-- obrigatório, botão "Salvar alteração" e a promessa escrita na tela — *"Fica registrado no
-- histórico e nos últimos eventos"*. Nada era gravado: `applyStageChange` chamava
-- `onChangeStage?.()`, e NENHUM dos dois lugares que renderizam o card passa essa prop. O clique
-- caía no vazio, e a escolha nem sobrevivia à sessão. Medido: **435 dos 437 clientes** da cobrança
-- presos em "A acionar".
--
-- ⚠️ POR QUE UMA TABELA, E NÃO UMA COLUNA NO READ-MODEL: `c2x_guardian_attendance_queue` é
-- reescrita inteira pelo sync a cada 15 minutos, e `workflow_status` é DERIVADO do C2X
-- (read-model-sync.ts grava `client.workflow.stage`). Escrever a escolha humana lá seria apagá-la
-- no próximo sync — o mesmo erro que a classificação do LSoft evita com tabela à parte (0103).
--
-- A REGRA DE PRECEDÊNCIA: a etapa manual GANHA da automática enquanto durar. O motor continua
-- calculando o estágio sugerido; quem decidiu à mão sabe de algo que o C2X não sabe (falou com o
-- cliente, negociou, identificou erro de cadastro).
--
-- ⚠️ NÃO É HISTÓRICO ETERNO: uma linha por cliente, atualizada. O histórico de quem mudou o quê
-- vive nos eventos do compromisso; aqui é só o estado atual.

create table if not exists public.guardian_etapa_manual (
  id uuid primary key default gen_random_uuid(),

  -- `users.id` do C2X (o mesmo `client_c2x_id` da fila).
  cliente_c2x_id bigint not null,

  -- A etapa escolhida à mão. Texto livre de propósito: os rótulos do workflow mudam com o processo
  -- de cobrança e uma CHECK aqui viraria migration a cada ajuste de nomenclatura.
  etapa text not null,
  -- Obrigatório na tela: é o que explica por que a máquina foi contrariada.
  motivo text not null,

  operador_id text,
  operador_nome text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Uma etapa manual viva por cliente: a decisão nova substitui a anterior.
create unique index if not exists guardian_etapa_manual_por_cliente
  on public.guardian_etapa_manual (cliente_c2x_id);

comment on table public.guardian_etapa_manual is
  'Etapa do workflow de cobranca escolhida a mao pelo operador. Fica FORA de c2x_guardian_attendance_queue porque aquela tabela e reescrita pelo sync a cada 15min e workflow_status e derivado do C2X. A etapa manual tem precedencia sobre a automatica.';

alter table public.guardian_etapa_manual enable row level security;
