/* eslint-disable */
// @ts-nocheck
import { hadesMockClients } from "@/modules/guardian/hadesMockData";
import type { HadesMockClient } from "@/modules/guardian/hadesMockData";
import type { PaymentPromiseStatus, QueueClient } from "@/modules/guardian/attendance/types";

const EMPTY_FIELD = "-";

export type HadesAttendanceSourceUnit = {
  area: string;
  empreendimento: string;
  id: string;
  imobiliariaCorretor?: string;
  lote: string;
  matricula?: string;
  quadra: string;
  signedContractDocumentId?: string;
  signedContractStatus?: string;
  signedContractUrl?: string;
  statusVenda?: string;
  unidadeLote: string;
  valorUnidade: number;
};

export type HadesAttendanceSourceClient = HadesMockClient & {
  c2xAcquisitionRequestId?: string;
  c2xInstallmentsLoaded?: boolean;
  c2xInstallments?: QueueClient["c2xInstallments"];
  c2xUnits?: HadesAttendanceSourceUnit[];
  bairro?: string;
  cep?: string;
  complementoEndereco?: string;
  conjuge?: string;
  conjugeDados?: {
    cpf: string;
    documentoIdentidade: string;
    email: string;
    endereco: string;
    idade: string;
    nacionalidade: string;
    nascimento: string;
    nome: string;
    profissao: string;
    naturalidade?: string;
    sexo: string;
    telefone: string;
  };
  cpfConjuge?: string;
  documentoIdentidade?: string;
  email?: string;
  endereco?: string;
  imobiliariaCorretor?: string;
  matricula?: string;
  nascimento?: string;
  nacionalidade?: string;
  naturalidade?: string;
  nomeFantasia?: string;
  nomeMae?: string;
  numeroEndereco?: string;
  razaoSocial?: string;
  regimeBens?: string;
  relacionamento?: string;
  rg?: string;
  tipoPessoa?: string;
  unitId?: string;
};

export const queueClients: QueueClient[] = buildQueueClientsFromSources(hadesMockClients);

