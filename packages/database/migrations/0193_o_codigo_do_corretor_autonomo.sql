-- 0193 · O CÓDIGO DO CORRETOR AUTÔNOMO — sequência no banco, coluna própria, único de verdade
--
-- ⛔ NÃO APLICADA. Escrita em 27/09/2026 e PARADA de propósito: aplicar migration exige OK explícito
-- do Lucas, a cada vez (regra-mãe do CLAUDE.md).
--
-- ⚠️ O QUE ACONTECE ENQUANTO ELA NÃO RODA, DITO INTEIRO — as duas metades, porque um cabeçalho que
-- garante segurança onde não há desliga a desconfiança de quem faz o deploy:
--   • NA ESCRITA: o cadastro de corretor autônomo RECUSA com frase clara (503) em vez de inventar
--     número (lib/apolo/codigo-do-corretor.ts, MENSAGEM_SEM_SEQUENCIA_DO_CODIGO), e nada é gravado
--     pela metade. Só isso: o cadastro de CLIENTE e o de IMOBILIÁRIA seguem normais.
--   • NA LEITURA: nada quebra, MAS isso não é de graça. A ficha e a lista do CRM pedem `broker_code`,
--     e o PostgREST recusa a consulta INTEIRA com 400 quando a coluna não existe (não ignora coluna
--     desconhecida). Por isso a leitura TENTA com a coluna e, no erro 42703, REPETE sem ela
--     (lib/apolo/server.ts, `lerFichas`), e a ficha simplesmente chega sem código — que é o certo
--     enquanto esta migration não roda. Sem essa tolerância, subir o app antes desta migration
--     derrubava o CRM do Apolo inteiro (lista, busca e ficha) e esvaziava o seletor de imobiliária do
--     wizard, travando a etapa 1 do cadastro de CLIENTE para quem nunca vai cadastrar corretor.
--     Provado em lib/apolo/server.coluna-do-codigo.test.ts, com cliente falso que responde 42703.
--
-- ⚠️ ORDEM DE ENTREGA: livre, de propósito. O app funciona antes e depois, e no dia em que ela rodar
-- o código aparece na ficha sem precisar de redeploy (a primeira instância nova já lê a coluna).
--
-- POR QUE ELA EXISTE. Decisão do Lucas (27/09/2026): *"Preciso cadastrar corretor autonomo, tipo, ele
-- nao sera vinculado a uma imobiliaria, ele sera uma entidade. Quem fara esse cadastro e time nosso
-- interno"*, e sobre como reconhecê-lo: *"a minha ideia e gerar um codigo para esses corretores, assim
-- saberemos que ele e autonomo, NAO QUERO TER A INFORMACAO QUE PODE TER PESSOA FISICA COMO IMOBILIARIA,
-- isso sera bem restrito"*. Onde o código aparece, ele mesmo corrigiu na hora: *"minto, somente no
-- CRM"* — não entra na reserva, na proposta, no contrato nem no BI.
--
-- ⚠️ O PAPEL JÁ CABIA NO BANCO; SÓ O CÓDIGO NÃO. Medido em 27/09/2026 em produção
-- (bxgukywoxgivlrhjkwjx):
--   • `apolo_entity_profiles_profile_check` já aceita 'corretor' (11 valores: usuario, incorporador,
--     imobiliaria, corretor, fornecedor, parceiro, colaborador, acesso_incorporador, pessoa_fisica,
--     pessoa_juridica, prospect) — nenhuma migration de papel é necessária;
--   • `apolo_entities` tem 9 colunas NOT NULL (id, workspace_id, entity_kind, display_name, status,
--     quality_score, metadata, created_at, updated_at) e NENHUMA delas é de imobiliária: a entidade
--     sem vínculo já nasce;
--   • 131 entidades têm o papel 'corretor', todas com `entity_kind = 'pf'`, e nenhuma nasceu pelo
--     wizard interno (102 com `metadata->>'source' = 'apolo'`, vindas do sync/backfill);
--   • `broker_code` NÃO existe (o SELECT devolveu 42703, column does not exist).
--
-- ⚠️ COLUNA, E NÃO `metadata`. É o mesmo motivo escrito na 0183 (CRECI): o sync do C2X substitui o
-- jsonb INTEIRO (lib/apolo/server.ts), e já apagou estado operacional assim antes — foi o que obrigou
-- a criar `apolo_esteira` na 0057. Um código que desaparece no próximo sync não identifica ninguém. E
-- só em coluna o banco garante o que o Lucas pediu de verdade: que o número seja ÚNICO.
--
-- ⚠️ SEQUÊNCIA, E NÃO `count(*) + 1`. É a lição da 0129 (COD da venda) e da 0025 (protocolo da Iris):
-- dois cadastros simultâneos contam a mesma base e tiram o mesmo número. `nextval` é atômico. O buraco
-- na numeração quando um cadastro é recusado é o preço, e é barato — o código serve para ACHAR o
-- autônomo, não para contar quantos são.
--
-- ⚠️ SEM BACKFILL NOS 131 QUE JÁ EXISTEM. Lucas, sobre os corretores que hoje estão sem imobiliária:
-- *"são resíduo do c2x, pode ignorar"*. Eles continuam com `broker_code` nulo, e nulo é "não é um
-- autônomo cadastrado pela casa", não "faltou preencher".
--
-- ⚠️ NULO NÃO OCUPA VAGA NO ÍNDICE. O único é PARCIAL (`where broker_code is not null`): as 5.5 mil
-- entidades sem código não brigam entre si por um "único nulo".

