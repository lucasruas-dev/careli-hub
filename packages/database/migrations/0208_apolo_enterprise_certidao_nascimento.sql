-- Apolo: CERTIDAO DE NASCIMENTO do cliente solteiro como exigencia configuravel por empreendimento.
--
-- Pedido do Lucas (02/10/2026): "vamos colocar no setup dos empreendimento a aba que habilita a
-- solicitacao de certidao de nascimento. caso a mesma esteja habilitada terá a sessão de solicitar
-- a certidão de nascimento para clientes solteiro" e, em seguida, "falo aba mas é igual o
-- comprovante de renda". Mesmo molde da 0095 (comprovante_renda_habilitado).
--
-- Sem esta coluna, o cliente solteiro nunca manda certidao nenhuma: a certidao de estado civil so
-- e pedida para casado, separado, divorciado e uniao estavel (2, 3, 4 e 6), e o empreendimento que
-- precisa da certidao de nascimento do solteiro tinha de pedir por fora da CAD.
--
-- ATENCAO 1: DEFAULT FALSE. Hoje nenhum empreendimento pede certidao de nascimento; TRUE viraria
-- uma exigencia nova aparecendo sozinha em todos eles, e a CAD de todo solteiro passaria a ser
-- recusada no dia da migration. Empreendimento existente nao muda de comportamento sem alguem
-- ligar a chave no Setup.
--
-- ATENCAO 2: SO SOLTEIRO (estado civil 1). Decisao do Lucas em 02/10/2026: viuvo segue mandando a
-- certidao de estado civil, como hoje. Imobiliaria, corretor autonomo e cadastro sem
-- empreendimento nao sao afetados.
--
-- Nao aplicar sem autorizacao expressa do Lucas (regra-mae: migration = operacao sensivel).

alter table public.apolo_enterprise_settings
  add column if not exists certidao_nascimento_habilitada boolean not null default false;

comment on column public.apolo_enterprise_settings.certidao_nascimento_habilitada is
  'Liga/desliga a exigencia da CERTIDAO DE NASCIMENTO do cliente SOLTEIRO (estado civil 1) no envio da CAD. FALSE = a CAD do solteiro segue sem esse documento. Os demais estados civis nao mudam.';
