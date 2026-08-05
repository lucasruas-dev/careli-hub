-- ⚠️ NÃO APLICADA. Aguarda OK explícito do Lucas (operação sensível de banco).
--
-- UMA CAD POR PESSOA **POR EMPREENDIMENTO** — PARTE 1 de 2 (par 0080 + 0081).
--
-- POR QUÊ: a 0057 criou `apolo_esteira` com `entity_id` como CHAVE PRIMÁRIA — ou seja, UMA CAD
-- por pessoa, para sempre. Isso está errado para o negócio: a CAD (cadastro + análise de crédito
-- + documentos) é POR EMPREENDIMENTO, e quem comprou no Vale do Ouro precisa poder abrir CAD em
-- outro loteamento. Hoje o corretor é barrado no portal e a central resolve na mão.
--
-- A chave passa a ser `(entity_id, enterprise_id)`.
--
-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- ORDEM DE APLICAÇÃO (obrigatória — é o que torna a troca SEM JANELA DE QUEDA):
--
--     0080  →  DEPLOY do código  →  VALIDAR em produção (verde)  →  0081
--
-- POR QUÊ ESSA ORDEM. Trocar a PK de `(entity_id)` para `(entity_id, enterprise_id)` num passo só
-- criava dois estados incompatíveis sem ponte entre eles:
--   • se a migration rodasse ANTES do deploy, o código em produção (que faz
--     `onConflict: "entity_id"`) quebrava com 42P10 (nenhuma constraint única casa) e a entrada
--     de CAD — o fluxo mais crítico do time — parava;
--   • se o deploy rodasse ANTES da migration, o código novo (`onConflict: "entity_id,enterprise_id"`)
--     dava o MESMO 42P10 do outro lado.
-- Como o deploy e o `apply_migration` são passos separados, existia uma janela em que a CAD ficava
-- derrubada de um jeito ou de outro.
--
-- A PONTE é o índice único de `(entity_id, enterprise_id)` criado aqui na 0080 CONVIVENDO com a PK
-- antiga de `(entity_id)`. Com as DUAS constraints únicas presentes ao mesmo tempo, o Postgres
-- consegue inferir AS DUAS formas de `ON CONFLICT` — então o código VELHO (`entity_id`) e o NOVO
-- (`entity_id,enterprise_id`) funcionam SIMULTANEAMENTE durante todo o deploy. A 0081 só remove a
-- PK antiga DEPOIS que ninguém mais usa `onConflict: "entity_id"` (código novo já no ar e validado).
-- ═════════════════════════════════════════════════════════════════════════════════════════════
--
-- ⚠️ ESTA MIGRATION NÃO PODE SER ENVOLVIDA EM TRANSAÇÃO. O `create unique index concurrently` do
-- PASSO 3 falha com "CREATE INDEX CONCURRENTLY cannot run inside a transaction block" se rodar
-- dentro de `begin/commit` — e o protocolo simples do Postgres embrulha um LOTE de comandos numa
-- transação implícita. Por isso: (a) este arquivo NÃO tem `begin/commit`; (b) o comando do PASSO 3
-- deve ser aplicado como statement ISOLADO, não coladinho num único envio com o resto. Cada
-- statement aqui faz auto-commit por conta própria; os passos são idempotentes (drop if exists /
-- if not exists) e podem ser reexecutados se algum parar no meio.
--
-- ESTADO DO DADO CONFERIDO ANTES DE ESCREVER ESTA MIGRATION (04/08, projeto bxgukywoxgivlrhjkwjx):
--   • 637 linhas em `apolo_esteira`;
--   • 0 linhas com `enterprise_id` nulo ou vazio (o backfill de 04/08 fechou o buraco);
--   • 1 valor distinto de `enterprise_id`: '35' (master VLO — a CAD é feita toda no master; 36 e
--     37, VOL/Lino e VOC/Cecílio, não têm CAD própria);
--   • 0 FKs de terceiros apontando para `apolo_esteira` (`pg_constraint.confrelid` = zero linhas),
--     0 views/matviews, 0 triggers não-internos e 0 funções referenciando a tabela.
-- Ou seja: a migração de DADO é trivial (nenhuma linha conflita na chave nova) e trocar a PK não
-- arrasta dependência nenhuma dentro do banco. O risco todo é do lado da aplicação, e foi tratado
-- no mesmo lote de código desta migration.
--
-- ⚠️ AVISO PARA QUEM FOR RECRIAR A TABELA A PARTIR DO REPOSITÓRIO: **NÃO DÁ**. As colunas
-- `pago_em` e `pagamento_ref` e o índice `apolo_esteira_pago_em_idx` EXISTEM no banco e NÃO têm
-- arquivo de migration aqui (o changelog chama de "Migration apolo_esteira_pagamento_prevenda",
-- mas o .sql nunca entrou no repo). Além disso os cabeçalhos das 0060 e 0061 dizem "NÃO APLICADA"
-- e estão DESATUALIZADOS: as colunas delas existem no banco. Esta migration é ADITIVA sobre o
-- estado REAL e não depende de recriar nada.
--
-- ⚠️ A 0079 (`apolo_merge_fichas_executar`) ainda NÃO foi aplicada e faz
-- `update apolo_esteira set entity_id = <ficha mantida>`. Com a chave composta esse update pode
-- COLIDIR quando a ficha mantida já tiver CAD no mesmo empreendimento. Antes de aplicar a 0079,
-- ela precisa ganhar tratamento de conflito (mesclar ou pular a duplicata). Fica registrado aqui
-- porque as duas mexem na mesma chave.

