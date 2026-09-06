import { describe, expect, it } from "vitest";

import { idDaUnidadeEmFoco, propostaEmFoco, unidadeEmFoco } from "./unidade-em-foco";

type Lote = { etapa: string; id: string };

const MAPA: Lote[] = [
  { etapa: "proposta", id: "uni-1" },
  { etapa: "disponivel", id: "uni-2" },
];

describe("qual lote a ficha mostra", () => {
  it("clique na GRADE: acha o lote no mapa", () => {
    const foco = { tipo: "unidade" as const, unidade: { etapa: "reservado", id: "uni-1" } };
    expect(unidadeEmFoco(foco, MAPA)?.id).toBe("uni-1");
  });

  it("⚠️ clique na LISTA também chega no lote — era isto que apagava os quatro botões", () => {
    // O analítico foca uma PROPOSTA, não um lote. Enquanto só o foco do tipo "unidade" era lido, a
    // ficha aberta pela lista vinha com "Escolha uma unidade" numa tela que já mostrava o cliente,
    // o valor e o histórico daquele lote — e pela grade funcionava.
    const foco = { proposta: { unidadeId: "uni-1" }, tipo: "proposta" as const };
    expect(unidadeEmFoco(foco, MAPA)?.id).toBe("uni-1");
  });

  it("⚠️ o mapa FRESCO vence o retrato do clique", () => {
    // O retrato guarda a etapa de quando alguém clicou. Depois de gerar a proposta, ele diria
    // "reservado" e o botão ofereceria "Cancelar reserva" — a rota responderia 409 apontando para
    // um botão que a tela não mostra.
    const foco = { tipo: "unidade" as const, unidade: { etapa: "reservado", id: "uni-1" } };
    expect(unidadeEmFoco(foco, MAPA)?.etapa).toBe("proposta");
  });

  it("unidade fora do mapa carregado cai no retrato do clique", () => {
    // Trocou de produto ou de recorte: o retrato é tudo o que existe, e é melhor que nada.
    const foco = { tipo: "unidade" as const, unidade: { etapa: "reservado", id: "uni-99" } };
    expect(unidadeEmFoco(foco, MAPA)?.id).toBe("uni-99");
  });

  it("⚠️ pela LISTA não há retrato: unidade fora do mapa devolve nada, e não algo inventado", () => {
    const foco = { proposta: { unidadeId: "uni-99" }, tipo: "proposta" as const };
    expect(unidadeEmFoco(foco, MAPA)).toBeNull();
  });

  it("proposta sem unidadeId (importada solta) não quebra nem inventa lote", () => {
    const foco = { proposta: { unidadeId: null }, tipo: "proposta" as const };
    expect(idDaUnidadeEmFoco(foco)).toBeNull();
    expect(unidadeEmFoco(foco, MAPA)).toBeNull();
  });

  it("sem foco nenhum, sem lote", () => {
    expect(unidadeEmFoco(null, MAPA)).toBeNull();
    expect(idDaUnidadeEmFoco(null)).toBeNull();
  });

  it("mapa vazio pela grade ainda mostra o retrato; pela lista, não", () => {
    const daGrade = { tipo: "unidade" as const, unidade: { etapa: "reservado", id: "uni-1" } };
    const daLista = { proposta: { unidadeId: "uni-1" }, tipo: "proposta" as const };
    expect(unidadeEmFoco(daGrade, [])?.id).toBe("uni-1");
    expect(unidadeEmFoco(daLista, [])).toBeNull();
  });
});

describe("propostaEmFoco", () => {
  const viva = (etapa: string) => ["assinatura", "contrato", "proposta", "reservado"].includes(etapa);
  const antiga = { etapa: "contrato", id: "p1", unidadeId: "u1" };
  const fresca = { cancelamentoPedidoEm: "2026-09-06T13:00:00Z", etapa: "contrato", id: "p1", unidadeId: "u1" };

  it("⚠️ a versão FRESCA vence o retrato do clique", () => {
    // Pela lista, o clique guarda o objeto como ele estava. Sem esta releitura, o pedido de
    // cancelamento já gravado não apagava o botão: o coordenador respondia tudo de novo e levava 409.
    const escolhida = propostaEmFoco({ proposta: antiga, tipo: "proposta" }, [fresca], viva);
    expect(escolhida).toBe(fresca);
  });

  it("sem a proposta na lista, cai na viva do lote", () => {
    const outra = { etapa: "proposta", id: "p9", unidadeId: "u1" };
    expect(propostaEmFoco({ proposta: antiga, tipo: "proposta" }, [outra], viva)).toBe(outra);
  });

  it("sem nada na lista, o retrato ainda mostra alguma coisa", () => {
    expect(propostaEmFoco({ proposta: antiga, tipo: "proposta" }, [], viva)).toBe(antiga);
  });

  it("pelo clique na grade, a viva do lote — e nada quando não há", () => {
    expect(propostaEmFoco({ tipo: "unidade" }, [fresca], viva)).toBe(fresca);
    expect(propostaEmFoco({ tipo: "unidade" }, [{ etapa: "cancelado", id: "p2", unidadeId: "u1" }], viva)).toBeNull();
    expect(propostaEmFoco(null, [], viva)).toBeNull();
  });
});
