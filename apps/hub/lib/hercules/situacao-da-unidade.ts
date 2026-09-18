import type { SupabaseClient } from "@supabase/supabase-js";

import { type EtapaDoEspelho, type EtapaDoFluxo, ETAPAS_DO_FLUXO } from "./fluxo-de-venda";

// A SITUAÇÃO DA UNIDADE — UM LUGAR SÓ.
//
// Lucas (18/09/2026): *"estou tendo status de unidades diferentes dentro do panteon. Tem unidades
// que estão com reserva, proposta no hercules, que dentro de unidade do apolo não estão com o mesmo
// status. Novamente, esses status tem que morar em um so lugar"* · *"no c2x não precisa olhar"* ·
// *"se eu precisar atualizar eu faço um sync"* · *"quero é dentro do panteon tem que ter o mesmo
// status"*.
//
// ⚠️ O QUE HAVIA ANTES DESTE ARQUIVO: TRÊS RÉGUAS. Medido em 18/09/2026 em 4.819 unidades vivas:
//   1. a tela Venda pintava pelo PROCESSO do Hércules (proposta viva > reserva > cadastro);
//   2. a aba Unidades e o masterplan do Apolo, os cards de Produtos e o telão liam o `sale_status_id`
//      do C2X — e não viam nada feito no Panteon: 93 lotes bloqueados aqui apareciam "Disponível",
//      5 em contrato e 6 em assinatura também;
//   3. o espelho público tinha a dele: `hercules_propostas.aberta` (que nunca volta a falso) e
//      `hercules_reservas.situacao = 'reservada'` (valor que a tabela NÃO usa: lá é `ativa`).
//   Resultado: 108 unidades com status diferente entre a Venda e o Apolo.
//
// ⚠️ A RÉGUA QUE FICA É A DA TELA VENDA, e na ordem dela:
//   1. PROPOSTA VIVA MAIS RECENTE do terreno (`hercules_propostas`, etapa do fluxo). É ela que
//      sabe se a venda está em proposta, contrato, assinatura ou faturada.
//   2. RESERVA VIVA: a do Hércules (`hercules_reservas.situacao = 'ativa'`) ou a do evento de
//      lançamento (`prometeu_reservas.situacao = 'reservada'`). Reserva é reserva, venha de onde vier.
//   3. O CADASTRO (`hercules_unidades.situacao`): disponível, bloqueada, e as "vendida"/"reservada"
//      sem proposta que as sustente — que continuam OCUPADAS, nunca livres. Dizer que um lote
//      vendido está livre é convidar a segunda venda.
//
// ⚠️ A PERGUNTA É PELO TERRENO, E NÃO PELA LINHA. Nos produtos divididos (Lagoa Bonita, Vale do
// Ouro) o mesmo lote tem DUAS linhas: a viva, da gleba, e a antiga, do pai, que aponta para ela por
// `espelho_de`. A reserva pode ter nascido na linha do pai e a proposta na da gleba (medido em
// 14/09/2026: VOC0305 livre na viva, VLO0305 reservado na antiga). Olhando uma linha só, a mesma
// unidade tem duas respostas.
//
// ⚠️ NENHUMA LEITURA DO C2X AQUI, e é de propósito. O dado do legado entra no Panteon por sync
// (decisão do Lucas); a situação que as telas mostram é a do Panteon.

/** A situação que as telas mostram. É o vocabulário da grade da tela Venda. */
export type SituacaoDaUnidade = EtapaDoEspelho;

const DO_FLUXO = new Set<string>(ETAPAS_DO_FLUXO);

export type SinaisDoTerreno = {
  /** `hercules_unidades.situacao` da linha VIVA. */
  cadastro: null | string;
  /** Propostas vivas de QUALQUER linha do terreno. `desde` ordena: a mais recente manda. */
  propostasVivas: Array<{ desde: string; etapa: string }>;
  /** Existe reserva viva (Hércules ou evento) em alguma linha do terreno? */
  reservada: boolean;
};

