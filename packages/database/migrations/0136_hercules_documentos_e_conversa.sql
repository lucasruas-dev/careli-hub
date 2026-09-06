-- 0136 · O QUE SE FALA E O QUE SE TROCA SOBRE UMA VENDA
--
-- Lucas (06/09/2026): *"terei que ter um chat para relatar, tirar duvidas, informar de forma
-- formalizada (...) teremos nessa aba de historico mais duas abas, documentos e chat. Documentos e
-- para transitar documentos referente aquela reserva, proposta de forma segura e formalizada; o
-- chat e onde vai ficar os registros de conversas, formalizacoes, observacoes; e historico fica
-- sendo historico mesmo. Lembrando que os documentos tem que ser agrupados por protocolo, codigo. A
-- proposta, bem como o contrato, boletos tambem podem ser guardados nessa aba de documentos"*.
--
-- ⚠️ O AGRUPADOR E O PROTOCOLO, E NAO A UNIDADE. Um lote passa por varias vendas — o 01 04 do
-- Portal dos Vales teve proposta de sete clientes em quatro dias —, e o documento do comprador que
-- desistiu nao pode aparecer na conversa do comprador seguinte. `protocolo_numero` e o numero que
-- nasce na reserva e a proposta COPIA (`codigoDaVenda`), entao ele acompanha a venda inteira, da
-- reserva ao contrato: e o unico campo que agrupa o que e da mesma negociacao sem agrupar o que so
-- divide o terreno.
--
-- ⚠️ E A UNIDADE FICA JUNTO ASSIM MESMO, denormalizada, porque e por ela que a ficha do lote abre.
-- Sem ela, listar os documentos da tela exigiria descobrir antes todos os protocolos daquele lote —
-- uma consulta a mais para responder a pergunta mais comum da tela.
--
-- ⚠️ NADA SE APAGA. Documento formalizado e conversa formalizada existem para serem lidos depois,
-- inclusive contra quem os escreveu; por isso `removido_em` marca em vez de excluir, e o texto do
-- chat nao tem update. O que se corrige, se corrige com mensagem nova.

-- ── DOCUMENTOS ──────────────────────────────────────────────────────────────
create table if not exists public.hercules_documentos (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          text not null default 'careli',

  -- O agrupador. Nulo só no documento que chega antes de existir reserva (não acontece hoje).
  protocolo_numero      bigint,
  unidade_id            uuid not null references public.hercules_unidades (id) on delete cascade,
  proposta_id           uuid references public.hercules_propostas (id) on delete set null,
  reserva_id            uuid references public.hercules_reservas (id) on delete set null,
  -- É por ele que o escopo do portal filtra, do mesmo jeito que em `hercules_propostas`.
  empreendimento_codigo text,

  -- ⚠️ `tipo` DIZ O QUE O PAPEL É, e é o que deixa a aba separar o gerado pelo sistema (proposta,
  -- contrato, boleto) do que alguém subiu à mão. Sem isso, o PDF da proposta vira "mais um arquivo"
  -- no meio de RG e comprovante de renda.
  tipo                  text not null default 'documento',
  nome                  text not null,
  -- Caminho no bucket de documentos do Apolo. O link de leitura é ASSINADO na hora, nunca guardado.
  caminho               text not null,
  mime                  text,
  tamanho_bytes         bigint,

  -- ── O ELO COM O APOLO ────────────────────────────────────────────────────
  --
  -- Lucas (06/09/2026): *"lembrando que esses documentos tambem tem que existir no apolo"*.
  --
  -- ⚠️ E LEITURA, E NAO COPIA DE LINHA. Os BYTES ja vivem no bucket `apolo-documents`, o mesmo do
  -- Apolo: "existir no Apolo" ja e meio verdade hoje, e o que falta e APARECER na ficha do cliente.
  -- Copiar a linha para `apolo_documents` foi descartado por tres fatos medidos: (a) `entity_id` la
  -- e NOT NULL, e o documento da venda nasce quando o cliente pode ainda nao ter entidade; (b) o
  -- DELETE de /api/apolo/documentos/[id] roda com autorizacao de LEITURA e apaga arquivo E linha —
  -- o "nada se apaga" desta tabela morreria no primeiro clique de um viewer no CRM; (c) o
  -- visualizador da esteira monta uma ABA por documento sem filtrar tipo, entao contrato e boleto
  -- da venda apareceriam no meio do RG na tela em que o analista aprova a CAD (e a varredura de
  -- OCR pago da correcao de titular leria todos eles). Uma linha so, dois leitores.
  --
  -- ⚠️ O ELO VAI EM COLUNA, NUNCA EM jsonb. Filtrar por campo dentro de `metadata` nao tem indice, e
  -- update de jsonb nesta casa ja apagou dado por substituir o objeto inteiro.
  --
  -- ⚠️ E O CPF ANDA JUNTO porque o documento chega ANTES da proposta: na fase de reserva nao ha
  -- `cliente_entity_id` (a reserva guarda o CPF do titular em jsonb). Com os dois campos, o leitor
  -- do Apolo casa pela entidade OU pelo documento, e nada fica invisivel esperando a proposta.
  cliente_entity_id     uuid references public.apolo_entities (id) on delete set null,
  cliente_documento     text,

  enviado_por           text,
  enviado_por_nome      text,
  observacao            text,

  criado_em             timestamptz not null default now(),
  -- Marca, não exclui: ver o cabeçalho.
  removido_em           timestamptz,
  removido_por_nome     text
);

