-- A CONSULTORIA DE REESTRUTURAÇÃO (c2x.app.br/consultoria/cr).
--
-- Tela de trabalho e de apresentação da consultoria do Lucas na C&R Construtora (out/2026 a
-- set/2027): escopo, frentes, plano de ação, indicadores e o relatório mensal que o Vitor pediu.
-- Não é módulo do Panteon e não lê nada do Panteon: é um documento do projeto, editado pelo Lucas
-- e lido pelo cliente por um link com token.
--
-- POR QUE UM DOCUMENTO (jsonb) E NÃO TABELAS POR FRENTE. A tela aprovada é um desenho que muda a
-- cada reunião (frente nova, atividade nova, indicador novo). Um documento só deixa a estrutura
-- acompanhar o projeto sem migration a cada mudança; o que precisa ser congelado (o relatório de
-- cada mês) é congelado dentro do próprio documento, no fechamento do mês.

create table if not exists public.consultoria_projetos (
  slug text primary key,
  dados jsonb not null,
  -- O link do cliente é /consultoria/<slug>?t=<token_leitura>. Só leitura. Trocar o token
  -- derruba todos os links já enviados.
  token_leitura text not null unique,
  atualizado_em timestamptz not null default now(),
  atualizado_por text,
  criado_em timestamptz not null default now()
);

-- Cada salvamento guarda a versão ANTERIOR aqui. A tela salva sozinha a cada edição; sem isso,
-- apagar uma lista por engano não teria volta.
create table if not exists public.consultoria_projetos_historico (
  id bigserial primary key,
  slug text not null references public.consultoria_projetos (slug) on delete cascade,
  dados jsonb not null,
  versao_de timestamptz not null,
  salvo_em timestamptz not null default now(),
  salvo_por text
);

create index if not exists consultoria_projetos_historico_slug_idx
  on public.consultoria_projetos_historico (slug, salvo_em desc);

comment on column public.consultoria_projetos.token_leitura is
  'Segredo do link de leitura do cliente (/consultoria/<slug>?t=). Da acesso ao documento inteiro, so leitura.';
comment on column public.consultoria_projetos.dados is
  'Documento do projeto. Salvo INTEIRO pela tela do dono, com conferencia de versao (atualizado_em) contra edicao concorrente.';

-- RLS ligada e sem policy: as duas tabelas são de serviço. Quem lê e escreve é a API, com o
-- service role, depois de conferir o token do link ou a sessão do dono.
alter table public.consultoria_projetos enable row level security;
alter table public.consultoria_projetos_historico enable row level security;

-- `revoke ... from public` não alcança anon nem authenticated no Supabase: tabela nova nasce com
-- grant para os dois. Tirado nominalmente.
revoke all on table public.consultoria_projetos from anon, authenticated;
revoke all on table public.consultoria_projetos_historico from anon, authenticated;
revoke all on sequence public.consultoria_projetos_historico_id_seq from anon, authenticated;
