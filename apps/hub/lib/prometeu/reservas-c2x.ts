// AS RESERVAS DO DIA VÊM DO C2X — o hub não registra nenhuma.
//
// Regra do Lucas (01/08, evento rodando): "esses dados vem tudo do C2X, nada é feito no hub".
// O corretor lança o pedido de aquisição lá; aqui a gente só reflete, para o salão e a gestão
// enxergarem em tempo real quem está com unidade na mão.
//
// ⚠️ O CICLO É DINÂMICO, e é isso que define a leitura: uma unidade pode ser reservada, cair
// (cancelada) e ser reservada de novo por outra pessoa no mesmo dia. Visto ao vivo hoje na
// VLO0324 — reservada 9:25, cancelada, e às 10:47 outro cliente pegou. Por isso:
//
//   · A VERDADE É `open = 1`. Não é o `sale_status_id` da unidade (que descreve a unidade, não
//     quem a pegou) e não é só a etapa (um pedido cancelado continua com a etapa gravada).
//   · Uma unidade tem VÁRIOS pedidos ao longo do dia; só o aberto vale.
//   · Uma pessoa pode ter VÁRIAS unidades (26 dos 52 clientes de hoje pegaram mais de uma).
//
// Estado real do evento quando isto foi escrito: 99 "Reservado" + 8 "Contrato gerado" +
// 1 "Proposta realizada" com open=1, e 13 cancelados com open=0.
import { getHadesDbPool } from "@/lib/guardian/db";
import type { RowDataPacket } from "mysql2";

// A aba Reservas mostra SÓ quem está com reserva de pé (decisão do Lucas). Quem já virou contrato
// ou proposta andou na esteira e não é mais "reserva parada" — que é o que a tela cobra.
const ETAPA_RESERVADO = "Reservado";

export type ReservaDoC2x = {
  // Quando o pedido foi aberto no C2X: é daqui que sai "há quanto tempo está parada".
  criadoEm: string;
  cpf: string;
  cliente: string;
  corretor: string | null;
  lote: string;
  quadra: string;
  // Código da unidade no padrão da casa (VLO0212).
  unidade: string;
};

// Todas as reservas VIVAS de um empreendimento. Só leitura no legado, como manda a regra do C2X.
export async function reservasVivasDoC2x(
  enterpriseId: number,
): Promise<{ error?: string; reservas: ReservaDoC2x[] }> {
  const poolResult = getHadesDbPool();
  if (!poolResult.ok) return { error: "C2X indisponível.", reservas: [] };

  const semMascara = "REPLACE(REPLACE(REPLACE(u.cpf,'.',''),'-',''),'/','')";

  try {
    const [rows] = await poolResult.pool.query<RowDataPacket[]>(
      `SELECT ${semMascara} AS cpf,
              u.name        AS cliente,
              cor.name      AS corretor,
              eu.name       AS unidade,
              eu.block      AS quadra,
              eu.lot        AS lote,
              ar.created_at AS criado_em
         FROM acquisition_requests ar
         JOIN enterprise_unities eu ON eu.id = ar.enterprise_unity_id
         JOIN acquisition_request_stages s ON s.id = ar.acquisition_request_stage_id
         LEFT JOIN users u   ON u.id   = ar.client_id
         LEFT JOIN users cor ON cor.id = ar.corretor_id
        WHERE eu.enterprise_id = ?
          AND ar.open = 1
          AND s.name = ?
        ORDER BY ar.created_at ASC`,
      [enterpriseId, ETAPA_RESERVADO],
    );

    const reservas = (rows as Array<Record<string, unknown>>).map((r) => ({
      cliente: String(r.cliente ?? "").trim(),
      corretor: r.corretor ? String(r.corretor).trim() : null,
      cpf: String(r.cpf ?? "").replace(/\D/g, ""),
      criadoEm: String(r.criado_em ?? ""),
      lote: String(r.lote ?? "").trim(),
      quadra: String(r.quadra ?? "").trim(),
      unidade: String(r.unidade ?? "").trim(),
    }));

    return { reservas };
  } catch (erro) {
    return {
      error: erro instanceof Error ? erro.message : String(erro),
      reservas: [],
    };
  }
}

export type ClienteComReserva = {
  cpf: string;
  cliente: string;
  corretor: string | null;
  // A mais ANTIGA das reservas dele: é ela que define há quanto tempo está parado.
  desde: string;
  unidades: string[];
};

// Agrupa por CLIENTE, porque a aba lista pessoas, não unidades — e metade dos clientes de hoje
// pegou mais de um lote. As unidades viram chips na linha da pessoa.
export function agruparPorCliente(reservas: ReservaDoC2x[]): ClienteComReserva[] {
  const porCpf = new Map<string, ClienteComReserva>();

  for (const r of reservas) {
    if (!r.cpf) continue;
    const atual = porCpf.get(r.cpf);
    if (!atual) {
      porCpf.set(r.cpf, {
        cliente: r.cliente,
        corretor: r.corretor,
        cpf: r.cpf,
        desde: r.criadoEm,
        unidades: [r.unidade],
      });
      continue;
    }
    atual.unidades.push(r.unidade);
    // A lista vem ordenada por data, mas não custa manter a mais antiga de forma explícita.
    if (r.criadoEm < atual.desde) atual.desde = r.criadoEm;
    if (!atual.corretor && r.corretor) atual.corretor = r.corretor;
  }

  return [...porCpf.values()].sort((a, b) => a.desde.localeCompare(b.desde));
}
