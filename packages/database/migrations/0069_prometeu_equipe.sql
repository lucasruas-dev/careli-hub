-- Prometeu: a EQUIPE do lancamento — quem opera cada posto no dia.
--
-- Ate aqui o Setup so criava as mesas; nao havia como dizer QUEM fica em cada posto. A tela de
-- operacao (recepcao credencia, salao chama, secretaria atende) precisa abrir ja no lugar da
-- pessoa logada, e o mockup atendente.html deixava a pessoa escolher o posto na mao. Decisao do
-- Lucas (24/jul): PRE-ATRIBUIR no Setup. Esta tabela e o roster do evento.
--
-- Modelo (do mockup ja validado): a esteira tem 3 postos/zonas — recepcao, salao, secretaria —
-- e 2 papeis — organizador e atendente. Regra estruturante: ATENDENTE so existe na secretaria
-- (tem "minha mesa"); recepcao e salao sao sempre organizador. Por isso `mesa_id` so faz sentido
-- para o atendente da secretaria.
--
-- Uma pessoa ocupa UM posto por evento (unique evento_id+user_id). Trocar de posto = update.
--
-- Nao aplicar sem autorizacao expressa do Lucas (regra-mae). Autorizado por ele em 24/jul.

create table if not exists public.prometeu_equipe (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references public.prometeu_eventos (id) on delete cascade,
  -- Usuario do hub que vai operar. FK real: o roster so aponta para gente que existe.
  user_id uuid not null references public.hub_users (id) on delete cascade,
  -- organizador | atendente
  papel text not null default 'organizador',
  -- recepcao | salao | secretaria (mesmas zonas das mesas)
  zona text not null,
  -- So o atendente da secretaria tem mesa fixa. Nulo para organizador.
  mesa_id uuid references public.prometeu_mesas (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Uma atribuicao por pessoa por evento.
create unique index if not exists prometeu_equipe_uk
  on public.prometeu_equipe (evento_id, user_id);

-- Consulta "meu posto": dado o usuario logado, achar rapido a atribuicao dele no evento ativo.
create index if not exists prometeu_equipe_user_idx
  on public.prometeu_equipe (user_id, evento_id);

-- Uma mesa e' de no maximo um atendente ao mesmo tempo (indice parcial: mesa_id pode ser nulo).
create unique index if not exists prometeu_equipe_mesa_uk
  on public.prometeu_equipe (evento_id, mesa_id)
  where mesa_id is not null;
