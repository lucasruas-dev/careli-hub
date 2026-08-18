import { describe, expect, it } from "vitest";

import {
  clientesUnicos,
  escolherEnvio,
  ESTAGIOS_COM_CONTRATO,
  ESTAGIOS_DE_GERACAO,
  montarContratos,
  situacaoDaAssinatura,
  type ContratoBruto,
  type EnvioDeAssinatura,
} from "./contratos";

// A RÉGUA REAL, medida no C2X em 18/08/2026 no VAL (Vista Alegre, enterprise 29, o
// empreendimento do portal de teste):
//
//   39 contratos vivos (todos no estágio 4, Faturado) · 39 com envio válido na D4Sign ·
//   39 com uuidDoc · 39 com TODAS as linhas assinadas · 0 aguardando emissão ·
//   36 clientes únicos (3 pessoas compraram mais de uma unidade) ·
//   só 13 com a data de geração no histórico (as vendas antigas entraram sem transição).
//
// Os testes fixam as REGRAS com fixtures pequenas; os números acima são o que a rota devolve
// quando roda contra o banco de verdade, e estão aqui para a próxima pessoa conferir.

function bruto(sobrescreve: Partial<ContratoBruto> = {}): ContratoBruto {
  return {
    arId: 1,
    bloco: "B02",
    comprador: "Fulano de Tal",
    enterpriseCode: "VAL",
    faturadoEm: "2026-05-10",
    geradoEm: "2026-05-01T12:00:00Z",
    imobiliaria: "Imobiliária X",
    lote: "L18",
    propostaEm: "2026-04-20",
    unitId: 100,
    valorTabela: 89900,
    ...sobrescreve,
  };
}

function envio(sobrescreve: Partial<EnvioDeAssinatura> = {}): EnvioDeAssinatura {
  return { arId: 1, csId: 10, linhas: 5, linhasAssinadas: 5, uuidDoc: "uuid-1", ...sobrescreve };
}

describe("a régua de estágio vem do STAGE_MAP das vendas, não de números chutados", () => {
  it("⚠️ contrato vivo = contrato gerado, em assinatura ou faturado (3, 4, 5, 6 no C2X hoje)", () => {
    // Se este teste quebrar, a dobra dos estágios mudou em lib/apolo/vendas.ts e a aba de
    // contratos do portal acompanhou sozinha — confira se era isso mesmo.
    expect(ESTAGIOS_COM_CONTRATO).toEqual([3, 4, 5, 6]);
  });

  it("a data de geração é a primeira entrada no estágio 'Contrato gerado' (3 no C2X hoje)", () => {
    expect(ESTAGIOS_DE_GERACAO).toEqual([3]);
  });
});

describe("a escolha do envio (armadilha documentada: média de 2 envios por contrato)", () => {
  it("o envio com uuidDoc vence, mesmo com id menor", () => {
    const comUuid = envio({ csId: 10, uuidDoc: "uuid-1" });
    const semUuid = envio({ csId: 99, uuidDoc: null });

    expect(escolherEnvio([semUuid, comUuid])?.csId).toBe(10);
    expect(escolherEnvio([comUuid, semUuid])?.csId).toBe(10);
  });

  it("sem nenhum uuidDoc, vale o de maior id", () => {
    expect(
      escolherEnvio([envio({ csId: 10, uuidDoc: null }), envio({ csId: 99, uuidDoc: null })])?.csId,
    ).toBe(99);
  });

  it("sem envio nenhum, nulo", () => {
    expect(escolherEnvio([])).toBeNull();
  });
});

describe("a situação resumida da assinatura", () => {
  it("sem envio válido = aguardando emissão", () => {
    expect(situacaoDaAssinatura(null)).toBe("aguardando-emissao");
  });

  it("todas as linhas assinadas = assinado (os 39 do VAL estão assim)", () => {
    expect(situacaoDaAssinatura(envio({ linhas: 5, linhasAssinadas: 5 }))).toBe("assinado");
  });

  it("linha pendente = em assinatura", () => {
    expect(situacaoDaAssinatura(envio({ linhas: 5, linhasAssinadas: 3 }))).toBe("em-assinatura");
  });

  it("envio sem linha registrada também é em assinatura: o documento JÁ saiu", () => {
    expect(situacaoDaAssinatura(envio({ linhas: 0, linhasAssinadas: 0 }))).toBe("em-assinatura");
  });
});

