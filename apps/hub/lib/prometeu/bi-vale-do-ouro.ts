import type { RowDataPacket } from "mysql2/promise";

import { getHadesDbPool } from "@/lib/guardian/db";

// Agregados do BI PÚBLICO de vendas do Vale do Ouro (enterprise 35), direto do C2X read-only.
// TUDO agregado — nenhum nome/documento de comprador sai daqui (a página é pública). Nomes de
// IMOBILIÁRIA são públicos por natureza (ranking do lançamento).
// VENDA = pedido aberto em Contrato gerado (3) ou Proposta realizada (9); RESERVA = etapa 1.
// Ver docs/architecture/c2x-schema-map.md e [[project_apolo_diagnostico_mostqi]].

// A FAMÍLIA VALE DO OURO no C2X (divisão de 03/08, padrão Lagoa Bonita):
//   35 VLO — o master histórico (unidades aposentadas, propostas migradas para os dois abaixo)
//   36 VOL — carteira do Lino    (unidades "externas")
//   37 VOC — carteira do Cecílio (unidades "internas")
// O BI soma os TRÊS: para o mercado é UM lançamento. O 35 fica na lista para não perder nada
// que eventualmente nasça lá (hoje tem 0 propostas).
const ENTERPRISES = [35, 36, 37] as const;
const LISTA_ENTERPRISES = ENTERPRISES.join(", ");
// Para CONTAR UNIDADES, só as vivas (36 e 37): as 298 do 35 são as MESMAS unidades, agora
// aposentadas (sale_blocked). Somar os três dobraria o empreendimento — "mapa das 596 unidades".
const LISTA_UNIDADES_VIVAS = "36, 37";
const VENDA = "ar.open = 1 AND ar.acquisition_request_stage_id IN (3, 9)";
const BASE = `FROM acquisition_requests ar
  JOIN enterprise_unities eu ON eu.id = ar.enterprise_unity_id
  LEFT JOIN users cli ON cli.id = ar.client_id
  WHERE eu.enterprise_id IN (${LISTA_ENTERPRISES})`;

type Linha = RowDataPacket & Record<string, unknown>;

export type BiValeDoOuro = Awaited<ReturnType<typeof montarBiValeDoOuro>>;

