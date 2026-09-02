-- O PORTAL COMERCIAL — o Hércules nasce como um TIPO de portal, não como módulo à parte.
--
-- Briefing do Lucas (02/09/2026): *"queria dentro do setup nosso, igual a tela do incorporador uma
-- tela de Comercial, aí vou fazendo os perfis, todos terão o mesmo link, final do c2x.app.br/gurgel,
-- o que vai mudar são os acessos. irei vincular os coordenadores aos empreendimentos"*.
--
-- ⚠️ POR QUE É UMA COLUNA, E NÃO MAIS UMA LISTA DE SLUG EM `perfis-de-portal.ts`. Aquele arquivo
-- diz, com razão, que lista serve para "um caso, por enquanto", e que produto de verdade — vários
-- perfis, cada um com seu conjunto de abas — merece tabela. Vários coordenadores, cada um vendo os
-- próprios empreendimentos, É produto de verdade.
--
-- ⚠️ O VÍNCULO A EMPREENDIMENTO PASSA A EXISTIR POR USUÁRIO. No incorporador, quem enxerga o quê é
-- o PORTAL (`apolo_incorporador_empreendimentos`): todo usuário do Cecílio vê o que o Cecílio vê.
-- No comercial é o contrário — o `/gurgel` é um só e cada coordenador vê os empreendimentos DELE.
-- A tabela nova não substitui a antiga: quem não tem vínculo próprio herda o do portal, o que
-- deixa os dez portais de incorporador exatamente como estão.

alter table public.apolo_incorporadores
  add column if not exists tipo text not null default 'incorporador';

alter table public.apolo_incorporadores
  drop constraint if exists apolo_incorporadores_tipo_valido;
alter table public.apolo_incorporadores
  add constraint apolo_incorporadores_tipo_valido
  check (tipo in ('incorporador', 'comercial'));

comment on column public.apolo_incorporadores.tipo is
  'incorporador = o dono do loteamento lendo a própria carteira; comercial = o time da Careli operando (reserva, proposta, contrato).';

-- ── O QUE CADA USUÁRIO ENXERGA ───────────────────────────────────────────────
create table if not exists public.apolo_incorporador_usuario_empreendimentos (
  usuario_id    uuid not null references public.apolo_incorporador_usuarios (id) on delete cascade,
  enterprise_id text not null,
  created_at    timestamptz not null default now(),
  primary key (usuario_id, enterprise_id)
);

create index if not exists apolo_incorporador_usuario_empreendimentos_por_empreendimento
  on public.apolo_incorporador_usuario_empreendimentos (enterprise_id);

alter table public.apolo_incorporador_usuario_empreendimentos enable row level security;

comment on table public.apolo_incorporador_usuario_empreendimentos is
  'Recorte POR USUÁRIO dentro de um portal. Sem linha aqui, o usuário herda o recorte do portal.';