describe("a montagem da lista de contratos", () => {
  it("junta contrato + envio escolhido e monta o rótulo compacto da unidade", () => {
    const { contratos } = montarContratos([bruto()], [envio()]);

    expect(contratos).toHaveLength(1);
    expect(contratos[0]).toMatchObject({
      assinatura: "assinado",
      comprador: "Fulano de Tal",
      imobiliaria: "Imobiliária X",
      temContrato: true,
      unidade: "VALB0218",
      unitId: 100,
      valorTabela: 89900,
    });
    expect(contratos[0]!.geradoEm).toBe("2026-05-01T12:00:00.000Z");
    expect(contratos[0]!.faturadoEm).toBe("2026-05-10");
  });

  it("⚠️ faturadoEm atravessa como ISO CURTO, por string: billing_date é DATE, e new Date jogaria o dia para a véspera em São Paulo", () => {
    // O caso real medido no C2X: o driver devolvia '2023-12-03T00:00:00.000Z' e a tela mostrava
    // 02/12. Com date_format na query, a string chega e SAI 'YYYY-MM-DD', sem passar por Date.
    const { contratos } = montarContratos([bruto({ faturadoEm: "2023-12-03" })], []);

    expect(contratos[0]!.faturadoEm).toBe("2023-12-03");

    // E o que não é ISO curto vira nulo em vez de lixo na tela.
    expect(montarContratos([bruto({ faturadoEm: null })], []).contratos[0]!.faturadoEm).toBeNull();
  });

  it("sem envio, a situação é aguardando emissão e o botão de PDF não liga", () => {
    const { contratos } = montarContratos([bruto()], []);

    expect(contratos[0]!.assinatura).toBe("aguardando-emissao");
    expect(contratos[0]!.temContrato).toBe(false);
  });

  it("⚠️ ordena do mais recente, caindo para faturamento e proposta quando falta a geração (26 dos 39 do VAL não têm)", () => {
    const { contratos } = montarContratos(
      [
        bruto({ arId: 1, geradoEm: "2026-05-01", propostaEm: "2026-01-01", unitId: 1 }),
        // Sem geração no histórico: ordena pelo faturamento.
        bruto({ arId: 2, faturadoEm: "2026-07-10", geradoEm: null, propostaEm: "2026-01-02", unitId: 2 }),
        // Sem geração nem faturamento: ordena pela proposta.
        bruto({ arId: 3, faturadoEm: null, geradoEm: null, propostaEm: "2026-06-01", unitId: 3 }),
      ],
      [],
    );

    expect(contratos.map((contrato) => contrato.unitId)).toEqual([2, 3, 1]);
  });

  it("⚠️ teto com aviso, nunca truncamento silencioso", () => {
    const brutos = Array.from({ length: 5 }, (_, indice) =>
      bruto({ arId: indice + 1, geradoEm: `2026-05-0${indice + 1}`, unitId: indice + 1 }),
    );

    const resultado = montarContratos(brutos, [], 3);

    expect(resultado.contratos).toHaveLength(3);
    expect(resultado.total).toBe(5);
    expect(resultado.truncado).toBe(true);
    // E dentro do teto, nada de aviso falso.
    expect(montarContratos(brutos, [], 10).truncado).toBe(false);
  });

  it("⚠️ a contagem por situação é do recorte INTEIRO, antes do teto: os chips da tela contam por ela", () => {
    const brutos = [
      bruto({ arId: 1, geradoEm: "2026-05-01", unitId: 1 }),
      bruto({ arId: 2, geradoEm: "2026-05-02", unitId: 2 }),
      bruto({ arId: 3, geradoEm: "2026-05-03", unitId: 3 }),
    ];
    const envios = [
      envio({ arId: 1, csId: 1 }),
      envio({ arId: 2, csId: 2, linhas: 3, linhasAssinadas: 1, uuidDoc: null }),
      // O ar 3 nunca saiu para a D4Sign: aguardando emissão.
    ];

    const resultado = montarContratos(brutos, envios, 1);

    // A lista cortou em 1, mas a contagem soma os 3 — e bate com o total do título.
    expect(resultado.contratos).toHaveLength(1);
    expect(resultado.porSituacao).toEqual({
      "aguardando-emissao": 1,
      assinado: 1,
      "em-assinatura": 1,
    });
  });
});

describe("clientes únicos (o indicador do resumo de vendas)", () => {
  it("⚠️ conta PESSOAS, não vendas: no VAL são 39 vendas vivas de 36 clientes", () => {
    const cliente = (entityId: string) => ({ client: { code: null, entityId, name: "X" } });

    // Três vendas, duas do mesmo cliente: 2 pessoas.
    expect(clientesUnicos([cliente("a"), cliente("a"), cliente("b")])).toBe(2);
  });

  it("unidade sem venda ativa (client nulo) não conta", () => {
    expect(clientesUnicos([{ client: null }, { client: null }])).toBe(0);
  });
});
