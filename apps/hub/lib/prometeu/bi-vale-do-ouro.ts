import type { RowDataPacket } from "mysql2/promise";

import { getHadesDbPool } from "@/lib/guardian/db";

// Agregados do BI PÚBLICO de vendas do Vale do Ouro, direto do C2X read-only.
// TUDO agregado — nenhum nome/documento de comprador sai daqui (a página é pública). Nomes de
// IMOBILIÁRIA são públicos por natureza (ranking do lançamento).
// VENDA = pedido aberto em Contrato gerado (3) ou Proposta realizada (9); RESERVA = etapa 1.
// Ver docs/architecture/c2x-schema-map.md e [[project_apolo_diagnostico_mostqi]].

// A FAMÍLIA VALE DO OURO no C2X (divisão de 03/08, padrão Lagoa Bonita):
//   35 VLO — o master histórico (o masterplan que o corretor enxerga; unidades aposentadas)
//   36 VOL — carteira do Lino    (unidades "externas")
//   37 VOC — carteira do Cecílio (unidades "internas")
// Para o MERCADO é UM lançamento; para a OPERAÇÃO são duas carteiras, com contas de recebimento
// diferentes. Daí os três recortes servidos pelo MESMO código: "todos", "voc" e "vol".
const MASTER = 35;
const VOL = 36;
const VOC = 37;
const CARTEIRAS_VIVAS = [VOL, VOC];
const LISTA_ENTERPRISES = [MASTER, ...CARTEIRAS_VIVAS].join(", ");

export type CarteiraDoVale = "todos" | "voc" | "vol";

/** Aceita o que vier da URL e devolve um recorte válido (padrão: o lançamento inteiro). */
export function normalizarCarteira(valor: unknown): CarteiraDoVale {
  const bruto = typeof valor === "string" ? valor.trim().toLowerCase() : "";
  return bruto === "voc" || bruto === "vol" ? bruto : "todos";
}

// ── AS ÓRFÃS DO 35 ────────────────────────────────────────────────────────────
// Na divisão, as propostas do master foram recriadas nas carteiras — menos algumas, que ficaram
// abertas no 35. Filtrar a carteira só por `enterprise_id` sumiria com elas dos DOIS painéis
// (a soma VOC+VOL daria menos que o total do lançamento). Então cada proposta órfã é atribuída à
// carteira do LOTE GÊMEO: VLO0104 tem gêmeo VOC0104 (37) ou VOL0104 (36), casados pelo NÚMERO DO
// LOTE — `SUBSTRING(name, 4)`, o mesmo casamento do espelho do masterplan.
// ⚠️ NÃO usar o campo de TIPO da unidade (interna/externa) para isso: hoje ele acerta por
// coincidência estrutural (VOC=interna, VOL=externa), mas não é a regra, e quebra em silêncio se
// um lote for recadastrado com o tipo errado. O número do lote é a verdade.
// Conferido em 06/08: os 298 lotes do 35 têm gêmeo único em 36/37 (nenhum sufixo repetido).
const JOIN_GEMEO = `LEFT JOIN enterprise_unities gemeo
       ON eu.enterprise_id = ${MASTER}
      AND gemeo.enterprise_id IN (${CARTEIRAS_VIVAS.join(", ")})
      AND SUBSTRING(gemeo.name, 4) = SUBSTRING(eu.name, 4)`;
// Carteira EFETIVA da proposta: a própria (36/37) ou, se nasceu no master, a do lote gêmeo.
const CARTEIRA_DA_PROPOSTA = `COALESCE(NULLIF(eu.enterprise_id, ${MASTER}), gemeo.enterprise_id)`;
const JOIN_UNIDADE = `JOIN enterprise_unities eu ON eu.id = ar.enterprise_unity_id
     ${JOIN_GEMEO}`;

// ── O QUE É ESTOQUE DE VERDADE ────────────────────────────────────────────────
// Das 298 unidades, 108 estão com preço R$ 1,00 e bloqueadas para venda: NUNCA foram postas à
// venda (conferido em 06/08: nenhuma delas tem proposta, e já estavam assim no 35 antes da
// divisão). Contá-las no denominador afunda o percentual — o painel dizia "53% do
// empreendimento" quando, sobre os lotes de fato comercializados, o vendido é 83%.
// Então: COMERCIAL = preço > 1; NÃO LANÇADO = preço <= 1 e bloqueado (vira número à parte, para
// a informação não sumir).
const UNIDADE_COMERCIAL = "eu.price > 1";
const UNIDADE_NAO_LANCADA = "eu.price <= 1 AND eu.sale_blocked = 1";

