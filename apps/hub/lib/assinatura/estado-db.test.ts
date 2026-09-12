import { describe, expect, it } from "vitest";

import { cardAndouDepoisDe } from "./estado-db";

// A OUTRA METADE DO COMPARAR-E-TROCAR.
//
// ⚠️ O QUE ESTA REGRA IMPEDE É UM ENVIO DESFAZER UMA DECISÃO HUMANA. O POST do envio leva de 40 a
// 90 segundos e a linha do envelope só nasce lá pelo meio: nessa janela não existe envelope nenhum
// para a volta conferir, o botão de devolver nasce habilitado depois de um F5, e o card ia para a
// Análise — até o envio terminar e empurrá-lo de volta para "assinatura", com o contrato VELHO na
// rua. O `.eq("estagio", …)` de `retorno-para-correcao.ts` protege o sentido card → Análise; esta
// protege o sentido oposto, que é o único que aquele não tem como ver.

describe("cardAndouDepoisDe", () => {
  it("sem carimbo: move, que é o comportamento de ontem", () => {
    // Os chamadores que não sabem quando começaram (a rota de gerar contrato) continuam movendo o
    // card como sempre moveram. A regra só entra quando alguém oferece a prova.
    expect(cardAndouDepoisDe("2026-09-12T14:00:00+00:00", null)).toBe(false);
    expect(cardAndouDepoisDe("2026-09-12T14:00:00+00:00", undefined)).toBe(false);
  });

  it("carimbo mais novo que `estagio_desde`: o card não andou, então move", () => {
    // O card está onde estava quando a operação começou: ninguém mexeu nele no meio do caminho.
    expect(cardAndouDepoisDe("2026-09-12T14:00:00+00:00", "2026-09-12T14:01:30.000Z")).toBe(false);
  });

  it("carimbo mais velho que `estagio_desde`: o card andou durante a operação, não move", () => {
    // O coordenador devolveu o card para a Análise com este envio no ar. Quem decidiu por último
    // decidiu com o quadro na frente.
    expect(cardAndouDepoisDe("2026-09-12T14:01:30+00:00", "2026-09-12T14:00:00.000Z")).toBe(true);
  });

  it("⚠️ compara como data, nunca como texto: o `+00:00` e o `Z` são o mesmo instante", () => {
    // Em ordem alfabética "+" vem antes de "Z", e o mesmo instante pareceria mais antigo ou mais
    // novo conforme quem escreveu a string — o PostgREST ou o nosso `toISOString()`.
    expect(cardAndouDepoisDe("2026-09-12T14:00:00+00:00", "2026-09-12T14:00:00.000Z")).toBe(false);
    expect(cardAndouDepoisDe("2026-09-12T11:00:00-03:00", "2026-09-12T14:00:00.000Z")).toBe(false);
  });

  it("dado ausente ou ilegível não segura o card: a regra só recusa com prova", () => {
    // Card parado é board desatualizado, que a leitura seguinte conserta; card empurrado
    // indevidamente é uma decisão humana desfeita em silêncio. Os dois preços não são iguais.
    expect(cardAndouDepoisDe(null, "2026-09-12T14:00:00.000Z")).toBe(false);
    expect(cardAndouDepoisDe("ontem de manhã", "2026-09-12T14:00:00.000Z")).toBe(false);
    expect(cardAndouDepoisDe("2026-09-12T14:01:30+00:00", "quando o Lucas clicou")).toBe(false);
  });
});
