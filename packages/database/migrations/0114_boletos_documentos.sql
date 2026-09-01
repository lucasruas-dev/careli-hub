-- OS DOCUMENTOS DOS CLIENTES QUE RECEBEM BOLETO
--
-- O Asaas exige CPF ou CNPJ para criar o cliente e emitir a cobrança. A planilha mensal que o
-- administrativo manda NÃO traz documento — ela tem nome, unidade, valor e vencimento — e sete dos
-- nove empreendimentos não têm carteira no LSoft nem no C2X, então não havia de onde tirar.
--
-- Era essa a falta que travava o botão "Emitir no Asaas": 87 clientes sem documento. O Lucas os
-- levantou presencialmente em 01/09/2026 e trouxe a devolutiva; esta tabela é onde ela mora.
--
-- ⚠️ ESTA TABELA GUARDA DADO PESSOAL: nome, CPF e telefone de ~200 pessoas. RLS LIGADA e sem
-- policy de select — só a service role (o servidor) lê. As telas passam pelas rotas, que
-- autorizam por papel. O mesmo padrão das demais tabelas do Apolo.
--
-- ⚠️ A CHAVE É EMPREENDIMENTO + UNIDADE, e não o nome. Nome muda de grafia entre a planilha e a
-- devolutiva ("Alison Dutra" x "ALISON DUTRA"), tem acento inconsistente e repete: cinco linhas do
-- Guaimbé são a mesma empresa (BCM) em unidades diferentes. A unidade é o que identifica a
-- cobrança de forma estável. O nome fica guardado para CONFERÊNCIA — se ele divergir do que está na
-- planilha, a tela avisa em vez de emitir no cliente errado.

create table if not exists public.boletos_documentos (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  text        not null default 'careli',

  -- O `slug` de `lib/apolo/boletos/empreendimentos.ts` (garden, vale-do-sol, on-sky…).
  empreendimento text       not null,
  -- Como aparece na planilha: "307", "00000430". Guardado como veio.
  unidade        text       not null,

  -- ⚠️ SÓ DÍGITOS. A devolutiva vem formatada ("027.687.976-77", "05.415.977/0001-93") e a planilha
  -- pode vir de outro jeito. Guardar formatado faria o cruzamento falhar por um ponto.
  documento      text       not null,
  -- Nome como veio na devolutiva, para a tela conferir contra a planilha antes de emitir.
  nome           text       not null,
  -- Telefone ou e-mail. Na devolutiva as empresas trazem e-mail nesta coluna.
  contato        text,

  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  criado_por     uuid,

  constraint boletos_documentos_unidade_unica unique (workspace_id, empreendimento, unidade),
  -- CPF tem 11 dígitos, CNPJ tem 14. Qualquer outra coisa é erro de digitação, e um documento
  -- inválido só aparece quando o Asaas recusa — com o boleto já em fila.
  constraint boletos_documentos_tamanho check (char_length(documento) in (11, 14))
);

create index if not exists boletos_documentos_por_empreendimento
  on public.boletos_documentos (workspace_id, empreendimento);

alter table public.boletos_documentos enable row level security;

comment on table public.boletos_documentos is
  'CPF/CNPJ dos clientes que recebem boleto. O Asaas exige documento e a planilha mensal nao traz.';
comment on column public.boletos_documentos.documento is
  'Somente digitos: 11 (CPF) ou 14 (CNPJ). Formatado quebraria o cruzamento.';
comment on column public.boletos_documentos.nome is
  'Nome da devolutiva, guardado para CONFERIR contra a planilha — nao para casar registro.';
