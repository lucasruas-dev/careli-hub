import { describe, expect, it } from "vitest";

import {
  TEMPLATE_BOLETO_CORPO,
  TEMPLATE_BOLETO_EXEMPLO,
  competenciaPorExtenso,
  dataPorExtenso,
  parametrosDoBoleto,
  previaDaMensagem,
  primeiroNomeParaSaudacao,
  rotuloDaParcela,
  valorParaOTexto,
} from "./template-whatsapp";

// ⚠️ ISTO CHEGA NO WHATSAPP DE UMA PESSOA. Mensagem enviada não volta, e cada caso aqui é um cliente
// lendo algo errado sobre a própria dívida.

const BASE = {
  competencia: "2026-09",
  empreendimento: "Ed. Rubi",
  link: "https://www.asaas.com/i/abc123",
  nome: "MARCELO SALDANHA NUNES",
  parcelaAtual: 9,
  totalParcelas: 36,
  unidade: "302",
  valor: 2102.577106828294,
  vencimento: "2026-09-20",
};

describe("o template, como texto", () => {
  it("declara exatamente os sete parâmetros que a função produz", () => {
    // ⚠️ É ESTE O DESENCONTRO QUE A META RECUSA NO DISPARO, com o boleto já emitido. O erro dela
    // fala de "number of parameters" e não diz qual campo faltou.
    const noTexto = [...TEMPLATE_BOLETO_CORPO.matchAll(/\{\{(\d)\}\}/g)].map((m) => Number(m[1]));
    expect(new Set(noTexto).size).toBe(7);
    expect(Math.max(...noTexto)).toBe(7);
    expect(parametrosDoBoleto(BASE)).toHaveLength(7);
    expect(TEMPLATE_BOLETO_EXEMPLO).toHaveLength(7);
  });

  it("não começa nem termina com parâmetro", () => {
    // A Meta reprova a criação nos dois casos.
    expect(TEMPLATE_BOLETO_CORPO.trimStart().startsWith("{{")).toBe(false);
    expect(TEMPLATE_BOLETO_CORPO.trimEnd().endsWith("}}")).toBe(false);
  });

  it("não tem dois parâmetros vizinhos", () => {
    // ⚠️ "Vizinhos" para a Meta inclui separados só por espaço ou quebra de linha. É por isso que
    // existe a linha "Acesse o boleto pelo link:" entre o valor e a URL.
    expect(/\{\{\d\}\}\s*\{\{\d\}\}/.test(TEMPLATE_BOLETO_CORPO)).toBe(false);
  });

  it("usa UM asterisco no negrito, que é o do WhatsApp", () => {
    expect(TEMPLATE_BOLETO_CORPO.includes("**")).toBe(false);
    // E os asteriscos fecham em pares.
    expect((TEMPLATE_BOLETO_CORPO.match(/\*/g) ?? []).length % 2).toBe(0);
  });
});

describe("o rótulo da parcela", () => {
  it("escreve 9 de 36 quando a conta fecha", () => {
    expect(rotuloDaParcela({ atual: 9, competencia: "2026-09", total: 36 })).toBe("Parcela 9 de 36");
  });

  it("a última parcela é válida", () => {
    expect(rotuloDaParcela({ atual: 4, competencia: "2026-09", total: 4 })).toBe("Parcela 4 de 4");
  });

  it("CAI PARA A COMPETÊNCIA quando a parcela passa do total", () => {
    // ⚠️ CASO REAL, MEDIDO: Ed. Cristal, unidade 201, tem "Parc. Atual" 7 e "Nº Parc." 5 na planilha
    // de 31/08/2026. "Parcela 7 de 5" no WhatsApp é convite a uma ligação perguntando se o cliente
    // está pagando a mais, e não há resposta boa.
    expect(rotuloDaParcela({ atual: 7, competencia: "2026-09", total: 5 })).toBe(
      "Competência setembro de 2026",
    );
  });

  it("cai para a competência quando falta um dos dois números", () => {
    for (const caso of [
      { atual: null, total: 36 },
      { atual: 9, total: null },
      { atual: undefined, total: undefined },
      { atual: 0, total: 36 },
      { atual: 9, total: 0 },
    ]) {
      expect(
        rotuloDaParcela({ ...caso, competencia: "2026-09" }),
        JSON.stringify(caso),
      ).toBe("Competência setembro de 2026");
    }
  });

  it("nunca devolve vazio — parâmetro vazio faz a Meta recusar a mensagem inteira", () => {
    for (const caso of [
      { atual: null, competencia: "2026-09", total: null },
      { atual: 7, competencia: "2026-01", total: 5 },
      { atual: -1, competencia: "2026-12", total: 10 },
    ]) {
      expect(rotuloDaParcela(caso).trim().length, JSON.stringify(caso)).toBeGreaterThan(0);
    }
  });
});

