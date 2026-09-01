-- AS PARCELAS DO MÊS, POR UNIDADE — o que a tela mostra sem ninguém escolher arquivo.
--
-- Pedido do Lucas (01/09/2026): *"não quero importar planilha, já traz isso pronto, vc já tem os
-- dados pode montar a tela e ter o botão de gerar boleto e pronto"*.
--
-- Até aqui a planilha era lida no navegador a cada visita: quem abria a tela precisava ter o arquivo
-- na mão, e duas pessoas com versões diferentes do arquivo viam números diferentes. Aqui a carteira
-- do mês passa a existir no banco, e a planilha vira o que ela deveria ser desde o começo: a origem
-- de uma CARGA, não a fonte que a tela consulta.
--
-- ⚠️ O VALOR É `numeric` SEM ESCALA, de propósito. A planilha calcula o reajuste em cascata e traz
-- valores com 13 casas (2207.1729284232347). Guardar como numeric(12,2) arredondaria na gravação, e
-- o arredondamento tem regra própria: o Lucas pediu PARA CIMA, aplicado na hora de mandar ao Asaas
-- (`valorParaOAsaas`). Duas arredondadas em série dão resultado diferente de uma.
--
-- ⚠️ `bloqueio` GUARDA O MOTIVO DE NÃO EMITIR, e não um booleano. "Não fazer", "parcela paralisada",
-- "pago até dez/26" e "sem valor no mês" levam à mesma consequência e a conversas completamente
-- diferentes com o cliente. Nulo = emite.

create table if not exists public.boletos_parcelas (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   text        not null default 'careli',

  -- O `slug` de `lib/apolo/boletos/empreendimentos.ts`.
  empreendimento text        not null,
  -- Casa com `boletos_documentos.unidade`: é por ela que o CPF é encontrado.
  unidade        text        not null,
  -- `2026-09`.
  competencia    text        not null,

  -- O nome como está na PLANILHA. O do cadastro fica em `boletos_documentos`; guardar os dois é o
  -- que permite avisar "a planilha diz outro nome nesta unidade" antes de emitir no CPF errado.
  nome           text        not null,
  valor          numeric,
  -- O dia do mês (5, 10, 15, 20, 24, 25, 30). A data completa é montada na emissão, prendendo o dia
  -- ao último do mês quando ele não existe (dia 30 em fevereiro).
  vencimento_dia smallint,
  -- Nulo = emite. Preenchido = o motivo, como a regra o descreveu.
  bloqueio       text,

  -- De onde veio esta linha, para saber o que uma recarga substitui.
  origem         text        not null default 'planilha',

  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),

  constraint boletos_parcelas_unica
    unique (workspace_id, empreendimento, unidade, competencia),
  constraint boletos_parcelas_competencia
    check (competencia ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  constraint boletos_parcelas_dia
    check (vencimento_dia is null or (vencimento_dia between 1 and 31))
);

create index if not exists boletos_parcelas_por_competencia
  on public.boletos_parcelas (workspace_id, competencia, empreendimento);

alter table public.boletos_parcelas enable row level security;

comment on table public.boletos_parcelas is
  'A carteira mensal por unidade, carregada da planilha. A tela le daqui, nao do arquivo.';
comment on column public.boletos_parcelas.valor is
  'Valor CRU da planilha, sem arredondar. O arredondamento para cima acontece na emissao.';
comment on column public.boletos_parcelas.bloqueio is
  'Nulo = emite. Preenchido = o motivo de nao emitir, como a regra o descreveu.';
