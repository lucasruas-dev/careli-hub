-- 0145 — A COMISSÃO DA COORDENADORA E DA IMOBILIÁRIA VIRAM DADO DO PANTEON.
--
-- Lucas, 08/09/2026, olhando a aba Políticas comerciais com o contrato de corretagem em branco ao
-- lado: *"em janeiro vamos migrar o financeiro, ou seja até lá, vamos fazer um paliativo, nessa
-- tela coloca comissão para coordenadora e imobiliária, vou apontar e vc tira esse valor do valor
-- total vendido. mas isso é paliativo"*.
--
-- ⚠️ ISTO É PALIATIVO, E A PALAVRA É DELE. O rateio de verdade mora no C2X, em `split_enterprises`
-- → `split_enterprise_groups` → `split_enterprise_group_values`: quatro grupos (Ato, Sinal
-- Imobiliária, Sinal Corretor, Mensal), cada um fechando 100% entre perfis (Incorporador,
-- Coordenação, Gerente, Imobiliária, Captador, Gestora de recebíveis), com percentual OU valor
-- fixo, e opcionalmente amarrado a um parceiro. Esse modelo vem para o Panteon com a migração do
-- financeiro, em JANEIRO. Duas colunas não o substituem, e não devem tentar: o que elas resolvem é
-- o contrato de corretagem, que hoje sai com sete lacunas no papel.
--
-- ⚠️ POR QUE NÃO LER A COMISSÃO DO C2X. `commercial_policies.total_value_commission` existe e está
-- preenchida (Vale do Ouro 6,0% · Veredas do Ouro 6,5% · Recanto 7,0% · Vista Alegre 7,5%), mas ela
-- é a comissão TOTAL — não diz quanto vai para a coordenadora e quanto vai para os associados, que
-- é justamente o que o contrato precisa escrever em três linhas separadas. E RVP e Jardim das
-- Gerais não têm política cadastrada lá: sairiam em branco, sem que ninguém pudesse resolver do
-- lado de cá.
--
-- ⚠️ AS DUAS SÃO SOBRE O VALOR VENDIDO, e não sobre a comissão. É o que o Lucas definiu ("vc tira
-- esse valor do valor total vendido"), e é a mesma base de `total_value_commission`, o que permite
-- conferir a soma contra o número do legado. A comissão total do contrato passa a ser a SOMA das
-- duas — que é exatamente o que o texto do contrato afirma: o total "refere-se à intermediação",
-- uma parte "destinada ao pagamento da COORDENADORA DE VENDAS" e o resto "destinada aos ASSOCIADOS".
--
-- ⚠️ NULO NÃO É ZERO, pela mesma regra de `entrada_minima_percentual` (migration 0128). Nulo é
-- "não cadastrado", e aí o contrato deixa a lacuna à mostra para alguém preencher. ZERO é uma
-- decisão legítima (empreendimento em que aquela ponta não recebe) e precisa continuar
-- distinguível — um contrato que imprime R$ 0,00 de comissão foi decidido; um que imprime
-- [valor_total_comissao] foi esquecido.
--
-- ⚠️ E A COORDENADORA PRECISA DE NOME. Sem `coordenadora_entity_id` os percentuais saem calculados
-- e o bloco "a. COORDENADORA DE VENDAS" continua com cinco colchetes no papel (nome, CNPJ,
-- endereço, telefone, e-mail). O id aponta para `apolo_entities`, de onde já saem esses cinco
-- campos — é o mesmo caminho que o vínculo da imobiliária usa desde hoje de manhã.

alter table public.apolo_enterprise_settings
  add column if not exists comissao_coordenadora_percentual numeric(6, 3),
  add column if not exists comissao_imobiliaria_percentual numeric(6, 3),
  add column if not exists coordenadora_entity_id uuid;

-- Fora de 0..100 é digitação errada (1,5 e 15 são fáceis de trocar num campo de percentual), e o
-- contrato sairia com um número absurdo impresso. Barra aqui, além da validação da tela.
alter table public.apolo_enterprise_settings
  drop constraint if exists apolo_enterprise_settings_comissao_coordenadora_check;
alter table public.apolo_enterprise_settings
  add constraint apolo_enterprise_settings_comissao_coordenadora_check
  check (comissao_coordenadora_percentual is null
         or (comissao_coordenadora_percentual >= 0 and comissao_coordenadora_percentual <= 100));

alter table public.apolo_enterprise_settings
  drop constraint if exists apolo_enterprise_settings_comissao_imobiliaria_check;
alter table public.apolo_enterprise_settings
  add constraint apolo_enterprise_settings_comissao_imobiliaria_check
  check (comissao_imobiliaria_percentual is null
         or (comissao_imobiliaria_percentual >= 0 and comissao_imobiliaria_percentual <= 100));

-- ⚠️ SEM FOREIGN KEY, e de propósito: `apolo_entities` recebe merge e arquivamento, e uma FK
-- rígida transformaria uma limpeza de cadastro em erro de gravação numa tela que não tem nada a
-- ver com isso. Quem lê trata o id órfão como "coordenadora não cadastrada" — a mesma lacuna
-- visível de sempre, que é o comportamento certo aqui.
comment on column public.apolo_enterprise_settings.comissao_coordenadora_percentual is
  'Paliativo até a migração do financeiro (jan/2027): % sobre o valor VENDIDO destinada à coordenadora de vendas. Nulo = não cadastrado; zero = decidido.';
comment on column public.apolo_enterprise_settings.comissao_imobiliaria_percentual is
  'Paliativo até a migração do financeiro (jan/2027): % sobre o valor VENDIDO destinada aos associados (imobiliária/corretor). Nulo = não cadastrado; zero = decidido.';
comment on column public.apolo_enterprise_settings.coordenadora_entity_id is
  'Entidade (apolo_entities) da coordenadora de vendas do empreendimento: de onde saem nome, CNPJ, endereço, telefone e e-mail no contrato de corretagem.';
