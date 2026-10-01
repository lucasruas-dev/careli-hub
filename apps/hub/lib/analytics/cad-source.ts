// Fonte "Central de CAD" para o motor da CACÁ — hoje o BOARD DO APOLO (`apolo_esteira`).
//
// ⚠️ ERA O ASANA ATÉ 14/08/2026. O Asana deixou de ser a entrada de CAD quando o portal público
// do corretor entrou no ar, e o Lucas mandou cortar o vínculo de vez. As 575 CADs que viveram lá
// já foram importadas para a esteira, então nada se perdeu: elas contam aqui como qualquer
// outra, e a CACÁ passou a ter UMA resposta para "quantas CADs" em vez de duas divergentes.
//
// Cada linha de `apolo_esteira` = uma CAD = uma pessoa NUM empreendimento (a chave é
// `(entity_id, enterprise_id)` desde a migration 0080; a mesma pessoa pode ter CAD em dois
// loteamentos, e são duas CADs). Ver [[project_esteira_credenciamento_venda]].
import { resolverTermoDeEmpreendimento } from "@/lib/apolo/empreendimento-do-termo";
import { resolverTermoNoServidor } from "@/lib/apolo/empreendimento-do-termo-servidor";
import { carregarNomes } from "@/lib/apolo/painel-coordenador";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { reguaEmCache } from "@/lib/hercules/cadastro-em-cache";
import { type C2xPeriodo, resolvePeriodoRange } from "@/lib/guardian/c2x-analytics";

const CACHE_TTL_MS = 120_000;

export type CadRecord = {
  cliente: string;
  /** O nome de MERCADO do empreendimento (o do grupo, para uma divisão), pelo id. */
  empreendimento: string | null;
  /** O id gravado na esteira (do C2X, ou `group:<chave>`). É por ele que o filtro casa (PAN-124 F6). */
  enterpriseId: string | null;
  imobiliaria: string | null;
  etapa: string | null;
  criadoEm: string | null; // ISO
};

let cache: { at: number; records: CadRecord[] } | null = null;

function normalize(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

// Carrega TODAS as CADs da esteira com etapa + empreendimento + imobiliária. Cacheado 2 min.
// null = sem acesso ao Apolo (a tool degrada com elegância, como fazia com o token do Asana).
export async function loadCadRecords(): Promise<CadRecord[] | null> {
  if (cache && cache.at > Date.now() - CACHE_TTL_MS) {
    return cache.records;
  }

  const client = createApoloAdminClient();
  if (!client) return null;

  try {
    const { data, error } = await client
      .from("apolo_esteira")
      .select("entity_id, etapa, imobiliaria, empreendimento, enterprise_id, chegou_em");

    if (error || !data) return null;

    const linhas = data as Array<{
      chegou_em: string | null;
      empreendimento: string | null;
      enterprise_id: string | null;
      entity_id: string;
      etapa: string | null;
      imobiliaria: string | null;
    }>;

    // Nome do cliente vem de `apolo_entities` (a esteira guarda só o id). Em lotes de 300: a
    // lista inteira num `.in()` estoura o tamanho da URL do PostgREST.
    const ids = [...new Set(linhas.map((l) => l.entity_id))];
    const nomePorId = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 300) {
      const { data: entidades } = await client
        .from("apolo_entities")
        .select("id, display_name, legal_name")
        .in("id", ids.slice(i, i + 300));
      for (const entidade of (entidades ?? []) as Array<{
        display_name: string | null;
        id: string;
        legal_name: string | null;
      }>) {
        nomePorId.set(
          entidade.id,
          (entidade.legal_name || entidade.display_name || "").trim() || "(sem nome)",
        );
      }
    }

    // Nome do empreendimento PELO ID, com o texto da esteira como plano B. O texto varia ("VALE DO
    // OURO" e "Vale do Ouro" convivem) e a CACÁ agrupa por ele. Desde a F6 do PAN-124 o nome é o de
    // MERCADO pelo cadastro: a divisão (VOC, LBF) e o `group:<chave>` caem no nome do grupo, e o mesmo
    // loteamento não vira três grupos na resposta. Sem cadastro, o nome do C2X, como antes.
    const [nomesDoC2x, regua] = await Promise.all([carregarNomes(), reguaEmCache().catch(() => null)]);
    const nomePorEnterprise = new Map<string, null | string>();
    const nomeDoId = (enterpriseId: string): null | string => {
      if (!nomePorEnterprise.has(enterpriseId)) {
        nomePorEnterprise.set(
          enterpriseId,
          resolverTermoDeEmpreendimento(enterpriseId, { nomesDoC2x, regua })?.nome ?? null,
        );
      }
      return nomePorEnterprise.get(enterpriseId) ?? null;
    };

    const records: CadRecord[] = linhas.map((linha) => {
      const enterpriseId = linha.enterprise_id?.trim() || null;
      const peloId = enterpriseId ? nomeDoId(enterpriseId) : null;

      return {
        cliente: nomePorId.get(linha.entity_id) ?? "(sem nome)",
        criadoEm: linha.chegou_em,
        empreendimento: peloId ?? (linha.empreendimento?.trim() || null),
        enterpriseId,
        etapa: linha.etapa,
        imobiliaria: linha.imobiliaria?.trim() || null,
      };
    });

    cache = { at: Date.now(), records };

    return records;
  } catch (error) {
    console.error(
      "[cad] loadCadRecords falhou",
      error instanceof Error ? error.message : error,
    );

    return null;
  }
}

