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

// Fuso de Brasília, fixo: o país não tem horário de verão desde 2019, então -03:00 vale o ano
// inteiro. Se algum dia voltar, este é o único ponto a mexer.
const FUSO_BRASILIA = "-03:00";

// Converte o horário que o C2X gravou (relógio de Brasília, sem fuso) no instante de verdade.
// ⚠️ Sem isto o valor é lido como UTC e todo cálculo de "há quanto tempo" erra em 3 horas.
export function paraInstante(textoDoC2x: string): string {
  const limpo = String(textoDoC2x ?? "").trim();
  if (!limpo) return "";
  // Já veio com fuso (algum caminho que não passou pelo DATE_FORMAT): respeita o que veio.
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(limpo)) return new Date(limpo).toISOString();
  const iso = limpo.replace(" ", "T").slice(0, 19);
  const instante = new Date(`${iso}${FUSO_BRASILIA}`);
  return Number.isNaN(instante.getTime()) ? "" : instante.toISOString();
}

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
      // ⚠️ `DATE_FORMAT` em vez de devolver o DATETIME cru — e a razão é um erro de 3 HORAS que
      // esteve no ar. O servidor do C2X roda em UTC, mas a APLICAÇÃO Rails grava o horário de
      // BRASÍLIA dentro de um DATETIME (que não carrega fuso nenhum). O pool do Hades usa
      // `timezone: "Z"` (db.ts:123), então o driver lia "17:17" como 17:17 UTC = 14:17 aqui —
      // e a coluna "tempo na reserva" mostrava 20h46 onde o certo era 17h46.
      //
      // Medido em 22/08/2026 com três âncoras que fecham a sequência do mesmo cliente:
      // check-in no Prometeu 09:13 (Postgres, timestamptz) → reserva no C2X 09:25 → contrato
      // 10:01 → concluído 10:09. Lendo como UTC, a reserva cairia às 06:25, antes do check-in.
      //
      // Não dá para arrumar no pool: ele é o mesmo da cobrança do Hades, e mexer no fuso ali
      // moveria data de parcela e de contrato. Então a data sai daqui como TEXTO e o fuso é
      // colado explicitamente em `paraInstante`.
      `SELECT ${semMascara} AS cpf,
              u.name        AS cliente,
              cor.name      AS corretor,
              eu.name       AS unidade,
              eu.block      AS quadra,
              eu.lot        AS lote,
              DATE_FORMAT(ar.created_at, '%Y-%m-%dT%H:%i:%s') AS criado_em
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
      criadoEm: paraInstante(String(r.criado_em ?? "")),
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
