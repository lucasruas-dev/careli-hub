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
//   2. RESERVA VIVA: a do Hércules (`hercules_reservas.situacao` `ativa` ou `proposta`) ou a do evento de
//      lançamento (`prometeu_reservas.situacao = 'reservada'`). Reserva é reserva, venha de onde vier.
//   3. O CADASTRO (`hercules_unidades.situacao`): disponível, bloqueada, e as "vendida"/"reservada"
//      sem proposta que as sustente — que continuam OCUPADAS, nunca livres. Dizer que um lote
//      vendido está livre é convidar a segunda venda.
//
// ⚠️ A PERGUNTA É PELO TERRENO, E NÃO PELA LINHA. Nos produtos divididos (Lagoa Bonita, Vale do
// Ouro) o mesmo lote tem mais de uma linha: a antiga, do pai, que aponta para a viva por
// `espelho_de`, e às vezes DUAS vivas, quando o lote migrou de gleba (VOC e VOR). A reserva pode ter
// nascido numa linha e a proposta em outra; olhando uma linha só, a mesma unidade tem duas respostas.
// Ver "A FAMÍLIA DO PAI" na leitura.
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
 * A situação em cinco baldes, para telas que agrupam (os cards de estoque, a aba Unidades do Apolo,
 * o filtro por situação).
 *
 * ⚠️ UM AGRUPAMENTO SÓ PARA TODAS AS TELAS. Na primeira passada da migração o Apolo punha proposta,
 * contrato e assinatura em "Vendido" e os cards do Hércules punham os mesmos casos em "Em
 * negociação": o mesmo lote com dois nomes, que é a queixa do Lucas em outra roupa. Daqui em
 * diante: proposta, contrato e assinatura são NEGOCIAÇÃO; faturado e vendida sem proposta, VENDIDO.
 */
export type BaldeDaSituacao = "bloqueado" | "disponivel" | "negociacao" | "reservado" | "vendido";

export function baldeDaSituacao(situacao: SituacaoDaUnidade): BaldeDaSituacao {
  switch (situacao) {
    case "disponivel":
      return "disponivel";
    case "reservado":
    case "reservada":
      return "reservado";
    case "proposta":
    case "contrato":
    case "assinatura":
      return "negociacao";
    case "bloqueada":
      return "bloqueado";
    default:
      return "vendido";
  }
}

const ROTULO_DO_BALDE: Record<BaldeDaSituacao, string> = {
  bloqueado: "Bloqueado",
  disponivel: "Disponível",
  negociacao: "Em negociação",
  reservado: "Reservado",
  vendido: "Vendido",
};

/** O nome do balde, o mesmo em toda tela. */
export function rotuloDoBalde(balde: BaldeDaSituacao): string {
  return ROTULO_DO_BALDE[balde];
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
  /**
   * Todas as linhas, ids do legado e códigos do TERRENO de uma linha qualquer. É o que a trava de
   * venda (`trava-do-lote.ts`) usa para procurar outro dono em qualquer uma delas.
   * `undefined` quando a linha não foi lida.
   */
  terreno: (linhaId: string) => undefined | { codigos: string[]; linhas: string[]; origens: string[] };
  /** As linhas vivas dos empreendimentos PEDIDOS (as irmãs lidas para compor o terreno ficam de fora). */
  unidades: UnidadeComSituacao[];
};

/**
 * Acha a unidade pela chave que a tela tiver, NESTA ORDEM: id da linha no Panteon, id do legado,
 * código. Uma ordem só para todas as telas: na primeira passada o masterplan procurava primeiro pelo
 * código e o Apolo primeiro pelo id do legado, e um nome no C2X diferente do código da carga fazia as
 * duas acharem linhas diferentes para o mesmo lote.
 *
 * `undefined` quando nenhuma chave casa: a tela decide o que mostrar, e o conservador é ocupado.
 */
