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

// O código normalizado é a CHAVE da trava única (evento_id, codigo). "vlo0212 " e "VLO0212"
// têm que colidir — por isso a normalização mora aqui e TODO gravador passa por ela.
export function normalizarCodigoDeUnidade(codigo: string): string {
  return String(codigo ?? "").trim().toUpperCase();
}

// Cupom: mesmo desenho da credencial (credencial.ts) — o QR carrega o grupo_id CRU (uuid, sem
// URL: papel fotografado não abre nada fora do app), e o código curto é o plano B digitável.
export function conteudoDoQrDoCupom(grupoId: string): string {
  return grupoId;
}

export function codigoDoCupom(grupoId: string): string {
  return `RSV-${grupoId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

export function ehIdDeCupom(lido: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(lido ?? "").trim(),
  );
}

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
    return { error: "Evento sem empreendimento vinculado no Setup.", quadras: [] };
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
    ((vivas ?? []) as { codigo: string }[]).map((r) => normalizarCodigoDeUnidade(r.codigo)),
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

// Até 5 proponentes por reserva (limite do C2X — Lucas, 24/08); com mais de um, a % de
// participação é obrigatória e a soma fecha 100. O 1º é o titular (o credenciado da linha).
export type ProponenteDaReserva = {
  credenciadoId: string;
  documento: null | string;
  nome: string;
  percentual: number;
};

export const MAX_PROPONENTES = 5;

export function validarProponentes(
  proponentes: ProponenteDaReserva[],
): null | string {
  if (proponentes.length === 0) return "Informe ao menos um proponente.";
  if (proponentes.length > MAX_PROPONENTES) {
    return `No máximo ${MAX_PROPONENTES} proponentes (limite do C2X).`;
  }
  const ids = new Set(proponentes.map((p) => p.credenciadoId));
  if (ids.size !== proponentes.length) return "Proponente repetido.";
  const soma = proponentes.reduce((total, p) => total + p.percentual, 0);
  if (Math.abs(soma - 100) > 0.05) {
    return `A participação precisa somar 100% (está em ${soma.toFixed(1)}%).`;
  }
  if (proponentes.some((p) => p.percentual <= 0)) {
    return "Todo proponente precisa de participação maior que zero.";
  }
  return null;
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
    const conflitos = ((data ?? []) as { codigo: string }[]).map((r) => r.codigo);
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

  const reservas = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
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
  }));

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
