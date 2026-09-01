-- TEMIS — PLANOS COMERCIAIS DO EMPREENDIMENTO
--
-- Pedido do Lucas (01/09/2026): *"vamos fazer tudo no panteon, vou cadastrar os planos dentro do
-- panteon"* e *"esquece c2x"*. É a primeira peça do módulo Temis a nascer no banco, e nasce SEM
-- espelhar o legado: nada de importar, nada de sincronizar de volta.
--
-- POR QUE O PLANO VEM ANTES DO CONTRATO. A regra que o Lucas desenhou é:
--
--     empreendimento → categoria → plano → minuta
--
-- e a decisão final é do PLANO: *"o que define qual minuta usar é o plano de pagamento. na prática
-- é a unidade x foi vendida no plano a, ae o contrato que vai ser gerado é do plano"*. Sem o plano
-- cadastrado aqui, o Temis não tem como escolher minuta nenhuma.
--
-- ⚠️ OS CAMPOS SÃO OS DE `lib/apolo/planos-comerciais.ts`, e isso é deliberado. Aquele módulo já
-- calcula parcela, sinal e natureza da parcela, com 27 testes medidos contra nove empreendimentos
-- reais. Inventar um formato novo aqui obrigaria a traduzir de um para o outro em toda leitura — e
-- é na tradução que o número muda sem ninguém ver.
--
-- ⚠️ `entrada_percentual` É DE 0 A 100, NUNCA FRAÇÃO. É como o comercial fala ("entrada de 20%") e
-- como o cálculo espera. Gravar 0,20 aqui faria a entrada virar 0,2% e o financiamento inteiro sair
-- errado — por isso o CHECK.
--
-- ⚠️ `juros_taxa` NULO significa PLANO SEM JUROS, e não "esqueceram de preencher". Na prática é o
-- caso do investidor e do curto em quase todos os empreendimentos. Zero e nulo dizem a mesma coisa
-- aqui, e o nulo é o que o tipo do TypeScript já espera.

-- ─────────────────────────────────────────────────────────────────────────────
-- CATEGORIA — o agrupamento livre dentro do empreendimento
-- ─────────────────────────────────────────────────────────────────────────────
-- O Lucas: *"empreendimento já vai vir do apolo, ae eu posso criar as subcategorias"*. Ela existe
-- para separar o que, no legado, estava escondido no NOME do arquivo: JDG tem seis planos, três
-- internos e três externos, e a diferença só aparecia em "JDG-EXTERNA-...". Aqui isso vira estrutura.
--
-- É OPCIONAL: empreendimento simples (o ACP tem três planos e uma minuta só) não precisa de
-- categoria nenhuma, e o plano aponta direto para o empreendimento.
create table if not exists public.temis_categorias (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  text        not null default 'careli',
  -- O empreendimento vem do Apolo. É TEXT porque o Apolo já convive com dois formatos vivos: o id
  -- numérico da divisão ("40") e o agrupamento ("group:Lagoa Bonita"). Ver apolo_enterprise_settings.
  enterprise_id text        not null,
  nome          text        not null,
  ordem         integer     not null default 0,
  ativa         boolean     not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  criado_por    uuid,

  constraint temis_categorias_nome_por_empreendimento unique (workspace_id, enterprise_id, nome)
);

create index if not exists temis_categorias_por_empreendimento
  on public.temis_categorias (workspace_id, enterprise_id, ordem);

-- ─────────────────────────────────────────────────────────────────────────────
-- PLANO COMERCIAL
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.temis_planos (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  text        not null default 'careli',
  enterprise_id text        not null,
  -- Nulo = o plano pende direto do empreendimento, sem categoria.
  categoria_id  uuid        references public.temis_categorias (id) on delete set null,

  nome          text        not null,
  parcelas      integer     not null,

  -- 0 a 100. Ver o aviso do topo.
  entrada_percentual numeric(6, 3) not null default 0,

  -- Nulo = sem juros.
  juros_taxa           numeric(10, 6),
  juros_periodicidade  text not null default 'anual',
  juros_convencao      text not null default 'equivalente',

  indice_correcao      text not null default 'SEM_CORRECAO',
  sistema_amortizacao  text not null default 'sacoc',

  -- Onde o plano entra na folha da PA. Nulo = existe no cadastro mas não vai ao papel.
  slot          text,

  ativo         boolean     not null default true,
  ordem         integer     not null default 0,
  observacao    text,

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  criado_por    uuid,

  constraint temis_planos_nome_por_empreendimento unique (workspace_id, enterprise_id, nome),
  constraint temis_planos_parcelas_positivas check (parcelas > 0),
  -- O CHECK que impede o erro de fração comentado no topo.
  constraint temis_planos_entrada_percentual check (entrada_percentual >= 0 and entrada_percentual <= 100),
  constraint temis_planos_juros_nao_negativo check (juros_taxa is null or juros_taxa >= 0),
  constraint temis_planos_periodicidade check (juros_periodicidade in ('anual', 'mensal')),
  constraint temis_planos_convencao check (juros_convencao in ('equivalente', 'proporcional')),
  constraint temis_planos_indice check (
    indice_correcao in ('IGPM_ANUAL', 'INCC_M_MENSAL', 'IPCA_ANUAL', 'IPCA_MENSAL', 'SEM_CORRECAO')
  ),
  constraint temis_planos_sistema check (sistema_amortizacao in ('price', 'sac', 'sacoc')),
  constraint temis_planos_slot check (slot is null or slot in ('avista', 'curto', 'investidor', 'normal'))
);

create index if not exists temis_planos_por_empreendimento
  on public.temis_planos (workspace_id, enterprise_id, ordem);

create index if not exists temis_planos_por_categoria
  on public.temis_planos (categoria_id)
  where categoria_id is not null;

-- ⚠️ UM SLOT POR EMPREENDIMENTO, e só entre os planos ATIVOS. O slot diz onde o plano aparece na
-- folha da PA; dois planos disputando "normal" fariam a folha imprimir um deles por sorteio, que é
-- o tipo de erro que só aparece no salão de lançamento com o cliente na frente. Índice PARCIAL para
-- que plano desativado não ocupe o slot.
create unique index if not exists temis_planos_slot_unico_por_empreendimento
  on public.temis_planos (workspace_id, enterprise_id, slot)
  where slot is not null and ativo;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────
-- Mesmo padrão das demais tabelas do Apolo: RLS LIGADA e sem policy de select, então só a service
-- role (o servidor) lê e escreve. As telas passam pelas rotas, que já autorizam por papel.
alter table public.temis_categorias enable row level security;
alter table public.temis_planos     enable row level security;

comment on table public.temis_categorias is
  'Temis: agrupamento livre de planos dentro de um empreendimento (ex.: interna x externa, condomínio x loteamento).';
comment on table public.temis_planos is
  'Temis: plano de pagamento do empreendimento. É ele que decide qual minuta o contrato usa.';
comment on column public.temis_planos.entrada_percentual is
  'Percentual de 0 a 100 (nunca fração). 20 significa 20%.';
comment on column public.temis_planos.juros_taxa is
  'Nulo significa plano SEM juros, não campo por preencher.';
comment on column public.temis_planos.slot is
  'Onde o plano entra na folha da PA. Único por empreendimento entre os planos ativos.';
