-- Apolo: documentos (entidade e empreendimento) no Supabase Storage.
--
-- A tabela apolo_documents (documentos de ENTIDADE) ja existe e ja preve o arquivo
-- (storage_bucket/storage_path) + o que o iOCR extraiu (extracted_payload). Faltavam duas
-- coisas: (1) o bucket privado pros arquivos, (2) a tabela de documentos de EMPREENDIMENTO
-- -- o empreendimento e do C2X (enterprises), nao e uma apolo_entity, entao tem tabela propria.
--
-- Arquivos ficam num bucket PRIVADO, servidos por URL assinada gerada no backend (service
-- role). Nao ha policy de storage.objects pra authenticated: todo acesso passa pelas rotas.

insert into storage.buckets (id, name, public)
values ('apolo-documents', 'apolo-documents', false)
on conflict (id) do nothing;

create table if not exists public.apolo_enterprise_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'careli',
  enterprise_code text not null,
  document_type text not null,
  label text not null,
  status text not null default 'ready',
  storage_bucket text,
  storage_path text,
  metadata jsonb not null default '{}'::jsonb,
  uploaded_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists apolo_enterprise_documents_code_idx
  on public.apolo_enterprise_documents (enterprise_code);

alter table public.apolo_enterprise_documents enable row level security;

-- Leitura pra usuarios autenticados do Hub (mesmo padrao das apolo_*); escrita so via service
-- role (rotas server-side), que bypassa RLS.
drop policy if exists apolo_enterprise_documents_read on public.apolo_enterprise_documents;
create policy apolo_enterprise_documents_read
  on public.apolo_enterprise_documents for select to authenticated using (true);
