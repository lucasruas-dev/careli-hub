// Cenário comercial dos EMPREENDIMENTOS (Apolo). Lê o C2X (read-only) e aplica a regra de
// governança do Hades — fonte única em lib/guardian/c2x-analytics.ts:
//   - EXCLUDED_ENTERPRISE_CODES: TSC/SDT/LAB/LAG ficam de fora (teste + masterplan/aditivo).
//   - ENTERPRISE_GROUPS: etapas do mesmo produto viram UMA linha consolidada (Lavra do Ouro =
//     LOS+LOU, Lagoa Bonita = LBF+LBR+LBP...), com as etapas como sub-linhas expansíveis.
//
// Baldes de unidade (mutuamente exclusivos, somam o total). O status 5 ("Bloqueado para venda")
// está ZERADO no C2X: o bloqueio real é o flag `enterprise_unities.sale_blocked`, e hoje todas
// as bloqueadas estão como "Disponível" — por isso Disponível DESCONTA as bloqueadas.
import type { RowDataPacket } from "mysql2";

import { deterministicUuid } from "@/lib/apolo/server";
import {
  ENTERPRISE_GROUPS,
  EXCLUDED_ENTERPRISE_CODES,
} from "@/lib/guardian/c2x-analytics";
import { getHadesDbPool } from "@/lib/guardian/db";

const SALE_STATUS = {
  DISPONIVEL: 1,
  RESERVADO: 2,
  EM_NEGOCIACAO: 3,
  VENDIDO: 4,
} as const;

// Abas da ficha do empreendimento. O estado vive no ApoloPage (e não na tela) pra o "voltar"
// do CRM devolver o usuário NA ABA em que ele estava.
export type ApoloEnterpriseTab =
  | "cadastro"
  | "carteira"
  | "relacionamentos"
  | "resumo"
  | "unidades"
  | "vendas";

export type ApoloEnterpriseBucket =
  | "disponivel"
  | "reservado"
  | "negociacao"
  | "vendido"
  | "bloqueado";

export type ApoloEnterpriseTally = {
  units: number;
  value: number;
};

export type ApoloEnterpriseScenario = Record<
  ApoloEnterpriseBucket | "total",
  ApoloEnterpriseTally
>;

export type ApoloEnterpriseRow = {
  city: string | null;
  // Código C2X (ex.: LBR). No grupo consolidado, o rótulo das etapas ("LBF + LBR + LBP").
  code: string;
  // Códigos reais (1 na linha simples; N no produto consolidado). Usado pra buscar unidades.
  codes: string[];
  id: string;
  incorporador: string | null;
  name: string;
  scenario: ApoloEnterpriseScenario;
  state: string | null;
  // Etapas do produto (só no grupo consolidado). Vazio = linha simples.
  stages: ApoloEnterpriseRow[];
};

export type ApoloEnterprisesData = {
  rows: ApoloEnterpriseRow[];
  totals: ApoloEnterpriseScenario;
};

type EnterpriseQueryRow = RowDataPacket & {
  bloqueado_units: number | string | null;
  bloqueado_value: string | number | null;
  city: string | null;
  code: string | null;
  disponivel_units: number | string | null;
  disponivel_value: string | number | null;
  id: number;
  incorporador: string | null;
  name: string | null;
  negociacao_units: number | string | null;
  negociacao_value: string | number | null;
  reservado_units: number | string | null;
  reservado_value: string | number | null;
  state: string | null;
  total_units: number | string | null;
  total_value: string | number | null;
  vendido_units: number | string | null;
  vendido_value: string | number | null;
};

export async function loadApoloEnterprises(): Promise<
  { data: ApoloEnterprisesData; ok: true } | { error: string; ok: false }
