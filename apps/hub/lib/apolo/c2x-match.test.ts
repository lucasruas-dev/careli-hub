import { describe, expect, it } from "vitest";

import { C2X_ESCOLARIDADE, C2X_FAIXA_RENDA } from "./c2x-fields";
import {
  matchEscolaridadeId,
  matchFaixaRendaId,
  matchProfissaoId,
} from "./c2x-match";
import { C2X_PROFISSOES } from "./c2x-professions";

// O formulário do Asana é escrita livre; o cadastro do C2X é lista fechada. Estas funções
// fazem a ponte, e errar aqui é pior que não preencher: profissão e renda entram na análise
// de crédito, e campo errado o operador não percebe.

const rotulo = (lista: { id: number; label: string }[], id: number | null) =>
  lista.find((item) => item.id === id)?.label ?? null;

describe("matchProfissaoId", () => {
  it("casa profissão escrita igual à da lista", () => {
    const id = matchProfissaoId("Comerciante");
    expect(rotulo(C2X_PROFISSOES, id)).toMatch(/COMERCIANTE/i);
  });

  it("ignora acento e caixa", () => {
    expect(matchProfissaoId("MÉDICO")).toBe(matchProfissaoId("medico"));
  });

  it("casa apesar do sufixo de gênero da lista", () => {
    // A lista guarda "ADMINISTRADOR(A)"; o corretor escreve "Administrador".
    const id = matchProfissaoId("Administrador");
    expect(rotulo(C2X_PROFISSOES, id)).toMatch(/ADMINISTRADOR/i);
  });

  // ⚠️ O caso que justifica o limiar alto: são duas profissões diferentes que diferem por
  // uma letra. Casar errado aqui coloca a pessoa na profissão do vizinho.
  it("não confunde Pedreiro com Padeiro", () => {
    const pedreiro = rotulo(C2X_PROFISSOES, matchProfissaoId("Pedreiro"));
    expect(pedreiro).toMatch(/PEDREIRO/i);
    expect(pedreiro).not.toMatch(/PADEIRO/i);
  });

  it("devolve nulo para texto que não é profissão", () => {
    expect(matchProfissaoId("não informado")).toBeNull();
    expect(matchProfissaoId("xyz")).toBeNull();
    expect(matchProfissaoId("")).toBeNull();
    expect(matchProfissaoId(null)).toBeNull();
  });
});

describe("matchEscolaridadeId", () => {
  it("entende os sinônimos que o corretor escreve", () => {
    expect(rotulo(C2X_ESCOLARIDADE, matchEscolaridadeId("2 grau completo"))).toBe(
      "Médio Completo",
    );
    expect(rotulo(C2X_ESCOLARIDADE, matchEscolaridadeId("segundo grau"))).toBe(
      "Médio Completo",
    );
    expect(rotulo(C2X_ESCOLARIDADE, matchEscolaridadeId("faculdade"))).toBe(
      "Superior Completo",
    );
  });

  it("distingue completo de incompleto", () => {
    expect(rotulo(C2X_ESCOLARIDADE, matchEscolaridadeId("Superior incompleto"))).toBe(
      "Superior Incompleto",
    );
    expect(rotulo(C2X_ESCOLARIDADE, matchEscolaridadeId("cursando superior"))).toBe(
      "Superior Incompleto",
    );
  });

  it("reconhece pós-graduação", () => {
    expect(rotulo(C2X_ESCOLARIDADE, matchEscolaridadeId("Mestrado"))).toBe("Mestrado");
    expect(rotulo(C2X_ESCOLARIDADE, matchEscolaridadeId("doutorado"))).toBe("Doutorado");
  });

  it("devolve nulo para 'não informado', que é o padrão do formulário", () => {
    expect(matchEscolaridadeId("Não Informado")).toBeNull();
    expect(matchEscolaridadeId("")).toBeNull();
  });
});

describe("matchFaixaRendaId", () => {
  // O formulário pede o VALOR em reais; o C2X guarda FAIXA em salários mínimos.
  it("converte o valor real da CAD da Márcia (R$ 4.500)", () => {
    // 4500 / 1518 = 2,96 salários → faixa de 1 a 3.
    expect(rotulo(C2X_FAIXA_RENDA, matchFaixaRendaId("4500"))).toBe("1 a 3 salários");
  });

  it("aceita formato brasileiro com R$, ponto e vírgula", () => {
    expect(matchFaixaRendaId("R$ 4.500,00")).toBe(matchFaixaRendaId("4500"));
    expect(matchFaixaRendaId("4.500")).toBe(matchFaixaRendaId("4500"));
  });

  it("acerta as pontas da tabela", () => {
    expect(rotulo(C2X_FAIXA_RENDA, matchFaixaRendaId("1000"))).toBe("Abaixo de 1 salário");
    expect(rotulo(C2X_FAIXA_RENDA, matchFaixaRendaId("50000"))).toBe("Acima de 12 salários");
  });

  it("aceita a faixa já escrita por extenso", () => {
    expect(rotulo(C2X_FAIXA_RENDA, matchFaixaRendaId("3 a 6 salários"))).toBe(
      "3 a 6 salários",
    );
  });

  it("devolve nulo para vazio e para texto sem número", () => {
    expect(matchFaixaRendaId("")).toBeNull();
    expect(matchFaixaRendaId("não informado")).toBeNull();
    expect(matchFaixaRendaId(null)).toBeNull();
  });

  // O salário mínimo é parâmetro justamente porque muda todo ano: a mesma renda cai em
  // faixas diferentes conforme o ano de referência.
  it("respeita o salário mínimo informado", () => {
    // A MESMA renda muda de faixa conforme o ano de referência:
    //   4500 / 1500 = 3,0  → "1 a 3"
    //   4500 /  700 = 6,4  → "6 a 9"
    // É por isso que SALARIO_MINIMO_REFERENCIA precisa ser revisto todo ano: desatualizado,
    // ele empurra a renda para uma faixa mais alta do que a real na análise de crédito.
    expect(rotulo(C2X_FAIXA_RENDA, matchFaixaRendaId("4500", 1500))).toBe("1 a 3 salários");
    expect(rotulo(C2X_FAIXA_RENDA, matchFaixaRendaId("4500", 700))).toBe("6 a 9 salários");
  });
});
