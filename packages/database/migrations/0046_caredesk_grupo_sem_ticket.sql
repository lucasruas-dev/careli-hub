-- Grupo NAO e atendimento: sai da arquitetura de ticket (sem encerramento, sem SLA).
-- O GRUPO passa a ser a entidade-ancora (id + codigo GRP-xxxx). Mensagem passa a
-- pertencer a um TICKET ou a um GRUPO. Atividades/demandas detectadas no grupo
-- viram ticket proprio, vinculado ao grupo (fase CACA).

begin;

-- 1) Codigo legivel do grupo: a "matricula" usada para vincular atividades.
create sequence if not exists public.caredesk_whatsapp_group_code_seq;

alter table public.caredesk_whatsapp_groups
  add column if not exists code text;

update public.caredesk_whatsapp_groups
set code = 'GRP-' || lpad(
  nextval('public.caredesk_whatsapp_group_code_seq')::text, 4, '0'
)
where code is null;

alter table public.caredesk_whatsapp_groups
  alter column code set default (
    'GRP-' || lpad(
      nextval('public.caredesk_whatsapp_group_code_seq')::text, 4, '0'
    )
  );

alter table public.caredesk_whatsapp_groups
  add constraint caredesk_whatsapp_groups_code_key unique (code);

-- 2) Mensagem pode pertencer a um ticket OU a um grupo.
alter table public.caredesk_messages
  alter column ticket_id drop not null;

alter table public.caredesk_messages
  add column if not exists group_id uuid
  references public.caredesk_whatsapp_groups(id) on delete cascade;

create index if not exists caredesk_messages_group_idx
  on public.caredesk_messages (group_id);

-- 3) Move as mensagens do ticket-de-grupo para o grupo ANTES de apagar o ticket
--    (o FK ticket_id e ON DELETE CASCADE — apagar antes levaria as mensagens).
update public.caredesk_messages m
set group_id = g.id,
    ticket_id = null
from public.caredesk_whatsapp_groups g
where g.ticket_id is not null
  and m.ticket_id = g.ticket_id;

-- 4) Apaga os tickets de grupo e os contatos sinteticos (o grupo se basta).
--    messages.sender_contact_id e ON DELETE SET NULL — nao perde mensagem.
delete from public.caredesk_ticket_events e
using public.caredesk_whatsapp_groups g
where e.ticket_id = g.ticket_id;

delete from public.caredesk_tickets t
using public.caredesk_whatsapp_groups g
where t.id = g.ticket_id;

delete from public.caredesk_contacts c
using public.caredesk_whatsapp_groups g
where c.id = g.contact_id;

alter table public.caredesk_whatsapp_groups drop column if exists ticket_id;
alter table public.caredesk_whatsapp_groups drop column if exists contact_id;

-- 5) Toda mensagem precisa de um dono: ticket OU grupo.
alter table public.caredesk_messages
  add constraint caredesk_messages_owner_check
  check (ticket_id is not null or group_id is not null);

commit;