> {
  const poolResult = getHadesDbPool();

  if (!poolResult.ok) {
    return {
      error: `Configuracao C2X ausente: ${poolResult.missing.join(", ")}.`,
      ok: false,
    };
  }

  const placeholders = EXCLUDED_ENTERPRISE_CODES.map(() => "?").join(", ");
  const [rows] = await poolResult.pool.query<EnterpriseQueryRow[]>(
    `select
       e.id,
       e.code,
       e.name,
       ci.name as city,
       s.acronym as state,
       inc.name as incorporador,
       count(u.id) as total_units,
       coalesce(sum(u.price), 0) as total_value,
       sum(case when u.sale_status_id = ? and coalesce(u.sale_blocked, 0) = 0 then 1 else 0 end) as disponivel_units,
       coalesce(sum(case when u.sale_status_id = ? and coalesce(u.sale_blocked, 0) = 0 then u.price else 0 end), 0) as disponivel_value,
       sum(case when u.sale_status_id = ? and coalesce(u.sale_blocked, 0) = 1 then 1 else 0 end) as bloqueado_units,
       coalesce(sum(case when u.sale_status_id = ? and coalesce(u.sale_blocked, 0) = 1 then u.price else 0 end), 0) as bloqueado_value,
       sum(case when u.sale_status_id = ? then 1 else 0 end) as reservado_units,
       coalesce(sum(case when u.sale_status_id = ? then u.price else 0 end), 0) as reservado_value,
       sum(case when u.sale_status_id = ? then 1 else 0 end) as negociacao_units,
       coalesce(sum(case when u.sale_status_id = ? then u.price else 0 end), 0) as negociacao_value,
       sum(case when u.sale_status_id = ? then 1 else 0 end) as vendido_units,
       coalesce(sum(case when u.sale_status_id = ? then u.price else 0 end), 0) as vendido_value
     from enterprises e
     left join enterprise_unities u on u.enterprise_id = e.id
     left join cities ci on ci.id = e.city_id
     left join states s on s.id = ci.state_id
     left join users inc on inc.id = e.incorporador_id
     where e.code not in (${placeholders})
     group by e.id, e.code, e.name, ci.name, s.acronym, inc.name
     order by e.code`,
    [
      SALE_STATUS.DISPONIVEL,
      SALE_STATUS.DISPONIVEL,
      SALE_STATUS.DISPONIVEL,
      SALE_STATUS.DISPONIVEL,
      SALE_STATUS.RESERVADO,
      SALE_STATUS.RESERVADO,
      SALE_STATUS.EM_NEGOCIACAO,
      SALE_STATUS.EM_NEGOCIACAO,
      SALE_STATUS.VENDIDO,
      SALE_STATUS.VENDIDO,
      ...EXCLUDED_ENTERPRISE_CODES,
    ],
  );

  const mapped = rows.map(mapEnterpriseRow);

  return { data: { rows: groupEnterpriseRows(mapped), totals: sumScenarios(mapped) }, ok: true };
}

// Player ligado ao empreendimento no C2X. É a semente das arestas do grafo.
//
// PAPÉIS ACUMULÁVEIS (regra do Lucas): o `profile` declarado no C2X (Imobiliária, Corretor,
// Incorporador...) é UM papel; a FUNÇÃO no empreendimento é outro — e eles se somam na mesma
// entidade. Ex.: Luna Negócios é `Imobiliária` (perfil) E `Coordenador de Vendas` (função).
//
// Tradução de nome: no Apolo o `manager_id` do C2X chama-se COORDENADOR DE VENDAS (no C2X o
// campo continua "gerente"). Nome de PJ mora em fantasy_name/social_name — daí o coalesce.
// ⚠️ OS RÓTULOS DO C2X ESTÃO ERRADOS — não confiar neles (regra do Lucas):
//   incorporador_id -> Incorporador            (C2X: "Incorporador")     ✔ exibe
//   manager_id      -> COORDENADOR DE VENDAS   (C2X: "Gerente")          ✔ exibe
//   captivator_id   -> Captador                (C2X: "Captador")         ✔ exibe
//   coordenador_id  -> (dado errado no C2X: vem o MESMO player nos 24 empreendimentos)
//                      NÃO exibe; fica no dado pro Lucas corrigir no C2X quando houver escrita.
export type ApoloEnterprisePlayerRelation =
  | "captador"
  | "coordenador_c2x"
  | "coordenador_vendas"
  | "incorporador";

