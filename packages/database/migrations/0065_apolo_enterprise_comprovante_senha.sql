-- Apolo: SENHA do empreendimento para liberar os DETALHES do comprovante de crédito.
--
-- A página pública /publico/verificar confirma a AUTENTICIDADE do comprovante para qualquer um
-- com o link do QR (documento autêntico, data, protocolo). Mas os DADOS DE CRÉDITO (score,
-- veredito, restrições) só aparecem para quem digitar a SENHA do empreendimento — decisão do
-- Lucas (21/jul): "podemos criar uma senha dentro do empreendimento que permite visualizar esses
-- dados; somente com essa senha pode abrir mais detalhes".
--
-- Guardada como HASH (nunca em texto puro): scrypt com salt, no formato "scrypt$<salt_hex>$<hash_hex>".
-- NULL = empreendimento sem senha definida (então os detalhes ficam indisponíveis na verificação
-- pública até alguém definir a senha na tela do Empreendimento).
--
-- Mesma tabela de settings do empreendimento (chaveada pelo id do C2X), ao lado de
-- `credenciamento_ativo` e `limite_credito`.
--
-- Nao aplicar sem autorizacao expressa do Lucas (regra-mae: migration = operacao sensivel).

alter table public.apolo_enterprise_settings
  add column if not exists comprovante_senha_hash text;

comment on column public.apolo_enterprise_settings.comprovante_senha_hash is
  'Hash scrypt (scrypt$salt$hash) da senha que libera os detalhes do comprovante na verificacao publica. NULL = sem senha.';