const VENDA = "ar.open = 1 AND ar.acquisition_request_stage_id IN (3, 9)";
const RESERVA = "ar.open = 1 AND ar.acquisition_request_stage_id = 1";

// ── O ESTOQUE CONTA LOTE, NÃO PROPOSTA ────────────────────────────────────────
// ⚠️ ACHADO DO LUCAS, 07/08: "tínhamos somente 190 lotes para venda e somando os valores não dá
// isso". Ele estava certo. O painel mostrava 157 vendidas + 46 reservas + 28 disponíveis = 231,
// sobre 190 lotes. Duas causas, as duas de contar a coisa errada:
//
//   1. RESERVA vinha de PROPOSTA em estágio 1, e 14 dessas apontavam para lote que JÁ TEM VENDA
//      (reserva antiga que nunca teve baixa). O mesmo lote entrava como vendido e como reservado.
//   2. DISPONÍVEL vinha do `sale_status_id` do cadastro, sem olhar se existe proposta viva. Os 9
//      lotes vendidos que ficaram no master têm o gêmeo na carteira marcado como "Reservado", e
//      lote com reserva aberta aparecia como livre. Dava 28 livres quando só 5 estão de verdade.
//
// A REGRA AGORA: percorre o LOTE COMERCIAL (uma linha por lote físico) e decide o desfecho por
// precedência, olhando as propostas do próprio lote E as do gêmeo no master:
//     tem venda?  -> VENDIDO
//     senão, tem reserva? -> RESERVADO
//     senão -> LIVRE
// Assim os três sempre somam o total, em qualquer carteira. Conferido no C2X: 157 + 28 + 5 = 190.
//
// O casamento com o master é pelo NÚMERO DO LOTE (mesma regra do JOIN_GEMEO acima): o lote físico
// é um só, tanto faz em qual registro a proposta nasceu.
const PROPOSTA_DO_LOTE = (filtroEstagio: string) => `EXISTS (
       SELECT 1 FROM acquisition_requests ar
        JOIN enterprise_unities pu ON pu.id = ar.enterprise_unity_id
       WHERE pu.enterprise_id IN (${LISTA_ENTERPRISES})
         AND SUBSTRING(pu.name, 4) = SUBSTRING(eu.name, 4)
         AND ${filtroEstagio})`;

type Linha = RowDataPacket & Record<string, unknown>;

export type BiValeDoOuro = Awaited<ReturnType<typeof montarBiValeDoOuro>>;

/** Recorte do BI: quais unidades contar e como filtrar as propostas (já com as órfãs do 35). */
export function recorteDaCarteira(carteira: CarteiraDoVale) {
  const empresa = carteira === "voc" ? VOC : carteira === "vol" ? VOL : null;

  return {
    // Contagem de UNIDADES nunca inclui o 35: são as MESMAS unidades, agora aposentadas.
    // Somar os três dobraria o empreendimento — "mapa das 596 unidades".
    listaUnidades: empresa === null ? CARTEIRAS_VIVAS.join(", ") : String(empresa),
    filtroCarteira: empresa === null ? "" : `AND ${CARTEIRA_DA_PROPOSTA} = ${empresa}`,
  };
}

