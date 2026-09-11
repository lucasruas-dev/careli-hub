import { describe, expect, it } from "vitest";

import { temAlteracaoNaoSalva } from "./politica-rascunho";

// O QUE ESTE TESTE TRAVA (chamado do Lucas em 11/09/2026): ele mandou um print da tela de
// política comercial com "1,5" e "4,5" nos campos e, logo abaixo, a frase "Comissão total do
// contrato: não cadastrado". Concluiu — com razão — que havia divergência entre o Panteon e o
// C2X. Não havia: os dois números eram o PLACEHOLDER do input (`placeholder="1,5"` e
// `placeholder="4,5"`), e o banco estava vazio. Medido no mesmo dia: das 18 linhas de
// `apolo_enterprise_settings`, 17 com as duas colunas nulas.
//
// A tela não distinguia "o que você está vendo" de "o que está guardado". Isto distingue.

describe("temAlteracaoNaoSalva", () => {
  it("campo intocado não acusa nada", () => {
    expect(temAlteracaoNaoSalva(undefined, 1.5)).toBe(false);
    expect(temAlteracaoNaoSalva(undefined, null)).toBe(false);
  });

  it("o que foi digitado e ainda não salvo acusa", () => {
    expect(temAlteracaoNaoSalva("1,5", null)).toBe(true);
    expect(temAlteracaoNaoSalva("4,5", 4)).toBe(true);
  });

  it("digitar o mesmo valor que já está salvo não acusa", () => {
    expect(temAlteracaoNaoSalva("1,5", 1.5)).toBe(false);
    expect(temAlteracaoNaoSalva("4", 4)).toBe(false);
  });

  // ⚠️ O OPERADOR DIGITA COM VÍRGULA e o banco guarda ponto. Sem normalizar, "1,5" contra 1.5
  // seria sempre "não salvo", e o aviso viraria ruído permanente que ninguém lê.
  it("vírgula e ponto são o mesmo número", () => {
    expect(temAlteracaoNaoSalva("1.5", 1.5)).toBe(false);
    expect(temAlteracaoNaoSalva("1,50", 1.5)).toBe(false);
    expect(temAlteracaoNaoSalva("01,5", 1.5)).toBe(false);
  });

  it("espaço em volta não é alteração", () => {
    expect(temAlteracaoNaoSalva(" 1,5 ", 1.5)).toBe(false);
  });

  // Limpar um campo que tinha valor É uma alteração: `null` na política significa "não fazemos
  // isso neste empreendimento", que é decisão, e precisa ser salva para valer.
  it("limpar um campo preenchido acusa", () => {
    expect(temAlteracaoNaoSalva("", 1.5)).toBe(true);
  });

  it("campo vazio sobre valor vazio não acusa", () => {
    expect(temAlteracaoNaoSalva("", null)).toBe(false);
    expect(temAlteracaoNaoSalva("   ", null)).toBe(false);
  });

  // Enquanto a pessoa digita, o campo passa por estados que não são número ("1," antes do "5").
  // Acusar "não salvo" aí está certo: o que está na tela de fato não está no banco.
  it("texto que ainda não é número conta como não salvo", () => {
    expect(temAlteracaoNaoSalva("1,", 1.5)).toBe(true);
    expect(temAlteracaoNaoSalva("abc", null)).toBe(true);
  });

  it("zero é um valor, não um vazio", () => {
    expect(temAlteracaoNaoSalva("0", 0)).toBe(false);
    expect(temAlteracaoNaoSalva("0", null)).toBe(true);
    expect(temAlteracaoNaoSalva("", 0)).toBe(true);
  });
});
