-- Apolo: LIMITE DE CRÉDITO por empreendimento.
--
-- Cada empreendimento passa a ter o seu limite (valor em R$ das restrições do Serasa acima do
-- qual o cliente é REPROVADO na análise de crédito). Antes o limite era fixo em R$ 1.000 no
-- código (o do Vale do Ouro); agora é decisão comercial POR empreendimento, editável na aba
-- Cadastro do empreendimento, ao lado do flag de credenciamento.
--
-- Coluna nullable de propósito: NULL = usa o padrão da aplicação (R$ 1.000). Fica na mesma
-- tabela de settings do empreendimento (chaveada pelo id do C2X), junto de `credenciamento_ativo`.
--
-- Nao aplicar sem autorizacao expressa do Lucas (regra-mae: migration = operacao sensivel).

alter table public.apolo_enterprise_settings
  add column if not exists limite_credito numeric;

comment on column public.apolo_enterprise_settings.limite_credito is
  'Limite em R$ das restricoes do Serasa acima do qual o cliente e REPROVADO. NULL = padrao R$ 1.000.';
