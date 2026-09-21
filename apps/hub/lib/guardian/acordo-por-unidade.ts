// O ACORDO É DE UMA UNIDADE, NÃO DO CLIENTE — a régua, pura, sem tela e sem banco.
//
// ⚠️ ATÉ 11/09/2026 A TELA AFIRMAVA O CONTRÁRIO, por escrito: "Pode juntar parcelas de qualquer
// unidade (cobrança é por cliente)". Não era esquecimento, era decisão de produto — e o Lucas a
// reverteu no mesmo dia: "se o cliente tiver mais de uma unidade, eu não consigo fazer acordos
// por unidade (...) uma tela de escolha tem que existir".
//
// ⚠️ E OS DOIS ÚNICOS ACORDOS DE PRODUÇÃO JÁ NASCERAM MISTURADOS: AC-000012 junta LOU1822 e
// LOU1823; AC-000014 junta MDS0802 e MDS0306. Num acordo assim não há como dizer quanto da
// entrada pertence a cada unidade, e o termo que formaliza a dívida de uma unidade fica sem
// objeto. Por isso a mistura passa a ser recusada, e não só desencorajada.
//
// Alcance medido no C2X no mesmo dia: 56 dos 295 clientes com parcela vencida (19%) têm mais de
// um contrato em atraso — 554 das 1.664 parcelas vencidas, R$ 412.072,34 de R$ 1.545.562,04.

export type ParcelaParaAcordo = {
  /** `acquisition_requests.id` do C2X. É a chave do contrato/unidade. */
  acquisitionRequestId: string;
  id: string;
  number: string;
  status: string;
  unitCode?: string;
  unitId?: string;
  unitLabel?: string;
  valueNumber: number;
};

export type UnidadeEmAtraso = {
  acquisitionRequestId: string;
  parcelas: number;
  /** O que a operadora lê na lista de escolha. */
  rotulo: string;
  total: number;
  unitCode?: string;
  unitLabel?: string;
};

/**
 * As unidades do cliente que têm parcela vencida, uma linha por contrato.
 *
 * ⚠️ AGRUPA POR `acquisitionRequestId`, E NÃO POR `unitId`. O `unitId` da parcela vem de um
 * lookup que, no cliente achatado do read-model (`lib/guardian/attendance.ts`), colapsa todas as
 * unidades no id da primeira — agrupar por ele juntaria de volta os dois lotes que a escolha
 * existe para separar. O `acquisitionRequestId` vem do C2X em cada linha e não tem esse defeito.
 */
export function unidadesEmAtraso(
  parcelas: ParcelaParaAcordo[],
): UnidadeEmAtraso[] {
  const porContrato = new Map<string, UnidadeEmAtraso>();

  for (const parcela of parcelas) {
    if (parcela.status !== "Vencida") continue;

    const chave = String(parcela.acquisitionRequestId ?? "").trim();
    if (!chave) continue;

    const atual = porContrato.get(chave);

    if (atual) {
      atual.parcelas += 1;
      atual.total += parcela.valueNumber;
      continue;
    }

    porContrato.set(chave, {
      acquisitionRequestId: chave,
      parcelas: 1,
      rotulo: parcela.unitCode?.trim() || parcela.unitLabel?.trim() || `Contrato ${chave}`,
      total: parcela.valueNumber,
      unitCode: parcela.unitCode,
      unitLabel: parcela.unitLabel,
    });
  }

  return [...porContrato.values()].sort((a, b) =>
    a.rotulo.localeCompare(b.rotulo, "pt-BR"),
  );
}

/**
 * O contrato de uma seleção de parcelas, ou `null` quando ela mistura contratos (ou está vazia).
 *
 * É o que o POST grava em `guardian_compromissos.acquisition_request_c2x_id` — a coluna existe
 * desde a migration 0036 e estava NULA em 7 de 7 compromissos.
 */
export function contratoDaSelecao(
  selecionadas: ParcelaParaAcordo[],
): null | string {
  const contratos = new Set(
    selecionadas
      .map((p) => String(p.acquisitionRequestId ?? "").trim())
      .filter(Boolean),
  );

  if (contratos.size !== 1) return null;

  return [...contratos][0] ?? null;
}

/** A unidade de um acordo, do jeito que a operadora lê. */
export type UnidadeDoAcordo = {
  rotulo: string;
  unitCode: null | string;
  unitLabel: null | string;
};

/**
 * De qual unidade é este acordo — traduzindo o contrato gravado nele para o código do lote.
 *
 * TI-000149 (Cinthia, 17/09/2026): *"Em acordo mostrar de qual unidade o acordo é."*
 *
 * ⚠️ O ACORDO GUARDA O CONTRATO, NÃO O CÓDIGO DO LOTE. `acquisition_request_c2x_id` é a única
 * chave que separa dois acordos do mesmo cliente (ver `contratoDaSelecao`), e o código legível
 * (LOS0504) mora nas parcelas do C2X. Quem quiser o nome da unidade tem de casar os dois — é o
 * mesmo casamento que o termo de acordo já faz para imprimir o papel.
 *
 * ⚠️ E NÃO SE USA A CARTEIRA DO CLIENTE PARA ISSO. A tela de aprovação mostrava a PRIMEIRA
 * matrícula da carteira, que em cliente de uma unidade só acerta por sorte e em cliente com várias
 * mente: medido em 21/09/2026, dos 40 acordos vivos, 14 são de clientes com mais de uma unidade, e
 * 6 clientes têm acordos de contratos DIFERENTES que a tela rotulava igual.
 *
 * `null` quando o acordo é antigo e nasceu sem contrato (a coluna ficou nula até 11/09/2026) ou
 * quando nenhuma parcela daquele contrato aparece na lista: a tela diz isso em português, em vez
 * de escrever a unidade de outra pessoa.
 */
export function unidadeDoAcordo(
  acquisitionRequestId: null | number | string | undefined,
  parcelasDoCliente: readonly ParcelaParaAcordo[],
): null | UnidadeDoAcordo {
  const contrato = String(acquisitionRequestId ?? "").trim();
  if (!contrato) return null;

  const daUnidade = parcelasDoCliente.find(
    (parcela) => String(parcela.acquisitionRequestId ?? "").trim() === contrato,
  );
  if (!daUnidade) return null;

  const unitCode = (daUnidade.unitCode ?? "").trim() || null;
  const unitLabel = (daUnidade.unitLabel ?? "").trim() || null;
  // O código é o que a operadora procura na lista; o rótulo longo vem atrás quando acrescenta.
  const rotulo = unitCode && unitLabel && unitLabel !== unitCode
    ? `${unitCode} · ${unitLabel}`
    : unitCode ?? unitLabel;
  if (!rotulo) return null;

  return { rotulo, unitCode, unitLabel };
}