export function acharUnidade(
  situacoes: SituacaoDasUnidades,
  chaves: { codigo?: null | string; linhaId?: null | string; origemC2x?: null | number | string },
): undefined | UnidadeComSituacao {
  const linha = chaves.linhaId ? situacoes.porLinha.get(String(chaves.linhaId)) : undefined;
  if (linha) return linha;
  const origem =
    chaves.origemC2x !== null && chaves.origemC2x !== undefined && String(chaves.origemC2x).trim()
      ? situacoes.porOrigemC2x.get(String(chaves.origemC2x).trim())
      : undefined;
  if (origem) return origem;
  const codigo = String(chaves.codigo ?? "").trim().toUpperCase();
  return codigo ? situacoes.porCodigo.get(codigo) : undefined;
}

const PAGINA = 1000;
const LOTE_DO_IN = 100;

/**
 * Quadra ou lote comparável: sem espaço, sem caixa e sem zero à esquerda ("06" e "6" são o mesmo
 * lote). A carga grava "06" hoje; basta uma linha escrita "6" para o terreno se partir em dois, e
 * terreno partido é lote vendido duas vezes.
 */
function parteDoLote(valor: null | string): string {
  return String(valor ?? "").trim().toUpperCase().replace(/^0+(?=\d)/, "");
}

function chaveDoLote(ent: string, quadra: null | string, lote: null | string): string {
  return `${ent}|${parteDoLote(quadra)}|${parteDoLote(lote)}`;
}

