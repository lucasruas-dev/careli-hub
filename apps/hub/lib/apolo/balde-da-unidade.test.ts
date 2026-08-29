import { describe, expect, it } from "vitest";

import {
  baldeDaUnidade,
  rotuloDoBalde,
  SALE_STATUS,
  type SinaisDaUnidade,
  sqlDoBalde,
} from "./balde-da-unidade";

function sinais(parcial: Partial<SinaisDaUnidade>): SinaisDaUnidade {
  return {
    saleBlocked: false,
    saleStatusId: SALE_STATUS.DISPONIVEL,
    ...parcial,
  };
}

describe("traduz o status do C2X", () => {
  it("cada status no seu balde", () => {
    expect(
      baldeDaUnidade(sinais({ saleStatusId: SALE_STATUS.DISPONIVEL })),
    ).toBe("disponivel");
    expect(
      baldeDaUnidade(sinais({ saleStatusId: SALE_STATUS.RESERVADO })),
    ).toBe("reservado");
    expect(
      baldeDaUnidade(sinais({ saleStatusId: SALE_STATUS.EM_NEGOCIACAO })),
    ).toBe("negociacao");
    expect(baldeDaUnidade(sinais({ saleStatusId: SALE_STATUS.VENDIDO }))).toBe(
      "vendido",
    );
    expect(
      baldeDaUnidade(sinais({ saleStatusId: SALE_STATUS.BLOQUEADO })),
    ).toBe("bloqueado");
  });

  // ⚠️ O DEFEITO QUE ESTA FUNÇÃO EXISTE PARA MATAR. Os cards contavam bloqueado como
  // "status 1 COM o flag ligado", e o Villa Paris chegou com 27 unidades em status 5 e flag 0:
  // elas sumiam de todos os baldes, e a soma dos cards dava 70 num total de 97.
  it("status 5 com o flag DESLIGADO ainda é bloqueado", () => {
    expect(
      baldeDaUnidade(
        sinais({ saleBlocked: false, saleStatusId: SALE_STATUS.BLOQUEADO }),
      ),
    ).toBe("bloqueado");
  });

  it("o flag sozinho também bloqueia, com o status dizendo disponível", () => {
    expect(
      baldeDaUnidade(
        sinais({ saleBlocked: true, saleStatusId: SALE_STATUS.DISPONIVEL }),
      ),
    ).toBe("bloqueado");
  });

  it("status desconhecido ou ausente não vira disponível por acidente", () => {
    // Sem status e sem flag não há o que dizer além de "livre" — mas com o flag, bloqueia.
    expect(
      baldeDaUnidade(sinais({ saleBlocked: true, saleStatusId: null })),
    ).toBe("bloqueado");
  });
});

describe("a reserva do salão entra nas telas do Apolo", () => {
  // Lucas, 28/08, depois de reservar o RVPB03 no tótem: "tem que refletir em tudo essa reserva,
  // na tela de unidades o B3 ainda está disponivel".
  it("lote livre no C2X e reservado no Prometeu aparece como reservado", () => {
    expect(
      baldeDaUnidade(
        sinais({
          reservadoNoPanteon: true,
          saleStatusId: SALE_STATUS.DISPONIVEL,
        }),
      ),
    ).toBe("reservado");
  });

  it("também ganha do bloqueado", () => {
    expect(
      baldeDaUnidade(sinais({ reservadoNoPanteon: true, saleBlocked: true })),
    ).toBe("reservado");
  });

  // ⚠️ Não puxa de volta quem já andou na esteira: a reserva do evento é o começo do funil.
  it("NÃO rebaixa lote que já está vendido ou em negociação", () => {
    expect(
      baldeDaUnidade(
        sinais({ reservadoNoPanteon: true, saleStatusId: SALE_STATUS.VENDIDO }),
      ),
    ).toBe("vendido");
    expect(
      baldeDaUnidade(
        sinais({
          reservadoNoPanteon: true,
          saleStatusId: SALE_STATUS.EM_NEGOCIACAO,
        }),
      ),
    ).toBe("negociacao");
  });
});

describe("o SQL espelha a função", () => {
  const sql = sqlDoBalde("u");

  it("usa o alias que recebeu", () => {
    expect(sql).toContain("u.sale_status_id");
    expect(sql).toContain("u.sale_blocked");
    expect(sqlDoBalde("eu")).toContain("eu.sale_status_id");
  });

  it("cobre os cinco baldes", () => {
    for (const balde of [
      "vendido",
      "negociacao",
      "reservado",
      "bloqueado",
      "disponivel",
    ]) {
      expect(sql).toContain(`'${balde}'`);
    }
  });

  // A ordem no SQL precisa ser a mesma da função — é ela que garante baldes exclusivos.
  it("pergunta na mesma ordem da função", () => {
    const ordem = [
      "'vendido'",
      "'negociacao'",
      "'reservado'",
      "'bloqueado'",
      "'disponivel'",
    ].map((b) => sql.indexOf(b));
    for (let i = 1; i < ordem.length; i += 1) {
      expect(ordem[i]).toBeGreaterThan(ordem[i - 1] as number);
    }
  });

  it("o bloqueado olha o status 5 E o flag, que é o defeito de origem", () => {
    expect(sql).toContain(`sale_status_id = ${SALE_STATUS.BLOQUEADO}`);
    expect(sql).toMatch(/coalesce\(u\.sale_blocked, 0\) = 1/);
  });
});

describe("o texto do badge sai do balde", () => {
  // ⚠️ O DEFEITO: com a reserva do salão entrando na regra, o lote ganhava a COR de reservado
  // mas o texto continuava vindo de sale_statuses.name — e o badge saía âmbar escrito
  // "Disponível". Cor e palavra têm que ter a mesma fonte.
  it("cada balde tem sua palavra", () => {
    expect(rotuloDoBalde("disponivel")).toBe("Disponível");
    expect(rotuloDoBalde("reservado")).toBe("Reservado");
    expect(rotuloDoBalde("negociacao")).toBe("Em negociação");
    expect(rotuloDoBalde("vendido")).toBe("Vendido");
    expect(rotuloDoBalde("bloqueado")).toBe("Bloqueado");
  });

  it("lote reservado no salão diz Reservado, mesmo com o C2X dizendo disponível", () => {
    const balde = baldeDaUnidade({
      reservadoNoPanteon: true,
      saleBlocked: false,
      saleStatusId: SALE_STATUS.DISPONIVEL,
    });
    expect(rotuloDoBalde(balde)).toBe("Reservado");
  });
});
