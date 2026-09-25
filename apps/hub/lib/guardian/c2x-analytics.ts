import type { RowDataPacket } from "mysql2/promise";

import { getHadesDbPool, sanitizeHadesDbError } from "./db";

// Analytics READ-ONLY do C2X para o modo ASSISTENTE da CACÁ (os proprietários). Nunca escreve.
// Regras e vocabulário validados contra o C2X. Ver [[reference-c2x-vendas-model]] e
// [[project-caca-admin-assistant-mode]].

// Estágios da aquisição (acquisition_request_stages). Exportado pro motor de análise
// (lib/analytics) usar a MESMA fonte de verdade.
export const STAGE = {
  RESERVADO: 1,
  ANALISE: 2,
  CONTRATO_GERADO: 3,
  FATURADO: 4,
  EM_ASSINATURA: 5,
  FINALIZADO: 6,
  CANCELADO: 7,
  REPROVADO: 8,
  PROPOSTA: 9,
  EM_DISTRATO: 10,
  DISTRATADO: 11,
} as const;

// Empreendimentos que NÃO entram nas análises da CACÁ (teste + masterplan/aditivo da Lagoa
// Bonita) — decisão do Lucas. Por código (sigla).
//
// ⚠️ LEGADO DESDE O PAN-124 (25/09/2026): CONSULTA NOVA AO C2X USA `EXCLUDED_ENTERPRISE_IDS`, logo
// abaixo. A sigla é o que muda quando alguém renomeia no C2X, e esta lista já quebrou calada: o
// "LAG" não casa com nada desde 16/07/2026. Nenhuma consulta ao C2X a usa mais. Ela continua
// exportada para os dois leitores que comparam SIGLA, e não filtram consulta nenhuma:
//   • a reserva de código de produto novo (lib/hercules/cadastrar-produto-server.ts), que é espaço de
//     nomes do CADASTRO DO PANTEON;
//   • `idsDosCodigos` (lib/hercules/estoque-da-situacao.ts), só para a sigla que o catálogo não
//     traduz porque o próprio catálogo a tira (LAB, TSC, SDT) não contar como "faltando".
export const EXCLUDED_ENTERPRISE_CODES = ["TSC", "SDT", "LAB", "LAG"];

// A MESMA EXCLUSÃO, PELO ID DO C2X (`enterprises.id`), QUE NÃO MUDA QUANDO ALGUÉM RENOMEIA.
//
// ⚠️ POR QUE POR ID (PAN-124). Em 24/09/2026 a Nívea renomeou o 43 no C2X de RDV para PDI e a busca
// do coordenador pela sigla voltou vazia sem erro nenhum. Esta lista já tinha quebrado do mesmo
// jeito dois meses antes. Medido no C2X em 25/09/2026 (tabela `enterprises` e auditoria
// `Enterprise`, só leitura, scratchpad/pan124-medir-1.ts e -2.ts):
//   • 2  = SDT, "SERVIDOR DE TREINAMENTO". Nenhuma troca de sigla auditada;
//   • 31 = LAB, "LAGOA BONITA - MASTERPLAN". Nenhuma troca de sigla auditada;
//   • 34 = TSC, "TESTE SPLIT CARELI". Nasceu TSC em 15/04/2026 (auditoria 2423);
//   • o LAG ERA O 30. LAG -> ADT em 16/07/2026 (auditoria 16039: "LAGOA BONITA - ADITIVO" virou
//     "CARELI - ADITIVOS") e ADT -> ACT em 21/09/2026 (auditoria 33689). Hoje ele se chama "ALDEIA DA
//     CACHOEIRA DAS PEDRAS - TERMO DE ADESAO E TRANSFERENCIA". A lista nasceu em 04/07/2026 (commit
//     0613b562) com o 30 ainda LAG: de 04/07 a 16/07 ELE era o excluído; desde 16/07 nenhum id casa
//     com "LAG" e o 30 entra em toda leitura.
// No mesmo dia: nenhuma sigla se repete no C2X e nenhuma é nula ou vazia. Então `e.id not in (2, 31,
// 34)` devolve exatamente as linhas que `e.code not in ('TSC', 'SDT', 'LAB', 'LAG')` devolve hoje.
//
// ⚠️ O 30 FICA DE FORA DESTA LISTA, e é decisão medida, não esquecimento:
//   1. a regra do PAN-124 é resultado IDÊNTICO ao de hoje, e hoje o 30 aparece em tudo;
//   2. ele deixou de ser o aditivo da Lagoa Bonita. Virou o termo de adesão da Aldeia: 41 unidades,
//      33 pedidos em assinatura, 5 com contrato gerado, pedido criado no C2X em 25/09/2026 às 08:48.
//      Excluí-lo agora tiraria esses contratos do painel de assinaturas e das vendas sem ninguém pedir;
//   3. ele não tem nenhuma parcela (0 linhas em `payments`): carteira, cobrança e extrato não mudam
//      por causa dele, entrando ou não.
// Voltar a excluí-lo, ou fazê-lo filho da ACP (42), é a pergunta 5 do plano ao Lucas.
export const EXCLUDED_ENTERPRISE_IDS: readonly number[] = [2, 31, 34];

