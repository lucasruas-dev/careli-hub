import { describe, expect, it } from "vitest";

import type { ApoloCarteiraUnit, ApoloUnitInstallment } from "@/lib/apolo/carteira";
import type { ApoloVendaUnit } from "@/lib/apolo/vendas";

import {
  agregarCompradores,
  agregarImobiliarias,
  anexarIdentidade,
  codeDaUnidade,
  contarCadsPorImobiliaria,
  contarParcelas,
  ehTipoDeFicha,
  rankingDaImobiliaria,
  rotuloDaEtapa,
  rotuloDaSituacao,
  unidadesDoComprador,
  type LinhaEsteira,
} from "./crm";

// O CRM DO INCORPORADOR ENTREGA DADO DE PESSOA PARA QUEM NÃO É DO TIME. Estes testes cobrem as
// duas coisas que erradas custam caro: o que SAI de cada campo (privacidade) e a matemática das
// listas (número errado na tela do cliente vira reunião).

const vendaUnit = (over: Partial<ApoloVendaUnit>): ApoloVendaUnit => ({
  arId: 1,
  block: "02",
  blocked: false,
  client: null,
  code: "VOCQ02L18",
  id: "100",
  imobiliaria: null,
  lot: "18",
  stage: "faturado",
  stageSince: null,
  vgv: 100_000,
  ...over,
});

const carteiraUnit = (over: Partial<ApoloCarteiraUnit>): ApoloCarteiraUnit => ({
  block: "02",
  client: null,
  code: "VOCQ02L18",
  contractCode: null,
  contractDocumentId: null,
  enterpriseCode: "VOC",
  enterpriseName: "VALE DO OURO",
  faturadoAt: null,
  id: "100",
  imobiliaria: null,
  lot: "18",
  maxOverdueDays: 0,
  overdueAmount: 0,
  overdueInstallments: 0,
  paidAmount: 0,
  toReceiveAmount: 0,
  totalContract: 0,
  ...over,
});

// Serve às duas leituras: `ApoloVendaParty` pede `code`, `ApoloCarteiraUnitParty` ignora.
const pessoa = (id: string, nome: string) => ({ code: null, entityId: id, name: nome });
const parte = pessoa;

// (A `mascararDocumento` que vivia aqui saiu em 18/08/2026 por ordem do Lucas — o documento do
// portal agora é IGUAL ao do Apolo interno, sem máscara. A normalização e os testes dela estão
// em ficha-cadastro.ts / ficha-cadastro.test.ts → `formatarDocumento`.)

describe("anexarIdentidade", () => {
  it("completa documento e cidade nos compradores que têm entidade", () => {
    const compradores = agregarCompradores({
      carteira: [],
      nomePorCode: new Map(),
      vendas: [vendaUnit({ client: pessoa("e1", "JOSE") })],
    });

    const [comprador] = anexarIdentidade(
      compradores,
      new Map([["e1", { documento: "123.456.789-00", local: "Sete Lagoas/MG" }]]),
    );

    expect(comprador?.documento).toBe("123.456.789-00");
    expect(comprador?.local).toBe("Sete Lagoas/MG");
  });

  it("quem não tem entidade no Apolo fica com nulo — o card mostra só o nome", () => {
    const compradores = agregarCompradores({
      carteira: [],
      nomePorCode: new Map(),
      vendas: [vendaUnit({ client: pessoa("e1", "JOSE") })],
    });

    const [comprador] = anexarIdentidade(compradores, new Map());

    expect(comprador?.documento).toBeNull();
    expect(comprador?.local).toBeNull();
  });
});

describe("rotuloDaEtapa", () => {
  it("⚠️ crédito reprovado NÃO vira veredito na tela do incorporador", () => {
    // `revisao` e `indeferido` são o resultado da análise de crédito da PESSOA. O incorporador não
    // é o credor; ele vê o estado do processo, não o score de quem se cadastrou.
    expect(rotuloDaEtapa("revisao")).toBe("Em análise");
    expect(rotuloDaEtapa("credito")).toBe("Em análise");
    expect(rotuloDaEtapa("indeferido")).toBe("Não seguiu");
  });

  it("nenhum rótulo devolve vocabulário interno", () => {
    const internos = ["validacao", "credito", "revisao", "prevenda", "credenciado", "correcao", "indeferido"];

    for (const etapa of internos) {
      expect(rotuloDaEtapa(etapa)).not.toMatch(/esteira|indeferid|reprov|revisao/i);
    }
  });

  it("etapa desconhecida não quebra nem expõe o valor bruto", () => {
    expect(rotuloDaEtapa("etapa_que_nao_existe")).toBe("Em andamento");
    expect(rotuloDaEtapa(null)).toBe("Em andamento");
  });
});