export function buildQueueClientsFromSources(
  clients: HadesAttendanceSourceClient[]
): QueueClient[] {
  return clients.map((client) => {
    const c2xUnits =
      client.c2xUnits?.map((unit, index) =>
        buildUnit({ ...client, ...unit }, client.id, index > 0),
      ) ?? [];
    const mainUnit = c2xUnits[0] ?? buildUnit(client, client.id, false);
    const secondUnit =
      c2xUnits.length === 0 && client.segundaUnidade
        ? buildUnit(
            {
              ...client,
              empreendimento: client.segundaUnidade.empreendimento,
              unidadeLote: client.segundaUnidade.unidadeLote,
              quadra: client.segundaUnidade.quadra,
              lote: client.segundaUnidade.lote,
              area: client.segundaUnidade.area,
              valorUnidade: client.segundaUnidade.valorUnidade,
            },
            client.id,
            true
          )
        : null;
    const workflow = buildWorkflow(client);
    const units = c2xUnits.length > 0 ? c2xUnits : secondUnit ? [mainUnit, secondUnit] : [mainUnit];
    const agreement = buildAgreement(client, units[0]);
    const commitments = buildCommitments(client, units, agreement);

    return {
    id: client.id,
    nome: client.nome,
    c2xAcquisitionRequestId: client.c2xAcquisitionRequestId,
    c2xInstallmentsLoaded: client.c2xInstallmentsLoaded,
    c2xInstallments: client.c2xInstallments ?? [],
    atrasoDias: client.atrasoDias,
    saldoDevedor: money(client.saldoAtraso),
    prioridade: client.prioridade,
    scoreRisco: client.scoreRisco,
    responsavel: client.responsavel,
    cpf: client.cpf,
    segmento: EMPTY_FIELD,
    dados360: {
      tipoPessoa: client.tipoPessoa ?? EMPTY_FIELD,
      idade: client.idade,
      sexo: client.sexo,
      estadoCivil: client.estadoCivil,
      profissao: client.profissao,
      faixaSalarial: client.renda,
      cidade: client.cidade,
      telefone: client.telefone,
      nascimento: client.nascimento ?? birthDateFromAge(client.idade),
      relacionamento: client.relacionamento ?? EMPTY_FIELD,
      conjuge: client.conjuge ?? EMPTY_FIELD,
      cpfConjuge: client.cpfConjuge ?? EMPTY_FIELD,
      email: client.email ?? EMPTY_FIELD,
      escolaridade: client.escolaridade,
      naturalidade: client.naturalidade ?? client.cidade,
      nacionalidade: client.nacionalidade ?? EMPTY_FIELD,
      bairro: client.bairro ?? EMPTY_FIELD,
      cep: client.cep ?? EMPTY_FIELD,
      complementoEndereco: client.complementoEndereco ?? EMPTY_FIELD,
      conjugeDados: client.conjugeDados ?? {
        cpf: client.cpfConjuge ?? EMPTY_FIELD,
        documentoIdentidade: EMPTY_FIELD,
        email: EMPTY_FIELD,
        endereco: EMPTY_FIELD,
        idade: EMPTY_FIELD,
        nacionalidade: EMPTY_FIELD,
        nascimento: EMPTY_FIELD,
        naturalidade: EMPTY_FIELD,
        nome: client.conjuge ?? EMPTY_FIELD,
        profissao: EMPTY_FIELD,
        sexo: EMPTY_FIELD,
        telefone: EMPTY_FIELD,
      },
      documentoIdentidade: client.documentoIdentidade ?? EMPTY_FIELD,
      endereco: client.endereco ?? EMPTY_FIELD,
      nomeFantasia: client.nomeFantasia ?? EMPTY_FIELD,
      nomeMae: client.nomeMae ?? EMPTY_FIELD,
      numeroEndereco: client.numeroEndereco ?? EMPTY_FIELD,
      razaoSocial: client.razaoSocial ?? EMPTY_FIELD,
      regimeBens: client.regimeBens ?? EMPTY_FIELD,
      rg: client.rg ?? EMPTY_FIELD,
    },
    carteira: {
      empreendimento: client.empreendimento,
      imobiliariaCorretor: client.imobiliariaCorretor ?? EMPTY_FIELD,
      unidades: units,
    },
    parcelas: {
      vencidas: client.parcelasVencidas,
      abertas: client.parcelasVencidas + client.parcelasAVencer,
      ultimaParcela: money(client.parcelasVencidas > 0 ? client.saldoAtraso / client.parcelasVencidas : client.valorUnidade / Math.max(client.parcelasTotal, 1)),
      proximaAcao: nextActionForStatus(client.status, client.prioridade),
    },
    workflow,
    agreement,
    commitments,
    timeline: buildOperationalTimeline(client, workflow, agreement, commitments),
    aiSuggestion: buildSuggestion(),
    };
  });
}

function buildUnit(
  client: {
    id: string;
    empreendimento: string;
    unidadeLote: string;
    quadra: string;
    lote: string;
    area: string;
    valorUnidade: number;
    imobiliariaCorretor?: string;
    matricula?: string;
    signedContractDocumentId?: string;
    signedContractStatus?: string;
    signedContractUrl?: string;
    statusVenda?: string;
    unitId?: string;
  },
  clientId: string,
  secondary: boolean
) {
  return {
    id: client.unitId ?? `${clientId}-${secondary ? "2" : "1"}`,
    empreendimento: client.empreendimento,
    unidadeLote: client.unidadeLote,
    quadra: client.quadra,
    lote: client.lote,
    area: client.area,
    matricula: client.matricula ?? buildUnitCode(client.empreendimento, client.quadra, client.lote),
    signedContractDocumentId: client.signedContractDocumentId,
    signedContractStatus: client.signedContractStatus,
    signedContractUrl: client.signedContractUrl,
    valorTabela: money(client.valorUnidade),
    statusVenda: client.statusVenda ?? EMPTY_FIELD,
    imobiliariaCorretor: client.imobiliariaCorretor ?? EMPTY_FIELD,
  };
}