// ESPELHO = o registro HISTÓRICO de antes de uma divisão, cujos lotes existem DE NOVO nas
// divisões vivas. Não é teste, não é lixo: é o mesmo loteamento gravado duas vezes no C2X.
//
// O caso vivo é o Vale do Ouro. Ele foi partido em duas empresas (cada lote é do Cecílio ou do
// Lino, e o contrato/boleto roda na empresa da dona), e o registro anterior continuou de pé:
//   • VLO (35) — o espelho: 298 unidades, que são EXATAMENTE as mesmas de VOC + VOL, par a par
//     por quadra/lote (conferido em 18/08/2026: 298 de 298 com gêmeo);
//   • VOC (37) — 157 unidades · R$ 13.744.472,00 (carteira do Cecílio);
//   • VOL (36) — 141 unidades · R$ 14.024.417,00 (carteira do Lino).
//   157 + 141 = 298 unidades e 13.744.472 + 14.024.417 = 27.768.889 — o espelho, ao centavo.
//
// ⚠️ O VOR (41, "VALE DO OURO - EXTRAS") NASCEU DEPOIS DESTE TEXTO e é a TERCEIRA carteira viva:
// 3 unidades. Ele NÃO é espelho — vende, tem registro próprio —, mas é Vale do Ouro, então entra
// nas `divisions` (é o conjunto que responde por "quanto tem o Vale do Ouro") e no grupo
// consolidado abaixo. Medido em 08/09/2026, por código: VLO 298 · VOC 157 · VOL 141 · VOR 3.
// Cruzando o espelho com as três carteiras vivas por quadra+lote: 301 pares, NENHUM com o mesmo
// id no C2X (são registros diferentes no legado) e 63 com situação divergente — o espelho está
// parado, e é mais uma razão para ele nunca entrar em soma.
//
// Quem soma os três conta o Vale do Ouro DUAS VEZES. Medido na tela "todos os empreendimentos"
// do Apolo em 18/08/2026: 4.560 un / R$ 1.068.042.231,43 quando o certo é 4.262 un /
// R$ 1.040.273.342,43. A diferença é o espelho inteiro.
//
// ⚠️ POR QUE O ESPELHO NÃO ENTRA EM `EXCLUDED_ENTERPRISE_IDS` (antes, `..._CODES`): aquela lista tira o
// empreendimento de TUDO (é usada em ~15 leituras — carteira, cobrança, extrato, credenciamento,
// catálogo, ficha, grafo), e o VLO NÃO PODE SUMIR. Ele é, hoje:
//   • a casa do MASTERPLAN do Vale do Ouro — `lib/apolo/espelho-masterplan.ts` usa MASTERPLAN=35
//     e reflete o status para as carteiras 36/37 num cron de 1 minuto; é o mapa que o corretor vê;
//   • onde estão TODAS as CADs da esteira (`apolo_esteira` é 100% enterprise_id 35);
//   • o eixo do painel do coordenador (`lib/apolo/painel-coordenador.ts`, GRUPOS_C2X).
// Botar o VLO em EXCLUDED quebraria masterplan, CADs e painel de uma vez.
//
// A regra do espelho é OUTRA: ele continua existindo e continua LISTADO — só não entra em SOMA
// nenhuma. Quem soma usa `ANALYTICS_EXCLUDED_ENTERPRISE_IDS` (ou filtra por `isMirrorEnterprise`);
// quem lista mostra a linha marcada como histórica.
export type EnterpriseMirror = {
  /** Código (sigla) do registro histórico. */
  code: string;
  /**
   * Os `enterprises.id` das divisões vivas, na MESMA ordem de `divisions`. É por eles que a
   * consulta ao C2X filtra (PAN-124): a sigla muda quando alguém renomeia, o id não.
   */
  divisionIds: number[];
  /** Códigos vivos que hoje contêm os MESMOS lotes. */
  divisions: string[];
  /** O `enterprises.id` do registro histórico no C2X. */
  id: number;
  /** Rótulo curto pra tela, ao lado do nome. */
  label: string;
  /** Por que a linha continua existindo (quem depende dela). */
  note: string;
};

export const ENTERPRISE_MIRRORS: EnterpriseMirror[] = [
  {
    code: "VLO",
    // Medido no C2X em 25/09/2026: VOC 37, VOL 36, VOR 41 (mesma ordem de `divisions`).
    divisionIds: [37, 36, 41],
    // ⚠️ O VOR ENTROU EM 08/09/2026. A lista tinha sido escrita antes de a carteira de extras
    // existir, e `divisions` é quem responde "quem está vivo no lugar do espelho": sem o VOR, a
    // pergunta "quanto tem o VLO" devolvia 298 unidades de VOC + VOL e escondia as 3 do VOR.
    divisions: ["VOC", "VOL", "VOR"],
    id: 35,
    label: "Histórico · mesmos lotes de VOC + VOL + VOR",
    note:
      "Registro do Vale do Ouro antes da divisão VLO → VOC + VOL, hoje com o VOR (extras) ao " +
      "lado das duas. Fica de fora de toda soma (as 298 unidades do espelho são as mesmas das " +
      "carteiras vivas, que somam 301), mas segue no ar porque é a casa do masterplan, das CADs " +
      "da esteira e do painel do coordenador.",
  },
];

export const MIRROR_ENTERPRISE_CODES: string[] = ENTERPRISE_MIRRORS.map(
  (mirror) => mirror.code,
);

