-- "Relacionamento" sobe de nível: era o nome da FILA, agora é o CANAL (o número
-- 6566). Sob ele, duas filas: "Grupo" (o que já temos: sem ticket, GRP-xxxx) e
-- "Direct" (as conversas 1:1 do 6566, com ticket/SLA/encerramento, MAS sem
-- template e sem janela de 24h, porque é Evolution e não Meta).
--
-- Slugs internos NÃO mudam (grupos-whatsapp/whatsapp-grupo) — só rótulos e a
-- nova fila.

begin;

-- Canal passa a se chamar só "Relacionamento" (representa o número 6566).
update public.caredesk_channels
  set name = 'Relacionamento', updated_at = now()
  where slug = 'whatsapp-grupo';

-- A fila de grupos volta a se chamar "Grupo" (Relacionamento agora é o canal).
update public.caredesk_queues
  set name = 'Grupo', updated_at = now()
  where slug = 'grupos-whatsapp';

-- Nova fila "Direct": atendimento 1:1 do 6566 (formato normal de ticket).
insert into public.caredesk_queues (
  name, slug, description, color, status, default_priority,
  sla_first_response_minutes, sla_resolution_minutes,
  routing_strategy, assignment_strategy
)
values (
  'Direct',
  'relacionamento-direct',
  'Conversas 1:1 do número de Relacionamento (6566), via Evolution — sem janela de 24h nem template.',
  '#0E7490',
  'active',
  'medium',
  60,
  480,
  'manual',
  'manual'
)
on conflict (slug) do nothing;

commit;
