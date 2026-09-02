// O VALOR QUE O OPERADOR DIGITA — lido como brasileiro, e não como JavaScript.
//
// ⚠️ ISTO JÁ COBRAVA R$ 1,85 NO LUGAR DE R$ 1.850,00. O campo de editar valor fazia
// `Number(texto.replace(",", "."))`: quem digita "1.850" (mil oitocentos e cinquenta, como se
// escreve em português) recebe 1.85, e o boleto sai com um real e oitenta e cinco. Pior, a
// edição não falha — ela funciona, com o número errado.
//
// ⚠️ E O FORMATO COMPLETO ERA IGNORADO EM SILÊNCIO. "2.102,58" virava "2.102.58", que é `NaN`; o
// código descartava valores não finitos, então a tela fechava o editor como se tivesse salvado e
// o valor continuava o antigo. Salvar sem salvar é pior do que recusar.
//
// A ambiguidade real é uma só: `1.850` pode ser milhar (pt-BR) ou decimal (en-US). Quem digita
// nesta tela escreve em português, e o desempate segue a regra da língua: ponto seguido de
// exatamente três dígitos é separador de milhar.

/**
 * O número que o texto digitado representa, em reais. `null` quando não dá para ler.
 *
 * ```
 * "2.102,58" → 2102.58      "1.850"  → 1850       "1850,5"  → 1850.5
 * "R$ 1.850" → 1850         "1850.5" → 1850.5     "abc"     → null
 * ```
 */
export function valorDigitado(texto: null | string | undefined): null | number {
  const limpo = String(texto ?? "")
    .replace(/r\$/gi, "")
    .replace(/\s/g, "")
    .trim();
  if (!limpo) return null;
  if (!/^\d[\d.,]*$/.test(limpo)) return null;

  let normalizado: string;
  if (limpo.includes(",")) {
    // Com vírgula não há dúvida: ela é o decimal e todo ponto é milhar.
    // Duas vírgulas não são um número.
    if ((limpo.match(/,/g) ?? []).length > 1) return null;
    normalizado = limpo.replace(/\./g, "").replace(",", ".");
  } else {
    const partes = limpo.split(".");
    // Um único ponto com algo diferente de três dígitos depois é decimal ("1850.5", "1850.55").
    // Com exatamente três, é milhar — e é a leitura de quem escreve em português.
    const ehMilhar = partes.length > 2 || (partes.length === 2 && partes[1]!.length === 3);
    normalizado = ehMilhar ? partes.join("") : limpo;
  }

  const n = Number(normalizado);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Centavos e nada mais: R$ 1,234 não existe, e deixar passar viraria arredondamento escondido.
  return Math.round(n * 100) / 100;
}

/** `2102.58` → `"2.102,58"`, para o campo abrir no mesmo formato que ele aceita. */
export function valorParaOCampo(valor: null | number | undefined): string {
  if (typeof valor !== "number" || !Number.isFinite(valor)) return "";
  return valor.toLocaleString("pt-BR", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}