/** Os `enterprises.id` dos espelhos (hoje só o 35, o VLO). */
export const MIRROR_ENTERPRISE_IDS: readonly number[] = ENTERPRISE_MIRRORS.map(
  (mirror) => mirror.id,
);

// Códigos que ficam de fora de QUALQUER conta: os excluídos de sempre + os espelhos.
// É esta a lista que as agregações usam (motor da CACÁ, ranking, vendas por empreendimento).
//
// ⚠️ LEGADO DESDE O PAN-124: consulta nova usa `ANALYTICS_EXCLUDED_ENTERPRISE_IDS`.
export const ANALYTICS_EXCLUDED_ENTERPRISE_CODES: string[] = [
  ...EXCLUDED_ENTERPRISE_CODES,
  ...MIRROR_ENTERPRISE_CODES,
];

// A mesma lista, pelo id do C2X: [2, 31, 34, 35]. Os excluídos de sempre + os espelhos.
export const ANALYTICS_EXCLUDED_ENTERPRISE_IDS: readonly number[] = [
  ...EXCLUDED_ENTERPRISE_IDS,
  ...MIRROR_ENTERPRISE_IDS,
];

// O pedaço de SQL que tira os empreendimentos de toda conta, pelo id (o alias `e` é `enterprises` em
// todas as leituras deste arquivo). Os `?` recebem `...ANALYTICS_EXCLUDED_ENTERPRISE_IDS`, na mesma
// posição em que as siglas iam.
//
// ⚠️ `e.id not in` NÃO É O MESMO QUE `e.code not in` PARA SIGLA NULA: a sigla nula caía fora (NULL não
// passa em `not in`), e o id nunca é nulo. Medido em 25/09/2026: nenhum empreendimento tem sigla nula
// ou vazia no C2X, então hoje as duas devolvem as mesmas linhas.
function semExcluidosDaAnalise(): string {
  return `e.id not in (${ANALYTICS_EXCLUDED_ENTERPRISE_IDS.map(() => "?").join(", ")})`;
}

export function findEnterpriseMirror(
  code: string | null,
): EnterpriseMirror | null {
  const normalized = String(code ?? "")
    .trim()
    .toUpperCase();

  return (
    ENTERPRISE_MIRRORS.find((mirror) => mirror.code === normalized) ?? null
  );
}

export function isMirrorEnterprise(code: string | null): boolean {
  return findEnterpriseMirror(code) !== null;
}

// Consolidação de empreendimentos com o mesmo produto (regras do diário/Lucas): soma etapas.
// Fonte única — o displayEnterprise e o filtro por empreendimento do motor derivam daqui.
//
// ⚠️ `ids` SÃO OS `enterprises.id` DE `codes`, NA MESMA ORDEM (PAN-124). Medidos no C2X em 25/09/2026 e
// conferidos contra o cadastro do Panteon no mesmo dia: as divisões de cada pai em
// `hercules_empreendimentos.pai_id` são exatamente estes ids (LOX -> 1, 4; RDX -> 13, 14, 15; PDX -> 7,
// 10; LAB 31 -> 27, 32, 33; VLO 35 -> 36, 37, 41). Quem filtra o C2X por grupo usa os ids: se alguém
// renomear uma divisão no legado, a sigla sai daqui calada, e o id continua casando. Divisão NOVA
// entra nas duas listas (e no `pai_id` do cadastro), até o agrupamento passar a sair só do `pai_id`.
export const ENTERPRISE_GROUPS: { codes: string[]; display: string; ids: number[] }[] = [
  { codes: ["LOS", "LOU"], display: "Lavra do Ouro", ids: [4, 1] },
  { codes: ["RDP", "RPC", "RPS"], display: "Rio de Pedras", ids: [13, 15, 14] },
  { codes: ["PDV", "PVS"], display: "Portal dos Vales", ids: [7, 10] },
  { codes: ["LBF", "LBR", "LBP"], display: "Lagoa Bonita", ids: [33, 27, 32] },
  // ⚠️ O ESPELHO (VLO) NÃO ENTRA AQUI, e é de propósito. O grupo é a SOMA das etapas: pôr o VLO
  // junto somaria o loteamento duas vezes em toda agregação — exatamente o que
  // `ANALYTICS_EXCLUDED_ENTERPRISE_CODES` existe para impedir. Ele continua linha própria, e o
  // `displayEnterprise` devolve "(histórico)" para ele.
  //
  // Lucas (08/09/2026), comparando com o portal da Gurgel: *"na tela da gurgel, vale do ouro está
  // agrupado, no apolo não"*. Sem esta entrada, a tela de Empreendimentos do Apolo mostrava
  // QUATRO linhas com o mesmo nome e a mesma cidade (VLO, VOC, VOL, VOR), porque a divisão
  // VLO → VOC + VOL foi feita depois de a lista ter sido escrita.
  { codes: ["VOC", "VOL", "VOR"], display: "Vale do Ouro", ids: [37, 36, 41] },
];

