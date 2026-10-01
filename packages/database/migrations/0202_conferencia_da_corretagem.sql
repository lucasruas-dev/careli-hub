-- 0202 · A CONFERÊNCIA DA CORRETAGEM ZERO, QUE LIBERA A SIMULAÇÃO DE RESCISÃO
--
-- Lucas (30/09/2026): a Simulação de Rescisão recusa o contrato cujo texto de corretagem no C2X
-- registra "R$ 0,00" de intermediação (`montarDadosDaRescisao` empurra o aviso e
-- `carregarTermoDeRescisao` devolve 422). Medido no mesmo dia: 8 contratos em curso do Recanto do
-- Pará (C2X 20), 2 com parcela vencida (REPE186, contrato 2417, e REPE193, contrato 2383). O zero
-- pode ser venda sem corretor ou modelo que ninguém preencheu, e o texto não diz qual. Faltava um
-- jeito de a COORDENAÇÃO (admin e líder) registrar, depois de olhar o contrato assinado, qual das
-- duas coisas é.
--
-- ⚠️ DOIS RESULTADOS, E O VALOR SÓ EXISTE EM UM. `sem_corretagem` = o contrato assinado confirma que
-- não houve (a linha de corretagem sai do papel, sem aviso). `com_corretagem` = houve, e o valor em
-- reais lido no contrato assinado vai junto (a linha sai "Conforme contrato" com esse valor). O
-- CHECK de coerência trava os dois lados: não deixa gravar valor num "não houve" nem "houve" sem
-- valor positivo.
--
-- ⚠️ SÓ TEM EFEITO ENQUANTO O C2X DISSER ZERO. A leitura do termo ignora a conferência quando a
-- comissão lida do C2X não é exatamente 0: se o texto de corretagem for corrigido lá, o que vale é
-- o C2X, e esta linha fica inerte em vez de contradizer o contrato.
--
-- ⚠️ HISTÓRICO, E NÃO UMA LINHA POR CONTRATO (decisão de 01/10/2026, achado da revisão da
-- Publicação). A primeira versão desta migration tinha `unique (workspace_id, contrato_c2x_id)` e
-- o app regravava por cima (upsert): um valor digitado errado e corrigido apagava o rastro de quem
-- registrou o quê, e o papel que já circulou com o número antigo ficava sem prova do que valia
-- naquele dia. Agora cada registro é uma linha NOVA (o app só faz INSERT, nunca UPDATE), e VALE A
-- MAIS RECENTE por `conferido_em desc, id` (o `id` desempata dois registros no mesmo instante). O
-- índice abaixo serve essa leitura e também a lista do histórico na tela.
-- `contrato_c2x_id` é o `acquisition_requests.id` do C2X, sem FK porque o C2X é outro banco.
--
-- ⚠️ A OBSERVAÇÃO TEM TETO DE 1.000 CARACTERES (aparada). Ela é obrigatória porque é a prova da
-- conferência, mas campo de texto livre sem limite vira depósito de colagem de contrato inteiro.
-- O mesmo limite vale na rota e no painel; o CHECK é a última barreira.
--
-- ⚠️ QUEM CONFERIU É COPIADO, NÃO RESOLVIDO POR JOIN (mesmo desenho de `hercules_posse`): a pessoa
-- sai da empresa, o cadastro muda, e o histórico tem de continuar dizendo quem foi naquele dia.
--
-- ⚠️ MESMO DESENHO DAS IRMÃS (0165 e 0200): RLS ligada, sem policy, e o grant revogado de `anon` e
-- `authenticated`. O app fala com a tabela só pelo service role. A linha decide o número de um papel
-- financeiro entregue ao cliente, e a chave `anon` viaja no bundle.

create table if not exists public.hercules_conferencia_corretagem (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'careli',
  contrato_c2x_id bigint not null,
  resultado text not null,
  valor_em_reais numeric(12,2),
  observacao text not null,
  conferido_por uuid,
  conferido_por_nome text,
  conferido_em timestamptz not null default now(),

  constraint hercules_conferencia_corretagem_resultado check (
    resultado in ('sem_corretagem', 'com_corretagem')
  ),
  constraint hercules_conferencia_corretagem_observacao check (
    length(trim(observacao)) > 0 and length(observacao) <= 1000
  ),
  constraint hercules_conferencia_corretagem_coerente check (
    (resultado = 'sem_corretagem' and valor_em_reais is null)
    or (resultado = 'com_corretagem' and valor_em_reais > 0)
  )
);

create index if not exists hercules_conferencia_corretagem_por_contrato
  on public.hercules_conferencia_corretagem (workspace_id, contrato_c2x_id, conferido_em desc);

alter table public.hercules_conferencia_corretagem enable row level security;

revoke all on table public.hercules_conferencia_corretagem from public;
revoke all on table public.hercules_conferencia_corretagem from anon;
revoke all on table public.hercules_conferencia_corretagem from authenticated;

comment on table public.hercules_conferencia_corretagem is
  'Conferencia da coordenacao, no contrato assinado, de uma corretagem que o C2X registra como R$ 0,00. Libera a simulacao de rescisao. Historico: cada registro e uma linha nova e vale a mais recente (conferido_em desc, id); so vale enquanto a comissao lida do C2X for exatamente zero.';
comment on column public.hercules_conferencia_corretagem.contrato_c2x_id is
  'acquisition_requests.id do C2X. Sem FK: banco diferente.';
comment on column public.hercules_conferencia_corretagem.resultado is
  'sem_corretagem (nao houve: a linha some do papel) ou com_corretagem (houve, no valor lido no contrato assinado).';
comment on column public.hercules_conferencia_corretagem.valor_em_reais is
  'Corretagem em reais lida no contrato assinado. Nulo em sem_corretagem; positivo em com_corretagem.';
comment on column public.hercules_conferencia_corretagem.observacao is
  'O que a coordenacao viu no contrato assinado. Obrigatoria, ate 1000 caracteres: e a prova da conferencia.';
comment on column public.hercules_conferencia_corretagem.conferido_por is
  'Quem conferiu (auth.users.id), tirado da sessao e nunca do corpo do pedido.';
comment on column public.hercules_conferencia_corretagem.conferido_por_nome is
  'Nome de quem conferiu, copiado no ato.';
