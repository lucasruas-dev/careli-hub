import { describe, expect, it } from "vitest";

import { apurarFatosDoContrato } from "./fatos-do-contrato";

describe("apurarFatosDoContrato", () => {
  it("venda nascida aqui, sem evento nenhum: não assinou e não pagou", () => {
    // As três propostas nativas de hoje têm ZERO eventos — a Têmis nem gera minuta ainda. Silêncio
    // das duas fontes é resposta, não ignorância: é o que dispensa a pergunta ao coordenador.
    const f = apurarFatosDoContrato([], {});
    expect(f.assinaturaCompleta).toBe(false);
    expect(f.houvePagamento).toBe(false);
    expect(f.comoSoube.assinatura).toBe("nenhuma assinatura registrada");
    expect(f.comoSoube.pagamento).toBe("nenhum pagamento registrado");
  });

  it("⚠️ `primeiro_sinal` NÃO é pagamento — é a data prevista da primeira parcela", () => {
    // Nas três nativas ele vale 10/09/2026, no futuro. Lê-lo como pagamento classificaria como
    // distrato com devolução toda venda recém-criada, devolvendo dinheiro que ninguém pagou.
    // Ele nem entra no tipo: este teste existe para travar a tentação de acrescentá-lo.
    const f = apurarFatosDoContrato([], { data_ato: null });
    expect(f.houvePagamento).toBe(false);
  });

  it("evento de assinatura conta, e a frase diz quantos", () => {
    const f = apurarFatosDoContrato([{ tipo: "assinatura" }, { tipo: "assinatura" }], {});
    expect(f.assinaturaCompleta).toBe(true);
    expect(f.comoSoube.assinatura).toBe("2 assinaturas registradas");
  });

  it("evento de pagamento conta, no singular e no plural", () => {
    expect(apurarFatosDoContrato([{ tipo: "pagamento" }], {}).comoSoube.pagamento).toBe(
      "1 pagamento registrado",
    );
    expect(apurarFatosDoContrato([{ tipo: "pagamento" }], {}).houvePagamento).toBe(true);
  });

  it("as datas da própria proposta também respondem", () => {
    const f = apurarFatosDoContrato([], {
      data_assinatura: "2026-08-14",
      data_ato: "2026-08-20",
    });
    expect(f.assinaturaCompleta).toBe(true);
    expect(f.houvePagamento).toBe(true);
    expect(f.comoSoube.assinatura).toBe("contrato assinado em 14/08/2026");
    expect(f.comoSoube.pagamento).toBe("ato pago em 20/08/2026");
  });

  it("⚠️ faturada conta como paga: ela passou pelo caixa", () => {
    // Tratar uma venda faturada como não paga faria o jurídico cancelar sem apurar o que devolver.
    const f = apurarFatosDoContrato([], { data_faturamento: "2026-07-01" });
    expect(f.houvePagamento).toBe(true);
    expect(f.comoSoube.pagamento).toBe("faturada em 01/07/2026");
  });

  it("a data curta não vira Date: o fuso deslocaria o dia", () => {
    expect(apurarFatosDoContrato([], { data_ato: "2026-01-01" }).comoSoube.pagamento).toContain(
      "01/01/2026",
    );
  });

  it("tipo em caixa alta ou com espaço continua contando", () => {
    const f = apurarFatosDoContrato([{ tipo: " Pagamento " }], {});
    expect(f.houvePagamento).toBe(true);
  });

  it("evento de outro tipo não conta para nenhum dos dois", () => {
    const f = apurarFatosDoContrato([{ tipo: "etapa" }, { tipo: "" }], {});
    expect(f.assinaturaCompleta).toBe(false);
    expect(f.houvePagamento).toBe(false);
  });
});
