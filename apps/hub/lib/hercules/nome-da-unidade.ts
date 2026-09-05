// COMO A UNIDADE SE ESCREVE — "Quadra 12 · Lote 06".
//
// ⚠️ UM LUGAR SÓ, PORQUE ESTE TEXTO CIRCULA. Ele vai no WhatsApp da reserva, no WhatsApp da
// proposta e no PDF que o comprador guarda. Três grafias da mesma unidade ("Q12 L06", "1206",
// "Quadra 12 Lote 06") na mesma venda fazem o corretor conferir se está falando do mesmo lote — e
// foi assim que a rota da reserva ganhou a primeira versão desta função, privada.
//
// ⚠️ O CÓDIGO É O ÚLTIMO RECURSO, e ele é decomposto quando dá. Os empreendimentos gravam
// `JDG0617` (sigla + quadra + lote) e nem todos preencheram as colunas `quadra`/`lote`: sem esta
// leitura, o corretor receberia "JDG0617", que é o nosso vocabulário, não o dele.

export type UnidadeParaEscrever = {
  codigo: string;
  lote: null | string;
  quadra: null | string;
};

/** `JDG0617` → quadra 06, lote 17. Duas letras de sigla ou quatro, sempre 2+2 no fim. */
const CODIGO_COM_QUADRA_E_LOTE = /^([A-Za-z]{2,4})(\d{2})(\d{2})$/;

export function nomeDaUnidade(unidade: UnidadeParaEscrever): string {
  if (unidade.quadra && unidade.lote) return `Quadra ${unidade.quadra} · Lote ${unidade.lote}`;

  const padrao = CODIGO_COM_QUADRA_E_LOTE.exec(String(unidade.codigo ?? "").trim());
  if (padrao) return `Quadra ${padrao[2]} · Lote ${padrao[3]}`;

  return String(unidade.codigo ?? "").trim();
}