/** A régua, pura. É ESTA função que decide; o resto do arquivo só junta os sinais. */
export function situacaoDoTerreno(sinais: SinaisDoTerreno): SituacaoDaUnidade {
  let maisRecente: null | { desde: string; etapa: EtapaDoFluxo } = null;
  for (const p of sinais.propostasVivas) {
    if (!DO_FLUXO.has(p.etapa)) continue;
    if (!maisRecente || p.desde > maisRecente.desde) {
      maisRecente = { desde: p.desde, etapa: p.etapa as EtapaDoFluxo };
    }
  }
  if (maisRecente) return maisRecente.etapa;

  if (sinais.reservada) return "reservado";

  switch (String(sinais.cadastro ?? "").trim().toLowerCase()) {
    case "disponivel":
      return "disponivel";
    case "reservada":
      return "reservada";
    case "vendida":
      return "vendida";
    default:
      // Valor desconhecido NÃO vira livre: vira bloqueado, calado. O erro caro é oferecer lote
      // que já tem dono.
      return "bloqueada";
  }
}

/** Livre para vender. O único estado verde de qualquer espelho. */
export function estaLivre(situacao: SituacaoDaUnidade): boolean {
  return situacao === "disponivel";
}

const ROTULO: Record<SituacaoDaUnidade, string> = {
  assinatura: "Assinatura",
  bloqueada: "Bloqueado",
  contrato: "Contrato",
  disponivel: "Disponível",
  faturado: "Faturado",
  proposta: "Proposta",
  reservada: "Reservado",
  reservado: "Reservado",
  vendida: "Vendido",
};

/** O rótulo que qualquer tela escreve. Um só, para "Reservado" não virar "Em reserva" em outra. */
export function rotuloDaSituacao(situacao: SituacaoDaUnidade): string {
  return ROTULO[situacao] ?? "Bloqueado";
}

/**
 * A situação em quatro baldes, para telas que só distinguem livre, reservado, vendido e bloqueado
 * (a aba Unidades do Apolo, os cards de estoque).
 *
 * ⚠️ PROPOSTA, CONTRATO E ASSINATURA CONTAM COMO VENDIDO, E NÃO COMO LIVRE. É o mesmo agrupamento
 * que o Apolo sempre fez com o "em negociação" do legado — só que agora a partir do Panteon.
 */
export function baldeDaSituacao(
  situacao: SituacaoDaUnidade,
): "bloqueado" | "disponivel" | "reservado" | "vendido" {
  switch (situacao) {
    case "disponivel":
      return "disponivel";
    case "reservado":
    case "reservada":
      return "reservado";
    case "bloqueada":
      return "bloqueado";
    default:
      return "vendido";
  }
}

// ── A LEITURA ───────────────────────────────────────────────────────────────

export type UnidadeComSituacao = {
  codigo: string;
  enterpriseId: string;
  /** O id da linha viva (a da gleba nos produtos divididos). */
  id: string;
  lote: null | string;
  /** `hercules_unidades.origem_c2x_id` da linha viva: é por ele que telas que ainda indexam pelo id do legado acham a unidade. */
  origemC2xId: null | string;
  quadra: null | string;
  situacao: SituacaoDaUnidade;
};

export type SituacaoDasUnidades = {
  /** Por id de QUALQUER linha do terreno: a viva e as antigas que apontam para ela. */
  porLinha: Map<string, UnidadeComSituacao>;
  /** Por código de QUALQUER linha do terreno (`VOC0305` e `VLO0305` respondem o mesmo). */
  porCodigo: Map<string, UnidadeComSituacao>;
  /** Pelo id do legado de qualquer linha do terreno. */
  porOrigemC2x: Map<string, UnidadeComSituacao>;
  unidades: UnidadeComSituacao[];
};

const PAGINA = 1000;
const LOTE_DO_IN = 100;

type LinhaDaUnidade = {
  codigo: string;
  enterprise_id: number | string;
  espelho_de: null | string;
  id: string;
  lote: null | string;
  origem_c2x_id: null | number | string;
  quadra: null | string;
  situacao: null | string;
};

async function emPaginas<T>(
  consulta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const tudo: T[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await consulta(de, de + PAGINA - 1);
    if (error) throw new Error(String((error as { message?: string }).message ?? error));
    tudo.push(...(data ?? []));
    if ((data ?? []).length < PAGINA) break;
  }
  return tudo;
}

