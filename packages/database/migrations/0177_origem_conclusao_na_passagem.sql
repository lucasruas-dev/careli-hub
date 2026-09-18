-- 0177 — A PASSAGEM DE ETAPA GANHA A ORIGEM `conclusao`.
--
-- ⚠️ NÃO APLICADA. Aguarda OK explícito do Lucas.
--
-- Lucas (18/09/2026): "o time administrativo quando finaliza um cancelamento de contrato, a unidade
-- nao esta voltando para disponibilidade". O card de cancelamento e o de distrato não tinham botão
-- de concluir: o último item do checklist ("Liberar a unidade para venda") era só texto. O botão
-- novo da Têmis (Concluir cancelamento / Concluir distrato) cancela a venda, derruba a reserva,
-- indefere o card de contrato que sobrou, fecha o card e devolve o lote pela trava
-- (`lib/hercules/concluir-cancelamento-server.ts`).
--
-- A passagem do card para o fim é gravada com `origem = 'conclusao'`, e o check da 0153 não conhece
-- a palavra. Enquanto esta migration não for aplicada, o código grava a mesma passagem com
-- `origem = 'atividade'` (a origem antiga mais próxima: concluir marca todas as atividades do card),
-- e nada se perde além da precisão da palavra. Ver `ORIGEM_ENQUANTO_FALTA_MIGRATION` em
-- `apps/hub/lib/temis/passagem-de-etapa-db.ts`.
--
-- Só troca o check: sem coluna nova, sem backfill, sem mudança para quem lê.

begin;

alter table public.temis_trabalho_etapas
  drop constraint if exists temis_trabalho_etapas_origem_valida;

alter table public.temis_trabalho_etapas
  add constraint temis_trabalho_etapas_origem_valida
    check (
      origem in (
        'abertura',
        'atividade',
        'conclusao',
        'contrato_gerado',
        'envio_assinatura',
        'webhook_assinatura',
        'indeferimento',
        'retorno_para_correcao'
      )
    );

comment on column public.temis_trabalho_etapas.origem is
  'O que fez o card andar: abertura, atividade, conclusao, contrato_gerado, envio_assinatura, webhook_assinatura, indeferimento, retorno_para_correcao.';

commit;
