-- Renomeia o rótulo visível de "Grupos"/"Grupo" para "Relacionamento" na Iris
-- (decisão do Lucas). Só os NOMES exibidos mudam — os slugs internos
-- (grupos-whatsapp / whatsapp-grupo), source_entity_type e isGroup ficam iguais,
-- pra não quebrar o modelo de dados nem as resoluções de canal.

update public.caredesk_queues
  set name = 'Relacionamento', updated_at = now()
  where slug = 'grupos-whatsapp';

update public.caredesk_channels
  set name = 'WhatsApp - Relacionamento', updated_at = now()
  where slug = 'whatsapp-grupo';
