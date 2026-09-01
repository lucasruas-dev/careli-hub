import { describe, expect, it } from "vitest";

import {
  documentoParaHtml,
  documentoParaTexto,
  escaparHtml,
  type NoDoDocumento,
} from "./documento-html";

import { classificarVariaveis } from "./variaveis";

const p = (texto: string, extra: Partial<NoDoDocumento> = {}): NoDoDocumento => ({
  children: [{ text: texto }],
  type: "p",
  ...extra,
});

describe("o texto e suas marcas", () => {
  it("escreve parágrafo simples", () => {
    expect(documentoParaHtml([p("Cláusula primeira.")])).toBe("<p>Cláusula primeira.</p>");
  });

  it("aplica negrito, itálico e sublinhado na ordem fixa", () => {
    const doc: NoDoDocumento[] = [
      { children: [{ bold: true, italic: true, text: "VENDEDORA", underline: true }], type: "p" },
    ];
    // A ordem é fixa para o HTML ser reproduzível entre salvamentos.
    expect(documentoParaHtml(doc)).toBe("<p><strong><em><u>VENDEDORA</u></em></strong></p>");
  });

  it("parágrafo vazio vira <p><br /></p>, porque é o espaço entre cláusulas", () => {
    expect(documentoParaHtml([p("")])).toBe("<p><br /></p>");
  });

  it("escapa o que é HTML", () => {
    expect(escaparHtml('a < b & c "d"')).toBe("a &lt; b &amp; c &quot;d&quot;");
  });
});

describe("as variáveis atravessam intactas — o ponto que não pode falhar", () => {
  it("colchetes não são escapados", () => {
    const html = documentoParaHtml([p("Comprador: [nome_cliente], CPF [cpf_cliente].")]);
    expect(html).toContain("[nome_cliente]");
    expect(html).toContain("[cpf_cliente]");
    expect(html).not.toContain("&#91;");
  });

  it("uma variável dentro de negrito continua sendo reconhecida depois", () => {
    // No JDG a quadra e o lote vêm em <strong>. Se a serialização quebrasse o nome, o contrato
    // sairia com "[numero_quadra]" impresso no papel.
    const doc: NoDoDocumento[] = [
      { children: [{ bold: true, text: "[numero_quadra]" }], type: "p" },
    ];
    const html = documentoParaHtml(doc);
    expect(html).toBe("<p><strong>[numero_quadra]</strong></p>");
    const { conhecidas, desconhecidas } = classificarVariaveis(html);
    expect(conhecidas.map((c) => c.nome)).toEqual(["numero_quadra"]);
    expect(desconhecidas).toEqual([]);
  });

  it("um E comercial no texto não engole a variável seguinte", () => {
    const html = documentoParaHtml([p("Compra & venda de [numero_lote]")]);
    expect(html).toBe("<p>Compra &amp; venda de [numero_lote]</p>");
    expect(classificarVariaveis(html).conhecidas.map((c) => c.nome)).toEqual(["numero_lote"]);
  });
});

describe("títulos, citação e linha", () => {
  it("os seis níveis de título", () => {
    const doc = [1, 2, 3, 4, 5, 6].map((n) => p(`T${n}`, { type: `h${n}` }));
    expect(documentoParaHtml(doc)).toBe(
      "<h1>T1</h1><h2>T2</h2><h3>T3</h3><h4>T4</h4><h5>T5</h5><h6>T6</h6>",
    );
  });

  it("citação e linha horizontal", () => {
    expect(documentoParaHtml([p("cit", { type: "blockquote" })])).toBe("<blockquote>cit</blockquote>");
    expect(documentoParaHtml([{ children: [{ text: "" }], type: "hr" }])).toBe("<hr />");
  });

  it("tipo desconhecido vira parágrafo, e NÃO some", () => {
    // Perder o estilo é aceitável. Perder um parágrafo do contrato não é.
    expect(documentoParaHtml([p("texto", { type: "bloco_que_nao_existe" })])).toBe("<p>texto</p>");
  });
});

describe("alinhamento e recuo", () => {
  it("centralizado sai no style", () => {
    expect(documentoParaHtml([p("TÍTULO", { textAlign: "center" })])).toBe(
      '<p style="text-align:center">TÍTULO</p>',
    );
  });

  it("alinhamento à esquerda não polui o HTML", () => {
    expect(documentoParaHtml([p("x", { textAlign: "left" })])).toBe("<p>x</p>");
  });

  it("recuo vira margem", () => {
    expect(documentoParaHtml([p("x", { indent: 2 })])).toBe('<p style="margin-left:48px">x</p>');
  });
});

