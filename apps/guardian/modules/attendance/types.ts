export type AttendancePriority = "Crítica" | "Alta" | "Média" | "Baixa";
export type WorkflowStage =
  | "Novo atraso"
  | "Primeiro contato"
  | "Sem retorno"
  | "Em negociação"
  | "Promessa realizada"
  | "Aguardando pagamento"
  | "Pago"
  | "Quebra de promessa"
  | "Crítico"
  | "Jurídico"
  | "Distrato/Evasão";

export type AgreementStatus =
  | "Em negociação"
  | "Formalizando"
  | "Ativo"
  | "Pago"
  | "Quebrado"
  | "Reativado"
  | "Cancelado";

export type AgreementRisk = "Baixo" | "Moderado" | "Alto" | "Crítico";

export type PaymentPromiseStatus =
  | "Promessa realizada"
  | "Aguardando pagamento"
  | "Cumprida"
  | "Quebrada"
  | "Reagendada"
  | "Cancelada";

export type CommitmentType = "Promessa de pagamento" | "Acordo";

export type TimelineEventType =
  | "Ligação realizada"
  | "WhatsApp enviado"
  | "Promessa de pagamento"
  | "Acordo gerado"
  | "Quebra de acordo"
  | "Boleto C2X"
  | "Atualização cadastral"
  | "Observação operacional"
  | "Alteração de risco"
  | "Acionamento jurídico"
  | "Interação da IA";

export type TimelineEventStatus =
  | "Realizado"
  | "Enviado"
  | "Prometido"
  | "Gerado"
  | "Quebrado"
  | "Atualizado"
  | "Registrado"
  | "Elevado"
  | "Jurídico"
  | "IA";

export type PortfolioUnit = {
  id: string;
  empreendimento: string;
  unidadeLote: string;
  quadra: string;
  lote: string;
  area: string;
  matricula: string;
  valorTabela: string;
  statusVenda: string;
  imobiliariaCorretor: string;
};

export type QueueClient = {
  id: string;
  nome: string;
  atrasoDias: number;
  saldoDevedor: string;
  prioridade: AttendancePriority;
  scoreRisco: number;
  responsavel: string;
  cpf: string;
  segmento: string;
  dados360: {
    tipoPessoa: "PF";
    idade: string;
    sexo: string;
    estadoCivil: string;
    profissao: string;
    faixaSalarial: string;
    cidade: string;
    telefone: string;
    nascimento: string;
    relacionamento: string;
    conjuge: string;
    cpfConjuge: string;
    email: string;
    escolaridade: string;
    naturalidade: string;
    nacionalidade: string;
  };
  carteira: {
    empreendimento: string;
    imobiliariaCorretor: string;
    unidades: PortfolioUnit[];
  };
  parcelas: {
    vencidas: number;
    abertas: number;
    ultimaParcela: string;
    proximaAcao: string;
  };
  workflow: {
    stage: WorkflowStage;
    updatedAt: string;
    owner: string;
    nextAction: string;
    history: {
      id: string;
      from: WorkflowStage | "Entrada";
      to: WorkflowStage;
      changedAt: string;
      operator: string;
      reason: string;
    }[];
  };
  agreement: {
    id: string;
    client: string;
    enterprise: string;
    unit: string;
    originalDebt: string;
    discount: string;
    negotiatedValue: string;
    entry: string;
    installmentsCount: number;
    recoveredValue: string;
    breakRate: number;
    recoveryRate: number;
    status: AgreementStatus;
    risk: AgreementRisk;
    operator: string;
    aiSuggestion: {
      composition: string;
      breakChance: number;
      operationalRisk: AgreementRisk;
      nextAction: string;
    };
    dueDates: {
      id: string;
      label: string;
      dueDate: string;
      amount: string;
      status: "Pago" | "A vencer" | "Vencido" | "Reprogramado";
    }[];
  };
  commitments: (
    | {
        id: string;
        type: "Promessa de pagamento";
        client: string;
        enterprise: string;
        unitCode: string;
        unitLabel: string;
        relatedInstallments: string;
        promisedValue: string;
        promisedDate: string;
        contactChannel: string;
        operator: string;
        note: string;
        protocol: string;
        status: PaymentPromiseStatus;
        history: {
          id: string;
          protocol: string;
          action: string;
          occurredAt: string;
          operator: string;
          description: string;
        }[];
      }
    | {
        id: string;
        type: "Acordo";
        client: string;
        enterprise: string;
        unitCode: string;
        unitLabel: string;
        includedInstallments: string;
        originalValue: string;
        discount: string;
        negotiatedValue: string;
        entry: string;
        entryDueDate: string;
        installmentsCount: number;
        installmentValue: string;
        firstDueDate: string;
        operator: string;
        note: string;
        protocol: string;
        status: AgreementStatus;
        risk: AgreementRisk;
        history: {
          id: string;
          protocol: string;
          action: string;
          occurredAt: string;
          operator: string;
          description: string;
        }[];
      }
  )[];
  timeline: {
    actionType?: string;
    id: string;
    protocol?: string;
    type: TimelineEventType;
    title: string;
    description: string;
    occurredAt: string;
    operator: string;
    status: TimelineEventStatus;
    unitCode?: string;
    unitLabel?: string;
  }[];
  aiSuggestion: string;
};

export type OperationalTimelineEvent = QueueClient["timeline"][number];
