// Camada de LEITURA da Cobrança (Hades) no contexto do EMPREENDIMENTO (Apolo).
// Apolo MOSTRA, Hades é DONO: o motor `guardian_compromissos` (Supabase, migration
// 0036/0037, já em prod) registra promessa/acordo; aqui a gente só lê e amarra ao
// empreendimento/unidade da carteira. Ver [[project-apolo-crm-grafo]] e
// [[project-hades-cobranca-design]].
import type { RowDataPacket } from "mysql2";

import { EXCLUDED_ENTERPRISE_CODES } from "@/lib/guardian/c2x-analytics";
import {
  createGuardianMotorClient,
  listGuardianCompromissosByClient,
  type GuardianCompromissoDetail,
  type GuardianCompromissoKind,
} from "@/lib/guardian/compromissos";
import { getHadesDbPool } from "@/lib/guardian/db";

// Etapa de cobrança derivada dos compromissos da unidade (mesma prioridade do
// Hades: acordo aprovado > promessa aprovada > pendente = negociação > quebrado).
export type ApoloCobrancaStage =
  | "acordo"
  | "negociacao"
  | "promessa"
  | "quebrado";

export type ApoloUnitCobranca = {
  kind: GuardianCompromissoKind | null;
  promisedDate: string | null;
  protocol: string | null;
  stage: ApoloCobrancaStage;
};

export type ApoloCobrancaMoney = { count: number; value: number };

// Funil de recuperação do empreendimento (buckets sem sobreposição).
export type ApoloCobrancaFunnel = {
  acordosAtivos: ApoloCobrancaMoney;
  emNegociacao: ApoloCobrancaMoney;
  promessasAtivas: ApoloCobrancaMoney;
  quebradas30d: ApoloCobrancaMoney;
  recuperado30d: ApoloCobrancaMoney;
};

export type ApoloEnterpriseCobranca = {
  // Selo por unidade (chave = enterprise_unity id, igual ao id da carteira).
  byUnitId: Record<string, ApoloUnitCobranca>;
  funnel: ApoloCobrancaFunnel;
};

type MapRow = RowDataPacket & {
  ar_id: number | string | null;
  client_id: number | string | null;
  unit_id: number | string;
};

type CompromissoScopeRow = {
  acquisition_request_c2x_id: number | string | null;
  approval_status: string;
  broken_at: string | null;
  client_c2x_id: number | string;
  first_due_date: string | null;
  id: string;
  kind: GuardianCompromissoKind;
  promised_date: string | null;
  protocol: string;
  status: string;
  total_amount: number | string;
};

type ParcelaScopeRow = {
  amount: number | string;
  compromisso_id: string;
  paid_at: string | null;
  status: string;
};

// Read-only e tolerante a falha: qualquer ausência (sem Supabase, sem C2X, sem
// compromissos) devolve vazio — a carteira NUNCA quebra por causa da cobrança.
export async function loadApoloEnterpriseCobranca(
  codes: string[],
): Promise<
  { data: ApoloEnterpriseCobranca; ok: true } | { error: string; ok: false }
