-- 0170 · O PRODUTO NASCE NO PANTEON: QUEM OPERA, QUE TIPO ELE É, E UM ID QUE NÃO VEM DO C2X
--
-- ⚠️ ESCRITA E NÃO APLICADA. Espera OK explícito do Lucas.
--
-- ⚠️ ORDEM DE DEPLOY: ESTA MIGRATION VAI PARA O BANCO ANTES DO CÓDIGO QUE CADASTRA PRODUTO.
--   • LEITURA é tolerante: `carregarCadastroDeEmpreendimentos` (apps/hub/lib/hercules/cadastro.ts)
--     repete o select sem as colunas novas quando o PostgREST responde 42703/PGRST204 citando uma
--     delas, e toda linha sai `operadoPor: null` (Careli opera) e `tipoProduto: 'loteamento'`, que
--     é o que o sistema inteiro já assume hoje. Painel, Venda e portal seguem de pé com ou sem a 0170.
--   • ESCRITA não é: a rota que cria produto grava `operado_por`, `tipo_produto` e `criado_origem`,
--     e depende do DEFAULT da sequence para o produto nascer com id. Sem a 0170 ela responde 503
--     (`ehColunaDoProdutoAusente`, apps/hub/lib/hercules/produto-novo.ts) e NÃO tenta gravar sem as
--     colunas: produto sem `c2x_enterprise_id` some do sistema inteiro (reserva 409, proposta,
--     contrato, espelho, escopo do portal).
--   • O caminho contrário é inofensivo: colunas novas nascem nulas ou com default, e o DEFAULT do id
--     só vale para insert que OMITE a coluna. O único escritor de hoje, o semeador
--     (scripts/hercules/semear-empreendimentos.mjs), sempre manda `c2x_enterprise_id` no corpo.
--
-- Lucas (16/09/2026), sobre o portal da Cecílio Rocha: *"Diferente da gurgel, que quem faz isso tudo
-- é o time administrativo da Careli, a Cecilio quem vai fazer é o proprio time deles (...) eles meio
-- que vão andar sozinhos"* (citação registrada na 0167). A arquitetura foi decidida por ele no mesmo
-- dia: MESMO banco, MESMAS tabelas, MESMO código, e cada PRODUTO marca quem o opera. Nada de banco
-- novo nem tabela separada por incorporador. Os produtos da Cecílio que ainda não existem no sistema
-- (Ed. Jade, Ed. Rubi, Ed. Cristal, Ed. Esmeralda, On Sky, Guaimbê, Giant Towers, Vale do Sol) vão
-- nascer AQUI, e o C2X legado, que está sendo desativado, não tem mais onde recebê-los.
--
-- ATENCAO 1: A CHAVE CONTINUA SENDO `c2x_enterprise_id`, E O NOME AGORA MENTE DE PROPÓSITO. Essa
-- coluna de texto é o `enterprise_id` que o sistema inteiro usa: `hercules_unidades`,
-- `hercules_vendas`, `apolo_incorporador_empreendimentos`, `apolo_enterprise_settings` (PK),
-- `temis_planos`, `temis_minutas`, `apolo_esteira`, o escopo do portal. Criar uma coluna nova
-- `enterprise_id` obrigaria a varrer cada um desses leitores, e o que ficasse para trás leria nulo
-- em silêncio. Renomear quebraria os mesmos leitores de uma vez, no deploy. O comentário da coluna
-- (abaixo) é o que conserta o nome: para os legados é o id do C2X; para os nascidos aqui, o id do
-- Panteon, sempre >= 100000.
--
-- ATENCAO 2: POR QUE 100000. Os ids do C2X estão perto de 45 e param de crescer com a desativação;
-- o ZZ TESTE (TST) ganhou 9001 à mão. Começar em 100000 deixa duas ordens de grandeza de folga, e o
-- número de dígitos já diz a quem lê `enterprise_id = 100003` num log que aquele produto é do
-- Panteon. A regra em código é `ehIdDoPanteon` (apps/hub/lib/hercules/produto-novo.ts).
--
-- ATENCAO 3: SEQUENCE, E NÃO "MAIOR + 1" NA APLICAÇÃO. Dois cadastros ao mesmo tempo (o time da
-- Cecílio e o administrativo da Careli) leriam o mesmo maior e gravariam o mesmo id; o índice único
-- `hercules_empreendimentos_c2x_uk` recusaria um deles com erro, e o outro já teria o id. A sequence
-- nunca entrega o mesmo número duas vezes. Buraco na numeração (insert que falhou queima um número)
-- é normal e não significa nada: o id é chave, não contador de produtos.
--
-- ATENCAO 4: O DEFAULT SÓ VALE QUANDO A COLUNA É OMITIDA. `c2x_enterprise_id: null` explícito
-- continua gravando nulo, e é isso que o semeador manda para pai de grupo sem espelho no C2X (LOX,
-- RDX, PDX): eles existem só como agrupamento e não têm unidade própria. Quem criar um pai de grupo
-- pelo Panteon deve mandar o nulo explícito, pelo mesmo motivo. As linhas que já existem não são
-- tocadas: DEFAULT não reescreve o passado, e não há backfill.
--
-- ATENCAO 5: `operado_por` NULO = A CARELI OPERA. Preenchido = o incorporador daquele id opera o
-- produto com o próprio time. SEM BACKFILL, e é decisão pendente do dono: o Vale do Ouro Cecílio
-- (VOC, 37) e o Garden (GDN, 39) são da Cecílio mas hoje também são vendidos pela Gurgel, e marcar
-- qualquer um deles tiraria a venda das mãos de quem vende hoje.
--
-- ATENCAO 6: `on delete restrict` NO `operado_por`, e não `set null`. Apagar o incorporador com
-- `set null` entregaria o produto à Careli calado: o time do cliente perderia o acesso e o
-- administrativo da Careli passaria a ver uma carteira que não é dele, por causa de uma limpeza de
-- cadastro. `cascade` apagaria o produto com unidades e vendas. `restrict` obriga a decidir antes.
--
-- ATENCAO 7: `tipo_produto` É NOT NULL COM DEFAULT 'loteamento'. O default é o que o sistema inteiro
-- já assume: WhatsApp, PDF e contrato escrevem "Quadra · Lote" (nome-da-unidade.ts, variaveis.ts).
-- NOT NULL sem default quebraria calado todo upsert que não manda a coluna (a armadilha do upsert
-- NOT NULL, ver a skill de migration). Se algum produto já cadastrado for prédio, ele precisa ser
-- marcado à mão depois do deploy; a migration não adivinha. E prédio NUNCA vai para quadra/lote:
-- a unidade vertical tem colunas próprias (0171).
--
-- ATENCAO 8: `criado_origem` E `criado_por` NASCEM NULOS NAS LINHAS DE HOJE. Elas vieram do
-- semeador e do ZZ TESTE escrito direto no banco; inventar autor para o passado seria mentir no
-- registro (a mesma decisão do bloqueio na 0163). `criado_por` é TEXTO porque o autor vem de dois
-- cadastros com ids diferentes: usuário do hub (origem 'hub') ou `apolo_incorporador_usuarios.id`
-- (origem 'portal'). `criado_em` já existe desde a 0123 e não é recriado aqui.
--
-- ATENCAO 9: A SEQUENCE FICA FECHADA PARA `anon` E `authenticated`. O insert em
-- `hercules_empreendimentos` só acontece pelo service role (RLS ligada sem policy desde a 0123), e
-- não há motivo para a chave pública do site conseguir queimar números da sequence.