export type CadFiltros = {
  empreendimento?: string;
  imobiliaria?: string;
  cliente?: string;
  etapa?: string;
};

export type CadAgruparPor = "empreendimento" | "imobiliaria" | "etapa";

export type CadResultado = {
  total: number;
  periodoLabel: string | null;
  filtrosLabel: string | null;
  agruparPor: CadAgruparPor | null;
  grupos: { grupo: string; valor: number; clientes: string[] }[] | null;
  // CADs do recorte (quando não agrupado): registro completo pra responder "qual imobiliária
  // está o cliente X" (empreendimento/imobiliária/etapa). Limitado pra não estourar a resposta.
  registros: CadRecord[];
};

function matchTerm(value: string | null, term: string | undefined): boolean {
  if (!term) {
    return true;
  }

  return normalize(value).includes(normalize(term));
}

export async function queryCad(input: {
  filtros?: CadFiltros;
  agruparPor?: CadAgruparPor | null;
  periodo?: C2xPeriodo | null;
}): Promise<CadResultado | null> {
  const records = await loadCadRecords();

  if (!records) {
    return null;
  }

  const filtros = input.filtros ?? {};
  const range = input.periodo ? resolvePeriodoRange(input.periodo) : null;

  // O empreendimento pedido vira IDS (com o grupo inteiro), e a CAD casa pelo id gravado (PAN-124 F6).
  // Termo que não resolve: o "contém o texto" de antes, sobre o nome.
  const doEmpreendimento = filtros.empreendimento
    ? await resolverTermoNoServidor(filtros.empreendimento).catch(() => null)
    : null;
  const idsDoEmpreendimento = doEmpreendimento ? new Set(doEmpreendimento.ids) : null;

  const filtrados = records.filter((record) => {
    if (idsDoEmpreendimento) {
      if (!record.enterpriseId || !idsDoEmpreendimento.has(record.enterpriseId)) return false;
    } else if (!matchTerm(record.empreendimento, filtros.empreendimento)) {
      return false;
    }
    if (!matchTerm(record.imobiliaria, filtros.imobiliaria)) {
      return false;
    }
    if (!matchTerm(record.cliente, filtros.cliente)) {
      return false;
    }
    if (!matchTerm(record.etapa, filtros.etapa)) {
      return false;
    }
    if (range && record.criadoEm) {
      const t = new Date(record.criadoEm).getTime();

      if (!(t >= range.from.getTime() && t < range.to.getTime())) {
        return false;
      }
    } else if (range && !record.criadoEm) {
      return false;
    }

    return true;
  });

  const filtrosLabel =
    Object.entries(filtros)
      .filter(([, value]) => value)
      .map(([key, value]) => `${key} ~ "${value}"`)
      .join(" · ") || null;

  if (input.agruparPor) {
    const mapa = new Map<string, string[]>();

    for (const record of filtrados) {
      const chave =
        (input.agruparPor === "empreendimento"
          ? record.empreendimento
          : input.agruparPor === "imobiliaria"
            ? record.imobiliaria
            : record.etapa) ?? "(não informado)";
      const lista = mapa.get(chave) ?? [];
      lista.push(record.cliente);
      mapa.set(chave, lista);
    }

    const grupos = Array.from(mapa.entries())
      .map(([grupo, clientes]) => ({ clientes, grupo, valor: clientes.length }))
      .sort((first, second) => second.valor - first.valor);

    return {
      agruparPor: input.agruparPor,
      filtrosLabel,
      grupos,
      periodoLabel: range?.label ?? null,
      registros: [],
      total: filtrados.length,
    };
  }

  return {
    agruparPor: null,
    filtrosLabel,
    grupos: null,
    periodoLabel: range?.label ?? null,
    registros: filtrados.slice(0, 60),
    total: filtrados.length,
  };
}
