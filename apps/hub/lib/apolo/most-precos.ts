// Tabela de precos da MOST (proposta "SEM FM" + contrato MST-0031/26).
//
// REGRA COMERCIAL REAL (contrato, Anexo A):
// - Faturamento Minimo Mensal = R$ 0,00 (item 2.1) -> paga-se so pelo que usa.
// - O enrichment e cobrado POR DATASET consultado, em reais. Os precos variam
//   de R$ 0,177 (a maioria) a R$ 14,62 (cheques devolvidos).
// - Os "10.000" da clausula 3.3.5 NAO sao um plano: sao um RATE LIMITER mensal
//   de PAGINAS PROCESSADAS, e valem apenas para as APIs de OCR (Content
//   Extraction, Classification, Generative, Fullreader, Vio, Multipage, Image
//   Properties, License Plate). E ajustavel por e-mail.
//
// Preco = R$ por consulta do dataset, por documento consultado.

export type PrecoDataset = {
  codigo: string;
  preco: number;
};

// Leitura documental (iOCR). RG e CNH fechada contam frente E verso = 2 imagens.
export const CUSTO_OCR_IMAGEM = 0.506; // OCR-100 mostQI Extraction
export const CUSTO_OCR_TIPIFICACAO = 0.11; // OCR-131 mostQI TYP (so tipifica)
export const RATE_LIMIT_OCR_MENSAL = 10_000; // paginas/mes, ajustavel

// Datasets sem preco publicado na proposta ficam de fora do mapa: a tela avisa
// em vez de fingir que o custo e zero.
const PF: Record<string, PrecoDataset> = {
  addresses_extended: { codigo: "B-DB-004-F", preco: 0.177 },
  auth_score_gold: { codigo: "Q-DB-128-F", preco: 3.069 },
  basic_data: { codigo: "B-DB-001-F", preco: 0.177 },
  business_relationships: { codigo: "B-DB-003-F", preco: 0.177 },
  class_organization: { codigo: "B-DB-014-F", preco: 0.177 },
  cnh_v1: { codigo: "DDI-001", preco: 3.157 },
  cnh_v2: { codigo: "DDI-002", preco: 5.554 },
  cnh_v3: { codigo: "DDI-003", preco: 7.015 },
  consulta_cheque_pf: { codigo: "IC-DB-105-F", preco: 14.615 },
  demographic_data: { codigo: "B-DB-010-F", preco: 0.177 },
  electoral_donors: { codigo: "B-DB-021-F", preco: 0.177 },
  emails_extended: { codigo: "B-DB-008-F", preco: 0.177 },
  financial_data: { codigo: "B-DB-023-F", preco: 0.177 },
  flags_and_features: { codigo: "B-DB-029-F", preco: 0.263 },
  interests_and_behaviors: { codigo: "B-DB-030-F", preco: 0.177 },
  kyc: { codigo: "B-DB-016-F", preco: 0.177 },
  media_profile_and_exposure: { codigo: "B-DB-031-F", preco: 0.263 },
  occupation_data: { codigo: "B-DB-012-F", preco: 0.177 },
  ondemand_administrative_sanctions: { codigo: "B-RT-070-F", preco: 0.205 },
  ondemand_cert_labor_debt_absence: { codigo: "B-RT-073-F", preco: 0.263 },
  ondemand_comprot_processes: { codigo: "B-RT-085-F", preco: 0.177 },
  ondemand_nada_consta: { codigo: "B-RT-067-F", preco: 0.177 },
  ondemand_pc_antecedente_by_state: { codigo: "B-RT-068-F", preco: 0.177 },
  ondemand_pf_antecedente: { codigo: "B-RT-064-F", preco: 0.177 },
  ondemand_restituicao: { codigo: "B-RT-066-F", preco: 0.177 },
  ondemand_rf_status: { codigo: "B-RT-048-F", preco: 0.177 },
  online_ads: { codigo: "B-DB-028-F", preco: 0.177 },
  online_presence: { codigo: "B-DB-026-F", preco: 0.177 },
  pf_gold: { codigo: "Q-DB-118-F", preco: 11.628 },
  pf_gold_bestinfo: { codigo: "Q-DB-119-F", preco: 1.511 },
  pf_gold_negative_flag: { codigo: "Q-DB-120-F", preco: 3.476 },
  pf_gold_negative_info: { codigo: "Q-DB-121-F", preco: 4.645 },
  pf_gold_score: { codigo: "Q-DB-122-F", preco: 7.045 },
  phones_extended: { codigo: "B-DB-006-F", preco: 0.177 },
  processes: { codigo: "B-DB-019-F", preco: 0.205 },
  profession_data: { codigo: "B-DB-013-F", preco: 0.177 },
  related_people: { codigo: "B-DB-002-F", preco: 0.177 },
  related_people_addresses: { codigo: "B-DB-005-F", preco: 0.177 },
  related_people_emails: { codigo: "B-DB-009-F", preco: 0.177 },
  related_people_phones: { codigo: "B-DB-007-F", preco: 0.177 },
  social_assistance: { codigo: "B-DB-011-F", preco: 0.177 },
};