type LinhaDaUnidade = {
  atualizado_em?: null | string;
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
 * Pedir o PAI ou só uma GLEBA dá a mesma resposta para o mesmo lote: o terreno inteiro entra na conta.
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
    terreno: () => undefined,
    unidades: [],
  };
  const pedidos = [...new Set(enterpriseIds.map((id) => String(id).trim()).filter(Boolean))];
  if (pedidos.length === 0) return vazio;
  const pedido = new Set(pedidos);

  const colunas = "id,codigo,quadra,lote,situacao,enterprise_id,espelho_de,origem_c2x_id,atualizado_em";

  // ⚠️ AS LINHAS ANTIGAS (DO PAI) VÊM NUMA LEITURA SÓ, E NÃO EM BLOCOS. São ~700 no banco inteiro
  // (as que têm `espelho_de`): uma página. Em blocos de 100 ids eram quarenta idas ao banco quando a
  // tela pede todos os produtos, e a primeira versão deste arquivo levou 35 s por isso.
  const [doPedido, antigas] = await Promise.all([
    emPaginas<LinhaDaUnidade>((de, ate) =>
      client
        .from("hercules_unidades")
        .select(colunas)
        .eq("workspace_id", "careli")
        .in("enterprise_id", pedidos)
        .order("id")
        .range(de, ate),
    ),
    emPaginas<LinhaDaUnidade>((de, ate) =>
      client
        .from("hercules_unidades")
        .select(colunas)
        .eq("workspace_id", "careli")
        .not("espelho_de", "is", null)
        .order("id")
        .range(de, ate),
    ),
  ]);

  const porId = new Map(doPedido.map((l) => [l.id, l]));

  // ── A FAMÍLIA DO PAI ──
  //
  // ⚠️ O TERRENO NÃO É SÓ "A LINHA DO PAI E A VIVA PARA ONDE ELA APONTA". Quando um lote migra de
  // gleba (medido em 18/09/2026: 12-06, 13-01, 13-02 e 14-01 do Vale do Ouro existem na VOC E na
  // VOR), o pai aponta para UMA das duas, e a outra linha viva fica solta com o processo dela.
  // Olhando só o `espelho_de`, a gleba sem processo sairia livre com a irmã em contrato. Por isso o
  // terreno é (empreendimento pai, quadra, lote), e toda linha viva de uma gleba FILHA daquele pai
  // com a mesma quadra e lote entra nele.
  //
  // ⚠️ SÓ QUANDO O PAI TEM A LINHA. No Rio de Pedras as glebas RDP e RPC repetem a numeração em
  // áreas diferentes e o pai não tem unidade nenhuma: lá não há terreno comum, e agrupar pela quadra
  // juntaria lotes distintos.
  const paisDaFamilia = new Set<string>();
  for (const a of antigas) {
    if (pedido.has(String(a.enterprise_id)) || (a.espelho_de && porId.has(a.espelho_de))) {
      paisDaFamilia.add(String(a.enterprise_id));
    }
  }
  const antigasDaFamilia = antigas.filter((a) => paisDaFamilia.has(String(a.enterprise_id)));

  const faltando = [
    ...new Set(
      antigasDaFamilia
        .map((a) => a.espelho_de)
        .filter((id): id is string => Boolean(id) && !porId.has(id as string)),
    ),
  ];
  for (const l of await emBlocos<LinhaDaUnidade>(faltando, (bloco) =>
    client.from("hercules_unidades").select(colunas).in("id", bloco),
  )) {
    porId.set(l.id, l);
  }
  for (const a of antigasDaFamilia) porId.set(a.id, a);

  // As glebas filhas de cada pai, deduzidas de para onde as linhas do pai apontam.
  const filhasDoPai = new Map<string, Set<string>>();
  for (const a of antigasDaFamilia) {
    const alvo = a.espelho_de ? porId.get(a.espelho_de) : undefined;
    if (!alvo) continue;
    const filhas = filhasDoPai.get(String(a.enterprise_id)) ?? new Set<string>();
    filhas.add(String(alvo.enterprise_id));
    filhasDoPai.set(String(a.enterprise_id), filhas);
  }

  // As irmãs soltas também precisam estar lidas: pedir só a VOC não pode ignorar a VOR.
  const glebasFaltando = [...new Set([...filhasDoPai.values()].flatMap((f) => [...f]))].filter(
    (ent) => !pedido.has(ent),
  );
  if (glebasFaltando.length > 0) {
    const irmas = await emPaginas<LinhaDaUnidade>((de, ate) =>
      client
        .from("hercules_unidades")
        .select(colunas)
        .eq("workspace_id", "careli")
        .in("enterprise_id", glebasFaltando)
        .is("espelho_de", null)
        .order("id")
        .range(de, ate),
    );
    for (const l of irmas) if (!porId.has(l.id)) porId.set(l.id, l);
  }

  // ── Os terrenos: cada linha cai num grupo ──
  //
  // ⚠️ OS GRUPOS SE JUNTAM, NUNCA SE SOBRESCREVEM (18/09/2026, achado da revisão). A primeira versão
  // dava a cada linha do pai o próprio grupo e gravava o da linha viva por cima: com duas linhas do
  // pai apontando para a mesma viva, a primeira ficava sozinha com o processo dela e a viva saía
  // livre. Aqui é uma união: tudo que se liga (pai → viva, pai → gleba com a mesma quadra e lote)
  // termina no mesmo terreno, em qualquer ordem de leitura.
  const raiz = new Map<string, string>();
  const acharRaiz = (id: string): string => {
    let r = id;
    while (raiz.has(r) && raiz.get(r) !== r) r = raiz.get(r) as string;
    raiz.set(id, r);
    return r;
  };
  const juntar = (a: string, b: string) => {
    const ra = acharRaiz(a);
    const rb = acharRaiz(b);
    if (ra !== rb) raiz.set(rb, ra);
  };
  const linhasDoLote = new Map<string, string[]>();
  for (const l of porId.values()) {
    if (l.espelho_de) continue;
    const chave = chaveDoLote(String(l.enterprise_id), l.quadra, l.lote);
    linhasDoLote.set(chave, [...(linhasDoLote.get(chave) ?? []), l.id]);
  }
  for (const a of antigasDaFamilia) {
    if (a.espelho_de) juntar(a.id, a.espelho_de);
    for (const filha of filhasDoPai.get(String(a.enterprise_id)) ?? []) {
      for (const viva of linhasDoLote.get(chaveDoLote(filha, a.quadra, a.lote)) ?? []) juntar(a.id, viva);
    }
  }
  const grupoDe = new Map<string, string>();
  for (const l of porId.values()) grupoDe.set(l.id, `terreno:${acharRaiz(l.id)}`);

  // ⚠️ PROCESSO LIDO INTEIRO E FILTRADO EM MEMÓRIA, E EM PARALELO. As propostas vivas do banco são
  // poucas páginas; as reservas, poucas dezenas de linhas. `.in()` com milhares de ids seria a URL
  // estourando ou dezenas de idas ao banco.
  const [propostasTodas, reservasTodas, reservasDoEvento] = await Promise.all([
    emPaginas<{
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
    ),
    // ⚠️ TODAS AS RESERVAS, NÃO SÓ AS VIVAS: é daqui que sai quais cupons do salão já pertencem a
    // uma reserva do Hércules. Esses cupons não contam sozinhos — quem manda é a reserva do Hércules,
    // viva ou cancelada. Sem isto, cancelar a reserva na Venda deixaria o lote preso pelo cupom.
    emPaginas<{ prometeu_reserva_id: null | string; situacao: string; unidade_id: null | string }>((de, ate) =>
      client
        .from("hercules_reservas")
        .select("unidade_id,situacao,prometeu_reserva_id")
        .eq("workspace_id", "careli")
        .order("id")
        .range(de, ate),
    ),
    emPaginas<{ codigo: null | string; id: string; unidade_c2x_id: null | number | string }>((de, ate) =>
      client
        .from("prometeu_reservas")
        .select("id,unidade_c2x_id,codigo")
        .eq("situacao", "reservada")
        .order("id")
        .range(de, ate),
    ),
  ]);

  const propostasPorGrupo = new Map<string, Array<{ desde: string; etapa: string }>>();
  for (const p of propostasTodas) {
    const grupo = p.unidade_id ? grupoDe.get(p.unidade_id) : undefined;
    if (!grupo) continue;
    const lista = propostasPorGrupo.get(grupo) ?? [];
    lista.push({ desde: String(p.etapa_desde ?? p.criado_em_c2x ?? ""), etapa: p.etapa });
    propostasPorGrupo.set(grupo, lista);
  }

  const gruposReservados = new Set<string>();
  const cuponsNoHercules = new Set<string>();
  for (const r of reservasTodas) {
    if (r.prometeu_reserva_id) cuponsNoHercules.add(r.prometeu_reserva_id);
    // ⚠️ `ativa` E `proposta`, as mesmas da trava (`trava-do-lote.ts`). A reserva que virou proposta
    // e perdeu a proposta (cancelada pelo sync, por exemplo) continua prendendo o lote no índice e
    // na trava; contada só `ativa`, a tela pintava verde um lote que a porta recusa.
    if (r.situacao !== "ativa" && r.situacao !== "proposta") continue;
    const grupo = r.unidade_id ? grupoDe.get(r.unidade_id) : undefined;
    if (grupo) gruposReservados.add(grupo);
  }

  // A reserva do salão casa pelo id do legado e, sem ele, pelo código gravado nela.
  const linhaPorOrigem = new Map<string, LinhaDaUnidade>();
  const linhaPorCodigo = new Map<string, LinhaDaUnidade>();
  for (const l of porId.values()) {
    if (l.origem_c2x_id !== null && l.origem_c2x_id !== undefined) linhaPorOrigem.set(String(l.origem_c2x_id), l);
    linhaPorCodigo.set(l.codigo.trim().toUpperCase(), l);
  }
  for (const r of reservasDoEvento) {
    if (cuponsNoHercules.has(r.id)) continue;
    const pelaOrigem =
      r.unidade_c2x_id !== null && r.unidade_c2x_id !== undefined
        ? linhaPorOrigem.get(String(r.unidade_c2x_id))
        : undefined;
    const linha = pelaOrigem ?? (r.codigo ? linhaPorCodigo.get(r.codigo.trim().toUpperCase()) : undefined);
    const grupo = linha ? grupoDe.get(linha.id) : undefined;
    if (grupo) gruposReservados.add(grupo);
  }

  // ── A régua, uma vez por linha viva, com o processo do terreno inteiro ──
  const linhasPorGrupo = new Map<string, LinhaDaUnidade[]>();
  for (const l of porId.values()) {
    const grupo = grupoDe.get(l.id) ?? (l.espelho_de ? grupoDe.get(l.espelho_de) : undefined) ?? `linha:${l.id}`;
    const lista = linhasPorGrupo.get(grupo) ?? [];
    lista.push(l);
    linhasPorGrupo.set(grupo, lista);
  }

  const resultado: SituacaoDasUnidades = {
    porCodigo: new Map(),
    porLinha: new Map(),
    porOrigemC2x: new Map(),
    terreno: (linhaId: string) => {
      const linha = porId.get(linhaId);
      if (!linha) return undefined;
      const grupo =
        grupoDe.get(linha.id) ?? (linha.espelho_de ? grupoDe.get(linha.espelho_de) : undefined) ?? `linha:${linha.id}`;
      const linhas = linhasPorGrupo.get(grupo) ?? [linha];
      return {
        codigos: [...new Set(linhas.map((l) => l.codigo.trim().toUpperCase()))],
        linhas: linhas.map((l) => l.id),
        origens: [
          ...new Set(
            linhas
              .map((l) => (l.origem_c2x_id === null || l.origem_c2x_id === undefined ? "" : String(l.origem_c2x_id)))
              .filter(Boolean),
          ),
        ],
      };
    },
    unidades: [],
  };
  const porViva = new Map<string, UnidadeComSituacao>();

  for (const l of porId.values()) {
    if (l.espelho_de) continue;
    const grupo = grupoDe.get(l.id) ?? `linha:${l.id}`;
    let situacao = situacaoDoTerreno({
      cadastro: l.situacao,
      propostasVivas: propostasPorGrupo.get(grupo) ?? [],
      reservada: gruposReservados.has(grupo),
    });
    // ⚠️ A IRMÃ DA OUTRA GLEBA COM DONO NO CADASTRO PRENDE ESTA (18/09/2026, achado da revisão).
    // Quando o lote existe em duas glebas (VOC e VOR), "vendida" ou "reservada" no cadastro de uma
    // delas é dono sem processo, e o chão é um só: esta linha não pode sair livre. É a regra que o
    // espelho público já aplicava; sem ela aqui, a Venda mostrava verde o que o espelho mostrava
    // azul. "bloqueada" na irmã NÃO prende: é a carteira de onde o lote saiu (medido em 18/09/2026,
    // os 4 terrenos do Vale do Ouro nas duas glebas têm a VOC bloqueada e a VOR com o dono).
    if (situacao === "disponivel") {
      for (const irma of linhasPorGrupo.get(grupo) ?? []) {
        if (irma.id === l.id || irma.espelho_de) continue;
        const cadastroDaIrma = String(irma.situacao ?? "").trim().toLowerCase();
        if (cadastroDaIrma === "vendida" || cadastroDaIrma === "reservada") {
          situacao = cadastroDaIrma;
          break;
        }
      }
    }
    const unidade: UnidadeComSituacao = {
      codigo: l.codigo,
      enterpriseId: String(l.enterprise_id),
      id: l.id,
      lote: l.lote,
      origemC2xId: l.origem_c2x_id === null || l.origem_c2x_id === undefined ? null : String(l.origem_c2x_id),
      quadra: l.quadra,
      situacao,
    };
    porViva.set(l.id, unidade);
    if (pedido.has(String(l.enterprise_id))) resultado.unidades.push(unidade);
  }

  // ⚠️ A LINHA VIVA GANHA DA ANTIGA NOS MAPAS, e a mais recente ganha da mais velha. Duas linhas
  // vivas com o mesmo id do legado aparecem depois de uma carga com unidade renomeada; a atualizada
  // por último é a que a carga reconheceu.
  const ordenadas = [...porId.values()].sort((a, b) => {
    if (Boolean(a.espelho_de) !== Boolean(b.espelho_de)) return a.espelho_de ? -1 : 1;
    return String(a.atualizado_em ?? "").localeCompare(String(b.atualizado_em ?? ""));
  });
  for (const l of ordenadas) {
    const viva = l.espelho_de ? porViva.get(l.espelho_de) : porViva.get(l.id);
    if (!viva) continue;
    resultado.porLinha.set(l.id, viva);
    resultado.porCodigo.set(l.codigo.trim().toUpperCase(), viva);
    if (l.origem_c2x_id !== null && l.origem_c2x_id !== undefined) {
      resultado.porOrigemC2x.set(String(l.origem_c2x_id), viva);
    }
  }

  return resultado;
}
