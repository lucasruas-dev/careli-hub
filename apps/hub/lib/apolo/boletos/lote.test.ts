import { describe, expect, it } from "vitest";

import { dataDeVencimento, nomesDivergentes, prepararLote } from "./lote";

// ⚠️ CADA CASO AQUI É UM BOLETO QUE SAI, OU NÃO SAI, NA CONTA DE ALGUÉM. O Asaas não desfaz
// emissão em lote: cancelar é uma chamada por cobrança, e o cliente já pode ter recebido.

const doc = (
  entradas: [string, { contato?: null | string; documento: string; nome: string }][],
) =>
  new Map(
    entradas.map(([u, d]) => [u, { contato: d.contato ?? null, documento: d.documento, nome: d.nome }]),
  );

describe("a data de vencimento a partir do dia da planilha", () => {
  it("monta a data do mês pedido", () => {
    expect(dataDeVencimento("2026-09", 15)).toBe("2026-09-15");
    expect(dataDeVencimento("2026-09", 5)).toBe("2026-09-05");
  });

  it("dia 30 em fevereiro cai no último dia do mês", () => {
    // ⚠️ A IZALTINA (Ed. Jade, apto 202) vence dia 30. `2026-02-30` faz o Asaas recusar, e um
    // `new Date("2026-02-30")` escorrega sozinho para 2 de março — emitindo com a data errada
    // sem erro nenhum.
    expect(dataDeVencimento("2026-02", 30)).toBe("2026-02-28");
    expect(dataDeVencimento("2024-02", 30)).toBe("2024-02-29"); // bissexto
    expect(dataDeVencimento("2026-04", 31)).toBe("2026-04-30");
  });

  it("dia 30 em setembro continua dia 30", () => {
    expect(dataDeVencimento("2026-09", 30)).toBe("2026-09-30");
  });

  it("dezembro não vira janeiro do ano seguinte", () => {
    expect(dataDeVencimento("2026-12", 31)).toBe("2026-12-31");
    expect(dataDeVencimento("2026-12", 30)).toBe("2026-12-30");
  });

  it("competência ou dia inválido devolve nulo em vez de inventar data", () => {
    expect(dataDeVencimento("setembro", 10)).toBeNull();
    expect(dataDeVencimento("2026-13", 10)).toBeNull();
    expect(dataDeVencimento("2026-09", 0)).toBeNull();
    expect(dataDeVencimento("2026-09", Number.NaN)).toBeNull();
  });
});

