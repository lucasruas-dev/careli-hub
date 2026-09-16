-- 0167 · A RESERVA FEITA PELO PRÓPRIO INCORPORADOR GANHA ORIGEM
--
-- ⚠️ ESCRITA E NÃO APLICADA. Espera OK explícito do Lucas.
--
-- ⚠️ ORDEM DE DEPLOY: ESTA MIGRATION VAI PARA O BANCO ANTES DO CÓDIGO. A rota
-- `/api/incorporador/venda/reserva` passa a gravar `origem = 'incorporador'` quando quem reserva é o
-- portal de incorporador que opera a própria venda (`origemDaReserva`, em
-- apps/hub/lib/apolo/incorporador/board-do-portal.ts). Com o código no ar e a CHECK antiga, TODA
-- reserva do Cecílio morre com 23514 (check_violation) e a tela responde "Não foi possível reservar
-- agora" — o lote continua livre, mas o time dele não consegue reservar nada. O caminho contrário é
-- inofensivo: a CHECK ampliada aceita tudo o que a antiga aceitava, e o comercial segue gravando
-- 'coordenador' como sempre.
--
-- Lucas (16/09/2026), sobre o portal da Cecílio Rocha: *"quero replicar esse portal do coordenador
-- (falo de estrutura layout) para o portal da Cecilio. a unica coisa que não teremos é o
-- lançamento"* · *"Diferente da gurgel, que quem faz isso tudo é o time administrativo da Careli, a
-- Cecilio quem vai fazer é o proprio time deles (...) eles meio que vão andar sozinhos"*.
--
-- ATENCAO 1: POR QUE UMA ORIGEM NOVA, E NÃO 'coordenador'. A 0125 criou a coluna para responder
-- "de onde veio esta reserva": o coordenador (portal comercial, time da Careli), o salão (Prometeu),
-- o corretor, o interno. A reserva do Cecílio não é nenhuma delas: é o time do PRÓPRIO loteador
-- operando sem a Careli no meio. Gravá-la como 'coordenador' faria qualquer leitura por origem
-- contar como trabalho do comercial da Careli uma venda que a Careli não fez, e depois não haveria
-- como separar as duas: o registro não guarda outro sinal de qual portal reservou.
--
-- ATENCAO 2: O NOME DA CONSTRAINT É O DA 0125 (`hercules_reservas_origem`, declarada inline no
-- `create table`, linha 50). Nenhuma migration posterior mexeu nela (conferido por busca em
-- packages/database/migrations em 16/09/2026). `drop constraint if exists` + `add constraint`
-- deixa o arquivo idempotente: rodar duas vezes termina no mesmo estado.
--
-- ATENCAO 3: A CHECK NOVA VALIDA AS LINHAS QUE JÁ EXISTEM (sem `not valid`), e de propósito. Toda
-- linha viva foi gravada sob a CHECK antiga, que é subconjunto desta, então a validação não tem
-- como falhar; e uma CHECK validada é a que o planejador pode usar e o próximo leitor pode confiar.
--
-- ATENCAO 4: NENHUMA OUTRA CHECK PRECISOU MUDAR. Varri o que as rotas de venda do portal gravam:
--   • `temis_trabalhos.canal` (0120, 'hercules','iris','coordenador'): contrato e cancelamento de
--     contrato gravam 'hercules', que é o canal da VENDA, e não de quem opera; vale igual para o
--     Cecílio;
--   • `hercules_propostas.origem` (0131, 'c2x','panteon'): diz de qual SISTEMA a proposta veio,
--     não de qual portal; a do Cecílio nasce no Panteon como a do comercial;
--   • `apolo_disparos` e o metadata da auditoria do board ('reserva:whatsapp', 'portal-comercial')
--     são texto livre, sem CHECK. O 'portal-comercial' da auditoria de etapa segue gravado também
--     para o Cecílio; separar é mudança de código (tipo `AutorDoBoard.origem` em
--     apps/hub/lib/apolo/board-do-servidor.ts), não de banco.
--
-- ATENCAO 5: A 0125 DESCREVE A COLUNA SÓ NO COMENTÁRIO DO ARQUIVO ("o coordenador, o salão ou o
-- corretor"), sem `comment on column`. O comentário entra aqui, no schema, para o próximo leitor
-- do banco não concluir que 'incorporador' é lixo.

alter table public.hercules_reservas
  drop constraint if exists hercules_reservas_origem;

alter table public.hercules_reservas
  add constraint hercules_reservas_origem
  check (origem in ('coordenador', 'salao', 'corretor', 'interno', 'incorporador'));

comment on column public.hercules_reservas.origem is
  'De onde veio a reserva: coordenador (portal comercial, time da Careli) · salao (Prometeu) · corretor · interno · incorporador (portal do loteador que opera a propria venda, migration 0167).';
