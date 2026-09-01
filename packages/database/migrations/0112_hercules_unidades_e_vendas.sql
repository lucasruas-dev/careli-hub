-- HÉRCULES — UNIDADES E VENDAS
--
-- Pedido do Lucas (01/09/2026): *"vamos precisar criar uma versão do hercules para gerar a venda
-- das unidades para que possamos gerar os contratos"*, com o alvo do dia sendo Aldeia das
-- Cachoeiras (ACP) e Jardim das Gerais (JDG).
--
-- POR QUE A UNIDADE VEM JUNTO. Medido hoje: `prometeu_unidades` e `c2x_enterprise_units` estão
-- ZERADAS — o Panteon nunca guardou unidade, ele lê do legado a cada tela. Como a decisão é
-- *"esquece c2x"*, a venda precisa de uma unidade que exista AQUI, senão ela aponta para o nada.
--
-- ⚠️ CARGA ÚNICA, NÃO SINCRONIZAÇÃO. As unidades do ACP e do JDG entram uma vez e o Panteon passa a
-- ser dono. Não há job, não há volta, não há espelho: o mesmo desenho da carga do LSoft. Por isso
-- `origem_c2x_id` existe — não para sincronizar, mas para que a carga seja IDEMPOTENTE (rodar duas
-- vezes não duplica) e para rastrear de onde veio cada linha se alguém perguntar depois.
--
-- ⚠️ A TRAVA DE VENDA DUPLA É DO BANCO, NUNCA DA TELA. Índice único parcial sobre a unidade com
-- venda viva. A lição está registrada na casa: no salão de lançamento, dezenas de tablets abrem a
-- mesma tela e duas reservas entram na mesma unidade no mesmo instante. Mapa é consequência da
-- trava, não a fonte dela.

-- ─────────────────────────────────────────────────────────────────────────────
-- UNIDADE
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.hercules_unidades (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  text        not null default 'careli',
  enterprise_id text        not null,

  -- O código como o comercial fala e como sai no masterplan (ex.: JDG0617).
  codigo        text        not null,
  quadra        text,
  lote          text,
  -- Metro quadrado. numeric para não perder centímetro em conta de preço por m².
  area          numeric(12, 2),
  preco_tabela  numeric(14, 2),

  -- ⚠️ OS EXTENSOS SÃO DADO, NÃO ENFEITE. As minutas usam `[area_lote_extenso]` e
  -- `[valor_imovel_venda_extenso]`, e contrato de imóvel escreve valor por extenso ao lado do
  -- número. Gerar o extenso na hora parece simples e erra: "300,00 m²" já vem com a unidade no
  -- texto do legado, e o template acrescenta de novo — foi assim que saiu "trezentos metros
  -- quadrados metros quadrados" num contrato real do Villa Paris. Guardar o que o cadastro diz
  -- evita reinventar a redação a cada geração.
  area_extenso  text,
  preco_extenso text,

  -- Matrícula do lote no registro de imóveis. Vai para a qualificação do imóvel no contrato.
  matricula     text,
  matricula_livro text,

  -- O tipo decide, junto com o plano, qual minuta se aplica (condomínio × loteamento no C2X).
  tipo_unidade  text,

  -- disponivel | reservada | vendida | bloqueada
  -- ⚠️ `bloqueada` é diferente de `reservada`: bloqueio é decisão da empresa (permuta, lote da
  -- diretoria, matrícula com problema) e não tem comprador nem prazo. Os dois pintam o mapa, e
  -- obedecem regras diferentes.
  situacao      text        not null default 'disponivel',
  bloqueio_motivo text,

  -- De onde veio na carga inicial. NÃO é chave de sincronização.
  origem_c2x_id bigint,

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  constraint hercules_unidades_codigo_unico unique (workspace_id, enterprise_id, codigo),
  constraint hercules_unidades_situacao check (situacao in ('disponivel', 'reservada', 'vendida', 'bloqueada')),
  constraint hercules_unidades_area_positiva check (area is null or area > 0)
);

