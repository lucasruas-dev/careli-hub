-- A RESERVA DO HÉRCULES — a que nasce no Panteon, pelo coordenador, pelo salão ou pelo corretor.
--
-- Lucas (02/09/2026): *"tanto pelo mapa quanto pelas unidades ele tem que poder reservar, gerar
-- proposta, encaminhar para contratos"*; antes (31/08) *"a reserva NASCE no Panteon e vai pro C2X"*.
--
-- ⚠️ POR QUE UMA TABELA PRÓPRIA, E NÃO `hercules_vendas` NEM `prometeu_reservas`. A venda exige
-- plano, comprador cadastrado e valor negociado (NOT NULL na 0112): uma reserva ainda não tem nada
-- disso — é "esta unidade está com este cliente por N dias". E a reserva do salão exige
-- `evento_id` e `credenciado_id`: fora do evento não existe. Relaxar qualquer uma das duas viraria
-- uma tabela que mente sobre o que guarda. A reserva do coordenador e a do salão passam a ser o
-- MESMO registro aqui; o salão continua gravando a sua em `prometeu_reservas` e um espelho entra
-- aqui (fase seguinte), para o mapa do coordenador pintar a reserva feita no evento.
--
-- ⚠️ A UNIDADE É A DE `hercules_unidades` DO PAI. As unidades moram no pai (o espelho); a reserva
-- aponta para essa linha, e o `empreendimento_id` é o PAI do cadastro (0123). A visão (filho) que
-- responde pela burocracia sai de `hercules_unidades.segmento_id` na hora da proposta.
--
-- ⚠️ UMA RESERVA VIVA POR UNIDADE, E A TRAVA É DO BANCO (índice parcial). No salão dezenas de
-- tablets abrem a mesma tela; no portal dois coordenadores podem clicar no mesmo lote. A segunda
-- gravação leva 23505 e a tela diz "já reservado por fulano" — nunca dois donos.

create table if not exists public.hercules_reservas (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       text not null default 'careli',
  empreendimento_id  uuid not null references public.hercules_empreendimentos (id) on delete restrict,
  unidade_id         uuid not null references public.hercules_unidades (id) on delete restrict,
  -- de onde veio: o coordenador (portal comercial), o salão (Prometeu) ou o corretor (portal).
  origem             text not null,
  -- só quando nasceu no salão; permite casar com `prometeu_reservas`.
  evento_id          uuid,
  prometeu_reserva_id uuid,
  -- quem vai comprar. O primeiro é o titular; os demais, cônjuge/sócios. Mesmo formato do salão:
  -- [{ nome, cpf, telefone, entity_id? }]. `entity_id` aponta para o cadastro do Apolo quando existe.
  proponentes        jsonb not null default '[]'::jsonb,
  imobiliaria_entity_id uuid,
  corretor_entity_id uuid,
  -- ativa → proposta (a venda em rascunho nasceu) → vendida (venda confirmada) | cancelada | expirada
  situacao           text not null default 'ativa',
  validade_em        timestamptz,
  venda_id           uuid references public.hercules_vendas (id) on delete set null,
  cancelada_em       timestamptz,
  cancelada_motivo   text,
  -- quem reservou: id da conta do portal (coordenador/corretor) ou do hub; e o nome, para a tela
  -- não precisar de outra ida ao banco.
  criado_por         text,
  criado_por_nome    text,
  observacao         text,
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now(),
  constraint hercules_reservas_origem check (origem in ('coordenador', 'salao', 'corretor', 'interno')),
  constraint hercules_reservas_situacao check (situacao in ('ativa', 'proposta', 'vendida', 'cancelada', 'expirada')),
  constraint hercules_reservas_salao_tem_evento check (origem <> 'salao' or evento_id is not null)
);

-- Uma reserva VIVA por unidade. Cancelada/expirada/vendida não travam.
create unique index if not exists hercules_reservas_uma_viva_por_unidade
  on public.hercules_reservas (unidade_id)
  where situacao in ('ativa', 'proposta');

create index if not exists hercules_reservas_por_empreendimento
  on public.hercules_reservas (workspace_id, empreendimento_id, situacao);

create index if not exists hercules_reservas_por_prometeu
  on public.hercules_reservas (prometeu_reserva_id)
  where prometeu_reserva_id is not null;

alter table public.hercules_reservas enable row level security;

comment on table public.hercules_reservas is
  'Reserva de unidade nascida no Panteon (coordenador, salão ou corretor). Uma viva por unidade. Vira proposta (hercules_vendas em rascunho) e depois venda.';
comment on column public.hercules_reservas.situacao is
  'ativa · proposta · vendida · cancelada · expirada. Só ativa e proposta travam a unidade.';
