// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BaseBasicBlocksPlugin, BaseBasicMarksPlugin } from "@platejs/basic-nodes";
import {
  BaseFontBackgroundColorPlugin,
  BaseFontColorPlugin,
  BaseFontFamilyPlugin,
  BaseFontSizePlugin,
  BaseLineHeightPlugin,
  BaseTextAlignPlugin,
  BaseTextIndentPlugin,
} from "@platejs/basic-styles";
import { BaseIndentPlugin } from "@platejs/indent";
import { BaseListPlugin } from "@platejs/list";
import { MarkdownPlugin } from "@platejs/markdown";
import { BaseTablePlugin } from "@platejs/table";
import { createSlateEditor, type Descendant, deserializeHtml, type TText } from "platejs";
import { describe, expect, it } from "vitest";

import {
  BaseVariavelPlugin,
  ehNoDeVariavel,
  noDeVariavel,
  promoverVariaveisNoTexto,
  promoverVariaveisNoValor,
  REGRAS_MARKDOWN_VARIAVEL,
  variaveisNoValor,
} from "./variavel-kit-base";

// A VARIÁVEL COMO NÓ — o que entra como texto vira chip, e nada se perde no caminho.
//
// ⚠️ Este teste NÃO depende dos kits do registro do Plate (Frente A): usa a lista base de plugins
// que o editor tinha antes da troca, mais o `BaseVariavelPlugin`. O que ele prova é a conversão
// texto → nó; a volta nó → `[nome]` no HTML do contrato é do serializador (Frente C).

const PLUGINS_BASE = [
  BaseBasicBlocksPlugin,
  BaseBasicMarksPlugin,
  BaseTextAlignPlugin,
  BaseFontFamilyPlugin,
  BaseFontSizePlugin,
  BaseFontColorPlugin,
  BaseFontBackgroundColorPlugin,
  BaseLineHeightPlugin,
  BaseTextIndentPlugin,
  BaseIndentPlugin,
  BaseListPlugin,
  BaseTablePlugin,
  BaseVariavelPlugin,
];

/** Os nós de variável de um documento, em profundidade. */
function nosDeVariavel(nos: Descendant[]): string[] {
  return nos.flatMap((no) => {
    if (ehNoDeVariavel(no)) return [no.nome];
    const filhos = (no as { children?: Descendant[] }).children;
    return Array.isArray(filhos) ? nosDeVariavel(filhos) : [];
  });
}

describe("o nó de variável (contrato C0.1)", () => {
  it("tem o formato combinado entre as frentes", () => {
    expect(noDeVariavel("nome_cliente")).toEqual({
      children: [{ text: "" }],
      nome: "nome_cliente",
      type: "variavel",
    });
  });

  it("carrega as marcas no filho de texto, para o negrito não se perder", () => {
    expect(noDeVariavel("cpf_cliente", { bold: true })).toEqual({
      children: [{ bold: true, text: "" }],
      nome: "cpf_cliente",
      type: "variavel",
    });
  });
});

describe("promoverVariaveisNoTexto — a quebra de um trecho", () => {
  it("parte o texto em texto, variável, texto, preservando as marcas dos dois lados", () => {
    const saida = promoverVariaveisNoTexto({
      bold: true,
      fontFamily: "Lucida Sans Unicode",
      text: "Sr. [nome_cliente], CPF [cpf_cliente].",
    });

    expect(saida).toEqual([
      { bold: true, fontFamily: "Lucida Sans Unicode", text: "Sr. " },
      {
        children: [{ bold: true, fontFamily: "Lucida Sans Unicode", text: "" }],
        nome: "nome_cliente",
        type: "variavel",
      },
      { bold: true, fontFamily: "Lucida Sans Unicode", text: ", CPF " },
      {
        children: [{ bold: true, fontFamily: "Lucida Sans Unicode", text: "" }],
        nome: "cpf_cliente",
        type: "variavel",
      },
      { bold: true, fontFamily: "Lucida Sans Unicode", text: "." },
    ]);
  });

  it("sempre deixa texto ao redor do chip, mesmo vazio — o Slate exige", () => {
    const saida = promoverVariaveisNoTexto({ text: "[a_1][b_2]" });
    expect(saida.map((n) => (ehNoDeVariavel(n) ? `<${n.nome}>` : (n as TText).text))).toEqual([
      "",
      "<a_1>",
      "",
      "<b_2>",
      "",
    ]);
  });

  it("não mexe no que não é variável: colchete aberto, uma letra só, espaço ou maiúscula com espaço", () => {
    for (const texto of ["[", "[nome", "[a]", "[Nome Cliente]", "art. 5º [sic", "sem nada"]) {
      expect(promoverVariaveisNoTexto({ text: texto })).toEqual([{ text: texto }]);
    }
  });

  it("aceita o formato que o catálogo aceita: [A-Za-z0-9_]{2,80}", () => {
    expect(promoverVariaveisNoTexto({ text: "[Nome] e [CPF]" }).filter(ehNoDeVariavel)).toHaveLength(2);
  });
});