describe("codeDaUnidade", () => {
  it("tira o código do empreendimento do rótulo da unidade", () => {
    expect(codeDaUnidade("VOCQ02L18")).toBe("VOC");
    expect(codeDaUnidade("gdnq01l05")).toBe("GDN");
  });
});

describe("agregarCompradores", () => {
  const nomePorCode = new Map([["VOC", "VALE DO OURO"]]);

  it("junta as unidades da mesma pessoa numa linha só", () => {
    const compradores = agregarCompradores({
      carteira: [],
      nomePorCode,
      vendas: [
        vendaUnit({ client: pessoa("e1", "JOSE"), code: "VOCQ02L18", id: "100" }),
        vendaUnit({ client: pessoa("e1", "JOSE"), code: "VOCQ03L07", id: "101" }),
      ],
    });

    expect(compradores).toHaveLength(1);
    expect(compradores[0]?.unidades.map((u) => u.codigo)).toEqual(["VOCQ02L18", "VOCQ03L07"]);
    expect(compradores[0]?.unidades[0]?.empreendimento).toBe("VALE DO OURO");
  });

  it("a mesma unidade nas DUAS fontes não conta duas vezes", () => {
    // Venda e carteira trazem a mesma unidade; o dinheiro vem da carteira e o lote não duplica.
    const compradores = agregarCompradores({
      carteira: [
        carteiraUnit({
          client: pessoa("e1", "JOSE"),
          id: "100",
          paidAmount: 30_000,
          toReceiveAmount: 70_000,
          totalContract: 100_000,
        }),
      ],
      nomePorCode,
      vendas: [vendaUnit({ client: pessoa("e1", "JOSE"), id: "100" })],
    });

    expect(compradores[0]?.unidades).toHaveLength(1);
    expect(compradores[0]?.total).toBe(100_000);
    expect(compradores[0]?.pago).toBe(30_000);
    expect(compradores[0]?.situacao).toBe("em_dia");
  });

  it("a unidade que só está na carteira entra (revenda: a proposta atual é de outro)", () => {
    const compradores = agregarCompradores({
      carteira: [
        carteiraUnit({ client: pessoa("e1", "JOSE"), id: "200", totalContract: 50_000 }),
      ],
      nomePorCode,
      vendas: [vendaUnit({ client: pessoa("e2", "MARIA"), id: "200" })],
    });

    const jose = compradores.find((c) => c.id === "e1");
    expect(jose?.unidades).toHaveLength(1);
    expect(jose?.total).toBe(50_000);
  });

  it("atraso manda na situação e soma parcelas e o maior atraso", () => {
    const compradores = agregarCompradores({
      carteira: [
        carteiraUnit({
          client: pessoa("e1", "JOSE"),
          id: "100",
          maxOverdueDays: 40,
          overdueAmount: 1_000,
          overdueInstallments: 2,
          totalContract: 100_000,
        }),
        carteiraUnit({
          client: pessoa("e1", "JOSE"),
          code: "VOCQ03L07",
          id: "101",
          maxOverdueDays: 90,
          overdueAmount: 500,
          overdueInstallments: 1,
          totalContract: 80_000,
        }),
      ],
      nomePorCode,
      vendas: [],
    });

    expect(compradores[0]?.situacao).toBe("em_atraso");
    expect(compradores[0]?.emAtraso).toBe(1_500);
    expect(compradores[0]?.parcelasEmAtraso).toBe(3);
    expect(compradores[0]?.maiorAtrasoDias).toBe(90);
  });

  it("venda sem carteira aparece como sem parcelas, não como em dia", () => {
    // Reservado/proposta ainda não gerou boleto. Dizer "em dia" seria afirmar pagamento que não há.
    const compradores = agregarCompradores({
      carteira: [],
      nomePorCode,
      vendas: [vendaUnit({ client: pessoa("e1", "JOSE"), stage: "reservado" })],
    });

    expect(compradores[0]?.situacao).toBe("sem_parcelas");
    expect(compradores[0]?.unidades[0]?.estagio).toBe("Reservado");
  });

  it("unidade disponível não inventa comprador", () => {
    expect(
      agregarCompradores({
        carteira: [],
        nomePorCode,
        vendas: [vendaUnit({ client: null, stage: "disponivel" })],
      }),
    ).toEqual([]);
  });

  it("imobiliária sem nome não tranca o campo para a próxima unidade", () => {
    // `??` não troca string vazia: se a primeira linha gravasse "", nenhuma outra corrigiria.
    const compradores = agregarCompradores({
      carteira: [],
      nomePorCode,
      vendas: [
        vendaUnit({ client: pessoa("e1", "JOSE"), id: "100", imobiliaria: parte("i1", "") }),
        vendaUnit({ client: pessoa("e1", "JOSE"), id: "101", imobiliaria: parte("i1", "RR") }),
      ],
    });

    expect(compradores[0]?.imobiliaria).toBe("RR");
  });
});

