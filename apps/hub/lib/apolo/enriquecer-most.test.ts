import { describe, expect, it } from "vitest";

import { custoPorConsulta, fichaDoEnriquecimento } from "./enriquecer-most";

// O que a MOST devolve é texto livre; a ficha guarda id. Esta tradução é o ponto onde dado errado
// entraria calado, então ela é testada com os formatos REAIS da base (BigDataCorp).

describe("retorno do MOST -> campos da ficha", () => {
  it("traduz sexo, renda e nascimento para o formato da ficha", () => {
    const r = fichaDoEnriquecimento({
      nascimento: "1985-04-12",
      nomeMae: "MARIA APARECIDA SOUZA",
      renda: "DE 2 A 4 SALARIOS MINIMOS",
      sexo: "F",
    });
    expect(r.sexoId).toBe("2");
    expect(r.dataNascimento).toBe("1985-04-12");
    expect(r.nomeMae).toBe("MARIA APARECIDA SOUZA");
    expect(r.rendaId).toBe("2"); // faixa "1 a 3" pelo limite inferior
  });

  it("sexo masculino", () => {
    expect(fichaDoEnriquecimento({ nascimento: "", nomeMae: "", renda: "", sexo: "M" }).sexoId).toBe(
      "1",
    );
  });

  it("campo que a base não soube responder fica de fora (não vira string vazia gravada)", () => {
    const r = fichaDoEnriquecimento({ nascimento: "", nomeMae: "", renda: "", sexo: "" });
    expect(r.sexoId).toBeUndefined();
    expect(r.nomeMae).toBeUndefined();
    expect(r.dataNascimento).toBeUndefined();
    expect(r.rendaId).toBeUndefined();
  });

  it("aceita os formatos que a BigDataCorp usa para renda", () => {
    // Regressão: a outra matchFaixaRendaId do projeto (c2x-match) devolve null para estes textos,
    // e o enriquecimento saía com renda vazia depois de pagar pela consulta.
    const faixa = (renda: string) =>
      fichaDoEnriquecimento({ nascimento: "", nomeMae: "", renda, sexo: "" }).rendaId;
    expect(faixa("DE 2 A 4 SALARIOS MINIMOS")).toBe("2");
    expect(faixa("DE 4 A 10 SALARIOS MINIMOS")).toBe("3");
    expect(faixa("ACIMA DE 20 SALARIOS MINIMOS")).toBe("6");
  });

  it("sexo que a base devolve fora do padrão não vira chute", () => {
    expect(
      fichaDoEnriquecimento({ nascimento: "", nomeMae: "", renda: "", sexo: "INDEFINIDO" }).sexoId,
    ).toBeUndefined();
  });

  it("renda 'ABAIXO DE 1 SALARIO' cai na primeira faixa", () => {
    expect(
      fichaDoEnriquecimento({
        nascimento: "",
        nomeMae: "",
        renda: "ABAIXO DE 1 SALARIO MINIMO",
        sexo: "",
      }).rendaId,
    ).toBe("1");
  });
});

describe("custo", () => {
  it("a consulta PF_01 custa em torno de R$ 1,06 (6 datasets)", () => {
    const custo = custoPorConsulta();
    expect(custo).toBeGreaterThan(1);
    expect(custo).toBeLessThan(1.2);
  });
});
