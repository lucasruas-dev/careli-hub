// Tabela de precos da MOST, nos TRES planos propostos (10/jul/2026).
//
// O preco e sempre POR CONSULTA (por dataset consultado, ou por imagem lida no
// iOCR). O que muda entre os planos e o valor unitario e o Faturamento Minimo
// Mensal (FM): abaixo do FM, paga-se o FM mesmo assim, e o saldo NAO acumula
// para o mes seguinte (contrato MST-0031/26, Anexo A, item 3.2.1.1).
//
// ⚠️ O desconto NAO e uniforme:
//   - Enriquecimento (datasets): -9% no FM 1.500, -17,5% no FM 5.000.
//   - Leitura de documentos (iOCR) e IA generativa: -32% a -68%.
//   - Facematch 1:N (OCR-104) fica MAIS CARO nos planos com FM.
//
// Precos extraidos dos PDFs das propostas, nao digitados a mao.

export type PlanoId = "fm_1500" | "fm_5000" | "sem_fm";

export type Plano = {
  // Faturamento Minimo Mensal, em reais.
  fm: number;
  id: PlanoId;
  label: string;
  // Indice na tupla de precos da TABELA.
  indice: number;
};

export const PLANOS: Plano[] = [
  { fm: 0, id: "sem_fm", indice: 0, label: "Sem faturamento mínimo" },
  { fm: 1500, id: "fm_1500", indice: 1, label: "FM R$ 1.500" },
  { fm: 5000, id: "fm_5000", indice: 2, label: "FM R$ 5.000" },
];

export const PLANO_ATUAL: PlanoId = "sem_fm";

export type PrecoDataset = {
  codigo: string;
  preco: number;
};

