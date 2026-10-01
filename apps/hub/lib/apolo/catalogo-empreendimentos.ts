import { filtroSemExcluidos } from "@/lib/apolo/c2x-pelo-id";
import { ENTERPRISE_GROUPS } from "@/lib/guardian/c2x-analytics";
import { getHadesDbPool } from "@/lib/guardian/db";
import { reguaEmCache } from "@/lib/hercules/cadastro-em-cache";
import type { ReguaDoCadastro } from "@/lib/hercules/regua-do-cadastro";

// CATÁLOGO ENXUTO: só id, código e nome do empreendimento, já AGRUPADO.
//
// ⚠️ POR QUE NÃO USAR `loadApoloEnterprises`: aquela leitura é o cenário de vendas — faz
// `left join enterprise_unities` e dez agregações de `sale_status` sobre TODAS as unidades, para
// devolver disponível/reservado/negociação/vendido. É a consulta certa para a tela de
// Empreendimento, e cara demais para quem só quer saber COMO O EMPREENDIMENTO SE CHAMA.
//
// O Board precisa do nome em duas situações, e as duas são por carregamento de tela: traduzir o
// `enterpriseId` do vínculo da imobiliária, e montar o seletor de empreendimento. Pendurar a
// consulta pesada ali (com refetch-on-focus) sairia caro sem entregar nada além do rótulo.
//
// Ver [[project_hermes_cost]]: já houve incidente de fatura por leitura repetida.

export type EmpreendimentoDoCatalogo = {
  /**
   * O CÓDIGO de cada divisão, na MESMA ordem de `stageIds`. Para o Lagoa Bonita: LBF, LBR, LBP.
   *
   * Existe porque quase toda leitura de negócio do C2X (carteira, vendas, unidades) recebe
   * `codes`, e não ids. Sem isto, quem precisa da tradução id → code refaz a consulta por fora, e
   * é aí que a regra do grupo se perde.
   */
  codes: string[];
  /** "group:Lagoa Bonita" para o consolidado, ou o id do C2X para o simples. */
  id: string;
  /** Nome de mercado, em caixa alta. Para o grupo é o display ("LAGOA BONITA"). */
  name: string;
  /**
   * Os enterprise_id REAIS por trás do id. Para o grupo, as divisões (LBF, LBR, LBP); para o
   * simples, ele mesmo. É por aqui que o vínculo de uma divisão encontra o nome do empreendimento.
   */
  stageIds: string[];
};

/**
 * OS GRUPOS DO CATÁLOGO SEM PERGUNTAR AO C2X — a mesma lista que `agrupar` produz, montada da
 * constante de código em vez da consulta.
 *
 * ⚠️ ELA EXISTE PORQUE O CATÁLOGO NUNCA LANÇA: `lerDoC2x` devolve `cache?.valor ?? []` quando o pool
 * do C2X não abre (`:93`) e quando a query falha (`:113`). Numa instância com o cache frio isso não é
 * "catálogo menor", é catálogo VAZIO — e quem monta escopo com `comIdsDoGrupo` perde os ids de grupo
 * calado. Medido em 26/09/2026 (`bxgukywoxgivlrhjkwjx`, só SELECT):
 *   select enterprise_id, etapa, count(*) from apolo_esteira
 *    where enterprise_id like 'group:%' group by 1,2;
 *     → 2 linhas, as duas `group:Lagoa Bonita` e as duas `credenciado`.
 * Com o catálogo vazio, a barra da CAD (`lib/hercules/cad-para-contrato.ts`) recusaria esse credenciado
 * por engano. (⚠️ NÃO CONFERIDO AQUI, e relatado pela revisão: que essas duas linhas alcancem a proposta
 * LBF C11 28, já em etapa `contrato`. O elo CPF → CAD é por `value_hash` em `apolo_entity_identifiers` e
 * não se faz em SQL solto.)
 *
 * ⚠️ O ID É MONTADO PELA MESMA REGRA DE `agrupar` (`group:` mais o `display`), e os `stageIds` saem
 * de `ENTERPRISE_GROUPS.ids`, que são os `enterprises.id` de `codes` na mesma ordem (PAN-124,
 * medidos no C2X em 25/09/2026). Se as duas regras divergirem, o grupo deixa de casar com a esteira
 * — e é por isso que o teste desta constante compara com o `agrupar` de verdade.
 *
 * ⚠️ NÃO É SUBSTITUTO DO CATÁLOGO: aqui não há `codes` nem `name`, e o empreendimento SIMPLES não
 * aparece. Serve para quem só precisa saber quais ids de grupo existem e que divisões eles cobrem.
 */
export const GRUPOS_DO_CATALOGO: Array<Pick<EmpreendimentoDoCatalogo, "id" | "stageIds">> =
  ENTERPRISE_GROUPS.map((grupo) => ({
    id: `group:${grupo.display}`,
    stageIds: grupo.ids.map((id) => String(id)),
  }));

type LinhaCrua = { code: null | string; id: number; name: null | string };

