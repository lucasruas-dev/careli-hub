-- A TRILHA DE EDIÇÃO DO LSOFT PASSA A SOBREVIVER À RECARGA.
--
-- Pedido do Lucas (24/09/2026): subir os demais empreendimentos para o LSoft Integração. Subir é
-- rodar uma carga, e rodar uma carga hoje APAGA o trabalho que o time já fez na tela.
--
-- ⚠️ O QUE ACONTECE HOJE, medido em 24/09/2026 no banco:
--   `lsoft_clientes_edicoes` tem 948 linhas, TODAS com `parcela_id` preenchido, e 640 delas são
--   baixa de pagamento (parcela.paga · parcela.valor_recebido · parcela.data_recebido). A coluna
--   nasceu na 0098 como `references lsoft_parcelas (id) ON DELETE CASCADE`, e o importador começa
--   apagando a tabela inteira (`importar-para-supabase.mjs:233`) para regravar com ids novos.
--   Resultado: a carga leva as 948 linhas junto, em silêncio, sem erro em tela nenhuma.
--
--   A trilha do CADASTRO não corre esse risco: `cliente_codigo` aponta para `lsoft_clientes`, que
--   o importador faz upsert por código, sem delete. Quem morre é só a trilha das PARCELAS.
--
-- ⚠️ O MOLDE JÁ EXISTE NA CASA e está provado: `lsoft_classificacao_de_parcela` (0103) guarda o
--   `parcela_id` como referência FRACA, sem foreign key, e religa pela `impressao_digital` mais o
--   `ordinal`. É exatamente o mesmo problema; esta migration copia a solução em vez de inventar
--   outra, para que o reconciliador use a mesma régua nas duas tabelas.
--
-- ⚠️ A FÓRMULA TEM DE SER IDÊNTICA À DA 0103, campo a campo e na mesma ordem:
--     md5(cliente_codigo|empreendimento|parcela|vencimento|valor|observacoes|origem) + ordinal
--   `concat_ws` PULA nulo (não vira string vazia), e é essa semântica que o lado JavaScript imita
--   descartando os nulos antes do join. Um `coalesce(...,'')` aqui faria as duas pontas gerarem
--   hashes diferentes para a mesma parcela, e o religamento falharia sem nenhum erro.
--
-- ⚠️ POR QUE `set null` E NÃO REMOVER A FOREIGN KEY. A 0103 não tem FK nenhuma porque nasceu assim.
--   Aqui há 948 linhas vivas, e manter a integridade referencial (um `parcela_id` preenchido sempre
--   aponta para uma parcela que existe) continua valendo: o que não pode é a linha MORRER junto.
--   Com `on delete set null` a trilha fica órfã, visível, e o reconciliador a religa.

begin;

-- ── 1. A trilha deixa de ser apagada em cascata ─────────────────────────────
alter table public.lsoft_clientes_edicoes
  drop constraint if exists lsoft_clientes_edicoes_parcela_id_fkey;

alter table public.lsoft_clientes_edicoes
  add constraint lsoft_clientes_edicoes_parcela_id_fkey
  foreign key (parcela_id) references public.lsoft_parcelas (id) on delete set null;

-- ── 2. As colunas que permitem religar ──────────────────────────────────────
-- Nulável: a trilha do CADASTRO não tem parcela e nunca terá digital.
alter table public.lsoft_clientes_edicoes
  add column if not exists impressao_digital text;

-- Desempata parcelas byte a byte idênticas. Quase sempre 1, como na 0103.
alter table public.lsoft_clientes_edicoes
  add column if not exists ordinal integer not null default 1;

-- ⚠️ REDUNDÂNCIA PROPOSITAL, mesma razão da 0103: quando a parcela some, estes dois campos são o
-- que ainda diz de quem era aquela linha e onde procurar. `parcela_rotulo` (0098) já congela
-- "007/084 · 10/09/2026"; estes acrescentam o que as redes 2 e 3 do reconciliador precisam.
alter table public.lsoft_clientes_edicoes
  add column if not exists empreendimento_no_momento text;

alter table public.lsoft_clientes_edicoes
  add column if not exists vencimento_no_momento date;

alter table public.lsoft_clientes_edicoes
  add column if not exists valor_no_momento numeric(14, 2);

-- ── 3. Backfill das 948 linhas que já existem ───────────────────────────────
--
-- ⚠️ ISTO SÓ FUNCIONA ENQUANTO AS PARCELAS ESTIVEREM VIVAS, ou seja, ANTES da próxima carga. Se
-- alguém rodar a importação antes desta migration, não há de onde tirar a digital: a linha já terá
-- sido apagada. É o motivo de esta migration vir primeiro, e não junto com a carga.
--
-- ⚠️ O VALOR É O DA PARCELA AGORA, não o valor anterior da edição. A digital identifica a PARCELA,
-- não a alteração; misturar as duas coisas geraria um hash que nenhuma parcela real reproduz.
update public.lsoft_clientes_edicoes e
   set impressao_digital = md5(
         concat_ws(
           '|',
           p.cliente_codigo,
           p.empreendimento,
           p.parcela,
           p.vencimento::text,
           p.valor::text,
           p.observacoes,
           p.origem
         )
       ),
       empreendimento_no_momento = p.empreendimento,
       vencimento_no_momento = p.vencimento,
       valor_no_momento = p.valor
  from public.lsoft_parcelas p
 where p.id = e.parcela_id
   and e.impressao_digital is null;

-- ── 4. O índice que o reconciliador vai usar ────────────────────────────────
-- Parcial: a trilha do cadastro (digital nula) não entra e não ocupa espaço.
create index if not exists lsoft_edicoes_digital_idx
  on public.lsoft_clientes_edicoes (impressao_digital)
  where impressao_digital is not null;

-- ⚠️ SEM RESTRIÇÃO ÚNICA, ao contrário da 0103. Lá cada parcela tem no máximo UMA classificação;
-- aqui a mesma parcela recebe várias linhas de trilha ao longo do tempo (é um histórico, e uma
-- baixa sozinha já grava três: paga, valor_recebido e data_recebido). Unicidade aqui recusaria a
-- segunda edição da mesma parcela.

commit;
