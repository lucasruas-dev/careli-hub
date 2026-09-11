import { describe, expect, it } from "vitest";

import {
  baseMudou,
  impressaoDaBase,
  sanitizarHtmlDoContrato,
  variaveisAindaEmBranco,
} from "./contrato-editado";

// O CONTRATO ALTERADO À MÃO.
//
// O gesto real que estes testes cobrem não é o ataque: é o operador que copia um parágrafo de outro
// contrato, de um e-mail ou de uma página, e cola dentro da folha. Junto com a frase vêm scripts,
// rastreadores e atributos que nada têm a ver com um contrato — e tudo isso iria para o Chromium
// que gera o PDF.

describe("sanitizarHtmlDoContrato — o que sobrevive à colagem", () => {
  it("mantém o parágrafo, a formatação e a tabela", () => {
    const r = sanitizarHtmlDoContrato(
      '<p style="text-align:justify">O <strong>COMPRADOR</strong> declara <em>ciência</em>.</p>' +
        '<table style="border-collapse:collapse"><tr><td colspan="2">Quadra 01</td></tr></table>',
    );

    expect(r.html).toContain("<strong>COMPRADOR</strong>");
    expect(r.html).toContain('colspan="2"');
    expect(r.html).toContain('style="text-align:justify"');
    expect(r.removeu).toEqual([]);
  });

  it("tira o script e o miolo dele junto", () => {
    const r = sanitizarHtmlDoContrato(
      '<p>Cláusula 1ª.</p><script>fetch("/api/roubo")</script><p>Cláusula 2ª.</p>',
    );

    // ⚠️ O CÓDIGO NÃO PODE VIRAR PARÁGRAFO. Desembrulhar o script deixaria `fetch("/api/roubo")`
    // impresso no meio do contrato — some a marcação, fica o texto.
    expect(r.html).not.toContain("fetch");
    expect(r.html).toContain("Cláusula 1ª.");
    expect(r.html).toContain("Cláusula 2ª.");
    expect(r.removeu).toContain("trechos <script>");
  });

  it("tira o `onerror` da imagem e deixa a imagem", () => {
    const r = sanitizarHtmlDoContrato(
      '<img src="https://cofre/logo.png" onerror="alert(1)" alt="Logo" />',
    );

    expect(r.html).not.toContain("onerror");
    expect(r.html).toContain('src="https://cofre/logo.png"');
    expect(r.html).toContain('alt="Logo"');
  });

  it("desembrulha a tag que não pertence ao documento sem perder a frase", () => {
    // Um `<form>` colado de uma página não pode virar campo no PDF; a frase de dentro é do contrato.
    const r = sanitizarHtmlDoContrato("<form><p>Fica eleito o foro da comarca.</p></form>");

    expect(r.html).toContain("Fica eleito o foro da comarca.");
    expect(r.html).not.toContain("<form");
    expect(r.removeu.join(" ")).toContain("form");
  });

  it("recusa href de esquema estranho e mantém o texto do link", () => {
    const r = sanitizarHtmlDoContrato('<a href="javascript:alert(1)">cláusula</a>');

    expect(r.html).not.toContain("javascript:");
    expect(r.html).toContain("cláusula");
  });

  it("aceita imagem embutida e recusa página disfarçada de endereço", () => {
    // A figura da minuta chega como `data:image/...`; `data:text/html` é uma página inteira.
    expect(sanitizarHtmlDoContrato('<img src="data:image/png;base64,iVBOR" />').html).toContain(
      "data:image/png",
    );
    expect(
      sanitizarHtmlDoContrato('<img src="data:text/html;base64,PHNjcmlwdD4=" />').html,
    ).not.toContain("data:text");
  });

  it("não corta a tag no `>` que está dentro das aspas", () => {
    // ⚠️ ESTE É O DEFEITO QUE UM `/<[^>]*>/` TERIA: o corte deixaria `50%">` impresso na folha.
    const r = sanitizarHtmlDoContrato('<td style="width:>50%">Lote 03</td>');

    // A tag volta INTEIRA. Cortando no primeiro `>`, o sanitizador leria a tag como
    // `style="width:` e o resto (`50%">Lote 03`) viraria texto impresso na folha.
    expect(r.html).toBe('<td style="width:>50%">Lote 03</td>');
  });

  it("tira comentário de HTML", () => {
    const r = sanitizarHtmlDoContrato("<p>Cláusula</p><!-- rastreador colado junto -->");

    expect(r.html).not.toContain("rastreador");
    expect(r.removeu).toContain("comentários de HTML");
  });
});

describe("impressaoDaBase — a alteração manual não pode envelhecer calada", () => {
  it("mesma base, mesma impressão", () => {
    expect(impressaoDaBase("<p>a</p>")).toBe(impressaoDaBase("<p>a</p>"));
  });

  it("acusa quando o cadastro mudou depois da edição", () => {
    const antes = impressaoDaBase("<p>CPF 999.999.006-15</p>");

    // Alguém corrigiu o CPF no Apolo depois que a edição foi salva: o texto editado é uma FOTO e
    // continuaria com o número velho. Sem este aviso, o papel sai errado sem ninguém errar.
    expect(baseMudou({ baseImpressao: antes }, "<p>CPF 111.222.333-44</p>")).toBe(true);
    expect(baseMudou({ baseImpressao: antes }, "<p>CPF 999.999.006-15</p>")).toBe(false);
  });

  it("edição antiga, sem impressão gravada, não acusa mudança falsa", () => {
    expect(baseMudou({ baseImpressao: null }, "<p>qualquer coisa</p>")).toBe(false);
  });
});

describe("variaveisAindaEmBranco — a trava mede o papel, não a montagem", () => {
  it("libera a variável que a pessoa preencheu à mão", () => {
    const html = "<p>CPF 999.999.006-15, RG [rg_cliente]</p>";

    // O motor declarou as duas vazias; o operador digitou o CPF por cima do colchete.
    expect(variaveisAindaEmBranco(html, ["cpf_cliente", "rg_cliente"])).toEqual(["rg_cliente"]);
  });

  it("continua barrando o buraco que ficou", () => {
    expect(variaveisAindaEmBranco("<p>[cpf_cliente]</p>", ["cpf_cliente"])).toEqual([
      "cpf_cliente",
    ]);
  });

  it("não inventa variável a partir de colchete escrito pelo jurídico", () => {
    // ⚠️ POR ISSO A LISTA VEM DO MOTOR. Uma regex de `[algo]` acusaria "[sic]" e "[assinatura]" —
    // colchetes que alguém escreveu de propósito — e travaria a emissão de um contrato correto.
    expect(variaveisAindaEmBranco("<p>conforme [sic] o item [assinatura]</p>", [])).toEqual([]);
  });
});