describe("montar o lote de um empreendimento", () => {
  const base = {
    competencia: "2026-09",
    documentos: doc([
      ["401", { documento: "11122233344", nome: "PEDRO HENRIQUE CAIXETA FERREIRA" }],
      ["102", { documento: "55566677788", nome: "RAISSA DE OLIVEIRA CARVALHO" }],
    ]),
    empreendimento: "ed-rubi",
  };

  it("monta descrição, referência e vencimento de quem emite", () => {
    const lote = prepararLote({
      ...base,
      linhas: [
        { nome: "PEDRO HENRIQUE CAIXETA FERREIRA", unidade: "401", valor: 1116.5044398224682, vencimento: 15 },
      ],
    });

    expect(lote.itens).toHaveLength(1);
    const item = lote.itens[0]!;
    expect(item.descricao).toBe("Ed. Rubi - Unidade 401 - Competência 09/2026");
    expect(item.referencia).toBe("boleto:ed-rubi:401:2026-09");
    expect(item.vencimento).toBe("2026-09-15");
    expect(item.documento).toBe("11122233344");
    // O valor cru; o arredondamento para cima acontece na hora de mandar ao Asaas.
    expect(item.valor).toBe(1116.5044398224682);
  });

  it("o nome do boleto é o do cadastro, não o da planilha", () => {
    // ⚠️ A planilha escreve "VINICIUS FERREIRA ARAUJO - TAXA SELIC". O sufixo é recado interno
    // sobre o índice de reajuste e sairia impresso no boleto do cliente.
    const lote = prepararLote({
      competencia: "2026-09",
      documentos: doc([["102", { documento: "99988877766", nome: "VINICIUS FERREIRA ARAUJO" }]]),
      empreendimento: "ed-jade",
      linhas: [
        { nome: "VINICIUS FERREIRA ARAUJO - TAXA SELIC", unidade: "102", valor: 1105.482558, vencimento: 25 },
      ],
    });
    expect(lote.itens[0]!.nome).toBe("VINICIUS FERREIRA ARAUJO");
  });

  it("a mesma pessoa em duas unidades vira dois boletos, com valores próprios", () => {
    // ⚠️ MARCELO SALDANHA NUNES tem os aptos 202 e 302 no Ed. Rubi, mesmo CPF e valores
    // diferentes. Casar por nome daria o valor de um apartamento aos dois.
    const lote = prepararLote({
      competencia: "2026-09",
      documentos: doc([
        ["202", { documento: "12312312312", nome: "MARCELO SALDANHA NUNES" }],
        ["302", { documento: "12312312312", nome: "MARCELO SALDANHA NUNES" }],
      ]),
      empreendimento: "ed-rubi",
      linhas: [
        { nome: "MARCELO SALDANHA NUNES", unidade: "202", valor: 2704.236019427493, vencimento: 20 },
        { nome: "MARCELO SALDANHA NUNES", unidade: "302", valor: 2102.577106828294, vencimento: 20 },
      ],
    });

    expect(lote.itens).toHaveLength(2);
    expect(lote.itens.map((i) => i.valor)).toEqual([2704.236019427493, 2102.577106828294]);
    // Referências distintas: é o que impede a segunda emissão de achar que já existe.
    expect(new Set(lote.itens.map((i) => i.referencia)).size).toBe(2);
  });

  it("quem a regra bloqueia não entra, e o motivo viaja junto", () => {
    const lote = prepararLote({
      ...base,
      linhas: [
        // O ROMULO real: valor calculado e "não fazer" escrito no lugar do telefone.
        { contato: "PAGA AQUI -NÃO FAZER", nome: "ROMULO", unidade: "402", valor: 3245.08, vencimento: 24 },
        { marcaNoMes: "Não fazer", nome: "EVERTON", unidade: "202", vencimento: 5 },
      ],
    });

    expect(lote.itens).toHaveLength(0);
    expect(lote.fora).toHaveLength(2);
    expect(lote.fora[0]!.motivo).toContain("coluna de contato");
  });

  it("sem CPF cadastrado o cliente fica de fora, nomeando a unidade", () => {
    // ⚠️ Descobrir isso no meio da emissão deixaria metade do lote criado e a outra não — e
    // repetir a rodada duplicaria a primeira metade.
    const lote = prepararLote({
      ...base,
      linhas: [{ nome: "ALGUÉM NOVO", unidade: "999", valor: 100, vencimento: 10 }],
    });
    expect(lote.itens).toHaveLength(0);
    expect(lote.fora[0]!.motivo).toContain("999");
  });

  it("sem dia de vencimento não inventa data", () => {
    const lote = prepararLote({
      ...base,
      linhas: [{ nome: "PEDRO HENRIQUE CAIXETA FERREIRA", unidade: "401", valor: 100, vencimento: null }],
    });
    expect(lote.itens).toHaveLength(0);
    expect(lote.fora[0]!.motivo).toContain("vencimento");
  });

  it("sem unidade não emite: é ela que identifica a cobrança", () => {
    const lote = prepararLote({
      ...base,
      linhas: [{ nome: "SEM APTO", unidade: null, valor: 100, vencimento: 10 }],
    });
    expect(lote.itens).toHaveLength(0);
    expect(lote.fora[0]!.motivo).toContain("unidade");
  });

  it("o lote real da CER de setembro fecha em 11 boletos", () => {
    // Medido na planilha de 31/08/2026: Cristal 3, Rubi 4, Jade 4, Esmeralda 0.
    const cristal = prepararLote({
      competencia: "2026-09",
      documentos: doc([
        ["201", { documento: "11111111111", nome: "VITOR AUGUSTO DA SILVA VIEIRA" }],
        ["101", { documento: "22222222222", nome: "WELLINGTON JUNIO SILVA" }],
        ["401", { documento: "33333333333", nome: "VIVIANE DE ALMEIDA GONÇALVES" }],
      ]),
      empreendimento: "ed-cristal",
      linhas: [
        { nome: "VITOR AUGUSTO DA SILVA VIEIRA", unidade: "201", valor: 1044.67120562158, vencimento: 10 },
        { marcaNoMes: "Não fazer", nome: "EVERTON VINICIUS DA SILVEIRA", unidade: "202", vencimento: 5 },
        // Parcelas acabaram: setembro vem vazio.
        { nome: "VITOR HONORATO DA SILVA", unidade: "102", valor: null, vencimento: 10 },
        { nome: "WELLINGTON JUNIO SILVA", unidade: "101", valor: 1520.92137, vencimento: 15 },
        { nome: "VIVIANE DE ALMEIDA GONÇALVES", unidade: "401", valor: 2560.2176395, vencimento: 10 },
      ],
    });
    expect(cristal.itens).toHaveLength(3);
    expect(cristal.fora).toHaveLength(2);

    // O Esmeralda tem valor calculado E "Não fazer" na coluna solta depois do último mês.
    const esmeralda = prepararLote({
      competencia: "2026-09",
      documentos: doc([]),
      empreendimento: "ed-esmeralda",
      linhas: [
        { nome: "GUSTAVO AUGUSTO COLEHO", observacao: "Não fazer", unidade: "102", valor: 1682.164607412833, vencimento: 15 },
      ],
    });
    expect(esmeralda.itens).toHaveLength(0);
  });
});

describe("o aviso de nome divergente", () => {
  it("grafia diferente não vira aviso", () => {
    const achados = nomesDivergentes(
      [{ nome: "Alison Dutra", unidade: "10", valor: 1, vencimento: 10 }],
      new Map([["10", { nome: "ALISON DUTRA SANTIAGO" }]]),
    );
    expect(achados).toHaveLength(0);
  });

  it("pessoa completamente diferente na mesma unidade avisa", () => {
    // ⚠️ Não impede a emissão — avisa. Se o imóvel trocou de dono, o boleto sairia no CPF do
    // antigo, e isso não aparece em nenhum total.
    const achados = nomesDivergentes(
      [{ nome: "JOÃO DA SILVA", unidade: "10", valor: 1, vencimento: 10 }],
      new Map([["10", { nome: "MARIA SOUZA" }]]),
    );
    expect(achados).toHaveLength(1);
    expect(achados[0]!.unidade).toBe("10");
  });

  it("sufixo interno da planilha não vira aviso", () => {
    const achados = nomesDivergentes(
      [{ nome: "VINICIUS FERREIRA ARAUJO - TAXA SELIC", unidade: "102", valor: 1, vencimento: 25 }],
      new Map([["102", { nome: "VINICIUS FERREIRA ARAUJO" }]]),
    );
    expect(achados).toHaveLength(0);
  });
});
