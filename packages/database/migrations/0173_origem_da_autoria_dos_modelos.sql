-- 0173 · QUEM PUBLICOU, QUEM ARQUIVOU, QUEM DESATIVOU: O NOME DOS ATOS NOS MODELOS DA TÊMIS
--
-- ⚠️ ESCRITA E NÃO APLICADA. Espera OK explícito do Lucas.
--
-- ⚠️ NÚMERO: outras frentes escrevem migration em paralelo nesta mesma onda. Se já houver outra
-- 0173 quando esta for aplicada, renumere ESTE arquivo (o conteúdo não depende de ordem entre elas).
--
-- ⚠️ ORDEM DE DEPLOY: TANTO FAZ, e isso é de propósito. Esta migration é ENRIQUECIMENTO, não trava
-- (apps/hub/lib/temis/autoria-dos-modelos.ts, `gravarComAutoria`):
--   • sem as colunas, a gravação é refeita SEM elas e loga. O hub grava exatamente como hoje; o
--     portal também grava, e o ato dele (publicar, arquivar, desativar) fica no log com o
--     incorporador e o usuário;
--   • com as colunas, o nome de quem publicou, arquivou ou desativou passa a ficar na linha.
--
-- Decisões do Lucas (16/09/2026), sobre o portal da Cecílio Rocha virar a réplica do Hércules
-- operada pelo próprio time dela:
--   • a equipe da Cecílio gera o contrato, manda assinar e *"também cria e edita os modelos"*
--     (minutas) dos produtos dela;
--   • a Gurgel continua vendendo os produtos da Cecílio, e o contrato das vendas DELA vai para a
--     Têmis da Careli.
--
-- ATENCAO 1: A MINUTA É DO PRODUTO, NÃO DA VENDA. A versão que o time da Cecílio publica vale também
-- para os contratos das vendas da Gurgel naquele produto, que a Careli confecciona. PUBLICAR é o ato
-- que muda o texto de todo contrato novo; até hoje ninguém o registrava (`publicada_por`, uuid da
-- 0113, nunca foi preenchido), nem no hub.
--
-- ATENCAO 2: A ORIGEM VAI DENTRO DO NOME, e não numa coluna própria. É a decisão da frente do
-- contrato para `enviado_por_nome` e afins (`autorDoAto`, apps/hub/lib/temis/contrato-servico.ts):
-- o portal grava "Maria Souza (portal do incorporador)", o hub grava o nome como sempre. É o único
-- lugar que todas as telas já mostram, e mantém a Têmis inteira com UM jeito de dizer a origem.
--
-- ATENCAO 3: NULO = ATO ANTERIOR A ESTA MIGRATION (ou gravado enquanto ela estava pendente). Não há
-- backfill: ninguém sabe hoje quem publicou as versões vigentes, e escrever um nome ali afirmaria o
-- que não foi medido.
--
-- ATENCAO 4: ANEXO E ASSINANTE SÓ NASCEM E SÃO DESATIVADOS (nunca editados, nunca apagados).
-- `criado_por_nome` já existia (0156/0157); falta o nome de quem desativa.
--
-- ATENCAO 5: IDEMPOTENTE. `add column if not exists` e `comment on column` podem rodar duas vezes e
-- terminam no mesmo estado. Só acrescenta coluna nula: nenhuma linha existente muda.

alter table public.temis_minutas add column if not exists publicada_por_nome text;
alter table public.temis_minutas add column if not exists arquivada_por_nome text;

comment on column public.temis_minutas.publicada_por_nome is
  'Quem publicou esta versão, com a origem no nome quando foi o portal ("Nome (portal do incorporador)"). Publicar muda o texto de todo contrato novo do produto, inclusive das vendas da Gurgel. Nulo = anterior à 0173. Migration 0173.';
comment on column public.temis_minutas.arquivada_por_nome is
  'Quem arquivou: pelo botão de arquivar, ou ao publicar a versão seguinte de mesmo nome. Origem no nome quando foi o portal. Migration 0173.';

alter table public.temis_anexos add column if not exists desativado_por_nome text;

comment on column public.temis_anexos.desativado_por_nome is
  'Quem desativou o anexo (ele nunca é apagado), com a origem no nome quando foi o portal. Migration 0173.';

alter table public.temis_assinantes add column if not exists desativado_por_nome text;

comment on column public.temis_assinantes.desativado_por_nome is
  'Quem tirou a pessoa do quadro (a linha nunca é apagada), com a origem no nome quando foi o portal. Migration 0173.';