describe("listas — que no editor não são listas", () => {
  it("reconstrói o <ul> a partir dos parágrafos marcados", () => {
    // Desde o Plate 49 cada item é um parágrafo com listStyleType, igual ao Word. Sem esta
    // reconstrução, dez itens virariam dez parágrafos soltos e a numeração das cláusulas sumiria.
    const doc = [
      p("primeiro", { indent: 1, listStyleType: "disc" }),
      p("segundo", { indent: 1, listStyleType: "disc" }),
    ];
    expect(documentoParaHtml(doc)).toBe("<ul><li>primeiro</li><li>segundo</li></ul>");
  });

  it("numerada vira <ol>", () => {
    const doc = [p("um", { indent: 1, listStyleType: "decimal" })];
    expect(documentoParaHtml(doc)).toBe("<ol><li>um</li></ol>");
  });

  it("fecha a lista quando volta o texto normal", () => {
    const doc = [p("item", { indent: 1, listStyleType: "disc" }), p("depois")];
    expect(documentoParaHtml(doc)).toBe("<ul><li>item</li></ul><p>depois</p>");
  });

  it("aninha com a sublista DENTRO do <li> do pai — HTML válido", () => {
    // <ul> solto dentro de <ul> é inválido: o navegador perdoa, conversores de HTML para PDF nem
    // sempre. E o contrato termina em PDF.
    const doc = [
      p("a", { indent: 1, listStyleType: "disc" }),
      p("a.1", { indent: 2, listStyleType: "disc" }),
      p("b", { indent: 1, listStyleType: "disc" }),
    ];
    expect(documentoParaHtml(doc)).toBe(
      "<ul><li>a<ul><li>a.1</li></ul></li><li>b</li></ul>",
    );
  });

  it("desce dois níveis e sobe direto para o primeiro", () => {
    const doc = [
      p("a", { indent: 1, listStyleType: "disc" }),
      p("a.1", { indent: 2, listStyleType: "disc" }),
      p("a.1.1", { indent: 3, listStyleType: "disc" }),
      p("b", { indent: 1, listStyleType: "disc" }),
    ];
    expect(documentoParaHtml(doc)).toBe(
      "<ul><li>a<ul><li>a.1<ul><li>a.1.1</li></ul></li></ul></li><li>b</li></ul>",
    );
  });

  it("trocar de marcador no mesmo nível começa outra lista", () => {
    const doc = [
      p("bolinha", { indent: 1, listStyleType: "disc" }),
      p("número", { indent: 1, listStyleType: "decimal" }),
    ];
    expect(documentoParaHtml(doc)).toBe("<ul><li>bolinha</li></ul><ol><li>número</li></ol>");
  });

  it("dentro da lista o recuo NÃO vira margem também", () => {
    // O <ul> já recua. Somar os dois empurraria cada nível duas vezes mais para a direita.
    const html = documentoParaHtml([p("x", { indent: 2, listStyleType: "disc" })]);
    expect(html).not.toContain("margin-left");
  });

  it("fecha tudo no fim do documento", () => {
    const doc = [p("a", { indent: 1, listStyleType: "disc" })];
    expect(documentoParaHtml(doc).endsWith("</ul>")).toBe(true);
  });
});

describe("tabelas — o quadro-resumo do contrato", () => {
  it("monta table > tr > td", () => {
    const doc: NoDoDocumento[] = [
      {
        children: [
          {
            children: [
              { children: [p("QUADRO-RESUMO")], type: "td" },
              { children: [p("[numero_lote]")], type: "td" },
            ],
            type: "tr",
          },
        ],
        type: "table",
      },
    ];
    expect(documentoParaHtml(doc)).toBe(
      "<table><tr><td><p>QUADRO-RESUMO</p></td><td><p>[numero_lote]</p></td></tr></table>",
    );
  });

  it("cabeçalho vira th", () => {
    const doc: NoDoDocumento[] = [
      { children: [{ children: [{ children: [p("Item")], type: "th" }], type: "tr" }], type: "table" },
    ];
    expect(documentoParaHtml(doc)).toContain("<th><p>Item</p></th>");
  });
});

describe("o texto puro, para contar e procurar", () => {
  it("separa blocos por quebra de linha", () => {
    // Sem a quebra, o fim de um parágrafo grudaria no começo do outro e criaria palavras — e
    // variáveis — que não existem no contrato.
    expect(documentoParaTexto([p("fim do parágrafo"), p("[nome_cliente]")])).toBe(
      "fim do parágrafo\n[nome_cliente]",
    );
  });

  it("desce na tabela", () => {
    const doc: NoDoDocumento[] = [
      { children: [{ children: [{ children: [p("dentro")], type: "td" }], type: "tr" }], type: "table" },
    ];
    expect(documentoParaTexto(doc)).toBe("dentro");
  });
});
