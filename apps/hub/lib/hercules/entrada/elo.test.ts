import { describe, expect, it } from "vitest";

import { SQL_PEDIDOS_DAS_UNIDADES, SQL_PEDIDOS_DESFEITOS_DAS_UNIDADES } from "./c2x";
import {
  ESTAGIOS_DO_PEDIDO_DO_BOLETO,
  eloDaEntrada,
  type EntradaDoElo,
  olhaOsDesfeitos,
  type PedidoDoTerreno,
} from "./elo";
import { ESTAGIOS_DESFEITOS_NO_C2X } from "./regra";

// O ELO DA VENDA COM O PEDIDO DO C2X (a ordem da F8, sem o desempate: mais de um candidato é
// "ambíguo", pedido do Lucas de 02/10/2026). Documentos FALSOS, e o teste confere que nenhum sai.

const DOC = "11122233344";
const OUTRO_DOC = "55566677788";

const pedidoDoTerreno = (
  arId: number,
  estagio: null | number,
  documento = DOC,
  criadoEm: null | string = null,
): PedidoDoTerreno => ({
  arId,
  criadoEm,
  documentoDoComprador: documento,
  estagio,
});

// O VOR Q14 L01 de 02/10/2026: o pedido 5032 nasceu no C2X em 25/09 19:24 para a proposta 10a51c41
// (cancelada em 01/10); a proposta nova do mesmo comprador, eec9f905, é de 01/10 17:53.
const VENDA_NOVA_DO_VOR = "2026-10-01T17:53:31.381775-03:00";
const PEDIDO_5032_NASCEU = "2026-09-25T19:24:00-03:00";

const nativa = (campos: Partial<EntradaDoElo> = {}): EntradaDoElo => ({
  arIdDoEnvioD4Sign: null,
  documentoDoComprador: DOC,
  origem: "panteon",
  origemC2xId: null,
  pedidosDoTerreno: [],
  ...campos,
});

