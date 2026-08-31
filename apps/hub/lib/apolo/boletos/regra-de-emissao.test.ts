import { describe, expect, it } from "vitest";

import {
  bloqueioDoTexto,
  resumirEmissao,
  vereditoDaLinha,
} from "./regra-de-emissao";

// ⚠️ OS CASOS DESTE ARQUIVO SÃO REAIS, tirados do arquivo de 31/08/2026. Cada um deles viraria
// um boleto indevido — ou a falta de um boleto devido — se a regra mudasse.

describe("valor calculado NÃO basta para emitir", () => {
  it("o caso que dá nome à regra: Gustavo Augusto Coelho, Ed. Esmeralda", () => {
    // R$ 1.682,16 calculados para setembro E a observação "Não fazer", com o rodapé da aba
    // explicando: a obra atrasou e a parcela foi paralisada.
    const v = vereditoDaLinha({
      nome: "GUSTAVO AUGUSTO COLEHO",
      observacao: "Não fazer",
      valor: 1682.164607412833,
    });
    expect(v.emite).toBe(false);
    if (!v.emite) expect(v.motivo).toBe("marcado-nao-fazer");
  });

  it("“Não fazer” DENTRO da célula do mês — Everton, Ed. Cristal", () => {
    const v = vereditoDaLinha({ marcaNoMes: "Não fazer", nome: "EVERTON VINICIUS DA SILVEIRA" });
    expect(v.emite).toBe(false);
  });

  it("a marcação vence o valor, mesmo com os dois presentes", () => {
    const v = vereditoDaLinha({ marcaNoMes: "Não fazer", nome: "X", valor: 5000 });
    expect(v.emite).toBe(false);
  });
});

describe("as marcações reais do arquivo", () => {
  it("pago adiantado — Giant Towers", () => {
    expect(bloqueioDoTexto("PAGO ATÉ MAIO/27 RETOMA JUNHO/27")).toBe("pago-adiantado");
    expect(bloqueioDoTexto("PAGO ATÉ DEZ/26 RETOMA JAN/27")).toBe("pago-adiantado");
  });

  it("pago adiantado no jeito que o Garden escreve", () => {
    expect(bloqueioDoTexto("PAGOU A DE SET")).toBe("pago-adiantado");
    expect(bloqueioDoTexto("PAGOU ATÉ NOV/2026 RETOMA DEZ/2026")).toBe("pago-adiantado");
  });

  it("ainda não começou — Ana Clara, Vale do Sol", () => {
    expect(bloqueioDoTexto("COMEÇA PAGAR EM NOV")).toBe("nao-comecou");
  });

  it("carnê já entregue — Henrique, Guaimbé", () => {
    expect(bloqueioDoTexto("CARNÊ ENVIADO ATÉ DEZ/2026")).toBe("carne-ja-enviado");
  });

  it("reconhece sem acento e sem caixa", () => {
    expect(bloqueioDoTexto("nao fazer")).toBe("marcado-nao-fazer");
    expect(bloqueioDoTexto("NÃO FAZER")).toBe("marcado-nao-fazer");
  });
});

describe("nem toda observação bloqueia", () => {
  // Se estas bloqueassem, dois clientes ficariam sem cobrança sem ninguém perceber.
  it("“PARCELA IREAJUSTAVEL” é informativa — Bruna, Guaimbé", () => {
    expect(bloqueioDoTexto("PARCELA IREAJUSTAVEL")).toBeNull();
    const v = vereditoDaLinha({
      nome: "Bruna",
      observacao: "PARCELA IREAJUSTAVEL",
      valor: 1400,
    });
    expect(v.emite).toBe(true);
  });

  it("“PARCELA FIXA PAGA TODOS OS REAJUSTES…” também — Angela, Giant", () => {
    const v = vereditoDaLinha({
      nome: "ANGELA MARIA DE ARAUJO",
      observacao: "PARCELA FIXA PAGA TODOS OS REAJUSTES DO ANO ATUAL NO PROXIMO",
      valor: 3000,
    });
    expect(v.emite).toBe(true);
    if (v.emite) expect(v.observacao).toContain("PARCELA FIXA");
  });
});

describe("texto desconhecido no lugar do valor também não emite", () => {
  it("na dúvida, não decide pelo operador", () => {
    const v = vereditoDaLinha({ marcaNoMes: "verificar com o financeiro", nome: "Y" });
    expect(v.emite).toBe(false);
    if (!v.emite) expect(v.explicacao).toContain("verificar com o financeiro");
  });
});

describe("valor ausente ou zerado", () => {
  it("sem valor não emite — Vitor Honorato, Ed. Cristal", () => {
    const v = vereditoDaLinha({ nome: "VITOR HONORATO DA SILVA" });
    expect(v.emite).toBe(false);
    if (!v.emite) expect(v.motivo).toBe("sem-valor");
  });

  it("zero não emite — Thiago Tavares, Vale do Ouro", () => {
    const v = vereditoDaLinha({ nome: "THIAGO TAVARES PEREIRA", valor: 0 });
    expect(v.emite).toBe(false);
    if (!v.emite) expect(v.motivo).toBe("valor-zerado");
  });
});

describe("o resumo que a tela mostra antes do clique", () => {
  it("conta, soma e explica cada exclusão", () => {
    const r = resumirEmissao([
      { nome: "A", valor: 2119.05 },
      { nome: "B", valor: 1000.5 },
      { nome: "C", observacao: "Não fazer", valor: 1682.16 },
      { nome: "D", valor: 0 },
      { nome: "E" },
    ]);
    expect(r.emitem).toBe(2);
    expect(r.total).toBe(3119.55);
    expect(r.fora).toHaveLength(3);
    expect(r.fora.map((f) => f.nome)).toEqual(["C", "D", "E"]);
  });

  it("a soma fecha em centavos mesmo com casas longas", () => {
    // A planilha nunca arredonda: os valores chegam com 13 casas decimais.
    const r = resumirEmissao([
      { nome: "A", valor: 2207.1729284232347 },
      { nome: "B", valor: 2231.973092376779 },
    ]);
    expect(r.total).toBe(4439.15);
  });
});