// Sub-empreendimentos (GLEBAS) da Lagoa Bonita: cada código é a gleba de um responsável.
// "Lagoa Bonita" (consolidado) = os 3 juntos; pra ver uma gleba individual, o filtro aceita
// o apelido (Raposo/Paulo/Fernando) ou o código (LBR/LBP/LBF) e resolve pro código exato.
//
// `id` é o `enterprises.id` da gleba (medido em 25/09/2026): o filtro do motor passa a casar por ele.
export const ENTERPRISE_SUB_ALIASES: { alias: string; code: string; id: number; label: string }[] =
  [
    { alias: "raposo", code: "LBR", id: 27, label: "Lagoa Bonita (Raposo)" },
    { alias: "lbr", code: "LBR", id: 27, label: "Lagoa Bonita (Raposo)" },
    { alias: "paulo", code: "LBP", id: 32, label: "Lagoa Bonita (Paulo)" },
    { alias: "lbp", code: "LBP", id: 32, label: "Lagoa Bonita (Paulo)" },
    { alias: "fernando", code: "LBF", id: 33, label: "Lagoa Bonita (Fernando)" },
    { alias: "lbf", code: "LBF", id: 33, label: "Lagoa Bonita (Fernando)" },
  ];

export function displayEnterprise(
  code: string | null,
  name: string | null,
): string {
  const c = String(code ?? "").toUpperCase();

  // ESPELHO ANTES DE TUDO. Os quatro "VALE DO OURO" têm o MESMO `name` no C2X, então o
  // `return name` lá embaixo colapsava espelho e divisões numa chave só — e toda agregação por
  // rótulo somava o loteamento duas vezes. Quem ainda receber a linha do espelho (uma listagem,
  // um detalhe) vê que é histórico em vez de vê-la disfarçada de divisão viva.
  const mirror = findEnterpriseMirror(c);

  if (mirror) {
    return `${(name ?? "Empreendimento").trim()} (histórico)`;
  }

  const group = ENTERPRISE_GROUPS.find((entry) => entry.codes.includes(c));

  if (group) {
    return group.display;
  }

  return (name ?? "Empreendimento").trim();
}

export type C2xPeriodo =
  | "hoje"
  | "ontem"
  | "esta_semana"
  | "este_mes"
  | "mes_passado"
  | "este_ano"
  | "ultimos_7_dias"
  | "ultimos_15_dias"
  | "ultimos_30_dias"
  | "desde_o_inicio";

// São Paulo é UTC-3 fixo (Brasil sem horário de verão desde 2019). Meia-noite SP -> instante UTC.
function spMidnightUtc(year: number, month: number, day: number): Date {
  const pad = (n: number) => String(n).padStart(2, "0");

  return new Date(`${year}-${pad(month)}-${pad(day)}T00:00:00-03:00`);
}

function spPartsNow(): { year: number; month: number; day: number; weekday: number } {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    year: "numeric",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).map((part) => [part.type, part.value]),
  );
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    day: Number(parts.day),
    month: Number(parts.month),
    weekday: weekdayMap[parts.weekday ?? "Sun"] ?? 0,
    year: Number(parts.year),
  };
}

// Intervalo [from, to) para o período pedido, em instantes reais (UTC), com base no dia de SP.
export function resolvePeriodoRange(periodo: C2xPeriodo): {
  from: Date;
  label: string;
  to: Date;
} {
  const now = new Date();
  const { year, month, day, weekday } = spPartsNow();
  const todayStart = spMidnightUtc(year, month, day);
  const DAY = 24 * 60 * 60 * 1000;

  switch (periodo) {
    case "hoje":
      return { from: todayStart, label: "hoje", to: now };
    case "ontem":
      return {
        from: new Date(todayStart.getTime() - DAY),
        label: "ontem",
        to: todayStart,
      };
    case "esta_semana": {
      // semana começa na segunda-feira
      const backToMonday = (weekday + 6) % 7;
      return {
        from: new Date(todayStart.getTime() - backToMonday * DAY),
        label: "esta semana",
        to: now,
      };
    }
    case "este_mes":
      return { from: spMidnightUtc(year, month, 1), label: "este mês", to: now };
    case "mes_passado": {
      const prevYear = month === 1 ? year - 1 : year;
      const prevMonth = month === 1 ? 12 : month - 1;

      return {
        from: spMidnightUtc(prevYear, prevMonth, 1),
        label: "mês passado",
        to: spMidnightUtc(year, month, 1),
      };
    }
    case "este_ano":
      return { from: spMidnightUtc(year, 1, 1), label: "este ano", to: now };
    case "desde_o_inicio":
      return {
        from: spMidnightUtc(2000, 1, 1),
        label: "desde o início",
        to: now,
      };
    case "ultimos_7_dias":
      return {
        from: new Date(now.getTime() - 7 * DAY),
        label: "últimos 7 dias",
        to: now,
      };
    case "ultimos_15_dias":
      return {
        from: new Date(now.getTime() - 15 * DAY),
        label: "últimos 15 dias",
        to: now,
      };
    case "ultimos_30_dias":
    default:
      return {
        from: new Date(now.getTime() - 30 * DAY),
        label: "últimos 30 dias",
        to: now,
      };
  }
}

export type C2xMovimentacaoResumo = {
  periodoLabel: string;
  propostas: number; // viraram "Proposta realizada"
  contratoGerado: number;
  emAssinatura: number;
  faturado: number; // vendas fechadas (Faturado)
  vendas: number; // contrato gerado + em assinatura + faturado (pipeline de venda)
  cancelados: number;
  distratos: number; // em distrato + distratado
  reservas: number;
};

