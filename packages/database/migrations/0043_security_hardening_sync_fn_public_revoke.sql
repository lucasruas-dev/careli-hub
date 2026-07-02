-- 0043 — Complemento da 0041 (APLICADA em prod 2/jul/2026 junto com 0041/0042)
--
-- A validacao pos-0041 mostrou que sync_hub_user_from_auth continuava
-- executavel por anon/authenticated: funcoes Postgres nascem com EXECUTE
-- concedido a PUBLIC por default, entao revogar so de anon/authenticated
-- nao fecha (os roles herdam de PUBLIC). Revoga de PUBLIC e devolve o
-- EXECUTE explicito a quem precisa (trigger de auth + service_role).

revoke execute on function public.sync_hub_user_from_auth() from public;
grant execute on function public.sync_hub_user_from_auth() to supabase_auth_admin;
grant execute on function public.sync_hub_user_from_auth() to service_role;
