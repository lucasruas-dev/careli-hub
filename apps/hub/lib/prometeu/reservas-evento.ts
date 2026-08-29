// RESERVA DE UNIDADE NO LANÇAMENTO — a tela touch (Lucas, 24/08/2026).
//
// O processo: bipa a etiqueta → escolhe QUADRA → marca os LOTES disponíveis → confirma →
// cupom com QR. A fonte das unidades é o EMPREENDIMENTO no C2X (enterprise_unities, read-only);
// a reserva do evento vive AQUI (prometeu_reservas), com trava por unidade, e é ela que pinta
// o telão em tempo quase real. O C2X recebe depois, por fora do caminho do evento.
//
// DISPONÍVEL = livre nos DOIS mundos: no C2X (sale_status_id = 1 Disponível, sem sale_blocked,
// sem acquisition_request aberta) E sem reserva viva do Panteon neste evento. Só esses aparecem
// na tela — reservado/vendido nem renderiza (decisão do Lucas, 24/08).
import { randomUUID } from "node:crypto";

import type { RowDataPacket } from "mysql2";

import { getHadesDbPool } from "@/lib/guardian/db";

import type { createPrometeuClient } from "./data";

type AdminClient = NonNullable<ReturnType<typeof createPrometeuClient>>;

export type UnidadeDisponivel = {
  area: string;
  c2xId: string;
  codigo: string;
  lote: string;
  preco: null | number;
  quadra: string;
};

export type QuadraDoEvento = {
  disponiveis: UnidadeDisponivel[];
  quadra: string;
};

// As funções PURAS do cupom/proponentes moram em cupom.ts (client-safe — este arquivo puxa
// mysql2 e NÃO pode entrar no bundle do navegador); reexportadas aqui para o servidor usar de
// um lugar só.
export {
  codigoDoCupom,
  conteudoDoQrDoCupom,
  ehIdDeCupom,
  MAX_PROPONENTES,
  normalizarCodigoDeUnidade,
  validarProponentes,
  type ProponenteDaReserva,
} from "./cupom";

import {
  normalizarCodigoDeUnidade,
  validarProponentes,
  type ProponenteDaReserva,
} from "./cupom";

// Ordena quadras e lotes com números de verdade ("2" antes de "10"), sem quebrar quadra-letra
// ("C01") — o formato varia por empreendimento (RVP usa letra na quadra).
function comparaNatural(a: string, b: string): number {
  return a.localeCompare(b, "pt-BR", { numeric: true, sensitivity: "base" });
}

/**
 * As quadras do empreendimento do evento com SÓ os lotes disponíveis para reserva.
 * Uma consulta no C2X + uma no Supabase por chamada — a tela faz poll leve (15s), nunca
 * consulta por clique (conexão com o legado é escassa).
 */
