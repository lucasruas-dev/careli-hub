import { describe, expect, it } from "vitest";

import {
  cursorDoHistorico,
  mesclarTicketsDoHistorico,
} from "./historico-paginacao";

// O BUG QUE ESTES TESTES TRAVAM (medido em 09/09/2026, base de produção):
// a carga do histórico trazia os 400 encerrados mais recentes e a tela filtrava só em memória.
// Havia 5.869 encerrados no banco — 5.469 invisíveis — e a janela real era de 32 HORAS
// (07/09 23:48 → 09/09 07:57), com o ticket mais antigo do banco em 25/06. De 1.558 clientes
// com atendimento, 283 apareciam: 1.275 sumiam inteiros.

type TicketDeTeste = {
  closedAt?: null | string;
  id: string;
  protocol: string;
};

function ticket(
  id: string,
  closedAt: null | string,
  protocol = `AT-${id}`,
): TicketDeTeste {
  return { closedAt, id, protocol };
}

describe("cursorDoHistorico", () => {
  it("devolve o encerramento MAIS ANTIGO já carregado, que é por onde o próximo lote começa", () => {
    const carregados = [
      ticket("a", "2026-09-09T07:57:40.000Z"),
      ticket("b", "2026-09-08T10:00:00.000Z"),
      ticket("c", "2026-09-07T23:48:37.000Z"),
    ];

    expect(cursorDoHistorico(carregados)).toBe("2026-09-07T23:48:37.000Z");
  });

  // ⚠️ ABERTO NÃO TEM ENCERRAMENTO, E ELE ESTÁ NA MESMA LISTA. `irisData.tickets` mistura os
  // 490 abertos com os encerrados: usar o menor valor sem filtrar traria `null` e o próximo
  // lote começaria do zero, repetindo para sempre as mesmas linhas.
  it("ignora os abertos, que convivem na mesma lista sem closedAt", () => {
    const carregados = [
      ticket("aberto-1", null),
      ticket("a", "2026-09-09T07:57:40.000Z"),
      // Sem a propriedade: é assim que o aberto chega do `mapTicketRow`.
      { id: "aberto-2", protocol: "AT-aberto-2" },
      ticket("c", "2026-09-07T23:48:37.000Z"),
    ];

    expect(cursorDoHistorico(carregados)).toBe("2026-09-07T23:48:37.000Z");
  });

  it("sem nenhum encerrado não há por onde continuar", () => {
    expect(cursorDoHistorico([ticket("aberto-1", null)])).toBeNull();
    expect(cursorDoHistorico([])).toBeNull();
  });

  it("não se perde com data inválida gravada na linha", () => {
    const carregados = [
      ticket("ruim", "nao-e-data"),
      ticket("c", "2026-09-07T23:48:37.000Z"),
    ];

    expect(cursorDoHistorico(carregados)).toBe("2026-09-07T23:48:37.000Z");
  });
});

describe("mesclarTicketsDoHistorico", () => {
  it("junta o lote antigo ao que já estava na tela", () => {
    const base = [ticket("a", "2026-09-09T07:57:40.000Z")];
    const extras = [ticket("z", "2026-06-25T04:21:44.000Z")];

    expect(mesclarTicketsDoHistorico(base, extras).map((t) => t.id)).toEqual([
      "a",
      "z",
    ]);
  });

  // ⚠️ O REFRESH DE 90s RECARREGA A FILA INTEIRA. Sem deduplicar por id, cada refresh
  // empilharia de novo os tickets já paginados e a lista cresceria sozinha na tela.
  it("não duplica o ticket que o refresh trouxe de volta", () => {
    const base = [
      ticket("a", "2026-09-09T07:57:40.000Z"),
      ticket("b", "2026-09-08T10:00:00.000Z"),
    ];
    const extras = [
      ticket("b", "2026-09-08T10:00:00.000Z"),
      ticket("z", "2026-06-25T04:21:44.000Z"),
    ];

    const mesclado = mesclarTicketsDoHistorico(base, extras);

    expect(mesclado.map((t) => t.id)).toEqual(["a", "b", "z"]);
    expect(mesclado.filter((t) => t.id === "b")).toHaveLength(1);
  });

  // ⚠️ QUEM VENCE É A BASE. Ela vem do refresh, então é a versão mais nova: se o atendimento
  // foi reaberto ou mudou de responsável depois de paginado, a tela tem que mostrar o estado
  // de agora, não a fotografia do momento em que o lote antigo foi buscado.
  it("mantém a versão da carga corrente quando o mesmo ticket está nos dois lados", () => {
    const base = [ticket("b", "2026-09-08T10:00:00.000Z", "AT-ATUAL")];
    const extras = [ticket("b", "2026-09-08T10:00:00.000Z", "AT-VELHO")];

    expect(mesclarTicketsDoHistorico(base, extras)[0]?.protocol).toBe(
      "AT-ATUAL",
    );
  });

  it("aguenta lote vazio dos dois lados sem inventar linha", () => {
    const base = [ticket("a", "2026-09-09T07:57:40.000Z")];

    expect(mesclarTicketsDoHistorico(base, [])).toHaveLength(1);
    expect(mesclarTicketsDoHistorico([], [])).toHaveLength(0);
  });

  // O caso do Lucas: o cliente cujo atendimento encerrou em agosto não aparecia. Depois de
  // um lote a mais, ele está na lista — e o cursor anda para trás, para o próximo clique.
  it("o atendimento de agosto aparece depois de carregar mais, e o cursor recua", () => {
    const naTela = [
      ticket("hoje", "2026-09-09T07:57:40.000Z"),
      ticket("corte", "2026-09-07T23:48:37.000Z"),
    ];

    expect(naTela.some((t) => t.id === "agosto")).toBe(false);

    const comLoteAntigo = mesclarTicketsDoHistorico(naTela, [
      ticket("agosto", "2026-08-15T12:00:00.000Z"),
    ]);

    expect(comLoteAntigo.some((t) => t.id === "agosto")).toBe(true);
    expect(cursorDoHistorico(comLoteAntigo)).toBe("2026-08-15T12:00:00.000Z");
  });
});
