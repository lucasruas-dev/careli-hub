// Cenário de VENDAS de um empreendimento (Apolo): o funil por estágio + a lista
// por unidade. Fonte = C2X (enterprise_unities + acquisition_requests) para QUAIS
// unidades e QUAIS vendas (comprador, imobiliária, proposta); a SITUAÇÃO de cada
// unidade (em que coluna do funil ela está, e se está bloqueada) é a do Panteon,
// pela régua única (18/09/2026). Cancelado/Distrato são eventos de proposta, num
// cluster à parte. Ver [[project-apolo-crm-grafo]].
import type { RowDataPacket } from "mysql2";

import {
  loadApoloUnitInstallments,
  type ApoloUnitInstallment,
} from "@/lib/apolo/carteira";
import {
  lerSituacaoNoPanteon,
  ROTULO_SEM_CADASTRO_NO_PANTEON,
  unidadeDaLinhaDoC2x,
} from "@/lib/apolo/empreendimentos";
import { EXCLUDED_ENTERPRISE_CODES } from "@/lib/guardian/c2x-analytics";
import { getHadesDbPool } from "@/lib/guardian/db";
import { deterministicUuid } from "@/lib/apolo/server";
import {
  baldeDaSituacao,
  rotuloDaSituacao,
  type SituacaoDasUnidades,
  type SituacaoDaUnidade,
} from "@/lib/hercules/situacao-da-unidade";

// Os 6 estados do fluxo (nível unidade, cada uma em um só).
export type ApoloVendaStage =
  | "assinatura"
  | "contrato"
  | "disponivel"
  | "faturado"
  | "proposta"
  | "reservado";

// Terminais (nível proposta): a venda que caiu.
export type ApoloVendaTerminal = "cancelado" | "distrato";

// Ordem canônica do funil (o id do estágio no C2X NÃO reflete a ordem).
export const APOLO_VENDA_STAGE_ORDER: ApoloVendaStage[] = [
  "disponivel",
  "reservado",
  "proposta",
  "contrato",
  "assinatura",
  "faturado",
];

// ⚠️ O TEXTO DE CADA COLUNA É O DA RÉGUA (`rotuloDaSituacao`), o mesmo da aba Unidades e da Venda
// do Hércules (Lucas, 18/09/2026: *"esses status tem que morar em um so lugar"*). Até aqui esta
// tabela escrevia "Proposta emitida", "Contrato gerado" e "Em assinatura": o mesmo lote com dois
// nomes, conforme a tela. Cada estágio do funil é uma situação da régua, então nada se traduz.
export const APOLO_VENDA_STAGE_LABELS: Record<ApoloVendaStage, string> = {
  assinatura: rotuloDaSituacao("assinatura"),
  contrato: rotuloDaSituacao("contrato"),
  disponivel: rotuloDaSituacao("disponivel"),
  faturado: rotuloDaSituacao("faturado"),
  proposta: rotuloDaSituacao("proposta"),
  reservado: rotuloDaSituacao("reservado"),
};

export const APOLO_VENDA_TERMINAL_LABELS: Record<ApoloVendaTerminal, string> = {
  cancelado: "Cancelado",
  distrato: "Distrato",
};

// Dobra dos 11 estágios do C2X nos 6+2 do fluxo (decisão do Lucas: Análise→Proposta,
// Finalizado→Faturado, Reprovado→Cancelado).
//
// Exportado de propósito: quem precisa de "quais ids do C2X são contrato/assinatura/faturado"
// (ex.: os contratos do portal do incorporador) DERIVA daqui, em vez de repetir os números — se a
// dobra mudar, muda num lugar só.
export const STAGE_MAP: Record<number, ApoloVendaStage | ApoloVendaTerminal> = {
  1: "reservado",
  2: "proposta", // Análise de crédito
  3: "contrato",
  4: "faturado",
  5: "assinatura",
  6: "faturado", // Finalizado
  7: "cancelado",
  8: "cancelado", // Reprovado análise
  9: "proposta", // Proposta realizada
  10: "distrato", // Em distrato
  11: "distrato", // Distratado
};