export type ApoloEnterprisePlayer = {
  address: string | null;
  document: string | null;
  email: string | null;
  // Id da entidade no Apolo, derivado do id do user no C2X. É por ele que a tela abre a ficha
  // CERTA no CRM (buscar por nome casa homônimos e abre a pessoa errada).
  entityId: string;
  name: string;
  phone: string | null;
  // Função DESTE player no empreendimento (a aresta). Na tela do empreendimento só ESTE papel
  // aparece; os demais papéis da entidade vivem na ficha dela, no CRM.
  relation: ApoloEnterprisePlayerRelation;
};

export const enterprisePlayerLabels: Record<
  ApoloEnterprisePlayerRelation,
  string
> = {
  captador: "Captador",
  coordenador_c2x: "Coordenador (C2X)",
  coordenador_vendas: "Coordenador de Vendas",
  incorporador: "Incorporador",
};

// Não exibido na tela (dado errado no C2X; fica só no payload pra correção futura).
export const HIDDEN_ENTERPRISE_PLAYER_RELATIONS: ApoloEnterprisePlayerRelation[] =
  ["coordenador_c2x"];

export type ApoloEnterpriseCadastro = {
  actValue: number | null;
  city: string | null;
  code: string;
  createdAt: string | null;
  divulgationName: string | null;
  expectedDelivery: string | null;
  focalEmail: string | null;
  focalName: string | null;
  focalPhone: string | null;
  kind: string | null;
  name: string;
  players: ApoloEnterprisePlayer[];
  state: string | null;
  // Tipo de financiamento/tabela (PRICE | SACOOC).
  tableKind: string | null;
};

type PlayerColumns<Alias extends string> = {
  [K in
    | Alias
    | `${Alias}_address`
    | `${Alias}_document`
    | `${Alias}_email`
    | `${Alias}_phone`]: string | null;
} & {
  [K in `${Alias}_user_id`]: number | string | null;
};

type CadastroQueryRow = RowDataPacket &
  PlayerColumns<"captador"> &
  PlayerColumns<"coordenador"> &
  PlayerColumns<"gerente"> &
  PlayerColumns<"incorporador"> & {
    act_value: string | number | null;
    city: string | null;
    code: string | null;
    created_at: Date | string | null;
    divulgation_name: string | null;
    expected_delivery_date: Date | string | null;
    focal_email: string | null;
    focal_name: string | null;
    focal_phone: string | null;
    kind: string | null;
    name: string | null;
    state: string | null;
    table_kind: string | null;
  };

// Nome do player: PJ guarda em fantasy_name/social_name; PF em name.
const PLAYER_NAME_SQL = `coalesce(nullif(trim(pu.name), ''), nullif(trim(pu.fantasy_name), ''), nullif(trim(pu.social_name), ''))`;
const PLAYER_DOC_SQL = `coalesce(nullif(trim(pu.cpf), ''), nullif(trim(pu.cnpj), ''))`;

// ⚠️ O telefone NÃO mora em `users.phone/cellphone` (quase vazios: 93 de 4.128 users). A fonte
// é a tabela polimórfica `phones` (ownertable_type='User'), preferindo o WhatsApp — a mesma
// leitura que o sync do Apolo faz. Ler de `users` deixava quase todo player sem telefone.
const playerPhoneSql = (column: string) => `(
    select nullif(trim(ph.phone), '')
      from phones ph
     where ph.ownertable_type = 'User'
       and ph.ownertable_id = e.${column}
       and trim(coalesce(ph.phone, '')) <> ''
     order by ph.is_whatsapp desc, ph.updated_at desc, ph.id desc
     limit 1
  )`;

