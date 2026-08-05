-- Guarda o CAMINHO da arte do convite no bucket (apolo-docs) para o disparo do template poder gerar
-- uma signed URL fresca a cada envio (a Meta baixa a imagem por ela). A imagem que sobe no template
-- serve só de exemplo na aprovação; no envio real é preciso reapresentar a mídia.
alter table public.apolo_acoes add column if not exists imagem_path text;
