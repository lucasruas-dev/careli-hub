-- Apolo: a esteira guarda a CHAVE PIX que o prospect informa para a EVENTUAL DEVOLUÇÃO dos
-- R$ 1.000 do credenciamento. O recibo (WhatsApp `cad_pix_recibo_v2` / e-mail de recibo) pede essa
-- chave; o valor é restituído em até 10 dias úteis se a pessoa não adquirir unidade.
--
-- Coluna DEDICADA, NÃO em `apolo_entities.metadata` (o sync do C2X substitui o metadata inteiro —
-- ver a razão de existir a 0057). A esteira é imune ao sync, então a chave sobrevive aqui.
-- A CACÁ grava via a tool `registrar_chave_pix` quando o cliente responde no atendimento; o
-- backfill preenche as chaves já informadas nos chats. Aditiva, nullable, sem backfill — espelha o
-- padrão da 0060.
--
-- Autorizado pelo Lucas (25/07: "pode seguir com migration"). Regra-mãe: migration = operação sensível.

alter table public.apolo_esteira
  add column if not exists chave_pix_devolucao text,
  add column if not exists chave_pix_registrada_em timestamptz,
  add column if not exists chave_pix_registrada_via text;

comment on column public.apolo_esteira.chave_pix_devolucao is
  'Chave PIX que o prospect informou para eventual devolução dos R$1.000 do credenciamento.';
comment on column public.apolo_esteira.chave_pix_registrada_via is
  'De onde veio o registro: caca (IA no atendimento), operador, ou backfill.';