describe("eloDaEntrada", () => {
  it("carga: pelo origem_c2x_id, sem olhar terreno nem envio", () => {
    expect(eloDaEntrada(nativa({ arIdDoEnvioD4Sign: 9, origem: "c2x", origemC2xId: "4400" }))).toEqual({
      arId: 4400,
      regra: "origem_c2x_id",
      tipo: "elo",
    });
    expect(eloDaEntrada(nativa({ origem: "c2x", origemC2xId: null }))).toEqual({ motivo: "carga_sem_pedido", tipo: "sem_pedido" });
  });

  it("nativa da D4Sign: o pedido do envio vence o terreno", () => {
    expect(
      eloDaEntrada(nativa({ arIdDoEnvioD4Sign: 5020, pedidosDoTerreno: [pedidoDoTerreno(1, 4), pedidoDoTerreno(2, 4)] })),
    ).toEqual({ arId: 5020, regra: "envio_d4sign", tipo: "elo" });
  });

  it("nativa da D4Sign sem o envio no C2X: sem pedido, sem cair no terreno", () => {
    expect(eloDaEntrada(nativa({ arIdDoEnvioD4Sign: null, pedidosDoTerreno: null }))).toEqual({
      motivo: "sem_pedido_no_c2x",
      tipo: "sem_pedido",
    });
  });

  it("Clicksign: o único pedido vivo do mesmo comprador no terreno", () => {
    // VOL Q03 L07: a reserva no pai (estágio 1) e os desfeitos (7) não contam.
    const r = eloDaEntrada(
      nativa({ pedidosDoTerreno: [pedidoDoTerreno(4522, 7, OUTRO_DOC), pedidoDoTerreno(5016, 4), pedidoDoTerreno(5017, 1)] }),
    );
    expect(r).toEqual({ arId: 5016, regra: "terreno_mesmo_comprador", tipo: "elo" });
  });

  it("Clicksign: nenhum pedido vivo no terreno = a venda ainda não foi digitada (VOL Q07 L10)", () => {
    expect(eloDaEntrada(nativa({ pedidosDoTerreno: [pedidoDoTerreno(4437, 7, OUTRO_DOC), pedidoDoTerreno(4881, 7)] }))).toEqual({
      motivo: "sem_pedido_no_c2x",
      tipo: "sem_pedido",
    });
  });

  it("dois pedidos vivos do mesmo comprador: AMBÍGUO, sem desempate", () => {
    expect(eloDaEntrada(nativa({ pedidosDoTerreno: [pedidoDoTerreno(10, 4), pedidoDoTerreno(11, 5)] }))).toEqual({
      motivo: "dois_pedidos",
      tipo: "ambiguo",
    });
  });

  it("o mesmo pedido lido duas vezes é um candidato só", () => {
    expect(eloDaEntrada(nativa({ pedidosDoTerreno: [pedidoDoTerreno(10, 4), pedidoDoTerreno(10, 4)] }))).toEqual({
      arId: 10,
      regra: "terreno_mesmo_comprador",
      tipo: "elo",
    });
  });

  it("o pedido que já é de outra venda do Panteon sai da conta", () => {
    const pedidosDoTerreno = [pedidoDoTerreno(10, 4), pedidoDoTerreno(11, 5)];
    expect(eloDaEntrada(nativa({ pedidosDeOutrasVendas: new Set([10]), pedidosDoTerreno }))).toEqual({
      arId: 11,
      regra: "terreno_mesmo_comprador",
      tipo: "elo",
    });
    expect(eloDaEntrada(nativa({ pedidosDeOutrasVendas: new Set([10, 11]), pedidosDoTerreno }))).toEqual({
      motivo: "pedido_de_venda_desfeita",
      tipo: "sem_pedido",
    });
  });

  it("pedido vivo de outro comprador não casa; venda sem documento é ambígua", () => {
    const pedidosDoTerreno = [pedidoDoTerreno(10, 4, OUTRO_DOC)];
    expect(eloDaEntrada(nativa({ pedidosDoTerreno }))).toEqual({ motivo: "pedido_de_outro_comprador", tipo: "sem_pedido" });
    expect(eloDaEntrada(nativa({ documentoDoComprador: "", pedidosDoTerreno }))).toEqual({
      motivo: "sem_documento_no_panteon",
      tipo: "ambiguo",
    });
  });

  it("o documento compara só os dígitos e NUNCA sai na resposta", () => {
    const r = eloDaEntrada(nativa({ documentoDoComprador: "111.222.333-44", pedidosDoTerreno: [pedidoDoTerreno(10, 4)] }));
    expect(r).toEqual({ arId: 10, regra: "terreno_mesmo_comprador", tipo: "elo" });
    expect(JSON.stringify(r)).not.toContain(DOC);
  });

  it("a lista de estágios do SQL é a mesma do elo", () => {
    const doSql = /acquisition_request_stage_id in \(([^)]+)\)/.exec(SQL_PEDIDOS_DAS_UNIDADES)?.[1];
    expect(doSql?.split(",").map((s) => Number(s.trim()))).toEqual([...ESTAGIOS_DO_PEDIDO_DO_BOLETO]);
  });

  it("os estágios do SQL dos desfeitos são os de ESTAGIOS_DESFEITOS_NO_C2X, com o corte pela data", () => {
    const doSql = /acquisition_request_stage_id in \(([^)]+)\)/.exec(SQL_PEDIDOS_DESFEITOS_DAS_UNIDADES)?.[1];
    expect(doSql?.split(",").map((s) => Number(s.trim()))).toEqual([...ESTAGIOS_DESFEITOS_NO_C2X].sort((a, b) => a - b));
    expect(SQL_PEDIDOS_DESFEITOS_DAS_UNIDADES).toMatch(/ar\.created_at >= \?/);
  });
});