// Enriquecimento vindo de `users` (+ `addresses`): telefone, e-mail, documento e endereço.
function playerSelect(column: string, alias: string): string {
  return `e.${column} as ${alias}_user_id,
          (select ${PLAYER_NAME_SQL} from users pu where pu.id = e.${column}) as ${alias},
          ${playerPhoneSql(column)} as ${alias}_phone,
          (select nullif(trim(pu.email), '') from users pu where pu.id = e.${column}) as ${alias}_email,
          (select ${PLAYER_DOC_SQL} from users pu where pu.id = e.${column}) as ${alias}_document,
          (select concat_ws(', ',
                    nullif(trim(pa.address), ''),
                    nullif(trim(pa.number), ''),
                    nullif(trim(pa.district), ''),
                    nullif(trim(pac.name), ''),
                    nullif(trim(pas.acronym), ''))
             from addresses pa
             left join cities pac on pac.id = pa.city_id
             left join states pas on pas.id = pa.state_id
            where pa.ownertable_type = 'User' and pa.ownertable_id = e.${column}
            limit 1) as ${alias}_address`;
}

// Cadastro do empreendimento (uma ficha por CÓDIGO — o produto consolidado tem N).
export async function loadApoloEnterpriseCadastro(
  codes: string[],
): Promise<
  { cadastros: ApoloEnterpriseCadastro[]; ok: true } | { error: string; ok: false }
> {
  const validCodes = codes
    .map((code) => code.trim().toUpperCase())
    .filter((code) => code && !EXCLUDED_ENTERPRISE_CODES.includes(code));

  if (!validCodes.length) {
    return { cadastros: [], ok: true };
  }

  const poolResult = getHadesDbPool();

  if (!poolResult.ok) {
    return {
      error: `Configuracao C2X ausente: ${poolResult.missing.join(", ")}.`,
      ok: false,
    };
  }

  const placeholders = validCodes.map(() => "?").join(", ");
  const [rows] = await poolResult.pool.query<CadastroQueryRow[]>(
    `select e.code, e.name, e.divulgation_name,
            et.name as kind,
            etab.name as table_kind,
            ci.name as city, st.acronym as state,
            e.expected_delivery_date, e.act_value, e.created_at,
            e.focal_name, e.focal_phone, e.focal_email,
            ${playerSelect("incorporador_id", "incorporador")},
            ${playerSelect("manager_id", "gerente")},
            ${playerSelect("captivator_id", "captador")},
            ${playerSelect("coordenador_id", "coordenador")}
     from enterprises e
     left join enterprise_types et on et.id = e.enterprise_type_id
     left join enterprise_tables etab on etab.id = e.enterprise_table_id
     left join cities ci on ci.id = e.city_id
     left join states st on st.id = ci.state_id
     where e.code in (${placeholders})
     order by e.code`,
    validCodes,
  );

  return { cadastros: rows.map(mapCadastroRow), ok: true };
}

