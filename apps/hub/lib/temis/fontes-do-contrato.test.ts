// @vitest-environment jsdom

import { createSlateEditor, KEYS, type Value } from "platejs";
import { describe, expect, it } from "vitest";

import { BaseEditorKitTemis } from "@/modules/temis/editor-base-kit-temis";

import { CSS_DO_DOCUMENTO } from "./css-do-documento";
import { documentoParaHtml, type NoDoDocumento } from "./documento-html";
import {
  CHAVE_FONTE,
  contarTrechosComFonte,
  FONTES_DO_CONTRATO,
  limparFonteDoDocumento,
  nomeDaPilha,
  PILHA_GEORGIA,
} from "./fontes-do-contrato";

// A FONTE DO CONTRATO — a lista do seletor e o item que devolve o documento ao piso.
//
// O que este arquivo protege é o caminho que ninguém vê: o piso do `css-do-documento.ts` só aparece
// no papel se NENHUM trecho declarar fonte. Medido em 08/09/2026 nas duas minutas do Panteon: 280
// trechos com "Lucida Sans Unicode" gravado inline, herdados do .docx do loteador. Enquanto eles
// existirem, trocar o piso não muda uma linha impressa — e é o "limpar tudo" que os resolve.

/** Um documento pequeno com a mesma forma da minuta: fonte inline em quase todo trecho. */
function documentoComFonteInline(): Value {
  return [
    {
      children: [
        { fontFamily: '"Lucida Sans Unicode", "Lucida Grande", sans-serif', text: "CLÁUSULA 1ª — " },
        {
          bold: true,
          fontFamily: '"Lucida Sans Unicode", "Lucida Grande", sans-serif',
          text: "DO OBJETO",
        },
      ],
      type: "p",
    },
    {
      children: [
        { fontFamily: "Arial, Helvetica, sans-serif", fontSize: "14px", text: "O valor de " },
        { text: "R$ 9.800,00" },
        { color: "#111", fontFamily: PILHA_GEORGIA, text: " em 05/09/2026." },
      ],
      type: "p",
    },
  ] as unknown as Value;
}

describe("a lista de fontes", () => {
  it("começa pela Georgia, que é o padrão do contrato", () => {
    expect(FONTES_DO_CONTRATO[0]?.nome).toBe("Georgia");
    expect(FONTES_DO_CONTRATO[0]?.pilha).toBe(PILHA_GEORGIA);
  });

  it("traz as nove famosas, sem repetir", () => {
    const nomes = FONTES_DO_CONTRATO.map((f) => f.nome);
    expect(nomes).toEqual([
      "Georgia",
      "Times New Roman",
      "Arial",
      "Calibri",
      "Verdana",
      "Garamond",
      "Trebuchet MS",
      "Tahoma",
      "Courier New",
    ]);
    expect(new Set(nomes).size).toBe(nomes.length);
    expect(new Set(FONTES_DO_CONTRATO.map((f) => f.pilha)).size).toBe(FONTES_DO_CONTRATO.length);
  });

  it("toda pilha guarda mais de uma família e termina numa genérica", () => {
    // ⚠️ É O QUE SALVA QUEM ABRIR NUMA MÁQUINA SEM A FONTE. `font-family: Georgia` sozinho cai no
    // padrão do navegador (sem serifa) e o contrato troca de cara; com a pilha, cai em Times.
    for (const fonte of FONTES_DO_CONTRATO) {
      const familias = fonte.pilha.split(",").map((f) => f.trim());
      expect(familias.length).toBeGreaterThan(1);
      expect(["serif", "sans-serif", "monospace"]).toContain(familias.at(-1));
    }
  });

  it("o piso do documento usa a MESMA pilha que o seletor chama de Georgia", () => {
    // Duas fontes com o mesmo nome só apareceriam na folha impressa.
    expect(CSS_DO_DOCUMENTO).toContain(`font-family: ${PILHA_GEORGIA};`);
  });

  it("o piso força algarismos alinhados", () => {
    // ⚠️ A GEORGIA USA ALGARISMOS DE ALTURA VARIÁVEL: o 3, 4, 7 e 9 descem abaixo da linha. Numa
    // tabela de parcelas os valores deixam de alinhar. Medido na georgia.ttf do Windows 11
    // (Version 5.59): a GSUB declara lnum, então a declaração tem o que ativar.
    expect(CSS_DO_DOCUMENTO).toContain("font-variant-numeric: lining-nums;");
  });

  it("a chave escrita à mão é a mesma que o Plate usa", () => {
    // O arquivo não pode importar `KEYS` em runtime (ver a nota da constante) — então a igualdade
    // é provada aqui.
    expect(CHAVE_FONTE).toBe(KEYS.fontFamily);
  });
});