create index if not exists hercules_documentos_por_unidade
  on public.hercules_documentos (unidade_id, criado_em desc);
create index if not exists hercules_documentos_por_protocolo
  on public.hercules_documentos (protocolo_numero)
  where protocolo_numero is not null;
-- Os dois caminhos pelos quais o Apolo acha o documento da venda de uma pessoa.
create index if not exists hercules_documentos_por_cliente
  on public.hercules_documentos (cliente_entity_id)
  where cliente_entity_id is not null;
create index if not exists hercules_documentos_por_cpf
  on public.hercules_documentos (cliente_documento)
  where cliente_documento is not null;

-- ── CONVERSA ────────────────────────────────────────────────────────────────
--
-- ⚠️ NÃO É A IRIS, e não deve virar. A Iris fala COM O CLIENTE, por WhatsApp e e-mail, com fila e
-- SLA. Isto é o registro interno da venda: o que o coordenador combinou com o corretor, o que o
-- jurídico respondeu, a observação que explica por que o desconto saiu daquele tamanho. Quem lê
-- isso é quem for auditar a venda em 2029.
create table if not exists public.hercules_conversas (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      text not null default 'careli',

  protocolo_numero  bigint,
  unidade_id        uuid not null references public.hercules_unidades (id) on delete cascade,
  proposta_id       uuid references public.hercules_propostas (id) on delete set null,
  empreendimento_codigo text,

  -- ⚠️ `formalizacao` NÃO É ENFEITE DE ESTILO: é o que separa "combinei com o corretor" de "fica
  -- registrado que o cliente foi avisado". A tela mostra as duas diferente, e quem audita procura a
  -- segunda.
  tipo              text not null default 'mensagem',
  texto             text not null,

  autor             text,
  autor_nome        text,

  criado_em         timestamptz not null default now()
);

create index if not exists hercules_conversas_por_unidade
  on public.hercules_conversas (unidade_id, criado_em desc);
create index if not exists hercules_conversas_por_protocolo
  on public.hercules_conversas (protocolo_numero)
  where protocolo_numero is not null;

-- ⚠️ RLS LIGADA E SEM POLICY, como todas as irmãs da família (0112, 0123, 0125, 0133). O app fala
-- com estas tabelas pelo service role, que passa por cima de RLS; ligar sem policy fecha para a
-- chave pública — que vai no bundle que qualquer visitante baixa — e não muda uma linha do que a
-- aplicação faz. Aqui isso pesa mais que nas outras: são documentos de cliente e conversa interna.
alter table public.hercules_documentos enable row level security;
alter table public.hercules_conversas  enable row level security;
