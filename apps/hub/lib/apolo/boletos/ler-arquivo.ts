import { valorDaCelula } from "./celula-do-excel";
import { type AbaLida, lerAba } from "./ler-planilha";

// LER O ARQUIVO DO ADMINISTRATIVO NO NAVEGADOR — o mesmo caminho para as duas telas que o abrem.
//
// ⚠️ NO NAVEGADOR DE PROPÓSITO. O arquivo tem nome, telefone e valor de ~200 pessoas; lendo aqui,
// ele nunca sobe para servidor nenhum. O que viaja para a rota de emissão são as linhas do
// empreendimento que se vai emitir, e só na hora de emitir.
//
// ⚠️ `exceljs` ENTRA POR IMPORT DINÂMICO. São ~900 KB, e nenhuma das duas telas precisa dele até
// alguém escolher um arquivo — no primeiro carregamento, o custo é zero.

export type LeituraDoArquivo = {
  abas: AbaLida[];
  ignoradas: { aba: string; motivo: string }[];
};

/**
 * Lê a planilha mensal e devolve uma `AbaLida` por empreendimento.
 *
 * ⚠️ A ABA DE ÍNDICES NÃO É CARTEIRA. A primeira aba do arquivo ("ìndice acum parc anual dez24" —
 * com o acento invertido mesmo) guarda os percentuais de reajuste e nenhum cliente. Sem esta
 * exclusão ela apareceria na lista como aba ilegível, e "não consegui ler uma aba" numa tela de
 * cobrança faz o operador parar para investigar o que não é problema.
 */
export async function lerArquivoDeBoletos(
  arquivo: File,
  competencia: string,
): Promise<LeituraDoArquivo> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await arquivo.arrayBuffer());

  const abas: AbaLida[] = [];
  const ignoradas: { aba: string; motivo: string }[] = [];

  for (const ws of wb.worksheets) {
    if (/[íi]ndice/i.test(ws.name)) continue;

    const grade: { texto: null | string; valor: unknown }[][] = [];
    ws.eachRow({ includeEmpty: true }, (linha) => {
      const l: { texto: null | string; valor: unknown }[] = [];
      linha.eachCell({ includeEmpty: true }, (celula, col) => {
        // ⚠️ `valorDaCelula` e não `celula.value`: fórmula, texto formatado e link chegam como
        // OBJETO, e um `String()` neles viraria "[object Object]" — o bastante para a regra não
        // ver um "PAGO ATÉ DEZ/26" em negrito e cobrar quem já pagou.
        const bruto = valorDaCelula(celula);
        l[col - 1] = {
          texto: bruto instanceof Date || bruto === null ? null : String(bruto),
          valor: bruto,
        };
      });
      grade.push(l);
    });

    const r = lerAba(ws.name, grade, competencia);
    if ("motivo" in r) ignoradas.push({ aba: ws.name, motivo: r.motivo });
    else abas.push(r);
  }

  return { abas, ignoradas };
}
