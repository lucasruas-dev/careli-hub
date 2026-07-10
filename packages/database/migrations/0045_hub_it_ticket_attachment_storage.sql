-- HelpDesk: anexos saem do Postgres e vao pro Supabase Storage.
--
-- Ate aqui `content_data_url` guardava o ARQUIVO INTEIRO em base64 dentro de uma
-- coluna text (88 anexos = 53 MB; a tabela de anexos ficou 170x maior que a de
-- tickets). Isso: (a) fazia a listagem baixar dezenas de MB, (b) obrigava a
-- captura a comprimir ate caber (video a 450 kbps, print em JPEG 82%), e (c)
-- esbarrava no limite de ~4.5 MB de body das functions da Vercel.
--
-- Agora o arquivo vive no bucket privado `hub-it-ticket-attachments` e a linha
-- guarda so o caminho. A leitura usa URL assinada.
--
-- TRANSICAO: `content_data_url` continua existindo e NULLABLE de proposito.
-- Enquanto houver linha antiga sem `storage_path`, o servidor le o base64 como
-- fallback (leitura dupla). A coluna so cai depois do backfill confirmado.

alter table public.hub_it_ticket_attachments
  add column if not exists storage_path text;

comment on column public.hub_it_ticket_attachments.storage_path is
  'Caminho no bucket privado hub-it-ticket-attachments. Quando preenchido, tem precedencia sobre content_data_url.';

comment on column public.hub_it_ticket_attachments.content_data_url is
  'LEGADO: arquivo em base64. Mantido apenas como fallback de leitura ate o backfill para o Storage terminar. Nao usar em anexos novos.';

-- Só as linhas ja migradas; as legadas (storage_path null) ficam fora do indice.
create index if not exists hub_it_ticket_attachments_storage_path_idx
  on public.hub_it_ticket_attachments (storage_path)
  where storage_path is not null;
