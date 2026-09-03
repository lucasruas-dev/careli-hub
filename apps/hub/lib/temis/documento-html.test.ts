import { describe, expect, it } from "vitest";

import {
  documentoParaHtml,
  documentoParaTexto,
  escaparHtml,
  midiasDoDocumento,
  type NoDoDocumento,
  temSugestoesPendentes,
  trocarUrlsDeMidia,
} from "./documento-html";

import { classificarVariaveis, codigosPartidos } from "./variaveis";

const p = (texto: string, extra: Partial<NoDoDocumento> = {}): NoDoDocumento => ({
  children: [{ text: texto }],
  type: "p",
  ...extra,
});

/** O nó de variável do editor (contrato C0.1): inline, void, com o nome sem colchetes. */
const variavel = (nome: string, marcas: Record<string, unknown> = {}): NoDoDocumento => ({
  children: [{ text: "", ...marcas }],
  nome,
  type: "variavel",
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

  it("tecla vira <kbd>, por dentro de negrito", () => {
    const doc: NoDoDocumento[] = [{ children: [{ bold: true, kbd: true, text: "Ctrl" }], type: "p" }];
    expect(documentoParaHtml(doc)).toBe("<p><strong><kbd>Ctrl</kbd></strong></p>");
  });
});

describe("as variáveis atravessam intactas — o ponto que não pode falhar", () => {
  it("colchetes em texto não são escapados", () => {
    const html = documentoParaHtml([p("Comprador: [nome_cliente], CPF [cpf_cliente].")]);
    expect(html).toContain("[nome_cliente]");
    expect(html).toContain("[cpf_cliente]");
    expect(html).not.toContain("&#91;");
  });

  it("o NÓ de variável vira [nome] no HTML e no texto puro", () => {
    // Desde 02/09/2026 a variável é um nó do editor. O contrato continua lendo `[nome]`: é o que
    // o motor procura e o que `variaveisDoTexto` reconhece.
    const doc: NoDoDocumento[] = [
      { children: [{ text: "Comprador: " }, variavel("nome_cliente"), { text: "." }], type: "p" },
    ];
    expect(documentoParaHtml(doc)).toBe("<p>Comprador: [nome_cliente].</p>");
    expect(documentoParaTexto(doc)).toBe("Comprador: [nome_cliente].");
    expect(classificarVariaveis(documentoParaHtml(doc)).conhecidas.map((c) => c.nome)).toEqual(["nome_cliente"]);
  });

  it("a variável com marca por fora sai <strong>[nome]</strong> INTEIRA", () => {
    // O Plate guarda a marca no filho do nó void. Vestir o `[nome]` com ela é o que impede o
    // `<strong>[nome_cl</strong>iente]` que imprimiu "[nome_cliente]" no primeiro contrato do JDG.
    const doc: NoDoDocumento[] = [
      { children: [variavel("numero_quadra", { bold: true, fontFamily: "Georgia" })], type: "p" },
    ];
    const html = documentoParaHtml(doc);
    expect(html).toBe('<p><span style="font-family:Georgia"><strong>[numero_quadra]</strong></span></p>');
    expect(codigosPartidos(html)).toEqual([]);
    expect(classificarVariaveis(html).conhecidas.map((c) => c.nome)).toEqual(["numero_quadra"]);
  });

  it("nome fora do padrão não vira variável: sai escapado, entre colchetes, para ser visto", () => {
    const doc: NoDoDocumento[] = [{ children: [variavel("nome <x>")], type: "p" }];
    expect(documentoParaHtml(doc)).toBe("<p>[nome &lt;x&gt;]</p>");
    expect(classificarVariaveis(documentoParaHtml(doc)).conhecidas).toEqual([]);
  });

  it("uma variável em texto dentro de negrito continua sendo reconhecida depois", () => {
    // Minutas antigas (antes do nó) ainda podem trazer a variável como texto. Continua valendo.
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

  it("o id que o editor grava em todo bloco é ignorado", () => {
    // `nodeId` do Plate: obrigatório para seleção de bloco, arrastar, sumário. É do editor, não do
    // contrato — dois salvamentos com ids diferentes têm de produzir o mesmo HTML.
    expect(documentoParaHtml([p("x", { id: "abc123" })])).toBe("<p>x</p>");
    const doc: NoDoDocumento[] = [{ children: [{ text: "x" }], id: "t1", type: "table" }];
    expect(documentoParaHtml(doc)).not.toContain("abc");
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

  it("o align do align-kit (novo) vale igual ao textAlign da barra antiga", () => {
    expect(documentoParaHtml([p("x", { align: "justify" })])).toBe('<p style="text-align:justify">x</p>');
  });

  it("quando as duas chaves existem, `align` (o que o editor atual grava) manda", () => {
    // Minuta antiga (`textAlign: center`) realinhada no editor novo (`align: justify`): o contrato
    // tem que sair como a tela mostra. Com a precedência invertida saía centralizado.
    expect(documentoParaHtml([p("x", { align: "justify", textAlign: "center" })])).toBe(
      '<p style="text-align:justify">x</p>',
    );
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

  it("uma lista dentro de uma célula também vira <ul>", () => {
    // Antes a reconstrução só valia na raiz: dez itens dentro do quadro-resumo sairiam como dez
    // parágrafos com margem. Agora toda sequência de blocos passa pela mesma pilha.
    const doc: NoDoDocumento[] = [
      {
        children: [
          {
            children: [
              {
                children: [p("a", { indent: 1, listStyleType: "disc" }), p("b", { indent: 1, listStyleType: "disc" })],
                type: "td",
              },
            ],
            type: "tr",
          },
        ],
        type: "table",
      },
    ];
    expect(documentoParaHtml(doc)).toContain("<ul><li>a</li><li>b</li></ul></td>");
  });
});

describe("tabelas — o quadro-resumo do contrato", () => {
  it("monta table > tr > td COM borda", () => {
    // ⚠️ A BORDA É EMITIDA, e não guardada. Medido em 01/09/2026: ao ler o HTML da minuta do JDG, o
    // Plate devolve a célula sem a borda que estava no `style` do `<td>`. O quadro-resumo do art.
    // 26-A é uma tabela de 17 linhas que contém o contrato inteiro; sem borda ele vira texto corrido.
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
    const html = documentoParaHtml(doc);
    expect(html).toContain('<table style="border-collapse:collapse;border:1px solid #000000">');
    expect(html).toContain('<td style="border:1px solid #000000"><p>QUADRO-RESUMO</p></td>');
    expect(html).toContain("[numero_lote]");
  });

  it("cabeçalho vira th, também com borda", () => {
    const doc: NoDoDocumento[] = [
      { children: [{ children: [{ children: [p("Item")], type: "th" }], type: "tr" }], type: "table" },
    ];
    expect(documentoParaHtml(doc)).toContain('<th style="border:1px solid #000000"><p>Item</p></th>');
  });

  it("preserva o fundo da célula — o box de CIÊNCIA PRÉVIA do contrato", () => {
    // Uma ocorrência só na minuta inteira, e é o destaque legal do aviso sobre desfazimento.
    const doc: NoDoDocumento[] = [
      {
        children: [
          { children: [{ background: "#D9D9D9", children: [p("CIÊNCIA")], type: "td" }], type: "tr" },
        ],
        type: "table",
      },
    ];
    expect(documentoParaHtml(doc)).toContain("background-color:#D9D9D9");
  });

  it("preserva célula mesclada — sem isso a tabela desmonta", () => {
    const doc: NoDoDocumento[] = [
      {
        children: [
          { children: [{ children: [p("x")], colSpan: 3, rowSpan: 2, type: "td" }], type: "tr" },
        ],
        type: "table",
      },
    ];
    const html = documentoParaHtml(doc);
    expect(html).toContain('colspan="3"');
    expect(html).toContain('rowspan="2"');
  });

  it("colSpan de 1 não polui o HTML", () => {
    const doc: NoDoDocumento[] = [
      { children: [{ children: [{ children: [p("x")], colSpan: 1, type: "td" }], type: "tr" }], type: "table" },
    ];
    expect(documentoParaHtml(doc)).not.toContain("colspan");
  });
});

describe("colunas — diagramação, não quadro", () => {
  it("column_group vira tabela SEM borda, uma célula por coluna, com a largura", () => {
    // ⚠️ NÃO passa pela regra de `td`, que injeta a borda padrão do quadro-resumo.
    const doc: NoDoDocumento[] = [
      {
        children: [
          { children: [p("esquerda")], type: "column", width: "50%" },
          { children: [p("direita")], type: "column", width: "50%" },
        ],
        type: "column_group",
      },
    ];
    const html = documentoParaHtml(doc);
    expect(html).toBe(
      '<table style="width:100%;border-collapse:collapse;border:none"><tr>' +
        '<td style="vertical-align:top;border:none;padding:0 8px;width:50%"><p>esquerda</p></td>' +
        '<td style="vertical-align:top;border:none;padding:0 8px;width:50%"><p>direita</p></td>' +
        "</tr></table>",
    );
    expect(html).not.toContain("1px solid");
  });

  it("coluna sem largura não escreve width", () => {
    const doc: NoDoDocumento[] = [
      { children: [{ children: [p("x")], type: "column" }], type: "column_group" },
    ];
    expect(documentoParaHtml(doc)).toContain('<td style="vertical-align:top;border:none;padding:0 8px"><p>x</p></td>');
  });
});

describe("callout, toggle e sumário", () => {
  it("callout vira caixa com borda à esquerda, fundo e ícone", () => {
    const doc: NoDoDocumento[] = [
      { backgroundColor: "#fff3cd", children: [p("Atenção ao prazo.")], icon: "⚠️", type: "callout" },
    ];
    expect(documentoParaHtml(doc)).toBe(
      '<div style="margin:8px 0;padding:8px 12px;border-left:4px solid #999;background:#fff3cd">⚠️ <p>Atenção ao prazo.</p></div>',
    );
  });

  it("callout sem cor nem ícone usa o cinza padrão", () => {
    const doc: NoDoDocumento[] = [{ children: [{ text: "nota" }], type: "callout" }];
    expect(documentoParaHtml(doc)).toBe(
      '<div style="margin:8px 0;padding:8px 12px;border-left:4px solid #999;background:#f5f5f5">nota</div>',
    );
  });

  it("toggle vira parágrafo com o título; o que estava dentro já vem como blocos seguintes", () => {
    const doc: NoDoDocumento[] = [
      { children: [{ text: "Anexo I" }], type: "toggle" },
      p("conteúdo do anexo", { indent: 1 }),
    ];
    expect(documentoParaHtml(doc)).toBe('<p>Anexo I</p><p style="margin-left:24px">conteúdo do anexo</p>');
  });

  it("sumário não vai para o contrato", () => {
    // O TOC é da tela: o contrato impresso não tem links.
    const doc: NoDoDocumento[] = [{ children: [{ text: "" }], type: "toc" }, p("depois")];
    expect(documentoParaHtml(doc)).toBe("<p>depois</p>");
    expect(documentoParaTexto(doc)).toBe("\ndepois");
  });
});

describe("código, diagrama e fórmula", () => {
  it("code_block vira <pre> com as linhas unidas por quebra e a linguagem no data-lang", () => {
    const doc: NoDoDocumento[] = [
      {
        children: [
          { children: [{ text: "SELECT 1;" }], type: "code_line" },
          { children: [{ text: "SELECT <2>;" }], type: "code_line" },
        ],
        lang: "sql",
        type: "code_block",
      },
    ];
    expect(documentoParaHtml(doc)).toBe(
      '<pre style="font-family:monospace;white-space:pre-wrap;font-size:0.9em" data-lang="sql">SELECT 1;\nSELECT &lt;2&gt;;</pre>',
    );
  });

  it("code_block sem linguagem não escreve data-lang", () => {
    const doc: NoDoDocumento[] = [
      { children: [{ children: [{ text: "x" }], type: "code_line" }], type: "code_block" },
    ];
    expect(documentoParaHtml(doc)).toBe('<pre style="font-family:monospace;white-space:pre-wrap;font-size:0.9em">x</pre>');
  });

  it("code_drawing sai com o código-fonte do diagrama", () => {
    const doc: NoDoDocumento[] = [
      { children: [{ text: "" }], data: { code: "graph TD; A-->B", drawingType: "mermaid" }, type: "code_drawing" },
    ];
    expect(documentoParaHtml(doc)).toBe(
      '<pre style="font-family:monospace;white-space:pre-wrap;font-size:0.9em" data-drawing="mermaid">graph TD; A--&gt;B</pre>',
    );
    expect(documentoParaTexto(doc)).toBe("graph TD; A-->B");
  });

  it("equação em bloco sai centralizada, como TeX; a inline sai como <code>", () => {
    // Sem KaTeX: renderizar exigiria CSS e fontes no destino do contrato.
    const doc: NoDoDocumento[] = [
      { children: [{ text: "" }], texExpression: "x^2", type: "equation" },
      { children: [{ text: "juros de " }, { children: [{ text: "" }], texExpression: "i<1", type: "inline_equation" }], type: "p" },
    ];
    expect(documentoParaHtml(doc)).toBe(
      '<p style="text-align:center"><code>x^2</code></p><p>juros de <code>i&lt;1</code></p>',
    );
  });

  it("aceita texMath (o nome que a especificação citou) além de texExpression (o que o Plate grava)", () => {
    const doc: NoDoDocumento[] = [{ children: [{ text: "" }], texMath: "a+b", type: "equation" }];
    expect(documentoParaHtml(doc)).toContain("<code>a+b</code>");
  });
});

describe("data, menção e nota de rodapé", () => {
  it("data ISO vira dd/mm/aaaa fatiando a string — sem Date, sem UTC", () => {
    // `new Date("2026-09-02")` é meia-noite UTC, que no Brasil ainda é 01/09.
    const doc: NoDoDocumento[] = [{ children: [{ text: "em " }, { children: [{ text: "" }], date: "2026-09-02", type: "date" }], type: "p" }];
    expect(documentoParaHtml(doc)).toBe("<p>em <span>02/09/2026</span></p>");
    expect(documentoParaTexto(doc)).toBe("em 02/09/2026");
  });

  it("data fora do padrão sai como veio, escapada", () => {
    const doc: NoDoDocumento[] = [{ children: [{ children: [{ text: "" }], date: "amanhã", type: "date" }], type: "p" }];
    expect(documentoParaHtml(doc)).toBe("<p><span>amanhã</span></p>");
  });

  it("menção vira @valor — é para comentário, não é variável", () => {
    const doc: NoDoDocumento[] = [{ children: [{ children: [{ text: "" }], type: "mention", value: "Lucas" }], type: "p" }];
    expect(documentoParaHtml(doc)).toBe("<p>@Lucas</p>");
    expect(classificarVariaveis(documentoParaHtml(doc)).conhecidas).toEqual([]);
  });

  it("nota de rodapé: referência vira <sup>n</sup> pela ordem da definição; a definição vira parágrafo pequeno", () => {
    const doc: NoDoDocumento[] = [
      {
        children: [
          { text: "Cláusula" },
          { children: [{ text: "" }], identifier: "b", type: "footnoteReference" },
          { text: " e outra" },
          { children: [{ text: "" }], identifier: "a", type: "footnoteReference" },
        ],
        type: "p",
      },
      { children: [{ text: "primeira nota" }], identifier: "b", type: "footnoteDefinition" },
      { children: [{ text: "segunda nota" }], identifier: "a", type: "footnoteDefinition" },
    ];
    expect(documentoParaHtml(doc)).toBe(
      "<p>Cláusula<sup>1</sup> e outra<sup>2</sup></p>" +
        '<p style="font-size:0.85em"><sup>1</sup> primeira nota</p>' +
        '<p style="font-size:0.85em"><sup>2</sup> segunda nota</p>',
    );
  });

  it("referência sem definição mostra o identificador, e no texto puro não vira variável falsa", () => {
    const doc: NoDoDocumento[] = [
      { children: [{ text: "x" }, { children: [{ text: "" }], identifier: "10", type: "footnoteReference" }], type: "p" },
    ];
    expect(documentoParaHtml(doc)).toBe("<p>x<sup>10</sup></p>");
    // "[10]" no texto puro casaria a regex de variável e viraria "desconhecida 10".
    expect(documentoParaTexto(doc)).toBe("x");
  });
});

describe("mídia — o contrato é papel", () => {
  it("imagem vira figure com src, alt e legenda", () => {
    const doc: NoDoDocumento[] = [
      {
        caption: [{ children: [{ text: "Planta do lote" }], type: "p" }],
        children: [{ text: "" }],
        type: "img",
        url: "https://x.supabase.co/storage/v1/object/sign/apolo-documents/temis-minutas/1/a.png?token=t&x=1",
        width: 320,
      },
    ];
    expect(documentoParaHtml(doc)).toBe(
      '<figure style="margin:8px 0;text-align:center">' +
        '<img src="https://x.supabase.co/storage/v1/object/sign/apolo-documents/temis-minutas/1/a.png?token=t&amp;x=1" alt="Planta do lote" style="max-width:100%;width:320px" />' +
        '<figcaption style="font-size:0.9em;color:#555">Planta do lote</figcaption>' +
        "</figure>",
    );
    expect(documentoParaTexto(doc)).toBe("Planta do lote");
  });

  it("imagem sem legenda nem largura, alinhada à esquerda", () => {
    const doc: NoDoDocumento[] = [{ align: "left", children: [{ text: "" }], type: "img", url: "u.png" }];
    expect(documentoParaHtml(doc)).toBe(
      '<figure style="margin:8px 0;text-align:left"><img src="u.png" alt="" style="max-width:100%" /></figure>',
    );
  });

  it("largura em string (percentual) vai como está", () => {
    const doc: NoDoDocumento[] = [{ children: [{ text: "" }], type: "img", url: "u.png", width: "50%" }];
    expect(documentoParaHtml(doc)).toContain("max-width:100%;width:50%");
  });

  it("vídeo, áudio, arquivo e embed viram link — com o nome do arquivo quando houver", () => {
    const doc: NoDoDocumento[] = [
      { children: [{ text: "" }], name: "memorial.pdf", type: "file", url: "https://a/b.pdf" },
      { children: [{ text: "" }], type: "video", url: "https://a/v.mp4" },
      { children: [{ text: "" }], name: "ata.mp3", type: "audio", url: "https://a/ata.mp3" },
      { children: [{ text: "" }], type: "media_embed", url: "https://youtu.be/x" },
    ];
    expect(documentoParaHtml(doc)).toBe(
      '<p><a href="https://a/b.pdf">memorial.pdf</a></p>' +
        '<p><a href="https://a/v.mp4">https://a/v.mp4</a></p>' +
        '<p><a href="https://a/ata.mp3">ata.mp3</a></p>' +
        '<p><a href="https://youtu.be/x">https://youtu.be/x</a></p>',
    );
  });

  it("resolverMidia troca a URL na hora de gerar, sem mexer no documento", () => {
    const doc: NoDoDocumento[] = [
      { children: [{ text: "" }], type: "img", url: "assinada?token=velho" },
      { children: [{ text: "" }], name: "x.pdf", type: "file", url: "arquivo?token=velho" },
    ];
    const html = documentoParaHtml(doc, { resolverMidia: (url) => url.replace("velho", "novo") });
    expect(html).toContain('src="assinada?token=novo"');
    expect(html).toContain('href="arquivo?token=novo"');
    expect(doc[0]?.url).toBe("assinada?token=velho");
  });

  it("upload pela metade (placeholder) não vira nada", () => {
    const doc: NoDoDocumento[] = [{ children: [{ text: "" }], type: "placeholder" }, p("x")];
    expect(documentoParaHtml(doc)).toBe("<p>x</p>");
  });

  it("midiasDoDocumento lista as mídias com url, em qualquer profundidade", () => {
    const doc: NoDoDocumento[] = [
      { children: [{ text: "" }], type: "img", url: "a.png" },
      {
        children: [
          { children: [{ children: [{ children: [{ text: "" }], name: "m.pdf", type: "file", url: "m.pdf" }], type: "td" }], type: "tr" },
        ],
        type: "table",
      },
      { children: [{ text: "" }], type: "placeholder" },
      { children: [{ text: "" }], type: "img" },
    ];
    expect(midiasDoDocumento(doc)).toEqual([
      { tipo: "img", url: "a.png" },
      { nome: "m.pdf", tipo: "file", url: "m.pdf" },
    ]);
  });

  it("trocarUrlsDeMidia re-assina em qualquer profundidade, sem tocar no original nem no que falhou", () => {
    // A URL do nó expira (7 dias): a tela troca cada uma ao abrir. `null` = fica como está.
    const doc: NoDoDocumento[] = [
      { children: [{ text: "" }], type: "img", url: "a.png" },
      {
        children: [
          { children: [{ children: [{ children: [{ text: "" }], name: "m.pdf", type: "file", url: "m.pdf" }], type: "td" }], type: "tr" },
        ],
        type: "table",
      },
      p("texto com [nome_cliente]"),
    ];
    const novo = trocarUrlsDeMidia(doc, (url) => (url === "a.png" ? "a-nova.png" : null));

    expect(midiasDoDocumento(novo)).toEqual([
      { tipo: "img", url: "a-nova.png" },
      { nome: "m.pdf", tipo: "file", url: "m.pdf" },
    ]);
    expect(midiasDoDocumento(doc)[0]?.url).toBe("a.png");
    // Quem não mudou é o MESMO objeto (o React não vê troca onde não houve).
    expect(novo[2]).toBe(doc[2]);
    expect(novo[0]).not.toBe(doc[0]);
  });
});

describe("revisão — comentários e sugestões não vão para o contrato", () => {
  it("a marca de comentário é ignorada e o texto sai; o texto que a sugestão INSERE não sai", () => {
    const doc: NoDoDocumento[] = [
      {
        children: [
          { comment: true, comment_abc: true, text: "com comentário " } as NoDoDocumento["children"] extends (infer T)[] ? T : never,
          { suggestion: true, suggestion_xyz: { type: "insert" }, text: "sugerido" } as NoDoDocumento["children"] extends (infer T)[] ? T : never,
        ],
        type: "p",
      },
    ];
    expect(documentoParaHtml(doc)).toBe("<p>com comentário </p>");
  });

  it("sugestão pendente: o trecho marcado para REMOVER sai (é o original); o INSERIDO, não", () => {
    // Modo Sugerir: "30 (trinta) dias" → "45 (quarenta e cinco) dias". Antes o contrato saía com os
    // dois emendados: "30 (trinta) dias45 (quarenta e cinco) dias".
    const doc: NoDoDocumento[] = [
      {
        children: [
          { text: "Prazo de " },
          { suggestion: true, suggestion_x: { type: "remove" }, text: "30 (trinta) dias" } as never,
          { suggestion: true, suggestion_x: { type: "insert" }, text: "45 (quarenta e cinco) dias" } as never,
          { text: "." },
        ],
        type: "p",
      },
    ];
    expect(documentoParaHtml(doc)).toBe("<p>Prazo de 30 (trinta) dias.</p>");
    expect(documentoParaTexto(doc)).toBe("Prazo de 30 (trinta) dias.");
  });

  it("sugestão de `update` (troca de marca) não mexe no texto", () => {
    const doc: NoDoDocumento[] = [
      { children: [{ bold: true, suggestion: true, suggestion_x: { type: "update" }, text: "x" } as never], type: "p" },
    ];
    expect(documentoParaHtml(doc)).toBe("<p><strong>x</strong></p>");
  });

  it("bloco inteiro proposto por sugestão não entra — nem abre lista vazia", () => {
    const doc: NoDoDocumento[] = [
      p("Cláusula 1."),
      { children: [{ text: "Cláusula nova" }], suggestion: { type: "insert" }, type: "p" },
      { children: [{ text: "item sugerido" }], indent: 1, listStyleType: "disc", suggestion: { type: "insert" }, type: "p" },
      p("Cláusula 2."),
    ];
    expect(documentoParaHtml(doc)).toBe("<p>Cláusula 1.</p><p>Cláusula 2.</p>");
  });

  it("bloco marcado para REMOVER sai: ainda é o original", () => {
    const doc: NoDoDocumento[] = [
      { children: [{ text: "Cláusula antiga" }], suggestion: { type: "remove" }, type: "p" },
    ];
    expect(documentoParaHtml(doc)).toBe("<p>Cláusula antiga</p>");
  });

  it("temSugestoesPendentes acha a marca no texto, no bloco e em qualquer profundidade", () => {
    expect(temSugestoesPendentes([p("limpo")])).toBe(false);
    expect(temSugestoesPendentes([{ children: [{ suggestion: true, text: "x" }], type: "p" }])).toBe(true);
    // Só a marca com id (minuta salva no meio de uma revisão).
    expect(
      temSugestoesPendentes([{ children: [{ suggestion_1: { type: "remove" }, text: "x" } as never], type: "p" }]),
    ).toBe(true);
    // Bloco inteiro sugerido.
    expect(temSugestoesPendentes([{ children: [{ text: "x" }], suggestion: { type: "insert" }, type: "p" }])).toBe(true);
    // Dentro de uma célula.
    expect(
      temSugestoesPendentes([
        { children: [{ children: [{ children: [{ children: [{ suggestion: true, text: "x" }], type: "p" }], type: "td" }], type: "tr" }], type: "table" },
      ]),
    ).toBe(true);
    // Comentário NÃO é sugestão.
    expect(temSugestoesPendentes([{ children: [{ comment: true, text: "x" }], type: "p" }])).toBe(false);
  });
});

describe("fonte e cor — 450 dos 485 trechos da minuta real têm fonte própria", () => {
  it("preserva a família da fonte", () => {
    // Medido na minuta do JDG: 128 spans, todos com 'Lucida Sans Unicode'. Normalizar mudaria a cara
    // de todas as linhas do contrato impresso.
    const doc: NoDoDocumento[] = [
      { children: [{ fontFamily: "'Lucida Sans Unicode', sans-serif", text: "VENDEDORA" }], type: "p" },
    ];
    expect(documentoParaHtml(doc)).toBe(
      `<p><span style="font-family:'Lucida Sans Unicode', sans-serif">VENDEDORA</span></p>`,
    );
  });

  it("o span vem POR FORA das marcas, para a fonte valer no trecho inteiro", () => {
    const doc: NoDoDocumento[] = [
      { children: [{ bold: true, fontFamily: "Georgia", text: "x" }], type: "p" },
    ];
    expect(documentoParaHtml(doc)).toBe('<p><span style="font-family:Georgia"><strong>x</strong></span></p>');
  });

  it("junta fonte, tamanho e cor num style só", () => {
    const doc: NoDoDocumento[] = [
      { children: [{ color: "#000000", fontFamily: "Georgia", fontSize: "12pt", text: "x" }], type: "p" },
    ];
    expect(documentoParaHtml(doc)).toContain(
      'style="font-family:Georgia;font-size:12pt;color:#000000"',
    );
  });

  it("texto sem estilo NÃO ganha span", () => {
    // Envolver tudo em span incharia o contrato sem motivo.
    expect(documentoParaHtml([p("simples")])).toBe("<p>simples</p>");
  });

  it("trechos vizinhos com o MESMO estilo saem num span só — inclusive em volta da variável", () => {
    // É o que a promoção produz a partir de `<span style>COMPRADOR(ES):[nome_cliente]</span>`:
    // três trechos. Um span por trecho fazia o HTML da minuta crescer 33% só de abrir e salvar.
    const doc: NoDoDocumento[] = [
      {
        children: [
          { fontFamily: "Georgia", text: "COMPRADOR(ES):" },
          variavel("nome_cliente", { fontFamily: "Georgia" }),
          { fontFamily: "Georgia", text: "" },
        ],
        type: "p",
      },
    ];
    expect(documentoParaHtml(doc)).toBe(
      '<p><span style="font-family:Georgia">COMPRADOR(ES):[nome_cliente]</span></p>',
    );
  });

  it("e a marca igual também se junta: o negrito veste 'Quadra [numero_quadra] x' inteiro", () => {
    const doc: NoDoDocumento[] = [
      {
        children: [
          { bold: true, fontFamily: "Georgia", text: "Quadra " },
          variavel("numero_quadra", { bold: true, fontFamily: "Georgia" }),
          { bold: true, fontFamily: "Georgia", text: " x" },
        ],
        type: "p",
      },
    ];
    expect(documentoParaHtml(doc)).toBe(
      '<p><span style="font-family:Georgia"><strong>Quadra [numero_quadra] x</strong></span></p>',
    );
  });

  it("estilo diferente NÃO se junta, e a marca diferente dentro do mesmo estilo vira outra tag", () => {
    const doc: NoDoDocumento[] = [
      {
        children: [
          { fontFamily: "Georgia", text: "a" },
          { bold: true, fontFamily: "Georgia", text: "b" },
          { fontFamily: "Arial", text: "c" },
          { text: "d" },
        ],
        type: "p",
      },
    ];
    expect(documentoParaHtml(doc)).toBe(
      '<p><span style="font-family:Georgia">a<strong>b</strong></span><span style="font-family:Arial">c</span>d</p>',
    );
  });

  it("uma variável dentro de um span estilizado continua sendo achada", () => {
    const doc: NoDoDocumento[] = [
      { children: [{ bold: true, fontFamily: "Georgia", text: "[numero_quadra]" }], type: "p" },
    ];
    const html = documentoParaHtml(doc);
    expect(classificarVariaveis(html).conhecidas.map((c) => c.nome)).toEqual(["numero_quadra"]);
  });
});

describe("entrelinha, recuo de primeira linha e link", () => {
  it("entrelinha vai para o style", () => {
    expect(documentoParaHtml([p("x", { lineHeight: 1.5 })])).toBe(
      '<p style="line-height:1.5">x</p>',
    );
  });

  it("recuo de primeira linha", () => {
    expect(documentoParaHtml([p("x", { textIndent: 1 })])).toBe(
      '<p style="text-indent:24px">x</p>',
    );
  });

  it("link vira <a href>, com o endereço escapado", () => {
    const doc: NoDoDocumento[] = [
      {
        children: [{ children: [{ text: "cartório" }], type: "a", url: "https://exemplo.com?a=1&b=2" }],
        type: "p",
      },
    ];
    expect(documentoParaHtml(doc)).toBe(
      '<p><a href="https://exemplo.com?a=1&amp;b=2">cartório</a></p>',
    );
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
