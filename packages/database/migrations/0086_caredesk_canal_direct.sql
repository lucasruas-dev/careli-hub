-- IRIS: separa o atendimento 1:1 (Direct) do monitoramento de grupos.
--
-- Decisão do Lucas (15/08/2026): "vamos separar sistemicamente". São duas operações diferentes
-- que hoje dividem o MESMO canal `whatsapp-grupo` por acidente histórico:
--
--   GRUPO  = monitoramento, sem ticket, três pessoas respondendo (Nivea, Cinthia, Raiane)
--   DIRECT = atendimento 1:1 com corretor e imobiliária, com SLA, e uma única responsável
--            (Raiane, a coordenadora, que é quem responde inclusive pelo celular)
--
-- Medido antes de decidir: 9.185 mensagens do Direct estavam gravadas no canal do grupo, que
-- não tem número nem fila. Por isso a fila Direct herdava o 4143 na hora de abrir atendimento,
-- e 3.247 saídas ficaram sem autor.
--
-- ⚠️ MESMO NÚMERO, canal separado. A instância Evolution continua sendo a `caca-observadora`
-- (31 97250-6566). Separar em dois números custa fora do sistema: readicionar o número em 17+
-- grupos, ou avisar todos os corretores. Fica para depois, se a operação pedir — e aí é só
-- trocar a config deste canal.
--
-- ⚠️ Não aplicar sem autorização expressa do Lucas (regra-mãe: migration = operação sensível).

-- ── O CANAL DO ATENDIMENTO 1:1 ───────────────────────────────────────────────
-- `kind` e `provider` iguais aos do canal de grupo: quem filtra por provider='meta' (a
-- resolução de número da Meta) continua ignorando os dois, que é o comportamento correto.
insert into public.caredesk_channels (name, slug, kind, provider, is_active, metadata)
select
  'Relacionamento · Direct',
  'whatsapp-direct',
  c.kind,
  c.provider,
  true,
  jsonb_build_object(
    'evolutionInstance', 'caca-observadora',
    'phone', '553172506566',
    'origem', 'migration 0086',
    -- O processador lê isto em vez das constantes que estavam no código.
    'jidSuffix', '@s.whatsapp.net'
  )
from public.caredesk_channels c
where c.slug = 'whatsapp-grupo'
  and not exists (select 1 from public.caredesk_channels x where x.slug = 'whatsapp-direct');

-- Carimba a instância no canal de grupo também, para o processador parar de depender de
-- constante nos DOIS caminhos.
update public.caredesk_channels
   set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
         'evolutionInstance', 'caca-observadora',
         'phone', '553172506566',
         'jidSuffix', '@g.us')
 where slug = 'whatsapp-grupo';

-- ── A FILA DIRECT PASSA A APONTAR PARA O CANAL NOVO ──────────────────────────
-- Sem isto, abrir atendimento na fila Direct continua caindo no 4143.
update public.caredesk_queues q
   set metadata = coalesce(q.metadata, '{}'::jsonb) || jsonb_build_object('channelId', c.id)
  from public.caredesk_channels c
 where c.slug = 'whatsapp-direct'
   and q.slug = 'relacionamento-direct';

-- ── BACKFILL: as mensagens 1:1 que estão no canal errado ─────────────────────
-- Só as que pertencem a um TICKET (o Direct tem ticket; o grupo não tem, usa group_id).
-- É por isso que este recorte é seguro: mensagem de grupo tem group_id preenchido.
update public.caredesk_messages m
   set channel_id = (select id from public.caredesk_channels where slug = 'whatsapp-direct')
 where m.channel_id = (select id from public.caredesk_channels where slug = 'whatsapp-grupo')
   and m.group_id is null
   and m.ticket_id is not null;

update public.caredesk_tickets t
   set channel_id = (select id from public.caredesk_channels where slug = 'whatsapp-direct')
  from public.caredesk_queues q
 where q.id = t.queue_id
   and q.slug = 'relacionamento-direct'
   and t.channel_id = (select id from public.caredesk_channels where slug = 'whatsapp-grupo');

-- ── BACKFILL DE AUTORIA (só o Direct) ────────────────────────────────────────
-- As saídas sem autor do Direct são da Raiane: ela é a única que responde aquele 1:1 pelo
-- celular (confirmado pelo Lucas em 15/08). No GRUPO isso não vale — lá respondem três
-- pessoas — e por isso o recorte é pela fila que TEM dono padrão, sem regra especial.
update public.caredesk_messages m
   set sender_user_id = (q.metadata->>'defaultAssigneeUserId')::uuid
  from public.caredesk_tickets t
  join public.caredesk_queues q on q.id = t.queue_id
 where m.ticket_id = t.id
   and m.direction = 'outbound'
   and m.sender_user_id is null
   and m.group_id is null
   and q.slug = 'relacionamento-direct'
   and q.metadata->>'defaultAssigneeUserId' is not null;

comment on column public.caredesk_channels.metadata is
  'Config do canal. Para os canais Evolution guarda evolutionInstance, phone e jidSuffix — o processador lê daqui em vez de constantes no codigo (0086).';