describe("agregarImobiliarias", () => {
  it("conta unidade pela venda e comprador sem duplicar com a carteira", () => {
    const imobiliarias = agregarImobiliarias({
      cadsPorEntidade: new Map([["i1", 7]]),
      carteira: [
        carteiraUnit({ client: pessoa("e1", "JOSE"), id: "100", imobiliaria: parte("i1", "RR") }),
      ],
      credenciadas: [],
      vendas: [
        vendaUnit({ client: pessoa("e1", "JOSE"), id: "100", imobiliaria: parte("i1", "RR") }),
        vendaUnit({ client: pessoa("e2", "MARIA"), id: "101", imobiliaria: parte("i1", "RR") }),
      ],
    });

    expect(imobiliarias).toHaveLength(1);
    expect(imobiliarias[0]?.unidades).toBe(2);
    expect(imobiliarias[0]?.compradores).toBe(2);
    expect(imobiliarias[0]?.vgv).toBe(200_000);
    expect(imobiliarias[0]?.cads).toBe(7);
  });

  it("quem está habilitada e nunca vendeu aparece com zero", () => {
    // É informação para o loteador: "credenciei cinco, duas nunca venderam".
    const imobiliarias = agregarImobiliarias({
      cadsPorEntidade: new Map(),
      carteira: [],
      credenciadas: [
        { documento: "**.345.678/0001-**", id: "i9", nome: "NOVA IMOVEIS", verificada: true },
      ],
      vendas: [],
    });

    expect(imobiliarias[0]).toMatchObject({
      cads: 0,
      compradores: 0,
      credenciada: true,
      nome: "NOVA IMOVEIS",
      unidades: 0,
      vgv: 0,
    });
  });

  it("vínculo ainda pendente entra na lista, sem o selo de credenciada", () => {
    const imobiliarias = agregarImobiliarias({
      cadsPorEntidade: new Map(),
      carteira: [],
      credenciadas: [{ documento: null, id: "i9", nome: "EM ANALISE", verificada: false }],
      vendas: [],
    });

    expect(imobiliarias[0]?.credenciada).toBe(false);
  });

  it("ordena pelo VGV, que é a leitura que o loteador faz da lista", () => {
    const imobiliarias = agregarImobiliarias({
      cadsPorEntidade: new Map(),
      carteira: [],
      credenciadas: [],
      vendas: [
        vendaUnit({ id: "1", imobiliaria: parte("i1", "PEQUENA"), vgv: 10_000 }),
        vendaUnit({ id: "2", imobiliaria: parte("i2", "GRANDE"), vgv: 900_000 }),
      ],
    });

    expect(imobiliarias.map((i) => i.nome)).toEqual(["GRANDE", "PEQUENA"]);
  });
});