function mapCadastroRow(row: CadastroQueryRow): ApoloEnterpriseCadastro {
  const player = (
    relation: ApoloEnterprisePlayerRelation,
    name: string | null,
    userId: number | string | null,
    phone: string | null,
    email: string | null,
    document: string | null,
    address: string | null,
  ): ApoloEnterprisePlayer | null => {
    const cleaned = cleanText(name);

    if (!cleaned || !userId) {
      return null;
    }

    return {
      address: cleanText(address),
      document: cleanText(document),
      email: cleanText(email),
      // Mesma semente do sync (persistApoloEntityBatch) — aponta pra ficha certa no CRM.
      entityId: deterministicUuid(`apolo:c2x:users:${userId}`),
      name: cleaned,
      phone: cleanText(phone),
      relation,
    };
  };

  const players = [
    player(
      "incorporador",
      row.incorporador,
      row.incorporador_user_id,
      row.incorporador_phone,
      row.incorporador_email,
      row.incorporador_document,
      row.incorporador_address,
    ),
    // C2X chama de "Gerente", mas na Careli é o COORDENADOR DE VENDAS.
    player(
      "coordenador_vendas",
      row.gerente,
      row.gerente_user_id,
      row.gerente_phone,
      row.gerente_email,
      row.gerente_document,
      row.gerente_address,
    ),
    player(
      "captador",
      row.captador,
      row.captador_user_id,
      row.captador_phone,
      row.captador_email,
      row.captador_document,
      row.captador_address,
    ),
    // Dado errado no C2X (mesmo player nos 24) — vai no payload, mas a tela filtra.
    player(
      "coordenador_c2x",
      row.coordenador,
      row.coordenador_user_id,
      row.coordenador_phone,
      row.coordenador_email,
      row.coordenador_document,
      row.coordenador_address,
    ),
  ].filter((entry): entry is ApoloEnterprisePlayer => Boolean(entry));

  return {
    actValue: row.act_value === null ? null : toNumber(row.act_value),
    city: cleanText(row.city),
    code: cleanText(row.code) ?? "",
    createdAt: toIsoDate(row.created_at),
    divulgationName: cleanText(row.divulgation_name),
    expectedDelivery: toIsoDate(row.expected_delivery_date),
    focalEmail: cleanText(row.focal_email),
    focalName: cleanText(row.focal_name),
    focalPhone: cleanText(row.focal_phone),
    kind: cleanText(row.kind),
    name: cleanText(row.name) ?? "Empreendimento",
    players,
    state: cleanText(row.state),
    tableKind: cleanText(row.table_kind),
  };
}

function toIsoDate(value: Date | string | null): string | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// Parte envolvida na movimentação da unidade (comprador ou imobiliária). O `entityId` permite
// abrir a ficha CERTA no CRM.
export type ApoloUnitParty = {
  code: string | null;
  entityId: string;
  name: string;
};

// A ÚLTIMA MOVIMENTAÇÃO da unidade (a proposta/venda mais recente). É o que amarra o
// comprador e a imobiliária àquela unidade. O vínculo comprador→imobiliária vem de
// `users.vinculed_by_id` — `imobiliaria_id` está ZERADO no C2X (0 de 3.595 clientes).
export type ApoloUnitMovement = {
  client: ApoloUnitParty | null;
  imobiliaria: ApoloUnitParty | null;
  stage: string | null;
};

export type ApoloEnterpriseUnit = {
  area: number | null;
  block: string | null;
  bucket: ApoloEnterpriseBucket;
  // Código da unidade (ex.: LOU0101 = sigla + quadra + lote), mesmo padrão do Hades.
  code: string;
  enterpriseCode: string;
  id: string;
  // Unidade interna / externa.
  kind: string | null;
  lot: string | null;
  movement: ApoloUnitMovement | null;
  price: number;
  // Matrícula do registro.
  registration: string | null;
  status: string;
};

type UnitQueryRow = RowDataPacket & {
  area: string | number | null;
  block: string | null;
  client_code: string | null;
  client_id: number | null;
  client_name: string | null;
  enterprise_code: string | null;
  id: number;
  imobiliaria_code: string | null;
  imobiliaria_id: number | null;
  imobiliaria_name: string | null;
  kind: string | null;
  lot: string | null;
  price: string | number | null;
  registration: string | null;
  sale_blocked: number | null;
  sale_status_id: number | null;
  stage: string | null;
  status: string | null;
};

// Unidades de um empreendimento (ou do produto consolidado: aceita N códigos).
export async function loadApoloEnterpriseUnits(
  codes: string[],
): Promise<
  { ok: true; units: ApoloEnterpriseUnit[] } | { error: string; ok: false }
