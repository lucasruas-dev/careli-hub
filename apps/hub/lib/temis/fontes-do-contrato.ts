import type { SlateEditor, TNode } from "platejs";

// AS FONTES QUE O CONTRATO PODE USAR — a lista do seletor da barra, num lugar só.
//
// Lucas, 08/09/2026, depois de comparar as convenções de mercado: *"vamos de georgia"*, *"será o
// padrão"*, *"ae coloca as fontes mais famosas como opção"*.
//
// ⚠️ A LISTA É CURTA E FECHADA DE PROPÓSITO. Um seletor com as ~200 famílias instaladas na máquina
// de quem edita serve para escolher uma que a próxima máquina não tem — e o contrato assinado sai
// com outra cara. Estas nove vêm com o Windows e com o Word; quem receber o documento tem todas.
//
// ⚠️ E NÃO HÁ PADRÃO HISTÓRICO A RESPEITAR. Medido em 08/09/2026 nos 400 contratos do C2X: 399 não
// declaram fonte nenhuma. O que existe de fonte gravada são os trechos das duas minutas do Panteon
// (280 deles, todos "Lucida Sans Unicode"), herdados da importação do .docx do loteador — não uma
// escolha de alguém.

/**
 * A chave da marca de fonte no documento do Plate.
 *
 * ⚠️ ESCRITA À MÃO, E NÃO `KEYS.fontFamily`, DE PROPÓSITO. Este arquivo é importado pelo
 * `css-do-documento.ts`, e ele é importado pelo `html-para-pdf.ts`, que roda no servidor: um import
 * de VALOR do `platejs` arrastaria o editor inteiro para o bundle que só precisa gerar um PDF.
 * `import type` some na compilação; `KEYS` não sumiria.
 *
 * Que as duas continuam iguais é o que o teste prova (`fontes-do-contrato.test.ts` compara esta
 * constante com o `KEYS.fontFamily` de verdade).
 */
export const CHAVE_FONTE = "fontFamily";

/** Uma família do seletor: o nome que a pessoa lê e a pilha que vai para o documento. */
export type FonteDoContrato = {
  /** O nome como ele aparece no Word — é o que a pessoa procura. */
  nome: string;
  /** O valor gravado no `font-family` do trecho. */
  pilha: string;
};

/**
 * A pilha da Georgia — o piso do documento (`css-do-documento.ts`) e a primeira do seletor.
 *
 * ⚠️ GRAVAMOS A PILHA INTEIRA, NUNCA SÓ O NOME. `font-family: Georgia` numa máquina sem Georgia cai
 * no padrão do navegador, que é sem serifa: o contrato inteiro trocaria de família e a diferença
 * aparece na hora de imprimir, não na hora de editar. Com a pilha, ele cai em Times — parecida.
 */
export const PILHA_GEORGIA = 'Georgia, "Times New Roman", Times, serif';

/**
 * As famosas, na ordem em que aparecem no seletor: as duas serifas do contrato primeiro, depois as
 * sem serifa mais comuns, e a monoespaçada por último.
 */
export const FONTES_DO_CONTRATO: readonly FonteDoContrato[] = [
  { nome: "Georgia", pilha: PILHA_GEORGIA },
  { nome: "Times New Roman", pilha: '"Times New Roman", Times, Georgia, serif' },
  { nome: "Arial", pilha: "Arial, Helvetica, sans-serif" },
  { nome: "Calibri", pilha: 'Calibri, Carlito, "Segoe UI", sans-serif' },
  { nome: "Verdana", pilha: 'Verdana, Geneva, "DejaVu Sans", sans-serif' },
  { nome: "Garamond", pilha: 'Garamond, "EB Garamond", "Times New Roman", serif' },
  { nome: "Trebuchet MS", pilha: '"Trebuchet MS", "Lucida Grande", Tahoma, sans-serif' },
  { nome: "Tahoma", pilha: "Tahoma, Verdana, Geneva, sans-serif" },
  { nome: "Courier New", pilha: '"Courier New", Courier, monospace' },
];

/**
 * O nome curto de uma pilha, para o rótulo do botão.
 *
 * Uma pilha da lista devolve o nome da lista. Uma pilha de fora — e a minuta que está no ar só tem
 * dessas — devolve a primeira família dela, sem as aspas: `"Lucida Sans Unicode", "Lucida Grande",
 * sans-serif` vira `Lucida Sans Unicode`. Sem fonte declarada, `null`: quem chama decide o rótulo.
 */
export function nomeDaPilha(pilha: string | null | undefined): string | null {
  if (!pilha) return null;

  const daLista = FONTES_DO_CONTRATO.find((fonte) => fonte.pilha === pilha);
  if (daLista) return daLista.nome;

  const primeira = pilha.split(",")[0]?.trim() ?? "";
  const semAspas = primeira.replace(/^["']|["']$/g, "").trim();
  return semAspas.length > 0 ? semAspas : null;
}

/** Um nó que carrega fonte gravada — trecho de texto ou, se a importação criou, bloco. */
function temFonte(no: TNode): boolean {
  return typeof (no as Record<string, unknown>)[CHAVE_FONTE] === "string";
}

/**
 * Quantos nós do documento inteiro têm `font-family` gravado.
 *
 * ⚠️ VARRE TUDO (`at: []`, `mode: "all"`), não a seleção. É o mesmo percurso que o seletor de cor do
 * Plate usa para juntar as cores já usadas no documento — a diferença é o que se procura.
 */
export function contarTrechosComFonte(editor: SlateEditor): number {
  let quantos = 0;
  for (const _entrada of editor.api.nodes({ at: [], match: temFonte, mode: "all" })) {
    quantos += 1;
  }
  return quantos;
}

/**
 * Tira o `font-family` de TODOS os nós do documento, devolvendo o texto ao piso do
 * `css-do-documento.ts`. Devolve quantos nós foram limpos.
 *
 * ⚠️ ISTO EXISTE PORQUE O PISO SOZINHO NUNCA APARECE. O `css-do-documento.ts` define Georgia como
 * fonte do contrato, mas fonte inline vence CSS de container — e as duas minutas do Panteon têm 280
 * trechos com "Lucida Sans Unicode" gravado, herdado do .docx do loteador. Enquanto esses 280 nós
 * existirem, trocar o piso não muda uma linha da folha impressa.
 *
 * ⚠️ E O MATCH NÃO É SÓ TEXTO. `addMark` grava a fonte como marca de trecho, então na prática são
 * textos; mas o `FontFamilyPlugin` é injetado nos parágrafos (`inject.targetPlugins: [KEYS.p]` em
 * `components/editor/plugins/font-kit.tsx`), e um bloco vindo de importação pode chegar com a prop.
 * Procurar pela prop, e não pelo tipo do nó, limpa os dois casos.
 */
export function limparFonteDoDocumento(editor: SlateEditor): number {
  const quantos = contarTrechosComFonte(editor);
  if (quantos === 0) return 0;

  editor.tf.unsetNodes(CHAVE_FONTE as never, { at: [], match: temFonte, mode: "all" });
  return quantos;
}