// Movimentação por período: quantas aquisições VIRARAM cada estágio no intervalo (via
// acquisition_request_historics). Exclui empreendimentos de teste/masterplan/aditivo.
export async function loadC2xMovimentacaoResumo(
  periodo: C2xPeriodo,
): Promise<C2xMovimentacaoResumo | null> {
  const poolResult = getHadesDbPool();

  if (!poolResult.ok) {
    return null;
  }

  const { from, to, label } = resolvePeriodoRange(periodo);

  try {
    const [rows] = await poolResult.pool.query<
      (RowDataPacket & { stage_id: number; n: number | string })[]
    >(
      `
      select h.new_acquisition_request_stage_id as stage_id, count(*) as n
      from acquisition_request_historics h
      join acquisition_requests ar on ar.id = h.acquisition_request_id
      join enterprise_unities eu on eu.id = ar.enterprise_unity_id
      join enterprises e on e.id = eu.enterprise_id
      where h.created_at >= ? and h.created_at < ?
        and ${semExcluidosDaAnalise()}
      group by h.new_acquisition_request_stage_id
      `,
      [from, to, ...ANALYTICS_EXCLUDED_ENTERPRISE_IDS],
    );

    const byStage = new Map<number, number>();
    for (const row of rows) {
      byStage.set(Number(row.stage_id), Number(row.n));
    }
    const get = (stage: number) => byStage.get(stage) ?? 0;

    const faturado = get(STAGE.FATURADO);
    const contratoGerado = get(STAGE.CONTRATO_GERADO);
    const emAssinatura = get(STAGE.EM_ASSINATURA);

    return {
      cancelados: get(STAGE.CANCELADO),
      contratoGerado,
      distratos: get(STAGE.EM_DISTRATO) + get(STAGE.DISTRATADO),
      emAssinatura,
      faturado,
      periodoLabel: label,
      propostas: get(STAGE.PROPOSTA),
      reservas: get(STAGE.RESERVADO),
      vendas: contratoGerado + emAssinatura + faturado,
    };
  } catch (error) {
    console.error(
      "[guardian] loadC2xMovimentacaoResumo failed",
      sanitizeHadesDbError(error),
    );

    return null;
  }
}

export type C2xMovimentacaoTipo =
  | "propostas"
  | "vendas"
  | "faturado"
  | "cancelamentos";

export type C2xMovimentacaoItem = {
  data: string; // ISO
  estagio: string;
  empreendimento: string;
  quadraLote: string;
  area: number | null;
  valorLote: number | null;
  cliente: string | null;
  corretor: string | null;
  imobiliaria: string | null;
};

function stagesForTipo(tipo: C2xMovimentacaoTipo): number[] {
  switch (tipo) {
    case "propostas":
      return [STAGE.PROPOSTA];
    case "faturado":
      return [STAGE.FATURADO];
    case "cancelamentos":
      return [STAGE.CANCELADO, STAGE.EM_DISTRATO, STAGE.DISTRATADO];
    case "vendas":
    default:
      return [STAGE.CONTRATO_GERADO, STAGE.EM_ASSINATURA, STAGE.FATURADO];
  }
}

// Detalhe da movimentação: lista as aquisições que viraram o estágio pedido no período, com
// unidade, valor, metragem, cliente, corretor e imobiliária. Limite baixo (executivo).
export async function loadC2xMovimentacaoDetalhe(
  periodo: C2xPeriodo,
  tipo: C2xMovimentacaoTipo,
  limit = 25,
): Promise<C2xMovimentacaoItem[]> {
  const poolResult = getHadesDbPool();

  if (!poolResult.ok) {
    return [];
  }

  const { from, to } = resolvePeriodoRange(periodo);
  const stages = stagesForTipo(tipo);
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);

  try {
    const [rows] = await poolResult.pool.query<
      (RowDataPacket & {
        data: Date | string;
        estagio: string | null;
        emp_code: string | null;
        emp_name: string | null;
        block: string | null;
        lot: string | null;
        area: number | string | null;
        price: number | string | null;
        cliente: string | null;
        corretor: string | null;
        imobiliaria: string | null;
      })[]
    >(
      `
      select h.created_at as data, s.name as estagio,
             e.code as emp_code, e.name as emp_name,
             eu.block, eu.lot, eu.area, eu.price,
             cli.name as cliente, cor.name as corretor,
             coalesce(
               nullif(trim(imob.fantasy_name), ''),
               nullif(trim(imob.social_name), ''),
               nullif(trim(imob.name), '')
             ) as imobiliaria
      from acquisition_request_historics h
      join acquisition_requests ar on ar.id = h.acquisition_request_id
      join acquisition_request_stages s on s.id = h.new_acquisition_request_stage_id
      join enterprise_unities eu on eu.id = ar.enterprise_unity_id
      join enterprises e on e.id = eu.enterprise_id
      left join users cli on cli.id = ar.client_id
      left join users cor on cor.id = ar.corretor_id
      -- Imobiliária pelo VÍNCULO do comprador (users.vinculed_by_id), não pelo corretor_id
      -- (sempre NULO no C2X). Mesma fonte do ranking/motor. Ver [[reference-c2x-vendas-model]].
      left join users imob on imob.id = cli.vinculed_by_id
      where h.created_at >= ? and h.created_at < ?
        and h.new_acquisition_request_stage_id in (${stages.map(() => "?").join(", ")})
        and ${semExcluidosDaAnalise()}
      order by h.created_at desc
      limit ${safeLimit}
      `,
      [from, to, ...stages, ...ANALYTICS_EXCLUDED_ENTERPRISE_IDS],
    );

    return rows.map((row) => ({
      area: row.area == null ? null : Number(row.area),
      cliente: row.cliente,
      corretor: row.corretor,
      data:
        row.data instanceof Date ? row.data.toISOString() : String(row.data),
      empreendimento: displayEnterprise(row.emp_code, row.emp_name),
      estagio: row.estagio ?? "-",
      imobiliaria: row.imobiliaria,
      quadraLote: `Q${row.block ?? "?"} L${row.lot ?? "?"}`,
      valorLote: row.price == null ? null : Number(row.price),
    }));
  } catch (error) {
    console.error(
      "[guardian] loadC2xMovimentacaoDetalhe failed",
      sanitizeHadesDbError(error),
    );

    return [];
  }
}

