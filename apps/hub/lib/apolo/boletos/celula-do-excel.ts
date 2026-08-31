// O VALOR ÚTIL DE UMA CÉLULA DO EXCEL — o que o leitor da planilha recebe.
//
// ⚠️ `celula.value` NEM SEMPRE É O VALOR. O ExcelJS devolve objetos para os tipos ricos: fórmula
// vira `{ formula, result }`, texto formatado vira `{ richText: [...] }`, link vira
// `{ text, hyperlink }`. Passar qualquer um deles por `String()` produz `"[object Object]"`.
//
// ⚠️ E ISSO EMITIRIA BOLETO INDEVIDO. As observações que impedem a emissão ("PAGO ATÉ DEZ/26
// RETOMA JAN/27", "Não fazer") vivem em coluna solta e costumam vir em negrito ou em vermelho —
// exatamente as que o Excel guarda como `richText`. Se o texto virasse `"[object Object]"`, a
// regra de emissão não veria a marcação e o cliente que já pagou seria cobrado de novo.
//
// A cadeia de erro do Excel (`#REF!`, `#DIV/0!`) também chega como objeto, e ali o certo é NÃO
// devolver número nenhum: sem valor a linha cai em "sem-valor" e aparece na tela para conferência,
// em vez de virar uma cobrança de zero ou de lixo.
//
// ⚠️ E `celula.text` NÃO É UM CAMPO, É UM GETTER QUE PODE EXPLODIR. Medido no arquivo real de
// 31/08/2026: em célula mesclada e vazia o ExcelJS estoura com `Cannot read properties of null
// (reading 'toString')` — e todas as abas têm o título mesclado no topo. Ler `.text` de entrada,
// para todas as células, derrubava a planilha inteira antes de ler o primeiro cliente. Por isso
// ele é lido SÓ quando o valor cru não resolve, e sempre dentro de um `try`.

/** O molde da célula do ExcelJS, sem depender do pacote (que só existe no navegador). */
export type CelulaDoExcel = {
  result?: unknown;
  text?: unknown;
  type?: unknown;
  value?: unknown;
};

type Rico = { richText?: unknown[]; text?: unknown };

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !(v instanceof Date);
}

/**
 * O valor que o leitor da planilha deve enxergar: número, `Date`, string ou `null`.
 *
 * Nunca devolve objeto — é essa a garantia que impede o `"[object Object]"`.
 */
export function valorDaCelula(celula: CelulaDoExcel | null | undefined): Date | null | number | string {
  if (!celula) return null;
  return desembrulhar(celula.value, () => textoRenderizado(celula));
}

/** O `.text` da célula, que é um getter e pode estourar — ver a nota do topo. */
function textoRenderizado(celula: CelulaDoExcel): unknown {
  try {
    return celula.text;
  } catch {
    return null;
  }
}

function desembrulhar(
  bruto: unknown,
  textoDaCelula: () => unknown,
  profundidade = 0,
): Date | null | number | string {
  if (bruto === null || bruto === undefined) return textoSimples(textoDaCelula);
  if (bruto instanceof Date) return Number.isNaN(bruto.getTime()) ? null : bruto;
  if (typeof bruto === "number") return Number.isFinite(bruto) ? bruto : null;
  if (typeof bruto === "boolean") return String(bruto);
  if (typeof bruto === "string") return bruto;

  if (ehObjeto(bruto)) {
    // Guarda contra fórmula que aponta para fórmula, que aponta para fórmula…
    if (profundidade > 3) return textoSimples(textoDaCelula);

    // #REF!, #DIV/0!, #N/D — a célula não tem valor, e fingir que tem é pior.
    if ("error" in bruto) return null;

    // Fórmula: o resultado é o que interessa; sem ele, o texto já renderizado.
    if ("result" in bruto) return desembrulhar(bruto.result, textoDaCelula, profundidade + 1);

    // Texto formatado: junta os pedaços na ordem em que aparecem.
    const rico = bruto as Rico;
    if (Array.isArray(rico.richText)) {
      const junto = rico.richText
        .map((p) => (ehObjeto(p) && typeof p.text === "string" ? p.text : ""))
        .join("");
      return junto.trim() ? junto : textoSimples(textoDaCelula);
    }

    // Link, e qualquer outro embrulho que carregue `text`.
    if (typeof rico.text === "string") return rico.text;
  }

  return textoSimples(textoDaCelula);
}

function textoSimples(t: () => unknown): null | string {
  const v = t();
  if (typeof v !== "string") return null;
  return v.trim() ? v : null;
}
