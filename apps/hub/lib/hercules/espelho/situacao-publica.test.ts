import { describe, expect, it } from "vitest";

import {
  contarPublicas,
  situacaoDoLoteReal,
  situacaoPublica,
} from "./situacao-publica";

// O QUE ESTE TESTE PROTEGE: verde e uma AFIRMACAO publica — "este lote esta a venda" — feita num
// link que circula no WhatsApp, para gente que nao tem login. Um lote verde que ja tem dono faz o
// cliente escolher, o corretor prometer e alguem ter de desdizer. Toda duvida sai azul.

const nada = {
  doFilho: true,
  propostaAberta: false,
  reservaViva: false,
  situacaoNoCadastro: "disponivel",
};
const pai = { ...nada, doFilho: false };

describe("situacao publica de uma unidade", () => {
  it("verde quando o cadastro diz disponivel e nao ha processo em cima", () => {
    expect(situacaoPublica(nada)).toBe("disponivel");
  });

  // ⚠️ O PEDIDO DO LUCAS EM 09/09: "reservou, proposta, tem que refletir no espelho".
  it("azul quando ha proposta aberta, mesmo com o cadastro disponivel", () => {
    expect(situacaoPublica({ ...nada, propostaAberta: true })).toBe("indisponivel");
  });

  it("azul quando ha reserva viva, mesmo com o cadastro disponivel", () => {
    expect(situacaoPublica({ ...nada, reservaViva: true })).toBe("indisponivel");
  });

  it("azul para vendida, reservada e bloqueada", () => {
    for (const s of ["vendida", "reservada", "bloqueada"]) {
      expect(situacaoPublica({ ...nada, situacaoNoCadastro: s })).toBe("indisponivel");
    }
  });

  // ⚠️ FAIL-CLOSED. Um estado novo criado amanha no cadastro nao pode nascer verde.
  it("azul para situacao desconhecida, nula ou vazia", () => {
    for (const s of ["em_negociacao", "DISPONIVEL", " disponivel", "", null]) {
      expect(situacaoPublica({ ...nada, situacaoNoCadastro: s })).toBe("indisponivel");
    }
  });
});

describe("situacao do lote real (o mesmo terreno em dois cadastros)", () => {
  // ⚠️ O CASO REAL DO VALE DO OURO, e o que quase saiu errado. O mesmo terreno existe no pai
  // (VLO0101) e no filho (VOL0101); o PAI esta parado e diz "vendida" em 4 lotes que os filhos
  // dao como disponiveis. Quem vende e o filho — tratar os dois como pares esconderia 4 lotes
  // a venda, que e o estrago do `price <= 1`.
  it("o FILHO decide: pai vendida + filho disponivel = VERDE", () => {
    expect(
      situacaoDoLoteReal([
        { ...pai, situacaoNoCadastro: "vendida" },
        { ...nada, situacaoNoCadastro: "disponivel" },
      ]),
    ).toBe("disponivel");
  });

  it("o FILHO decide tambem no outro sentido: pai disponivel + filho vendida = AZUL", () => {
    expect(
      situacaoDoLoteReal([
        { ...pai, situacaoNoCadastro: "disponivel" },
        { ...nada, situacaoNoCadastro: "vendida" },
      ]),
    ).toBe("indisponivel");
  });

  // Os 83 lotes do Lagoa Bonita que so existem no pai: ele responde, porque e o unico que tem.
  it("sem filho, o pai responde", () => {
    expect(situacaoDoLoteReal([pai])).toBe("disponivel");
    expect(
      situacaoDoLoteReal([{ ...pai, situacaoNoCadastro: "vendida" }]),
    ).toBe("indisponivel");
  });

  // Os 3 lotes que VOC e VOR disputam: o cadastro antigo fica "bloqueada" e o novo tem o estado
  // real. Exigir unanimidade entre filhos deixaria azul um lote que a carteira viva vende.
  it("entre filhos, disponivel em um deles basta", () => {
    expect(
      situacaoDoLoteReal([
        { ...nada, situacaoNoCadastro: "bloqueada" },
        nada,
      ]),
    ).toBe("disponivel");
  });

  // O processo trava venha de onde vier — aqui pai e filho valem igual, porque proposta e fato.
  it("azul quando QUALQUER registro do lote tem proposta aberta, inclusive o pai", () => {
    expect(
      situacaoDoLoteReal([nada, { ...nada, propostaAberta: true }]),
    ).toBe("indisponivel");
    expect(
      situacaoDoLoteReal([nada, { ...pai, propostaAberta: true }]),
    ).toBe("indisponivel");
  });

  // Lote que existe no mapa e nao existe no cadastro: some como indisponivel, nunca como verde.
  it("azul quando nao ha registro nenhum", () => {
    expect(situacaoDoLoteReal([])).toBe("indisponivel");
  });
});

describe("contagem da legenda", () => {
  it("conta as duas cores e nao inventa terceira", () => {
    expect(
      contarPublicas(["disponivel", "indisponivel", "disponivel"]),
    ).toEqual({ disponivel: 2, indisponivel: 1 });
  });

  it("devolve zeros para lista vazia", () => {
    expect(contarPublicas([])).toEqual({ disponivel: 0, indisponivel: 0 });
  });
});