export async function quadrasDoEvento(
  client: AdminClient,
  evento: { enterpriseId: null | string; id: string },
): Promise<{ error?: string; quadras: QuadraDoEvento[] }> {
  const enterpriseId = Number(evento.enterpriseId);
  if (!Number.isFinite(enterpriseId) || enterpriseId <= 0) {
    return {
      error: "Evento sem empreendimento vinculado no Setup.",
      quadras: [],
    };
  }

  const poolResult = getHadesDbPool();
  if (!poolResult.ok) return { error: "C2X indisponível.", quadras: [] };

  let rows: RowDataPacket[];
  try {
    // Uma AR aberta (open=1) em QUALQUER etapa tira a unidade da prateleira — a etapa só diz
    // onde ela está na esteira, não se está livre (regra de reservas-c2x.ts).
    [rows] = await poolResult.pool.query<RowDataPacket[]>(
      `SELECT eu.id, eu.name, eu.block, eu.lot, eu.area, eu.price
         FROM enterprise_unities eu
        WHERE eu.enterprise_id = ?
          AND eu.sale_status_id = 1
          AND COALESCE(eu.sale_blocked, 0) = 0
          AND NOT EXISTS (
            SELECT 1 FROM acquisition_requests ar
             WHERE ar.enterprise_unity_id = eu.id AND ar.open = 1
          )
        ORDER BY eu.block, eu.lot`,
      [enterpriseId],
    );
  } catch (erro) {
    return {
      error: erro instanceof Error ? erro.message : String(erro),
      quadras: [],
    };
  }

  // Reservas VIVAS deste evento no Panteon: saem da prateleira na hora, sem esperar o C2X.
  const { data: vivas, error: erroVivas } = await client
    .from("prometeu_reservas")
    .select("codigo")
    .eq("evento_id", evento.id)
    .eq("situacao", "reservada");
  if (erroVivas) return { error: erroVivas.message, quadras: [] };

  const reservadosAqui = new Set(
    ((vivas ?? []) as { codigo: string }[]).map((r) =>
      normalizarCodigoDeUnidade(r.codigo),
    ),
  );

  const porQuadra = new Map<string, UnidadeDisponivel[]>();
  for (const r of rows as Array<Record<string, unknown>>) {
    const codigo = normalizarCodigoDeUnidade(String(r.name ?? ""));
    if (!codigo || reservadosAqui.has(codigo)) continue;
    const quadra = String(r.block ?? "").trim();
    const unidade: UnidadeDisponivel = {
      area: String(r.area ?? "").trim(),
      c2xId: String(r.id ?? ""),
      codigo,
      lote: String(r.lot ?? "").trim(),
      preco: r.price == null || r.price === "" ? null : Number(r.price),
      quadra,
    };
    const lista = porQuadra.get(quadra);
    if (lista) lista.push(unidade);
    else porQuadra.set(quadra, [unidade]);
  }

  const quadras = [...porQuadra.entries()]
    .map(([quadra, disponiveis]) => ({
      disponiveis: disponiveis.sort((a, b) => comparaNatural(a.lote, b.lote)),
      quadra,
    }))
    .sort((a, b) => comparaNatural(a.quadra, b.quadra));

  return { quadras };
}

export type NovaReserva = {
  credenciadoId: string;
  criadoPor: null | string;
  criadoPorNome: null | string;
  eventoId: string;
  proponentes: ProponenteDaReserva[];
  unidades: UnidadeDisponivel[];
};

/**
 * Confirma a reserva: uma LINHA por unidade, todas com o mesmo `grupo_id` (o cupom).
 * O insert é um batch único — atômico no PostgREST: se UMA unidade conflitar com a trava
 * (alguém confirmou o mesmo lote um segundo antes), NADA entra e devolvemos quais foram,
 * para o atendente refazer sem elas. Cupom pela metade não existe.
 */
export async function criarReservaDoEvento(
  client: AdminClient,
  entrada: NovaReserva,
): Promise<{ conflitos?: string[]; error?: string; grupoId?: string }> {
  if (entrada.unidades.length === 0) {
    return { error: "Selecione ao menos um lote." };
  }

  const erroProponentes = validarProponentes(entrada.proponentes);
  if (erroProponentes) return { error: erroProponentes };

  const grupoId = randomUUID();
  const linhas = entrada.unidades.map((u) => ({
    area: u.area || null,
    codigo: normalizarCodigoDeUnidade(u.codigo),
    credenciado_id: entrada.credenciadoId,
    criado_por: entrada.criadoPor,
    criado_por_nome: entrada.criadoPorNome,
    evento_id: entrada.eventoId,
    grupo_id: grupoId,
    lote: u.lote,
    preco_tabela: u.preco,
    proponentes: entrada.proponentes,
    quadra: u.quadra,
    situacao: "reservada",
    unidade_c2x_id: u.c2xId || null,
  }));

  const { error } = await client.from("prometeu_reservas").insert(linhas);
  if (!error) return { grupoId };

  // 23505 = a trava agiu. Descobre QUAIS lotes acabaram de sair para a mensagem ser útil.
  if (error.code === "23505") {
    const codigos = linhas.map((l) => l.codigo);
    const { data } = await client
      .from("prometeu_reservas")
      .select("codigo")
      .eq("evento_id", entrada.eventoId)
      .eq("situacao", "reservada")
      .in("codigo", codigos);
    const conflitos = ((data ?? []) as { codigo: string }[]).map(
      (r) => r.codigo,
    );
    return {
      conflitos,
      error: conflitos.length
        ? `Acabou de ser reservado: ${conflitos.join(", ")}. Refaça sem esse(s) lote(s).`
        : "Um dos lotes acabou de ser reservado. Atualize e tente de novo.",
    };
  }

  return { error: error.message };
}