describe("o nome que aparece no botão", () => {
  it("uma pilha da lista mostra o nome da lista", () => {
    expect(nomeDaPilha(PILHA_GEORGIA)).toBe("Georgia");
    expect(nomeDaPilha('"Courier New", Courier, monospace')).toBe("Courier New");
  });

  it("uma pilha de fora mostra a primeira família, sem as aspas", () => {
    // É o caso da minuta que está no ar.
    expect(nomeDaPilha('"Lucida Sans Unicode", "Lucida Grande", sans-serif')).toBe(
      "Lucida Sans Unicode",
    );
  });

  it("sem fonte declarada não há nome — quem chama decide o rótulo", () => {
    expect(nomeDaPilha("")).toBeNull();
    expect(nomeDaPilha(null)).toBeNull();
    expect(nomeDaPilha(undefined)).toBeNull();
  });
});

describe("devolver o documento inteiro ao piso", () => {
  it("conta os trechos com fonte gravada, não os trechos", () => {
    const editor = createSlateEditor({
      plugins: BaseEditorKitTemis,
      value: documentoComFonteInline(),
    });
    // Cinco trechos no documento, quatro com fonte: o "R$ 9.800,00" não declara nada.
    expect(contarTrechosComFonte(editor)).toBe(4);
  });

  it("limpa TODOS os trechos, não só o selecionado — e sem seleção nenhuma", () => {
    const editor = createSlateEditor({
      plugins: BaseEditorKitTemis,
      value: documentoComFonteInline(),
    });

    expect(limparFonteDoDocumento(editor)).toBe(4);
    expect(contarTrechosComFonte(editor)).toBe(0);
  });

  it("não encosta nas outras marcas do trecho", () => {
    // ⚠️ O RISCO REAL DE UM "LIMPAR" É LEVAR JUNTO O QUE NINGUÉM PEDIU. Negrito, tamanho e cor são
    // escolha de quem escreveu a cláusula; só a fonte volta ao piso.
    const editor = createSlateEditor({
      plugins: BaseEditorKitTemis,
      value: documentoComFonteInline(),
    });
    limparFonteDoDocumento(editor);

    const documento = editor.children as unknown as NoDoDocumento[];
    const primeiro = documento[0]?.children?.[1] as Record<string, unknown>;
    expect(primeiro.bold).toBe(true);
    expect(primeiro[CHAVE_FONTE]).toBeUndefined();

    const segundo = documento[1]?.children?.[0] as Record<string, unknown>;
    expect(segundo.fontSize).toBe("14px");
    const terceiro = documento[1]?.children?.[2] as Record<string, unknown>;
    expect(terceiro.color).toBe("#111");
  });

  it("num documento já limpo não faz nada e diz que não fez", () => {
    const editor = createSlateEditor({
      plugins: BaseEditorKitTemis,
      value: [{ children: [{ text: "Sem fonte declarada." }], type: "p" }] as unknown as Value,
    });
    expect(limparFonteDoDocumento(editor)).toBe(0);
  });

  it("o HTML do contrato sai sem NENHUM font-family depois da limpeza", () => {
    // É a prova que interessa: o que vai para a prévia e para o PDF é este HTML, e é ele que
    // precisa deixar o piso do `css-do-documento.ts` aparecer.
    const editor = createSlateEditor({
      plugins: BaseEditorKitTemis,
      value: documentoComFonteInline(),
    });

    const antes = documentoParaHtml(editor.children as unknown as NoDoDocumento[]);
    expect(antes).toContain("font-family:");

    limparFonteDoDocumento(editor);

    const depois = documentoParaHtml(editor.children as unknown as NoDoDocumento[]);
    expect(depois).not.toContain("font-family:");
    // O texto e o resto da formatação atravessam inteiros.
    expect(depois).toContain("R$ 9.800,00");
    expect(depois).toContain("<strong>DO OBJETO</strong>");
    expect(depois).toContain("font-size:14px");
  });
});
