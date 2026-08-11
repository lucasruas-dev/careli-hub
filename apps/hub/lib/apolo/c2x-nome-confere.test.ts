import { describe, expect, it } from "vitest";

import { confereNomeC2x, normalizarNomeC2x, semNomeNoC2x } from "./c2x-nome-confere";

// A REGRA QUE ESTE ARQUIVO PROTEGE: o documento não casa pessoa sozinho.
//
// A reconciliação liga uma CAD do Apolo a um `users.id` do C2X pelo CPF/CNPJ. Um dígito errado no
// Apolo basta para esse casamento apontar para outra pessoa — e aí a CAD de um vira o cliente de
// outro, num sistema de CONTRATOS, sem nenhum alarme (o id volta certo, a gravação dá certo).
//
// O nome é a segunda testemunha. Ele NÃO autoriza (homônimo existe); ele VETA. Por isso todo caso
// duvidoso aqui tem que cair em `confere: false`: falso suspeito custa uma conferência de 10
// segundos, falso "confere" custa um contrato com a pessoa errada.

describe("normalizarNomeC2x", () => {
  it("tira acento, caixa e pontuação — o C2X grava em caixa alta e sem acento", () => {
    expect(normalizarNomeC2x("Lucélia Fernanda Pinto")).toBe("LUCELIA FERNANDA PINTO");
    expect(normalizarNomeC2x("  JOÃO   D'ÁVILA-SOUZA ")).toBe("JOAO D AVILA SOUZA");
  });
});

describe("confereNomeC2x — o que TEM que passar", () => {
  it("nomes iguais", () => {
    expect(confereNomeC2x(["RAMON LEITE GASPAR"], "RAMON LEITE GASPAR").confere).toBe(true);
  });

  it("acento e caixa de um lado só", () => {
    expect(confereNomeC2x(["Lucélia Fernanda Pinto"], "LUCELIA FERNANDA PINTO").confere).toBe(true);
  });

  it("partícula de ligação a mais de um lado", () => {
    expect(confereNomeC2x(["ELZA QUINTILIANO DE OLIVEIRA"], "ELZA QUINTILIANO OLIVEIRA").confere)
      .toBe(true);
  });

  it("nome do meio a mais de um lado (a importação antiga truncava)", () => {
    const r = confereNomeC2x(["MARIA SILVA"], "MARIA APARECIDA SILVA");
    expect(r.confere).toBe(true);
    expect(r.motivo).toContain("APARECIDA");
  });

  it("um erro de digitação por palavra longa", () => {
    expect(confereNomeC2x(["WILLIAN JONES PEREIRA"], "WILLIAM JONES PEREIRA").confere).toBe(true);
  });

  it("PJ: o C2X guarda a razão social e o card do Apolo mostra o fantasia", () => {
    // Qualquer um dos nomes do Apolo que case já prova a identidade — exigir que case justo o
    // `display_name` reprovaria PJ por uma diferença que não é de identidade.
    const r = confereNomeC2x(
      ["SUPERMERCADO DA VOVÓ", "VOVO BRAGA ALIMENTOS LTDA", null],
      "VOVO BRAGA ALIMENTOS LTDA",
    );
    expect(r.confere).toBe(true);
    // O fantasia não casou; quem salvou o par foi a razão social — e é ela que a lista mostra.
    expect(r.nomeApolo).toBe("VOVO BRAGA ALIMENTOS LTDA");
  });
});

describe("confereNomeC2x — o que NÃO PODE passar", () => {
  it("outra pessoa: o CPF digitado errado é exatamente isto", () => {
    const r = confereNomeC2x(["RONALDO DOS SANTOS"], "MARCOS ANTONIO DA SILVA");
    expect(r.confere).toBe(false);
    expect(r.motivo).toContain("primeiro nome não bate");
  });

  it("mesmo primeiro nome, sobrenome trocado", () => {
    const r = confereNomeC2x(["MARIA APARECIDA SILVA"], "MARIA APARECIDA SANTOS");
    expect(r.confere).toBe(false);
    expect(r.motivo).toContain("sobrenomes não batem");
  });

  it("só o primeiro nome em comum não prova nada", () => {
    // "MARIA" bate com milhares de cadastros. Sem sobrenome, é suspeito por construção.
    expect(confereNomeC2x(["MARIA"], "MARIA APARECIDA SILVA").confere).toBe(false);
  });

  it("erro de UMA letra em palavra CURTA não é tolerado", () => {
    // Em palavra de 3-4 letras, uma letra é outro nome ("ANA"/"ANE", "ELZA"/"ELSA").
    expect(confereNomeC2x(["ANA PEREIRA LIMA"], "ANE PEREIRA LIMA").confere).toBe(false);
  });

  it("nome vazio dos dois lados NUNCA autoriza", () => {
    // O risco é este: cadastro sem nome no C2X passaria por "igual a tudo" numa comparação ingênua.
    expect(confereNomeC2x(["RAMON LEITE GASPAR"], "").confere).toBe(false);
    expect(confereNomeC2x(["RAMON LEITE GASPAR"], null).confere).toBe(false);
    expect(confereNomeC2x([null, ""], "RAMON LEITE GASPAR").confere).toBe(false);
    expect(confereNomeC2x([], null).confere).toBe(false);
  });

  it("a recusa diz OS DOIS nomes: conferência é de olho, não de fé", () => {
    const r = confereNomeC2x(["JOSE CARLOS ALMEIDA"], "PEDRO HENRIQUE MOTA");
    expect(r.confere).toBe(false);
    expect(r.nomeApolo).toBe("JOSE CARLOS ALMEIDA");
    expect(r.motivo).toContain("JOSE");
    expect(r.motivo).toContain("PEDRO");
  });
});

