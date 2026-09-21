-- 0182 · O CONTRATO GUARDADO PASSA A SABER DE QUAL MINUTA SAIU (e de que degrau da cadeia)
--
-- ⚠️ ESCRITA E NÃO APLICADA. Espera OK explícito do Lucas.
--
-- ⚠️ ORDEM DE DEPLOY: TANTO FAZ. O código foi escrito para sobreviver às duas ordens, e isso está
-- medido no próprio caminho: `guardarContrato` (apps/hub/lib/temis/contrato-guardado-db.ts) tenta o
-- insert COM as duas colunas e, se o Supabase responder `42703` (Postgres) ou `PGRST204` (cache de
-- schema) citando `minuta_id` ou `minuta_origem`, refaz o insert SEM elas — ver
-- `ehColunaDaMinutaAusente`, que confere o NOME da coluna na mensagem justamente para não engolir
-- um erro de digitação em outra coluna. Sem a migration, o contrato continua saindo e a origem
-- continua escrita por extenso na `observacao`; com ela, a origem também vira consulta.
--
-- Pedido do Lucas (21/09/2026): *"preciso garantir que consigamos vincular os anexos por filho,
-- categoria. também as minutas."* A partir dessa data a minuta do contrato deixou de ser a do
-- empreendimento da proposta e passou a ser resolvida por uma CADEIA — categoria da unidade,
-- divisão da unidade, empreendimento da proposta, pai —, parando no primeiro degrau que tem minuta
-- publicada (apps/hub/lib/temis/minuta-da-cadeia.ts).
--
-- ATENCAO 1: É A HERANÇA QUE TORNA ESTAS COLUNAS NECESSÁRIAS. Enquanto havia uma minuta publicada
-- por empreendimento, dava para reconstruir de qual delas um PDF saiu: bastava olhar o
-- empreendimento do contrato. Com a cadeia não dá — dois contratos do MESMO empreendimento, no
-- mesmo dia, podem sair de minutas de níveis diferentes (um pela categoria do lote, outro pela
-- divisão), e nada no registro os distinguia. Daqui a um ano, auditar um contrato assinado seria
-- impossível.
--
-- ATENCAO 2: `minuta_origem` É TEXTO LIVRE, E NÃO UM ENUM. Ela guarda a frase que o operador leu na
-- tela antes de clicar ("modelo herdado do VALE DO OURO", "modelo da categoria Caução"), e é por
-- isso que ela carrega o NOME do degrau, e não o código dele. Um enum guardaria `pai` e obrigaria
-- quem audita a descobrir, dois anos depois, qual era o pai naquela data — e o cadastro muda. A
-- frase é o que foi verdade no dia da emissão, e ela não muda mais.
--
-- ATENCAO 3: A CHAVE ESTRANGEIRA É `on delete set null`, e não `cascade` nem `no action`. Minuta
-- arquivada não some da tabela hoje (o ciclo é publicar/arquivar, `temis_minutas.situacao`), mas se
-- um dia alguém apagar uma linha, apagar o CONTRATO junto seria destruir registro jurídico
-- (`cascade`), e impedir a exclusão (`no action`) travaria uma faxina legítima por causa de um
-- campo de auditoria. `set null` perde o ponteiro e mantém a frase da `minuta_origem` e a da
-- `observacao`, que continuam contando a história em português.
--
-- ATENCAO 4: SEM BACKFILL, E ISSO É DELIBERADO. Nulo aqui quer dizer "este contrato saiu antes de a
-- cadeia existir", que é exatamente a verdade dos que já estão na gaveta: todos vieram da minuta
-- publicada do empreendimento da proposta, pela igualdade exata. Inventar um valor para eles seria
-- afirmar, num campo de auditoria, uma coisa que ninguém mediu.
--
-- ATENCAO 5: O ÍNDICE É PARCIAL (`where minuta_id is not null`) E SÓ DO `tipo = 'contrato'`. A
-- pergunta que ele existe para responder é "quais contratos saíram da minuta X?" — feita quando se
-- descobre um defeito num modelo e é preciso saber quais papéis já foram a cartório com ele.
-- `hercules_documentos` guarda todo documento da venda (upload manual inclusive), e a esmagadora
-- maioria das linhas nunca terá `minuta_id`.
--
-- ATENCAO 6: RLS NÃO MUDA. `hercules_documentos` já tem a sua política e o acesso continua passando
-- pelo service role (`createApoloAdminClient`), como em todo o Panteon; acrescentar coluna a uma
-- tabela que já é protegida não abre porta nova. Não há `grant` a dar nem policy a escrever.
--
-- ATENCAO 7: IDEMPOTENTE. `add column if not exists`, `create index if not exists` e
-- `comment on column` podem rodar duas vezes e terminam no mesmo estado. A FK nasce junto com a
-- coluna; se a coluna já existir sem ela (aplicação manual pela metade), o bloco `do` acrescenta.

alter table public.hercules_documentos
  add column if not exists minuta_id uuid
    references public.temis_minutas (id) on delete set null;

alter table public.hercules_documentos
  add column if not exists minuta_origem text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_attribute a on a.attrelid = t.oid and a.attnum = any (c.conkey)
    where t.relname = 'hercules_documentos'
      and c.contype = 'f'
      and a.attname = 'minuta_id'
  ) then
    alter table public.hercules_documentos
      add constraint hercules_documentos_minuta_id_fkey
      foreign key (minuta_id) references public.temis_minutas (id) on delete set null;
  end if;
end
$$;

create index if not exists hercules_documentos_minuta_idx
  on public.hercules_documentos (minuta_id)
  where minuta_id is not null and tipo = 'contrato';

comment on column public.hercules_documentos.minuta_id is
  'A minuta publicada que virou este PDF. Nula no documento que não é contrato gerado, e nos contratos emitidos antes de 21/09/2026 (quando a cadeia entrou). Ver apps/hub/lib/temis/minuta-da-cadeia.ts.';

comment on column public.hercules_documentos.minuta_origem is
  'De que degrau da cadeia o modelo veio, na frase que o operador leu antes de emitir: "modelo da divisão VALE DO OURO VOL", "modelo herdado do VALE DO OURO", "modelo da categoria Caução". Texto livre de propósito: guarda o que era verdade no dia, e o cadastro muda.';
