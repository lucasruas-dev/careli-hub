-- 0107 · O "já liberado" da Caixa passa a vir do EXTRATO, não do LSoft.
--
-- Lucas (25/08/2026): *"a baixa da caixa vem dos extratos e não do lsoft"*. Ele está certo, e a
-- 0104 estava errada: `caixa_ja_liberado` somava `lsoft_parcelas.valor_recebido`, que é o que a
-- construtora deu baixa no sistema dela.
--
-- O tamanho do engano, medido em 25/08/2026:
--   baixado no LSoft ........ R$    598.029,21
--   liberado no extrato ..... R$  7.745.484,15   <- a verdade
--   diferença ............... R$  7.147.454,94   que a Caixa pagou e o LSoft não sabe
--
-- ⚠️ O ELO É RECONSTRUÍDO, NÃO LIDO. O código do contrato da Caixa não existe em lugar nenhum do
-- LSoft; ele veio da planilha da Amanda (aba MUTUARIOS), casado por CPF: 71 dos 77 contratos do
-- extrato. Os 6 restantes (165174, 180470, 385582, 424925, 466820, 629772) não casaram com nenhum
-- CPF do LSoft e ficam SEM cliente — o dinheiro deles existe em `lsoft_credito_da_caixa` mas não
-- entra na conta de ninguém, de propósito: melhor faltar do que abater no cliente errado.
--
-- ⚠️ PRINCIPAL E SECUNDÁRIO SEPARADOS (Lucas, 25/08). Quando a Caixa libera mais de um crédito no
-- mesmo dia para o mesmo contrato, o maior é a liberação principal e os menores ficam à parte —
-- até a Amanda confirmar a natureza deles. Os dois somam em `caixa_ja_liberado`, mas a tela pode
-- mostrar as colunas separadas.

create or replace view public.lsoft_carteira_por_cliente_empreendimento as
with classificada as (
  select
    p.id, p.cliente_codigo, p.empreendimento, p.valor, p.valor_recebido, p.paga,
    p.vencimento, p.quadra, p.lote,
    coalesce(k.situacao = 'confirmada' and k.classe = 'caixa', false) as eh_caixa,
    coalesce(k.situacao = 'a_validar', false) as aguarda_validacao
  from public.lsoft_parcelas p
  left join public.lsoft_classificacao_de_parcela k on k.parcela_id = p.id
),
-- O que a CAIXA de fato liberou, por cliente. Uma linha por cliente, somada do extrato CIWEB.
liberado_pela_caixa as (
  select
    cliente_codigo,
    sum(valor) as total,
    sum(valor) filter (where eh_principal) as principal,
    sum(valor) filter (where not eh_principal) as secundario,
    count(*) as creditos,
    max(data_movimento) as ultima_liberacao
  from public.lsoft_credito_da_caixa
  where cliente_codigo is not null
  group by cliente_codigo
)
select
  c.codigo, c.nome, c.cpf, c.cpf_formatado, c.celular, c.telefone, c.email, c.cidade,
  c.status_validacao, c.enriquecido_em,
  p.empreendimento,

  -- ── Carteira do cliente ─────────────────────────────────────────────────────
  count(*) filter (where not p.eh_caixa) as parcelas,
  count(*) filter (where not p.eh_caixa and p.paga) as parcelas_pagas,
  count(*) filter (where not p.eh_caixa and not p.paga) as parcelas_abertas,
  count(*) filter (where not p.eh_caixa and not p.paga and p.vencimento < current_date) as parcelas_vencidas,
  coalesce(sum(p.valor) filter (where not p.eh_caixa and not p.paga), 0::numeric) as saldo_aberto,
  coalesce(sum(p.valor) filter (where not p.eh_caixa and not p.paga and p.vencimento < current_date), 0::numeric) as saldo_vencido,
  coalesce(sum(p.valor_recebido) filter (where not p.eh_caixa and p.paga), 0::numeric) as total_recebido,
  min(p.vencimento) filter (where not p.eh_caixa and not p.paga) as proximo_vencimento,

  -- ── Carteira Caixa ──────────────────────────────────────────────────────────
  count(*) filter (where p.eh_caixa) as parcelas_caixa,
  coalesce(sum(p.valor) filter (where p.eh_caixa), 0::numeric) as total_caixa,
  -- ⚠️ DO EXTRATO, não do LSoft. `max()` porque o join com as parcelas multiplica a linha do
  -- agregado por cliente; o valor é o mesmo em todas.
  coalesce(max(lib.total), 0::numeric) as caixa_ja_liberado,
  coalesce(max(lib.principal), 0::numeric) as caixa_liberado_principal,
  coalesce(max(lib.secundario), 0::numeric) as caixa_liberado_secundario,
  coalesce(max(lib.creditos), 0) as caixa_creditos,
  max(lib.ultima_liberacao) as caixa_ultima_liberacao,
  -- Saldo real: o que falta a Caixa liberar. Nunca negativo — se o extrato já passou do
  -- contratado, a unidade está LIQUIDADA e o excedente é assunto de conferência, não dívida.
  greatest(
    coalesce(sum(p.valor) filter (where p.eh_caixa), 0::numeric) - coalesce(max(lib.total), 0::numeric),
    0::numeric
  ) as caixa_a_liberar,
  -- A unidade liquidou quando o extrato alcançou o contratado.
  (
    coalesce(sum(p.valor) filter (where p.eh_caixa), 0::numeric) > 0
    and coalesce(max(lib.total), 0::numeric) >= coalesce(sum(p.valor) filter (where p.eh_caixa), 0::numeric)
  ) as caixa_liquidada,

  -- ── Pendência de curadoria ──────────────────────────────────────────────────
  count(*) filter (where p.aguarda_validacao) as parcelas_a_validar,
  coalesce(sum(p.valor) filter (where p.aguarda_validacao), 0::numeric) as valor_a_validar,

  array_remove(array_agg(distinct
    case
      when p.quadra is not null or p.lote is not null
        then concat_ws(' ', nullif('Q' || p.quadra, 'Q'), nullif('L' || p.lote, 'L'))
    end), null) as unidades
from public.lsoft_clientes c
join classificada p on p.cliente_codigo = c.codigo
left join liberado_pela_caixa lib on lib.cliente_codigo = c.codigo
group by
  c.codigo, c.nome, c.cpf, c.cpf_formatado, c.celular, c.telefone, c.email, c.cidade,
  c.status_validacao, c.enriquecido_em, p.empreendimento;

comment on view public.lsoft_carteira_por_cliente_empreendimento is
  'Carteira do LSoft por cliente x empreendimento. As colunas *_caixa contam SOMENTE classificacao confirmada; o JA LIBERADO vem do EXTRATO CIWEB (lsoft_credito_da_caixa), nao do valor_recebido do LSoft — medido: R$ 7,75 mi no extrato contra R$ 598 mil no LSoft.';