describe("contarCadsPorImobiliaria", () => {
  const linha = (over: Partial<LinhaEsteira>): LinhaEsteira => ({
    chegou_em: null,
    corretor: null,
    empreendimento: "VALE DO OURO",
    enterprise_id: "37",
    entity_id: "p1",
    etapa: "validacao",
    imobiliaria: null,
    imobiliaria_entity_id: null,
    ...over,
  });

  it("⚠️ conta pelo ID, não pelo texto: o mesmo CNPJ está escrito de três jeitos", () => {
    // Medido em 17/08/2026: o entity_id 0b69e3e0… aparece como "RR Soluções", "RR Soluções
    // Imobiliárias LTDA" e "RR SOLUCOES IMOBILIARIAS LTDA". Contar por nome daria três.
    const contagem = contarCadsPorImobiliaria([
      linha({ entity_id: "p1", imobiliaria: "RR Soluções", imobiliaria_entity_id: "i1" }),
      linha({ entity_id: "p2", imobiliaria: "RR SOLUCOES IMOBILIARIAS LTDA", imobiliaria_entity_id: "i1" }),
      linha({ entity_id: "p3", imobiliaria: "RR Soluções Imobiliárias LTDA", imobiliaria_entity_id: "i1" }),
    ]);

    expect(contagem.get("i1")).toBe(3);
    expect(contagem.size).toBe(1);
  });

  it("CAD sem imobiliária vinculada não entra na contagem de ninguém", () => {
    const contagem = contarCadsPorImobiliaria([
      linha({ imobiliaria: "ALGUMA IMOBILIARIA", imobiliaria_entity_id: null }),
    ]);

    expect(contagem.size).toBe(0);
  });
});

// ── FICHA ───────────────────────────────────────────────────────────────────

const parcela = (over: Partial<ApoloUnitInstallment>): ApoloUnitInstallment => ({
  amount: 500,
  competence: null,
  dueDate: null,
  id: "1",
  invoiceUrl: null,
  number: "1/10",
  overdueDays: 0,
  paidAmount: 0,
  paidAt: null,
  paymentUrl: null,
  status: "a_vencer",
  type: null,
  ...over,
});

describe("ehTipoDeFicha", () => {
  it("só aceita os três papéis da lista do portal", () => {
    expect(ehTipoDeFicha("comprador")).toBe(true);
    expect(ehTipoDeFicha("prospect")).toBe(true);
    expect(ehTipoDeFicha("imobiliaria")).toBe(true);
    // Papel interno do CRM não abre ficha no portal.
    expect(ehTipoDeFicha("corretor")).toBe(false);
    expect(ehTipoDeFicha("")).toBe(false);
  });
});

describe("rotuloDaSituacao", () => {
  it("traduz a situação financeira sem vocabulário interno", () => {
    expect(rotuloDaSituacao("em_dia")).toBe("Em dia");
    expect(rotuloDaSituacao("em_atraso")).toBe("Em atraso");
    expect(rotuloDaSituacao("sem_parcelas")).toBe("Sem parcelas");
  });
});

describe("contarParcelas", () => {
  it("separa vencidas do resto (paga e a vencer contam como em dia)", () => {
    const contagem = contarParcelas([
      parcela({ id: "1", status: "liquidada" }),
      parcela({ id: "2", status: "a_vencer" }),
      parcela({ id: "3", status: "vencida" }),
      parcela({ id: "4", status: "vencida" }),
    ]);

    expect(contagem).toEqual({ emDia: 2, vencidas: 2 });
  });

  it("sem parcelas devolve zero a zero, não quebra", () => {
    expect(contarParcelas([])).toEqual({ emDia: 0, vencidas: 0 });
  });
});