describe("promoverVariaveisNoValor — o documento inteiro", () => {
  it("desce em tabelas e listas e não toca no que já é chip", () => {
    const valor = promoverVariaveisNoValor([
      {
        children: [
          {
            children: [
              { children: [{ text: "Comprador: [nome_cliente]" }], type: "p" },
            ],
            type: "td",
          },
        ],
        type: "table",
      },
      { children: [{ text: "" }, noDeVariavel("cpf_cliente"), { text: " já era chip" }], type: "p" },
    ]);

    expect(nosDeVariavel(valor)).toEqual(["nome_cliente", "cpf_cliente"]);
    expect(variaveisNoValor(valor)).toEqual(["nome_cliente", "cpf_cliente"]);
  });

  it("variaveisNoValor conta também o que ficou em texto (a variável partida por marca)", () => {
    const valor = [
      {
        children: [{ text: "" }, noDeVariavel("nome_cliente"), { text: " e [cpf_cliente] em texto" }],
        type: "p",
      },
    ];
    expect(variaveisNoValor(valor)).toEqual(["nome_cliente", "cpf_cliente"]);
  });
});

describe("a minuta do JDG que está no ar", () => {
  // O mesmo fixture do round-trip: 41.827 bytes, 244 marcadores, 171 nomes distintos.
  const MINUTA = readFileSync(
    join(__dirname, "../../../lib/temis/fixtures/minuta-jdg-c2x.html"),
    "utf8",
  );

  it("as 244 ocorrências e os 171 nomes continuam lá depois da promoção", () => {
    const editor = createSlateEditor({ plugins: PLUGINS_BASE });
    const documento = promoverVariaveisNoValor(deserializeHtml(editor, { element: MINUTA }));

    const nomes = variaveisNoValor(documento);
    expect(nomes).toHaveLength(244);
    expect(new Set(nomes).size).toBe(171);

    // Quase todas viram chip. As que sobram em texto são as PARTIDAS por marca no HTML do C2X
    // (`[nome_cl</strong>iente]`) — o defeito que `codigosPartidos` acusa e que o chip resolve
    // para o futuro, não para o passado.
    const chips = nosDeVariavel(documento);
    expect(chips.length).toBeGreaterThan(200);
    expect(chips.length).toBeLessThanOrEqual(244);
  });
});

describe("normalizeNode — o que chega como texto vira chip", () => {
  it("converte `[nome]` colado num parágrafo, mantendo as marcas em volta", () => {
    const editor = createSlateEditor({
      plugins: PLUGINS_BASE,
      value: [{ children: [{ bold: true, text: "Sr. [nome_cliente], CPF [cpf_cliente]." }], type: "p" }],
    });

    editor.tf.normalize({ force: true });

    const paragrafo = editor.children[0] as { children: Descendant[] };
    expect(
      paragrafo.children.map((n) => (ehNoDeVariavel(n) ? `<${n.nome}>` : (n as TText).text)),
    ).toEqual(["Sr. ", "<nome_cliente>", ", CPF ", "<cpf_cliente>", "."]);
    expect((paragrafo.children[0] as TText).bold).toBe(true);
    expect((paragrafo.children[2] as TText).bold).toBe(true);
    expect(((paragrafo.children[1] as { children: TText[] }).children[0] as TText).bold).toBe(true);
  });

  it("digitar `[nome_cliente` não converte; o `]` fecha e o cursor fica depois do chip", () => {
    const editor = createSlateEditor({
      plugins: PLUGINS_BASE,
      value: [{ children: [{ text: "Comprador: " }], type: "p" }],
    });
    editor.tf.select(editor.api.end([]));

    editor.tf.insertText("[nome_cliente");
    expect(nosDeVariavel(editor.children)).toEqual([]);

    editor.tf.insertText("]");
    expect(nosDeVariavel(editor.children)).toEqual(["nome_cliente"]);

    // O cursor está no texto logo DEPOIS do chip: o próximo caractere digitado não apaga nada.
    editor.tf.insertText(",");
    const paragrafo = editor.children[0] as { children: Descendant[] };
    expect(
      paragrafo.children.map((n) => (ehNoDeVariavel(n) ? `<${n.nome}>` : (n as TText).text)),
    ).toEqual(["Comprador: ", "<nome_cliente>", ","]);
  });

  it("`[` sozinho e `[a]` continuam texto", () => {
    const editor = createSlateEditor({
      plugins: PLUGINS_BASE,
      value: [{ children: [{ text: "x [ y [a] z" }], type: "p" }],
    });
    editor.tf.normalize({ force: true });
    expect(nosDeVariavel(editor.children)).toEqual([]);
    expect(editor.api.string([])).toBe("x [ y [a] z");
  });
});

describe("markdown — o que a IA recebe e devolve", () => {
  it("o chip sai como [nome] literal (nó html, não texto escapado) e volta como texto para o normalizeNode", () => {
    const editor = createSlateEditor({
      plugins: [
        ...PLUGINS_BASE,
        MarkdownPlugin.configure({ options: { rules: REGRAS_MARKDOWN_VARIAVEL } }),
      ],
    });
    const markdown = editor.getApi(MarkdownPlugin).markdown.serialize({
      value: [
        {
          children: [{ text: "Sr. " }, noDeVariavel("nome_cliente"), { bold: true, text: ", CPF " }],
          type: "p",
        },
      ],
    });

    expect(markdown).toContain("Sr. [nome_cliente]");
    expect(markdown).not.toContain("\\[");

    const deVolta = editor.getApi(MarkdownPlugin).markdown.deserialize(markdown);
    editor.tf.setValue(deVolta);
    editor.tf.normalize({ force: true });
    expect(nosDeVariavel(editor.children)).toEqual(["nome_cliente"]);
  });
});
