-- 0108 · O vencimento na classificação — para a marca sobreviver à recarga do LSoft.
--
-- ⚠️ O BURACO QUE ISTO FECHA. A 0103 gravou uma `impressao_digital` para religar a classificação à
-- parcela depois de uma recarga, com a fórmula
--   md5(cliente|empreendimento|parcela|vencimento|valor|observacoes|origem)
-- Dois desses campos são MÓVEIS: `origem` vira 'recebido' quando a parcela é paga, e `observacoes`
-- muda quando alguém corrige o histórico no LSoft. A digital quebra exatamente nas linhas que
-- mudaram — e os campos redundantes que a 0103 guardou (cliente, valor, observação) não bastam
-- para desempatar: um cliente tem várias parcelas de mesmo valor.
--
-- O vencimento é o desempate que faltava. Com ele, cliente + empreendimento + vencimento + valor
-- identifica a parcela sem depender de nenhum campo que o time mexe no dia a dia.
--
-- Descoberto em 25/08/2026, quando o Lucas perguntou "o time atualizou algumas linhas dentro do
-- lsoft, conseguimos atualizar a nossa base?" — a resposta honesta era "não sem perder as 180
-- validações". Ver scripts/lsoft/reconciliar-classificacao.mjs.

alter table public.lsoft_classificacao_de_parcela
  add column if not exists vencimento_no_momento date;

comment on column public.lsoft_classificacao_de_parcela.vencimento_no_momento is
  'Vencimento da parcela quando a marca foi criada. Redundante DE PROPOSITO: e o desempate que religa a marca apos uma recarga do LSoft, quando parcela_id morre e a impressao_digital quebra (origem/observacoes mudam). Ver scripts/lsoft/reconciliar-classificacao.mjs.';

-- BACKFILL das que ainda apontam para uma parcela viva. As que ja estiverem orfas nao tem de onde
-- tirar o vencimento — ficam nulas e caem na rede mais frouxa do reconciliador, que so aceita
-- resultado unico. Melhor faltar do que abater no cliente errado.
update public.lsoft_classificacao_de_parcela c
   set vencimento_no_momento = p.vencimento
  from public.lsoft_parcelas p
 where p.id = c.parcela_id
   and c.vencimento_no_momento is null;

-- O indice que a rede 2/3 do reconciliador percorre.
create index if not exists lsoft_classificacao_por_venc_valor
  on public.lsoft_classificacao_de_parcela (cliente_codigo, empreendimento, vencimento_no_momento, valor_no_momento);
