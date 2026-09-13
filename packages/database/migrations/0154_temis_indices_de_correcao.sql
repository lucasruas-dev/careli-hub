-- OS ÍNDICES DE CORREÇÃO VIRAM CADASTRO, e param de ser cinco listas escritas à mão.
--
-- POR QUE ESTA TABELA EXISTE. Até hoje a lista de índices que o Panteon aceita vivia copiada em
-- SEIS lugares: o type e o Record de rótulos em `lib/apolo/planos-comerciais.ts`, o Set e um
-- segundo Record em `lib/temis/planos.ts`, um array em `lib/hercules/planos-do-panteon.ts`, o
-- tradutor do legado em `lib/apolo/planos-comerciais-c2x.ts`, uma lista DIVERGENTE no espelho
-- público (`lib/hercules/espelho/planos-publicos.ts`) e o CHECK da 0111 aqui no banco. Seis cópias
-- da mesma verdade, e elas JÁ discordavam entre si quando esta migration foi escrita.
--
-- O QUE ACONTECE SEM ELA, medido em 13/09/2026 e não hipotético:
--
-- ATENCAO 1: O JARDIM DAS GERAIS ESTÁ VENDENDO COM "SEM CORREÇÃO" NA TELA. O C2X tem SEIS índices
-- em `index_monetary_corrections` e o tradutor do Panteon mapeia CINCO — `POUPANÇA`, criada no
-- legado em 29/08/2026, não existe no de-para, e a linha `INDICE_POR_NOME[...] ?? "SEM_CORRECAO"`
-- faz o desconhecido virar "sem correção" em silêncio. O plano NORMAL do JDG (empreendimento 40,
-- `vendendo = true`, 120 parcelas) é corrigido pela poupança e chega na proposta anunciando que não
-- tem correção nenhuma. São 3 planos do legado nessa situação, e 5 propostas já gravadas com
-- `plano_correcao = 'POUPANÇA'`. Um índice que o sistema não conhece não dá erro: ele some.
--
-- ATENCAO 2: O CHECK DA 0111 É QUEM IMPEDE O CONSERTO. Ele admite exatamente cinco valores, então
-- nem cadastrar poupança era possível. Ele sai aqui e a integridade passa a ser a FK para esta
-- tabela — que é o mesmo grau de rigor, só que com uma fonte que dá para editar sem deploy.
--
-- ATENCAO 3: `fonte` NÃO É DECORAÇÃO, É O QUE IMPEDE PROMESSA SEM CONTA POR TRÁS. Índice que o
-- sistema não sabe buscar vira cláusula de contrato sem número: o papel promete corrigir por um
-- índice e ninguém tem de onde tirar o valor na hora da cobrança. Toda linha declara se o número
-- tem origem automática (`bcb_sgs`, `ibge_sidra`) ou se é `manual` — e a tela avisa quem cadastra.
-- Hoje o Panteon NÃO busca índice nenhum, nem o IPCA; a coluna diz o que será possível no dia em
-- que o buscador existir, e é essa a diferença que interessa ao cadastro.
--
-- ATENCAO 4: `exige_parametro` existe por causa do CUB, e ele é o motivo de a tabela não ser uma
-- lista simples. O CUB/m² é publicado pelo SINDUSCON DE CADA ESTADO (Lei 4.591/1964, art. 54), por
-- projeto-padrão da NBR 12721 (R1, R8, R16, PP-4, CAL-8…) e por padrão de acabamento (baixo,
-- normal, alto) — em São Paulo, jun/2023, o R-1 saía a R$ 1.910,34 no baixo e R$ 2.845,49 no alto.
-- "CUB" sozinho não é um número. A bandeira liga a exigência dos parâmetros na tela em vez de
-- deixar alguém cadastrar uma promessa vaga.
--
-- ATENCAO 5: ÍNDICE NÃO SE APAGA, DESATIVA. Contrato assinado cita o índice pelo nome, e apagar a
-- linha deixaria a proposta antiga apontando para o vazio. É a mesma regra que o plano já segue: o
-- DELETE de `/api/temis/planos` marca `ativo = false` com o comentário "um plano com venda feita
-- explica um contrato assinado". Aqui vale igual.
--
-- ATENCAO 6: OS CINCO DE HOJE ENTRAM COM O MESMO CÓDIGO. `IPCA_ANUAL`, `IPCA_MENSAL`, `IGPM_ANUAL`,
-- `INCC_M_MENSAL` e `SEM_CORRECAO` são semeados com o texto idêntico ao que as 12 linhas de
-- `temis_planos` já guardam — nenhuma linha de plano precisa ser reescrita, e a FK fecha de
-- primeira. `SEM_CORRECAO` é linha da tabela de propósito: "não corrige" é uma escolha de contrato,
-- não a ausência de escolha, e sem ela o campo precisaria aceitar nulo.
--
-- Autorização do Lucas, 13/09/2026: *"pode cadastrar todos os índices usados para esse segmento"* e,
-- para aplicar, *"pode fazer a migration"*.