create sequence if not exists public.apolo_codigo_do_corretor_seq;

comment on sequence public.apolo_codigo_do_corretor_seq is
  'Numero do codigo do corretor AUTONOMO (CA-0001, CA-0002...). Consumida so por next_apolo_codigo_do_corretor().';

grant usage, select on sequence public.apolo_codigo_do_corretor_seq to service_role;

-- ⚠️ O FORMATO ('CA-' + 4 digitos) MORA SO AQUI, e o app recebe a string pronta. Houve um espelho em
-- TypeScript (formatarCodigoDoCorretor) sem nenhum chamador de producao: dois donos do mesmo formato
-- e o par que discorda de si mesmo, e o teste do espelho dava impressao de cobertura de ponta a ponta
-- que nao existia (trocar o prefixo la deixava os testes verdes e o banco gerando 'CA-0001'). O
-- espelho saiu em 27/09/2026. Quem for mudar o formato muda ESTA funcao.
-- Passando de 9.999 o numero cresce, e nada e truncado.
create or replace function public.next_apolo_codigo_do_corretor()
returns text
language plpgsql
set search_path = ''
as $$
declare
  proximo bigint;
begin
  proximo := nextval('public.apolo_codigo_do_corretor_seq');

  return 'CA-' || lpad(proximo::text, 4, '0');
end;
$$;

comment on function public.next_apolo_codigo_do_corretor() is
  'Gera o proximo codigo sequencial do corretor autonomo (CA-0001). Atomica: dois cadastros simultaneos nunca recebem o mesmo numero.';

revoke all on function public.next_apolo_codigo_do_corretor() from public;
grant execute on function public.next_apolo_codigo_do_corretor() to service_role;

alter table public.apolo_entities
  add column if not exists broker_code text;

comment on column public.apolo_entities.broker_code is
  'Codigo do corretor AUTONOMO (CA-0001), gerado por next_apolo_codigo_do_corretor() no cadastro interno do Apolo. Aparece SOMENTE na ficha do CRM (Lucas, 27/09/2026). Nulo = nao e autonomo cadastrado pela casa (inclusive os 131 corretores vindos do C2X, residuo do legado que o Lucas mandou ignorar).';

-- ⚠️ É O ÚNICO QUE TORNA A PROMESSA VERDADEIRA. Sem ele, qualquer caminho que escreva a coluna (script,
-- SQL à mão, um retry do cadastro) pode repetir número, e a sequência viraria só uma convenção.
create unique index if not exists apolo_entities_broker_code_uidx
  on public.apolo_entities (broker_code)
  where broker_code is not null;
