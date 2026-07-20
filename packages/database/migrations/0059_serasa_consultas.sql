-- SERASA EXPERIAN — registro de cada consulta de crédito.
--
-- Uma linha POR CHAMADA, inclusive as que falharam. Consulta de birô é paga e é dado pessoal
-- de terceiro: as duas coisas exigem rastro. Sem esta tabela não dá para responder "quanto
-- gastamos", "quem consultou o CPF de fulano" nem "por quê".
--
-- ⚠️ TABELA PRÓPRIA, nunca em `apolo_entities.metadata`. O sync do C2X faz upsert substituindo
-- o metadata inteiro (incidente de 20/jul, ver migrations 0057 e 0058). Um relatório de crédito
-- apagado pelo sync noturno seria dinheiro jogado fora.

create table if not exists public.serasa_consultas (
  id uuid primary key default gen_random_uuid(),

  -- A quem a consulta se refere. ON DELETE SET NULL: se a ficha for apagada, o registro do
  -- gasto e da finalidade PERMANECE — é obrigação de auditoria, não detalhe do cadastro.
  entity_id uuid references public.apolo_entities (id) on delete set null,

  -- Documento consultado, só dígitos. Guardado em claro de propósito: sem ele não há como
  -- responder a um titular que pergunte quais consultas foram feitas sobre o CPF dele.
  documento text not null,
  tipo_pessoa text not null check (tipo_pessoa in ('pf', 'pj')),

  -- Qual relatório foi pedido (RELATORIO_BASICO_PF_PME etc.) e o que foi junto.
  report_name text not null,
  optional_features text[] not null default '{}',

  -- ⚠️ SEM DEFAULT, de propósito. O ambiente TEM que ser dito a cada gravação: um score de
  -- homologação confundido com um de produção levaria a aprovar crédito com dado de teste.
  ambiente text not null check (ambiente in ('homologacao', 'producao')),

  status text not null check (status in ('sucesso', 'erro')),
  http_status integer,
  erro text,

  -- Relatório CRU, como veio. O schema da resposta não está documentado campo a campo, então
  -- extrair só o que se acha importante hoje perderia o que ninguém previu.
  resposta jsonb,
  -- Extrato pequeno para listar e ordenar sem abrir o jsonb inteiro (score, faixa, etc.).
  resumo jsonb not null default '{}'::jsonb,

  -- Em centavos, como todo dinheiro no projeto. Fica nulo enquanto o Serasa não informar o
  -- preço por relatório — e, sem preço, a consulta em produção nem é liberada.
  custo_centavos integer,
  cost_center text,

  -- LGPD: quem pediu e para quê. Consulta de CPF por sistema anônimo é problema.
  solicitado_por uuid,
  finalidade text not null default 'analise-credito-cad',

  created_at timestamptz not null default now()
);

-- Histórico da ficha, do mais novo para o mais antigo (é como a tela lista).
create index if not exists serasa_consultas_entidade_idx
  on public.serasa_consultas (entity_id, created_at desc);

-- Trava de duplicidade: antes de cobrar de novo, procurar consulta recente do MESMO documento.
create index if not exists serasa_consultas_documento_idx
  on public.serasa_consultas (documento, created_at desc);

-- Soma de gasto por período e por ambiente, e contagem do teto diário de homologação
-- (200 chamadas/dia por IP, estourar bloqueia o IP).
create index if not exists serasa_consultas_periodo_idx
  on public.serasa_consultas (created_at desc, ambiente);

alter table public.serasa_consultas enable row level security;

-- Leitura para usuário autenticado; escrita só via service role (as rotas do servidor).
-- O recorte por papel (imobiliária e corretor NÃO podem ver relatório de crédito) é feito na
-- aplicação, como no resto do Apolo.
drop policy if exists serasa_consultas_read on public.serasa_consultas;
create policy serasa_consultas_read
  on public.serasa_consultas for select to authenticated using (true);
