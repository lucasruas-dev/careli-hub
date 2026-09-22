// A ETAPA SEGUE O FATO, E NÃO O RÓTULO QUE O LEGADO MANDOU.
//
// Lucas, 21/09/2026, com três prints da tela de Venda do VOC: *"esse foi faturado no dia 17"* e,
// quando eu mostrei que a data estava gravada no Panteon: *"se tem no panteon tinha que está
// refletindo aqui. porque não está?"*.
//
// ⚠️ SÃO DOIS CAMPOS, E A TELA LIA O OUTRO. `hercules_propostas.data_faturamento` guarda o FATO (o
// dia em que a venda faturou) e `etapa`/`etapa_c2x` guarda o RÓTULO que a carga do C2X trouxe. As
// duas coisas chegam por caminhos diferentes, e o rótulo para de chegar quando a linha deixa de ser
// recarregada. Resultado medido em 21/09/2026: 59 propostas em `assinatura` e 1 em `contrato` com
// data de faturamento preenchida, a mais antiga de 22/09/2025.
//
// ⚠️ OS TRÊS CASOS DO PRINT, medidos lado a lado com o legado: VOC0719 (Erilene), VOC0607 (Adilson)
// e VOC0501 (Natanael) faturaram em 17/09/2026 — no C2X os três estão no estágio 4 (Faturado) —, e
// a tela do Panteon mostrava "Em assinatura" nos três. As linhas tinham sido tocadas pela última vez
// em 03 e 13/09, antes do faturamento. A conta fechava: o legado contava 86 faturados no VOC e a
// tela mostrava 83.
//
// ⚠️ E SÓ DATA NO PASSADO CONTA. Faturamento agendado para a semana que vem é promessa, não fato:
// antecipá-lo na tela faria o coordenador vender um lote que ainda não faturou, e é o oposto do que
// esta régua existe para fazer.
//
// ⚠️ ISTO NÃO ESCREVE NADA. É leitura: a coluna `etapa` continua como está no banco, e no dia em que
// a carga voltar a rodar ela concorda com esta régua em vez de brigar com ela.

/** As etapas que a data de faturamento pode promover. `cancelado` e `distrato` nunca. */
const PROMOVIVEIS = new Set(["assinatura", "contrato", "proposta", "reservado"]);

/**
 * A etapa que vale, olhando o fato.
 *
 * Devolve `faturado` quando existe data de faturamento no passado e a etapa gravada é um passo
 * ANTERIOR do caminho. Nos outros casos devolve a etapa como está — inclusive em `cancelado` e
 * `distrato`, que são saídas: uma venda desfeita não volta a faturar porque tem data antiga.
 */
export function etapaPeloFato(
  etapa: string,
  dataFaturamento: null | string | undefined,
  hoje: Date,
): string {
  if (!PROMOVIVEIS.has(etapa)) return etapa;

  const dia = String(dataFaturamento ?? "").trim();
  if (!dia) return etapa;

  // A coluna é `date` no banco, e chega como `AAAA-MM-DD`. Comparar texto com texto evita fuso:
  // `new Date("2026-09-21")` nasce em UTC e, no horário de Brasília, viraria o dia 20.
  const hojeTexto = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(
    hoje.getDate(),
  ).padStart(2, "0")}`;
  const diaSo = dia.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(diaSo)) return etapa;

  return diaSo <= hojeTexto ? "faturado" : etapa;
}
