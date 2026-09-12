-- 0153 — AS PASSAGENS DE ETAPA DO CARD DA TÊMIS: o fato que o banco nunca guardou.
--
-- ⚠️ NÃO APLICADA. Aguarda OK explícito do Lucas.
--
-- Lucas (11/09/2026), com a tela de trabalho aberta: *"o historico nao esta trazendo essas
-- aprovacoes de analise - contrato - contrato para assinatura, tem que trazer"*.
--
-- ⚠️ E ELE NÃO ESTAVA FALTANDO NA TELA: ELE NUNCA EXISTIU. Os seis pontos que movem um card
-- (`abrirTrabalho`, `marcarAtividade`, `moverCardDaTemis` duas vezes, `concluirAssinaturaDoCard` e
-- o POST de indeferir) fazem `update temis_trabalhos set estagio = ...` e mais nada — o estágio
-- anterior é sobrescrito no mesmo instante em que o novo é escrito. Não havia consulta capaz de
-- responder "quando este contrato saiu da análise": o dado tinha sido apagado por cima.
--
-- A aba Histórico mostrava `hercules_proposta_etapas` + `hercules_proposta_eventos`, que é o funil
-- do HÉRCULES ("Proposta → Contrato"): outro caminho, de outro módulo, sobre a mesma venda. Os dois
-- passam a conviver na MESMA linha do tempo, ordenados pela data — ver
-- `lib/temis/historico-de-etapas.ts`.
--
-- ⚠️ SEM CHECK DE VOCABULÁRIO EM `de`/`para`, e isto é o contrário do que a 0150 fez — de
-- propósito. Lá a coluna guarda ESTADO (onde o card está agora), e renomear `confeccao` para
-- `contrato` com um `update` está certo: só existe um presente. Aqui cada linha é FATO DATADO.
-- Reescrever o passado apagaria a palavra que estava na tela NAQUELE dia, que é metade do que uma
-- auditoria de contrato procura — e um check travaria a próxima renomeação exatamente nas linhas
-- antigas, que são as únicas que não podem mudar.
--
-- ⚠️ `de` NULO É O NASCIMENTO DO CARD, e não dado faltando. É a mesma leitura das 3.831 linhas sem
-- origem do histórico do Hércules: "entrou neste estágio", e não "veio de lá". Inventar uma origem
-- seria escrever no histórico algo que não aconteceu.
--
-- ⚠️ A CHAVE É O CARD, E NÃO A PROPOSTA. Medido em 10/09/2026: a proposta do Henrique (Q01 L05) tem
-- DOIS trabalhos abertos — a venda, de 06/09, e o pedido de cancelamento dela, de 08/09. Uma linha
-- do tempo por proposta misturaria os dois caminhos e diria que a mesma venda foi para assinatura e
-- para cancelamento na mesma tarde. `proposta_id` viaja junto porque é o elo com o Hércules, mas
-- quem manda é `trabalho_id`.

begin;

