-- HUB / Central de notificacoes - module_id como rotulo livre de marca.
--
-- A central do Panteon e por MARCA (chips "Zeus", "Iris", "Hades"...), mas hub_modules
-- so tem os ids de CODIGO (guardian, caredesk, pulsex, chronos...) e nem inclui o Zeus.
-- A FK module_id -> hub_modules estava descartando em silencio toda notificacao de
-- marca (ex.: Zeus helpdesk com module_id "zeus" violava a FK). Soltamos a FK: module_id
-- vira texto livre (o cliente mapeia id -> rotulo/cor). Tabela vazia, zero risco.

begin;

alter table public.hub_notifications
  drop constraint if exists hub_notifications_module_id_fkey;

comment on column public.hub_notifications.module_id is
  'Modulo de MARCA da notificacao (zeus/iris/hades/hermes/apolo/...). Rotulo livre; o cliente mapeia para label e cor.';

commit;