export type C2xImobiliariaVendas = {
  imobiliaria: string;
  unidades: number;
};

// Ranking de imobiliárias por vendas (unidades faturadas distintas). A imobiliária vem do
// VÍNCULO do cliente comprador (`users.vinculed_by_id`), não de corretor_id (que é sempre
// nulo no C2X). Nome pela fantasia/social/name. Ver [[reference-c2x-vendas-model]].
export async function loadC2xVendasPorImobiliaria(
  limit = 12,
): Promise<C2xImobiliariaVendas[]> {
  const poolResult = getHadesDbPool();

  if (!poolResult.ok) {
    return [];
  }

  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 30);

  try {
    const [rows] = await poolResult.pool.query<
      (RowDataPacket & { imobiliaria: string | null; unidades: number | string })[]
    >(
      `
      select coalesce(
               nullif(trim(imob.fantasy_name), ''),
               nullif(trim(imob.social_name), ''),
               nullif(trim(imob.name), ''),
               '(venda direta / sem imobiliária)'
             ) as imobiliaria,
             count(distinct ar.enterprise_unity_id) as unidades
      from acquisition_requests ar
      join enterprise_unities eu on eu.id = ar.enterprise_unity_id
      join enterprises e on e.id = eu.enterprise_id
      join users cli on cli.id = ar.client_id
      left join users imob on imob.id = cli.vinculed_by_id
      where ar.acquisition_request_stage_id = 4
        and ${semExcluidosDaAnalise()}
      group by imobiliaria
      order by unidades desc
      limit ${safeLimit}
      `,
      [...ANALYTICS_EXCLUDED_ENTERPRISE_IDS],
    );

    return rows.map((row) => ({
      imobiliaria: row.imobiliaria ?? "-",
      unidades: Number(row.unidades),
    }));
  } catch (error) {
    console.error(
      "[guardian] loadC2xVendasPorImobiliaria failed",
      sanitizeHadesDbError(error),
    );

    return [];
  }
}

export type C2xUnidadeDetalhe = {
  empreendimento: string;
  quadraLote: string;
  area: number | null;
  valor: number | null;
  statusVenda: string; // sale_status da unidade (Disponível/Reservado/Em negociação/Vendido/Bloqueado)
  estagioAtual: string | null; // estágio da aquisição viva (Faturado/Em assinatura/...)
  comprador: string | null;
  corretor: string | null;
};

