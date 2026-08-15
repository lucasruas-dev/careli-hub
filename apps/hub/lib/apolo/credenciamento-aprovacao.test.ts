import { describe, expect, it } from "vitest";

import {
  planejarHabilitacao,
  resumoDaHabilitacao,
  type EmpreendimentoPedido,
} from "./credenciamento-aprovacao";

// Os casos abaixo travam decisões tomadas com o dado real de 15/08/2026: 16 imobiliárias
// paradas, uma delas (NOVOS ARES) pedindo 6 empreendimentos de uma vez.

const pedido = (
  enterpriseId: string,
  label: string,
  status = "pending",
): EmpreendimentoPedido => ({
  enterpriseId,
  id: `rel-${enterpriseId}`,
  label,
  status,
});

describe("habilitação da imobiliária", () => {
  it("habilita só o que o operador marcou, e o resto CONTINUA pendente", () => {
    const plano = planejarHabilitacao({
      escolhidos: ["35"],
      pedidos: [pedido("35", "VALE DO OURO"), pedido("40", "JARDIM DAS GERAIS")],
    });

    expect(plano.habilitar).toEqual(["rel-35"]);
    // Não vira recusado: o operador pode liberar o outro depois, sem a imobiliária pedir de novo.
    expect(plano.seguemPendentes).toEqual(["rel-40"]);
    expect(plano.promoverPapel).toBe(true);
  });

  it("libera os 6 de uma vez quando o operador marca todos (caso NOVOS ARES)", () => {
    const seis = ["35", "36", "37", "39", "40", "41"];
    const plano = planejarHabilitacao({
      escolhidos: seis,
      pedidos: seis.map((id) => pedido(id, `EMP ${id}`)),
    });

    expect(plano.habilitar).toHaveLength(6);
    expect(plano.seguemPendentes).toEqual([]);
    expect(plano.promoverPapel).toBe(true);
  });

  it("NÃO promove o papel quando nada foi escolhido", () => {
    // Papel ativo sem empreendimento nenhum = CNPJ vale no formulário do corretor e nenhum
    // empreendimento aparece para ele: credenciada para nada.
    const plano = planejarHabilitacao({
      escolhidos: [],
      pedidos: [pedido("35", "VALE DO OURO")],
    });

    expect(plano.promoverPapel).toBe(false);
    expect(plano.habilitar).toEqual([]);
    expect(plano.seguemPendentes).toEqual(["rel-35"]);
  });

  it("reaprovar o que já está habilitado não é erro, e ainda sustenta o papel", () => {
    const plano = planejarHabilitacao({
      escolhidos: ["35"],
      pedidos: [pedido("35", "VALE DO OURO", "verified")],
    });

    expect(plano.habilitar).toEqual([]);
    expect(plano.jaHabilitados).toEqual(["rel-35"]);
    expect(plano.promoverPapel).toBe(true);
  });

  it("acusa empreendimento que a imobiliária não pediu, em vez de habilitar em silêncio", () => {
    const plano = planejarHabilitacao({
      escolhidos: ["35", "99"],
      pedidos: [pedido("35", "VALE DO OURO")],
    });

    expect(plano.desconhecidos).toEqual(["99"]);
    expect(plano.habilitar).toEqual(["rel-35"]);
  });

  it("ignora id vazio ou com espaço, que é o que chega de um formulário", () => {
    const plano = planejarHabilitacao({
      escolhidos: [" 35 ", "", "   "],
      pedidos: [pedido("35", "VALE DO OURO")],
    });

    expect(plano.habilitar).toEqual(["rel-35"]);
    expect(plano.desconhecidos).toEqual([]);
  });

  it("empreendimento JA habilitado nao vira pendente por nao ter sido remarcado", () => {
    // O operador reabre o card só para liberar um novo. Os antigos não podem voltar para a
    // fila nem sumir: continuam habilitados.
    const plano = planejarHabilitacao({
      escolhidos: ["40"],
      pedidos: [pedido("35", "VALE DO OURO", "verified"), pedido("40", "GARDEN")],
    });

    expect(plano.habilitar).toEqual(["rel-40"]);
    expect(plano.jaHabilitados).toEqual(["rel-35"]);
    expect(plano.seguemPendentes).toEqual([]);
  });

  it("o resumo conta o que aconteceu, e não um ok generico", () => {
    expect(
      resumoDaHabilitacao(
        planejarHabilitacao({
          escolhidos: ["35"],
          pedidos: [pedido("35", "A"), pedido("40", "B"), pedido("41", "C", "verified")],
        }),
      ),
    ).toBe("1 empreendimento habilitado, 1 já estava habilitado, 1 segue aguardando");

    expect(
      resumoDaHabilitacao(planejarHabilitacao({ escolhidos: [], pedidos: [] })),
    ).toBe("Nada a habilitar");
  });
});

// ── EMPREENDIMENTO NOVO (imobiliária que JÁ é credenciada) ──────────────────────────────────
// O portal interno lista o que ela AINDA NÃO trabalha, então por construção nenhum escolhido
// existe como pedido. Sem `ativos`, todos caíam em `desconhecidos` e a rota devolvia 400 sempre.
describe("planejarHabilitacao com empreendimentos abertos (ativos)", () => {
  it("aceita empreendimento sem vínculo quando ele está entre os abertos", () => {
    const plano = planejarHabilitacao({
      ativos: ["10", "20"],
      escolhidos: ["20"],
      pedidos: [],
    });

    expect(plano.novos).toEqual(["20"]);
    expect(plano.desconhecidos).toEqual([]);
    expect(plano.promoverPapel).toBe(true);
  });

  it("continua recusando o que não está aberto, mesmo com ativos informado", () => {
    const plano = planejarHabilitacao({
      ativos: ["10"],
      escolhidos: ["99"],
      pedidos: [],
    });

    expect(plano.novos).toEqual([]);
    expect(plano.desconhecidos).toEqual(["99"]);
    expect(plano.promoverPapel).toBe(false);
  });

  it("SEM ativos mantém a proteção do Board: escolhido sem pedido é desconhecido", () => {
    const plano = planejarHabilitacao({ escolhidos: ["20"], pedidos: [] });

    expect(plano.novos).toEqual([]);
    expect(plano.desconhecidos).toEqual(["20"]);
  });

  it("separa o que promove do que cria, na mesma rodada", () => {
    const plano = planejarHabilitacao({
      ativos: ["10", "20"],
      escolhidos: ["10", "20"],
      pedidos: [{ enterpriseId: "10", id: "rel-1", label: "Vale do Ouro", status: "pending" }],
    });

    expect(plano.habilitar).toEqual(["rel-1"]);
    expect(plano.novos).toEqual(["20"]);
  });
});
