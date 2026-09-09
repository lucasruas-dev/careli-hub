-- 0149 — O ENVELOPE DE ASSINATURA: onde fica o contrato que foi para a Clicksign.
--
-- Lucas, 08/09/2026: *"o sandbox esta com problemas, vamos de prod mesmo"*. Isso muda o desenho
-- desta tabela inteira, e nao e exagero: cada envelope criado tem CUSTO, e depois de ativado
-- (`running`) ele NAO SE APAGA — so se cancela, e o cancelado continua na lista da conta.
--
-- ATENCAO 1: A LINHA NASCE ANTES DA CHAMADA, E POR ISSO `envelope_id` E NULO. Se a linha so fosse
-- criada DEPOIS de a Clicksign responder, uma queda no meio (timeout da Vercel, 502, a funcao
-- morrendo) deixaria um envelope pago e permanente na conta do qual o Panteon nao teria NOTICIA
-- NENHUMA. A ordem certa e: grava a intencao, chama, carimba o resultado. Linha com
-- `enviado_em is null` e `falha is null` e um envio que comecou e nao terminou — e isso e um alarme
-- visivel, nao um silencio.
--
-- ATENCAO 2: OS SIGNATARIOS VAO CONGELADOS EM `signatarios` (jsonb), com o papel, o e-mail e a
-- ORDEM que valeu NAQUELE envio. Nao se le do cadastro na hora de mostrar: o operador pode ter
-- mudado a ordem so para aquele contrato (a regra do Lucas de 08/09/2026 — *"claro que temos que ter
-- a opcao de alterar antes de enviar o contrato, mas vem preenchido por padrao"*), e o cadastro do
-- empreendimento pode mudar depois. Ler do cadastro faria a tela mentir sobre um envelope que ja
-- saiu.
--
-- ATENCAO 3: `estado` FALA A LINGUA DA CASA, nao a do provedor. Os valores sao os de
-- `EstadoDaAssinatura` (lib/assinatura/tipos.ts) e a traducao mora em `lib/assinatura/traduzir.ts`.
-- Guardar `closed` cru aqui obrigaria toda leitura a saber que `closed` NAO e sinonimo de assinado
-- (o `deadline_partial_signature_action` fecha o envelope com as assinaturas que tiver). O cru fica
-- em `estado_cru`, ao lado, para quando o estado for `desconhecido`.

create table if not exists public.temis_envelopes (
  id           uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'careli',

  -- clicksign | d4sign. ⚠️ O PROVEDOR VAI GRAVADO porque sao DOIS vivos (Lucas, 07/09/2026: *"a
  -- minha ideia e ter as duas, nao vou desfazer da d4sign"* — ja ficamos 4 dias com o D4Sign fora
  -- do ar). Sem esta coluna, daqui a seis meses ninguem sabe em que plataforma procurar o contrato.
  provedor     text not null default 'clicksign',
  -- O id do envelope LA. Nulo ate a Clicksign responder — ver ATENCAO 1.
  envelope_id  text,
  -- O id do DOCUMENTO dentro do envelope, la. E por ele que os eventos do webhook chegam.
  provedor_documento_id text,
  -- O nome que aparece na lista da Clicksign (com o marcador [TESTE] quando for o ZZ TESTE).
  nome         text not null,

  -- ── O ELO COM A VENDA ───────────────────────────────────────────────────────
  -- `proposta_id` e a MESMA chave que liga o card da Temis ao contrato guardado
  -- (temis_trabalhos.proposta_id / hercules_documentos.proposta_id). `venda_id` NAO entra aqui: a
  -- FK dele aponta para `hercules_vendas`, que tem zero linhas.
  proposta_id  uuid references public.hercules_propostas (id) on delete set null,
  -- A linha de `hercules_documentos` do contrato que foi assinado — a versao exata.
  documento_id uuid references public.hercules_documentos (id) on delete set null,
  unidade_id   uuid references public.hercules_unidades (id) on delete set null,
  -- O id do C2X (o mesmo de apolo_enterprise_settings.enterprise_id), em texto.
  enterprise_id text,

  -- ── O ESTADO, NA LINGUA DA CASA ─────────────────────────────────────────────
  estado     text not null default 'rascunho',
  estado_cru text,
  -- Preenchida quando o envio falhou. Linha com falha E SEM envelope_id nao deixou nada na conta.
  falha      text,

  -- ── QUEM ASSINA, CONGELADO ──────────────────────────────────────────────────
  -- [{ "papel": "comprador", "nome": "...", "email": "...", "ordem": 1, "provedorId": "..." }, ...]
  signatarios jsonb not null default '[]'::jsonb,
  -- A ordem estava ligada NESTE envio? (o cadastro pode mudar depois — ver ATENCAO 2)
  ordenada    boolean not null default false,

  enviado_por      uuid,
  enviado_por_nome text,
  enviado_em    timestamptz,
  fechado_em    timestamptz,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  constraint temis_envelopes_estado_valido
    check (estado in ('rascunho','aguardando','parcial','assinado','recusado','cancelado','expirado','desconhecido')),
  constraint temis_envelopes_provedor_valido
    check (provedor in ('clicksign','d4sign'))
);

-- ⚠️ UNICO POR PROVEDOR + ENVELOPE, e PARCIAL porque o nulo e o estado normal antes da chamada.
-- Sem isto, um retry do webhook ou um duplo clique criariam duas linhas para o MESMO envelope e a
-- tela mostraria o contrato em dois estados ao mesmo tempo.
create unique index if not exists temis_envelopes_provedor_envelope_idx
  on public.temis_envelopes (provedor, envelope_id)
  where envelope_id is not null;

-- O webhook chega pelo id do DOCUMENTO na Clicksign, nao pelo do envelope: e por aqui que ele acha
-- a linha.
create index if not exists temis_envelopes_provedor_documento_idx
  on public.temis_envelopes (provedor, provedor_documento_id)
  where provedor_documento_id is not null;

create index if not exists temis_envelopes_proposta_idx
  on public.temis_envelopes (proposta_id, criado_em desc)
  where proposta_id is not null;

-- A fila de acompanhamento: o que ainda pode mudar sozinho.
create index if not exists temis_envelopes_em_movimento_idx
  on public.temis_envelopes (workspace_id, estado, atualizado_em desc);

alter table public.temis_envelopes enable row level security;

comment on table public.temis_envelopes is
  'Contratos mandados para assinatura (Clicksign/D4Sign). A linha nasce ANTES da chamada: envelope_id nulo = envio que comecou e nao terminou.';
comment on column public.temis_envelopes.signatarios is
  'Quem assinou aquele envio, com papel, e-mail e a ordem QUE VALEU NAQUELE ENVIO — nao se le do cadastro depois.';
comment on column public.temis_envelopes.estado is
  'A lingua da casa (EstadoDaAssinatura), nunca o status cru do provedor: closed NAO e sinonimo de assinado.';

-- ── OS EVENTOS DO WEBHOOK ────────────────────────────────────────────────────
--
-- No molde de `apolo_asaas_eventos` (0066), pelo mesmo motivo: guardar o payload CRU e o carimbo
-- NOSSO de recebimento e o que permite escrever o processador a partir do que a Clicksign manda de
-- verdade, e nao do que a doc diz que ela manda. A doc da v3 lista os 30 eventos e NAO mostra um
-- unico exemplo do corpo entregue ao endpoint (medido em 08/09/2026).
--
-- ATENCAO: `assinatura_conferida` REGISTRA O EVENTO QUE NAO PASSOU, em vez de descarta-lo. Um POST
-- forjado e a informacao mais util que este endpoint pode dar — e um evento legitimo que nao bate e
-- o sinal de que o cabecalho do HMAC nao e o que supomos (o nome dele nao esta documentado; ver
-- lib/assinatura/clicksign/webhook.ts). Nos dois casos, o que NAO acontece e mover o contrato.
create table if not exists public.temis_assinatura_eventos (
  id uuid primary key default gen_random_uuid(),
  provedor text not null default 'clicksign',
  evento   text,
  envelope_id text,
  provedor_documento_id text,
  -- Bateu o HMAC? Falso = registrado e NAO aplicado.
  assinatura_conferida boolean not null default false,
  -- Qual cabecalho trouxe o HMAC. E assim que o nome verdadeiro sera descoberto.
  assinatura_cabecalho text,
  payload jsonb,
  headers jsonb,
  -- O evento moveu alguma linha de temis_envelopes?
  aplicado boolean not null default false,
  -- Carimbo NOSSO, com hora: o horario do provedor pode vir sem fuso, ou nao vir.
  recebido_em timestamptz not null default clock_timestamp()
);

create index if not exists temis_assinatura_eventos_envelope_idx
  on public.temis_assinatura_eventos (envelope_id, recebido_em desc);
create index if not exists temis_assinatura_eventos_recebido_idx
  on public.temis_assinatura_eventos (recebido_em desc);

alter table public.temis_assinatura_eventos enable row level security;

comment on table public.temis_assinatura_eventos is
  'Eventos do webhook de assinatura, crus. assinatura_conferida=false: registrado e NAO aplicado ao contrato.';
