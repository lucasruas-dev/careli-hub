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

  // ── A ASSINATURA FEITA NO PANTEON ─────────────────────────────────────────
  //
  // ⚠️ ESTES QUATRO GUARDAM A REGRA DO LUCAS (12/09/2026): *"se ele estiver todo assinado tem que
  // fazer distrato"*. Sem o envelope da Têmis aqui, uma venda nativa assinada por todos na
  // Clicksign respondia "nenhuma assinatura registrada" e o pedido saía como CANCELAMENTO — um
  // contrato assinado desfeito como se nunca tivesse existido, sem distrato e sem devolução.

  it("só o C2X: a venda importada continua respondendo pelas fontes de sempre", () => {
    const f = apurarFatosDoContrato([{ tipo: "assinatura" }], {}, null);
    expect(f.assinaturaCompleta).toBe(true);
    expect(f.comoSoube.assinatura).toBe("1 assinatura registrada");
  });

  it("só o envelope assinado: a venda nativa deixa de dizer que ninguém assinou", () => {
    const f = apurarFatosDoContrato(
      [],
      {},
      { estado: "assinado", fechado_em: "2026-09-11T13:40:00+00:00" },
    );
    expect(f.assinaturaCompleta).toBe(true);
    expect(f.comoSoube.assinatura).toBe("contrato assinado por todos na Clicksign em 11/09/2026");
  });

  it("os dois: o C2X segue narrando, e o fato continua o mesmo", () => {
    // ⚠️ A FRASE NÃO MUDA quando as duas fontes falam: as importadas já são descritas pelo C2X há
    // meses, e o envelope entrou para quebrar o SILÊNCIO das nativas, não para reescrever o que já
    // tinha resposta.
    const f = apurarFatosDoContrato(
      [{ tipo: "assinatura" }],
      { data_assinatura: "2026-08-14" },
      { estado: "assinado", fechado_em: "2026-09-11T13:40:00+00:00" },
    );
    expect(f.assinaturaCompleta).toBe(true);
    expect(f.comoSoube.assinatura).toBe("1 assinatura registrada");
  });

  it("nenhuma das duas: o silêncio continua sendo resposta", () => {
    const f = apurarFatosDoContrato([], {}, { estado: "aguardando", fechado_em: null });
    expect(f.assinaturaCompleta).toBe(false);
    expect(f.comoSoube.assinatura).toBe("nenhuma assinatura registrada");
  });

  it("⚠️ `parcial` NÃO é assinado: meio contrato assinado ainda volta para a análise", () => {
    // Um comprador de dois. Tratá-lo como completo empurraria para o distrato uma venda que só
    // precisava de correção — o contrário exato da regra do Lucas.
    const f = apurarFatosDoContrato([], {}, { estado: "parcial" });
    expect(f.assinaturaCompleta).toBe(false);
  });

  it("envelope assinado sem `fechado_em` ainda conta, e a frase não inventa data", () => {
    const f = apurarFatosDoContrato([], {}, { estado: "ASSINADO " });
    expect(f.assinaturaCompleta).toBe(true);
    expect(f.comoSoube.assinatura).toBe("contrato assinado por todos na Clicksign");
  });

  it("⚠️ o instante do fechamento vira dia no fuso de Brasília, não em UTC", () => {
    // 21h40 do dia 11 em Brasília é 00h40 do dia 12 em UTC: cortar os dez primeiros caracteres da
    // string diria ao jurídico que o contrato fechou um dia depois do que fechou.
    const f = apurarFatosDoContrato(
      [],
      {},
      { estado: "assinado", fechado_em: "2026-09-12T00:40:00Z" },
    );
    expect(f.comoSoube.assinatura).toBe("contrato assinado por todos na Clicksign em 11/09/2026");
  });
});
