-- 0046_hub_users_job_title
-- Cargo da pessoa na Careli (job title) no cadastro de usuários. Usado, entre outros,
-- na assinatura automática dos e-mails da Iris (nome + cargo). Campo livre, opcional.
alter table public.hub_users
  add column if not exists job_title text;

comment on column public.hub_users.job_title is
  'Cargo da pessoa na Careli (ex.: Analista de Atendimento). Opcional; usado na assinatura de e-mail da Iris.';
