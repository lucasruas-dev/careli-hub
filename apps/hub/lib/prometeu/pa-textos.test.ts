import { describe, expect, it } from "vitest";

import {
  declaracaoParaHtml,
  formatarLinhaDaPa,
  resolverTextosDaPa,
  TEXTOS_PADRAO_DA_PA,
} from "./pa-textos";

describe("resolver mescla campo a campo, nunca o bloco inteiro", () => {
  it("sem nada gravado, saem os padrões — a folha de sempre", () => {
    const t = resolverTextosDaPa(undefined);
    expect(t.declaracoes).toHaveLength(9);
    expect(t.clausulaSinal).toContain("dois dias úteis");
  });

  it("editou SÓ a cláusula do sinal: as declarações continuam do padrão", () => {
    const t = resolverTextosDaPa({ clausulaSinal: "Sinal em 5 dias." });
    expect(t.clausulaSinal).toBe("Sinal em 5 dias.");
    expect(t.declaracoes).toEqual(TEXTOS_PADRAO_DA_PA.declaracoes);
  });

  it("string vazia e lista vazia NÃO apagam o padrão", () => {
    const t = resolverTextosDaPa({ clausulaSinal: "   ", declaracoes: [] });
    expect(t.clausulaSinal).toBe(TEXTOS_PADRAO_DA_PA.clausulaSinal);
    expect(t.declaracoes).toHaveLength(9);
  });

  it("declaração em branco no meio da lista é descartada", () => {
    const t = resolverTextosDaPa({ declaracoes: ["Primeira.", "  ", "Segunda."] });
    expect(t.declaracoes).toEqual(["Primeira.", "Segunda."]);
  });
});

describe("negrito com *asterisco*, como no WhatsApp", () => {
  it("*8% (oito por cento)* vira <b>", () => {
    expect(formatarLinhaDaPa("total de *8% (oito por cento)* sobre o valor")).toBe(
      "total de <b>8% (oito por cento)</b> sobre o valor",
    );
  });

  it("asterisco solto não quebra nada", () => {
    expect(formatarLinhaDaPa("5 * 3 = 15")).toBe("5 * 3 = 15");
  });

  it("HTML digitado no Setup NÃO passa para a folha", () => {
    expect(formatarLinhaDaPa('<script>alert("x")</script>')).not.toContain("<script>");
    expect(formatarLinhaDaPa("a <b>na unha</b>")).toBe("a &lt;b&gt;na unha&lt;/b&gt;");
  });
});

describe("sub-itens por linha a), b), c)", () => {
  it("viram a sub-lista alfabética da folha", () => {
    const html = declaracaoParaHtml("Contratei os serviços, ciente que:\na) primeiro item;\nb) segundo item;");
    expect(html).toContain('<ol type="a">');
    expect(html).toContain("<li>primeiro item;</li>");
    expect(html).toContain("<li>segundo item;</li>");
  });

  it("sem sub-itens, sai só o parágrafo", () => {
    expect(declaracaoParaHtml("Declaro estar ciente.")).toBe("Declaro estar ciente.");
  });

  it("o padrão da casa gera exatamente os 3 sub-itens dos honorários", () => {
    const html = declaracaoParaHtml(TEXTOS_PADRAO_DA_PA.declaracoes[5]!);
    expect(html.match(/<li>/g)?.length).toBe(3);
    expect(html).toContain("<b>8% (oito por cento)</b>");
  });
});