function buildAgreement(
  client: HadesMockClient,
  unit: QueueClient["carteira"]["unidades"][number]
): QueueClient["agreement"] {
  const originalDebt = client.saldoAtraso;

  return {
    id: `${client.id}-agreement`,
    client: client.nome,
    enterprise: unit.empreendimento,
    unit: `${unit.unidadeLote} · ${unit.area}`,
    originalDebt: money(originalDebt),
    discount: EMPTY_FIELD,
    negotiatedValue: EMPTY_FIELD,
    entry: EMPTY_FIELD,
    installmentsCount: 0,
    recoveredValue: EMPTY_FIELD,
    breakRate: 0,
    recoveryRate: 0,
    status: EMPTY_FIELD,
    risk: EMPTY_FIELD,
    operator: client.responsavel,
    aiSuggestion: {
      composition: EMPTY_FIELD,
      breakChance: 0,
      operationalRisk: EMPTY_FIELD,
      nextAction: EMPTY_FIELD,
    },
    dueDates: [],
  };
}

function buildCommitments(
  client: HadesMockClient,
  units: QueueClient["carteira"]["unidades"],
  agreement: QueueClient["agreement"]
): QueueClient["commitments"] {
  return [];
}

function promiseStatusForClient(client: HadesMockClient): PaymentPromiseStatus {
  if (client.status === "Regularizado") return "Cumprida";
  if (client.status === "Proposta enviada") return "Aguardando pagamento";
  if (client.status === "Escalado") return "Quebrada";
  if (client.status === "Aguardando retorno") return "Reagendada";
  if (client.status === "A vencer") return "Promessa realizada";

  return "Promessa realizada";
}

function promiseNote(status: ReturnType<typeof promiseStatusForClient>, client: HadesMockClient) {
  if (status === "Cumprida") return "Pagamento identificado e compromisso marcado como cumprido na régua operacional.";
  if (status === "Quebrada") return "Promessa não compensada dentro da janela, exigindo nova abordagem humana.";
  if (status === "Reagendada") return "Cliente solicitou nova data com justificativa operacional registrada.";
  if (status === "Aguardando pagamento") return "Cliente recebeu orientação de pagamento e está dentro da janela combinada.";

  return `Promessa capturada após contato positivo para reduzir saldo em atraso de ${money(client.saldoAtraso)}.`;
}

function buildPromiseHistory(
  client: HadesMockClient,
  unitCode: string,
  status: ReturnType<typeof promiseStatusForClient>,
  value: number
) {
  const base: QueueClient["commitments"][number]["history"] = [
    {
      id: `${client.id}-promise-created`,
      protocol: guardianProtocol(ordinalFor(client.id, 21)),
      action: "Promessa criada",
      occurredAt: "10/05/2026 17:45",
      operator: client.responsavel,
      description: `Promessa de ${money(value)} registrada para o cod. unidade ${unitCode}.`,
    },
  ];

  if (status === "Quebrada") {
    base.unshift({
      id: `${client.id}-promise-broken`,
      protocol: guardianProtocol(ordinalFor(client.id, 22)),
      action: "Quebra registrada",
      occurredAt: "11/05/2026 09:20",
      operator: EMPTY_FIELD,
      description: "Pagamento prometido não foi compensado e workflow foi direcionado para quebra de promessa.",
    });
  }

  if (status === "Cumprida") {
    base.unshift({
      id: `${client.id}-promise-paid`,
      protocol: guardianProtocol(ordinalFor(client.id, 23)),
      action: "Cumprimento registrado",
      occurredAt: "11/05/2026 08:42",
      operator: "Financeiro Careli",
      description: "Compensação localizada e promessa marcada como cumprida.",
    });
  }

  if (status === "Reagendada") {
    base.unshift({
      id: `${client.id}-promise-rescheduled`,
      protocol: guardianProtocol(ordinalFor(client.id, 24)),
      action: "Reagendamento registrado",
      occurredAt: "11/05/2026 10:05",
      operator: client.responsavel,
      description: "Data prometida foi reagendada após novo contato com o cliente.",
    });
  }

  return base;
}

