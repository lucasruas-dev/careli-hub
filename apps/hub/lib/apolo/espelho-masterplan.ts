import type { RowDataPacket } from "mysql2/promise";

import { getHadesDbPool } from "@/lib/guardian/db";

// ESPELHO DO MASTERPLAN — mantém o mapa que o CORRETOR vê refletindo as vendas reais.
//
// O DESENHO (Lucas, 03/08): o Vale do Ouro é UM produto para o mercado, mas DUAS empresas por
// dentro — cada lote pertence ao Cecílio (VOC) ou ao Lino (VOL), e o contrato/pagamento roda no
// empreendimento da dona, porque as contas de recebimento são diferentes.
//   • VLO (35) = o MASTERPLAN. É o `show_map/35` do C2X, que pinta cada lote do SVG pelo
//     `sale_status_id` da unidade DO 35. O corretor só conhece este mapa.
//   • VOC (37) / VOL (36) = onde a venda acontece de verdade.
// Sem espelho, vender no VOC não muda a cor no mapa: o corretor vê verde num lote já vendido e
// oferece de novo. Por isso a atualização é quase em tempo real (checagem de 1 em 1 minuto).
//
// ⚠️ ESCRITA NO LEGADO — a exceção autorizada. Só duas colunas (`sale_status_id`,
// `sale_blocked`), só nas 298 unidades do 35, e só quando DIVERGEM da carteira. Em dia parado
// não escreve nada: a checagem é um SELECT de comparação.
const MASTERPLAN = 35;
const CARTEIRAS = [36, 37];

type Divergente = RowDataPacket & {
  id: number;
  nome: string;
  status_atual: number | null;
  status_novo: number | null;
  blocked_novo: number | null;
};

export type ResultadoEspelho = {
  atualizadas: number;
  detalhe: { de: number | null; nome: string; para: number | null }[];
  error?: string;
  ok: boolean;
  verificadas: number;
};

export async function espelharMasterplan(): Promise<ResultadoEspelho> {
  const poolResult = getHadesDbPool();
  if (!poolResult.ok) {
    return { atualizadas: 0, detalhe: [], error: "C2X indisponível.", ok: false, verificadas: 0 };
  }
  const { pool } = poolResult;

  // UMA query acha as divergentes: casa master × carteira por (quadra, lote). Sem diferença,
  // volta vazia e o minuto custa só isto.
  const [divergentes] = await pool.query<Divergente[]>(
    `SELECT m.id, m.name AS nome,
            m.sale_status_id AS status_atual,
            c.sale_status_id AS status_novo,
            c.sale_blocked AS blocked_novo
       FROM enterprise_unities m
       JOIN enterprise_unities c
         ON TRIM(c.block) = TRIM(m.block)
        AND TRIM(c.lot) = TRIM(m.lot)
        AND c.enterprise_id IN (${CARTEIRAS.join(",")})
      WHERE m.enterprise_id = ${MASTERPLAN}
        AND (m.sale_status_id <> c.sale_status_id OR m.sale_blocked <> c.sale_blocked)`,
  );

  for (const d of divergentes) {
    await pool.query(
      "UPDATE enterprise_unities SET sale_status_id = ?, sale_blocked = ? WHERE id = ?",
      [d.status_novo, d.blocked_novo, d.id],
    );
  }

  const [[contagem]] = await pool.query<(RowDataPacket & { n: number })[]>(
    `SELECT COUNT(*) n FROM enterprise_unities WHERE enterprise_id = ${MASTERPLAN}`,
  );

  return {
    atualizadas: divergentes.length,
    detalhe: divergentes.map((d) => ({ de: d.status_atual, nome: d.nome, para: d.status_novo })),
    ok: true,
    verificadas: contagem?.n ?? 0,
  };
}
