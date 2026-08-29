import { describe, expect, it } from "vitest";

import {
  contarSituacoes,
  situacaoDoLote,
  type SinaisDoLote,
} from "./situacao-do-lote";

// Os cinco status reais do C2X, lidos da tabela `sale_statuses` em 28/08/2026.
const DISPONIVEL = 1;
const RESERVADO = 2;
const EM_NEGOCIACAO = 3;
const VENDIDO = 4;
const BLOQUEADO = 5;

function sinais(parcial: Partial<SinaisDoLote>): SinaisDoLote {
  return {
    arAberta: false,
    reservadoNoPanteon: false,
    saleBlocked: false,
    saleStatusId: DISPONIVEL,
    ...parcial,
  };
}

describe("a reserva do salão ganha do C2X", () => {
  // O ponto da inversão de 28/08: no evento, quem manda é o Panteon. O lote acabou de ser
  // reservado no tótem e o C2X ainda não sabe — se o telão esperasse por ele, projetaria um
  // mapa desatualizado na frente do cliente que acabou de reservar.
  it("reserva viva no Panteon pinta reservado mesmo com o C2X dizendo disponível", () => {
    expect(
      situacaoDoLote(
        sinais({ reservadoNoPanteon: true, saleStatusId: DISPONIVEL }),
      ),
    ).toBe("reservado");
  });

  it("mas não ressuscita lote vendido", () => {
    expect(situacaoDoLote(sinais({ saleStatusId: VENDIDO }))).toBe("vendido");
  });
});

describe("traduz os status do C2X", () => {
  it("disponível", () => {
    expect(situacaoDoLote(sinais({ saleStatusId: DISPONIVEL }))).toBe(
      "disponivel",
    );
  });

  it("vendido", () => {
    expect(situacaoDoLote(sinais({ saleStatusId: VENDIDO }))).toBe("vendido");
  });

  // Reservado e em negociação dizem a mesma coisa para quem olha o telão: tem dono provisório.
  it("reservado e em negociação viram a mesma cor", () => {
    expect(situacaoDoLote(sinais({ saleStatusId: RESERVADO }))).toBe(
      "reservado",
    );
    expect(situacaoDoLote(sinais({ saleStatusId: EM_NEGOCIACAO }))).toBe(
      "reservado",
    );
  });

  it("pedido de aquisição aberto também é dono provisório", () => {
    expect(
      situacaoDoLote(sinais({ arAberta: true, saleStatusId: DISPONIVEL })),
    ).toBe("reservado");
  });
});

describe("bloqueado não é reserva de cliente", () => {
  // ⚠️ Cinza, não amarelo: o salão lê amarelo como "alguém pegou" e cria disputa por um lote
  // que nunca esteve à venda (permuta, área institucional, lote com pendência).
  it("sale_blocked fica indisponível", () => {
    expect(situacaoDoLote(sinais({ saleBlocked: true }))).toBe("indisponivel");
  });

  it("status 5 fica indisponível", () => {
    expect(situacaoDoLote(sinais({ saleStatusId: BLOQUEADO }))).toBe(
      "indisponivel",
    );
  });

  it("mas a reserva do evento ainda ganha dele", () => {
    expect(
      situacaoDoLote(sinais({ reservadoNoPanteon: true, saleBlocked: true })),
    ).toBe("reservado");
  });
});

describe("na dúvida, nunca anuncia disponível", () => {
  // Anunciar disponível um lote que não está é o erro caro desta tela: dois clientes disputando
  // o mesmo lote no salão. Um status que ninguém conhece some do mapa em vez de virar verde.
  it("status desconhecido não vira verde", () => {
    expect(situacaoDoLote(sinais({ saleStatusId: 99 }))).toBe("indisponivel");
  });

  it("lote sem status também não", () => {
    expect(situacaoDoLote(sinais({ saleStatusId: null }))).toBe("indisponivel");
  });
});

describe("contagem do painel", () => {
  it("soma cada situação", () => {
    expect(
      contarSituacoes([
        "disponivel",
        "disponivel",
        "reservado",
        "vendido",
        "indisponivel",
      ]),
    ).toEqual({ disponivel: 2, indisponivel: 1, reservado: 1, vendido: 1 });
  });

  it("lista vazia zera tudo, sem inventar chave", () => {
    expect(contarSituacoes([])).toEqual({
      disponivel: 0,
      indisponivel: 0,
      reservado: 0,
      vendido: 0,
    });
  });
});