function buildAgreementHistory(
  client: HadesMockClient,
  unitCode: string,
  agreement: QueueClient["agreement"]
) {
  const history: QueueClient["commitments"][number]["history"] = [
    {
      id: `${client.id}-agreement-created`,
      protocol: guardianProtocol(ordinalFor(client.id, 31)),
      action: "Acordo criado",
      occurredAt: "10/05/2026 16:58",
      operator: agreement.operator,
      description: `Acordo formal registrado para o cod. unidade ${unitCode} com entrada de ${agreement.entry}.`,
    },
    {
      id: `${client.id}-agreement-status`,
      protocol: guardianProtocol(ordinalFor(client.id, 32)),
      action: `Status alterado para ${agreement.status}`,
      occurredAt: "11/05/2026 11:05",
      operator: agreement.operator,
      description: `Central Operacional atualizou o acordo para ${agreement.status.toLowerCase()}.`,
    },
  ];

  if (agreement.status === "Quebrado") {
    history.unshift({
      id: `${client.id}-agreement-broken`,
      protocol: guardianProtocol(ordinalFor(client.id, 33)),
      action: "Quebra de acordo registrada",
      occurredAt: "11/05/2026 09:12",
      operator: EMPTY_FIELD,
      description: "Acordo ficou inadimplente e workflow recebeu sinalização de quebra.",
    });
  }

  return history;
}

function buildInstallmentRange(count: number) {
  const safeCount = Math.max(count, 1);
  const first = String(Math.max(safeCount - 1, 1)).padStart(2, "0");
  const second = String(safeCount).padStart(2, "0");

  return `${first}/60, ${second}/60`;
}

function buildWorkflow(client: HadesMockClient): QueueClient["workflow"] {
  const stage = workflowStageForClient(client);

  return {
    stage,
    updatedAt: EMPTY_FIELD,
    owner: client.responsavel,
    nextAction: EMPTY_FIELD,
    history: [],
  };
}

