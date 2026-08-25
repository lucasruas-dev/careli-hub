-- 0104 · A carteira do LSoft POR EMPREENDIMENTO, já separando o que é da CAIXA.
--
-- Resolve DOIS problemas de uma vez, os dois medidos em 25/08/2026:
--
-- 1) ⚠️ O FILTRO DE EMPREENDIMENTO NUNCA FILTROU DINHEIRO. A view 0096
--    (`lsoft_carteira_por_cliente`) agrupa só por cliente e faz LEFT JOIN em TODAS as parcelas
--    dele, de qualquer empreendimento. A tela então filtra QUEM aparece (por
--    `c.empreendimentos`), mas soma o dinheiro dos dois. Efeito real: 2 clientes têm parcela no
--    Garden e no Vale do Sol e arrastam R$ 604.088,97 do Garden (R$ 578.572,00 em aberto) para
--    dentro do total do Vale do Sol. Aqui a granularidade passa a ser cliente × empreendimento,
--    que é a pergunta que a tela sempre fez.
--
-- 2) O SUBSÍDIO DA CAIXA DEIXA DE POLUIR A CARTEIRA. No Vale do Sol (Minha Casa Minha Vida) o
--    financiamento está lançado como parcela do cliente. Quem paga é a Caixa, por medição de
--    obra. Medido: dos R$ 21,10 mi da tela, R$ 15,12 mi são Caixa; o vencido cai de R$ 8,89 mi
--    para R$ 99.698,88 e a inadimplência de ~50% para ~2,5%.
--
-- ⚠️ SÓ SAI DA CARTEIRA O QUE FOI VALIDADO POR UMA PESSOA. A classificação automática (0103)
-- nasce como 'a_validar' e NÃO mexe em número nenhum: as colunas `*_caixa` só contam
-- situacao='confirmada'. Enquanto ninguém aperta o botão, a tela mostra exatamente o que mostra
-- hoje (fora a correção 1), e `parcelas_a_validar` diz quantas esperam decisão. Foi a regra do
-- Lucas: a máquina propõe, a pessoa confirma.
--
-- A view 0096 CONTINUA EXISTINDO e intocada — nada que a consulta hoje muda de comportamento.

create or replace view public.lsoft_carteira_por_cliente_empreendimento as
with classificada as (
  select
    p.id,
    p.cliente_codigo,
    p.empreendimento,
    p.valor,
    p.valor_recebido,
    p.paga,
    p.vencimento,
    p.quadra,
    p.lote,
    -- CONFIRMADA é o único estado que tira o valor da carteira do cliente.
    coalesce(k.situacao = 'confirmada' and k.classe = 'caixa', false) as eh_caixa,
    -- Proposta ainda não decidida: alimenta o contador "faltam N para validar".
    coalesce(k.situacao = 'a_validar', false) as aguarda_validacao,
    k.natureza
  from public.lsoft_parcelas p
  left join public.lsoft_classificacao_de_parcela k on k.parcela_id = p.id
)
select
  c.codigo,
  c.nome,
  c.cpf,
  c.cpf_formatado,
  c.celular,
  c.telefone,
  c.email,
  c.cidade,
  c.status_validacao,
  c.enriquecido_em,
  -- A CHAVE NOVA: uma linha por cliente E empreendimento.
  p.empreendimento,

  -- ── Carteira do cliente (o que ele realmente deve) ──────────────────────────
  count(*) filter (where not p.eh_caixa) as parcelas,
  count(*) filter (where not p.eh_caixa and p.paga) as parcelas_pagas,
  count(*) filter (where not p.eh_caixa and not p.paga) as parcelas_abertas,
  count(*) filter (where not p.eh_caixa and not p.paga and p.vencimento < current_date)
    as parcelas_vencidas,
  coalesce(sum(p.valor) filter (where not p.eh_caixa and not p.paga), 0::numeric)
    as saldo_aberto,
  coalesce(sum(p.valor) filter (where not p.eh_caixa and not p.paga and p.vencimento < current_date), 0::numeric)
    as saldo_vencido,
  coalesce(sum(p.valor_recebido) filter (where not p.eh_caixa and p.paga), 0::numeric)
    as total_recebido,
  min(p.vencimento) filter (where not p.eh_caixa and not p.paga) as proximo_vencimento,

  -- ── Caixa (financiamento, subsídio, FGTS, terreno) ──────────────────────────
  count(*) filter (where p.eh_caixa) as parcelas_caixa,
  coalesce(sum(p.valor) filter (where p.eh_caixa), 0::numeric) as total_caixa,
  coalesce(sum(p.valor) filter (where p.eh_caixa and not p.paga), 0::numeric)
    as caixa_a_liberar,
  coalesce(sum(p.valor_recebido) filter (where p.eh_caixa), 0::numeric)
    as caixa_ja_liberado,

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
group by
  c.codigo, c.nome, c.cpf, c.cpf_formatado, c.celular, c.telefone, c.email, c.cidade,
  c.status_validacao, c.enriquecido_em, p.empreendimento;

comment on view public.lsoft_carteira_por_cliente_empreendimento is
  'Carteira do LSoft com granularidade cliente x empreendimento (a 0096 agrega só por cliente e mistura os dois). As colunas *_caixa contam SOMENTE parcelas com classificação confirmada por uma pessoa; parcelas_a_validar mostra quantas ainda esperam decisão.';
