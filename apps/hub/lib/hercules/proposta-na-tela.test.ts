import { describe, expect, it } from "vitest";

import { conferirProposta } from "./proposta";
import {
  faltaParaFechar,
  participacoesIguais,
  proximoVencimento,
  somaDasParticipacoes,
} from "./proposta-na-tela";

describe("proximoVencimento", () => {
  it("⚠️ hoje conta como o próximo dia", () => {
    // Gerar a proposta no dia 10 com vencimento no 10 quer dizer entrada HOJE. Empurrar para
    // novembro daria um mês de carência que ninguém negociou — e `conferirProposta` aceita hoje.
    expect(proximoVencimento("2026-10-10T14:00:00-03:00", 10)).toBe("2026-10-10");
  });

  it("passado o dia, vai para o mês seguinte", () => {
    expect(proximoVencimento("2026-10-11T09:00:00-03:00", 10)).toBe("2026-11-10");
    expect(proximoVencimento("2026-10-11T09:00:00-03:00", 20)).toBe("2026-10-20");
  });

  it("vira o ano sem somar 30 dias", () => {
    expect(proximoVencimento("2026-12-21T09:00:00-03:00", 20)).toBe("2027-01-20");
  });

  it("⚠️ prende o dia em 28, que existe em todo mês", () => {
    // 31/11 não existe: nascida assim, a data rolaria calada para 01/12 e o boleto sairia no mês
    // errado dentro de um contrato assinado.
    expect(proximoVencimento("2026-01-01T09:00:00-03:00", 31)).toBe("2026-01-28");
  });

  it("⚠️ a virada do dia é a de Brasília, não a de UTC", () => {
    // 23h do dia 10 em Brasília é 02h do dia 11 em UTC. Lido como UTC, o padrão pularia para
    // novembro na frente de quem ainda está no dia 10.
    expect(proximoVencimento("2026-10-11T02:00:00Z", 10)).toBe("2026-10-10");
  });

  it("sem data não inventa data", () => {
    expect(proximoVencimento("", 10)).toBe("");
    expect(proximoVencimento("ontem", 10)).toBe("");
  });
});

describe("participacoesIguais", () => {
  it("um comprador leva os 100%", () => {
    expect(participacoesIguais(1)).toEqual([100]);
  });

  it("casal fica em 50/50", () => {
    expect(participacoesIguais(2)).toEqual([50, 50]);
  });

  it("⚠️ o centésimo da divisão por três não some, e vai no titular", () => {
    expect(participacoesIguais(3)).toEqual([33.34, 33.33, 33.33]);
    expect(somaDasParticipacoes(participacoesIguais(3))).toBe(100);
  });

  it("⚠️ a divisão que a tela oferece PASSA na régua que o servidor aplica", () => {
    // É o ponto do teste: se `participacoesIguais` perdesse o centésimo, a tela ofereceria com um
    // clique uma proposta que `conferirProposta` recusa — e ninguém entenderia por quê.
    for (const quantos of [1, 2, 3, 4, 6, 7]) {
      const erros = conferirProposta(
        {
          compradores: participacoesIguais(quantos).map((participacao, i) => ({
            cpf: "111.444.777-35",
            nome: `Comprador ${i + 1}`,
            participacao,
            titular: i === 0,
          })),
          entradaValor: 20_000,
          entradaVezes: 2,
          parcelas: 120,
          primeiraParcelaEm: "2026-10-10",
          reservaId: "r1",
          unidadeId: "u1",
          // Fora do assunto deste teste (que só olha os erros de participação), mas obrigatória: sem
          // validade a régua recusa a proposta inteira.
          validadeEm: "2026-09-11T23:59:59-03:00",
          valorNegociado: 200_000,
          vencimentoDia: 10,
        },
        "2026-09-04T12:00:00-03:00",
      );
      expect(erros.filter((e) => e.campo === "participacao")).toEqual([]);
    }
  });
});

describe("somaDasParticipacoes / faltaParaFechar", () => {
  it("⚠️ soma em centésimos, sem o resíduo do ponto flutuante", () => {
    expect(somaDasParticipacoes([33.34, 33.33, 33.33])).toBe(100);
    expect(faltaParaFechar([33.34, 33.33, 33.33])).toBe(0);
  });

  it("diz quanto falta e quanto passou", () => {
    expect(faltaParaFechar([60, 30])).toBe(10);
    expect(faltaParaFechar([60, 60])).toBe(-20);
  });

  it("campo vazio conta como zero, não como NaN", () => {
    expect(somaDasParticipacoes([100, Number.NaN])).toBe(100);
  });
});