-- A carga roda por este par; sem ele, importar duas vezes duplicaria as 370 unidades.
create unique index if not exists hercules_unidades_origem
  on public.hercules_unidades (workspace_id, origem_c2x_id)
  where origem_c2x_id is not null;

create index if not exists hercules_unidades_por_empreendimento
  on public.hercules_unidades (workspace_id, enterprise_id, situacao);

-- ─────────────────────────────────────────────────────────────────────────────
-- VENDA
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.hercules_vendas (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  text        not null default 'careli',
  enterprise_id text        not null,
  unidade_id    uuid        not null references public.hercules_unidades (id) on delete restrict,

  -- O PLANO É O QUE DECIDE A MINUTA. Regra do Lucas: "a unidade x foi vendida no plano a, ae o
  -- contrato que vai ser gerado é do plano". `restrict` de propósito: apagar um plano que já tem
  -- venda apagaria a explicação de um contrato assinado.
  plano_id      uuid        not null references public.temis_planos (id) on delete restrict,

  -- O comprador é entidade do Apolo. Guardamos o id, e o retrato dos dados vai no contrato quando
  -- ele for gerado — ver a nota de congelamento no Temis.
  comprador_entity_id uuid  not null,
  -- Co-compradores e cônjuge, com o percentual de cada um. Array de objetos; a soma tem que fechar
  -- 100 e isso é validado na aplicação, onde a mensagem de erro pode ser útil.
  participantes jsonb       not null default '[]'::jsonb,

  imobiliaria_entity_id uuid,
  corretor_entity_id    uuid,

  -- O QUE FOI NEGOCIADO, congelado. Não aponta para a tabela de preço viva: se o preço mudar
  -- amanhã, esta venda continua sendo o que foi assinado.
  valor_negociado numeric(14, 2) not null,
  valor_entrada   numeric(14, 2) not null default 0,
  valor_sinal     numeric(14, 2) not null default 0,
  dia_vencimento  integer,
  -- Retrato do plano no momento da venda (parcelas, juros, índice, sistema). Valor, não referência.
  plano_snapshot  jsonb,

  -- rascunho | confirmada | cancelada
  situacao      text        not null default 'rascunho',
  cancelada_em  timestamptz,
  cancelada_motivo text,

  vendida_em    timestamptz not null default now(),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  criado_por    uuid,

  constraint hercules_vendas_situacao check (situacao in ('rascunho', 'confirmada', 'cancelada')),
  constraint hercules_vendas_valor_positivo check (valor_negociado > 0),
  constraint hercules_vendas_dia_vencimento check (dia_vencimento is null or (dia_vencimento between 1 and 31))
);

-- ⚠️ A TRAVA CONTRA VENDER DUAS VEZES. Parcial: cancelada não ocupa a unidade, e rascunho ocupa —
-- porque no salão o rascunho é justamente o momento em que duas pessoas disputam o mesmo lote.
create unique index if not exists hercules_vendas_unidade_viva
  on public.hercules_vendas (unidade_id)
  where situacao in ('rascunho', 'confirmada');

create index if not exists hercules_vendas_por_empreendimento
  on public.hercules_vendas (workspace_id, enterprise_id, situacao, vendida_em desc);

create index if not exists hercules_vendas_por_comprador
  on public.hercules_vendas (comprador_entity_id);

alter table public.hercules_unidades enable row level security;
alter table public.hercules_vendas   enable row level security;

comment on table public.hercules_unidades is
  'Hércules: unidades do empreendimento, do Panteon. Carga inicial vinda do C2X, sem sincronização depois.';
comment on table public.hercules_vendas is
  'Hércules: a venda de uma unidade num plano. É a origem do contrato gerado pelo Temis.';
comment on column public.hercules_vendas.plano_snapshot is
  'Retrato do plano no momento da venda. Congelado: alterar a tabela de preço não reescreve o passado.';
comment on index public.hercules_vendas_unidade_viva is
  'Impede duas vendas vivas na mesma unidade. A trava é do banco porque o salão tem dezenas de tablets.';
