import { describe, expect, it } from "vitest";

import { mesclarCliente } from "./mesclar-cliente";

describe("o cadastro que a carga grava", () => {
  it("LSoft em branco NÃO apaga o que o MOST trouxe (o que se perdeu em 08/09 e 16/09)", () => {
    const doLsoft = { codigo: "00000403", mae: null, nascimento: null, nome: "ANA JULIA", telefone: "3799990000" };
    const doBanco = { codigo: "00000403", mae: "MARIA DAS GRACAS", nascimento: "1990-04-12", nome: "ANA JULIA", telefone: null };

    const r = mesclarCliente(doLsoft, doBanco);

    expect(r.mae).toBe("MARIA DAS GRACAS");
    expect(r.nascimento).toBe("1990-04-12");
    // O que o LSoft traz de novo continua entrando.
    expect(r.telefone).toBe("3799990000");
  });

  it("o que o time corrigiu na tela vence o LSoft, mesmo com o LSoft trazendo valor", () => {
    const doLsoft = { codigo: "1", nome: "ANA JULIA", telefone: "3700000000" };
    const doBanco = { codigo: "1", nome: "ANA JULIA", telefone: "37999990000" };

    expect(mesclarCliente(doLsoft, doBanco, new Set(["telefone"])).telefone).toBe("37999990000");
    // Sem edição na tela, o LSoft atualiza.
    expect(mesclarCliente(doLsoft, doBanco).telefone).toBe("3700000000");
  });

  it("a lista de empreendimentos SOMA: carga só do Giant Towers não tira o Garden do cliente", () => {
    const doLsoft = { codigo: "1", empreendimentos: ["Giant Towers"], nome: "X" };
    const doBanco = { codigo: "1", empreendimentos: ["Garden", "Vale do Sol"], nome: "X" };
    expect(mesclarCliente(doLsoft, doBanco).empreendimentos).toEqual(["Garden", "Giant Towers", "Vale do Sol"]);
  });

  it("'(sem nome)' é o marcador do importador, não apaga o nome que o banco tem", () => {
    const r = mesclarCliente({ codigo: "1", nome: "(sem nome)" }, { codigo: "1", nome: "JOSE DA SILVA" });
    expect(r.nome).toBe("JOSE DA SILVA");
  });

  it("cliente novo entra exatamente como o LSoft manda", () => {
    const doLsoft = { codigo: "9", mae: null, nome: "NOVO" };
    expect(mesclarCliente(doLsoft, null)).toBe(doLsoft);
  });

  it("bloqueado e código são sempre do LSoft", () => {
    const r = mesclarCliente({ bloqueado: false, codigo: "1", nome: "X" }, { bloqueado: true, codigo: "1", nome: "X" });
    expect(r.bloqueado).toBe(false);
  });

  it("edição na tela com valor vazio no banco não impede o LSoft de preencher", () => {
    // Se o time apagou o campo e o banco está vazio, não há o que proteger: o LSoft preenche.
    const r = mesclarCliente({ codigo: "1", email: "a@b.com", nome: "X" }, { codigo: "1", email: null, nome: "X" }, new Set(["email"]));
    expect(r.email).toBe("a@b.com");
  });
});
