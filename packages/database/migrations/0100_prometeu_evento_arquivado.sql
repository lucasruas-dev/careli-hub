-- Prometeu: ARQUIVAR um lancamento que ja acabou.
--
-- Regra do Lucas (21/08/2026): *"ele e o nosso sistema de fila, ou seja ele funcionara em
-- lancamentos ATIVOS. Os lancamentos que foram FINALIZADOS, pode arquivar tudo, gestao, fila
-- tudo, pois apos finalizacao nao vamos mais utilizar ele para aquele evento."*
--
-- ⚠️ ARQUIVAR E ESCONDER, NUNCA APAGAR. As FKs deste modulo sao ON DELETE CASCADE: um delete em
-- `prometeu_eventos` levaria junto 609 credenciados, 481 movimentacoes, 242 chamadas, 18 mesas,
-- 13 operadores e as unidades reservadas — o registro de quem credenciou e quem comprou. Por isso
-- aqui nao existe delete, e a rota tambem nao deve ganhar um.
--
-- ⚠️ COLUNA SEPARADA, E NAO `status = 'arquivado'`. O `status` carrega o ciclo DO DIA
-- (rascunho -> ativo -> em_andamento -> encerrado). Sobrescreve-lo com 'arquivado' apagaria a
-- informacao de que o evento chegou ao fim direito, e nao haveria como distinguir um lancamento
-- que terminou de um que foi tirado de circulacao no meio. Sao duas perguntas diferentes.
--
-- E o mesmo padrao que o modulo ja usa um nivel abaixo, para PESSOA:
-- `prometeu_credenciados.encerrado_em` + `encerrado_motivo`, carimbados no fim do dia e filtrados
-- por padrao na leitura. Repetir o vocabulario mantem o modulo legivel.
--
-- Nao aplicar sem autorizacao expressa do Lucas (regra-mae: migration = operacao sensivel).
-- AUTORIZADA por ele em 21/08/2026.

alter table public.prometeu_eventos
  add column if not exists arquivado_em timestamptz,
  add column if not exists arquivado_por uuid references public.hub_users (id) on delete set null;

comment on column public.prometeu_eventos.arquivado_em is
  'Quando o lancamento saiu de circulacao. Null = aparece nas telas. Preenchido = some dos seletores e do evento do dia, mas TODO o historico continua no banco.';

-- Indice parcial: praticamente toda leitura de evento passa a filtrar `arquivado_em is null`
-- (listEventos, eventoOperavel). O parcial cobre exatamente esse caso e nao cresce com o
-- historico arquivado, que so e lido sob demanda.
create index if not exists prometeu_eventos_vivos_idx
  on public.prometeu_eventos (workspace_id, status)
  where arquivado_em is null;
