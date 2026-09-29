-- 0195 (dados) · OS EVENTOS DO WEBHOOK GANHAM O envelope_id QUE SEMPRE FALTOU.
-- Medido em 28/09/2026: 226 de 226 com envelope_id nulo. Depois da F1 o registro grava o da linha
-- achada e o carimbo do envio preenche os eventos que chegaram antes dele; isto conserta o passado.
-- Idempotente: só toca evento sem envelope_id; casamento único pela unicidade da 0195.
-- ⚠️ Só evento CONFERIDO (revisão da F1): o documento do não conferido veio de um corpo que qualquer
-- um escreve, e ligá-lo ao envelope o poria na conta de quem lê os eventos pelo envelope.
begin;
update public.temis_assinatura_eventos ev
   set envelope_id = e.envelope_id
  from public.temis_envelopes e
 where ev.envelope_id is null
   and ev.provedor_documento_id is not null
   and ev.assinatura_conferida
   and e.provedor = ev.provedor
   and e.provedor_documento_id = ev.provedor_documento_id
   and e.envelope_id is not null;
commit;
-- Conferência: select count(*), count(envelope_id) from temis_assinatura_eventos;