export async function montarBiValeDoOuro(carteira: CarteiraDoVale = "todos") {
  const poolResult = getHadesDbPool();
  if (!poolResult.ok) throw new Error("C2X indisponível.");
  const { pool } = poolResult;

  const { filtroCarteira, listaUnidades } = recorteDaCarteira(carteira);

  const q = async (sql: string): Promise<Linha[]> => {
    const [rows] = await pool.query<Linha[]>(sql);
    return rows;
  };

  // Base das consultas de PROPOSTA. `joins` entra antes do WHERE — é onde cada consulta pendura
  // a sua dimensão (imobiliária, plano, sexo, cidade…), sem repetir o recorte de carteira.
  const de = (joins = "") => `FROM acquisition_requests ar
     ${JOIN_UNIDADE}
     LEFT JOIN users cli ON cli.id = ar.client_id
     ${joins}
     WHERE eu.enterprise_id IN (${LISTA_ENTERPRISES}) ${filtroCarteira}`;

  const [
    unidades,
    statusUnidades,
    vendas,
    reservas,
    porTipo,
    rankingImob,
    planos,
    parcelasEntrada,
    sexo,
    estadoCivil,
    idades,
    profissoes,
    faixaSalarial,
    vendasHoje,
  ] = await Promise.all([
    q(`SELECT COUNT(*) total,
         SUM(CASE WHEN ${UNIDADE_COMERCIAL} THEN 1 ELSE 0 END) comerciais,
         SUM(CASE WHEN ${UNIDADE_NAO_LANCADA} THEN 1 ELSE 0 END) nao_lancadas
       FROM enterprise_unities eu WHERE eu.enterprise_id IN (${listaUnidades})`),
    // O estoque que o painel mostra é o COMERCIAL: percentual e "ainda disponíveis" falam dos
    // lotes de fato postos à venda.
    q(`SELECT CASE
           WHEN ${PROPOSTA_DO_LOTE(VENDA)} THEN 'Vendido'
           WHEN ${PROPOSTA_DO_LOTE(RESERVA)} THEN 'Reservado'
           ELSE 'Disponível' END status,
         COUNT(*) qtd, ROUND(SUM(eu.price)) vgv
       FROM enterprise_unities eu
       WHERE eu.enterprise_id IN (${listaUnidades}) AND ${UNIDADE_COMERCIAL} GROUP BY 1`),
    q(`SELECT COUNT(DISTINCT ar.enterprise_unity_id) unidades, ROUND(SUM(eu.price)) vgv,
       ROUND(AVG(eu.price)) ticket ${de()} AND ${VENDA}`),
    q(`SELECT COUNT(*) unidades, ROUND(SUM(eu.price)) vgv
       FROM enterprise_unities eu
       WHERE eu.enterprise_id IN (${listaUnidades}) AND ${UNIDADE_COMERCIAL}
         AND NOT ${PROPOSTA_DO_LOTE(VENDA)} AND ${PROPOSTA_DO_LOTE(RESERVA)}`),
    // O DUELO vem da CARTEIRA da proposta (a divisão real de 03/08), não mais do campo de tipo
    // da unidade — que era só a marcação provisória usada enquanto tudo vivia no VLO. As chaves
    // "interna"/"externa" ficam porque é o que a página do BI já procura (VOC=Cecílio/interna,
    // VOL=Lino/externa); o fallback cobre órfã que porventura fique sem gêmeo.
    q(`SELECT CASE ${CARTEIRA_DA_PROPOSTA}
           WHEN ${VOC} THEN 'Unidade interna'
           WHEN ${VOL} THEN 'Unidade externa'
           ELSE COALESCE(t.name, 'Unidade interna') END tipo,
         COUNT(*) vendas, ROUND(SUM(eu.price)) vgv, ROUND(AVG(eu.price)) ticket
       ${de("LEFT JOIN enterprise_unity_types t ON t.id = eu.enterprise_unity_type_id")}
       AND ${VENDA} GROUP BY 1`),
    q(`SELECT COALESCE(NULLIF(TRIM(imo.fantasy_name),''), NULLIF(TRIM(imo.name),''), '(sem imobiliária)') imob,
       COUNT(*) vendas, ROUND(SUM(eu.price)) vgv
       ${de("LEFT JOIN users imo ON imo.id = cli.vinculed_by_id")}
       AND ${VENDA} GROUP BY 1 ORDER BY vendas DESC, vgv DESC LIMIT 25`),
    q(`SELECT CASE WHEN ar.custom_commercial_plan = 1 THEN 'Plano customizado'
         WHEN UPPER(TRIM(COALESCE(cp.name,''))) IN ('PLANO NORMAL','NORMAL','PLANO-NORMAL') THEN 'Plano Normal'
         ELSE COALESCE(NULLIF(TRIM(cp.name),''), 'Sem plano') END plano, COUNT(*) qtd
       ${de("LEFT JOIN commercial_plans cp ON cp.id = ar.commercial_plan_id")}
       AND ${VENDA} GROUP BY 1 ORDER BY qtd DESC`),
    q(`SELECT COALESCE(ar.quantity_signal_parcels, 0) parcelas, COUNT(*) qtd
       ${de()} AND ${VENDA} GROUP BY 1 ORDER BY 1`),
    q(`SELECT COALESCE(sx.name, 'Não informado') k, COUNT(*) qtd
       ${de("LEFT JOIN sexes sx ON sx.id = cli.sex_id")}
       AND ${VENDA} GROUP BY 1 ORDER BY qtd DESC`),
    q(`SELECT COALESCE(cs.name, 'Não informado') k, COUNT(*) qtd
       ${de("LEFT JOIN civil_states cs ON cs.id = cli.civil_state_id")}
       AND ${VENDA} GROUP BY 1 ORDER BY qtd DESC`),
    q(`SELECT CASE
         WHEN cli.birthday IS NULL THEN 'Não informado'
         WHEN TIMESTAMPDIFF(YEAR, cli.birthday, CURDATE()) < 25 THEN 'Até 24'
         WHEN TIMESTAMPDIFF(YEAR, cli.birthday, CURDATE()) < 35 THEN '25 a 34'
         WHEN TIMESTAMPDIFF(YEAR, cli.birthday, CURDATE()) < 45 THEN '35 a 44'
         WHEN TIMESTAMPDIFF(YEAR, cli.birthday, CURDATE()) < 55 THEN '45 a 54'
         ELSE '55+' END k, COUNT(*) qtd ${de()} AND ${VENDA} GROUP BY 1`),
    q(`SELECT COALESCE(NULLIF(TRIM(p.name),''), 'Não informado') k, COUNT(*) qtd
       ${de("LEFT JOIN professions p ON p.id = cli.profession_id")}
       AND ${VENDA} GROUP BY 1 ORDER BY qtd DESC LIMIT 6`),
    q(`SELECT COALESCE(NULLIF(TRIM(sr.name),''), 'Não informado') k, COUNT(*) qtd
       ${de("LEFT JOIN salary_ranges sr ON sr.id = cli.salary_range_id")}
       AND ${VENDA} GROUP BY 1 ORDER BY qtd DESC`),
    q(`SELECT DATE_FORMAT(ar.created_at, '%H:00') hora, COUNT(*) qtd
       ${de()} AND ${VENDA} AND DATE(ar.created_at) = CURDATE() GROUP BY 1 ORDER BY 1`),
  ]);

  // Onde o comprador MORA (endereço real via addresses→cities, não a naturalidade).
  const cidades = await q(`SELECT CONCAT(ci.name, '/', st.acronym) k, COUNT(*) qtd
     ${de(`LEFT JOIN addresses ad ON ad.ownertable_type = 'User' AND ad.ownertable_id = cli.id
           LEFT JOIN cities ci ON ci.id = ad.city_id
           LEFT JOIN states st ON st.id = ad.state_id`)}
     AND ${VENDA} AND ci.name IS NOT NULL GROUP BY 1 ORDER BY qtd DESC LIMIT 6`);

  // Pós-venda e investidores (agregados leves; o CDN segura 60s).
  const [contratos, cobranca, investidores] = await Promise.all([
    q(`SELECT COUNT(DISTINCT arc.acquisition_request_id) gerados
       FROM acquisition_request_contracts arc
       JOIN acquisition_requests ar ON ar.id = arc.acquisition_request_id
       ${JOIN_UNIDADE}
       WHERE eu.enterprise_id IN (${LISTA_ENTERPRISES}) ${filtroCarteira} AND ${VENDA}`),
    // Entrada = Ato (1) + Sinal (2); liquidado = status 5. payment_to_delete fica de fora.
    q(`SELECT COUNT(DISTINCT p.acquisition_request_id) vendas_com_cobranca,
       ROUND(SUM(p.initial_value)) entrada_gerada,
       ROUND(SUM(CASE WHEN p.payment_status_id = 5 THEN COALESCE(p.paid_value, p.initial_value) ELSE 0 END)) liquidado
       FROM payments p
       JOIN acquisition_requests ar ON ar.id = p.acquisition_request_id
       ${JOIN_UNIDADE}
       WHERE eu.enterprise_id IN (${LISTA_ENTERPRISES}) ${filtroCarteira} AND ${VENDA}
         AND p.parcel_type_id IN (1, 2) AND COALESCE(p.payment_to_delete, 0) = 0`),
    q(`SELECT COUNT(*) titulares,
       SUM(CASE WHEN lotes >= 2 THEN 1 ELSE 0 END) multi_lote,
       SUM(CASE WHEN lotes >= 2 THEN lotes ELSE 0 END) unidades_multi,
       ROUND(SUM(CASE WHEN lotes >= 2 THEN vgv ELSE 0 END)) vgv_multi,
       MAX(lotes) maior_lotes
       FROM (SELECT ar.client_id, COUNT(*) lotes, SUM(eu.price) vgv ${de()} AND ${VENDA}
             GROUP BY ar.client_id) t`),
  ]);

  const u = unidades[0];

  return {
    carteira,
    cidades,
    cobranca: cobranca[0] ?? null,
    contratos: contratos[0] ?? null,
    estadoCivil,
    faixaSalarial,
    geradoEm: new Date().toISOString(),
    idades,
    investidores: investidores[0] ?? null,
    parcelasEntrada,
    planos,
    porTipo,
    profissoes,
    rankingImob,
    reservas: reservas[0] ?? null,
    sexo,
    statusUnidades,
    // Estoque separado: o painel fala dos COMERCIAIS; os não lançados ficam à vista, à parte.
    unidades: {
      comerciais: Number(u?.comerciais ?? 0),
      naoLancadas: Number(u?.nao_lancadas ?? 0),
      total: Number(u?.total ?? 0),
    },
    vendas: vendas[0] ?? null,
    vendasHoje,
  };
}
