import { hadesMockClients } from "@/modules/guardian/hadesMockData";
import type { HadesMockClient } from "@/modules/guardian/hadesMockData";
import type { QueueClient } from "@/modules/guardian/attendance/types";

const EMPTY_FIELD = "-";
const EMPTY_AGREEMENT_STATUS = EMPTY_FIELD as QueueClient["agreement"]["status"];
const EMPTY_AGREEMENT_RISK = EMPTY_FIELD as QueueClient["agreement"]["risk"];

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
    const agreementUnit = units[0] ?? mainUnit;
    const agreement = buildAgreement(client, agreementUnit);
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
    status: EMPTY_AGREEMENT_STATUS,
    risk: EMPTY_AGREEMENT_RISK,
    operator: client.responsavel,
    aiSuggestion: {
      composition: EMPTY_FIELD,
      breakChance: 0,
      operationalRisk: EMPTY_AGREEMENT_RISK,
      nextAction: EMPTY_FIELD,
    },
    dueDates: [],
  };
}

function buildCommitments(
  _client: HadesMockClient,
  _units: QueueClient["carteira"]["unidades"],
  _agreement: QueueClient["agreement"]
): QueueClient["commitments"] {
  void _client;
  void _units;
  void _agreement;

  return [];
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
  _client: HadesMockClient,
  _workflow: QueueClient["workflow"],
  _agreement: QueueClient["agreement"],
  _commitments: QueueClient["commitments"]
): QueueClient["timeline"] {
  void _client;
  void _workflow;
  void _agreement;
  void _commitments;

  return [];
}

function workflowStageForClient(client: HadesMockClient): QueueClient["workflow"]["stage"] {
  if (client.atrasoDias >= 91) return "Jurídico";
  if (client.status === "Regularizado") return "Acordo";
  if (client.status === "A vencer") return "A acionar";
  if (client.status === "Proposta enviada") return "Promessa de pagamento";
  if (client.status === "Aguardando retorno") return "Contato";
  if (client.status === "Contato programado") return "Contato";
  if (client.status === "Em negociação") return "Negociação";
  if (client.status === "Escalado") {
    return "Quebra";
  }

  return client.atrasoDias >= 3 ? "Contato" : "A acionar";
}

function buildSuggestion() {
  return EMPTY_FIELD;
}

function nextActionForStatus(_status: string, _priority: QueueClient["prioridade"]) {
  void _status;
  void _priority;

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

function birthDateFromAge(_ageLabel: string) {
  void _ageLabel;

  return EMPTY_FIELD;
}

function money(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}