// Consulta PONTUAL de unidade(s) por empreendimento + quadra + lote. Traz status de venda,
// área, valor e o comprador/estágio da aquisição viva (ignora canceladas/distratos). quadra/
// lote aceitam com ou sem zero à esquerda e prefixo C. Ver [[reference-c2x-vendas-model]].
export async function loadC2xUnidade(filters: {
  empreendimento?: string | null;
  quadra?: string | null;
  lote?: string | null;
}): Promise<C2xUnidadeDetalhe[]> {
  const poolResult = getHadesDbPool();

  if (!poolResult.ok) {
    return [];
  }

  const emp = String(filters.empreendimento ?? "").trim();
  const quadra = String(filters.quadra ?? "").trim();
  const lote = String(filters.lote ?? "").trim();

  if (!emp || !lote) {
    return [];
  }

  const where: string[] = [
    semExcluidosDaAnalise(),
    // ⚠️ ESTE CONTINUA PELA SIGLA, e é de propósito: é o TERMO que a pessoa digitou para a CACÁ
    // ("unidade 5 do VOC"), e quem digita usa a sigla que vê hoje. Não é chave guardada.
    "(upper(e.code) = upper(?) or e.name like ? or e.divulgation_name like ?)",
    "(eu.lot = ? or eu.lot = lpad(?, 2, '0'))",
  ];
  const params: unknown[] = [
    ...ANALYTICS_EXCLUDED_ENTERPRISE_IDS,
    emp,
    `%${emp}%`,
    `%${emp}%`,
    lote,
    lote,
  ];

  if (quadra) {
    where.push(
      "(eu.block = ? or eu.block = lpad(?, 2, '0') or upper(eu.block) = concat('C', lpad(?, 2, '0')) or upper(eu.block) = concat('C', upper(?)))",
    );
    params.push(quadra, quadra, quadra, quadra);
  }

  try {
    const [rows] = await poolResult.pool.query<
      (RowDataPacket & {
        emp_code: string | null;
        emp_name: string | null;
        block: string | null;
        lot: string | null;
        area: number | string | null;
        price: number | string | null;
        sale_status: string | null;
        estagio: string | null;
        comprador: string | null;
        corretor: string | null;
      })[]
    >(
      `
      select e.code as emp_code, e.name as emp_name, eu.block, eu.lot, eu.area, eu.price,
             ss.name as sale_status, s.name as estagio, cli.name as comprador, cor.name as corretor
      from enterprise_unities eu
      join enterprises e on e.id = eu.enterprise_id
      left join sale_statuses ss on ss.id = eu.sale_status_id
      left join acquisition_requests ar on ar.id = (
        select ar2.id from acquisition_requests ar2
        where ar2.enterprise_unity_id = eu.id
          and ar2.acquisition_request_stage_id not in (7, 8, 10, 11)
        order by field(ar2.acquisition_request_stage_id, 4, 6, 5, 3, 9, 2, 1) desc, ar2.id desc
        limit 1
      )
      left join acquisition_request_stages s on s.id = ar.acquisition_request_stage_id
      left join users cli on cli.id = ar.client_id
      left join users cor on cor.id = ar.corretor_id
      where ${where.join(" and ")}
      order by eu.block, eu.lot
      limit 20
      `,
      params,
    );

    return rows.map((row) => ({
      area: row.area == null ? null : Number(row.area),
      comprador: row.comprador,
      corretor: row.corretor,
      empreendimento: displayEnterprise(row.emp_code, row.emp_name),
      estagioAtual: row.estagio,
      quadraLote: `Q${row.block ?? "?"} L${row.lot ?? "?"}`,
      statusVenda: row.sale_status ?? "-",
      valor: row.price == null ? null : Number(row.price),
    }));
  } catch (error) {
    console.error("[guardian] loadC2xUnidade failed", sanitizeHadesDbError(error));

    return [];
  }
}

export type C2xClienteUnidade = {
  empreendimento: string;
  quadraLote: string;
  estagio: string | null;
  valor: number | null;
};

export type C2xClientePerfil = {
  idade: number | null;
  sexo: string | null;
  estadoCivil: string | null;
  escolaridade: string | null;
  renda: string | null;
  profissao: string | null;
  cidadeUf: string | null;
  email: string | null;
  telefone: string | null;
};

export type C2xClienteResumo = {
  nome: string;
  documento: string | null;
  // Imobiliária vinculada ao cliente/prospect (users.vinculed_by_id). TODO cliente/prospect
  // tem imobiliária cadastrada — NÃO depende de ter venda/unidade. (Decisão do Lucas 4/jul.)
  imobiliaria: string | null;
  perfil: C2xClientePerfil;
  unidades: C2xClienteUnidade[];
};