const ACTIVE_STAGES = new Set<ApoloVendaStage>([
  "reservado",
  "proposta",
  "contrato",
  "assinatura",
  "faturado",
]);

// Nomes reais dos 11 estágios do C2X, para o feed de movimentação (mostra a
// transição fiel, sem a dobra do funil).
const STAGE_C2X_LABELS: Record<number, string> = {
  1: "Reservado",
  2: "Análise de crédito",
  3: "Contrato gerado",
  4: "Faturado",
  5: "Em assinatura",
  6: "Finalizado",
  7: "Cancelado",
  8: "Reprovado análise",
  9: "Proposta realizada",
  10: "Em distrato",
  11: "Distratado",
};

export type ApoloVendaParty = {
  code: string | null;
  entityId: string;
  name: string;
};

export type ApoloVendaStageBucket = {
  stage: ApoloVendaStage;
  units: number;
  vgv: number;
};

export type ApoloVendaTerminalBucket = {
  proposals: number;
  terminal: ApoloVendaTerminal;
  vgv: number;
};

export type ApoloVendaUnit = {
  arId: number | null;
  block: string | null;
  /**
   * Unidade fora da oferta, pela régua única do Panteon: `bloqueada` (e a unidade que o Panteon não
   * conhece, que sai ocupada). Vem por unidade porque o resumo separa as bloqueadas do estoque
   * disponível, e uma LISTA que não soubesse disso mostraria as mesmas unidades como "Disponível"
   * logo abaixo de um card dizendo que elas estão bloqueadas. Anda sempre com `stage` "disponivel":
   * o funil não tem coluna de bloqueio.
   *
   * ⚠️ NÃO É MAIS `enterprise_unities.sale_blocked` (18/09/2026): o bloqueio feito no Panteon (pela
   * Venda do Hércules ou pela aba Unidades do Apolo) não chega ao C2X, e a lista o ignorava.
   */
  blocked: boolean;
  client: ApoloVendaParty | null;
  code: string;
  id: string;
  imobiliaria: ApoloVendaParty | null;
  lot: string | null;
  /** O Panteon não conhece esta unidade: ela sai `blocked` (ocupada), nunca disponível. */
  semCadastroNoPanteon?: boolean;
  /**
   * O texto da situação, como a aba Unidades e a Venda do Hércules escrevem ("Contrato",
   * "Bloqueado", "Sem cadastro no Panteon"). Opcional no tipo porque há quem monte a unidade à mão.
   */
  situacao?: string;
  /**
   * A coluna do funil, pela régua única do Panteon (e não mais pelo estágio da última proposta do
   * C2X). Ver `estagioPelaSituacao`.
   */
  stage: ApoloVendaStage;
  /** Desde quando no estágio: só quando o estágio do Panteon é o mesmo da proposta do C2X. */
  stageSince: string | null;
  /**
   * A proposta mais recente do C2X está VIVA (reservado a faturado)? É ela que dá o comprador e a
   * imobiliária da linha. Falso com `stage` ocupado = o processo é do Hércules, e a proposta que o
   * C2X mostra no detalhe é história.
   */
  vendaNoC2x?: boolean;
  vgv: number;
};

// Uma proposta terminada (cancelada/distratada) — para o "apontar" das perdas.
export type ApoloVendaTerminalItem = {
  at: string | null;
  client: string | null;
  code: string;
  id: string;
  imobiliaria: string | null;
  reason: string | null;
  terminal: ApoloVendaTerminal;
  vgv: number;
};

// Uma transição de estágio (feed de movimentação).
export type ApoloVendaMovement = {
  at: string;
  client: string | null;
  code: string;
  fromStage: string | null;
  imobiliaria: string | null;
  toStage: string | null;
  vgv: number;
};