export type ReservaDoCupom = {
  area: null | string;
  codigo: string;
  createdAt: string;
  credenciadoId: string;
  grupoId: string;
  id: string;
  lote: string;
  paImpressaEm: null | string;
  paImpressaVezes: number;
  precoTabela: null | number;
  proponentes: ProponenteDaReserva[];
  propostaLancadaEm: null | string;
  quadra: string;
  situacao: string;
};

/** As unidades de um cupom (grupo). Cancele-se uma linha e ela continua contando a história. */
export async function reservasDoGrupo(
  client: AdminClient,
  grupoId: string,
): Promise<{ error?: string; reservas: ReservaDoCupom[] }> {
  const { data, error } = await client
    .from("prometeu_reservas")
    .select(
      "id, grupo_id, credenciado_id, codigo, quadra, lote, area, preco_tabela, proponentes, situacao, pa_impressa_em, pa_impressa_vezes, proposta_lancada_em, created_at",
    )
    .eq("grupo_id", grupoId)
    .order("codigo", { ascending: true });
  if (error) return { error: error.message, reservas: [] };

  const reservas = ((data ?? []) as Array<Record<string, unknown>>).map(
    (r) => ({
      area: (r.area as null | string) ?? null,
      codigo: String(r.codigo ?? ""),
      createdAt: String(r.created_at ?? ""),
      credenciadoId: String(r.credenciado_id ?? ""),
      grupoId: String(r.grupo_id ?? ""),
      id: String(r.id ?? ""),
      lote: String(r.lote ?? ""),
      paImpressaEm: (r.pa_impressa_em as null | string) ?? null,
      paImpressaVezes: Number(r.pa_impressa_vezes ?? 0),
      precoTabela: r.preco_tabela == null ? null : Number(r.preco_tabela),
      proponentes: Array.isArray(r.proponentes)
        ? (r.proponentes as ProponenteDaReserva[])
        : [],
      propostaLancadaEm: (r.proposta_lancada_em as null | string) ?? null,
      quadra: String(r.quadra ?? ""),
      situacao: String(r.situacao ?? ""),
    }),
  );

  return { reservas };
}

export type ContadoresDoEvento = {
  finalizadas: number;
  propostas: number;
  reservas: number;
};

/**
 * O mini dash da tela touch: Reservas = cupons vivos · Propostas = cupons com proposta
 * lançada na SECRETÁRIA · Finalizadas = concluídos do funil (a proposta acontece dentro da
 * secretária — Lucas, 24/08).
 */
