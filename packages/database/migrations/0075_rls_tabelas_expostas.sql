-- 0075: Liga o RLS nas 5 tabelas que nasceram sem ele e ficaram EXPOSTAS ao PostgREST
-- (advisor rls_disabled_in_public — e-mail de seguranca do Supabase, 26/jul/2026).
--
-- Sem RLS, a chave publica (anon) que vai no bundle do c2x.app.br conseguia ler/editar/apagar
-- essas tabelas direto pela API do banco, pulando o login do hub. Ligar o RLS SEM policy deixa
-- deny-all para anon/authenticated; o app acessa todas via service_role (server-side), que passa
-- por cima do RLS — o MESMO padrao das demais tabelas do schema. Confirmado: nenhuma das cinco e
-- lida pelo browser client (so por rotas/libs de servidor).

alter table public.apolo_disparos enable row level security;
alter table public.apolo_asaas_eventos enable row level security;
alter table public.apolo_imobiliaria_match enable row level security;
alter table public.prometeu_operadores enable row level security;
alter table public.apolo_c2x_sync enable row level security;
