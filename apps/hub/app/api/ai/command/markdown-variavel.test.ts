import { describe, expect, it, vi } from "vitest";

// O `BaseEditorKit` do registro (math-base-kit → equation-node-static) importa o CSS do KaTeX.
// No Next isso é um asset; no Node do vitest é "Unknown file extension .css". Aqui não se renderiza
// nada, então o CSS vira módulo vazio.
vi.mock("katex/dist/katex.min.css", () => ({}));

import { getMarkdown } from "@platejs/ai";
import { createSlateEditor } from "platejs";

import { BaseEditorKitTemis } from "@/modules/temis/editor-base-kit-temis";

import { addSelection, getMarkdownWithSelection } from "./utils";

// A PONTE entre a rota de IA (Frente D) e o kit base da Têmis (Frente B).
//
// A premissa de todo prompt em prompt/*.ts é: "trechos entre colchetes como [nome_cliente] são
// variáveis do sistema, reproduza-os EXATAMENTE". Isso só é verdade se o documento chegar ao modelo
// com o nó `variavel` já serializado como `[nome]` — e quem faz isso é a regra de markdown do
// `BaseEditorKitTemis`, com os MESMOS plugins que a rota usa no `createSlateEditor`.
// Se este teste quebrar, a IA passa a receber um nó opaco e devolve o texto sem a variável.

const documento = [
  {
    children: [
      { text: "O COMPRADOR " },
      { children: [{ text: "" }], nome: "nome_cliente", type: "variavel" },
      { text: ", inscrito no CPF " },
      { children: [{ text: "" }], nome: "cpf_cliente", type: "variavel" },
      { text: ", pagará o preço de " },
      { bold: true, text: "R$ " },
      { children: [{ text: "" }], nome: "valor_total", type: "variavel" },
      { text: "." },
    ],
    id: "b1",
    type: "p",
  },
  {
    children: [
      { children: [{ text: "" }], nome: "inicio_dados_conjuge", type: "variavel" },
      { text: " Cônjuge: " },
      { children: [{ text: "" }], nome: "nome_conjuge", type: "variavel" },
      { text: " " },
      { children: [{ text: "" }], nome: "fim_dados_conjuge", type: "variavel" },
    ],
    id: "b2",
    type: "p",
  },
];

// `getMarkdown(type: "block" | "blockWithBlockId")` serializa os blocos da SELEÇÃO (é assim que a
// rota usa: o usuário seleciona e pede). Sem seleção volta vazio — por isso os testes selecionam
// do começo do primeiro bloco ao fim do segundo.
const selecaoDosDoisBlocos = {
  anchor: { offset: 0, path: [0, 0] },
  focus: { offset: 1, path: [1, 3] },
};

describe("o markdown que a rota de IA manda ao modelo", () => {
  it("emite cada nó `variavel` como [nome] (é o que a regra dos prompts promete)", () => {
    const editor = createSlateEditor({
      plugins: BaseEditorKitTemis,
      selection: selecaoDosDoisBlocos,
      value: documento,
    });
    const md = getMarkdown(editor, { type: "block" });

    expect(md).toContain("[nome_cliente]");
    expect(md).toContain("[cpf_cliente]");
    expect(md).toContain("[valor_total]");
    expect(md).toContain("[inicio_dados_conjuge]");
    expect(md).toContain("[fim_dados_conjuge]");
    // Nada do nó vaza como tag MDX (<variavel .../>): o modelo veria uma tag e a "melhoraria".
    expect(md).not.toMatch(/<variavel/i);
    // O par inicio/fim sai na ordem certa.
    expect(md.indexOf("[inicio_dados_conjuge]")).toBeLessThan(md.indexOf("[fim_dados_conjuge]"));
  });

  it("com blocos e ids (modo `comment`) as variáveis continuam intactas", () => {
    const editor = createSlateEditor({
      plugins: BaseEditorKitTemis,
      selection: selecaoDosDoisBlocos,
      value: documento,
    });
    const md = getMarkdown(editor, { type: "blockWithBlockId" });

    expect(md).toContain('<block id="b1">');
    expect(md).toContain("[nome_cliente]");
    expect(md).toContain("[valor_total]");
  });

  it("com <Selection> (modo `edit`) a variável dentro da seleção não é partida", () => {
    const editor = createSlateEditor({
      plugins: BaseEditorKitTemis,
      selection: {
        anchor: { offset: 2, path: [0, 0] },
        focus: { offset: 1, path: [0, 2] },
      },
      value: documento,
    });
    addSelection(editor);
    const md = getMarkdownWithSelection(editor);

    expect(md).toContain("<Selection>");
    expect(md).toContain("</Selection>");
    expect(md).toContain("[nome_cliente]");
    const dentro = md.slice(md.indexOf("<Selection>"), md.indexOf("</Selection>"));
    expect(dentro).toContain("[nome_cliente]");
  });
});
