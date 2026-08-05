-- Apolo: o FLUXO da esteira vira CONFIGURÁVEL por empreendimento.
--
-- Decisao do Lucas (25/07): cada empreendimento liga/desliga as etapas de Analise de Credito e
-- Pre-venda(PIX). O caso de uso: chega a quinta, ele ENCERRA os PIX (fila ja montada) mas
-- continua cadastrando — dai o credito aprovado vai DIRETO pra credenciado, sem gerar PIX.
--
-- Default TRUE nas duas: preserva o comportamento de hoje para os empreendimentos existentes
-- (analise + pre-venda ligadas). O master "recebendo CAD" ja e' `credenciamento_ativo`.
--
-- Autorizado pelo Lucas ("pode seguir, tem o meu ok"). Regra-mae: migration = operacao sensivel.

alter table public.apolo_enterprise_settings
  add column if not exists analise_credito_habilitada boolean not null default true,
  add column if not exists prevenda_habilitada boolean not null default true;

comment on column public.apolo_enterprise_settings.analise_credito_habilitada is
  'Liga/desliga a etapa de Analise de Credito. Desligada = pula o credito (nao consulta Serasa).';
comment on column public.apolo_enterprise_settings.prevenda_habilitada is
  'Liga/desliga a Pre-venda (PIX). Desligada = credito aprovado vai direto pra credenciado, sem PIX.';