function buildOperationalTimeline(
  client: HadesMockClient,
  workflow: QueueClient["workflow"],
  agreement: QueueClient["agreement"],
  commitments: QueueClient["commitments"]
): QueueClient["timeline"] {
  return [];

  const urgent = client.prioridade === "Crítica" || client.prioridade === "Alta";
  const legalOperator = EMPTY_FIELD;
  const boletoAmount = money(
    client.parcelasVencidas > 0 ? client.saldoAtraso / client.parcelasVencidas : 0
  );
  const agreementAmount = money(Math.max(client.saldoAtraso * 0.35, 1200));

  const workflowEvents: QueueClient["timeline"] = workflow.history.map((change) => ({
    actionType: "workflow",
    id: `${change.id}-timeline`,
    protocol: guardianProtocol(ordinalFor(change.id, 1)),
    type:
      change.to === "Crítico"
        ? "Alteração de risco"
        : change.to === "Jurídico"
          ? "Acionamento jurídico"
          : "Observação operacional",
    title: `Workflow: ${change.to}`,
    description: `Etapa alterada de ${change.from} para ${change.to}. ${change.reason}`,
    occurredAt: change.changedAt,
    operator: change.operator,
    status:
      change.to === "Crítico"
        ? "Elevado"
        : change.to === "Jurídico"
          ? "Jurídico"
          : "Registrado",
  }));

  const commitmentEvents: QueueClient["timeline"] = commitments.flatMap((commitment) =>
    commitment.history.slice(0, 2).map((entry) => ({
      actionType: commitment.type === "Promessa de pagamento" ? "promessa" : "acordo",
      id: `${entry.id}-timeline`,
      protocol: entry.protocol,
      type:
        commitment.type === "Promessa de pagamento"
          ? "Promessa de pagamento"
          : commitment.status === "Quebrado"
            ? "Quebra de acordo"
            : "Acordo gerado",
      title: `${commitment.type}: ${entry.action}`,
      description: `${entry.description} Unidade ${commitment.unitCode}.`,
      occurredAt: entry.occurredAt,
      operator: entry.operator,
      status:
        commitment.type === "Promessa de pagamento"
          ? commitment.status === "Quebrada"
            ? "Quebrado"
            : "Prometido"
          : commitment.status === "Quebrado"
            ? "Quebrado"
            : "Gerado",
      unitCode: commitment.unitCode,
      unitLabel: commitment.unitLabel,
    }))
  );

  return [
    ...workflowEvents,
    ...commitmentEvents,
    {
      actionType: "acordo",
      id: `${client.id}-agreement-central-20260511`,
      protocol: agreement.status === "Quebrado" ? guardianProtocol(ordinalFor(client.id, 33)) : guardianProtocol(ordinalFor(client.id, 32)),
      type: agreement.status === "Quebrado" ? "Quebra de acordo" : "Acordo gerado",
      title: `Acordo ${agreement.status.toLowerCase()}`,
      description: `Central de Acordos registrou valor negociado de ${agreement.negotiatedValue}, entrada de ${agreement.entry}, ${agreement.installmentsCount} parcela(s) e risco ${agreement.risk.toLowerCase()}.`,
      occurredAt: "11/05/2026 11:05",
      operator: agreement.operator,
      status: agreement.status === "Quebrado" ? "Quebrado" : "Gerado",
      unitCode: commitments.find((commitment) => commitment.type === "Acordo")?.unitCode,
      unitLabel: commitments.find((commitment) => commitment.type === "Acordo")?.unitLabel,
    },
    {
      actionType: "ligação",
      id: `${client.id}-call-20260511`,
      protocol: guardianProtocol(ordinalFor(client.id, 50)),
      type: "Ligação realizada",
      title: "Contato ativo com cliente",
      description: urgent
        ? "Ligação consultiva concluída para validar intenção de regularização e barreiras de pagamento."
        : "Contato preventivo realizado para confirmar ciência das parcelas e manter relacionamento ativo.",
      occurredAt: "11/05/2026 10:20",
      operator: client.responsavel,
      status: "Realizado",
    },
    {
      actionType: "mensagem",
      id: `${client.id}-whatsapp-20260511`,
      protocol: guardianProtocol(ordinalFor(client.id, 51)),
      type: "WhatsApp enviado",
      title: "Mensagem de negociação enviada",
      description: `WhatsApp com resumo do saldo em atraso de ${money(client.saldoAtraso)} e canal direto para retorno no mesmo dia.`,
      occurredAt: "11/05/2026 10:27",
      operator: client.responsavel,
      status: "Enviado",
    },
    {
      actionType: "promessa",
      id: `${client.id}-promise-20260510`,
      protocol: guardianProtocol(ordinalFor(client.id, 52)),
      type: "Promessa de pagamento",
      title: "Promessa registrada",
      description: `Cliente sinalizou possibilidade de entrada de ${agreementAmount} após validação do fluxo financeiro familiar.`,
      occurredAt: "10/05/2026 17:45",
      operator: client.responsavel,
      status: "Prometido",
    },
    {
      actionType: "acordo",
      id: `${client.id}-agreement-20260510`,
      protocol: guardianProtocol(ordinalFor(client.id, 53)),
      type: "Acordo gerado",
      title: "Minuta de acordo criada",
      description: EMPTY_FIELD,
      occurredAt: "10/05/2026 16:58",
      operator: client.responsavel,
      status: "Gerado",
    },
    {
      actionType: "acordo",
      id: `${client.id}-broken-20260509`,
      protocol: guardianProtocol(ordinalFor(client.id, 54)),
      type: "Quebra de acordo",
      title: "Acordo anterior descumprido",
      description: "Parcela combinada não foi liquidada no prazo e a régua retornou para acompanhamento humano prioritário.",
      occurredAt: "09/05/2026 09:12",
      operator: EMPTY_FIELD,
      status: "Quebrado",
    },
    {
      actionType: "boleto C2X",
      id: `${client.id}-invoice-20260508`,
      protocol: guardianProtocol(ordinalFor(client.id, 55)),
      type: "Boleto C2X",
      title: "Boleto C2X consultado",
      description: `Hades consultou boleto original do C2X com valor de referência de ${boletoAmount} para envio multicanal.`,
      occurredAt: "08/05/2026 14:36",
      operator: EMPTY_FIELD,
      status: "Registrado",
    },
    {
      actionType: "alteração",
      id: `${client.id}-registration-20260508`,
      protocol: guardianProtocol(ordinalFor(client.id, 56)),
      type: "Atualização cadastral",
      title: "Dados cadastrais revisados",
      description: `Telefone ${client.telefone}, cidade ${client.cidade} e perfil de renda conferidos antes da abordagem.`,
      occurredAt: "08/05/2026 11:04",
      operator: client.responsavel,
      status: "Atualizado",
    },
    {
      actionType: "interação",
      id: `${client.id}-note-20260507`,
      protocol: guardianProtocol(ordinalFor(client.id, 57)),
      type: "Observação operacional",
      title: "Contexto de carteira registrado",
      description: `Cliente vinculado ao empreendimento ${client.empreendimento}; abordagem recomendada deve preservar histórico comercial.`,
      occurredAt: "07/05/2026 18:10",
      operator: client.responsavel,
      status: "Registrado",
    },
    {
      actionType: "workflow",
      id: `${client.id}-risk-20260507`,
      protocol: guardianProtocol(ordinalFor(client.id, 58)),
      type: "Alteração de risco",
      title: "Risco operacional reclassificado",
      description: `Score atualizado para ${client.scoreRisco}/100 considerando ${client.atrasoDias} dias de atraso e recorrência recente.`,
      occurredAt: "07/05/2026 08:42",
      operator: "Motor de risco Hades",
      status: "Elevado",
    },
    {
      actionType: "jurídico",
      id: `${client.id}-legal-20260506`,
      protocol: guardianProtocol(ordinalFor(client.id, 59)),
      type: "Acionamento jurídico",
      title: "Pré-análise jurídica registrada",
      description: urgent
        ? "Caso sinalizado para validação jurídica preventiva, ainda sem bloqueio da negociação amigável."
        : "Registro jurídico mantido apenas como trilha de auditoria, sem escalonamento ativo.",
      occurredAt: "06/05/2026 15:25",
      operator: legalOperator,
      status: "Jurídico",
    },
    {
      actionType: "IA",
      id: `${client.id}-ai-20260506`,
      protocol: guardianProtocol(ordinalFor(client.id, 60)),
      type: "Interação da IA",
      title: "Assistente Hades sugeriu próxima ação",
      description: "IA recomendou abordagem consultiva, mensagem objetiva e proposta proporcional ao risco do cliente.",
      occurredAt: "06/05/2026 09:30",
      operator: "Assistente Hades",
      status: "IA",
    },
  ];
}

