-- Apolo: VALOR DO PIX de credenciamento por empreendimento.
--
-- Cada empreendimento passa a ter o valor do seu PIX de pré-venda (o que o cliente paga para
-- concluir o cadastro). Antes era fixo em R$ 1.000 no código (o do Vale do Ouro); com mais de um
-- empreendimento ativo, cada um pode ter o seu, e o botão "Gerar PIX" da ficha usa o valor certo
-- pelo empreendimento da ficha.
--
-- Coluna nullable de propósito: NULL = usa o padrão da aplicação (R$ 1.000). Fica na mesma tabela
-- de settings do empreendimento (chaveada pelo id do C2X), junto de `credenciamento_ativo` e
-- `limite_credito`.
--
-- Nao aplicar sem autorizacao expressa do Lucas (regra-mae: migration = operacao sensivel).

alter table public.apolo_enterprise_settings
  add column if not exists valor_pix numeric;

comment on column public.apolo_enterprise_settings.valor_pix is
  'Valor em R$ do PIX de credenciamento (pre-venda) deste empreendimento. NULL = padrao R$ 1.000.';
