-- TÊMIS · as cinco etapas do quadro, e o indeferimento
--
-- ⚠️ NÃO APLICADA. Aguarda OK explícito do Lucas.
--
-- O redesenho aprovado em 09/09/2026 (docs/mockups/temis-quadro-e-tela-de-trabalho.html) tem CINCO
-- etapas, e o banco recusa três dos nomes: o check de `estagio` aceita apenas
-- `entrada`, `confeccao`, `assinatura` e `finalizado`. Esta migration abre o vocabulário e traduz
-- as linhas existentes.
--
-- Medido em 10/09/2026, antes de escrever: são 8 trabalhos vivos (2 em `entrada`, 3 em
-- `confeccao`, 3 em `assinatura`, NENHUM em `finalizado`). A tradução é pequena e reversível.
--
--     entrada     →  analise       "Chegou do Hércules. Conferir e abrir o contrato."
--     confeccao   →  contrato      "Gerado. Conferir quem assina antes de mandar."
--     assinatura  →  assinatura    (não muda)
--     finalizado  →  faturado      "Prazo cumprido e entrada paga."
--
-- E entram dois valores novos:
--
--     prazo_legal   os 7 dias de arrependimento e a entrada (etapa 4 do mockup)
--     indeferido    a Têmis recusou o trabalho e devolveu, com motivo
--
-- ⚠️ `estagio_desde` NÃO É TOCADO, e isso é deliberado. Ele é a base de TODOS os prazos da tela
-- (`situacaoDoPrazo`, `prazoDeEmissao`) e a regra da casa é que ele não anda para trás
-- (`lib/assinatura/estado-db.ts`). Renomear a etapa não é avançar de etapa: um card que está em
-- Confecção há seis dias continua há seis dias em Contrato. Carimbar `now()` aqui zeraria o
-- atraso de todos os cards de uma vez, e o quadro amanheceria verde mentindo.
--
-- ⚠️ CUIDADO COM A PALAVRA "CONTRATO", QUE AGORA É DUAS COISAS. `temis_trabalhos.tipo` já tem o
-- valor `contrato` (o QUE se produz), e a etapa 2 passa a se chamar `contrato` (ONDE o trabalho
-- está). Um `where tipo = 'contrato'` e um `where estagio = 'contrato'` respondem perguntas
-- diferentes, e a semelhança vai enganar alguém. Foi o vocabulário aprovado no mockup e no
-- funil do Hércules (`lib/hercules/fluxo-de-venda.ts`), então fica — mas fica anotado.

begin;

-- ── 1. O check aceita o vocabulário novo ────────────────────────────────────
--
-- Precisa cair ANTES da tradução: com o check antigo de pé, o update falha na primeira linha.
alter table public.temis_trabalhos
  drop constraint if exists temis_trabalhos_estagio_valido;

-- ── 2. A tradução ───────────────────────────────────────────────────────────
update public.temis_trabalhos set estagio = 'analise'  where estagio = 'entrada';
update public.temis_trabalhos set estagio = 'contrato' where estagio = 'confeccao';
update public.temis_trabalhos set estagio = 'faturado' where estagio = 'finalizado';

-- ── 3. O check novo ─────────────────────────────────────────────────────────
alter table public.temis_trabalhos
  add constraint temis_trabalhos_estagio_valido
  check (estagio in ('analise','contrato','assinatura','prazo_legal','faturado','indeferido'));

alter table public.temis_trabalhos
  alter column estagio set default 'analise';

-- ── 4. O indeferimento ──────────────────────────────────────────────────────
--
-- Lucas (10/09/2026): *"Temos que ter uma sessão de Indeferimento, o deferimento tem que chegar no
-- corretor - imobiliaria - coordenador. Ae temos que ter os motivos e tal"*.
--
-- ⚠️ NÃO É REPROVA DE CRÉDITO. Lucas, no mesmo dia: *"credito? não tem credito na temis"*. Crédito
-- mora no Apolo (esteira de CAD + Serasa). Aqui a Têmis recusa o TRABALHO — documento faltando,
-- dado divergente, proponente sem cadastro — e devolve a quem vendeu.
alter table public.temis_trabalhos
  add column if not exists indeferido_em         timestamptz,
  -- O código do catálogo (`lib/temis/indeferimento.ts`). Texto, e não enum: motivo é vocabulário
  -- de negócio e muda mais rápido que schema.
  add column if not exists indeferido_motivo     text,
  -- O que o catálogo não cobre. Lucas pediu lista pronta MAIS observação.
  add column if not exists indeferido_observacao text,
  add column if not exists indeferido_por        text,
  add column if not exists indeferido_por_nome   text;

-- ⚠️ INDEFERIDO EXIGE MOTIVO, e isso é regra de negócio no banco de propósito. O motivo viaja
-- para o corretor e para a imobiliária: um indeferimento sem motivo é um card que volta dizendo
-- "não" e nada mais, e a pessoa do outro lado não tem o que corrigir.
alter table public.temis_trabalhos
  drop constraint if exists temis_trabalhos_indeferido_com_motivo;
alter table public.temis_trabalhos
  add constraint temis_trabalhos_indeferido_com_motivo
  check (
    estagio <> 'indeferido'
    or (indeferido_em is not null and coalesce(btrim(indeferido_motivo), '') <> '')
  );

comment on column public.temis_trabalhos.indeferido_motivo is
  'Codigo do catalogo de motivos (lib/temis/indeferimento.ts). Obrigatorio quando estagio = indeferido.';
comment on column public.temis_trabalhos.indeferido_observacao is
  'O caso concreto, escrito por quem indeferiu. Viaja junto com o motivo para corretor e imobiliaria.';

-- ── 5. O prazo legal ────────────────────────────────────────────────────────
--
-- ⚠️ OS 7 DIAS CONTAM DA ÚLTIMA ASSINATURA DO COMPRADOR. Lucas (10/09/2026), escolhendo entre as
-- três opções: só começa quando TODOS os compradores assinaram, e a vendedora não entra na conta
-- (ela não se arrepende). Por isso a data é GRAVADA quando o envelope fecha, e não calculada
-- depois a partir da ordem de assinatura — a ordem pode ter a vendedora no meio.
alter table public.temis_trabalhos
  add column if not exists arrependimento_inicio timestamptz;

comment on column public.temis_trabalhos.arrependimento_inicio is
  'Quando o ULTIMO comprador assinou. A vendedora nao conta. Base dos 7 dias corridos de arrependimento.';

-- ── 6. O índice do quadro segue o mesmo ─────────────────────────────────────
--
-- `(workspace_id, estagio, estagio_desde)` continua servindo: a coluna não mudou de nome nem de
-- tipo, só o conjunto de valores que ela aceita.

commit;
