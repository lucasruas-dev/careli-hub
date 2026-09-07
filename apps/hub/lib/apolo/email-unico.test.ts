import { describe, expect, it } from "vitest";

import { conferirEmailUnico, mensagemDeConflito, normalizarEmail } from "./email-unico";

// ⚠️ O QUE ESTES TESTES PROTEGEM. No D4Sign o signatário É o e-mail — não há campo de nome nem de
// CPF. Dois signatários com o mesmo endereço produzem um contrato assinado em que não se sabe quem
// assinou, e isso não dá erro em lugar nenhum: sai no papel. Medido em 07/09/2026: 26 e-mails
// repetidos, 54 pessoas, sendo o pior caso um CORRETOR cujo e-mail está em duas fichas de cliente.

describe("normalizarEmail", () => {
  it("apara e baixa a caixa", () => {
    expect(normalizarEmail("  Fulano@Exemplo.COM.br ")).toBe("fulano@exemplo.com.br");
  });

  it("devolve null para vazio e ausente", () => {
    expect(normalizarEmail("")).toBeNull();
    expect(normalizarEmail("   ")).toBeNull();
    expect(normalizarEmail(null)).toBeNull();
    expect(normalizarEmail(undefined)).toBeNull();
  });

  // ⚠️ O CASO QUE TRAVARIA A CAD POR ENGANO. `apolo_contacts` guarda 18 valores em
  // `contact_type='email'` que são HASH, não endereço (resíduo de mascaramento). Se o hash contasse
  // como e-mail, duas pessoas SEM e-mail nenhum apareceriam como conflito, e o operador teria de
  // inventar um endereço para conseguir salvar — pondo justamente o dado errado no contrato.
  it("recusa hash, que não é e-mail", () => {
    expect(normalizarEmail("03ac223d5c90c024baa594a2a212ddb4bd4d158b97f4fac9623d48b4850081fd")).toBeNull();
  });

  it("recusa o que não tem cara de endereço", () => {
    expect(normalizarEmail("sem arroba")).toBeNull();
    expect(normalizarEmail("@dominio.com")).toBeNull();
    expect(normalizarEmail("nome@")).toBeNull();
    expect(normalizarEmail("nome@semponto")).toBeNull();
    expect(normalizarEmail("nome@dominio.")).toBeNull();
    expect(normalizarEmail("nome@.com")).toBeNull();
    expect(normalizarEmail("dois@arrobas@com.br")).toBeNull();
    expect(normalizarEmail("com espaco@exemplo.com")).toBeNull();
  });

  it("aceita endereço comum, com ponto e sinal de mais", () => {
    expect(normalizarEmail("ana.paula+cad@exemplo.com.br")).toBe("ana.paula+cad@exemplo.com.br");
  });
});

describe("conferirEmailUnico", () => {
  const ana = { entityId: "e1", nome: "ANA PAULA SOUZA" };
  const carlos = { entityId: "e2", nome: "CARLOS EDUARDO LOPES" };

  it("sem e-mail não há conflito — o cadastro segue", () => {
    expect(conferirEmailUnico({ donos: [ana], email: null })).toBeNull();
    expect(conferirEmailUnico({ donos: [ana], email: "  " })).toBeNull();
  });

  it("e-mail livre passa", () => {
    expect(conferirEmailUnico({ donos: [], email: "novo@exemplo.com" })).toBeNull();
  });

  it("e-mail de outra pessoa é conflito", () => {
    const c = conferirEmailUnico({ donos: [ana], email: "ANA@exemplo.com" });
    expect(c?.email).toBe("ana@exemplo.com");
    expect(c?.donos).toEqual([ana]);
    expect(c?.mensagem).toContain("ANA PAULA SOUZA");
  });

  // ⚠️ Reencontrar o próprio e-mail na própria ficha não é conflito: seria a CAD se recusando a
  // salvar por causa de si mesma. É o modo anexo do dedup por documento.
  it("a ficha que esta CAD vai atualizar não conta contra ela mesma", () => {
    expect(
      conferirEmailUnico({ donos: [ana], email: "ana@exemplo.com", entityIdPermitida: "e1" }),
    ).toBeNull();
  });

  it("mas outra pessoa no mesmo e-mail continua sendo conflito", () => {
    const c = conferirEmailUnico({
      donos: [ana, carlos],
      email: "ana@exemplo.com",
      entityIdPermitida: "e1",
    });
    expect(c?.donos).toEqual([carlos]);
  });

  it("o caso do corretor: três pessoas no mesmo endereço", () => {
    const c = conferirEmailUnico({
      donos: [ana, carlos, { entityId: "e3", nome: "DEMETRIUS ALVES" }],
      email: "corretor@exemplo.com",
    });
    expect(c?.donos).toHaveLength(3);
    expect(c?.mensagem).toContain("DEMETRIUS ALVES");
  });
});

describe("mensagemDeConflito", () => {
  // ⚠️ DIZ DE QUEM É. "E-mail já cadastrado" manda o operador adivinhar, e o caminho mais curto para
  // destravar a tela seria inventar um endereço — exatamente o dado errado indo para o contrato.
  it("nomeia uma pessoa", () => {
    const m = mensagemDeConflito("x@y.com", [{ entityId: "e1", nome: "ANA" }]);
    expect(m).toContain("x@y.com");
    expect(m).toContain("ANA");
  });

  it("junta duas com 'e'", () => {
    const m = mensagemDeConflito("x@y.com", [
      { entityId: "e1", nome: "ANA" },
      { entityId: "e2", nome: "CARLOS" },
    ]);
    expect(m).toContain("ANA e CARLOS");
  });

  it("junta três com vírgula e 'e'", () => {
    const m = mensagemDeConflito("x@y.com", [
      { entityId: "e1", nome: "ANA" },
      { entityId: "e2", nome: "CARLOS" },
      { entityId: "e3", nome: "DEMETRIUS" },
    ]);
    expect(m).toContain("ANA, CARLOS e DEMETRIUS");
  });

  it("sem nome, não deixa a frase pela metade", () => {
    const m = mensagemDeConflito("x@y.com", [{ entityId: "e1", nome: "" }]);
    expect(m).toContain("outro cadastro");
  });

  it("explica POR QUE, para o operador não achar que é burocracia", () => {
    const m = mensagemDeConflito("x@y.com", [{ entityId: "e1", nome: "ANA" }]);
    expect(m).toContain("assinatura");
  });
});
