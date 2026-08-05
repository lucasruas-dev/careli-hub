-- ⚠️ NÃO APLICADA. Aguarda OK explícito do Lucas (operação sensível de banco).
--
-- UMA CAD POR PESSOA **POR EMPREENDIMENTO** — PARTE 2 de 2 (par 0080 + 0081).
--
-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- ORDEM DE APLICAÇÃO (obrigatória):
--
--     0080  →  DEPLOY do código  →  VALIDAR em produção (verde)  →  0081   ◄── você está aqui
--
-- ESTA MIGRATION SÓ PODE RODAR DEPOIS de:
--   1. a 0080 estar aplicada (criou o índice único `apolo_esteira_entity_enterprise_uidx`);
--   2. o código novo — que faz `onConflict: "entity_id,enterprise_id"` — estar NO AR em produção;
--   3. a entrada de CAD estar validada verde com esse código.
--
-- POR QUÊ ESSA ESPERA. A 0080 deixou a PK antiga `(entity_id)` CONVIVENDO com o índice único novo
-- `(entity_id, enterprise_id)`, de propósito: com as duas constraints presentes o Postgres infere
-- as DUAS formas de `ON CONFLICT`, então código velho (`onConflict: "entity_id"`) e código novo
-- (`onConflict: "entity_id,enterprise_id"`) rodam ao mesmo tempo durante o deploy — janela zero.
--
-- Esta 0081 é o passo que finalmente REMOVE a PK antiga `(entity_id)`. Só é seguro fazer isso
-- depois que NINGUÉM mais depende dela — ou seja, depois que o código velho saiu de produção. Se
-- rodar antes do deploy, o código em produção (ainda em `onConflict: "entity_id"`) perde a
-- constraint única de `entity_id` e a entrada de CAD quebra com 42P10.
-- ═════════════════════════════════════════════════════════════════════════════════════════════
--
-- SEM JANELA E SEM RECONSTRUÇÃO. Diferente de `drop pkey` + `add primary key (…)` (que RECONSTRÓI
-- o índice da chave segurando ACCESS EXCLUSIVE enquanto varre a tabela), aqui a nova PK é PROMOVIDA
-- a partir do índice único que a 0080 já construiu com `concurrently`. `add primary key using index`
-- só troca o catálogo — não reconstrói nada — e por isso o ACCESS EXCLUSIVE é de um instante.
--
-- O `using index` RENOMEIA o índice `apolo_esteira_entity_enterprise_uidx` para o nome da
-- constraint (`apolo_esteira_pkey`). Como o `drop constraint` acima já removeu a PK antiga (e o
-- índice homônimo dela), não há colisão de nome.
--
-- Esta migration é DDL comum (sem `concurrently`) — pode e DEVE rodar dentro de transação, para o
-- drop + promote serem atômicos: não existe instante em que a tabela fique sem chave primária.
--
-- ⚠️ 0079 (`apolo_merge_fichas_executar`): continua valendo o aviso da 0080 — com a chave composta
-- o `update apolo_esteira set entity_id = <ficha mantida>` da 0079 pode colidir. Trate o conflito
-- na 0079 antes de aplicá-la.

begin;

-- Pré-condição explícita: o índice-ponte da 0080 precisa existir e estar VÁLIDO. Se a 0080 não
-- rodou (ou o `concurrently` ficou inválido), aborta com mensagem clara em vez de erro obscuro no
-- `using index`.
do $$
begin
  if not exists (
    select 1
      from pg_index i
      join pg_class c on c.oid = i.indexrelid
     where c.relname = 'apolo_esteira_entity_enterprise_uidx'
       and i.indisvalid
  ) then
    raise exception
      'apolo_esteira_entity_enterprise_uidx ausente ou inválido. Aplique a 0080 (e valide o índice) antes desta migration.';
  end if;
end;
$$;

-- Troca da chave primária. `drop` + `add ... using index` na MESMA transação: não há instante sem
-- chave. Nada no banco depende de `apolo_esteira_pkey` (nenhuma FK aponta para cá — conferido na
-- 0080), então o drop não arrasta dependência nenhuma.
alter table public.apolo_esteira
  drop constraint apolo_esteira_pkey;

alter table public.apolo_esteira
  add constraint apolo_esteira_pkey primary key using index apolo_esteira_entity_enterprise_uidx;

comment on table public.apolo_esteira is
  'Uma CAD por pessoa POR EMPREENDIMENTO. Chave: (entity_id, enterprise_id). Estado operacional da CAD no Board — fica fora de apolo_entities.metadata porque o sync do C2X substitui o metadata inteiro (incidente 20/jul).';

commit;
