// O ESTADO DO MAPA PARA O TELÃO DO LANÇAMENTO.
//
// Junta os dois mundos numa única resposta enxuta: o C2X diz o que já estava vendido, em
// negociação ou bloqueado ANTES do evento; o Panteon diz o que foi reservado no salão HÁ
// SEGUNDOS. A regra de precedência mora em situacao-do-lote.ts, com testes.
//
// ⚠️ O QUE SAI DAQUI É PÚBLICO. Esta resposta viaja por um link sem login, para um computador
// de terceiro, e é projetada para o salão inteiro. Por isso ela carrega SÓ o nome da unidade e
// UMA palavra de situação — nunca comprador, nunca valor, nunca corretor. Se algum dia alguém
// precisar de mais campo aqui, a pergunta certa é se essa tela ainda pode ser pública.
import type { RowDataPacket } from "mysql2";

import { getHadesDbPool } from "@/lib/guardian/db";

import { normalizarCodigoDeUnidade } from "./cupom";
import type { createPrometeuClient } from "./data";
import {
  contarSituacoes,
  situacaoDoLote,
  type SituacaoDoLote,
} from "./situacao-do-lote";

type AdminClient = NonNullable<ReturnType<typeof createPrometeuClient>>;

export type MasterplanDoEvento = {
  /** ISO — o telão mostra discretamente, para ninguém projetar mapa congelado sem perceber. */
  atualizadoEm: string;
  contagem: Record<SituacaoDoLote, number>;
  /** { "RVPA01": "disponivel", ... } — nome da unidade para situação, e nada mais. */
  lotes: Record<string, SituacaoDoLote>;
};

export async function masterplanDoEvento(
  client: AdminClient,
  evento: {
    config?: null | Record<string, unknown>;
    enterpriseId: null | string;
    id: string;
  },
): Promise<{ dados?: MasterplanDoEvento; error?: string }> {
  const enterpriseId = Number(evento.enterpriseId);
  if (!Number.isFinite(enterpriseId) || enterpriseId <= 0) {
    return { error: "Evento sem empreendimento vinculado no Setup." };
  }

  const poolResult = getHadesDbPool();
  if (!poolResult.ok) return { error: "C2X indisponível." };

  let rows: RowDataPacket[];
  try {
    // TODAS as unidades, e não só as disponíveis: o telão precisa pintar o mapa inteiro, ao
    // contrário da tela de reserva, que só lista o que dá para reservar.
    [rows] = await poolResult.pool.query<RowDataPacket[]>(
      `SELECT eu.name,
              eu.sale_status_id,
              COALESCE(eu.sale_blocked, 0) AS sale_blocked,
              EXISTS (
                SELECT 1 FROM acquisition_requests ar
                 WHERE ar.enterprise_unity_id = eu.id AND ar.open = 1
              ) AS ar_aberta
         FROM enterprise_unities eu
        WHERE eu.enterprise_id = ?`,
      [enterpriseId],
    );
  } catch (erro) {
    return { error: erro instanceof Error ? erro.message : String(erro) };
  }

  const { data: vivas, error: erroVivas } = await client
    .from("prometeu_reservas")
    .select("codigo")
    .eq("evento_id", evento.id)
    .eq("situacao", "reservada");
  if (erroVivas) return { error: erroVivas.message };

  const reservadosAqui = new Set(
    ((vivas ?? []) as { codigo: string }[]).map((r) =>
      normalizarCodigoDeUnidade(r.codigo),
    ),
  );

  // ⚠️ A TRAVA DO PANTEON, aplicada por cima do C2X. Lote vendido/permutado que nunca entrou na
  // carga do legado ficaria SEM COR no mapa — e lote sem cor no telao e lido como "disponivel,
  // o sistema e que falhou". Marcar aqui pinta de indisponivel sem tocar no legado, e some da
  // lista quando o cadastro chegar. Ver `lotesBloqueados` em PrometeuEventoConfig.
  const travados = new Set(
    (Array.isArray(evento.config?.lotesBloqueados)
      ? (evento.config.lotesBloqueados as unknown[])
      : []
    )
      .map((c) => normalizarCodigoDeUnidade(String(c ?? "")))
      .filter(Boolean),
  );

  const lotes: Record<string, SituacaoDoLote> = {};
  for (const r of rows as Array<Record<string, unknown>>) {
    const codigo = normalizarCodigoDeUnidade(String(r.name ?? ""));
    if (!codigo) continue;
    if (travados.has(codigo)) {
      lotes[codigo] = "indisponivel";
      continue;
    }
    lotes[codigo] = situacaoDoLote({
      // O MySQL devolve o EXISTS como 0/1, não como booleano.
      arAberta: Number(r.ar_aberta ?? 0) === 1,
      reservadoNoPanteon: reservadosAqui.has(codigo),
      saleBlocked: Number(r.sale_blocked ?? 0) === 1,
      saleStatusId: r.sale_status_id == null ? null : Number(r.sale_status_id),
    });
  }

  // Os travados que NAO existem no C2X entram aqui: sem isto o mapa nao teria a chave e o
  // telao continuaria sem pintar justamente o lote que se quis bloquear.
  for (const codigo of travados) {
    if (!lotes[codigo]) lotes[codigo] = "indisponivel";
  }

  return {
    dados: {
      atualizadoEm: new Date().toISOString(),
      contagem: contarSituacoes(Object.values(lotes)),
      lotes,
    },
  };
}
