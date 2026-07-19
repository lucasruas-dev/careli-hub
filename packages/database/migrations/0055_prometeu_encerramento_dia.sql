-- Prometeu: encerrar o dia do evento (Lucas 19/jul).
--
-- O lançamento costuma ter 2 DIAS. Ao final de cada dia o Lucas encerra: quem CONCLUIU o fluxo
-- fica (é o dado de performance do time), e quem ficou no meio do caminho — fila solta,
-- negociação parada, credenciado que nunca foi atendido — sai da operação.
--
-- "Sair" aqui NÃO é delete, é ARQUIVAMENTO. Quantas pessoas não fecharam, e em que etapa
-- pararam, é justamente uma das respostas para "como foi o dia": apagar destruiria o número que
-- ele quer medir. Some das telas de operação (toda listagem filtra `encerrado_em is null`) e
-- permanece no histórico para análise.
--
-- Quem pode disparar isso é SÓ o dono do evento (lucas.ruas@careli.adm.br), verificado por
-- e-mail no token — papel de admin não basta. Ver lib/prometeu/auth.ts.

alter table public.prometeu_credenciados
  add column if not exists encerrado_em timestamptz,
  add column if not exists encerrado_motivo text;

-- As telas de operação leem sempre o recorte "ativo": índice cobre esse filtro.
create index if not exists prometeu_credenciados_ativos_idx
  on public.prometeu_credenciados (evento_id, etapa)
  where encerrado_em is null;