// Consulta PONTUAL de um cliente/prospect por nome ou CPF/CNPJ (modo admin, sem restrição de
// vínculo). Traz o CADASTRO completo da tabela users (idade, sexo, estado civil, escolaridade,
// renda, profissão, cidade, contato), a IMOBILIÁRIA vinculada (independe de venda) e as
// unidades vivas dele, se houver. Ver [[reference-c2x-vendas-model]].
export async function loadC2xClienteResumo(
  termo: string,
): Promise<C2xClienteResumo | null> {
  const poolResult = getHadesDbPool();

  if (!poolResult.ok) {
    return null;
  }

  const clean = String(termo ?? "").trim();
  const digits = clean.replace(/\D/g, "");

  if (!clean) {
    return null;
  }

  const cadastroSelect = `
    select u.id, u.name, u.cpf, u.cnpj, u.email, u.cellphone, u.phone,
           timestampdiff(year, u.birthday, curdate()) as idade,
           sx.name as sexo, cv.name as estado_civil, sal.name as renda,
           sch.name as escolaridade, prof.name as profissao,
           coalesce(nullif(trim(imob.fantasy_name), ''), nullif(trim(imob.social_name), ''),
                    nullif(trim(imob.name), '')) as imobiliaria,
           city.name as cidade, st.acronym as uf
    from users u
    left join users imob on imob.id = u.vinculed_by_id
    left join sexes sx on sx.id = u.sex_id
    left join civil_states cv on cv.id = u.civil_state_id
    left join salary_ranges sal on sal.id = u.salary_range_id
    left join schoolings sch on sch.id = u.schooling_id
    left join professions prof on prof.id = u.profession_id
    left join addresses addr on addr.id = (
      select a.id from addresses a
      where a.ownertable_type = 'User' and a.ownertable_id = u.id
      order by a.updated_at desc, a.id desc limit 1
    )
    left join cities city on city.id = addr.city_id
    left join states st on st.id = coalesce(addr.state_id, city.state_id)
  `;

  try {
    const [clientes] = await poolResult.pool.query<
      (RowDataPacket & {
        id: number;
        name: string | null;
        cpf: string | null;
        cnpj: string | null;
        email: string | null;
        cellphone: string | null;
        phone: string | null;
        idade: number | string | null;
        sexo: string | null;
        estado_civil: string | null;
        renda: string | null;
        escolaridade: string | null;
        profissao: string | null;
        imobiliaria: string | null;
        cidade: string | null;
        uf: string | null;
      })[]
    >(
      digits.length >= 11
        ? `${cadastroSelect}
             where replace(replace(replace(replace(coalesce(u.cpf, u.cnpj, ''), '.', ''), '-', ''), '/', ''), ' ', '') = ?
             limit 1`
        : `${cadastroSelect} where u.profile_id = 2 and u.name like ? order by u.name limit 1`,
      digits.length >= 11 ? [digits] : [`%${clean}%`],
    );

    const cliente = clientes[0];
    if (!cliente) {
      return null;
    }

    const [unidades] = await poolResult.pool.query<
      (RowDataPacket & {
        emp_code: string | null;
        emp_name: string | null;
        block: string | null;
        lot: string | null;
        price: number | string | null;
        estagio: string | null;
      })[]
    >(
      `
      select distinct e.code as emp_code, e.name as emp_name, eu.block, eu.lot, eu.price,
             s.name as estagio
      from acquisition_requests ar
      join enterprise_unities eu on eu.id = ar.enterprise_unity_id
      join enterprises e on e.id = eu.enterprise_id
      left join acquisition_request_stages s on s.id = ar.acquisition_request_stage_id
      where ar.client_id = ?
        and ar.acquisition_request_stage_id not in (7, 8, 10, 11)
        and ${semExcluidosDaAnalise()}
      order by e.name, eu.block, eu.lot
      limit 50
      `,
      [cliente.id, ...ANALYTICS_EXCLUDED_ENTERPRISE_IDS],
    );

    const cidadeUf = [cliente.cidade, cliente.uf].filter(Boolean).join("/") || null;

    return {
      documento: cliente.cpf ?? cliente.cnpj ?? null,
      imobiliaria: cliente.imobiliaria ?? null,
      nome: cliente.name ?? "-",
      perfil: {
        cidadeUf,
        email: cliente.email?.trim() || null,
        escolaridade: cliente.escolaridade ?? null,
        estadoCivil: cliente.estado_civil ?? null,
        idade: cliente.idade == null ? null : Number(cliente.idade),
        profissao: cliente.profissao ?? null,
        renda: cliente.renda ?? null,
        sexo: cliente.sexo ?? null,
        telefone: cliente.cellphone?.trim() || cliente.phone?.trim() || null,
      },
      unidades: unidades.map((row) => ({
        empreendimento: displayEnterprise(row.emp_code, row.emp_name),
        estagio: row.estagio,
        quadraLote: `Q${row.block ?? "?"} L${row.lot ?? "?"}`,
        valor: row.price == null ? null : Number(row.price),
      })),
    };
  } catch (error) {
    console.error(
      "[guardian] loadC2xClienteResumo failed",
      sanitizeHadesDbError(error),
    );

    return null;
  }
}

export type C2xVendasEmpreendimento = {
  empreendimento: string;
  total: number;
  vendidas: number;
  disponiveis: number;
};

// Snapshot da carteira por empreendimento (estado atual, sale_status da unidade), com as
// regras de consolidação/exclusão. "Vendido" = sale_status_id 4. Ver [[reference-c2x-vendas-model]].
export async function loadC2xVendasPorEmpreendimento(): Promise<
  C2xVendasEmpreendimento[]
> {
  const poolResult = getHadesDbPool();

  if (!poolResult.ok) {
    return [];
  }

  try {
    const [rows] = await poolResult.pool.query<
      (RowDataPacket & {
        code: string | null;
        name: string | null;
        total: number | string;
        vendidas: number | string;
        disponiveis: number | string;
      })[]
    >(
      `
      select e.code, e.name,
             count(*) as total,
             sum(eu.sale_status_id = 4) as vendidas,
             sum(eu.sale_status_id = 1) as disponiveis
      from enterprise_unities eu
      join enterprises e on e.id = eu.enterprise_id
      where ${semExcluidosDaAnalise()}
      group by e.code, e.name
      `,
      [...ANALYTICS_EXCLUDED_ENTERPRISE_IDS],
    );

    // Consolida os que compartilham produto (Lavra do Ouro, Rio de Pedras, Portal, Lagoa Bonita).
    // O ESPELHO já ficou fora no SQL (ANALYTICS_EXCLUDED_ENTERPRISE_IDS): os quatro
    // "VALE DO OURO" têm o mesmo `name`, e sem isso o VLO caía na MESMA chave das divisões
    // vivas e o loteamento aparecia com o dobro das unidades.
    const byDisplay = new Map<string, C2xVendasEmpreendimento>();
    for (const row of rows) {
      const key = displayEnterprise(row.code, row.name);
      const current = byDisplay.get(key) ?? {
        disponiveis: 0,
        empreendimento: key,
        total: 0,
        vendidas: 0,
      };
      current.total += Number(row.total);
      current.vendidas += Number(row.vendidas);
      current.disponiveis += Number(row.disponiveis);
      byDisplay.set(key, current);
    }

    return Array.from(byDisplay.values()).sort(
      (first, second) => second.vendidas - first.vendidas,
    );
  } catch (error) {
    console.error(
      "[guardian] loadC2xVendasPorEmpreendimento failed",
      sanitizeHadesDbError(error),
    );

    return [];
  }
}