describe("eloDaEntrada: o pedido que nasceu antes da venda (VOR Q14 L01, revisão de 02/10/2026)", () => {
  it("o pedido 5032, de 25/09, não casa sozinho com a venda de 01/10: ambíguo, com o número", () => {
    const r = eloDaEntrada(
      nativa({ criadoEmDaVenda: VENDA_NOVA_DO_VOR, pedidosDoTerreno: [pedidoDoTerreno(5032, 4, DOC, PEDIDO_5032_NASCEU)] }),
    );
    expect(r).toEqual({ arId: 5032, motivo: "pedido_anterior_a_venda", tipo: "ambiguo" });
  });

  it("o pedido redigitado DEPOIS da venda casa", () => {
    const r = eloDaEntrada(
      nativa({ criadoEmDaVenda: VENDA_NOVA_DO_VOR, pedidosDoTerreno: [pedidoDoTerreno(5040, 4, DOC, "2026-10-01T18:10:00-03:00")] }),
    );
    expect(r).toEqual({ arId: 5040, regra: "terreno_mesmo_comprador", tipo: "elo" });
  });

  it("a comparação é pelo instante, e não pelo texto: 21:00Z de 01/10 é 18:00 em Brasília, depois da venda", () => {
    const r = eloDaEntrada(
      nativa({ criadoEmDaVenda: "2026-10-01T20:53:31Z", pedidosDoTerreno: [pedidoDoTerreno(5040, 4, DOC, "2026-10-01T18:00:00-03:00")] }),
    );
    expect(r).toMatchObject({ arId: 5040, tipo: "elo" });
  });

  it("sem uma das duas datas, a data não decide (o comportamento de antes)", () => {
    expect(eloDaEntrada(nativa({ criadoEmDaVenda: null, pedidosDoTerreno: [pedidoDoTerreno(5032, 4, DOC, PEDIDO_5032_NASCEU)] }))).toMatchObject({
      arId: 5032,
      tipo: "elo",
    });
    expect(eloDaEntrada(nativa({ criadoEmDaVenda: VENDA_NOVA_DO_VOR, pedidosDoTerreno: [pedidoDoTerreno(5032, 4, DOC, null)] }))).toMatchObject({
      arId: 5032,
      tipo: "elo",
    });
  });

  it("um antigo e um novo do mesmo comprador continuam 'dois pedidos' (sem desempate)", () => {
    const r = eloDaEntrada(
      nativa({
        criadoEmDaVenda: VENDA_NOVA_DO_VOR,
        pedidosDoTerreno: [pedidoDoTerreno(5032, 4, DOC, PEDIDO_5032_NASCEU), pedidoDoTerreno(5040, 4, DOC, "2026-10-01T18:10:00-03:00")],
      }),
    );
    expect(r).toEqual({ motivo: "dois_pedidos", tipo: "ambiguo" });
  });

  it("o caminho da D4Sign e o da carga não olham a data", () => {
    expect(eloDaEntrada(nativa({ arIdDoEnvioD4Sign: 5032, criadoEmDaVenda: VENDA_NOVA_DO_VOR }))).toMatchObject({ tipo: "elo" });
    expect(eloDaEntrada(nativa({ criadoEmDaVenda: VENDA_NOVA_DO_VOR, origem: "c2x", origemC2xId: 5032 }))).toMatchObject({ tipo: "elo" });
  });
});