function workflowStageForClient(client: HadesMockClient): QueueClient["workflow"]["stage"] {
  if (client.status === "Regularizado") return "Pago";
  if (client.status === "A vencer") return "Novo atraso";
  if (client.status === "Proposta enviada") return "Aguardando pagamento";
  if (client.status === "Aguardando retorno") return "Sem retorno";
  if (client.status === "Contato programado") return "Primeiro contato";
  if (client.status === "Em negociação") {
    return client.parcelasVencidas >= 3 ? "Promessa realizada" : "Em negociação";
  }
  if (client.status === "Escalado") {
    if (client.atrasoDias >= 80) return "Jurídico";
    if (client.atrasoDias >= 70) return "Crítico";
    return "Quebra de promessa";
  }

  return "Novo atraso";
}

function previousWorkflowStage(stage: QueueClient["workflow"]["stage"]): QueueClient["workflow"]["history"][number]["from"] {
  const map: Record<QueueClient["workflow"]["stage"], QueueClient["workflow"]["history"][number]["from"]> = {
    "Novo atraso": "Entrada",
    "Primeiro contato": "Novo atraso",
    "Sem retorno": "Primeiro contato",
    "Em negociação": "Primeiro contato",
    "Promessa realizada": "Em negociação",
    "Aguardando pagamento": "Promessa realizada",
    Pago: "Aguardando pagamento",
    "Quebra de promessa": "Aguardando pagamento",
    "Crítico": "Quebra de promessa",
    "Jurídico": "Crítico",
    "Distrato/Evasão": "Jurídico",
  };

  return map[stage];
}

