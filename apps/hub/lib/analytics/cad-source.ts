import { type C2xPeriodo, resolvePeriodoRange } from "@/lib/guardian/c2x-analytics";

// Fonte "Central de CAD" (Asana) pro motor da CACÁ. Cada TASK do projeto = uma CAD (cadastro
// de prospect enviado pelos corretores). O NOME da task = o nome do cliente. As SEÇÕES do
// projeto = as ETAPAS do processo. Os campos custom trazem o empreendimento e a imobiliária
// credenciada — a imobiliária fica num campo DIFERENTE por empreendimento (nomes
// inconsistentes), então descobrimos dinamicamente: o 1º campo cujo nome contém "imobiliár" e
// que está preenchido. Read-only, reusa o ASANA_ACCESS_TOKEN do "Meu dia". Cache curto.

const ASANA_API_BASE_URL = "https://app.asana.com/api/1.0";
const CAD_PROJECT_GID =
  process.env.ASANA_CAD_PROJECT_GID?.trim() || "1209726796886414";
const CACHE_TTL_MS = 120_000;
const MAX_PAGES = 40;

export type CadRecord = {
  cliente: string;
  empreendimento: string | null;
  imobiliaria: string | null;
  etapa: string | null;
  criadoEm: string | null; // ISO
};

type AsanaCustomField = { name?: string | null; display_value?: string | null };
type AsanaMembership = {
  project?: { gid?: string | null } | null;
  section?: { name?: string | null } | null;
};
type AsanaTask = {
  name?: string | null;
  created_at?: string | null;
  custom_fields?: AsanaCustomField[] | null;
  memberships?: AsanaMembership[] | null;
};
type AsanaEnvelope<T> = { data: T; next_page?: { offset?: string | null } | null };

let cache: { at: number; records: CadRecord[] } | null = null;

function normalize(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

async function fetchAsana<T>(
  token: string,
  path: string,
  query: Record<string, string | undefined>,
): Promise<AsanaEnvelope<T>> {
  const url = new URL(`${ASANA_API_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(`Asana HTTP ${response.status}`);
  }

  return (await response.json()) as AsanaEnvelope<T>;
}

function extractEmpreendimento(fields: AsanaCustomField[]): string | null {
  // Preferência exata pelo campo de indicação; senão qualquer campo com "empreendimento".
  const exato = fields.find(
    (field) =>
      normalize(field.name).includes("empreendimento") &&
      normalize(field.name).includes("indica") &&
      field.display_value,
  );

  if (exato?.display_value) {
    return exato.display_value.trim();
  }

  const qualquer = fields.find(
    (field) =>
      normalize(field.name).includes("empreendimento") && field.display_value,
  );

  return qualquer?.display_value?.trim() ?? null;
}

function extractImobiliaria(fields: AsanaCustomField[]): string | null {
  // Imobiliária credenciada fica num campo por empreendimento (nome inconsistente): pega o
  // 1º campo cujo nome contém "imobiliár" e está preenchido.
  const campo = fields.find(
    (field) =>
      normalize(field.name).includes("imobiliar") && field.display_value,
  );

  return campo?.display_value?.trim() ?? null;
}

function extractEtapa(memberships: AsanaMembership[]): string | null {
  const daqui = memberships.find(
    (membership) => membership.project?.gid === CAD_PROJECT_GID,
  );

  return (
    daqui?.section?.name?.trim() ??
    memberships[0]?.section?.name?.trim() ??
    null
  );
}

// Carrega TODAS as CADs (tasks do projeto) com etapa + empreendimento + imobiliária. Cacheado.
// null = token ausente ou falha (a tool degrada com elegância).
export async function loadCadRecords(): Promise<CadRecord[] | null> {
  const token = process.env.ASANA_ACCESS_TOKEN?.trim();

  if (!token) {
    return null;
  }

  if (cache && cache.at > Date.now() - CACHE_TTL_MS) {
    return cache.records;
  }

  try {
    const records: CadRecord[] = [];
    let offset: string | undefined;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const query: Record<string, string | undefined> = {
        limit: "100",
        offset,
        opt_fields:
          "name,created_at,memberships.project.gid,memberships.section.name,custom_fields.name,custom_fields.display_value",
      };
      const envelope = await fetchAsana<AsanaTask[]>(
        token,
        `/projects/${CAD_PROJECT_GID}/tasks`,
        query,
      );

      for (const task of envelope.data ?? []) {
        const fields = task.custom_fields ?? [];

        records.push({
          cliente: task.name?.trim() || "(sem nome)",
          criadoEm: task.created_at ?? null,
          empreendimento: extractEmpreendimento(fields),
          etapa: extractEtapa(task.memberships ?? []),
          imobiliaria: extractImobiliaria(fields),
        });
      }

      offset = envelope.next_page?.offset ?? undefined;

      if (!offset) {
        break;
      }
    }

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
