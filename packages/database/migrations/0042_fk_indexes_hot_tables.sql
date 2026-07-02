-- 0042 — Índices de FK nas tabelas quentes (P1 do diagnóstico de 2/jul/2026)
--
-- Os advisors de performance do Supabase apontaram 141 FKs sem índice. Este
-- lote cobre SÓ o caminho quente, de propósito:
--   • caredesk_* (Iris): fila + inbound do webhook a cada mensagem;
--   • c2x_payments / c2x_guardian_* (cobrança): tabela mais volumosa + fila;
--   • apolo_*: dedup por documento na leitura;
--   • hub_notifications / pulsex / chronos / agenda: telas ao vivo e crons.
--
-- Ficaram FORA (decisão, não esquecimento):
--   • FKs `sync_run_id` — só serviriam a DELETE em *_sync_runs (raro) e
--     custariam escrita em todo upsert do sync de 5min;
--   • FKs de auditoria (`*_by_user_id`) sem filtro de tela — custo de escrita
--     sem leitura que o justifique (exceção: hub_agenda_items.created_by,
--     que É o filtro do "Meu dia").
--
-- Tabelas são pequenas/médias (sem necessidade de CONCURRENTLY); `if not
-- exists` torna a aplicação idempotente.
--
-- ⚠️ Aplicar em prod SÓ com OK explícito do Lucas (regra-mãe do CLAUDE.md).

begin;

-- Iris (caredesk) -------------------------------------------------------------

create index if not exists caredesk_messages_channel_idx
  on public.caredesk_messages (channel_id);
create index if not exists caredesk_messages_sender_contact_idx
  on public.caredesk_messages (sender_contact_id);
create index if not exists caredesk_messages_sender_user_idx
  on public.caredesk_messages (sender_user_id);

create index if not exists caredesk_tickets_channel_idx
  on public.caredesk_tickets (channel_id);
create index if not exists caredesk_tickets_workspace_idx
  on public.caredesk_tickets (workspace_id);
create index if not exists caredesk_tickets_profile_idx
  on public.caredesk_tickets (profile_id);

create index if not exists caredesk_ticket_participants_ticket_idx
  on public.caredesk_ticket_participants (ticket_id);
create index if not exists caredesk_ticket_participants_contact_idx
  on public.caredesk_ticket_participants (contact_id);
create index if not exists caredesk_ticket_participants_user_idx
  on public.caredesk_ticket_participants (user_id);

create index if not exists caredesk_message_attachments_message_idx
  on public.caredesk_message_attachments (message_id);

create index if not exists caredesk_whatsapp_message_refs_message_idx
  on public.caredesk_whatsapp_message_refs (message_id);
create index if not exists caredesk_whatsapp_message_refs_channel_idx
  on public.caredesk_whatsapp_message_refs (channel_id);

create index if not exists caredesk_meta_webhook_events_channel_idx
  on public.caredesk_meta_webhook_events (channel_id);

-- FK simples em c2x_user_id: o índice composto (workspace_id, c2x_user_id)
-- da 0011 não cobre lookup por c2x_user_id sozinho (coluna não-líder).
create index if not exists caredesk_contacts_c2x_user_idx
  on public.caredesk_contacts (c2x_user_id)
  where c2x_user_id is not null;

create index if not exists caredesk_broadcast_recipients_message_idx
  on public.caredesk_broadcast_recipients (message_id);
create index if not exists caredesk_broadcast_recipients_ticket_idx
  on public.caredesk_broadcast_recipients (ticket_id);
create index if not exists caredesk_broadcast_recipients_contact_idx
  on public.caredesk_broadcast_recipients (contact_id);

create index if not exists caredesk_ai_suggestions_contact_idx
  on public.caredesk_ai_suggestions (contact_id);

-- Cobrança (Hades / espelho C2X) ----------------------------------------------

create index if not exists c2x_payments_payment_status_idx
  on public.c2x_payments (payment_status_c2x_id);
create index if not exists c2x_payments_parcel_type_idx
  on public.c2x_payments (parcel_type_c2x_id);
create index if not exists c2x_payments_enterprise_unit_idx
  on public.c2x_payments (enterprise_unit_c2x_id);

create index if not exists c2x_guardian_attendance_installments_acq_request_idx
  on public.c2x_guardian_attendance_installments (acquisition_request_c2x_id);
create index if not exists c2x_guardian_attendance_installments_payment_idx
  on public.c2x_guardian_attendance_installments (payment_c2x_id);

create index if not exists c2x_guardian_attendance_queue_primary_acq_request_idx
  on public.c2x_guardian_attendance_queue (primary_acquisition_request_c2x_id);
create index if not exists c2x_guardian_attendance_queue_responsible_user_idx
  on public.c2x_guardian_attendance_queue (responsible_user_id);

-- Régua de lembretes (cron diário varre por parcela)
create index if not exists guardian_compromisso_lembretes_parcela_idx
  on public.guardian_compromisso_lembretes (parcela_id);

-- Apolo (dedup na leitura) ------------------------------------------------------

create index if not exists apolo_merge_candidates_entity_idx
  on public.apolo_merge_candidates (entity_id);
create index if not exists apolo_merge_candidates_candidate_entity_idx
  on public.apolo_merge_candidates (candidate_entity_id);
create index if not exists apolo_relationships_related_entity_idx
  on public.apolo_relationships (related_entity_id);

-- Hub / Hermes / Chronos / Meu dia ---------------------------------------------

create index if not exists hub_notifications_workspace_idx
  on public.hub_notifications (workspace_id);

create index if not exists pulsex_messages_author_user_idx
  on public.pulsex_messages (author_user_id);

create index if not exists chronos_chat_messages_participant_idx
  on public.chronos_chat_messages (participant_id);
create index if not exists chronos_participants_user_idx
  on public.chronos_participants (user_id);
create index if not exists chronos_meetings_room_idx
  on public.chronos_meetings (room_id);

create index if not exists hub_agenda_items_created_by_user_idx
  on public.hub_agenda_items (created_by_user_id);

commit;