// codigo -> [sem FM, FM 1.500, FM 5.000]
const TABELA: Record<string, [number, number, number]> = {
  "B-DB-001-F": [0.177, 0.161, 0.146],
  "B-DB-001-J": [0.177, 0.161, 0.146],
  "B-DB-002-F": [0.177, 0.161, 0.146],
  "B-DB-003-F": [0.177, 0.161, 0.146],
  "B-DB-003-J": [0.177, 0.161, 0.146],
  "B-DB-004-F": [0.177, 0.161, 0.146],
  "B-DB-004-J": [0.177, 0.161, 0.146],
  "B-DB-005-F": [0.177, 0.161, 0.146],
  "B-DB-006-F": [0.177, 0.161, 0.146],
  "B-DB-006-J": [0.177, 0.161, 0.146],
  "B-DB-007-F": [0.177, 0.161, 0.146],
  "B-DB-007-J": [0.177, 0.161, 0.146],
  "B-DB-008-F": [0.177, 0.161, 0.146],
  "B-DB-008-J": [0.177, 0.161, 0.146],
  "B-DB-009-F": [0.177, 0.161, 0.146],
  "B-DB-009-J": [0.177, 0.161, 0.146],
  "B-DB-010-F": [0.177, 0.161, 0.146],
  "B-DB-011-F": [0.177, 0.161, 0.146],
  "B-DB-012-F": [0.177, 0.161, 0.146],
  "B-DB-013-F": [0.177, 0.161, 0.146],
  "B-DB-014-F": [0.177, 0.161, 0.146],
  "B-DB-016-F": [0.177, 0.161, 0.146],
  "B-DB-016-J": [0.177, 0.161, 0.146],
  "B-DB-019-F": [0.205, 0.186, 0.169],
  "B-DB-019-J": [0.205, 0.186, 0.169],
  "B-DB-021-F": [0.177, 0.161, 0.146],
  "B-DB-021-J": [0.177, 0.161, 0.146],
  "B-DB-023-F": [0.177, 0.161, 0.146],
  "B-DB-026-F": [0.177, 0.161, 0.146],
  "B-DB-028-F": [0.177, 0.161, 0.146],
  "B-DB-028-J": [0.177, 0.161, 0.146],
  "B-DB-029-F": [0.263, 0.239, 0.217],
  "B-DB-030-F": [0.177, 0.161, 0.146],
  "B-DB-030-J": [0.177, 0.161, 0.146],
  "B-DB-031-F": [0.263, 0.239, 0.217],
  "B-DB-031-J": [0.263, 0.239, 0.217],
  "B-DB-033-J": [0.177, 0.161, 0.146],
  "B-DB-037-J": [0.177, 0.161, 0.146],
  "B-DB-039-J": [0.263, 0.239, 0.217],
  "B-DB-040-J": [1.198, 1.09, 0.99],
  "B-DB-043-J": [0.38, 0.345, 0.314],
  "B-DB-044": [0.177, 0.161, 0.146],
  "B-DB-088-F": [0.468, 0.425, 0.387],
  "B-DB-088-J": [0.601, 0.546, 0.496],
  "B-DB-131-J": [0.354, 0.322, 0.293],
  "B-RT-048-F": [0.177, 0.161, 0.146],
  "B-RT-048-J": [0.177, 0.161, 0.146],
  "B-RT-050-J": [0.177, 0.161, 0.146],
  "B-RT-051-J": [0.177, 0.161, 0.146],
  "B-RT-054-J": [0.263, 0.239, 0.217],
  "B-RT-057-J": [0.177, 0.161, 0.146],
  "B-RT-064-F": [0.177, 0.161, 0.146],
  "B-RT-066-F": [0.177, 0.161, 0.146],
  "B-RT-067-F": [0.177, 0.161, 0.146],
  "B-RT-068-F": [0.177, 0.161, 0.146],
  "B-RT-070-F": [0.205, 0.186, 0.169],
  "B-RT-073-F": [0.263, 0.239, 0.217],
  "B-RT-073-J": [0.263, 0.239, 0.217],
  "B-RT-074-J": [0.263, 0.239, 0.217],
  "B-RT-077-J": [0.177, 0.161, 0.146],
  "B-RT-082-J": [0.177, 0.161, 0.146],
  "B-RT-085-F": [0.177, 0.161, 0.146],
  "B-RT-085-J": [0.177, 0.161, 0.146],
  "DDI-001": [3.157, 2.87, 2.609],
  "DDI-002": [5.554, 5.049, 4.59],
  "DDI-003": [7.015, 6.378, 5.798],
  "DDV-001": [0.839, 0.57, 0.559],
  "DDV-002": [1.754, 1.594, 1.449],
  "DDV-003": [1.462, 1.329, 1.208],
  "DDV-004": [1.281, 0.87, 0.853],
  "DDV-006": [2.098, 1.425, 1.397],
  "DDV-009": [1.462, 1.329, 1.208],
  "DDV-010": [1.462, 1.329, 1.208],
  "DDV-011": [2.572, 2.338, 2.126],
  "DDV-012": [3.157, 2.87, 2.609],
  "GEN-001": [0.58, 0.4, 0.189],
  "GEN-002": [1.44, 0.98, 0.467],
  "IC-DB-105-F": [14.615, 13.287, 12.079],
  "IC-DB-105-J": [14.615, 13.287, 12.079],
  "OCR-100": [0.506, 0.344, 0.323],
  "OCR-101": [0.166, 0.113, 0.11],
  "OCR-102": [0.368, 0.25, 0.238],
  "OCR-104": [0.11, 0.135, 0.131],
  "OCR-105": [0.45, 0.3, 0.27],
  "OCR-112-F": [0.177, 0.161, 0.146],
  "OCR-113-J": [1.081, 0.982, 0.893],
  "OCR-114-F": [0.241, 0.219, 0.199],
  "OCR-120": [0.442, 0.3, 0.255],
  "OCR-123": [0.221, 0.15, 0.128],
  "OCR-124": [0.298, 0.203, 0.198],
  "OCR-127": [0.279, 0.19, 0.161],
  "OCR-131": [0.11, 0.075, 0.075],
  "Q-DB-118-F": [11.628, 10.571, 9.61],
  "Q-DB-119-F": [1.511, 1.374, 1.249],
  "Q-DB-120-F": [3.476, 3.16, 2.872],
  "Q-DB-121-F": [4.645, 4.223, 3.839],
  "Q-DB-122-F": [7.045, 6.404, 5.822],
  "Q-DB-123-J": [7.81, 7.1, 6.455],
  "Q-DB-124-J": [3.782, 3.439, 3.126],
  "Q-DB-125-J": [4.522, 4.111, 3.737],
  "Q-DB-126-J": [7.568, 6.88, 6.254],
  "Q-DB-127-J": [9.69, 8.809, 8.008],
  "Q-DB-128-F": [3.069, 2.79, 2.537],
  "RPA-001": [206.12, 140.0, 140.0],
  "RPA-002": [0.022, 0.015, 0.015],
  "S-RT-089-F": [3.71, 2.52, 2.47],
};