alter table public.hercules_empreendimentos
  add column if not exists operado_por uuid
    references public.apolo_incorporadores (id) on delete restrict,
  add column if not exists tipo_produto text not null default 'loteamento',
  add column if not exists criado_origem text,
  add column if not exists criado_por text;

alter table public.hercules_empreendimentos
  drop constraint if exists hercules_empreendimentos_tipo_produto;

alter table public.hercules_empreendimentos
  add constraint hercules_empreendimentos_tipo_produto
  check (tipo_produto in ('loteamento', 'vertical'));

alter table public.hercules_empreendimentos
  drop constraint if exists hercules_empreendimentos_criado_origem;

alter table public.hercules_empreendimentos
  add constraint hercules_empreendimentos_criado_origem
  check (criado_origem is null or criado_origem in ('semeador', 'hub', 'portal'));

create index if not exists hercules_empreendimentos_por_operador
  on public.hercules_empreendimentos (workspace_id, operado_por)
  where operado_por is not null;

-- ── O ID DO PRODUTO NASCIDO NO PANTEON ────────────────────────────────────────
create sequence if not exists public.hercules_empreendimento_id_seq
  as bigint
  start with 100000
  minvalue 100000;

alter sequence public.hercules_empreendimento_id_seq
  owned by public.hercules_empreendimentos.c2x_enterprise_id;