export async function contadoresDoEvento(
  client: AdminClient,
  eventoId: string,
): Promise<ContadoresDoEvento> {
  const [reservasRes, concluidosRes] = await Promise.all([
    client
      .from("prometeu_reservas")
      .select("grupo_id, situacao, proposta_lancada_em")
      .eq("evento_id", eventoId),
    client
      .from("prometeu_credenciados")
      .select("id", { count: "exact", head: true })
      .eq("evento_id", eventoId)
      .eq("etapa", "concluido"),
  ]);

  const linhas = (reservasRes.data ?? []) as Array<{
    grupo_id: string;
    proposta_lancada_em: null | string;
    situacao: string;
  }>;
  const gruposVivos = new Set<string>();
  const gruposComProposta = new Set<string>();
  for (const linha of linhas) {
    if (linha.situacao === "reservada") gruposVivos.add(linha.grupo_id);
    if (linha.proposta_lancada_em) gruposComProposta.add(linha.grupo_id);
  }

  return {
    finalizadas: concluidosRes.count ?? 0,
    propostas: gruposComProposta.size,
    reservas: gruposVivos.size,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// CANCELAR UMA RESERVA
//
// ⚠️ ISTO NÃO EXISTIA ATÉ 28/08/2026, e a falta doía: as colunas `situacao`, `cancelada_em` e
// `cancelada_motivo` estavam na migration 0101 desde o começo e NADA no código escrevia nelas.
// Um lote reservado por engano no salão só saía da prateleira por SQL na mão. O botão "cancelar"
// do tótem é outra coisa — ele abandona o atendimento ANTES de confirmar, e não desfaz reserva
// já gravada.
//
// É SOFT DELETE, e a trava do banco conta com isso: o índice único é parcial
// (`where situacao = 'reservada'`), então marcar como cancelada devolve o lote à prateleira na
// hora, sem apagar a história de que a reserva existiu. Quem reservou, quando, quais lotes e por
// que caiu — tudo fica.

export type ReservaCancelada = {
  codigos: string[];
  quantos: number;
};

/**
 * Cancela TODAS as linhas de um grupo (um cupom = um grupo = N lotes).
 *
 * Cancela o grupo inteiro de propósito: o cupom é indivisível para o cliente — ele levou UM
 * papel com três lotes, e "cancelar dois dos três" não é uma operação que exista no salão. Se um
 * dia precisar, será outra função, com outro nome.
 *
 * Idempotente: cancelar de novo o que já está cancelado não é erro, é resultado zero. O
 * operador pode bipar duas vezes sem susto.
 */
export async function cancelarReservaDoGrupo(
  client: AdminClient,
  entrada: {
    canceladoPor: null | string;
    grupoId: string;
    motivo: null | string;
  },
): Promise<{ error?: string; resultado?: ReservaCancelada }> {
  const grupoId = String(entrada.grupoId ?? "").trim();
  if (!grupoId) return { error: "Informe a reserva a cancelar." };

  const motivo = String(entrada.motivo ?? "").trim();

  const { data, error } = await client
    .from("prometeu_reservas")
    .update({
      cancelada_em: new Date().toISOString(),
      // Quem cancelou vai junto do motivo: a coluna de autor é do CRIADOR da reserva, e
      // sobrescrevê-la apagaria quem fez a reserva original.
      cancelada_motivo: entrada.canceladoPor
        ? `${motivo || "Sem motivo informado"} (por ${entrada.canceladoPor})`
        : motivo || null,
      situacao: "cancelada",
    })
    .eq("grupo_id", grupoId)
    // ⚠️ Só as VIVAS. Sem isto, recancelar carimbaria uma data nova por cima da original e
    // apagaria quando a reserva realmente caiu.
    .eq("situacao", "reservada")
    .select("codigo");

  if (error) return { error: error.message };

  const codigos = ((data ?? []) as { codigo: string }[]).map((r) => r.codigo);
  return { resultado: { codigos, quantos: codigos.length } };
}

/** As reservas de um evento, para a tela que lista e cancela. */
export type ReservaDoEvento = {
  canceladaEm: null | string;
  canceladaMotivo: null | string;
  cliente: null | string;
  criadaEm: string;
  grupoId: string;
  lotes: string[];
  origem: null | string;
  paImpressaEm: null | string;
  propostaLancadaEm: null | string;
  situacao: string;
};

export async function reservasDoEvento(
  client: AdminClient,
  eventoId: string,
): Promise<{ error?: string; reservas?: ReservaDoEvento[] }> {
  const { data, error } = await client
    .from("prometeu_reservas")
    .select(
      "grupo_id, codigo, quadra, lote, situacao, proponentes, cancelada_em, cancelada_motivo, pa_impressa_em, proposta_lancada_em, created_at",
    )
    .eq("evento_id", eventoId)
    .order("created_at", { ascending: false });

  if (error) return { error: error.message };

  // Uma linha por LOTE no banco, uma linha por CUPOM na tela: é o cupom que o operador tem na
  // mão quando vem cancelar.
  const porGrupo = new Map<string, ReservaDoEvento>();
  for (const linha of (data ?? []) as Array<Record<string, unknown>>) {
    const grupoId = String(linha.grupo_id ?? "");
    if (!grupoId) continue;
    const rotulo =
      `${String(linha.quadra ?? "").trim()} ${String(linha.lote ?? "").trim()}`.trim();
    const existente = porGrupo.get(grupoId);
    if (existente) {
      existente.lotes.push(rotulo);
      continue;
    }
    const proponentes = Array.isArray(linha.proponentes)
      ? (linha.proponentes as Array<{
          nome?: null | string;
          origem?: null | string;
        }>)
      : [];
    porGrupo.set(grupoId, {
      canceladaEm: (linha.cancelada_em as null | string) ?? null,
      canceladaMotivo: (linha.cancelada_motivo as null | string) ?? null,
      cliente: String(proponentes[0]?.nome ?? "").trim() || null,
      criadaEm: String(linha.created_at ?? ""),
      grupoId,
      lotes: [rotulo],
      origem: String(proponentes[0]?.origem ?? "").trim() || null,
      paImpressaEm: (linha.pa_impressa_em as null | string) ?? null,
      propostaLancadaEm: (linha.proposta_lancada_em as null | string) ?? null,
      situacao: String(linha.situacao ?? ""),
    });
  }

  return { reservas: [...porGrupo.values()] };
}
