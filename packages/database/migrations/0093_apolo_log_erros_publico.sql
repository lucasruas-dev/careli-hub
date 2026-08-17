-- 0093 · LOG DE ERROS DO CADASTRO PÚBLICO
--
-- Pedido do Lucas (17/08/2026): "queria registrar os erros de input de CAD. Uma imobiliária tentou
-- subir a CAD e deu erro, teria como ter essa visão? Tinha que pegar desde o início, quando informa
-- o CPF, imobiliária."
--
-- O QUE ISSO RESOLVE: hoje a recusa devolve a mensagem para a tela e MORRE ALI. O corretor vê o
-- erro, tenta de novo ou desiste, e do nosso lado não sobra nada — só o log da Vercel, que expira e
-- ninguém consulta. Quem tentou e não conseguiu é lead perdido sem ninguém saber.
--
-- ONDE É ALIMENTADA: no `responder()` de lib/publico/cad/rotas.ts, que é por onde TODAS as 14 rotas
-- públicas passam (checar-cpf, corretor, creci, sessao, imobiliaria, ocr, upload-url, salvar…).
-- Um ponto só, em vez dos 85 `return erro(...)` espalhados.
--
-- ⚠️ SEM DADO PESSOAL DO CLIENTE. Guarda quem TENTOU (corretor/imobiliária, que são nossos
-- parceiros) e o que barrou, não o que estava sendo cadastrado. O CPF do corretor entra
-- MASCARADO: serve para identificar quem travou sem virar base de CPF paralela.

create table if not exists public.apolo_cad_log_erros (
  id uuid primary key default gen_random_uuid(),

  -- Onde e o quê
  rota text not null,
  metodo text not null default 'POST',
  status integer not null,
  -- A mensagem que o corretor VIU. É ela que responde "por que não consegui", e é o texto que o
  -- operador vai ler para saber se liga para a imobiliária ou conserta o formulário.
  mensagem text,

  -- Quem tentou. Tudo opcional: nas primeiras telas ainda não sabemos quem é.
  corretor_cpf_mascarado text,
  corretor_nome text,
  imobiliaria_cnpj_mascarado text,
  imobiliaria_nome text,
  imobiliaria_entity_id uuid,
  enterprise_id text,
  enterprise_nome text,

  -- Contexto técnico, para achar o padrão
  -- (mesmo navegador tentando 5x = pessoa travada; IPs diferentes = problema geral).
  origem_hash text,
  user_agent text,
  duracao_ms integer,

  created_at timestamptz not null default now()
);

comment on table public.apolo_cad_log_erros is
  'Tentativas RECUSADAS no cadastro publico (CAD e credenciamento de imobiliaria). Alimentada no '
  'responder() das rotas publicas. Sem dado pessoal do cliente: guarda quem tentou e o que barrou.';

-- A consulta natural é "o que aconteceu nos últimos dias", então o índice é por tempo.
create index if not exists apolo_cad_log_erros_created_idx
  on public.apolo_cad_log_erros (created_at desc);

-- "Qual imobiliária mais trava" e "qual empreendimento concentra erro".
create index if not exists apolo_cad_log_erros_imob_idx
  on public.apolo_cad_log_erros (imobiliaria_entity_id, created_at desc)
  where imobiliaria_entity_id is not null;

create index if not exists apolo_cad_log_erros_enterprise_idx
  on public.apolo_cad_log_erros (enterprise_id, created_at desc)
  where enterprise_id is not null;

-- ⚠️ RLS LIGADA. A tabela nasce em `public`, e sem policy a chave anônima do Supabase leria o
-- histórico de tentativas dos nossos parceiros direto do PostgREST — o proxy do app não protege
-- essa porta. Sem policy de select: só a service role (o servidor) enxerga.
alter table public.apolo_cad_log_erros enable row level security;