> {
  const empty: ApoloEnterpriseCobranca = {
    byUnitId: {},
    funnel: emptyFunnel(),
  };

  const validCodes = codes
    .map((code) => code.trim().toUpperCase())
    .filter((code) => code && !EXCLUDED_ENTERPRISE_CODES.includes(code));

  if (!validCodes.length) {
    return { data: empty, ok: true };
  }

  const motor = createGuardianMotorClient();
  const poolResult = getHadesDbPool();

  if (!motor || !poolResult.ok) {
    return { data: empty, ok: true };
  }

  // 1) Mapa C2X: unidade <-> (acquisition_request, cliente) do empreendimento.
  const inCodes = validCodes.map(() => "?").join(", ");
  const [rows] = await poolResult.pool.query<MapRow[]>(
    `select eu.id as unit_id, ar.id as ar_id, ar.client_id as client_id
       from acquisition_requests ar
       join enterprise_unities eu on eu.id = ar.enterprise_unity_id
       join enterprises e on e.id = eu.enterprise_id
      where e.code in (${inCodes})`,
    validCodes,
  );

  if (!rows.length) {
    return { data: empty, ok: true };
  }

  const arToUnit = new Map<number, string>();
  const clientToUnits = new Map<number, Set<string>>();
  const clientIds = new Set<number>();

  for (const row of rows) {
    const unitId = String(row.unit_id);
    const arId = toNum(row.ar_id);
    const clientId = toNum(row.client_id);

    if (arId > 0) {
      arToUnit.set(arId, unitId);
    }
    if (clientId > 0) {
      clientIds.add(clientId);
      const set = clientToUnits.get(clientId) ?? new Set<string>();
      set.add(unitId);
      clientToUnits.set(clientId, set);
    }
  }

  if (!clientIds.size) {
    return { data: empty, ok: true };
  }

  // 2) Compromissos desses clientes (Supabase).
  const { data: compromissos, error: compromissosError } = await motor
    .from("guardian_compromissos")
    .select(
      "id,client_c2x_id,acquisition_request_c2x_id,kind,status,approval_status,promised_date,first_due_date,protocol,total_amount,broken_at",
    )
    .in("client_c2x_id", [...clientIds])
    .limit(10000)
    .returns<CompromissoScopeRow[]>();

  if (compromissosError || !compromissos?.length) {
    return { data: empty, ok: true };
  }

  // 3) Parcelas dos compromissos (para o recuperado 30d do funil).
  const { data: parcelas } = await motor
    .from("guardian_compromisso_parcelas")
    .select("compromisso_id,amount,status,paid_at")
    .in(
      "compromisso_id",
      compromissos.map((row) => row.id),
    )
    .limit(40000)
    .returns<ParcelaScopeRow[]>();

  // 4) Atribui cada compromisso a uma unidade: por acquisition_request quando há;
  // senão por cliente (unívoco = a unidade dele; multi-unidade = best effort).
  const byUnitCompromissos = new Map<string, CompromissoScopeRow[]>();
  const attribute = (unitId: string, row: CompromissoScopeRow) => {
    const list = byUnitCompromissos.get(unitId) ?? [];
    list.push(row);
    byUnitCompromissos.set(unitId, list);
  };

  for (const row of compromissos) {
    const arId = toNum(row.acquisition_request_c2x_id);
    const unitByAr = arId > 0 ? arToUnit.get(arId) : undefined;

    if (unitByAr) {
      attribute(unitByAr, row);
      continue;
    }

    const units = clientToUnits.get(toNum(row.client_c2x_id));
    if (units) {
      for (const unitId of units) {
        attribute(unitId, row);
      }
    }
  }

  const byUnitId: Record<string, ApoloUnitCobranca> = {};
  for (const [unitId, list] of byUnitCompromissos) {
    const derived = deriveUnitCobranca(list);
    if (derived) {
      byUnitId[unitId] = derived;
    }
  }

  const funnel = buildFunnel(compromissos, parcelas ?? []);

  return { data: { byUnitId, funnel }, ok: true };
}

// Detalhe dos compromissos de UMA unidade (para o modal de negociação do Apolo).
// Traz o compromisso completo do motor (parcelas + régua de lembretes). Read-only.
export async function loadApoloUnitCompromissos(
  unitId: string,
): Promise<
  { compromissos: GuardianCompromissoDetail[]; ok: true } | { error: string; ok: false }
> {
  const id = Number(unitId);

  if (!Number.isInteger(id) || id <= 0) {
    return { error: "Unidade invalida.", ok: false };
  }

  const motor = createGuardianMotorClient();
  const poolResult = getHadesDbPool();

  if (!motor || !poolResult.ok) {
    return { compromissos: [], ok: true };
  }

  // Clientes e acquisition_requests desta unidade (uma unidade pode ter mais de um
  // contrato por revenda).
  const [rows] = await poolResult.pool.query<
    (RowDataPacket & { ar_id: number | string | null; client_id: number | string | null })[]
  >(
    `select ar.id as ar_id, ar.client_id
       from acquisition_requests ar
      where ar.enterprise_unity_id = ?`,
    [id],
  );

  const clientIds = new Set<number>();
  const arIds = new Set<number>();
  for (const row of rows) {
    const clientId = toNum(row.client_id);
    const arId = toNum(row.ar_id);
    if (clientId > 0) {
      clientIds.add(clientId);
    }
    if (arId > 0) {
      arIds.add(arId);
    }
  }

  if (!clientIds.size) {
    return { compromissos: [], ok: true };
  }

  const seen = new Set<string>();
  const compromissos: GuardianCompromissoDetail[] = [];
  for (const clientId of clientIds) {
    const list = await listGuardianCompromissosByClient(motor, clientId);
    for (const item of list) {
      // Compromisso com acquisition_request de OUTRA unidade do mesmo cliente é
      // descartado; sem ar (nível cliente) fica.
      if (item.acquisitionRequestC2xId && !arIds.has(item.acquisitionRequestC2xId)) {
        continue;
      }
      if (seen.has(item.id)) {
        continue;
      }
      seen.add(item.id);
      compromissos.push(item);
    }
  }

  compromissos.sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  return { compromissos, ok: true };
}

