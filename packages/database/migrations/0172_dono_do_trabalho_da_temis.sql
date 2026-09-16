-- 0172 · O TRABALHO DA TÊMIS GANHA DONO: QUEM CONFECCIONA O CONTRATO
--
-- ⚠️ ESCRITA E NÃO APLICADA. Espera OK explícito do Lucas.
--
-- ⚠️ ORDEM DE DEPLOY: ESTA MIGRATION VAI PARA O BANCO ANTES DO CÓDIGO QUE GRAVA A COLUNA, mas o
-- código foi escrito para sobreviver às duas ordens:
--   • LEITURA (`trabalhosDoBoard`, apps/hub/lib/temis/trabalhos-db.ts): sem a coluna, o filtro
--     padrão da Careli (`operado_por is null`) cai numa consulta sem ele, e o board da Careli sai
--     igual ao de hoje (sem a coluna, nenhum trabalho tem outro dono). O pedido do portal (um
--     incorporador específico) responde lista vazia: sem a coluna, nada é dele.
--   • ESCRITA (`abrirTrabalho`): sem a coluna, o insert do hub segue igual. O insert com
--     `operado_por` preenchido RECUSA e loga (revisão da onda 3, 16/09/2026): a abertura livre do
--     portal (`POST /api/incorporador/temis/trabalhos`) responde 503, em vez de gravar um card de
--     gente de fora calado na fila da Careli. Só quem pede `semDonoSeFaltarColuna` (pensado para a
--     rota da venda, que não derruba a transição quando a Têmis falha) grava de novo sem a coluna,
--     e aí o card nasce na fila da Careli: o contrato não some, só ainda não mudou de mão.
--   Com a migration aplicada antes, nada disso acontece. Por isso a ordem pedida continua sendo:
--   ESTA MIGRATION PRIMEIRO, o código que grava `operado_por` depois.
--
-- Decisões do Lucas (16/09/2026), sobre o portal da Cecílio Rocha virar a réplica do Hércules
-- operada pelo próprio time dela:
--   • *"a Cecilio quem vai fazer é o proprio time deles (...) eles meio que vão andar sozinhos"*;
--   • a Gurgel (portal comercial) continua vendendo os produtos da Cecílio, e o contrato das vendas
--     DELA vai para a Têmis da CARELI;
--   • a venda feita pela equipe da Cecílio no portal dela vai para a confecção DA CECÍLIO, no
--     portal: ela gera o contrato, manda assinar e edita os modelos.
--
-- ATENCAO 1: QUEM CONFECCIONA DEPENDE DA ORIGEM DA VENDA, NÃO DO PRODUTO. O mesmo lote do VOC pode
-- ser vendido pela Gurgel (contrato na Careli) ou pelo time da Cecílio (contrato na Cecílio). Por
-- isso a coluna mora no TRABALHO, e não em `apolo_incorporador_empreendimentos`: uma marca por
-- empreendimento mandaria para a Cecílio o contrato que a Gurgel vendeu. Quem decide o valor na
-- abertura é `portalConfeccionaContrato(slug, tipo)` (apps/hub/lib/apolo/incorporador/
-- perfis-de-portal.ts), e o comercial NUNCA confecciona.
--
-- ATENCAO 2: NULO SIGNIFICA "A CARELI CONFECCIONA", e é o valor de TODA linha viva. Não há
-- backfill: todo trabalho aberto até hoje foi confeccionado pela Careli, e é exatamente isso que o
-- nulo diz. O board da Careli passa a listar só os nulos; o portal lista só os seus.
--
-- ATENCAO 3: A CHAVE ESTRANGEIRA NÃO TEM `on delete`, de propósito (fica o padrão, NO ACTION). Um
-- contrato confeccionado por um incorporador é registro jurídico: apagar o incorporador não pode
-- apagar o trabalho (`cascade`) nem, pior, devolvê-lo calado para a fila da Careli (`set null`),
-- que passaria a responder por um contrato que não fez. Quem precisar remover o cadastro tem de
-- decidir antes o que fazer com os trabalhos dele.
--
-- ATENCAO 4: O ÍNDICE É PARCIAL (`where operado_por is not null`). A imensa maioria das linhas é da
-- Careli (nula) e a consulta dela é `is null`, que o índice do board (0120) já atende; o índice
-- novo serve à leitura do portal, que só pede as linhas de UM incorporador.
--
-- ATENCAO 5: IDEMPOTENTE. `add column if not exists`, `create index if not exists` e
-- `comment on column` podem rodar duas vezes e terminam no mesmo estado. A FK nasce junto com a
-- coluna; se a coluna já existir sem ela (aplicação manual pela metade), o bloco `do` acrescenta.

alter table public.temis_trabalhos
  add column if not exists operado_por uuid
    references public.apolo_incorporadores (id);

do $$
begin
  if not exists (
    select 1
      from pg_constraint c
      join pg_attribute a
        on a.attrelid = c.conrelid
       and a.attnum = any (c.conkey)
     where c.conrelid = 'public.temis_trabalhos'::regclass
       and c.contype = 'f'
       and a.attname = 'operado_por'
  ) then
    alter table public.temis_trabalhos
      add constraint temis_trabalhos_operado_por_fkey
      foreign key (operado_por) references public.apolo_incorporadores (id);
  end if;
end
$$;

create index if not exists temis_trabalhos_operado_por_idx
  on public.temis_trabalhos (workspace_id, operado_por, estagio_desde)
  where operado_por is not null;

comment on column public.temis_trabalhos.operado_por is
  'Quem confecciona o contrato. NULO = a Careli (Têmis do hub). Preenchido = o incorporador que opera a própria venda (portal /incorporador/<slug>, hoje só cecilio-rocha). Decide a ORIGEM DA VENDA, não o produto: a venda do portal comercial (Gurgel) fica nula e vai para a Careli; a venda do time do incorporador grava o id dele. Migration 0172, decisão do Lucas em 16/09/2026.';