> {
  const validCodes = codes
    .map((code) => code.trim().toUpperCase())
    .filter((code) => code && !EXCLUDED_ENTERPRISE_CODES.includes(code));

  if (!validCodes.length) {
    return { ok: true, units: [] };
  }

  const poolResult = getHadesDbPool();

  if (!poolResult.ok) {
    return {
      error: `Configuracao C2X ausente: ${poolResult.missing.join(", ")}.`,
      ok: false,
    };
  }

  const placeholders = validCodes.map(() => "?").join(", ");
  const nameSql = (alias: string) =>
    `coalesce(nullif(trim(${alias}.name), ''), nullif(trim(${alias}.fantasy_name), ''), nullif(trim(${alias}.social_name), ''))`;

  // A "última movimentação" = a proposta/venda MAIS RECENTE daquela unidade. Dela saem o
  // comprador (ar.client_id) e a imobiliária (users.vinculed_by_id do comprador).
  const [rows] = await poolResult.pool.query<UnitQueryRow[]>(
    `select u.id, u.block, u.lot, u.area, u.price,
            u.registration, u.sale_status_id, u.sale_blocked,
            ut.name as kind,
            ss.name as status,
            e.code as enterprise_code,
            st.name as stage,
            cli.id as client_id, cli.user_code as client_code,
            ${nameSql("cli")} as client_name,
            imo.id as imobiliaria_id, imo.user_code as imobiliaria_code,
            ${nameSql("imo")} as imobiliaria_name
       from enterprise_unities u
       join enterprises e on e.id = u.enterprise_id
       left join enterprise_unity_types ut on ut.id = u.enterprise_unity_type_id
       left join sale_statuses ss on ss.id = u.sale_status_id
       left join acquisition_requests ar on ar.id = (
              select ar2.id from acquisition_requests ar2
               where ar2.enterprise_unity_id = u.id
               order by ar2.created_at desc, ar2.id desc
               limit 1)
       left join acquisition_request_stages st on st.id = ar.acquisition_request_stage_id
       left join users cli on cli.id = ar.client_id
       left join users imo on imo.id = cli.vinculed_by_id
      where e.code in (${placeholders})
      order by e.code, u.block, u.lot`,
    validCodes,
  );

  return { ok: true, units: rows.map(mapUnitRow) };
}

