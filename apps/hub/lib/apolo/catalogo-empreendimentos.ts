import { filtroSemExcluidos } from "@/lib/apolo/c2x-pelo-id";
import { ENTERPRISE_GROUPS } from "@/lib/guardian/c2x-analytics";
import { getHadesDbPool } from "@/lib/guardian/db";

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

type LinhaCrua = { code: null | string; id: number; name: null | string };

// Cache de processo, curto. O catálogo muda quando nasce empreendimento novo — algumas vezes por
// ANO —, então 10 minutos é folgado e ainda assim garante que uma correção de nome apareça no
// mesmo turno de trabalho. Sem TTL infinito de propósito: nome errado preso até o próximo deploy
// é o tipo de coisa que ninguém liga o motivo.
const TTL_MS = 10 * 60 * 1000;
let cache: { emMs: number; valor: EmpreendimentoDoCatalogo[] } | null = null;
// A leitura que está em andamento, para quem chegar durante ela esperar a MESMA consulta.
let emVoo: null | Promise<EmpreendimentoDoCatalogo[]> = null;

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
  if (!opcoes.forcar && cache && agoraMs - cache.emMs < TTL_MS) return cache.valor;

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

async function lerDoC2x(agoraMs: number): Promise<EmpreendimentoDoCatalogo[]> {
  const poolResult = getHadesDbPool();
  if (!poolResult.ok) return cache?.valor ?? [];

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
    return cache?.valor ?? [];
  }

  const valor = agrupar(linhas);
  cache = { emMs: agoraMs, valor };
  return valor;
}

/**
 * Junta as divisões num empreendimento só, pela regra do Lucas: "temos essas divisões por
 * particularidade de cada empreendimento (fases, sócios), mas o mercado vê UM empreendimento".
 */
export function agrupar(linhas: LinhaCrua[]): EmpreendimentoDoCatalogo[] {
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