const CODIGO_PF: Record<string, string> = {
  addresses_extended: "B-DB-004-F",
  auth_score_gold: "Q-DB-128-F",
  basic_data: "B-DB-001-F",
  business_relationships: "B-DB-003-F",
  class_organization: "B-DB-014-F",
  cnh_v1: "DDI-001",
  cnh_v2: "DDI-002",
  cnh_v3: "DDI-003",
  consulta_cheque_pf: "IC-DB-105-F",
  demographic_data: "B-DB-010-F",
  electoral_donors: "B-DB-021-F",
  emails_extended: "B-DB-008-F",
  financial_data: "B-DB-023-F",
  flags_and_features: "B-DB-029-F",
  interests_and_behaviors: "B-DB-030-F",
  kyc: "B-DB-016-F",
  media_profile_and_exposure: "B-DB-031-F",
  occupation_data: "B-DB-012-F",
  ondemand_administrative_sanctions: "B-RT-070-F",
  ondemand_cert_labor_debt_absence: "B-RT-073-F",
  ondemand_comprot_processes: "B-RT-085-F",
  ondemand_nada_consta: "B-RT-067-F",
  ondemand_pc_antecedente_by_state: "B-RT-068-F",
  ondemand_pf_antecedente: "B-RT-064-F",
  ondemand_restituicao: "B-RT-066-F",
  ondemand_rf_status: "B-RT-048-F",
  online_ads: "B-DB-028-F",
  online_presence: "B-DB-026-F",
  pf_gold: "Q-DB-118-F",
  pf_gold_bestinfo: "Q-DB-119-F",
  pf_gold_negative_flag: "Q-DB-120-F",
  pf_gold_negative_info: "Q-DB-121-F",
  pf_gold_score: "Q-DB-122-F",
  phones_extended: "B-DB-006-F",
  processes: "B-DB-019-F",
  profession_data: "B-DB-013-F",
  related_people: "B-DB-002-F",
  related_people_addresses: "B-DB-005-F",
  related_people_emails: "B-DB-009-F",
  related_people_phones: "B-DB-007-F",
  social_assistance: "B-DB-011-F",
};

const CODIGO_PJ: Record<string, string> = {
  activity_indicators: "B-DB-037-J",
  addresses_extended: "B-DB-004-J",
  basic_data: "B-DB-001-J",
  consulta_cheque_pj: "IC-DB-105-J",
  economic_group_full: "B-DB-033-J",
  economic_group_kyc: "B-DB-040-J",
  electoral_donors: "B-DB-021-J",
  emails_extended: "B-DB-008-J",
  interests_and_behaviors: "B-DB-030-J",
  kyc: "B-DB-016-J",
  media_profile_and_exposure: "B-DB-031-J",
  ondemand_cert_labor_debt_absence: "B-RT-073-J",
  ondemand_comprot_processes: "B-RT-085-J",
  ondemand_fgts: "B-RT-057-J",
  ondemand_ibama_cert_negativa: "B-RT-077-J",
  ondemand_legal_representative: "B-RT-051-J",
  ondemand_municipal_registration: "B-RT-082-J",
  ondemand_pgfn: "B-RT-074-J",
  ondemand_rf_qsa: "B-RT-050-J",
  ondemand_rf_status: "B-RT-048-J",
  ondemand_sintegra: "B-RT-054-J",
  online_ads: "B-DB-028-J",
  owners_kyc: "B-DB-039-J",
  owners_lawsuits: "B-DB-043-J",
  phones_extended: "B-DB-006-J",
  pj_gold: "Q-DB-123-J",
  pj_gold_bestinfo: "Q-DB-124-J",
  pj_gold_negative_flag: "Q-DB-125-J",
  pj_gold_negative_info: "Q-DB-126-J",
  pj_gold_score: "Q-DB-127-J",
  processes: "B-DB-019-J",
  related_people_addresses: "B-DB-005-J",
  related_people_emails: "B-DB-009-J",
  related_people_phones: "B-DB-007-J",
  relationships: "B-DB-003-J",
};

function indiceDo(plano: PlanoId): number {
  return PLANOS.find((item) => item.id === plano)?.indice ?? 0;
}

function precoDoCodigo(codigo: string, plano: PlanoId): number | null {
  const linha = TABELA[codigo];
  return linha ? (linha[indiceDo(plano)] ?? null) : null;
}

export function precoDataset(
  persona: "pf" | "pj",
  dataset: string,
  plano: PlanoId = PLANO_ATUAL,
): PrecoDataset | null {
  const codigo = (persona === "pj" ? CODIGO_PJ : CODIGO_PF)[dataset];
  if (!codigo) return null;
  const preco = precoDoCodigo(codigo, plano);
  return preco === null ? null : { codigo, preco };
}

// Leitura documental (iOCR). RG e CNH fechada contam frente E verso.
export function custoOcrImagem(plano: PlanoId = PLANO_ATUAL): number {
  return precoDoCodigo("OCR-100", plano) ?? 0;
}

// Teto mensal de paginas processadas pelas APIs de OCR (clausula 3.3.5).
// Ajustavel por e-mail. Nao se aplica ao enriquecimento.
export const RATE_LIMIT_OCR_MENSAL = 10_000;

// Acima disso o dataset merece pensar duas vezes antes de virar automatico.
export const PRECO_CARO = 1;

// A fatura do mes: nunca abaixo do faturamento minimo do plano.
export function faturaMensal(custoConsumido: number, plano: PlanoId): number {
  const fm = PLANOS.find((item) => item.id === plano)?.fm ?? 0;
  return Math.max(fm, custoConsumido);
}

export function reais(valor: number): string {
  return valor.toLocaleString("pt-BR", {
    currency: "BRL",
    minimumFractionDigits: 2,
    style: "currency",
  });
}
