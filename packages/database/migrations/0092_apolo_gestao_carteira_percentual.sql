-- 0092 · A % DE GESTÃO DE CARTEIRA POR EMPREENDIMENTO
--
-- É a primeira peça da política comercial que NASCE NO APOLO. Decisão do Lucas (17/08/2026):
-- "toda parte financeira, enquanto não migramos tudo para o Apolo, o C2X tem prioridade. O que vai
-- nascer já no Apolo é a % da gestão de carteira."
--
-- PARA QUE SERVE: é o percentual que fica com o INCORPORADOR nas parcelas do financiamento, e é o
-- que permite mostrar o valor LÍQUIDO na carteira do portal dele. Hoje o Apolo mostra só o bruto:
-- o incorporador vê R$ 7,1 mi de carteira total quando o que chega para ele é outro número.
--
-- POR QUE AQUI E NÃO EM TABELA NOVA: `apolo_enterprise_settings` já é a configuração POR
-- EMPREENDIMENTO (limite_credito, valor_pix, prevenda_habilitada, masterplan_url), com a chave
-- certa. Uma tabela só para um percentual seria um join a mais sem ganho.
--
-- ⚠️ UMA LINHA POR EMPREENDIMENTO, e não por incorporador: "a % de gestão de carteira é acordada
-- para o empreendimento; se aquele incorporador tiver mais de um empreendimento com a gente, esses
-- podem ter % diferentes" (Lucas, 17/08).
--
-- ⚠️ NASCE NULO DE PROPÓSITO. Nulo significa "não cadastrado", e a tela mostra isso em vez de
-- calcular com um palpite: um líquido errado numa tela que o incorporador usa para conferir
-- repasse é pior que um campo em branco. Um DEFAULT de 97% pareceria cadastrado e cobriria
-- silenciosamente Garden e Jardim das Gerais, que hoje não têm política nenhuma nem no C2X.
--
-- Percentual do INCORPORADOR (não o da Careli): 97,00 no Recanto, 97,50 no Vista Alegre, 96,00 na
-- Lavra do Ouro. Guardado como número de 0 a 100, do jeito que o Lucas fala e que a tela do C2X
-- mostra.

alter table public.apolo_enterprise_settings
  add column if not exists gestao_carteira_percentual numeric(6, 3);

comment on column public.apolo_enterprise_settings.gestao_carteira_percentual is
  'Percentual das parcelas do financiamento que fica com o INCORPORADOR (0 a 100). Nasce no Apolo; '
  'define o valor liquido da carteira dele. Nulo = nao cadastrado (a tela avisa em vez de calcular).';

-- Sanidade: percentual fora de 0..100 é erro de digitação, e passaria batido numa coluna numérica.
alter table public.apolo_enterprise_settings
  drop constraint if exists apolo_enterprise_settings_gestao_carteira_check;

alter table public.apolo_enterprise_settings
  add constraint apolo_enterprise_settings_gestao_carteira_check
  check (
    gestao_carteira_percentual is null
    or (gestao_carteira_percentual >= 0 and gestao_carteira_percentual <= 100)
  );
