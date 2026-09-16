import { describe, expect, it } from "vitest";

import { avisoDoDocumento } from "./regras";

// POR QUE O BOTÃO NÃO ACENDE — a frase que faltava nas telas públicas.
//
// ⚠️ O CASO REAL QUE ORIGINOU ISTO. Lucas, 15/09/2026: *"as imobiliarias não estão conseguindo
// seguir com o cadastro"*, com o print de `c2x.app.br/publico/imobiliaria` mostrando o CNPJ
// 61.061.769/0001-90 digitado, o "Continuar" apagado e nenhuma explicação na tela.
//
// ⚠️ O VALIDADOR ESTAVA CERTO, E ISSO FOI MEDIDO ANTES DE MEXER EM QUALQUER COISA: os 549 CNPJs de
// imobiliária cadastrados no C2X passam TODOS no `cnpjValido` — zero recusados, zero com menos de
// 14 dígitos, zero com letra. O CNPJ do print é inválido de verdade (o dígito verificador calcula
// 04, e o informado é 90). Consertar a régua teria aberto a porta para documento inválido entrar.
// O que faltava era a tela dizer o que estava errado.

describe("enquanto a pessoa digita, a tela fica calada", () => {
  // ⚠️ ACUSAR CEDO É ACUSAR QUEM ESTÁ FAZENDO CERTO. Um "CPF inválido" no terceiro dígito aparece
  // para todo mundo, sempre, e ensina o visitante a ignorar a mensagem — que é justamente a que
  // ele vai precisar ler no fim.
  it("campo vazio não diz nada", () => {
    expect(avisoDoDocumento("", "cnpj")).toBe("");
    expect(avisoDoDocumento("", "cpf")).toBe("");
  });

  it("nulo e indefinido não quebram nem acusam", () => {
    expect(avisoDoDocumento(null, "cnpj")).toBe("");
    expect(avisoDoDocumento(undefined, "cpf")).toBe("");
  });

  it("CNPJ pela metade não diz nada", () => {
    expect(avisoDoDocumento("61.061.769", "cnpj")).toBe("");
    expect(avisoDoDocumento("61.061.769/0001-9", "cnpj")).toBe("");
  });

  it("CPF pela metade não diz nada", () => {
    expect(avisoDoDocumento("529.982.24", "cpf")).toBe("");
  });
});

describe("documento completo e errado: aí sim a tela fala", () => {
  // ⚠️ O NÚMERO DO PRINT. Se este teste ficar verde por acidente (por exemplo porque alguém
  // afrouxou o validador), o cadastro volta a aceitar CNPJ que não existe.
  it("o CNPJ do print recebe a frase", () => {
    expect(avisoDoDocumento("61.061.769/0001-90", "cnpj")).toBe(
      "Esse CNPJ não existe. Revise os números e tente de novo.",
    );
  });

  it("sem máscara, mesmo resultado", () => {
    expect(avisoDoDocumento("61061769000190", "cnpj")).toBe(
      "Esse CNPJ não existe. Revise os números e tente de novo.",
    );
  });

  it("CPF completo e errado recebe a frase", () => {
    expect(avisoDoDocumento("111.222.333-45", "cpf")).toBe(
      "Esse CPF não existe. Revise os números e tente de novo.",
    );
  });

  // ⚠️ A FRASE NÃO CULPA E NÃO ENSINA DÍGITO VERIFICADOR. Quem está do outro lado é um parceiro
  // tentando se credenciar; "revise os números" é o que ele consegue fazer, "o DV não fecha" não é.
  it("a frase diz o que fazer, não o que a matemática achou", () => {
    const frase = avisoDoDocumento("61061769000190", "cnpj");
    expect(frase).toContain("não existe");
    expect(frase).toContain("Revise os números");
    // ⚠️ "dígito verificador" é vocabulário de quem escreveu o validador, não de quem está
    // preenchendo o formulário. A frase diz o que a pessoa pode FAZER.
    expect(frase.toLowerCase()).not.toContain("dígito");
  });
});

describe("documento certo volta a calar", () => {
  // CNPJ de teste com dígitos conferidos à mão: 11.222.333/0001-81 (o mesmo que
  // `lib/apolo/documento.test.ts` usa desde que o validador nasceu).
  it("CNPJ válido não recebe frase nenhuma", () => {
    expect(avisoDoDocumento("11.222.333/0001-81", "cnpj")).toBe("");
  });

  it("CPF válido não recebe frase nenhuma", () => {
    expect(avisoDoDocumento("529.982.247-25", "cpf")).toBe("");
  });
});

describe("os casos que enganam", () => {
  // ⚠️ 00.000.000/0000-00 PASSA NA CONTA DO DÍGITO VERIFICADOR e é recusado por uma regra à parte.
  // Sem ela, o zero repetido entraria como CNPJ legítimo — e é o que um scanner burro tenta.
  it("todos os dígitos iguais recebem a frase", () => {
    expect(avisoDoDocumento("00.000.000/0000-00", "cnpj")).not.toBe("");
    expect(avisoDoDocumento("111.111.111-11", "cpf")).not.toBe("");
  });

  // ⚠️ DÍGITO A MAIS NÃO É "AINDA DIGITANDO". O campo corta em 18 caracteres com máscara, mas um
  // colar de outro app pode trazer sujeira; 15 dígitos não é um CNPJ em construção, é um erro.
  it("mais dígitos que o documento comporta recebe a frase", () => {
    expect(avisoDoDocumento("610617690001901", "cnpj")).not.toBe("");
  });

  it("letra no meio não derruba: sobra menos dígito e a tela cala", () => {
    // "61.061.769/0001-9X" → 13 dígitos, ainda em construção do ponto de vista da régua.
    expect(avisoDoDocumento("61.061.769/0001-9X", "cnpj")).toBe("");
  });
});