// Cache de processo, curto, das LINHAS CRUAS do C2X (id, sigla, nome). O catálogo do C2X muda quando
// nasce empreendimento novo, algumas vezes por ANO, e 10 minutos é folgado.
//
// ⚠️ O CACHE É DAS LINHAS, NÃO DO CATÁLOGO AGRUPADO (PAN-124 F7). Nome e grupo vêm do cadastro do
// Panteon (a régua, renovada pelo carimbo em até 30 s), e o agrupamento roda a cada leitura: são 37
// linhas. Guardar o agrupado prenderia por 10 minutos o nome que alguém acabou de editar (F10).
const TTL_MS = 10 * 60 * 1000;
let cache: { emMs: number; linhas: LinhaCrua[] } | null = null;
// A leitura que está em andamento, para quem chegar durante ela esperar a MESMA consulta.
let emVoo: null | Promise<LinhaCrua[] | null> = null;

/**
 * Esquece o catálogo guardado. SÓ PARA TESTE E SCRIPT DE MEDIÇÃO.
 *
 * ⚠️ NÃO CHAME EM PRODUÇÃO PARA "RELER" (PAN-124, revisão de 25/09/2026). Apagar o cache antes de
 * reler tira a única proteção que o catálogo tem contra o C2X oscilando: se a releitura falhar, todo
 * leitor daquela instância (nomes do Board, escopo do portal, tradução sigla → id) passa a receber `[]`
 * até o C2X voltar, em vez do catálogo anterior. Para ignorar o prazo, use
 * `catalogoDeEmpreendimentos(agora, { forcar: true })`, que mantém o anterior quando falha.
 */
export function limparCacheDoCatalogo(): void {
  cache = null;
  emVoo = null;
}

/**
 * Lê o catálogo de empreendimentos do C2X (READ-ONLY), agrupado pela regra do negócio.
 *
 * Devolve lista VAZIA se o C2X estiver indisponível E não houver catálogo anterior: quem chama trata
 * a ausência de catálogo como "sem tradução", nunca como "não existe empreendimento".
 *
 * @param opcoes.forcar Lê de novo mesmo com o cache no prazo (a sigla que o catálogo ainda não conhece,
 *   ver lib/apolo/c2x-pelo-id-servidor.ts). ⚠️ Forçar NÃO apaga o anterior: se a leitura falhar, volta
 *   o catálogo que já estava guardado, e ele continua guardado, como numa leitura comum.
 */
export async function catalogoDeEmpreendimentos(
  agoraMs: number,
  opcoes: { forcar?: boolean } = {},
): Promise<EmpreendimentoDoCatalogo[]> {
  const linhas = await linhasDoC2x(agoraMs, opcoes);
  if (!linhas) return [];
  // O cadastro do Panteon dá nome e grupo (F7). Sem ele (partida a frio sem banco), a lista fixa de
  // antes: o catálogo nunca fica vazio por causa do cadastro.
  const regua = await reguaEmCache(agoraMs).catch(() => null);
  return agrupar(linhas, regua);
}

async function linhasDoC2x(
  agoraMs: number,
  opcoes: { forcar?: boolean },
): Promise<LinhaCrua[] | null> {
  if (!opcoes.forcar && cache && agoraMs - cache.emMs < TTL_MS) return cache.linhas;

  // ⚠️ UMA CONSULTA POR VEZ POR INSTÂNCIA. A tela do Apolo abre as abas em paralelo e o pool do C2X
  // tem 5 conexões (lib/guardian/db.ts): com o cache vencido (ou uma releitura forçada), cada aba
  // disparava o mesmo SELECT. Quem chega durante a leitura espera a dela.
  if (emVoo) return emVoo;
  const leitura = lerDoC2x(agoraMs);
  emVoo = leitura;
  try {
    return await leitura;
  } finally {
    if (emVoo === leitura) emVoo = null;
  }
}

async function lerDoC2x(agoraMs: number): Promise<LinhaCrua[] | null> {
  const poolResult = getHadesDbPool();
  if (!poolResult.ok) return cache?.linhas ?? null;

  // ⚠️ A EXCLUSÃO É PELO ID (`EXCLUDED_ENTERPRISE_IDS`: SDT, LAB, TSC), e não mais pela sigla
  // (PAN-124). É deste catálogo que a tradução sigla → id sai (lib/apolo/c2x-pelo-id.ts): um
  // empreendimento excluído que continuasse aqui por ter sido renomeado voltaria a aparecer em toda
  // leitura que traduz por ele. O `agrupar` continua juntando as divisões pela sigla, de propósito
  // (a troca dele é outra etapa).
  const semExcluidosDoC2x = filtroSemExcluidos();

  let linhas: LinhaCrua[];
  try {
    const [rows] = await poolResult.pool.query(
      `select e.id, e.code, e.name
         from enterprises e
        where ${semExcluidosDoC2x.sql}
        order by e.code`,
      semExcluidosDoC2x.params,
    );
    linhas = rows as LinhaCrua[];
  } catch {
    // Mantém o catálogo anterior se houver: um pico de indisponibilidade não deve apagar os nomes
    // da tela de quem já estava trabalhando.
    return cache?.linhas ?? null;
  }

  cache = { emMs: agoraMs, linhas };
  return linhas;
}