-- ---------------------------------------------------------------------------------------------
-- PASSO 1 — trava de segurança. A migration RECUSA rodar se existir linha sem empreendimento.
--
-- Sem isto, um `set not null` num banco diferente do conferido falharia no meio do caminho (ou,
-- pior, alguém "resolveria" preenchendo com '' e todas as CADs sem empreendimento voltariam a
-- colapsar numa linha só). Barrar é melhor que perder em silêncio.
-- ---------------------------------------------------------------------------------------------
do $$
declare
  orfas bigint;
begin
  select count(*) into orfas
    from public.apolo_esteira
   where nullif(trim(enterprise_id), '') is null;

  if orfas > 0 then
    raise exception
      'apolo_esteira: % linha(s) sem enterprise_id. Rode o backfill de empreendimento antes desta migration.',
      orfas;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- PASSO 2 — `enterprise_id` obrigatório, SEM lock longo.
--
-- `alter column ... set not null` cru varre a tabela inteira segurando ACCESS EXCLUSIVE (ninguém
-- lê nem escreve enquanto isso). O caminho barato é o padrão CHECK NOT VALID -> VALIDATE ->
-- SET NOT NULL:
--   • `add constraint ... not valid` só pega ACCESS EXCLUSIVE por um instante (não varre nada);
--   • `validate constraint` varre a tabela com SHARE UPDATE EXCLUSIVE, que NÃO bloqueia leitura
--     nem escrita concorrente;
--   • `set not null` então enxerga um CHECK já validado que prova a ausência de nulos e PULA a
--     varredura (Postgres 12+).
-- Com 637 linhas a diferença é de milissegundos, mas o padrão fica escrito para quando a tabela
-- crescer — e é o que torna esta migration segura de rodar com o sistema no ar.
-- ---------------------------------------------------------------------------------------------
-- 2a. CHECK auxiliar, com a forma EXATA `coluna IS NOT NULL`. A forma importa: quem aproveita o
-- check para pular a varredura do `set not null` é um provador de predicados, e ele reconhece o
-- teste de nulidade direto — não uma expressão equivalente escondida atrás de `trim`/`nullif`.
-- Este check é descartável e some no fim do passo.
alter table public.apolo_esteira
  drop constraint if exists apolo_esteira_enterprise_id_nao_nulo;

alter table public.apolo_esteira
  add constraint apolo_esteira_enterprise_id_nao_nulo
  check (enterprise_id is not null) not valid;

alter table public.apolo_esteira
  validate constraint apolo_esteira_enterprise_id_nao_nulo;

alter table public.apolo_esteira
  alter column enterprise_id set not null;

-- Com a coluna NOT NULL, o check auxiliar virou repetição. Sai.
alter table public.apolo_esteira
  drop constraint apolo_esteira_enterprise_id_nao_nulo;

-- 2b. CHECK que FICA. `not null` sozinho aceitaria a STRING VAZIA, e '' de volta significa "CAD sem
-- empreendimento" — exatamente o balde único por pessoa que esta migration existe para acabar (com
-- '' como valor, duas CADs sem empreendimento voltariam a colidir na chave). Com este check, toda
-- escrita nova é obrigada a dizer QUAL empreendimento.
alter table public.apolo_esteira
  drop constraint if exists apolo_esteira_enterprise_id_presente;

alter table public.apolo_esteira
  add constraint apolo_esteira_enterprise_id_presente
  check (nullif(trim(enterprise_id), '') is not null) not valid;

alter table public.apolo_esteira
  validate constraint apolo_esteira_enterprise_id_presente;

comment on constraint apolo_esteira_enterprise_id_presente on public.apolo_esteira is
  'enterprise_id nunca vazio: a CAD é POR EMPREENDIMENTO e a chave primária depende dele.';