create table if not exists public.temis_indices (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'careli',

  -- A chave que o resto do sistema usa e que já está gravada nas propostas e nos planos.
  codigo text not null,
  -- Como o mercado chama: "IPCA", "INCC-M", "IGP-M". Vai nos rótulos curtos da tela.
  sigla text not null,
  -- Por extenso, como tem que sair no contrato.
  nome text not null,
  publicador text not null,

  -- Como a FONTE publica o número (mensal, diária).
  periodicidade text not null,
  -- Como o CONTRATO aplica a correção (mensal, anual). São coisas diferentes: o IPCA é publicado
  -- todo mês e a maioria dos contratos da casa o aplica uma vez por ano, no aniversário.
  aplicacao text not null,

  fonte text not null,
  -- O código na fonte: '7456' no SGS do Banco Central, '1737/2265' no SIDRA do IBGE. Nulo quando
  -- `fonte = 'manual'`.
  fonte_codigo text,
  exige_parametro boolean not null default false,

  ativo boolean not null default true,
  ordem integer not null default 0,
  observacao text,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  constraint temis_indices_codigo_por_workspace unique (workspace_id, codigo),
  constraint temis_indices_periodicidade check (periodicidade in ('diaria', 'mensal')),
  constraint temis_indices_aplicacao check (aplicacao in ('anual', 'mensal', 'nenhuma')),
  constraint temis_indices_fonte check (fonte in ('bcb_sgs', 'ibge_sidra', 'manual')),
  -- Fonte automática sem o código da série é uma promessa vazia: diz que sabe buscar e não diz onde.
  constraint temis_indices_fonte_codigo check (
    fonte = 'manual' or (fonte_codigo is not null and length(trim(fonte_codigo)) > 0)
  )
);

comment on table public.temis_indices is
  'Índices de correção que os planos comerciais podem usar. Fonte única: substitui as cinco listas escritas à mão no código e o CHECK da 0111.';
comment on column public.temis_indices.fonte is
  'De onde sai o NÚMERO. manual = o sistema não busca; o valor é informado à mão a cada competência, e a tela avisa isso a quem cadastra.';
comment on column public.temis_indices.aplicacao is
  'Como o CONTRATO aplica, não como a fonte publica. O IPCA é mensal na origem e anual na maioria dos contratos desta casa.';
comment on column public.temis_indices.exige_parametro is
  'O índice precisa de recorte para virar número (o CUB precisa de UF, projeto-padrão e acabamento). Liga a exigência na tela.';

create index if not exists temis_indices_ativos
  on public.temis_indices (workspace_id, ordem)
  where ativo;

-- ⚠️ RLS LIGADA E SEM POLICY, que é o padrão desta casa desde a 0075: toda tabela de `public` é
-- servida pelo PostgREST com a chave anon, e a anon vai no bundle do site. Acesso só por service
-- role. O advisor marca isso como `rls_enabled_no_policy` (INFO, seguro), e não como
-- `rls_disabled_in_public` (ERROR, exposto).
alter table public.temis_indices enable row level security;

-- ── A SEMENTE ───────────────────────────────────────────────────────────────
--
-- Os cinco que já existem, com o código idêntico ao que está gravado, mais a poupança do ATENCAO 1
-- e os demais índices do segmento. `on conflict do nothing` para a migration poder rodar duas vezes.
insert into public.temis_indices
  (codigo, sigla, nome, publicador, periodicidade, aplicacao, fonte, fonte_codigo, exige_parametro, ordem, observacao)