/**
 * Junta as divisões num empreendimento só, pela regra do Lucas: "temos essas divisões por
 * particularidade de cada empreendimento (fases, sócios), mas o mercado vê UM empreendimento".
 *
 * ⚠️ PELO CADASTRO DO PANTEON, COM A LISTA FIXA SÓ DE RESERVA (PAN-124 F7). Com a régua:
 *   • os grupos são os pais com filhos do cadastro (`pai_id`), e não `ENTERPRISE_GROUPS`; o id do grupo
 *     é `group:<chave>` (a coluna congelada da F4), idêntico ao de hoje nos 5 grupos;
 *   • as divisões saem na ordem do cadastro (ordem, sigla). A única mudança é a Lagoa Bonita: LBF, LBP,
 *     LBR, a mesma do Hércules;
 *   • o NOME é o do cadastro em caixa alta: o de mercado (o do pai, sem a divisão) para o grupo, e o
 *     nome de mercado do id para o simples. Id sem cadastro (o 30) fica com o nome do C2X;
 *   • o pai com id vivo (o VLO 35) continua entrada SIMPLES ao lado do grupo, e o 31 continua fora (a
 *     consulta já o exclui pelo id), como antes;
 *   • `codes` e `stageIds` continuam vindo do C2X, casados pelo id.
 * Sem a régua (`null`), a regra de antes, pela lista fixa e pela sigla.
 */
export function agrupar(linhas: LinhaCrua[], regua: null | ReguaDoCadastro = null): EmpreendimentoDoCatalogo[] {
  if (!regua) return agruparPelaListaFixa(linhas);

  const porId = new Map<string, LinhaCrua>();
  for (const linha of linhas) {
    if ((linha.code ?? "").trim()) porId.set(String(linha.id), linha);
  }

  const saida: EmpreendimentoDoCatalogo[] = [];
  const consumidos = new Set<string>();

  for (const grupo of regua.grupos) {
    const divisoes = grupo.divisoes
      .map((divisao) => porId.get(String(divisao.c2xEnterpriseId ?? "").trim()))
      .filter((linha): linha is LinhaCrua => Boolean(linha));

    if (divisoes.length === 0) continue;
    for (const divisao of divisoes) consumidos.add(String(divisao.id));

    saida.push({
      codes: divisoes.map((divisao) => (divisao.code ?? "").trim().toUpperCase()),
      id: grupo.id,
      name: (grupo.nomeDeMercado || grupo.chave).toLocaleUpperCase("pt-BR"),
      stageIds: divisoes.map((divisao) => String(divisao.id)),
    });
  }

  for (const linha of linhas) {
    const code = (linha.code ?? "").trim().toUpperCase();
    const id = String(linha.id);
    if (!code || consumidos.has(id)) continue;

    const doCadastro = regua.porId.get(id)?.nomeDeMercado;
    saida.push({
      codes: [code],
      id,
      name: (doCadastro || linha.name || code).trim().toLocaleUpperCase("pt-BR"),
      stageIds: [id],
    });
  }

  return saida.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/** A regra de antes da F7, pela lista fixa e pela sigla. É a reserva quando o cadastro não está. */
function agruparPelaListaFixa(linhas: LinhaCrua[]): EmpreendimentoDoCatalogo[] {
  const porCodigo = new Map<string, LinhaCrua>();
  for (const linha of linhas) {
    const code = (linha.code ?? "").trim().toUpperCase();
    if (code) porCodigo.set(code, linha);
  }

  const saida: EmpreendimentoDoCatalogo[] = [];
  const consumidos = new Set<string>();

  for (const grupo of ENTERPRISE_GROUPS) {
    const divisoes = grupo.codes
      .map((code) => porCodigo.get(code.toUpperCase()))
      .filter((linha): linha is LinhaCrua => Boolean(linha));

    if (divisoes.length === 0) continue;

    for (const divisao of divisoes) {
      consumidos.add((divisao.code ?? "").toUpperCase());
    }

    saida.push({
      codes: divisoes.map((divisao) => (divisao.code ?? "").trim().toUpperCase()),
      id: `group:${grupo.display}`,
      name: grupo.display.toLocaleUpperCase("pt-BR"),
      stageIds: divisoes.map((divisao) => String(divisao.id)),
    });
  }

  for (const linha of linhas) {
    const code = (linha.code ?? "").trim().toUpperCase();
    if (!code || consumidos.has(code)) continue;

    saida.push({
      codes: [code],
      id: String(linha.id),
      name: (linha.name ?? code).trim().toLocaleUpperCase("pt-BR"),
      // Para o empreendimento simples, a "divisão" é ele mesmo — assim quem consome não precisa
      // de dois caminhos para traduzir um id.
      stageIds: [String(linha.id)],
    });
  }

  return saida.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}