create table if not exists public.temis_trabalho_etapas (
  id           uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'careli',

  -- ── O CARD ──────────────────────────────────────────────────────────────────
  -- Cascade: card apagado leva o rastro dele junto. O histórico de um trabalho que não existe mais
  -- não responde pergunta nenhuma, e os cards não se apagam na operação (o board mostra faturado e
  -- indeferido, não some com eles).
  trabalho_id uuid not null references public.temis_trabalhos (id) on delete cascade,

  -- ⚠️ SEM FK, E CONGELADO. Mesma decisão de `temis_envelopes` e de `temis_contrato_edicoes`: a
  -- proposta é do Hércules e tem carga do C2X — uma FK aqui faria a limpeza de uma proposta
  -- importada derrubar o histórico de um contrato que já foi assinado.
  proposta_id uuid,

  -- ⚠️ O TIPO VAI GRAVADO NA LINHA, e não lido do card na hora de mostrar. É ele que decide a
  -- palavra da etapa (`faturado` é "Faturado" no contrato e "Concluído" nos outros três serviços),
  -- e a frase do histórico tem que continuar dizendo o que dizia mesmo que o card mude de tipo.
  trabalho_tipo text not null,

  -- ── A PASSAGEM ──────────────────────────────────────────────────────────────
  -- Sem check de vocabulário: ver a nota do cabeçalho.
  de   text,
  para text not null,

  -- ⚠️ NOT NULL: evento sem "quando" não tem lugar numa linha do tempo — é a mesma régua do
  -- histórico da unidade, que descarta a proposta sem data nenhuma.
  quando timestamptz not null default now(),

  -- ── QUEM ────────────────────────────────────────────────────────────────────
  -- Nulo no que o sistema move sozinho (webhook da Clicksign, avanço por atividade marcada em
  -- rota que não sabe quem clicou). Vazio é melhor que errado: atribuir a alguém um ato que pode
  -- não ter sido dele é justamente o que o histórico não pode fazer.
  quem      uuid,
  quem_nome text,

  -- ── POR QUE ANDOU ───────────────────────────────────────────────────────────
  origem     text not null,
  -- No indeferimento é o código do catálogo (`lib/temis/indeferimento.ts`); no retorno para
  -- correção é o que a coordenação escreveu.
  motivo     text,
  observacao text,

  constraint temis_trabalho_etapas_origem_valida
    check (
      origem in (
        'abertura',
        'atividade',
        'contrato_gerado',
        'envio_assinatura',
        'webhook_assinatura',
        'indeferimento',
        'retorno_para_correcao'
      )
    ),

  -- ⚠️ "ANDOU DE VERDADE". `moverCardDaTemis` NÃO compara o destino com o estágio atual: gerar o
  -- contrato duas vezes chama a função duas vezes com destino `contrato`, e a segunda gravaria
  -- "contrato → contrato" — uma linha no histórico dizendo que o card andou quando ele ficou
  -- parado. A guarda está também no código (`registrarPassagemDeEtapa` sai calada quando
  -- `de === para`), e a repetição é deliberada: o banco é a garantia, o código é o que evita o
  -- erro de constraint chegar até quem está emitindo um contrato.
  constraint temis_trabalho_etapas_anda_de_verdade
    check (de is null or de <> para)
);

-- A linha do tempo de UM card, do mais recente para o mais antigo. É a consulta da aba Histórico.
create index if not exists temis_trabalho_etapas_do_card_idx
  on public.temis_trabalho_etapas (trabalho_id, quando desc);

-- O mesmo, pelo lado da venda: serve para cruzar com o funil do Hércules sem varrer a tabela.
-- Parcial porque o nulo é normal — os quatro cards antigos do Garden e da Lavra nasceram antes do
-- elo com a proposta (0134).
create index if not exists temis_trabalho_etapas_da_proposta_idx
  on public.temis_trabalho_etapas (proposta_id, quando desc)
  where proposta_id is not null;

-- ⚠️ RLS LIGADA E SEM POLICY NENHUMA, sem grant — o mesmo fechamento da 0149 e da 0152. Quem lê
-- esta tabela é o servidor, com a chave de serviço, depois de a rota já ter provado o direito
-- (`autorizarLeituraDeContrato`). Uma policy aberta aqui entregaria a anon a linha do tempo de
-- quem comprou o quê e quando.
alter table public.temis_trabalho_etapas enable row level security;

comment on table public.temis_trabalho_etapas is
  'As passagens de etapa de UM card da Temis. Fato datado: as palavras gravadas em de/para nunca sao reescritas, nem quando o vocabulario muda.';
comment on column public.temis_trabalho_etapas.de is
  'O estagio anterior. NULO = nascimento do card, e nao dado faltando.';
comment on column public.temis_trabalho_etapas.origem is
  'O que fez o card andar: abertura, atividade, contrato_gerado, envio_assinatura, webhook_assinatura, indeferimento, retorno_para_correcao.';
comment on column public.temis_trabalho_etapas.proposta_id is
  'A venda do Hercules, congelada e SEM FK. A chave da linha do tempo e trabalho_id: uma proposta pode ter DOIS cards.';
comment on column public.temis_trabalho_etapas.trabalho_tipo is
  'O tipo do card no momento da passagem. E ele que decide a palavra da etapa na tela (faturado = Faturado no contrato, Concluido nos demais).';

commit;