// Código da unidade: sigla(3) + quadra + lote (ex.: LOU + 01 + 01 = LOU0101). Mesmo padrão do
// Hades, pra a unidade ter o MESMO código nos dois módulos.
function buildUnitCode(
  enterpriseCode: string,
  block: string | null,
  lot: string | null,
): string {
  const prefix = enterpriseCode
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase()
    .slice(0, 3)
    .padEnd(3, "X");
  const blockCode = (block ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();
  const lotCode = (lot ?? "")
    .replace(/[^a-z0-9]/gi, "")
    .replace(/^L/i, "")
    .toUpperCase();

  return `${prefix}${blockCode}${lotCode}`;
}

function mapUnitRow(row: UnitQueryRow): ApoloEnterpriseUnit {
  const blocked = Number(row.sale_blocked ?? 0) === 1;
  const statusId = Number(row.sale_status_id ?? 0);
  const bucket: ApoloEnterpriseBucket =
    statusId === SALE_STATUS.VENDIDO
      ? "vendido"
      : statusId === SALE_STATUS.EM_NEGOCIACAO
        ? "negociacao"
        : statusId === SALE_STATUS.RESERVADO
          ? "reservado"
          : blocked
            ? "bloqueado"
            : "disponivel";

  const party = (
    id: number | null,
    code: string | null,
    name: string | null,
  ): ApoloUnitParty | null => {
    const cleaned = cleanText(name);

    return id && cleaned
      ? {
          code: cleanText(code),
          entityId: deterministicUuid(`apolo:c2x:users:${id}`),
          name: cleaned,
        }
      : null;
  };

  const client = party(row.client_id, row.client_code, row.client_name);
  const imobiliaria = party(
    row.imobiliaria_id,
    row.imobiliaria_code,
    row.imobiliaria_name,
  );
  const enterpriseCode = cleanText(row.enterprise_code) ?? "";

  return {
    area: row.area === null ? null : toNumber(row.area),
    block: cleanText(row.block),
    bucket,
    code: buildUnitCode(enterpriseCode, row.block, row.lot),
    enterpriseCode,
    id: String(row.id),
    kind: cleanText(row.kind),
    lot: cleanText(row.lot),
    movement:
      client || imobiliaria
        ? { client, imobiliaria, stage: cleanText(row.stage) }
        : null,
    price: toNumber(row.price),
    registration: cleanText(row.registration),
    // O status 5 nunca é usado no C2X; bloqueado vem do flag.
    status: blocked ? "Bloqueado" : (cleanText(row.status) ?? "Sem status"),
  };
}

// Consolida as etapas do mesmo produto numa linha só (regra ENTERPRISE_GROUPS); as etapas
// viram `stages` (sub-linhas expansíveis). O que não está em grupo vira linha simples.
function groupEnterpriseRows(rows: ApoloEnterpriseRow[]): ApoloEnterpriseRow[] {
  const byCode = new Map(rows.map((row) => [row.code.toUpperCase(), row]));
  const grouped: ApoloEnterpriseRow[] = [];
  const consumed = new Set<string>();

  for (const group of ENTERPRISE_GROUPS) {
    const stages = group.codes
      .map((code) => byCode.get(code.toUpperCase()))
      .filter((row): row is ApoloEnterpriseRow => Boolean(row));

    if (!stages.length) {
      continue;
    }

    for (const stage of stages) {
      consumed.add(stage.code.toUpperCase());
    }

    const first = stages[0];

    grouped.push({
      city: first?.city ?? null,
      code: stages.map((stage) => stage.code).join(" + "),
      codes: stages.map((stage) => stage.code),
      id: `group:${group.display}`,
      incorporador:
        stages.find((stage) => stage.incorporador)?.incorporador ?? null,
      name: group.display,
      scenario: sumScenarios(stages),
      state: first?.state ?? null,
      stages,
    });
  }

  for (const row of rows) {
    if (!consumed.has(row.code.toUpperCase())) {
      grouped.push(row);
    }
  }

  return grouped.sort(
    (left, right) => right.scenario.total.units - left.scenario.total.units,
  );
}

function sumScenarios(rows: ApoloEnterpriseRow[]): ApoloEnterpriseScenario {
  const buckets: Array<ApoloEnterpriseBucket | "total"> = [
    "total",
    "disponivel",
    "reservado",
    "negociacao",
    "vendido",
    "bloqueado",
  ];

  return buckets.reduce((accumulator, bucket) => {
    accumulator[bucket] = rows.reduce(
      (tally, row) => ({
        units: tally.units + row.scenario[bucket].units,
        value: tally.value + row.scenario[bucket].value,
      }),
      { units: 0, value: 0 },
    );

    return accumulator;
  }, {} as ApoloEnterpriseScenario);
}

function mapEnterpriseRow(row: EnterpriseQueryRow): ApoloEnterpriseRow {
  const tally = (
    units: number | string | null,
    value: number | string | null,
  ): ApoloEnterpriseTally => ({
    units: toNumber(units),
    value: toNumber(value),
  });
  const code = cleanText(row.code) ?? String(row.id);

  return {
    city: cleanText(row.city),
    code,
    codes: [code],
    id: String(row.id),
    incorporador: cleanText(row.incorporador),
    name: cleanText(row.name) ?? "Empreendimento",
    scenario: {
      bloqueado: tally(row.bloqueado_units, row.bloqueado_value),
      disponivel: tally(row.disponivel_units, row.disponivel_value),
      negociacao: tally(row.negociacao_units, row.negociacao_value),
      reservado: tally(row.reservado_units, row.reservado_value),
      total: tally(row.total_units, row.total_value),
      vendido: tally(row.vendido_units, row.vendido_value),
    },
    state: cleanText(row.state),
    stages: [],
  };
}

function toNumber(value: number | string | null): number {
  const parsed = Number(value ?? 0);

  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanText(value: string | null): string | null {
  const trimmed = value?.trim();

  return trimmed ? trimmed : null;
}