describe("os parâmetros do disparo", () => {
  it("monta os sete com os dados reais do MARCELO", () => {
    expect(parametrosDoBoleto(BASE)).toEqual([
      "Marcelo",
      "Ed. Rubi",
      "302",
      "Parcela 9 de 36",
      "20/09/2026",
      "2.102,58",
      "https://www.asaas.com/i/abc123",
    ]);
  });

  it("tira o grito do nome em caixa alta", () => {
    // "Olá, MARCELO!" soa como cobrança agressiva na tela do cliente.
    expect(primeiroNomeParaSaudacao("MARCELO SALDANHA NUNES")).toBe("Marcelo");
    expect(primeiroNomeParaSaudacao("Vanessa Rodrigues da Silva")).toBe("Vanessa");
    expect(primeiroNomeParaSaudacao("IZALTINA DE ALMEIDA GONÇALVES SILVA")).toBe("Izaltina");
  });

  it("recusa quando falta qualquer dado, em vez de mandar campo vazio", () => {
    // ⚠️ A Meta recusa a mensagem INTEIRA por um parâmetro em branco, e a recusa acontece no
    // disparo, com o boleto já emitido e o cliente sem aviso.
    expect(parametrosDoBoleto({ ...BASE, nome: "" })).toBeNull();
    expect(parametrosDoBoleto({ ...BASE, empreendimento: "  " })).toBeNull();
    expect(parametrosDoBoleto({ ...BASE, unidade: "" })).toBeNull();
    expect(parametrosDoBoleto({ ...BASE, link: "" })).toBeNull();
    expect(parametrosDoBoleto({ ...BASE, valor: 0 })).toBeNull();
    expect(parametrosDoBoleto({ ...BASE, valor: Number.NaN })).toBeNull();
    expect(parametrosDoBoleto({ ...BASE, vencimento: "" })).toBeNull();
    expect(parametrosDoBoleto({ ...BASE, vencimento: "20 de setembro" })).toBeNull();
  });

  it("sem número de parcela ainda dispara, com a competência no lugar", () => {
    const p = parametrosDoBoleto({ ...BASE, parcelaAtual: null, totalParcelas: null });
    expect(p).not.toBeNull();
    expect(p![3]).toBe("Competência setembro de 2026");
  });

  it("nenhum parâmetro sai vazio nem com quebra de linha", () => {
    // Quebra de linha dentro de um parâmetro também faz a Meta recusar.
    for (const p of parametrosDoBoleto(BASE)!) {
      expect(p.trim().length).toBeGreaterThan(0);
      expect(p).not.toContain("\n");
    }
  });
});

