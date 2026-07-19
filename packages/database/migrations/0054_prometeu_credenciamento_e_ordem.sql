-- Prometeu, 2a rodada: o processo real do credenciamento (Lucas 19/jul).
--
-- 1) O evento vira o container de TUDO (fila, telao, etiqueta): ganha config e o carimbo de
--    quando o evento real comecou.
-- 2) O check-in passa a existir de verdade: `entrou_em` fica VAZIO ate a pessoa ser bipada.
--    Vazio = habilitado, ainda nao chegou. Preenchido = esta no salao.
-- 3) A ordem da fila deixa de ser um numero recalculado e vira uma CHAVE de ordenacao, porque
--    o admin pode furar a fila (colocar alguem em 1o ignorando o PIX) e o ajuste nao pode ser
--    destruido pelo proximo pagamento que entrar.
-- 4) Janelas de credenciamento POR DIA: o sistema precisa saber se, no instante do bip, estava
--    ou nao dentro do periodo — e isso define como a fila da recepcao ordena.
--
-- AS DUAS REGRAS DA FILA DA RECEPCAO (dia do evento):
--   - bipado DENTRO da janela  -> ordena pela fila do evento (ordem do PIX / ajuste do admin);
--     a fila REORDENA a cada bip, entao quem chega depois pode assumir a frente.
--   - bipado DEPOIS da janela  -> ordem de chegada pura, sempre atras de todo o primeiro grupo.
-- Por isso `credenciado_na_janela` e gravado NO MOMENTO DO BIP: editar a janela depois nao
-- reescreve a fila que ja aconteceu.
--
-- Aplicada com OK explicito do Lucas ("pode subir").

-- ------------------------------------------------------------------ evento
alter table public.prometeu_eventos
  -- construtora, local, metas de tempo, toggle do WhatsApp: o que o Setup preenche e ainda
  -- nao merece coluna propria.
  add column if not exists config jsonb not null default '{}'::jsonb,
  -- Carimbo do "Iniciar evento real". Serve de trava: o reset dos testes so roda uma vez.
  add column if not exists iniciado_em timestamptz;

-- ------------------------------------------------------------- credenciado
alter table public.prometeu_credenciados
  -- Gravado no bip: estava dentro da janela de credenciamento daquele dia?
  add column if not exists credenciado_na_janela boolean,
  -- CHAVE de ordenacao da fila do evento (nao e a posicao 1,2,3 — essa e calculada na leitura).
  -- Ao pagar: epoch do pago_em, o que reproduz a ordem de pagamento sem recalcular ninguem.
  -- Ao arrastar: um valor entre os vizinhos, entao so o arrastado muda. Numeric pra caber
  -- infinitas insercoes no meio.
  add column if not exists ordem_fila numeric,
  -- Furar fila e decisao sensivel: fica registrado quem fez, quando e por que.
  add column if not exists ordem_ajustada_por uuid,
  add column if not exists ordem_ajustada_em timestamptz,
  add column if not exists ordem_motivo text;

-- Check-in de verdade: ninguem "entrou" no evento so por estar cadastrado.
alter table public.prometeu_credenciados
  alter column entrou_em drop default,
  alter column entrou_em drop not null;

-- `posicao` era o numero recalculado em massa a cada PIX. Some: a posicao agora e derivada de
-- `ordem_fila` na leitura, e uma so fonte de verdade evita os dois numeros divergirem.
-- Seguro: a tabela esta vazia (0 credenciados) neste momento.
alter table public.prometeu_credenciados
  drop column if exists posicao;

-- Backfill defensivo: se algum registro tiver entrado entre a 0053 e esta migration, ele nasce
-- com a chave de ordenacao coerente com o pagamento.
update public.prometeu_credenciados
   set ordem_fila = extract(epoch from pago_em)
 where pago_em is not null and ordem_fila is null;

-- O indice da fila passa a seguir a chave nova.
drop index if exists public.prometeu_credenciados_fila_idx;
create index if not exists prometeu_credenciados_ordem_idx
  on public.prometeu_credenciados (evento_id, ordem_fila nulls last);
-- Fila da recepcao: quem ja fez check-in, na ordem dos dois regimes.
create index if not exists prometeu_credenciados_recepcao_idx
  on public.prometeu_credenciados (evento_id, credenciado_na_janela, entrou_em)
  where entrou_em is not null;

-- ------------------------------------------------------- janelas por dia
-- "No tal dia sera nessa hora, no tal dia sera nessa hora" (Lucas): uma linha por dia de
-- credenciamento. E o que diz, no instante do bip, se estamos dentro do periodo.
create table if not exists public.prometeu_janelas_credenciamento (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references public.prometeu_eventos (id) on delete cascade,
  data date not null,
  hora_inicio time not null,
  hora_fim time not null,
  created_at timestamptz not null default now()
);

create unique index if not exists prometeu_janelas_uk
  on public.prometeu_janelas_credenciamento (evento_id, data);

alter table public.prometeu_janelas_credenciamento enable row level security;

drop policy if exists prometeu_janelas_read on public.prometeu_janelas_credenciamento;
create policy prometeu_janelas_read
  on public.prometeu_janelas_credenciamento for select to authenticated using (true);
