-- Iris: MURAL DE AVISOS OPERACIONAIS que a CACA le' antes de responder.
--
-- O PROBLEMA (auditoria de 26/jul): em julho a emissao dos boletos atrasou por causa da correcao
-- do IPCA. A CACA nao sabia disso — ela achava a parcela, nao achava o link e transferia. A
-- operadora entao respondia com um texto padrao explicando o atraso, o MESMO texto, 216 vezes.
-- Era informacao de custo zero que a CACA poderia ter dado, encerrando o atendimento sozinha.
-- Foram 391 pedidos de boleto no periodo e apenas 71 sairam com o link na mao do cliente.
--
-- A ideia: um lugar onde o TIME escreve "o que esta' acontecendo agora" e a CACA passa a saber,
-- SEM deploy e sem mexer na persona. Serve pro atraso de emissao, pra obra parada de um
-- empreendimento, pra manutencao de sistema, pra mudanca de horario.
--
-- `vale_ate` e' o campo mais importante da tabela. A persona da CACA tem hoje um bloco marcado
-- como "TEMPORARIO" com fatos datados escritos a mao que APODRECERAM (chegou a contradizer o
-- proprio codigo sobre o envio do PIX). Aviso operacional tem prazo por natureza: com data de
-- validade ele morre sozinho, em vez de virar mentira que alguem precisa lembrar de apagar.
--
-- Autorizado pelo Lucas em 26/jul. Regra-mae: migration = operacao sensivel.

create table if not exists public.iris_avisos_operacionais (
  id uuid primary key default gen_random_uuid(),
  -- Titulo curto, so' pra identificar na tela (ex.: "Boletos de julho").
  titulo text not null,
  -- O QUE A CACA DEVE SABER/DIZER. Escrito em linguagem de atendimento, porque vai direto pro
  -- contexto dela (ex.: "A emissao das parcelas de julho atrasou por causa da correcao do IPCA.
  -- Assim que sair, o boleto e' enviado automaticamente por e-mail, SMS e WhatsApp.").
  texto text not null,
  -- Quando o aviso so' vale pra um assunto (ex.: 'boleto', 'obra', 'lancamento'). Nulo = a CACA
  -- considera em qualquer atendimento.
  assunto text,
  ativo boolean not null default true,
  -- Data em que o aviso deixa de ser verdade. Nulo = sem prazo (use com parcimonia).
  vale_ate timestamptz,
  criado_por uuid references public.hub_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A leitura da CACA e' sempre "avisos ativos e dentro do prazo".
create index if not exists iris_avisos_operacionais_vigentes_idx
  on public.iris_avisos_operacionais (ativo, vale_ate);

comment on table public.iris_avisos_operacionais is
  'Avisos operacionais vigentes que a CACA le antes de responder (atraso de emissao, obra, manutencao). Editavel pelo time sem deploy.';
comment on column public.iris_avisos_operacionais.vale_ate is
  'Data em que o aviso deixa de valer. Evita que contexto datado apodreca dentro do cerebro da CACA.';
