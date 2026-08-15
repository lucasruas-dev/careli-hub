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
-- ✅ APLICADA EM PRODUCAO em 15/08/2026, com autorizacao do Lucas.
--
-- Conferido antes e depois: 9.190 mensagens 1:1 mudaram de canal, 641 tickets, 3.039 saidas
-- ganharam a coordenadora como autora (ficou ZERO sem autor), e as 4.857 de grupo seguiram
-- intactas. As 532 mensagens de grupo que TEM autor sao envios feitos pela Iris (Nivea 276,
-- Cinthia 250) e nao foram tocadas.

-- ── O CANAL DO ATENDIMENTO 1:1 ───────────────────────────────────────────────
-- `kind` e `provider` iguais aos do canal de grupo: quem filtra por provider='meta' (a
-- resolução de número da Meta) continua ignorando os dois, que é o comportamento correto.
insert into public.caredesk_channels
  (workspace_id, name, slug, kind, provider, phone_number, status, config, metadata)
select
  c.workspace_id,
  'Central de Relacionamento',
  'whatsapp-relacionamento',
  c.kind,
  c.provider,
  '553172506566',
  c.status,
  jsonb_build_object(
    'mode', 'direct',
    'readOnly', false,
    'evolutionInstance', 'caca-observadora',
    'defaultQueueSlug', 'relacionamento-direct',
    'jidSuffix', '@s.whatsapp.net',
    'cacaEnabled', false,
    'inbound_enabled', true,
    'outbound_enabled', true
  ),
  jsonb_build_object(
    'description', 'Atendimento 1:1 com corretor e imobiliaria pela Evolution API.',
    'origem', 'migration 0086'
  )
from public.caredesk_channels c
where c.slug = 'whatsapp-grupo'
  and not exists (select 1 from public.caredesk_channels x where x.slug = 'whatsapp-relacionamento');

-- ⚠️ O QUE E FUNCIONAL VIVE EM `config`, nao em `metadata`: e o padrao do canal do 4143
-- (`cacaEnabled`, `defaultQueueSlug`), e e de la que a tela e o processador leem.
-- `cacaEnabled` nasce FALSE de proposito: ligar a CACA nesta central e decisao a parte, e no
-- codigo de hoje ela so atende pelo caminho da Meta.
update public.caredesk_channels
   set phone_number = coalesce(phone_number, '553172506566'),
       config = coalesce(config, '{}'::jsonb) || jsonb_build_object('jidSuffix', '@g.us')
 where slug = 'whatsapp-grupo';

update public.caredesk_queues q
   set metadata = coalesce(q.metadata, '{}'::jsonb) || jsonb_build_object('channelId', c.id)
  from public.caredesk_channels c
 where c.slug = 'whatsapp-relacionamento'
   and q.slug = 'relacionamento-direct';

-- ── O ROTULO DA FILA ─────────────────────────────────────────────────────────
-- "Direct" e jargao de ferramenta; o negocio chama de Central de Relacionamento (Lucas, 15/08).
-- ⚠️ So o NOME muda. O slug `relacionamento-direct` fica: ele e' lido pelo processador, pela
-- resolucao de fila e pelo cockpit, e renomear slug para arrumar rotulo ja quebrou coisa antes
-- (a v1.38.0 mudou so os names pelo mesmo motivo).
update public.caredesk_queues
   set name = 'Central de Relacionamento'
 where slug = 'relacionamento-direct';

-- ── BACKFILL: as mensagens 1:1 que estão no canal errado ─────────────────────
-- Só as que pertencem a um TICKET (o Direct tem ticket; o grupo não tem, usa group_id).
-- É por isso que este recorte é seguro: mensagem de grupo tem group_id preenchido.
update public.caredesk_messages m
   set channel_id = (select id from public.caredesk_channels where slug = 'whatsapp-relacionamento')
 where m.channel_id = (select id from public.caredesk_channels where slug = 'whatsapp-grupo')
   and m.group_id is null
   and m.ticket_id is not null;

update public.caredesk_tickets t
   set channel_id = (select id from public.caredesk_channels where slug = 'whatsapp-relacionamento')
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