const PJ: Record<string, PrecoDataset> = {
  activity_indicators: { codigo: "B-DB-037-J", preco: 0.177 },
  addresses_extended: { codigo: "B-DB-004-J", preco: 0.177 },
  basic_data: { codigo: "B-DB-001-J", preco: 0.177 },
  consulta_cheque_pj: { codigo: "IC-DB-105-J", preco: 14.615 },
  economic_group_full: { codigo: "B-DB-033-J", preco: 0.177 },
  economic_group_kyc: { codigo: "B-DB-040-J", preco: 1.198 },
  electoral_donors: { codigo: "B-DB-021-J", preco: 0.177 },
  emails_extended: { codigo: "B-DB-008-J", preco: 0.177 },
  interests_and_behaviors: { codigo: "B-DB-030-J", preco: 0.177 },
  kyc: { codigo: "B-DB-016-J", preco: 0.177 },
  media_profile_and_exposure: { codigo: "B-DB-031-J", preco: 0.263 },
  ondemand_cert_labor_debt_absence: { codigo: "B-RT-073-J", preco: 0.263 },
  ondemand_comprot_processes: { codigo: "B-RT-085-J", preco: 0.177 },
  ondemand_fgts: { codigo: "B-RT-057-J", preco: 0.177 },
  ondemand_ibama_cert_negativa: { codigo: "B-RT-077-J", preco: 0.177 },
  ondemand_legal_representative: { codigo: "B-RT-051-J", preco: 0.177 },
  ondemand_municipal_registration: { codigo: "B-RT-082-J", preco: 0.177 },
  ondemand_pgfn: { codigo: "B-RT-074-J", preco: 0.263 },
  ondemand_rf_qsa: { codigo: "B-RT-050-J", preco: 0.177 },
  ondemand_rf_status: { codigo: "B-RT-048-J", preco: 0.177 },
  ondemand_sintegra: { codigo: "B-RT-054-J", preco: 0.263 },
  online_ads: { codigo: "B-DB-028-J", preco: 0.177 },
  owners_kyc: { codigo: "B-DB-039-J", preco: 0.263 },
  owners_lawsuits: { codigo: "B-DB-043-J", preco: 0.38 },
  phones_extended: { codigo: "B-DB-006-J", preco: 0.177 },
  pj_gold: { codigo: "Q-DB-123-J", preco: 7.81 },
  pj_gold_bestinfo: { codigo: "Q-DB-124-J", preco: 3.782 },
  pj_gold_negative_flag: { codigo: "Q-DB-125-J", preco: 4.522 },
  pj_gold_negative_info: { codigo: "Q-DB-126-J", preco: 7.568 },
  pj_gold_score: { codigo: "Q-DB-127-J", preco: 9.69 },
  processes: { codigo: "B-DB-019-J", preco: 0.205 },
  related_people_addresses: { codigo: "B-DB-005-J", preco: 0.177 },
  related_people_emails: { codigo: "B-DB-009-J", preco: 0.177 },
  related_people_phones: { codigo: "B-DB-007-J", preco: 0.177 },
  relationships: { codigo: "B-DB-003-J", preco: 0.177 },
};

export function precoDataset(
  persona: "pf" | "pj",
  dataset: string,
): PrecoDataset | null {
  return (persona === "pj" ? PJ : PF)[dataset] ?? null;
}

// Acima disso o dataset merece pensar duas vezes antes de virar automatico.
export const PRECO_CARO = 1;

export function reais(valor: number): string {
  return valor.toLocaleString("pt-BR", {
    currency: "BRL",
    minimumFractionDigits: 2,
    style: "currency",
  });
}