-- Se alguém já gravou à mão um id numérico >= 100000, a sequence pula para depois dele: o primeiro
-- produto cadastrado não pode colidir com ele no índice único. Rodar de novo não recua a sequence
-- (`greatest` com o `last_value` atual).
do $$
declare
  maior bigint;
  atual bigint;
begin
  select max(c2x_enterprise_id::bigint) into maior
    from public.hercules_empreendimentos
   where c2x_enterprise_id ~ '^[0-9]{1,18}$';

  if maior is not null and maior >= 100000 then
    select last_value into atual from public.hercules_empreendimento_id_seq;
    perform setval('public.hercules_empreendimento_id_seq', greatest(maior, atual), true);
  end if;
end $$;

alter table public.hercules_empreendimentos
  alter column c2x_enterprise_id
  set default (nextval('public.hercules_empreendimento_id_seq'::regclass))::text;

revoke all on sequence public.hercules_empreendimento_id_seq from anon, authenticated;
grant usage, select on sequence public.hercules_empreendimento_id_seq to service_role;

-- ── O QUE CADA COLUNA QUER DIZER ─────────────────────────────────────────────
comment on column public.hercules_empreendimentos.c2x_enterprise_id is
  'A CHAVE DO EMPREENDIMENTO (o enterprise_id que unidades, vendas, planos, esteira e escopo do portal usam). Nos legados é o id do C2X (< 100000; o ZZ TESTE é 9001). Nos nascidos no Panteon é o id da sequence hercules_empreendimento_id_seq, sempre >= 100000 (migration 0170). Nulo só em pai de grupo sem unidade própria (LOX, RDX, PDX), gravado com nulo explícito.';

comment on column public.hercules_empreendimentos.operado_por is
  'Quem opera o produto. Nulo = a Careli (administrativo da Careli). Preenchido = o incorporador opera com o próprio time (portal do incorporador). Sem backfill: VOC e Garden são vendidos também pela Gurgel, decisão pendente do dono (0170).';

comment on column public.hercules_empreendimentos.tipo_produto is
  'loteamento (unidade = quadra/lote) ou vertical (unidade = torre/andar/apartamento, colunas da 0171). Decide como a unidade se escreve no WhatsApp, no PDF e no contrato.';

comment on column public.hercules_empreendimentos.criado_origem is
  'De onde o cadastro nasceu: semeador (script de carga) · hub (tela interna) · portal (portal do incorporador). Nulo nas linhas anteriores à 0170.';

comment on column public.hercules_empreendimentos.criado_por is
  'Quem cadastrou. Texto porque o id vem de dois cadastros: usuário do hub (origem hub) ou apolo_incorporador_usuarios.id (origem portal). Nulo nas linhas anteriores à 0170.';
