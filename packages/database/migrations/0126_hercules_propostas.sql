-- O FLUXO DE VENDA DENTRO DO PANTEON — a proposta e a linha do tempo dela.
--
-- Lucas (03/09/2026): *"quero importar todos os dados do c2x, eles tem que existir dentro do
-- panteon, então pode trazer a proposta (fluxo de venda), pode importar tudo e quero que hoje isso
-- seja visto dentro do panteon"*. É o passo que faltava: até aqui a tela de Venda LIA o legado a
-- cada carga (`lib/apolo/vendas.ts`, `enterprise_unities` + `acquisition_requests`); agora o dado
-- mora aqui.
--
-- ⚠️ NO C2X, "PROPOSTA" É O REGISTRO DE TODO O FLUXO. `acquisition_requests` nasce como reserva
-- (estágio 1) e caminha até faturado (4/6), cancelado (7/8) ou distratado (10/11) — é a mesma linha
-- mudando de estágio, e não um registro por fase. Foi o que o OpenAPI mandado ao fornecedor já
-- dizia: reserva e proposta são o MESMO registro, nas etapas 1 e 9. Por isso a tabela se chama
-- proposta e guarda o estágio, em vez de existirem três tabelas para o mesmo papel.
--
-- ⚠️ POR QUE NÃO REAPROVEITAR `hercules_vendas`. Ela é a venda que NASCE no Panteon e exige plano,
-- comprador cadastrado e valor negociado (NOT NULL, 0112). Das 4.852 propostas do legado, 1.961 não
-- têm plano e NENHUMA tem `annual_value` — o valor vive na unidade. Encaixar o histórico ali
-- obrigaria a inventar dado para satisfazer NOT NULL, e dado inventado não avisa que é inventado.
--
-- ⚠️ A IMPORTAÇÃO É UMA CARGA, NÃO UMA SINCRONIZAÇÃO — a mesma regra das unidades (0123). O
-- `origem_c2x_id` existe para poder rodar de novo sem duplicar enquanto a carga é conferida, não
-- para manter duas bases em dia. Depois dela, quem manda no fluxo é o Panteon.
--
-- ⚠️ O QUE O LEGADO NÃO TEM, MEDIDO ANTES DE IMPORTAR: `corretor_id` está nulo nas 4.852 linhas e
-- `acquisition_requests_corretores` está vazia — corretor não existe no fluxo do C2X. A imobiliária
-- sai do vínculo do CLIENTE (`users.vinculed_by_id`), como a tela de Vendas já fazia, porque a
-- tabela de vínculo cobre só 15 propostas. E `rejection_reason` está preenchido em 2 de 2.263
-- canceladas: o motivo do cancelamento não existe no legado, e é isso que a tela precisa dizer —
-- daqui para a frente ele passa a ser obrigatório, mas o passado entra vazio e assumido como tal.

create table if not exists public.hercules_propostas (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         text not null default 'careli',
  -- A chave da carga: `acquisition_requests.id`. Único, para reimportar sem duplicar.
  origem_c2x_id        bigint unique,
  codigo               text,

  -- Onde. `unidade_id` é a linha de `hercules_unidades` (casada por `origem_c2x_id`); os campos de
  -- texto ficam DESNORMALIZADOS de propósito, para a tela listar 4.852 propostas sem dois joins.
  empreendimento_id    uuid references public.hercules_empreendimentos (id) on delete set null,
  empreendimento_codigo text,
  unidade_id           uuid references public.hercules_unidades (id) on delete set null,
  unidade_nome         text,

  -- Em que ponto do fluxo. `etapa` é a dobra do Panteon (a mesma de lib/apolo/vendas.ts, que o
  -- Lucas fechou: Análise→Proposta, Finalizado→Faturado, Reprovado→Cancelado); `etapa_c2x` guarda o
  -- número cru, porque perder a origem impede conferir a dobra depois.
  etapa                text not null,
  etapa_c2x            smallint,
  etapa_desde          timestamptz,
  aberta               boolean,

  -- Quem compra. O titular fica em coluna (é por ele que se busca) e o conjunto em jsonb: o C2X
  -- guarda até cinco compradores com percentual, e 92 propostas usam o segundo.
  cliente_c2x_id       bigint,
  cliente_nome         text,
  cliente_documento    text,
  compradores          jsonb not null default '[]'::jsonb,

  -- Quem vendeu. Corretor entra nulo (não existe no legado) e fica para o fluxo novo preencher.
  imobiliaria_c2x_id   bigint,
  imobiliaria_nome     text,
  corretor_nome        text,

  -- Quanto. O valor é o preço da UNIDADE no momento da carga: `annual_value` está nulo em todas.
  valor                numeric(15, 2),
  plano_c2x_id         bigint,
  plano_nome           text,

  data_ato             date,
  data_assinatura      date,
  data_faturamento     date,
  primeiro_sinal       date,
  parcelas_sinal       integer,
  dia_vencimento       integer,

  motivo               text,
  observacao           text,

  criado_em_c2x        timestamptz,
  atualizado_em_c2x    timestamptz,
  importado_em         timestamptz not null default now(),
  criado_em            timestamptz not null default now(),
  atualizado_em        timestamptz not null default now(),

  constraint hercules_propostas_etapa check (
    etapa in ('reservado', 'proposta', 'contrato', 'assinatura', 'faturado', 'cancelado', 'distrato')
  )
);

create index if not exists hercules_propostas_por_empreendimento
  on public.hercules_propostas (workspace_id, empreendimento_codigo, etapa);

create index if not exists hercules_propostas_por_unidade
  on public.hercules_propostas (unidade_id);

create index if not exists hercules_propostas_por_etapa_desde
  on public.hercules_propostas (etapa, etapa_desde desc);

-- ── A LINHA DO TEMPO ────────────────────────────────────────────────────────
--
-- 12.268 movimentações desde dezembro de 2023, uma linha por mudança de estágio. É o que responde
-- "quanto tempo a proposta ficou parada em cada etapa" e "quem moveu" — as duas perguntas que o
-- painel de gestão precisa fazer e que a foto do estágio atual não responde.
create table if not exists public.hercules_proposta_etapas (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   text not null default 'careli',
  proposta_id    uuid not null references public.hercules_propostas (id) on delete cascade,
  origem_c2x_id  bigint unique,
  de_c2x         smallint,
  para_c2x       smallint,
  de             text,
  para           text,
  quando         timestamptz not null,
  autor_c2x_id   bigint,
  autor_nome     text,
  motivo         text,
  observacao     text,
  criado_em      timestamptz not null default now()
);

create index if not exists hercules_proposta_etapas_por_proposta
  on public.hercules_proposta_etapas (proposta_id, quando);

create index if not exists hercules_proposta_etapas_por_quando
  on public.hercules_proposta_etapas (quando desc);

comment on table public.hercules_propostas is
  'Fluxo de venda importado do C2X (acquisition_requests): reserva → proposta → contrato → assinatura → faturamento, e os terminais cancelado/distrato.';
comment on table public.hercules_proposta_etapas is
  'Cada mudança de estágio de uma proposta (acquisition_request_historics): quando, de onde para onde, e por quem.';