export type ApoloEnterpriseVendas = {
  /** As fora da oferta (fora do funil), incluindo as sem cadastro no Panteon. */
  bloqueadas: { units: number; vgv: number };
  /**
   * Das `bloqueadas`, as que o Panteon não conhece (o sync ainda não trouxe). Ficam dentro de
   * `bloqueadas` para o funil mais as bloqueadas continuarem somando o total; o número à parte é
   * para a tela não chamar de bloqueio o que é buraco de cadastro.
   */
  semCadastroNoPanteon?: { units: number; vgv: number };
  funnel: ApoloVendaStageBucket[];
  movements: ApoloVendaMovement[];
  terminalItems: ApoloVendaTerminalItem[];
  terminals: ApoloVendaTerminalBucket[];
  totalUnits: number;
  units: ApoloVendaUnit[];
};

// Detalhe da proposta de uma unidade (o modal "trazer tudo").
export type ApoloVendaPropostaPlan = {
  atoAt: string | null;
  billingAt: string | null;
  client: ApoloVendaParty | null;
  code: string | null;
  corretor: string | null;
  correctionRate: number | null;
  entrada: number | null;
  firstSignalAt: string | null;
  imobiliaria: ApoloVendaParty | null;
  interestRate: number | null;
  isCustom: boolean;
  observacao: string | null;
  parcels: number | null;
  planName: string | null;
  signAt: string | null;
  signalParcels: number | null;
  stageLabel: string | null;
  vgv: number;
};

export type ApoloVendaPropostaMovement = {
  at: string;
  fromStage: string | null;
  toStage: string | null;
};

export type ApoloVendaProposta = {
  movimentacao: ApoloVendaPropostaMovement[];
  parcelamento: ApoloUnitInstallment[];
  plan: ApoloVendaPropostaPlan;
};

type UnitRow = RowDataPacket & Record<string, number | string | null>;
type TerminalRow = RowDataPacket & Record<string, number | string | null>;

export async function loadApoloEnterpriseVendas(
  codes: string[],
): Promise<
  { data: ApoloEnterpriseVendas; ok: true } | { error: string; ok: false }
