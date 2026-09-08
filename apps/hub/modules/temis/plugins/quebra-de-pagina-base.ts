import { createSlatePlugin, type TElement } from "platejs";

// A QUEBRA DE PÁGINA — a parte SEM React do plugin (o kit base, os testes e o servidor importam daqui).
//
// Pergunta do Lucas (08/09/2026), ao pedir o bloco do contrato de corretagem: *"eu não [sei] onde
// quebra as páginas"*. A resposta era: em lugar nenhum. Até aqui o contrato era um texto corrido e o
// corte de página era o que o navegador decidisse na hora de imprimir — o que serve para um
// documento de leitura e não serve para um contrato, onde a peça anexa TEM de começar em folha nova.
//
// ⚠️ POR QUE UM NÓ, E NÃO UM ESTILO NO PARÁGRAFO. A alternativa seria marcar o parágrafo seguinte com
// `page-break-before` e não criar nó nenhum. Ela quebra por dois motivos:
//
// 1. NINGUÉM VÊ. Uma propriedade invisível num parágrafo é editada por acidente — apagar a linha
//    apaga a quebra, e quem escreve só descobre no PDF assinado. Como nó, ela é uma linha tracejada
//    na folha, com nome, que se seleciona e se apaga de propósito.
// 2. A QUEBRA EXISTE SOZINHA. O bloco de corretagem termina com uma quebra e não há parágrafo
//    depois dela para carregar o estilo — a próxima peça do contrato pode nem estar escrita ainda.
//
// ⚠️ É VOID DE BLOCO, e não inline: quebra de página no meio de uma frase não é coisa que exista. O
// void impede que o cursor entre nela e que uma marca (negrito, fonte) se aplique a ela.
//
// ⚠️ NO CONTRATO ELA VIRA CSS, não texto. `lib/temis/documento-html.ts` emite
// `break-before: page` + `page-break-before: always` (a propriedade nova e a antiga, porque o
// Chromium honra as duas e nem todo motor de PDF entende a nova). É o que o Chromium usa para
// cortar a folha, e é por isso que a quebra só significa alguma coisa depois do HTML → PDF.

export const QUEBRA_PAGINA_KEY = "quebra_pagina" as const;

export type TQuebraDePaginaElement = TElement & {
  type: typeof QUEBRA_PAGINA_KEY;
};

/** O nó pronto para `insertNodes`. O filho de texto vazio é exigência do Slate para todo void. */
export function noDeQuebraDePagina(): TQuebraDePaginaElement {
  return { children: [{ text: "" }], type: QUEBRA_PAGINA_KEY };
}

export function ehNoDeQuebraDePagina(no: unknown): no is TQuebraDePaginaElement {
  return typeof no === "object" && no !== null && (no as { type?: unknown }).type === QUEBRA_PAGINA_KEY;
}

export const BaseQuebraDePaginaPlugin = createSlatePlugin({
  key: QUEBRA_PAGINA_KEY,
  node: {
    isElement: true,
    isVoid: true,
    type: QUEBRA_PAGINA_KEY,
  },
});