// Mesma prioridade do deriveStageFromRows do Hades.
function deriveUnitCobranca(
  rows: CompromissoScopeRow[],
): ApoloUnitCobranca | null {
  const active = rows.filter((row) => row.status === "ativo");
  const approvedAcordo = active.find(
    (row) => row.kind === "acordo" && row.approval_status === "aprovado",
  );
  const approvedPromessa = active.find(
    (row) => row.kind === "promessa" && row.approval_status === "aprovado",
  );
  const pending = active.find((row) => row.approval_status === "pendente");
  const broken = rows.find((row) => row.status === "quebrado");

  if (approvedAcordo) {
    return {
      kind: "acordo",
      promisedDate: approvedAcordo.first_due_date,
      protocol: approvedAcordo.protocol,
      stage: "acordo",
    };
  }
  if (approvedPromessa) {
    return {
      kind: "promessa",
      promisedDate: approvedPromessa.promised_date,
      protocol: approvedPromessa.protocol,
      stage: "promessa",
    };
  }
  if (pending) {
    return {
      kind: pending.kind,
      promisedDate:
        pending.kind === "promessa" ? pending.promised_date : pending.first_due_date,
      protocol: pending.protocol,
      stage: "negociacao",
    };
  }
  if (broken) {
    return {
      kind: broken.kind,
      promisedDate: null,
      protocol: broken.protocol,
      stage: "quebrado",
    };
  }

  return null;
}

function buildFunnel(
  compromissos: CompromissoScopeRow[],
  parcelas: ParcelaScopeRow[],
): ApoloCobrancaFunnel {
  const since30d = Date.now() - 30 * 24 * 60 * 60 * 1000;

  let emNegCount = 0;
  let emNegValue = 0;
  let promCount = 0;
  let promValue = 0;
  let acordCount = 0;
  let acordValue = 0;
  let quebCount = 0;
  let quebValue = 0;

  for (const row of compromissos) {
    const value = toNum(row.total_amount);
    const active = row.status === "ativo";

    if (active && row.approval_status === "pendente") {
      emNegCount += 1;
      emNegValue += value;
    }

    if (active && row.approval_status === "aprovado") {
      if (row.kind === "promessa") {
        promCount += 1;
        promValue += value;
      } else {
        acordCount += 1;
        acordValue += value;
      }
    }

    if (
      row.status === "quebrado" &&
      row.broken_at &&
      Date.parse(row.broken_at) >= since30d
    ) {
      quebCount += 1;
      quebValue += value;
    }
  }

  let recCount = 0;
  let recValue = 0;
  for (const parcela of parcelas) {
    if (
      parcela.status === "paga" &&
      parcela.paid_at &&
      Date.parse(parcela.paid_at) >= since30d
    ) {
      recCount += 1;
      recValue += toNum(parcela.amount);
    }
  }

  return {
    acordosAtivos: { count: acordCount, value: round2(acordValue) },
    emNegociacao: { count: emNegCount, value: round2(emNegValue) },
    promessasAtivas: { count: promCount, value: round2(promValue) },
    quebradas30d: { count: quebCount, value: round2(quebValue) },
    recuperado30d: { count: recCount, value: round2(recValue) },
  };
}

function emptyFunnel(): ApoloCobrancaFunnel {
  const zero: ApoloCobrancaMoney = { count: 0, value: 0 };

  return {
    acordosAtivos: { ...zero },
    emNegociacao: { ...zero },
    promessasAtivas: { ...zero },
    quebradas30d: { ...zero },
    recuperado30d: { ...zero },
  };
}

function toNum(value: number | string | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);

  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