async function emBlocos<T>(
  ids: string[],
  consulta: (bloco: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const tudo: T[] = [];
  for (let i = 0; i < ids.length; i += LOTE_DO_IN) {
    const { data, error } = await consulta(ids.slice(i, i + LOTE_DO_IN));
    if (error) throw new Error(String((error as { message?: string }).message ?? error));
    tudo.push(...(data ?? []));
  }
  return tudo;
}

/**
 * A situação de todas as unidades dos empreendimentos pedidos, pela régua única.
 *
 * `enterpriseIds` são os ids do C2X que `hercules_unidades.enterprise_id` guarda ("35", "37"...).
 * Pedir o PAI traz as linhas dele; pedir a GLEBA traz as dela — e, nos dois casos, o terreno inteiro
 * entra na conta, porque as linhas que apontam umas para as outras são lidas juntas.
 *
 * ⚠️ FALHA LANÇA. Situação é o que decide se um lote aparece verde para o cliente: devolver um mapa
 * pela metade pintaria de livre o que não se conseguiu ler.
 */
export async function lerSituacaoDasUnidades(
  client: SupabaseClient,
  enterpriseIds: readonly string[],
): Promise<SituacaoDasUnidades> {
  const vazio: SituacaoDasUnidades = {
    porCodigo: new Map(),
    porLinha: new Map(),
    porOrigemC2x: new Map(),
    unidades: [],
  };
  const pedidos = [...new Set(enterpriseIds.map((id) => String(id).trim()).filter(Boolean))];
  if (pedidos.length === 0) return vazio;

  const colunas = "id,codigo,quadra,lote,situacao,enterprise_id,espelho_de,origem_c2x_id";

  const doPedido = await emPaginas<LinhaDaUnidade>((de, ate) =>
    client
      .from("hercules_unidades")
      .select(colunas)
      .eq("workspace_id", "careli")
      .in("enterprise_id", pedidos)
      .order("id")
      .range(de, ate),
  );

  // O terreno completo: as linhas pedidas, as vivas para onde elas apontam e as antigas que apontam
  // para as vivas. Sem isto, pedir o pai (VLO) ou só a gleba (VOC) daria respostas diferentes.
  //
  // ⚠️ AS LINHAS ANTIGAS VÊM NUMA LEITURA SÓ, E NÃO EM BLOCOS. São ~700 no banco inteiro (as que têm
  // `espelho_de`): lê-las todas é uma página; procurá-las em blocos de 100 ids da gleba eram
  // quarenta idas ao banco quando a tela pede todos os produtos — e a primeira versão deste arquivo
  // levou 35 segundos para responder os cards de Produtos por causa disso.
  const porId = new Map(doPedido.map((l) => [l.id, l]));
  const antigas = await emPaginas<LinhaDaUnidade>((de, ate) =>
    client
      .from("hercules_unidades")
      .select(colunas)
      .eq("workspace_id", "careli")
      .not("espelho_de", "is", null)
      .order("id")
      .range(de, ate),
  );
  for (const l of antigas) {
    if (l.espelho_de && porId.has(l.espelho_de)) porId.set(l.id, l);
  }
  const faltaViva = [
    ...new Set(doPedido.map((l) => l.espelho_de).filter((id): id is string => Boolean(id) && !porId.has(id!))),
  ];
  for (const l of await emBlocos<LinhaDaUnidade>(faltaViva, (bloco) =>
    client.from("hercules_unidades").select(colunas).in("id", bloco),
  )) {
    porId.set(l.id, l);
  }
  // A viva que entrou agora traz as antigas dela junto.
  for (const l of antigas) {
    if (l.espelho_de && porId.has(l.espelho_de)) porId.set(l.id, l);
  }

  const linhasDoTerreno = new Set(porId.keys());

  // ⚠️ PROCESSO LIDO INTEIRO E FILTRADO EM MEMÓRIA. As propostas vivas do banco inteiro são poucas
  // páginas; as reservas do Hércules e do evento, poucas dezenas de linhas. `.in()` com milhares de
  // ids seria a URL estourando ou dezenas de idas ao banco.
  const propostas = (
    await emPaginas<{
      criado_em_c2x: null | string;
      etapa: string;
      etapa_desde: null | string;
      unidade_id: null | string;
    }>((de, ate) =>
      client
        .from("hercules_propostas")
        .select("unidade_id,etapa,etapa_desde,criado_em_c2x")
        .eq("workspace_id", "careli")
        .in("etapa", [...ETAPAS_DO_FLUXO])
        .order("id")
        .range(de, ate),
    )
  ).filter((p): p is typeof p & { unidade_id: string } => Boolean(p.unidade_id) && linhasDoTerreno.has(p.unidade_id!));

  const reservasDoHercules = (
    await emPaginas<{ unidade_id: null | string }>((de, ate) =>
      client
        .from("hercules_reservas")
        .select("unidade_id")
        .eq("workspace_id", "careli")
        .eq("situacao", "ativa")
        .order("id")
        .range(de, ate),
    )
  ).filter((r): r is { unidade_id: string } => Boolean(r.unidade_id) && linhasDoTerreno.has(r.unidade_id!));

  const reservasDoEvento = await emPaginas<{ unidade_c2x_id: null | number | string }>((de, ate) =>
    client
      .from("prometeu_reservas")
      .select("unidade_c2x_id")
      .eq("situacao", "reservada")
      .order("id")
      .range(de, ate),
  );

  // ── Cada linha aponta para a viva do seu terreno ──
  const vivaDe = (l: LinhaDaUnidade): LinhaDaUnidade => (l.espelho_de ? porId.get(l.espelho_de) ?? l : l);

  const propostasPorViva = new Map<string, Array<{ desde: string; etapa: string }>>();
  for (const p of propostas) {
    const linha = porId.get(p.unidade_id);
    if (!linha) continue;
    const viva = vivaDe(linha).id;
    const lista = propostasPorViva.get(viva) ?? [];
    lista.push({ desde: String(p.etapa_desde ?? p.criado_em_c2x ?? ""), etapa: p.etapa });
    propostasPorViva.set(viva, lista);
  }

  const reservadas = new Set<string>();
  for (const r of reservasDoHercules) {
    const linha = porId.get(r.unidade_id);
    if (linha) reservadas.add(vivaDe(linha).id);
  }
  const linhaPorOrigem = new Map<string, LinhaDaUnidade>();
  for (const l of porId.values()) {
    if (l.origem_c2x_id !== null && l.origem_c2x_id !== undefined) linhaPorOrigem.set(String(l.origem_c2x_id), l);
  }
  for (const r of reservasDoEvento) {
    if (r.unidade_c2x_id === null || r.unidade_c2x_id === undefined) continue;
    const linha = linhaPorOrigem.get(String(r.unidade_c2x_id));
    if (linha) reservadas.add(vivaDe(linha).id);
  }

  // ── A régua, uma vez por terreno ──
  const resultado: SituacaoDasUnidades = {
    porCodigo: new Map(),
    porLinha: new Map(),
    porOrigemC2x: new Map(),
    unidades: [],
  };
  const porViva = new Map<string, UnidadeComSituacao>();

  for (const l of porId.values()) {
    if (l.espelho_de && porId.has(l.espelho_de)) continue;
    const unidade: UnidadeComSituacao = {
      codigo: l.codigo,
      enterpriseId: String(l.enterprise_id),
      id: l.id,
      lote: l.lote,
      origemC2xId: l.origem_c2x_id === null || l.origem_c2x_id === undefined ? null : String(l.origem_c2x_id),
      quadra: l.quadra,
      situacao: situacaoDoTerreno({
        cadastro: l.situacao,
        propostasVivas: propostasPorViva.get(l.id) ?? [],
        reservada: reservadas.has(l.id),
      }),
    };
    porViva.set(l.id, unidade);
    resultado.unidades.push(unidade);
  }

  for (const l of porId.values()) {
    const unidade = porViva.get(vivaDe(l).id);
    if (!unidade) continue;
    resultado.porLinha.set(l.id, unidade);
    resultado.porCodigo.set(l.codigo.trim().toUpperCase(), unidade);
    if (l.origem_c2x_id !== null && l.origem_c2x_id !== undefined) {
      resultado.porOrigemC2x.set(String(l.origem_c2x_id), unidade);
    }
  }

  return resultado;
}
