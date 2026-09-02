-- TÊMIS — OS TRABALHOS DO BOARD.
--
-- Cada linha é uma solicitação que atravessa o kanban: contrato, cessão, distrato, cancelamento e
-- cancelamento por correção. Desenho fechado com o Lucas em 02/09/2026.
--
-- ⚠️ UM FLUXO SÓ PARA OS CINCO SERVIÇOS. *"o fluxo é o mesmo, muda é as atividades"*. O que muda por
-- serviço é o checklist (em `lib/temis/trabalhos.ts`) e uma particularidade: quem assina.
--
-- ⚠️ O RASTRO É OBRIGATÓRIO, E É POR ISSO QUE ELE ESTÁ NA MESMA LINHA. *"vamos ter que colocar
-- rastro (...) precisamos ter isso tudo bem amarrado pois estamos falando de contrato, distratos,
-- isso é muito sério"*. Guardar a origem numa tabela ao lado permitiria um trabalho existir sem
-- ela; aqui não existe solicitação sem dizer de onde veio e quem pediu.
--
-- ⚠️ E O RASTRO MUDA CONFORME QUEM ABRE:
--   • pelo ATENDIMENTO (Iris) — exige o ticket, que nasce lá, MAIS a evidência da solicitação: o
--     atendente é intermediário, e o que prova o pedido é a conversa do cliente, não o login dele;
--   • pelo COORDENADOR — basta o registro de quem abriu: *"o login e senha dele que vai ser a
--     evidência"*.
-- A trava está no CHECK abaixo, e não só na tela: uma rota nova, um script de carga ou um clique
-- fora de ordem não podem criar distrato sem origem.

create table if not exists public.temis_trabalhos (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  text not null default 'careli',

  -- contrato | cessao | distrato | cancelamento | cancelamento_correcao
  tipo          text not null,
  -- entrada | confeccao | assinatura | finalizado
  estagio       text not null default 'entrada',
  -- ⚠️ DAQUI CONTAM OS PRAZOS, e não da criação do card: um trabalho que esperou três dias na
  -- entrada chegaria à confecção já vermelho, e o atraso apareceria em quem pegou o trabalho.
  estagio_desde timestamptz not null default now(),

  enterprise_id     text not null,
  enterprise_codigo text not null,
  enterprise_nome   text not null,
  unidade           text not null,

  cliente_nome  text not null,
  cliente_cpf   text,

  -- As atividades já marcadas, pelo texto. Ver ATIVIDADES em lib/temis/trabalhos.ts.
  atividades_feitas jsonb not null default '[]'::jsonb,
  observacao        text,

  -- ── O RASTRO ────────────────────────────────────────────────────────────────
  -- hercules | iris | coordenador
  canal            text not null,
  -- O ticket da Iris, quando a solicitação nasceu de um atendimento.
  iris_ticket_id   text,
  -- A evidência do pedido do cliente (print, áudio, e-mail), no storage.
  evidencia_path   text,
  aberto_por       uuid,

  -- ⚠️ SÓ NA CORREÇÃO E NA CESSÃO: o contrato de origem. Na correção diz o que está sendo
  -- corrigido; na cessão, qual contrato será encerrado para o novo nascer.
  trabalho_origem_id uuid references public.temis_trabalhos (id) on delete set null,

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  constraint temis_trabalhos_tipo_valido
    check (tipo in ('contrato','cessao','distrato','cancelamento','cancelamento_correcao')),
  constraint temis_trabalhos_estagio_valido
    check (estagio in ('entrada','confeccao','assinatura','finalizado')),
  constraint temis_trabalhos_canal_valido
    check (canal in ('hercules','iris','coordenador')),

  -- ⚠️ A REGRA DO RASTRO, NO BANCO. Solicitação vinda do atendimento não existe sem ticket e sem
  -- evidência — nem por rota nova, nem por script, nem por clique fora de ordem.
  constraint temis_trabalhos_rastro_do_atendimento
    check (canal <> 'iris' or (iris_ticket_id is not null and evidencia_path is not null))
);

-- O board abre por estágio; a busca do dia a dia é por unidade e por cliente.
create index if not exists temis_trabalhos_board_idx
  on public.temis_trabalhos (workspace_id, estagio, estagio_desde);
create index if not exists temis_trabalhos_unidade_idx
  on public.temis_trabalhos (workspace_id, enterprise_id, unidade);
create index if not exists temis_trabalhos_cliente_idx
  on public.temis_trabalhos (workspace_id, cliente_cpf);

alter table public.temis_trabalhos enable row level security;

comment on table public.temis_trabalhos is
  'Solicitações do board da Têmis: contrato, cessão, distrato e cancelamentos.';
comment on column public.temis_trabalhos.estagio_desde is
  'Quando o card entrou no estágio atual — é daqui que os prazos das atividades contam.';
comment on column public.temis_trabalhos.evidencia_path is
  'A evidência do pedido do cliente. Obrigatória quando a solicitação vem do atendimento.';

-- ── A TAXA DE CESSÃO, NO CADASTRO DO EMPREENDIMENTO ──────────────────────────
--
-- Regra do Lucas: *"dentro do cadastro do empreendimento vamos colocar a taxa que vamos cobrar para
-- fazer o termo de cessão"*.
--
-- ⚠️ NULL E ZERO SÃO COISAS DIFERENTES: `0` é a casa não cobrar naquele empreendimento — decisão —,
-- e `null` é ninguém ter configurado. Tratar os dois igual faria a cessão travar onde a isenção é
-- intencional, ou sair de graça onde alguém esqueceu de preencher. Por isso a coluna aceita nulo e
-- não tem default.
alter table public.apolo_enterprise_settings
  add column if not exists taxa_cessao numeric;

comment on column public.apolo_enterprise_settings.taxa_cessao is
  'Taxa cobrada pelo termo de cessão. NULL = não configurada (trava a cessão); 0 = isenção decidida.';
