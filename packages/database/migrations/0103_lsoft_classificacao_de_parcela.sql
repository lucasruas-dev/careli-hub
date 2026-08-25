-- 0103 · Classificação de parcela do LSoft: o que é dívida do cliente e o que é a CAIXA.
--
-- O problema (reunião do Lucas, 25/08/2026): o Vale do Sol é Minha Casa Minha Vida. O
-- financiamento da Caixa está cadastrado no LSoft como se fosse UMA PARCELA DO CLIENTE — no
-- apto 205 bl 04, por exemplo, uma linha de R$ 170.455,00 "a vencer". Mas o cliente não deve
-- isso: quem paga é a Caixa, POR MEDIÇÃO de obra, e o dinheiro cai no extrato CIWEB da
-- construtora. Medido: das R$ 21.098.019,95 que a tela chama de carteira do Vale do Sol,
-- R$ 15,1 mi são Caixa. O vencido de R$ 8,89 mi vira R$ 99.698,88 — a inadimplência real do
-- empreendimento é ~2,5%, não os ~50% que o portal mostra hoje.
--
-- ⚠️ POR QUE UMA TABELA À PARTE, e não uma coluna em `lsoft_parcelas`: o importador
-- (scripts/lsoft/importar-para-supabase.mjs) APAGA todas as 19.988 parcelas antes de inserir, e
-- nenhuma linha tem `lsoft_id` (nulo em 100%). Coluna nova morreria inteira numa recarga, e FK
-- com ON DELETE CASCADE zeraria esta tabela em silêncio. Por isso: referência SEM cascade + uma
-- IMPRESSÃO DIGITAL que permite religar a marca à parcela depois de qualquer recarga.
--
-- ⚠️ A impressão digital PRECISA dos campos longos. Medido nas 19.988 linhas:
--   cliente|empreendimento|parcela|vencimento|valor          → 570 COLISÕES (inútil)
--   + observacoes + origem                                   → 1 colisão
--   + ordinal (esta tabela)                                  → 0
-- A única colisão restante são duas parcelas genuinamente idênticas (cliente 00000294, dois
-- recebimentos de R$ 5.000,00 no mesmo dia); o `ordinal` desempata sem inventar diferença.
--
-- ⚠️ ESCOPO: isto nasce para o VALE DO SOL, dentro dos portais `cecilio-rocha` e `cer`
-- (lib/lsoft/portais.ts). O GARDEN não tem uma única parcela com esse padrão — medido: zero
-- ocorrências de FINAN/SUBSID/FGTS nas 13.212 parcelas dele — então nada muda lá. O filtro por
-- empreendimento é explícito de propósito: hoje é inócuo, amanhã protege.

create table if not exists public.lsoft_classificacao_de_parcela (
  id uuid primary key default gen_random_uuid(),

  -- Referência FRACA de propósito: SEM foreign key. A parcela pode desaparecer numa recarga do
  -- LSoft e a classificação tem que sobreviver para ser religada pela impressão digital.
  parcela_id uuid,

  -- md5(cliente_codigo|empreendimento|parcela|vencimento|valor|observacoes|origem) + ordinal.
  -- É o que religa a marca à parcela quando `parcela_id` morre. Ver o script de reconciliação.
  impressao_digital text not null,
  -- Desempata parcelas byte a byte idênticas (1, 2, 3...). Quase sempre 1.
  ordinal integer not null default 1,

  -- Redundância PROPOSITAL: se a parcela sumir, estes campos ainda contam de quem ela era.
  empreendimento text not null,
  cliente_codigo text not null,

  -- 'caixa'    = quem paga é a Caixa (financiamento, subsídio, FGTS, terreno). Sai da carteira.
  -- 'carteira' = dívida do cliente de verdade.
  classe text not null,

  -- Dentro de 'caixa', o que é: financiamento | subsidio | fgts | terreno | misto.
  -- O LSoft junta financiamento e subsídio na mesma linha em 6 unidades — daí 'misto'.
  natureza text,

  -- 'a_validar'  = a máquina propôs, ninguém confirmou. NÃO sai da carteira ainda.
  -- 'confirmada' = alguém apertou "é subsídio da Caixa". Só aqui o valor muda de lado.
  -- 'rejeitada'  = alguém apertou "não é". Volta para a carteira e não é proposta de novo.
  situacao text not null default 'a_validar',

  -- Como a máquina chegou nisso: 'regra_texto' (achou FINAN/SUBSID/FGTS no histórico),
  -- 'regra_valor' (parcela única de valor alto — decisão do Lucas, 25/08) ou 'manual'.
  origem_da_classe text not null,

  validado_por text,
  validado_por_nome text,
  validado_em timestamptz,
  -- Careli x cliente (portal cer), no mesmo espírito de `autor_origem` da 0098.
  validado_origem text,

  -- FOTO do que a parcela era quando foi classificada. Serve de auditoria e denuncia recarga
  -- que mudou o valor por baixo da marca.
  valor_no_momento numeric,
  observacao_no_momento text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint lsoft_classificacao_classe_valida
    check (classe in ('caixa', 'carteira')),
  constraint lsoft_classificacao_situacao_valida
    check (situacao in ('a_validar', 'confirmada', 'rejeitada')),
  constraint lsoft_classificacao_natureza_valida
    check (natureza is null or natureza in ('financiamento', 'subsidio', 'fgts', 'terreno', 'misto')),
  constraint lsoft_classificacao_origem_valida
    check (origem_da_classe in ('regra_texto', 'regra_valor', 'manual'))
);

-- Uma marca por parcela. É a trava que impede a rotina de classificação de duplicar ao rodar
-- duas vezes (ela roda de novo a cada carga nova).
create unique index if not exists lsoft_classificacao_por_digital
  on public.lsoft_classificacao_de_parcela (impressao_digital, ordinal);

-- A leitura da tela: "as parcelas deste cliente, classificadas".
create index if not exists lsoft_classificacao_por_parcela
  on public.lsoft_classificacao_de_parcela (parcela_id);

-- O contador do topo da tela: "faltam N para validar neste empreendimento".
create index if not exists lsoft_classificacao_por_empreendimento
  on public.lsoft_classificacao_de_parcela (empreendimento, situacao);

create index if not exists lsoft_classificacao_por_cliente
  on public.lsoft_classificacao_de_parcela (cliente_codigo);

comment on table public.lsoft_classificacao_de_parcela is
  'Separa dívida do cliente x financiamento/subsídio da Caixa (MCMV) nas parcelas do LSoft. A máquina propõe (regra_texto/regra_valor), uma pessoa confirma pela tela; só situacao=confirmada tira o valor da carteira. Sobrevive a recarga do LSoft pela impressao_digital.';

-- Mesma postura das irmãs `lsoft_*`: RLS ligado e ZERO políticas, então só a service role (o
-- admin client do servidor) enxerga. A chave anon não lê nem escreve. Sem isso a tabela nasceria
-- aberta à chave pública — ver [[reference_supabase_rls_tabelas_publicas]].
alter table public.lsoft_classificacao_de_parcela enable row level security;