export async function montarBiValeDoOuro() {
  const poolResult = getHadesDbPool();
  if (!poolResult.ok) throw new Error("C2X indisponível.");
  const { pool } = poolResult;

  const q = async (sql: string): Promise<Linha[]> => {
    const [rows] = await pool.query<Linha[]>(sql);
    return rows;
  };

  const [
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
    q(`SELECT ss.name status, COUNT(*) qtd, ROUND(SUM(eu.price)) vgv
       FROM enterprise_unities eu LEFT JOIN sale_statuses ss ON ss.id = eu.sale_status_id
       WHERE eu.enterprise_id IN (${LISTA_UNIDADES_VIVAS}) GROUP BY ss.name`),
    q(`SELECT COUNT(DISTINCT ar.enterprise_unity_id) unidades, ROUND(SUM(eu.price)) vgv,
       ROUND(AVG(eu.price)) ticket ${BASE} AND ${VENDA}`),
    q(`SELECT COUNT(DISTINCT ar.enterprise_unity_id) unidades, ROUND(SUM(eu.price)) vgv
       ${BASE} AND ar.open = 1 AND ar.acquisition_request_stage_id = 1`),
    // O DUELO agora vem do EMPREENDIMENTO (a divisão real de 03/08), não mais do campo de tipo
    // da unidade — que era só a marcação provisória usada enquanto tudo vivia no VLO. As chaves
    // "interna"/"externa" ficam porque é o que a página do BI já procura (VOC=Cecílio/interna,
    // VOL=Lino/externa); o fallback cobre o que porventura sobre no 35.
    q(`SELECT CASE eu.enterprise_id
           WHEN 37 THEN 'Unidade interna'
           WHEN 36 THEN 'Unidade externa'
           ELSE COALESCE(t.name, 'Unidade interna') END tipo,
         COUNT(*) vendas, ROUND(SUM(eu.price)) vgv, ROUND(AVG(eu.price)) ticket
       ${BASE.replace("WHERE", "LEFT JOIN enterprise_unity_types t ON t.id = eu.enterprise_unity_type_id WHERE")}
       AND ${VENDA} GROUP BY 1`),
    q(`SELECT COALESCE(NULLIF(TRIM(imo.fantasy_name),''), NULLIF(TRIM(imo.name),''), '(sem imobiliária)') imob,
       COUNT(*) vendas, ROUND(SUM(eu.price)) vgv
       ${BASE.replace("WHERE", "LEFT JOIN users imo ON imo.id = cli.vinculed_by_id WHERE")}
       AND ${VENDA} GROUP BY 1 ORDER BY vendas DESC, vgv DESC LIMIT 25`),
    q(`SELECT CASE WHEN ar.custom_commercial_plan = 1 THEN 'Plano customizado'
         WHEN UPPER(TRIM(COALESCE(cp.name,''))) IN ('PLANO NORMAL','NORMAL','PLANO-NORMAL') THEN 'Plano Normal'
         ELSE COALESCE(NULLIF(TRIM(cp.name),''), 'Sem plano') END plano, COUNT(*) qtd
       ${BASE.replace("WHERE", "LEFT JOIN commercial_plans cp ON cp.id = ar.commercial_plan_id WHERE")}
       AND ${VENDA} GROUP BY 1 ORDER BY qtd DESC`),
    q(`SELECT COALESCE(ar.quantity_signal_parcels, 0) parcelas, COUNT(*) qtd
       ${BASE} AND ${VENDA} GROUP BY 1 ORDER BY 1`),
    q(`SELECT COALESCE(sx.name, 'Não informado') k, COUNT(*) qtd
       ${BASE.replace("WHERE", "LEFT JOIN sexes sx ON sx.id = cli.sex_id WHERE")}
       AND ${VENDA} GROUP BY 1 ORDER BY qtd DESC`),
    q(`SELECT COALESCE(cs.name, 'Não informado') k, COUNT(*) qtd
       ${BASE.replace("WHERE", "LEFT JOIN civil_states cs ON cs.id = cli.civil_state_id WHERE")}
       AND ${VENDA} GROUP BY 1 ORDER BY qtd DESC`),
    q(`SELECT CASE
         WHEN cli.birthday IS NULL THEN 'Não informado'
         WHEN TIMESTAMPDIFF(YEAR, cli.birthday, CURDATE()) < 25 THEN 'Até 24'
         WHEN TIMESTAMPDIFF(YEAR, cli.birthday, CURDATE()) < 35 THEN '25 a 34'
         WHEN TIMESTAMPDIFF(YEAR, cli.birthday, CURDATE()) < 45 THEN '35 a 44'
         WHEN TIMESTAMPDIFF(YEAR, cli.birthday, CURDATE()) < 55 THEN '45 a 54'
         ELSE '55+' END k, COUNT(*) qtd ${BASE} AND ${VENDA} GROUP BY 1`),
    q(`SELECT COALESCE(NULLIF(TRIM(p.name),''), 'Não informado') k, COUNT(*) qtd
       ${BASE.replace("WHERE", "LEFT JOIN professions p ON p.id = cli.profession_id WHERE")}
       AND ${VENDA} GROUP BY 1 ORDER BY qtd DESC LIMIT 6`),
    q(`SELECT COALESCE(NULLIF(TRIM(sr.name),''), 'Não informado') k, COUNT(*) qtd
       ${BASE.replace("WHERE", "LEFT JOIN salary_ranges sr ON sr.id = cli.salary_range_id WHERE")}
       AND ${VENDA} GROUP BY 1 ORDER BY qtd DESC`),
    q(`SELECT DATE_FORMAT(ar.created_at, '%H:00') hora, COUNT(*) qtd
       ${BASE} AND ${VENDA} AND DATE(ar.created_at) = CURDATE() GROUP BY 1 ORDER BY 1`),
  ]);

  // Onde o comprador MORA (endereço real via addresses→cities, não a naturalidade).
  const cidades = await q(`SELECT CONCAT(ci.name, '/', st.acronym) k, COUNT(*) qtd
     ${BASE.replace(
       "WHERE",
       `LEFT JOIN addresses ad ON ad.ownertable_type = 'User' AND ad.ownertable_id = cli.id
        LEFT JOIN cities ci ON ci.id = ad.city_id
        LEFT JOIN states st ON st.id = ad.state_id WHERE`,
     )} AND ${VENDA} AND ci.name IS NOT NULL GROUP BY 1 ORDER BY qtd DESC LIMIT 6`);

  // Pós-venda e investidores (agregados leves; o CDN segura 60s).
  const [contratos, cobranca, investidores] = await Promise.all([
    q(`SELECT COUNT(DISTINCT arc.acquisition_request_id) gerados
       FROM acquisition_request_contracts arc
       JOIN acquisition_requests ar ON ar.id = arc.acquisition_request_id
       JOIN enterprise_unities eu ON eu.id = ar.enterprise_unity_id
       WHERE eu.enterprise_id IN (${LISTA_ENTERPRISES}) AND ${VENDA}`),
    // Entrada = Ato (1) + Sinal (2); liquidado = status 5. payment_to_delete fica de fora.
    q(`SELECT COUNT(DISTINCT p.acquisition_request_id) vendas_com_cobranca,
       ROUND(SUM(p.initial_value)) entrada_gerada,
       ROUND(SUM(CASE WHEN p.payment_status_id = 5 THEN COALESCE(p.paid_value, p.initial_value) ELSE 0 END)) liquidado
       FROM payments p
       JOIN acquisition_requests ar ON ar.id = p.acquisition_request_id
       JOIN enterprise_unities eu ON eu.id = ar.enterprise_unity_id
       WHERE eu.enterprise_id IN (${LISTA_ENTERPRISES}) AND ${VENDA}
         AND p.parcel_type_id IN (1, 2) AND COALESCE(p.payment_to_delete, 0) = 0`),
    q(`SELECT COUNT(*) titulares,
       SUM(CASE WHEN lotes >= 2 THEN 1 ELSE 0 END) multi_lote,
       SUM(CASE WHEN lotes >= 2 THEN lotes ELSE 0 END) unidades_multi,
       ROUND(SUM(CASE WHEN lotes >= 2 THEN vgv ELSE 0 END)) vgv_multi,
       MAX(lotes) maior_lotes
       FROM (SELECT ar.client_id, COUNT(*) lotes, SUM(eu.price) vgv ${BASE} AND ${VENDA}
             GROUP BY ar.client_id) t`),
  ]);

  return {
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
    vendas: vendas[0] ?? null,
    vendasHoje,
  };
}