-- ---------------------------------------------------------------------------------------------
-- PASSO 3 — a PONTE: índice único de `(entity_id, enterprise_id)` que CONVIVE com a PK antiga.
--
-- 🚨 ESTE COMANDO NÃO RODA DENTRO DE TRANSAÇÃO. `create index concurrently` é o que constrói o
-- índice SEM bloquear escrita na tabela (pega só SHARE UPDATE EXCLUSIVE, não ACCESS EXCLUSIVE),
-- mas em troca EXIGE rodar fora de qualquer `begin/commit`. Aplique-o ISOLADO — não junte no mesmo
-- envio com os passos acima, senão o Postgres embrulha tudo numa transação implícita e ele falha.
--
-- ORDEM DAS COLUNAS: `(entity_id, enterprise_id)`, porque `entity_id` é a coluna LÍDER. As
-- consultas por pessoa ("todas as CADs de fulano", `where entity_id = ?`) continuam em dezenas de
-- pontos e passam a ser servidas por este índice — por isso NÃO há índice extra só de `entity_id`.
--
-- É este índice que a 0081 PROMOVE a chave primária (via `add primary key using index`), sem
-- reconstruir nada. Enquanto ele existe LADO A LADO com a PK antiga `(entity_id)`, o Postgres
-- infere as DUAS formas de `ON CONFLICT` — e é isso que deixa código velho e código novo rodarem
-- ao mesmo tempo durante o deploy (ver o bloco ORDEM DE APLICAÇÃO no topo).
--
-- `if not exists`: idempotente. Se um `concurrently` for interrompido ele deixa um índice INVÁLIDO
-- de mesmo nome; nesse caso, `drop index if exists apolo_esteira_entity_enterprise_uidx;` e rode de
-- novo (o INVALID não serve de ponte nem pode virar PK).
-- ---------------------------------------------------------------------------------------------
create unique index concurrently if not exists apolo_esteira_entity_enterprise_uidx
  on public.apolo_esteira (entity_id, enterprise_id);

-- ---------------------------------------------------------------------------------------------
-- PASSO 4 — índices que continuam valendo.
--
-- Preservados como estavam (nenhum deles depende da PK):
--   apolo_esteira_etapa_idx       (etapa, atualizado_em desc)  — fila do Board
--   apolo_esteira_analista_idx    (analista_id)
--   apolo_esteira_corretor_idx    (corretor_entity_id)
--   apolo_esteira_enterprise_idx  (enterprise_id)              — "esteira do empreendimento"
--   apolo_esteira_pago_em_idx     (pago_em)                    — criado fora do repo
--
-- O `if not exists` deixa este bloco idempotente e serve de documentação do estado esperado: se
-- algum índice tiver sumido de um ambiente, ele volta aqui.
-- ---------------------------------------------------------------------------------------------
create index if not exists apolo_esteira_etapa_idx
  on public.apolo_esteira (etapa, atualizado_em desc);
create index if not exists apolo_esteira_analista_idx
  on public.apolo_esteira (analista_id);
create index if not exists apolo_esteira_corretor_idx
  on public.apolo_esteira (corretor_entity_id);
create index if not exists apolo_esteira_enterprise_idx
  on public.apolo_esteira (enterprise_id);
create index if not exists apolo_esteira_pago_em_idx
  on public.apolo_esteira (pago_em);

-- ---------------------------------------------------------------------------------------------
-- PASSO 5 — a FK de `entity_id` para `apolo_entities` FICA COMO ESTÁ.
--
-- `apolo_esteira_entity_id_fkey` (entity_id -> apolo_entities(id) on delete cascade) é uma FK de
-- SAÍDA: ela depende da PK de `apolo_entities`, não da PK daqui. Trocar a nossa chave não a
-- afeta, e por isso ela NÃO é derrubada nem recriada — mexer nela só criaria risco.
--
-- A recriação abaixo é só a garantia idempotente de que ela existe (com o mesmo nome e a mesma
-- regra), para o caso de um ambiente ter divergido.
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'apolo_esteira_entity_id_fkey'
       and conrelid = 'public.apolo_esteira'::regclass
  ) then
    alter table public.apolo_esteira
      add constraint apolo_esteira_entity_id_fkey
      foreign key (entity_id) references public.apolo_entities (id) on delete cascade;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- PASSO 6 — a CHECK da 0061 continua valendo, sem alteração.
--
-- `apolo_esteira_vinculo_publico_check` exige corretor + imobiliária + empreendimento nas CADs de
-- origem 'publico-cad'. O pedaço de empreendimento dela virou redundante (o PASSO 2 já obriga
-- todo mundo), mas as outras duas exigências continuam sendo dela — então ela fica intacta.
--
-- RLS: inalterada. `apolo_esteira` tem uma policy só (`apolo_esteira_read`, SELECT para
-- authenticated, using(true)) e toda escrita passa por service_role. Chave composta não muda nada
-- disso.
--
-- A TROCA DA CHAVE PRIMÁRIA em si NÃO acontece aqui — está na 0081, que roda só DEPOIS do deploy
-- do código novo estar no ar e validado. Ver o bloco ORDEM DE APLICAÇÃO no topo.
-- ---------------------------------------------------------------------------------------------
