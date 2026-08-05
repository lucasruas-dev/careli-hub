-- 0076: a MESA passa a registrar QUEM está atendendo nela (o operador que sentou), para o Mapa do
-- salão da Central mostrar o nome. Hoje a escolha da mesa vive só no localStorage do atendente, e
-- o mapa não tem como saber quem está onde — por isso aparecia "sem atendente".
--
-- `atendente_nome` (texto) em vez de um id: quem atende é OPERADOR do evento (login próprio, não
-- usuário do hub) OU um admin testando; guardar o nome direto resolve os dois sem join. A coluna
-- `atendente_user_id` (uuid) já existe mas não serve para o operador, que não é usuário do hub.

alter table public.prometeu_mesas add column if not exists atendente_nome text;