> {
  const validCodes = codes
    .map((code) => code.trim().toUpperCase())
    .filter((code) => code && !EXCLUDED_ENTERPRISE_CODES.includes(code));

  if (!validCodes.length) {
    return { data: emptyVendas(), ok: true };
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

  // Uma linha por unidade, com a proposta MAIS RECENTE (mesmo padrão da aba Unidades)
  // + a data em que ela entrou no estágio atual (histórico).
  //
  // ⚠️ `sale_blocked` SAIU DO SELECT de propósito (18/09/2026): quem diz se a unidade está
  // bloqueada é o Panteon, e coluna de status do legado à mão aqui é convite a alguém voltar a
  // decidir por ela. `u.name` e `e.id` entraram: são as chaves para achar a unidade no Panteon.
  const [rows] = await poolResult.pool.query<UnitRow[]>(
    `select u.id, u.name as unit_name, u.block, u.lot, u.price,
            e.id as enterprise_id, e.code as enterprise_code,
            ar.id as ar_id,
            ar.acquisition_request_stage_id as stage_id,
            (select max(h.created_at) from acquisition_request_historics h
               where h.acquisition_request_id = ar.id
                 and h.new_acquisition_request_stage_id = ar.acquisition_request_stage_id) as stage_since,
            cli.id as client_id, cli.user_code as client_code, ${nameSql("cli")} as client_name,
            imo.id as imobiliaria_id, imo.user_code as imobiliaria_code, ${nameSql("imo")} as imobiliaria_name
       from enterprise_unities u
       join enterprises e on e.id = u.enterprise_id
       left join acquisition_requests ar on ar.id = (
              select ar2.id from acquisition_requests ar2
               where ar2.enterprise_unity_id = u.id
               order by ar2.created_at desc, ar2.id desc
               limit 1)
       left join users cli on cli.id = ar.client_id
       left join users imo on imo.id = cli.vinculed_by_id
      where e.code in (${placeholders})
      order by e.code, u.block, u.lot`,
    validCodes,
  );

  // `enterprise_id` do C2X de cada linha: é a chave que `hercules_unidades` guarda. A situação
  // (Panteon) e as três leituras restantes do C2X correm juntas; nenhuma depende da outra.
  const enterpriseIds = [
    ...new Set(rows.map((row) => String(row.enterprise_id ?? "").trim()).filter(Boolean)),
  ];
  const [situacao, [terminalRows], [movementRows], [terminalItemRows]] = await Promise.all([
    enterpriseIds.length > 0
      ? lerSituacaoNoPanteon(enterpriseIds)
      : Promise.resolve({ ok: true as const, situacoes: null }),
    // Terminais = TODAS as propostas canceladas/distratadas (inclui histórico de
    // unidades depois revendidas), por proposta.
    poolResult.pool.query<TerminalRow[]>(
      `select ar.acquisition_request_stage_id as stage_id, count(*) as n,
              coalesce(sum(u.price), 0) as vgv
         from acquisition_requests ar
         join enterprise_unities u on u.id = ar.enterprise_unity_id
         join enterprises e on e.id = u.enterprise_id
        where e.code in (${placeholders})
          and ar.acquisition_request_stage_id in (7, 8, 10, 11)
        group by ar.acquisition_request_stage_id`,
      validCodes,
    ),
    // Movimentação: as transições de estágio mais recentes (feed do "o que mudou").
    poolResult.pool.query<UnitRow[]>(
      `select h.created_at as at,
              h.old_acquisition_request_stage_id as from_stage,
              h.new_acquisition_request_stage_id as to_stage,
              e.code as enterprise_code, u.block, u.lot, u.price,
              cli.id as client_id, ${nameSql("cli")} as client_name,
              imo.id as imobiliaria_id, ${nameSql("imo")} as imobiliaria_name
         from acquisition_request_historics h
         join acquisition_requests ar on ar.id = h.acquisition_request_id
         join enterprise_unities u on u.id = ar.enterprise_unity_id
         join enterprises e on e.id = u.enterprise_id
         left join users cli on cli.id = ar.client_id
         left join users imo on imo.id = cli.vinculed_by_id
        where e.code in (${placeholders})
          and h.new_acquisition_request_stage_id is not null
        order by h.created_at desc
        limit 40`,
      validCodes,
    ),
    // Detalhe das propostas canceladas/distratadas (para o "apontar" das perdas).
    poolResult.pool.query<UnitRow[]>(
      `select ar.id as ar_id, ar.acquisition_request_stage_id as stage_id,
              ar.rejection_reason, ar.observation, e.code as enterprise_code,
              u.block, u.lot, u.price,
              (select max(h.created_at) from acquisition_request_historics h
                 where h.acquisition_request_id = ar.id
                   and h.new_acquisition_request_stage_id = ar.acquisition_request_stage_id) as terminal_at,
              cli.id as client_id, ${nameSql("cli")} as client_name,
              imo.id as imobiliaria_id, ${nameSql("imo")} as imobiliaria_name
         from acquisition_requests ar
         join enterprise_unities u on u.id = ar.enterprise_unity_id
         join enterprises e on e.id = u.enterprise_id
         left join users cli on cli.id = ar.client_id
         left join users imo on imo.id = cli.vinculed_by_id
        where e.code in (${placeholders})
          and ar.acquisition_request_stage_id in (7, 8, 10, 11)
        order by terminal_at desc
        limit 300`,
      validCodes,
    ),
  ]);

  // ⚠️ SEM A SITUAÇÃO DO PANTEON, SEM LISTA. Cair no estágio do C2X seria voltar a pintar de livre
  // o que o Panteon travou (o bloqueio, a reserva e a proposta do Hércules não chegam ao legado).
  if (!situacao.ok) {
    return { error: situacao.error, ok: false };
  }

  const units = rows.map((row) => mapVendaUnit(row, situacao.situacoes));
  const movements = movementRows.map(mapVendaMovement);
  const terminalItems = terminalItemRows
    .map(mapTerminalItem)
    .filter((item): item is ApoloVendaTerminalItem => item !== null);

  // Funil por unidade, pela situação do Panteon que `mapVendaUnit` já escreveu.
  const funnelMap = new Map<ApoloVendaStage, ApoloVendaStageBucket>(
    APOLO_VENDA_STAGE_ORDER.map((stage) => [
      stage,
      { stage, units: 0, vgv: 0 },
    ]),
  );
  let blockedUnits = 0;
  let blockedVgv = 0;
  let semCadastroUnits = 0;
  let semCadastroVgv = 0;

  for (const unit of units) {
    // Bloqueada (e sem cadastro no Panteon) conta à parte, fora do funil: o funil não tem coluna
    // de bloqueio, e somá-la em "Disponível" oferecia o que não está à venda.
    if (unit.stage === "disponivel" && unit.blocked) {
      blockedUnits += 1;
      blockedVgv += unit.vgv;
      if (unit.semCadastroNoPanteon) {
        semCadastroUnits += 1;
        semCadastroVgv += unit.vgv;
      }
      continue;
    }

    const bucket = funnelMap.get(unit.stage);
    if (bucket) {
      bucket.units += 1;
      bucket.vgv += unit.vgv;
    }
  }

  // Terminais dobrados (7,8 → cancelado; 10,11 → distrato).
  const terminalMap = new Map<ApoloVendaTerminal, ApoloVendaTerminalBucket>([
    ["cancelado", { proposals: 0, terminal: "cancelado", vgv: 0 }],
    ["distrato", { proposals: 0, terminal: "distrato", vgv: 0 }],
  ]);
  for (const row of terminalRows) {
    const mapped = STAGE_MAP[toNumber(row.stage_id)];
    if (mapped !== "cancelado" && mapped !== "distrato") {
      continue;
    }
    const bucket = terminalMap.get(mapped);
    if (bucket) {
      bucket.proposals += toNumber(row.n);
      bucket.vgv += toNumber(row.vgv);
    }
  }

  return {
    data: {
      bloqueadas: { units: blockedUnits, vgv: round2(blockedVgv) },
      funnel: APOLO_VENDA_STAGE_ORDER.map((stage) => {
        const bucket = funnelMap.get(stage)!;
        return { ...bucket, vgv: round2(bucket.vgv) };
      }),
      movements,
      semCadastroNoPanteon: { units: semCadastroUnits, vgv: round2(semCadastroVgv) },
      terminalItems,
      terminals: [
        terminalMap.get("cancelado")!,
        terminalMap.get("distrato")!,
      ].map((bucket) => ({ ...bucket, vgv: round2(bucket.vgv) })),
      totalUnits: rows.length,
      units,
    },
    ok: true,
  };
}

// Detalhe da proposta mais recente da unidade: plano comercial + parcelamento
// (reaproveita a carteira) + a movimentação (histórico) daquela unidade.
export async function loadApoloVendaProposta(
  unitId: string,
): Promise<
  | { data: ApoloVendaProposta | null; ok: true }
  | { error: string; ok: false }
> {
  const id = Number(unitId);

  if (!Number.isInteger(id) || id <= 0) {
    return { error: "Unidade invalida.", ok: false };
  }

  const poolResult = getHadesDbPool();

  if (!poolResult.ok) {
    return {
      error: `Configuracao C2X ausente: ${poolResult.missing.join(", ")}.`,
      ok: false,
    };
  }

  const nameSql = (alias: string) =>
    `coalesce(nullif(trim(${alias}.name), ''), nullif(trim(${alias}.fantasy_name), ''), nullif(trim(${alias}.social_name), ''))`;

  const [rows] = await poolResult.pool.query<UnitRow[]>(
    `select ar.id as ar_id, ar.code, ar.quantity_signal_parcels, ar.first_signal_payment,
            ar.act_date, ar.sign_date, ar.billing_date, ar.observation,
            ar.acquisition_request_stage_id as stage_id, u.price,
            coalesce(nullif(trim(cps.name), ''), nullif(trim(cpc.name), '')) as plan_name,
            coalesce(cps.initial_input_value, cpc.initial_input_value) as entrada,
            coalesce(cps.parcels, cpc.parcels) as parcels,
            coalesce(cps.financing_interest_rate, cpc.financing_interest_rate) as interest_rate,
            coalesce(cps.correction_rate, cpc.correction_rate) as correction_rate,
            ar.custom_commercial_plan as is_custom,
            cli.id as client_id, cli.user_code as client_code, ${nameSql("cli")} as client_name,
            imo.id as imobiliaria_id, imo.user_code as imobiliaria_code, ${nameSql("imo")} as imobiliaria_name,
            ${nameSql("cor")} as corretor_name
       from acquisition_requests ar
       join enterprise_unities u on u.id = ar.enterprise_unity_id
       left join commercial_plans cps on cps.id = ar.commercial_plan_id
       left join commercial_plans cpc on cpc.id = (
              select cp2.id from commercial_plans cp2
               where cp2.acquisition_request_id = ar.id
               order by cp2.id desc
               limit 1)
       left join users cli on cli.id = ar.client_id
       left join users imo on imo.id = cli.vinculed_by_id
       left join users cor on cor.id = ar.corretor_id
      where ar.enterprise_unity_id = ?
      order by ar.created_at desc, ar.id desc
      limit 1`,
    [id],
  );

  const row = rows[0];

  if (!row) {
    return { data: null, ok: true };
  }

  const arId = toNumber(row.ar_id);

  const [movementRows] = await poolResult.pool.query<UnitRow[]>(
    `select h.created_at as at,
            h.old_acquisition_request_stage_id as from_stage,
            h.new_acquisition_request_stage_id as to_stage
       from acquisition_request_historics h
      where h.acquisition_request_id = ?
        and h.new_acquisition_request_stage_id is not null
      order by h.created_at desc`,
    [arId],
  );

  const installments = await loadApoloUnitInstallments(unitId);

  const party = (
    partyId: number | string | null,
    code: number | string | null,
    name: number | string | null,
  ): ApoloVendaParty | null => {
    const cleaned = typeof name === "string" ? name.trim() : "";

    return partyId && cleaned
      ? {
          code: typeof code === "string" ? code.trim() || null : null,
          entityId: deterministicUuid(`apolo:c2x:users:${partyId}`),
          name: cleaned,
        }
      : null;
  };

  const stageId = toNumber(row.stage_id);

  return {
    data: {
      movimentacao: movementRows.map((movement) => ({
        at: dateOrNull(movement.at) ?? "",
        fromStage:
          toNumber(movement.from_stage) > 0
            ? STAGE_C2X_LABELS[toNumber(movement.from_stage)] ?? null
            : null,
        toStage:
          toNumber(movement.to_stage) > 0
            ? STAGE_C2X_LABELS[toNumber(movement.to_stage)] ?? null
            : null,
      })),
      parcelamento: installments.ok ? installments.installments : [],
      plan: {
        atoAt: dateOrNull(row.act_date),
        billingAt: dateOrNull(row.billing_date),
        client: party(row.client_id, row.client_code, row.client_name),
        code: text(row.code),
        corretor: text(row.corretor_name),
        correctionRate: nullableNumber(row.correction_rate),
        entrada: nullableNumber(row.entrada),
        firstSignalAt: dateOrNull(row.first_signal_payment),
        imobiliaria: party(row.imobiliaria_id, row.imobiliaria_code, row.imobiliaria_name),
        interestRate: nullableNumber(row.interest_rate),
        isCustom: toNumber(row.is_custom) === 1,
        observacao: text(row.observation),
        parcels: nullableNumber(row.parcels),
        planName: text(row.plan_name),
        signAt: dateOrNull(row.sign_date),
        signalParcels: nullableNumber(row.quantity_signal_parcels),
        stageLabel: stageId > 0 ? STAGE_C2X_LABELS[stageId] ?? null : null,
        vgv: toNumber(row.price),
      },
    },
    ok: true,
  };
}

// O estágio da proposta mais recente DO C2X: se ela está num estágio ATIVO, esse; senão
// (terminal, ou sem proposta) "disponivel".
//
// ⚠️ NÃO É MAIS A SITUAÇÃO DA UNIDADE (18/09/2026). Serve para uma pergunta só: a venda do C2X
// desta linha está viva? É ela que dá o comprador e a imobiliária da linha, e é assim que a lista
// continua sendo a lista de VENDAS de sempre ("quais vendas" não mudou). Em que coluna do funil a
// unidade está, e se está bloqueada, quem diz é a régua (`estagioPelaSituacao`).
function estagioDoC2x(row: UnitRow): ApoloVendaStage {
  const stageId = toNumber(row.stage_id);
  const mapped = stageId > 0 ? STAGE_MAP[stageId] : undefined;

  if (mapped && ACTIVE_STAGES.has(mapped as ApoloVendaStage)) {
    return mapped as ApoloVendaStage;
  }

  return "disponivel";
}

/**
 * A situação da régua única escrita no vocabulário do funil: a coluna (`stage`) e o `blocked`.
 *
 * ⚠️ QUEM DECIDE É O BALDE (`baldeDaSituacao`), e o estágio só refina dentro dele, do mesmo jeito
 * que o funil do Resumo e a TelaVendas do Hércules contam:
 *   • `bloqueado` sai "disponivel" com `blocked`, porque o funil não tem coluna de bloqueio (e
 *     quem soma separa: `bloqueadas`);
 *   • `reservado` junta a reserva do processo e a "reservada" do cadastro;
 *   • negociação refina em proposta, contrato ou assinatura;
 *   • `vendido` é "faturado": a "vendida" sem proposta viva é venda que acabou.
 * `null` (a unidade que o Panteon não conhece) sai ocupada: "disponivel" com `blocked`, NUNCA
 * livre. Exportada (e pura) para o teste.
 */
export function estagioPelaSituacao(
  situacao: null | SituacaoDaUnidade,
): { blocked: boolean; stage: ApoloVendaStage } {
  if (situacao === null) return { blocked: true, stage: "disponivel" };
  switch (baldeDaSituacao(situacao)) {
    case "disponivel":
      return { blocked: false, stage: "disponivel" };
    case "bloqueado":
      return { blocked: true, stage: "disponivel" };
    case "reservado":
      return { blocked: false, stage: "reservado" };
    case "negociacao":
      return {
        blocked: false,
        stage: situacao === "contrato" || situacao === "assinatura" ? situacao : "proposta",
      };
    case "vendido":
      return { blocked: false, stage: "faturado" };
  }
}

function mapVendaUnit(row: UnitRow, situacoes: null | SituacaoDasUnidades): ApoloVendaUnit {
  const enterpriseCode = String(row.enterprise_code ?? "");
  const code = buildUnitCode(enterpriseCode, text(row.block), text(row.lot));
  const party = (
    id: number | string | null,
    code: number | string | null,
    name: number | string | null,
  ): ApoloVendaParty | null => {
    const cleaned = typeof name === "string" ? name.trim() : "";

    return id && cleaned
      ? {
          code: typeof code === "string" ? code.trim() || null : null,
          entityId: deterministicUuid(`apolo:c2x:users:${id}`),
          name: cleaned,
        }
      : null;
  };

  // A unidade do Panteon que responde por esta linha, pela MESMA ordem da aba Unidades e dos cards
  // (`unidadeDaLinhaDoC2x`, que usa `acharUnidade`).
  const unidade = situacoes
    ? unidadeDaLinhaDoC2x(
        { codigo: code, id: String(row.id ?? ""), nomeNoC2x: text(row.unit_name) },
        situacoes,
      )
    : undefined;
  const { blocked, stage } = estagioPelaSituacao(unidade?.situacao ?? null);
  const doC2x = estagioDoC2x(row);

  // ⚠️ O COMPRADOR E A IMOBILIÁRIA SÓ SAEM COM A VENDA DO C2X VIVA, como sempre. Uma unidade
  // reservada no Hércules sem proposta viva no C2X aparece na coluna "Reservado" SEM nome: a última
  // proposta do legado é história, e mostrar o comprador dela ao lado da reserva de agora faria
  // alguém atender o cliente errado. Sem nome é melhor que nome errado.
  const vendaNoC2x = doC2x !== "disponivel";

  return {
    arId: row.ar_id ? toNumber(row.ar_id) : null,
    block: text(row.block),
    blocked,
    client: vendaNoC2x ? party(row.client_id, row.client_code, row.client_name) : null,
    code,
    id: String(row.id),
    imobiliaria: vendaNoC2x
      ? party(row.imobiliaria_id, row.imobiliaria_code, row.imobiliaria_name)
      : null,
    lot: text(row.lot),
    semCadastroNoPanteon: !unidade,
    situacao: unidade ? rotuloDaSituacao(unidade.situacao) : ROTULO_SEM_CADASTRO_NO_PANTEON,
    stage,
    // A data do C2X só vale quando o estágio é o mesmo: "há 12 dias em contrato" contado da data em
    // que o C2X entrou em proposta seria um número inventado.
    stageSince: stage === doC2x ? dateOrNull(row.stage_since) : null,
    vendaNoC2x,
    vgv: toNumber(row.price),
  };
}

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

function mapVendaMovement(row: UnitRow): ApoloVendaMovement {
  const enterpriseCode = String(row.enterprise_code ?? "");
  const fromId = toNumber(row.from_stage);
  const toId = toNumber(row.to_stage);

  return {
    at: dateOrNull(row.at) ?? "",
    client: text(row.client_name),
    code: buildUnitCode(enterpriseCode, text(row.block), text(row.lot)),
    fromStage: fromId > 0 ? STAGE_C2X_LABELS[fromId] ?? null : null,
    imobiliaria: text(row.imobiliaria_name),
    toStage: toId > 0 ? STAGE_C2X_LABELS[toId] ?? null : null,
    vgv: toNumber(row.price),
  };
}

function mapTerminalItem(row: UnitRow): ApoloVendaTerminalItem | null {
  const mapped = STAGE_MAP[toNumber(row.stage_id)];
  if (mapped !== "cancelado" && mapped !== "distrato") {
    return null;
  }

  const enterpriseCode = String(row.enterprise_code ?? "");

  return {
    at: dateOrNull(row.terminal_at),
    client: text(row.client_name),
    code: buildUnitCode(enterpriseCode, text(row.block), text(row.lot)),
    id: String(row.ar_id),
    imobiliaria: text(row.imobiliaria_name),
    reason: text(row.rejection_reason) ?? text(row.observation),
    terminal: mapped,
    vgv: toNumber(row.price),
  };
}

function emptyVendas(): ApoloEnterpriseVendas {
  return {
    bloqueadas: { units: 0, vgv: 0 },
    funnel: APOLO_VENDA_STAGE_ORDER.map((stage) => ({ stage, units: 0, vgv: 0 })),
    movements: [],
    terminalItems: [],
    terminals: [
      { proposals: 0, terminal: "cancelado", vgv: 0 },
      { proposals: 0, terminal: "distrato", vgv: 0 },
    ],
    totalUnits: 0,
    units: [],
  };
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function dateOrNull(value: unknown): string | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toNumber(value: number | string | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);

  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
