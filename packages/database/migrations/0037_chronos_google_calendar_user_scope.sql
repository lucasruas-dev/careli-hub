-- Chronos Google Calendar user scope.
-- Keeps each collaborator connected to their own Google primary calendar.

begin;

drop index if exists public.chronos_google_calendar_connections_default_idx;

create unique index if not exists chronos_google_calendar_connections_user_default_idx
  on public.chronos_google_calendar_connections (created_by_user_id, calendar_id)
  where status = 'active'
    and is_default
    and created_by_user_id is not null;

create unique index if not exists chronos_google_calendar_connections_legacy_default_idx
  on public.chronos_google_calendar_connections (calendar_id)
  where status = 'active'
    and is_default
    and created_by_user_id is null;

update public.chronos_google_calendar_event_links as link
set connection_id = connection.id
from public.chronos_meetings as meeting
cross join public.chronos_google_calendar_connections as connection
where link.connection_id is null
  and link.meeting_id = meeting.id
  and connection.calendar_id = link.calendar_id
  and connection.created_by_user_id = meeting.host_user_id
  and connection.status = 'active'
  and connection.is_default;

alter table public.chronos_google_calendar_event_links
  drop constraint if exists chronos_google_calendar_event_links_meeting_calendar_key;

alter table public.chronos_google_calendar_event_links
  drop constraint if exists chronos_google_calendar_event_links_event_key;

alter table public.chronos_google_calendar_event_links
  add constraint chronos_google_calendar_event_links_meeting_connection_key
  unique (meeting_id, connection_id);

alter table public.chronos_google_calendar_event_links
  add constraint chronos_google_calendar_event_links_event_connection_key
  unique (connection_id, google_event_id);

create index if not exists chronos_google_calendar_event_links_connection_idx
  on public.chronos_google_calendar_event_links (connection_id, sync_status);

comment on index public.chronos_google_calendar_connections_user_default_idx is
  'Garante uma conexao Google default ativa por usuario e calendario.';

comment on constraint chronos_google_calendar_event_links_meeting_connection_key
  on public.chronos_google_calendar_event_links is
  'Evita que o mesmo evento Chronos seja vinculado duas vezes na mesma conexao Google.';

comment on constraint chronos_google_calendar_event_links_event_connection_key
  on public.chronos_google_calendar_event_links is
  'Permite IDs de evento Google repetidos entre usuarios diferentes, mas nao na mesma conexao.';

commit;
