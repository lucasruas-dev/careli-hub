-- Apolo: COMPROVANTE DE RENDA como etapa configuravel por empreendimento.
--
-- Pedido do Lucas (18/08/2026): "vamos criar uma nova etapa, COMPROVANTE DE RENDA, colocar essa
-- etapa no Setup. Quando estiver ativa vira uma obrigatoriedade na hora de subir a CAD: ou seja,
-- alem dos documentos que sao necessarios, caso essa etapa esteja ativa, vamos solicitar o
-- comprovante de renda. Pode ser o extrato bancario dos ultimos 3 meses, contracheque ou
-- declaracao do imposto de renda."
--
-- ⚠️ DEFAULT FALSE, AO CONTRARIO DAS OUTRAS DUAS ETAPAS. `analise_credito_habilitada` e
-- `prevenda_habilitada` nasceram TRUE (0071) porque ja era o comportamento de producao e o
-- default preservava o que existia. Aqui e o inverso: hoje NENHUM empreendimento pede comprovante
-- de renda, entao TRUE viraria uma exigencia nova aparecendo sozinha em todos eles e a CAD
-- passaria a ser recusada em massa no dia da migration. Empreendimento existente nao pode mudar
-- de comportamento sem alguem ligar a chave no Setup.
--
-- Mesma tabela de settings do empreendimento (chaveada pelo id do C2X), ao lado de
-- `credenciamento_ativo`, `analise_credito_habilitada` e `prevenda_habilitada`.
--
-- Nao aplicar sem autorizacao expressa do Lucas (regra-mae: migration = operacao sensivel).

alter table public.apolo_enterprise_settings
  add column if not exists comprovante_renda_habilitado boolean not null default false;

comment on column public.apolo_enterprise_settings.comprovante_renda_habilitado is
  'Liga/desliga a exigencia do COMPROVANTE DE RENDA no envio da CAD (extrato bancario dos ultimos 3 meses, contracheque ou declaracao de imposto de renda -- um dos tres). FALSE = a CAD segue sem esse documento.';