describe("as conversões que o cliente lê", () => {
  it("a data não mostra o dia anterior", () => {
    // ⚠️ `new Date("2026-09-01")` é meia-noite UTC; exibida no Brasil vira 31/08. Um vencimento dia
    // 1º apareceria como do mês passado.
    expect(dataPorExtenso("2026-09-01")).toBe("01/09/2026");
    expect(dataPorExtenso("2026-09-30")).toBe("30/09/2026");
    expect(dataPorExtenso("2026-01-01")).toBe("01/01/2026");
  });

  it("o valor sai no formato brasileiro, com duas casas", () => {
    expect(valorParaOTexto(2102.577106828294)).toBe("2.102,58");
    expect(valorParaOTexto(2000)).toBe("2.000,00");
    expect(valorParaOTexto(10)).toBe("10,00");
    expect(valorParaOTexto(8182.9625496319995)).toBe("8.182,96");
  });

  it("a competência sai por extenso", () => {
    expect(competenciaPorExtenso("2026-09")).toBe("setembro de 2026");
    expect(competenciaPorExtenso("2026-12")).toBe("dezembro de 2026");
  });
});

describe("a prévia que o operador vê antes de disparar", () => {
  it("substitui todos os marcadores, sem sobrar nenhum", () => {
    const texto = previaDaMensagem(parametrosDoBoleto(BASE)!);
    expect(texto).not.toMatch(/\{\{\d\}\}/);
    expect(texto).toContain("Olá, Marcelo!");
    expect(texto).toContain("Ed. Rubi");
    expect(texto).toContain("unidade *302*");
    expect(texto).toContain("Parcela 9 de 36");
    expect(texto).toContain("R$ 2.102,58");
    expect(texto).toContain("https://www.asaas.com/i/abc123");
  });
});

describe("o que a revisão da Meta mudou no texto", () => {
  it("o rótulo do template é neutro, e o substantivo vai na variável", () => {
    // ⚠️ Com o rótulo fixo "Parcela:", o cliente do Ed. Cristal 201 (cuja contagem não fecha) leria
    // "Parcela: setembro de 2026". Rótulo aprovado não se conserta sem nova submissão à Meta.
    expect(TEMPLATE_BOLETO_CORPO).toContain("Referente a:");
    expect(TEMPLATE_BOLETO_CORPO).not.toContain("Parcela:");
  });

  it("a mensagem diz de quem é e o que nunca muda", () => {
    // Boleto por WhatsApp é o vetor de fraude mais comum do mercado imobiliário, e o cliente recebe
    // isto de um número que não tem salvo.
    expect(TEMPLATE_BOLETO_CORPO).toContain("Careli");
    expect(TEMPLATE_BOLETO_CORPO).toContain("chave PIX");
  });

  it("o fecho não nomeia beneficiário — o template serve aos nove empreendimentos", () => {
    for (const marca of ["CER", "Cecílio", "Gurgel", "Garden"]) {
      expect(TEMPLATE_BOLETO_CORPO, marca).not.toContain(marca);
    }
  });

  it("competência inválida não produz 'undefined de '", () => {
    // A guarda `if (!parcela.trim())` deixava passar, porque "undefined de " não está vazio.
    expect(competenciaPorExtenso("")).toBe("");
    expect(competenciaPorExtenso("setembro")).toBe("");
    expect(competenciaPorExtenso("2026-13")).toBe("");
    expect(rotuloDaParcela({ atual: null, competencia: "", total: null })).toBe("");
    expect(parametrosDoBoleto({ ...BASE, competencia: "", parcelaAtual: null, totalParcelas: null })).toBeNull();
  });

  it("quebra de linha no meio do nome nao vai para a Meta", () => {
    // ⚠️ Os dados vem de celula de Excel, onde Alt+Enter chega como uma quebra DENTRO do texto.
    // Um `.trim()` sozinho nao veria, e parametro com quebra de linha faz a Meta recusar a mensagem.
    const p = parametrosDoBoleto({
      ...BASE,
      empreendimento: "Ed.\nRubi",
      nome: "MARCELO\nNUNES",
    });
    expect(p).not.toBeNull();
    for (const valor of p!) expect(valor).not.toContain("\n");
    expect(p![1]).toBe("Ed. Rubi");
  });
});
