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
import { carregarNomes } from "@/lib/apolo/painel-coordenador";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { type C2xPeriodo, resolvePeriodoRange } from "@/lib/guardian/c2x-analytics";

const CACHE_TTL_MS = 120_000;

export type CadRecord = {
  cliente: string;
  empreendimento: string | null;
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

    // Nome do empreendimento pelo id do C2X, com o texto da esteira como plano B. O texto varia
    // ("VALE DO OURO" e "Vale do Ouro" convivem) e a CACÁ agrupa por ele — resolver pelo id é o
    // que impede o mesmo loteamento de virar dois grupos na resposta.
    const nomes = await carregarNomes();

    const records: CadRecord[] = linhas.map((linha) => {
      const id = Number(linha.enterprise_id);
      const doC2x = Number.isFinite(id) ? nomes.get(id)?.name : undefined;

      return {
        cliente: nomePorId.get(linha.entity_id) ?? "(sem nome)",
        criadoEm: linha.chegou_em,
        empreendimento: doC2x ?? (linha.empreendimento?.trim() || null),
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

  const filtrados = records.filter((record) => {
    if (!matchTerm(record.empreendimento, filtros.empreendimento)) {
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