function workflowNextAction(stage: QueueClient["workflow"]["stage"]) {
  const map: Record<QueueClient["workflow"]["stage"], string> = {
    "Novo atraso": "Validar atraso e iniciar régua de primeiro contato",
    "Primeiro contato": "Registrar retorno e confirmar canal preferencial",
    "Sem retorno": "Reforçar acionamento multicanal e janela de ligação",
    "Em negociação": "Formalizar condição de regularização",
    "Promessa realizada": "Monitorar data prometida e consultar boleto C2X quando necessário",
    "Aguardando pagamento": "Acompanhar compensação e enviar lembrete objetivo",
    Pago: "Baixar pendência e manter relacionamento preventivo",
    "Quebra de promessa": "Recalibrar proposta e reclassificar risco",
    "Crítico": "Acionamento humano prioritário com alternativa flexível",
    "Jurídico": "Validar documentação e manter trilha amigável quando possível",
    "Distrato/Evasão": "Registrar risco de evasão e acionar governança comercial",
  };

  return map[stage];
}

function workflowReason(stage: QueueClient["workflow"]["stage"], client: HadesMockClient) {
  const base = `${client.parcelasVencidas} parcela(s), ${client.atrasoDias} dias de atraso e score ${client.scoreRisco}/100.`;

  if (stage === "Pago") return "Pagamento identificado e cliente removido da fila ativa de recuperação.";
  if (stage === "Jurídico") return `Escalonamento preventivo por severidade operacional: ${base}`;
  if (stage === "Crítico") return `Risco elevado pela combinação de atraso e recorrência: ${base}`;
  if (stage === "Quebra de promessa") return "Promessa anterior não compensada dentro da janela operacional.";
  if (stage === "Aguardando pagamento") return "Proposta enviada e cliente aguardando envio do boleto C2X ou compensação do pagamento.";
  if (stage === "Promessa realizada") return "Cliente sinalizou data e condição de pagamento após negociação.";
  if (stage === "Sem retorno") return "Sem resposta após tentativa ativa de contato multicanal.";
  if (stage === "Primeiro contato") return "Cliente entrou na primeira onda de acionamento humano.";
  if (stage === "Em negociação") return "Interação ativa com avaliação de condição de pagamento.";
  if (stage === "Distrato/Evasão") return "Sinal de evasão registrado para governança comercial.";

  return "Novo atraso identificado pela régua operacional.";
}

function agreementStatusForClient(client: HadesMockClient): QueueClient["agreement"]["status"] {
  if (client.status === "Regularizado") return "Pago";
  if (client.status === "Proposta enviada") return "Formalizando";
  if (client.status === "Em negociação") return "Em negociação";
  if (client.status === "Aguardando retorno") return "Em negociação";
  if (client.status === "Contato programado") return "Em negociação";
  if (client.status === "Escalado") return client.atrasoDias >= 80 ? "Quebrado" : "Reativado";
  if (client.status === "A vencer") return "Ativo";

  return "Em negociação";
}

function agreementRiskForClient(client: HadesMockClient): QueueClient["agreement"]["risk"] {
  if (client.prioridade === "Crítica" || client.scoreRisco >= 86) return "Crítico";
  if (client.prioridade === "Alta" || client.scoreRisco >= 74) return "Alto";
  if (client.prioridade === "Média" || client.scoreRisco >= 55) return "Moderado";

  return "Baixo";
}

function agreementDiscountRate(client: HadesMockClient) {
  if (client.prioridade === "Crítica") return 0.18;
  if (client.prioridade === "Alta") return 0.14;
  if (client.prioridade === "Média") return 0.1;

  return 0.06;
}

function agreementEntryRate(client: HadesMockClient) {
  if (client.prioridade === "Crítica") return 0.18;
  if (client.prioridade === "Alta") return 0.22;
  if (client.prioridade === "Média") return 0.28;

  return 0.35;
}

function agreementInstallments(client: HadesMockClient) {
  if (client.prioridade === "Crítica") return 6;
  if (client.prioridade === "Alta") return 5;
  if (client.prioridade === "Média") return 4;

  return 3;
}

function agreementBreakChance(
  client: HadesMockClient,
  risk: QueueClient["agreement"]["risk"]
) {
  const base = {
    Baixo: 12,
    Moderado: 28,
    Alto: 46,
    "Crítico": 64,
  }[risk];

  return Math.min(base + Math.floor(client.atrasoDias / 20), 82);
}