// ── OS DOIS BURACOS QUE O DADO REAL MOSTROU (medição de 08/08 no banco do C2X) ──────────────────
//
// A tolerância de "um erro de digitação por palavra" era cega para duas formas de diferença que NÃO
// são digitação, e as duas estavam no banco de produção. Cada caso abaixo é um par que existe (ou
// existiu) no C2X, não um exemplo inventado.
describe("confereNomeC2x — troca da PRIMEIRA letra não é erro de digitação", () => {
  it("VANDER x SANDER: dois usuários DIFERENTES do C2X (2135 e 2136)", () => {
    expect(confereNomeC2x(["SANDER INCOMPLETO"], "VANDER INCOMPLETO").confere).toBe(false);
  });

  it("SELIOMAR x HELIOMAR: usuários 3714 e 3919, CPFs DIFERENTES", () => {
    expect(confereNomeC2x(["SELIOMAR SIMOES DA SILVA"], "HELIOMAR SIMOES DA SILVA").confere)
      .toBe(false);
  });

  it("letra a mais no começo também não passa", () => {
    expect(confereNomeC2x(["ANDERSON PEREIRA LIMA"], "SANDERSON PEREIRA LIMA").confere).toBe(false);
  });

  it("mas a troca no MEIO/FIM continua tolerada — é o caso que a régua existe para aceitar", () => {
    expect(confereNomeC2x(["WILLIAN JONES PEREIRA"], "WILLIAM JONES PEREIRA").confere).toBe(true);
  });
});

describe("confereNomeC2x — flexão de gênero no fim da palavra é OUTRA PESSOA (o cônjuge)", () => {
  // Esta casa já tem catalogado o erro de "ficha com os dados do cônjuge". A testemunha do nome não
  // pode ser cega justamente nele.
  it.each([
    ["PAULO SERGIO ALVES", "PAULA SERGIO ALVES"],
    ["ROBERTO CARLOS LIMA", "ROBERTA CARLOS LIMA"],
    ["LUCIANA PEREIRA COSTA", "LUCIANO PEREIRA COSTA"],
    ["FRANCISCO DE ASSIS SILVA", "FRANCISCA DE ASSIS SILVA"],
    ["JOSE MARIA SANTOS", "JOSE MARIO SANTOS"],
  ])("%s x %s não confere", (apolo, c2x) => {
    expect(confereNomeC2x([apolo], c2x).confere).toBe(false);
  });

  it("vogal de flexão SOBRANDO no fim também não confere", () => {
    expect(confereNomeC2x(["LUCIAN PEREIRA COSTA"], "LUCIANA PEREIRA COSTA").confere).toBe(false);
  });

  it("consoante no fim (N/M) continua sendo digitação, não gênero", () => {
    expect(confereNomeC2x(["JONATHAN SOUZA REIS"], "JONATHAM SOUZA REIS").confere).toBe(true);
  });
});

describe("semNomeNoC2x — ausência de nome é um desfecho próprio, não uma divergência", () => {
  it("reconhece o cadastro sem nome (425 usuários do C2X estão assim)", () => {
    expect(semNomeNoC2x("")).toBe(true);
    expect(semNomeNoC2x(null)).toBe(true);
    expect(semNomeNoC2x("   ")).toBe(true);
    expect(semNomeNoC2x("-")).toBe(true);
  });

  it("nome de verdade não é ausência", () => {
    expect(semNomeNoC2x("RAMON LEITE GASPAR")).toBe(false);
  });
});