values
  ('SEM_CORRECAO', 'sem correção', 'Contrato sem correção monetária', 'nenhum', 'mensal', 'nenhuma', 'manual', null, false, 0,
   'Não é ausência de escolha: é a escolha de não corrigir, e o contrato diz isso.'),

  ('IPCA_ANUAL', 'IPCA', 'Índice Nacional de Preços ao Consumidor Amplo', 'IBGE', 'mensal', 'anual', 'ibge_sidra', '1737/2265', false, 10,
   'Acumulado 12 meses é a variável 2265 do SIDRA, NÃO a 69 — armadilha já registrada na casa.'),
  ('IPCA_MENSAL', 'IPCA', 'Índice Nacional de Preços ao Consumidor Amplo', 'IBGE', 'mensal', 'mensal', 'ibge_sidra', '1737/63', false, 11, null),

  ('INCC_M_MENSAL', 'INCC-M', 'Índice Nacional de Custo da Construção — Mercado', 'FGV/IBRE', 'mensal', 'mensal', 'bcb_sgs', '7456', false, 20,
   'Coleta do dia 21 ao 20, componente do IGP-M. É o INCC padrão de loteamento e o que o C2X usa em 96 planos.'),
  ('INCC_DI_MENSAL', 'INCC-DI', 'Índice Nacional de Custo da Construção — Disponibilidade Interna', 'FGV/IBRE', 'mensal', 'mensal', 'bcb_sgs', '192', false, 21,
   'Mesma cesta do INCC-M, JANELA DE COLETA diferente (mês civil). Em ago/2026: DI 0,66% contra M 0,85% — não são o mesmo número.'),

  ('IGPM_ANUAL', 'IGP-M', 'Índice Geral de Preços — Mercado', 'FGV/IBRE', 'mensal', 'anual', 'bcb_sgs', '189', false, 30, null),
  ('IGPM_MENSAL', 'IGP-M', 'Índice Geral de Preços — Mercado', 'FGV/IBRE', 'mensal', 'mensal', 'bcb_sgs', '189', false, 31, null),
  ('IGPDI_MENSAL', 'IGP-DI', 'Índice Geral de Preços — Disponibilidade Interna', 'FGV/IBRE', 'mensal', 'mensal', 'bcb_sgs', '190', false, 32,
   'Mesma cesta do IGP-M, coleta do mês civil. Escolher errado desloca o reajuste em até um mês de inflação.'),

  ('INPC_MENSAL', 'INPC', 'Índice Nacional de Preços ao Consumidor', 'IBGE', 'mensal', 'mensal', 'ibge_sidra', '1736/63', false, 40,
   'Mesma coleta do IPCA, população-alvo diferente (1 a 5 salários mínimos contra 1 a 40). Não são intercambiáveis.'),

  ('POUPANCA', 'Poupança', 'Rendimento da caderneta de poupança', 'Banco Central', 'mensal', 'mensal', 'bcb_sgs', '195', false, 50,
   'JÁ EM USO NO LEGADO: o C2X a cadastrou em 29/08/2026 e o plano NORMAL do Jardim das Gerais a usa. Sem esta linha o Panteon lia esse plano como sem correção.'),
  ('TR_MENSAL', 'TR', 'Taxa Referencial', 'Banco Central', 'diaria', 'mensal', 'bcb_sgs', '226', false, 51,
   'Raro sozinho em loteamento: costuma aparecer embutida na poupança.'),

  ('CUB', 'CUB/m²', 'Custo Unitário Básico da Construção', 'Sinduscon estadual / CBIC', 'mensal', 'mensal', 'manual', null, true, 60,
   'NÃO TEM NÚMERO SEM RECORTE: depende de UF, projeto-padrão (NBR 12721) e padrão de acabamento. Não há fonte nacional automática — cada Sinduscon publica o seu.')
on conflict (workspace_id, codigo) do nothing;

-- ── O CHECK DA 0111 SAI, E A FK ENTRA ───────────────────────────────────────
--
-- ⚠️ A ORDEM IMPORTA: a semente acima já rodou, então toda linha de `temis_planos` tem um código
-- que existe na tabela nova e a FK fecha sem violação. Invertido, a FK recusaria a própria criação.
alter table public.temis_planos
  drop constraint if exists temis_planos_indice;

alter table public.temis_planos
  drop constraint if exists temis_planos_indice_cadastrado;

alter table public.temis_planos
  add constraint temis_planos_indice_cadastrado
  foreign key (workspace_id, indice_correcao)
  references public.temis_indices (workspace_id, codigo);
