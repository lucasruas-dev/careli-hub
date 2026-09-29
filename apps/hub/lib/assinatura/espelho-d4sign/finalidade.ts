import type { FinalidadeDoEnvelope } from "../tipos";

// O QUE UM ENVIO DO C2X ASSINA, PELO `contract_signatures.contract_type` — puro.
//
// ⚠️ ESCRITA DEPOIS DE MEDIR, COMO O PLANO MANDA (F3, "escrita depois de o ensaio listar os
// `contract_type` encontrados"). Medido no C2X em 28/09/2026, só SELECT, dentro de transação READ ONLY:
// dos 2.239 envios com `send_document_signature = 1`, TODOS têm `contract_type = 'default'` (nenhum
// nulo, nenhum outro valor). É o contrato do pedido (`acquisition_request_contracts`), o contrato da
// venda: por isso `default → contrato`.
//
// ⚠️ TIPO FORA DA LISTA VIRA `null`, NUNCA UM PALPITE. `finalidade` nula não entra na leitura única, não
// move card e não grava `data_assinatura` (comentário da coluna na 0195). Se o C2X passar a mandar
// distrato ou cessão para a D4Sign com outro `contract_type`, o relatório do espelho conta o tipo novo
// em `finalidadeNaoMapeada` e a linha fica parada até alguém escrever o mapeamento aqui. Chutar
// "contrato" para um distrato assinado era o bug que a coluna existe para matar (0.13 e 0.22 do plano).
export const FINALIDADE_POR_TIPO_DO_C2X: Readonly<Record<string, FinalidadeDoEnvelope>> = {
  default: "contrato",
};

/** A finalidade de um `contract_type` do C2X, ou `null` quando o tipo não foi mapeado. */
export function finalidadeDoTipoDoC2x(tipo: null | string | undefined): FinalidadeDoEnvelope | null {
  const chave = String(tipo ?? "").trim().toLowerCase();
  if (!chave) return null;
  return Object.prototype.hasOwnProperty.call(FINALIDADE_POR_TIPO_DO_C2X, chave)
    ? (FINALIDADE_POR_TIPO_DO_C2X[chave] ?? null)
    : null;
}