describe("eloDaEntrada: o pedido desfeito do comprador (revisão de 02/10/2026)", () => {
  const desfeito = (arId: number, criadoEm: string, documento = DOC) => pedidoDoTerreno(arId, 7, documento, criadoEm);

  it("sem candidato vivo, o desfeito dele nascido DEPOIS da venda vira 'pedido desfeito no C2X'", () => {
    const r = eloDaEntrada(
      nativa({
        criadoEmDaVenda: VENDA_NOVA_DO_VOR,
        pedidosDesfeitosDoTerreno: [desfeito(5041, "2026-10-01T18:30:00-03:00")],
        pedidosDoTerreno: [],
      }),
    );
    expect(r).toEqual({ arId: 5041, motivo: "pedido_desfeito_no_c2x", tipo: "sem_pedido" });
  });

  it("o desfeito de ANTES da venda não conta: segue 'ainda não digitada'", () => {
    const r = eloDaEntrada(
      nativa({ criadoEmDaVenda: VENDA_NOVA_DO_VOR, pedidosDesfeitosDoTerreno: [desfeito(4990, PEDIDO_5032_NASCEU)], pedidosDoTerreno: [] }),
    );
    expect(r).toEqual({ motivo: "sem_pedido_no_c2x", tipo: "sem_pedido" });
  });

  it("o desfeito de OUTRO comprador, ou que já é de outra venda do Panteon, não conta", () => {
    const depois = "2026-10-01T18:30:00-03:00";
    expect(
      eloDaEntrada(nativa({ criadoEmDaVenda: VENDA_NOVA_DO_VOR, pedidosDesfeitosDoTerreno: [desfeito(5041, depois, OUTRO_DOC)], pedidosDoTerreno: [] })),
    ).toEqual({ motivo: "sem_pedido_no_c2x", tipo: "sem_pedido" });
    expect(
      eloDaEntrada(
        nativa({
          criadoEmDaVenda: VENDA_NOVA_DO_VOR,
          pedidosDeOutrasVendas: new Set([5041]),
          pedidosDesfeitosDoTerreno: [desfeito(5041, depois)],
          pedidosDoTerreno: [],
        }),
      ),
    ).toEqual({ motivo: "sem_pedido_no_c2x", tipo: "sem_pedido" });
  });

  it("o vivo de outro comprador no lote e o desfeito deste: vale o desfeito (é a venda DESTE comprador)", () => {
    const r = eloDaEntrada(
      nativa({
        criadoEmDaVenda: VENDA_NOVA_DO_VOR,
        pedidosDesfeitosDoTerreno: [desfeito(5041, "2026-10-01T18:30:00-03:00")],
        pedidosDoTerreno: [pedidoDoTerreno(5050, 4, OUTRO_DOC)],
      }),
    );
    expect(r).toEqual({ arId: 5041, motivo: "pedido_desfeito_no_c2x", tipo: "sem_pedido" });
  });

  it("com candidato vivo do comprador, o desfeito nem é olhado; com dois desfeitos, vale o mais novo", () => {
    const vivo = eloDaEntrada(
      nativa({
        criadoEmDaVenda: VENDA_NOVA_DO_VOR,
        pedidosDesfeitosDoTerreno: [desfeito(5041, "2026-10-01T18:30:00-03:00")],
        pedidosDoTerreno: [pedidoDoTerreno(5040, 4, DOC, "2026-10-01T18:10:00-03:00")],
      }),
    );
    expect(vivo).toMatchObject({ arId: 5040, tipo: "elo" });
    expect(olhaOsDesfeitos(vivo)).toBe(false);
    const dois = eloDaEntrada(
      nativa({
        criadoEmDaVenda: VENDA_NOVA_DO_VOR,
        pedidosDesfeitosDoTerreno: [desfeito(5041, "2026-10-01T18:30:00-03:00"), desfeito(5042, "2026-10-02T09:00:00-03:00")],
        pedidosDoTerreno: [],
      }),
    );
    expect(dois).toEqual({ arId: 5042, motivo: "pedido_desfeito_no_c2x", tipo: "sem_pedido" });
  });

  it("olhaOsDesfeitos: só os 'sem pedido' em que não sobrou candidato vivo do comprador", () => {
    expect(olhaOsDesfeitos({ motivo: "sem_pedido_no_c2x", tipo: "sem_pedido" })).toBe(true);
    expect(olhaOsDesfeitos({ motivo: "pedido_de_outro_comprador", tipo: "sem_pedido" })).toBe(true);
    expect(olhaOsDesfeitos({ motivo: "pedido_de_venda_desfeita", tipo: "sem_pedido" })).toBe(true);
    expect(olhaOsDesfeitos({ motivo: "carga_sem_pedido", tipo: "sem_pedido" })).toBe(false);
    expect(olhaOsDesfeitos({ motivo: "dois_pedidos", tipo: "ambiguo" })).toBe(false);
    expect(olhaOsDesfeitos({ arId: 1, regra: "terreno_mesmo_comprador", tipo: "elo" })).toBe(false);
  });
});
