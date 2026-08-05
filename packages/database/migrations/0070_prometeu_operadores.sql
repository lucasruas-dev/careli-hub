-- Prometeu: as CONTAS de quem opera o evento (login proprio, nao e' usuario do hub).
--
-- Decisao do Lucas (24/jul): a equipe do evento (organizadores, atendentes) loga com
-- nome.sobrenome + SENHA, nao e-mail, e SO enxerga o Prometeu. Nao sao hub_users — sao contas
-- exclusivas do evento, criadas pelo Lucas no Setup. Por isso a prometeu_equipe (que apontava
-- para hub_users, criada mais cedo hoje e ainda VAZIA) e' substituida por esta.
--
-- 3 perfis: organizador (posto fisico: recepcao/salao/secretaria, faz os bips), atendente (so
-- na secretaria, tem mesa), gestor (a definir). A tela de operacao abre no posto (zona) da
-- pessoa. Atendente da secretaria tem mesa fixa; organizador nao.
--
-- SENHA nunca em texto: senha_hash guarda 'salt:hash' do scrypt (nativo do Node). A sessao e' um
-- token assinado com PROMETEU_SESSION_SECRET (fora do banco).
--
-- Autorizado pelo Lucas em 24/jul ("pode sim"). Regra-mae: migration = operacao sensivel.

drop table if exists public.prometeu_equipe;

create table if not exists public.prometeu_operadores (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references public.prometeu_eventos (id) on delete cascade,
  -- Login: nome.sobrenome (guardado em minusculas; unico global).
  username text not null,
  -- Nome de exibicao (como aparece no cabecalho da tela dele).
  nome text not null,
  -- scrypt: 'saltHex:hashHex'. Nunca a senha crua.
  senha_hash text not null,
  -- organizador | atendente | gestor
  perfil text not null default 'organizador',
  -- recepcao | salao | secretaria — o posto onde a pessoa cai ao logar
  zona text not null,
  -- So o atendente da secretaria tem mesa fixa. Nulo para organizador.
  mesa_id uuid references public.prometeu_mesas (id) on delete set null,
  ativo boolean not null default true,
  ultimo_login_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Username unico, sem depender de caixa ('Joao.Silva' == 'joao.silva').
create unique index if not exists prometeu_operadores_username_uk
  on public.prometeu_operadores (lower(username));

create index if not exists prometeu_operadores_evento_idx
  on public.prometeu_operadores (evento_id, ativo);

-- Uma mesa e' de no maximo um atendente por evento.
create unique index if not exists prometeu_operadores_mesa_uk
  on public.prometeu_operadores (evento_id, mesa_id)
  where mesa_id is not null;