function agreementNextAction(
  status: QueueClient["agreement"]["status"],
  risk: QueueClient["agreement"]["risk"]
) {
  if (status === "Quebrado") return "Reativar acordo com entrada menor e validação humana no mesmo dia";
  if (status === "Formalizando") return "Enviar minuta, confirmar aceite e bloquear vencimento de entrada";
  if (status === "Ativo") return "Monitorar compensação e enviar lembrete antes do próximo vencimento";
  if (status === "Pago") return "Registrar recuperação e manter régua preventiva";
  if (status === "Reativado") return "Confirmar pagamento da nova entrada antes de retirar da fila crítica";
  if (status === "Cancelado") return "Enviar para governança comercial e revisar risco de distrato";
  if (risk === "Crítico") return "Oferecer composição conservadora com entrada acessível e menos parcelas";

  return "Formalizar proposta e acompanhar promessa de pagamento";
}

function buildAgreementDueDates(
  client: HadesMockClient,
  installmentsCount: number,
  entryValue: number,
  installmentValue: number,
  status: QueueClient["agreement"]["status"]
): QueueClient["agreement"]["dueDates"] {
  const totalItems = Math.min(installmentsCount + 1, 7);

  return Array.from({ length: totalItems }, (_, index) => {
    const isEntry = index === 0;
    const date = new Date(2026, 4 + index, isEntry ? 15 : 10);
    const paid =
      status === "Pago" ||
      ((status === "Ativo" || status === "Reativado") && index === 0);
    const overdue = status === "Quebrado" && index <= 1;

    return {
      id: `${client.id}-agreement-due-${index}`,
      label: isEntry ? "Entrada" : `Parcela ${String(index).padStart(2, "0")}`,
      dueDate: formatDate(date),
      amount: money(isEntry ? entryValue : installmentValue),
      status: paid ? "Pago" : overdue ? "Vencido" : status === "Reativado" ? "Reprogramado" : "A vencer",
    };
  });
}

function buildSuggestion() {
  return EMPTY_FIELD;
}

function nextActionForStatus(status: string, priority: QueueClient["prioridade"]) {
  return EMPTY_FIELD;
}

function brokerForEnterprise(enterprise: string) {
  return EMPTY_FIELD;
}

function buildUnitCode(enterprise: string, quadra: string, lote: string) {
  const enterpriseCode = enterpriseCodeFor(enterprise);
  const blockCode = normalizeCodePart(quadra);
  const lotCode = normalizeCodePart(lote).replace(/^L/, "");

  return `${enterpriseCode}${blockCode}${lotCode}`;
}

function enterpriseCodeFor(enterprise: string) {
  const codes: Record<string, string> = {
    "Jardins do Vale": "JDV",
    "Lagoa Bonita": "LAB",
    "Lavra do Ouro": "LDO",
    "Morada da Serra": "MDS",
    "Recanto do Pará": "RDP",
    "Reserva Alameda": "REA",
    "Veredas do Ouro": "VDO",
    "Vista Alegre": "VAL",
  };

  return codes[enterprise] ?? deriveEnterpriseCode(enterprise);
}

function deriveEnterpriseCode(enterprise: string) {
  const words = enterprise
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .split(/\s+/)
    .filter((word) => word && !["DA", "DE", "DO", "DAS", "DOS"].includes(word));
  const initials = words.map((word) => word[0]).join("");

  return (initials + words.join("")).replace(/[^A-Z0-9]/g, "").slice(0, 3).padEnd(3, "X");
}

function normalizeCodePart(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function guardianProtocol(seed: number) {
  return `GDN-${String(Math.max(seed, 1)).padStart(6, "0")}`;
}

function ordinalFor(source: string, offset = 0) {
  const total = Array.from(source).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return ((total + offset) % 999999) || 1;
}

function hasSpouse(status: string) {
  return status === "Casado" || status === "Casada" || status === "União estável";
}

function birthDateFromAge(ageLabel: string) {
  return EMPTY_FIELD;
}

function formatDate(date: Date) {
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

function money(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}




