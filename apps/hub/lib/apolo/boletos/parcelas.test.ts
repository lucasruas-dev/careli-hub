import { describe, expect, it } from "vitest";

import { chaveDaParcela, lerChaveDaParcela } from "./parcelas";

// A CHAVE QUE DEIXA DUAS COBRANÇAS CONVIVEREM NA MESMA UNIDADE — e continua barrando a duplicata.
//
// O caso: LUCAS AGUIAR SOARES, Vale do Ouro - 2, unidade Q10 L03, competência 2026-09. Tem a mensal
// de R$ 1.666,67 vencendo dia 10 (parcela 2 de 60) e a ENTRADA de R$ 8.750,00 vencendo dia 20
// (parcela 3 de 4). Pedido do Lucas (08/09/2026): *"Cria duas linhas vou verificar, ae se for o
// caso fazemos emissão separado"*.
//
// ⚠️ ESTA CHAVE É O ESPELHO DA UNIQUE DO BANCO. `UNIQUE (workspace_id, empreendimento, unidade,
// competencia, sequencia)` decide o que cabe na tabela; `chaveDaParcela` decide o que a tela, o
// corpo das rotas e a referência da cobrança conseguem distinguir. Se as duas discordarem, o banco
// aceita duas linhas que o resto do sistema trata como uma — e uma delas some.

describe("a chave da parcela", () => {
  it("duas cobranças da mesma unidade no mesmo mês são DUAS coisas diferentes", () => {
    const mensal = chaveDaParcela({ sequencia: 1, unidade: "Q10 L03" });
    const entrada = chaveDaParcela({ sequencia: 2, unidade: "Q10 L03" });

    expect(mensal).toBe("Q10 L03");
    expect(entrada).toBe("Q10 L03#2");
    expect(mensal).not.toBe(entrada);
  });

  it("a trava continua valendo: mesma unidade, mesma sequência = a MESMA parcela", () => {
    // ⚠️ É O QUE IMPEDE COBRAR DUAS VEZES. A unicidade não foi afrouxada, ganhou um discriminador:
    // duas linhas com a mesma unidade E a mesma sequência continuam sendo uma duplicata, e é isso
    // que a UNIQUE recusa no banco. Se esta afirmação falhar, o discriminador virou identidade e a
    // proteção das outras carteiras (Garden 143 linhas, Vale do Sol 103) deixou de existir.
    expect(chaveDaParcela({ sequencia: 2, unidade: "Q10 L03" })).toBe(
      chaveDaParcela({ sequencia: 2, unidade: "Q10 L03" }),
    );
    expect(chaveDaParcela({ sequencia: 1, unidade: "307" })).toBe(
      chaveDaParcela({ sequencia: 1, unidade: "307" }),
    );
  });

  it("unidades diferentes nunca colidem, mesmo com o sufixo em jogo", () => {
    const chaves = [
      chaveDaParcela({ sequencia: 1, unidade: "Q10 L03" }),
      chaveDaParcela({ sequencia: 2, unidade: "Q10 L03" }),
      chaveDaParcela({ sequencia: 1, unidade: "Q10 L04" }),
      chaveDaParcela({ sequencia: 1, unidade: "307" }),
      chaveDaParcela({ sequencia: 2, unidade: "307" }),
    ];
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it("a sequência 1 NÃO aparece — é o que mantém as 4.094 linhas de sempre com o mesmo nome", () => {
    // ⚠️ Medido em 08/09/2026: todas as linhas existentes nascem com `sequencia = 1` pelo DEFAULT
    // da 0146. Se a chave delas mudasse, a seleção da tela, o `unidades: [...]` do POST e as
    // referências das cobranças já emitidas no Asaas parariam de casar de uma vez.
    for (const seq of [undefined, null, 1]) {
      expect(chaveDaParcela({ sequencia: seq, unidade: "Q07 L24" })).toBe("Q07 L24");
    }
  });

  it("a unidade volta inteira, com o espaço que ela tem no banco", () => {
    // 235 das 315 unidades de setembro têm espaço (todo o Garden e todo o Vale do Sol).
    expect(lerChaveDaParcela("Q10 L03#2")).toEqual({ sequencia: 2, unidade: "Q10 L03" });
    expect(lerChaveDaParcela("Q10 L03")).toEqual({ sequencia: 1, unidade: "Q10 L03" });
    expect(lerChaveDaParcela("00000430")).toEqual({ sequencia: 1, unidade: "00000430" });
  });

  it("ida e volta não muda nada — nem na primeira, nem na segunda", () => {
    for (const unidade of ["Q10 L03", "307", "00000430", "QD 3 LT 10", "TESTE-01"]) {
      for (const sequencia of [1, 2, 9]) {
        expect(lerChaveDaParcela(chaveDaParcela({ sequencia, unidade }))).toEqual({
          sequencia,
          unidade,
        });
      }
    }
  });

  it("o que não for chave volta como a PRIMEIRA cobrança, e não como erro", () => {
    // ⚠️ Quem chama a rota direto manda a unidade crua, e é isso que ela sempre significou aqui.
    // Devolver erro faria a chamada de sempre parar de funcionar.
    expect(lerChaveDaParcela("Q10 L03#")).toEqual({ sequencia: 1, unidade: "Q10 L03#" });
    expect(lerChaveDaParcela("Q10 L03#x")).toEqual({ sequencia: 1, unidade: "Q10 L03#x" });
    expect(lerChaveDaParcela("Q10 L03#0")).toEqual({ sequencia: 1, unidade: "Q10 L03#0" });
    expect(lerChaveDaParcela("#2")).toEqual({ sequencia: 1, unidade: "#2" });
    expect(lerChaveDaParcela("")).toEqual({ sequencia: 1, unidade: "" });
  });
});
