-- 0175 — O REGISTRO DE CADA ENVIO DO RELATÓRIO DIÁRIO DE ATENDIMENTO.
--
-- Pedido do Lucas (17/09/2026), ao mandar construir o cron das 18h30: *"registrar cada execução em
-- algum lugar, para dar para conferir se saiu"*.
--
-- ⚠️ POR QUE UMA TABELA, E NÃO `apolo_disparos`. Aquela tabela é o registro de mensagem enviada a
-- uma PESSOA: exige `entity_id` de ficha do Apolo, e este relatório não fala de ninguém em
-- particular. Gravar lá com entidade inventada estragaria o histórico de quem recebeu o quê.
--
-- ⚠️ E POR QUE NÃO `hub_it_tickets`: chamado é coisa que alguém resolve. Execução de cron é log;
-- misturar os dois enche a fila do suporte de linha que ninguém vai atender.
--
-- ⚠️ A FALHA TAMBÉM É LINHA. O caso que motivou isto: em 26/07/2026 o refresh token do Gmail
-- expirou e 25 imobiliárias ficaram sem receber, em silêncio. Aqui a falha grava `status='falhou'`
-- com o motivo, e o cron ainda publica um alerta no hub — quem procura "o relatório não chegou"
-- encontra a resposta em vez de uma tabela vazia.

create table if not exists public.iris_relatorio_execucoes (
  id uuid primary key default gen_random_uuid(),
  -- O dia APURADO (não o de execução): é por ele que se procura "o relatório de terça".
  dia date not null,
  janela_inicio timestamptz not null,
  janela_fim timestamptz not null,
  -- enviado · falhou · sem_dados (dia sem movimento, e-mail não sai)
  status text not null,
  destinatarios text[] not null default '{}',
  -- O id da mensagem no Gmail, para achar o e-mail exato quando alguém disser que não recebeu.
  gmail_message_id text,
  erro text,
  -- Os números do dia, do jeito que foram publicados: o relatório é reconstituível sem refazer a
  -- apuração (e sem depender de o dado de origem não ter mudado).
  resumo jsonb not null default '{}'::jsonb,
  -- Quem disparou: 'cron' ou 'manual'.
  origem text not null default 'cron',
  criado_em timestamptz not null default now()
);

create index if not exists iris_relatorio_execucoes_dia_idx
  on public.iris_relatorio_execucoes (dia desc, criado_em desc);

-- RLS ligada e sem policy: a tabela é de serviço. Quem escreve é a rota do cron, com a chave de
-- serviço, que passa por cima da RLS. Sem isto, a tabela nasce legível pela chave pública.
alter table public.iris_relatorio_execucoes enable row level security;

comment on table public.iris_relatorio_execucoes is
  'Uma linha por execução do relatório diário de atendimento (cron das 18h30 e disparos manuais).';
