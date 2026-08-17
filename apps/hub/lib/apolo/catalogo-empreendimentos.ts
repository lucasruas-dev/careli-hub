import { EXCLUDED_ENTERPRISE_CODES, ENTERPRISE_GROUPS } from "@/lib/guardian/c2x-analytics";
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

export function limparCacheDoCatalogo(): void {
  cache = null;
}

/**
 * Lê o catálogo de empreendimentos do C2X (READ-ONLY), agrupado pela regra do negócio.
 *
 * Devolve lista VAZIA se o C2X estiver indisponível: quem chama trata a ausência de catálogo como
 * "sem tradução", nunca como "não existe empreendimento".
 */
export async function catalogoDeEmpreendimentos(
  agoraMs: number,
): Promise<EmpreendimentoDoCatalogo[]> {
  if (cache && agoraMs - cache.emMs < TTL_MS) return cache.valor;

  const poolResult = getHadesDbPool();
  if (!poolResult.ok) return cache?.valor ?? [];

  const placeholders = EXCLUDED_ENTERPRISE_CODES.map(() => "?").join(", ");

  let linhas: LinhaCrua[];
  try {
    const [rows] = await poolResult.pool.query(
      `select e.id, e.code, e.name
         from enterprises e
        where e.code not in (${placeholders})
        order by e.code`,
      EXCLUDED_ENTERPRISE_CODES,
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
      id: `group:${grupo.display}`,
      name: grupo.display.toLocaleUpperCase("pt-BR"),
      stageIds: divisoes.map((divisao) => String(divisao.id)),
    });
  }

  for (const linha of linhas) {
    const code = (linha.code ?? "").trim().toUpperCase();
    if (!code || consumidos.has(code)) continue;

    saida.push({
      id: String(linha.id),
      name: (linha.name ?? code).trim().toLocaleUpperCase("pt-BR"),
      // Para o empreendimento simples, a "divisão" é ele mesmo — assim quem consome não precisa
      // de dois caminhos para traduzir um id.
      stageIds: [String(linha.id)],
    });
  }

  return saida.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}