describe("unidadesDoComprador", () => {
  const nomePorCode = new Map([["VOC", "VALE DO OURO"]]);

  it("só devolve as unidades da pessoa pedida", () => {
    const linhas = unidadesDoComprador({
      carteira: [],
      entityId: "e1",
      nomePorCode,
      vendas: [
        vendaUnit({ client: pessoa("e1", "JOSE"), id: "100" }),
        vendaUnit({ client: pessoa("e2", "MARIA"), code: "VOCQ03L07", id: "101" }),
      ],
    });

    expect(linhas).toHaveLength(1);
    expect(linhas[0]?.unidade.codigo).toBe("VOCQ02L18");
  });

  it("venda e carteira da mesma unidade viram UMA linha, com o dinheiro da carteira", () => {
    const linhas = unidadesDoComprador({
      carteira: [
        carteiraUnit({
          client: pessoa("e1", "JOSE"),
          id: "100",
          overdueAmount: 1_000,
          overdueInstallments: 2,
          paidAmount: 30_000,
          toReceiveAmount: 70_000,
          totalContract: 100_000,
        }),
      ],
      entityId: "e1",
      nomePorCode,
      vendas: [vendaUnit({ client: pessoa("e1", "JOSE"), id: "100", vgv: 100_000 })],
    });

    expect(linhas).toHaveLength(1);
    expect(linhas[0]?.unitId).toBe("100");
    expect(linhas[0]?.unidade.financeiro).toEqual({
      aReceber: 70_000,
      pago: 30_000,
      // Sem a leitura das parcelas a contagem de em dia fica nula, nunca zero.
      parcelasEmDia: null,
      parcelasVencidas: 2,
      total: 100_000,
      vencido: 1_000,
    });
  });

  it("reserva/proposta sem carteira sai com financeiro nulo, não zerado", () => {
    const linhas = unidadesDoComprador({
      carteira: [],
      entityId: "e1",
      nomePorCode,
      vendas: [vendaUnit({ client: pessoa("e1", "JOSE"), stage: "reservado" })],
    });

    expect(linhas[0]?.unidade.etapa).toBe("Reservado");
    expect(linhas[0]?.unidade.financeiro).toBeNull();
    expect(linhas[0]?.unitId).toBeNull();
  });

  it("a unidade que só está na carteira entra como Faturado (revenda)", () => {
    const linhas = unidadesDoComprador({
      carteira: [
        carteiraUnit({ client: pessoa("e1", "JOSE"), id: "200", totalContract: 50_000 }),
      ],
      entityId: "e1",
      nomePorCode,
      vendas: [vendaUnit({ client: pessoa("e2", "MARIA"), id: "200" })],
    });

    expect(linhas).toHaveLength(1);
    expect(linhas[0]?.unidade.etapa).toBe("Faturado");
    expect(linhas[0]?.unidade.valor).toBe(50_000);
    expect(linhas[0]?.unitId).toBe("200");
  });

  it("dois contratos na mesma unidade somam, para bater com o total da pessoa", () => {
    const linhas = unidadesDoComprador({
      carteira: [
        carteiraUnit({ client: pessoa("e1", "JOSE"), id: "100", paidAmount: 10_000, totalContract: 40_000 }),
        carteiraUnit({ client: pessoa("e1", "JOSE"), id: "100", paidAmount: 5_000, totalContract: 60_000 }),
      ],
      entityId: "e1",
      nomePorCode,
      vendas: [vendaUnit({ client: pessoa("e1", "JOSE"), id: "100" })],
    });

    expect(linhas).toHaveLength(1);
    expect(linhas[0]?.unidade.financeiro?.total).toBe(100_000);
    expect(linhas[0]?.unidade.financeiro?.pago).toBe(15_000);
  });

  it("⚠️ o objeto da unidade não carrega nada além do contratado (sem id interno, sem link)", () => {
    // O contrato do payload da ficha: qualquer campo novo aqui é decisão de privacidade, não
    // detalhe de implementação. O unitId interno viaja FORA do objeto, só para o servidor.
    const linhas = unidadesDoComprador({
      carteira: [carteiraUnit({ client: pessoa("e1", "JOSE"), id: "100" })],
      entityId: "e1",
      nomePorCode,
      vendas: [vendaUnit({ client: pessoa("e1", "JOSE"), id: "100" })],
    });

    expect(Object.keys(linhas[0]?.unidade ?? {}).sort()).toEqual([
      "codigo",
      "empreendimento",
      "etapa",
      "financeiro",
      "lote",
      "quadra",
      "valor",
    ]);
  });
});

describe("rankingDaImobiliaria", () => {
  it("dá a posição na lista já ordenada por VGV", () => {
    const lista = agregarImobiliarias({
      cadsPorEntidade: new Map(),
      carteira: [],
      credenciadas: [],
      vendas: [
        vendaUnit({ id: "1", imobiliaria: parte("i1", "PEQUENA"), vgv: 10_000 }),
        vendaUnit({ id: "2", imobiliaria: parte("i2", "GRANDE"), vgv: 900_000 }),
      ],
    });

    expect(rankingDaImobiliaria(lista, "i2")).toEqual({ posicao: 1, total: 2 });
    expect(rankingDaImobiliaria(lista, "i1")).toEqual({ posicao: 2, total: 2 });
  });

  it("quem não está na lista do escopo devolve nulo (vira 404 na rota)", () => {
    expect(rankingDaImobiliaria([], "i9")).toBeNull();
  });
});
