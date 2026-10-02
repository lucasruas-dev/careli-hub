import { describe, expect, it } from "vitest";

import { SQL_PEDIDOS_DAS_UNIDADES } from "./c2x";
import { ESTAGIOS_DO_PEDIDO_DO_BOLETO, eloDaEntrada, type EntradaDoElo, type PedidoDoTerreno } from "./elo";

// O ELO DA VENDA COM O PEDIDO DO C2X (a ordem da F8, sem o desempate: mais de um candidato é
// "ambíguo", pedido do Lucas de 02/10/2026). Documentos FALSOS, e o teste confere que nenhum sai.

const DOC = "11122233344";
const OUTRO_DOC = "55566677788";

const pedidoDoTerreno = (arId: number, estagio: null | number, documento = DOC): PedidoDoTerreno => ({
  arId,
  documentoDoComprador: documento,
  estagio,
});

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
});
