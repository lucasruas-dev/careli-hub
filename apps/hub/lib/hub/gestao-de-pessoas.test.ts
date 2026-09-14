import { describe, expect, it } from "vitest";

import {
  ehAdmin,
  podeAbrirSetupDePessoas,
  podeEscreverPessoa,
  type ChamadorDoSetup,
} from "./gestao-de-pessoas";

const ADMIN: ChamadorDoSetup = {
  id: "lucas",
  podeGerirPessoas: false,
  role: "admin",
  status: "active",
};

// A Raiane: cdr (role leader) com a permissao de gerir pessoas.
const RH: ChamadorDoSetup = {
  id: "raiane",
  podeGerirPessoas: true,
  role: "leader",
  status: "active",
};

const LIDER_COMUM: ChamadorDoSetup = {
  id: "cinthia",
  podeGerirPessoas: false,
  role: "leader",
  status: "active",
};

describe("quem entra", () => {
  it("admin entra, RH entra, lider comum nao", () => {
    expect(podeAbrirSetupDePessoas(ADMIN)).toBe(true);
    expect(podeAbrirSetupDePessoas(RH)).toBe(true);
    expect(podeAbrirSetupDePessoas(LIDER_COMUM)).toBe(false);
  });

  // ⚠️ DESLIGADO NAO ENTRA, mesmo com a permissao concedida: a permissao nao ressuscita conta.
  it("quem nao esta ativo nao entra", () => {
    expect(podeAbrirSetupDePessoas({ ...RH, status: "disabled" })).toBe(false);
    expect(podeAbrirSetupDePessoas({ ...ADMIN, status: "disabled" })).toBe(false);
  });

  it("ehAdmin nao se confunde com a permissao de RH", () => {
    expect(ehAdmin(ADMIN)).toBe(true);
    expect(ehAdmin(RH)).toBe(false);
  });
});

describe("INVARIANTE 1 — ninguem que nao e admin concede o perfil adm", () => {
  it("RH nao cria admin", () => {
    const v = podeEscreverPessoa(RH, { perfilDesejado: "adm" });

    expect(v.ok).toBe(false);
    expect(v.motivo).toContain("admin");
  });

  it("RH nao promove ninguem a admin", () => {
    expect(
      podeEscreverPessoa(RH, {
        alvoRoleAtual: "operator",
        alvoUserId: "fulano",
        perfilDesejado: "adm",
      }).ok,
    ).toBe(false);
  });

  it("RH cria e edita os perfis normais", () => {
    for (const perfil of ["op1", "op2", "op3", "ldr", "cdr"]) {
      expect(podeEscreverPessoa(RH, { perfilDesejado: perfil }).ok, perfil).toBe(true);
    }
  });

  it("admin continua podendo criar admin", () => {
    expect(podeEscreverPessoa(ADMIN, { perfilDesejado: "adm" }).ok).toBe(true);
  });
});

describe("INVARIANTE 2 — ninguem que nao e admin toca em quem JA e admin", () => {
  // ⚠️ O CAMINHO QUE NAO PASSA POR PAPEL NENHUM: o PATCH reescreve o e-mail com
  // email_confirm:true. Apontar o login de um admin para uma caixa propria e pedir "esqueci a
  // senha" e tomada de conta sem nunca escrever "adm".
  it("RH nao troca o e-mail de um admin", () => {
    const v = podeEscreverPessoa(RH, {
      alvoRoleAtual: "admin",
      alvoUserId: "lucas",
      mudaEmail: true,
    });

    expect(v.ok).toBe(false);
    expect(v.motivo).toContain("admin");
  });

  it("RH nao rebaixa nem desativa um admin", () => {
    expect(
      podeEscreverPessoa(RH, {
        alvoRoleAtual: "admin",
        alvoUserId: "lucas",
        perfilDesejado: "op1",
      }).ok,
    ).toBe(false);
    expect(
      podeEscreverPessoa(RH, {
        alvoRoleAtual: "admin",
        alvoUserId: "lucas",
        novoStatus: "disabled",
      }).ok,
    ).toBe(false);
  });

  it("RH edita normalmente quem nao e admin", () => {
    expect(
      podeEscreverPessoa(RH, {
        alvoRoleAtual: "operator",
        alvoUserId: "fulano",
        mudaEmail: true,
        perfilDesejado: "ldr",
      }).ok,
    ).toBe(true);
  });
});

describe("INVARIANTE 3 — ninguem que nao e admin edita o proprio cadastro", () => {
  it("RH nao edita a si mesmo", () => {
    const v = podeEscreverPessoa(RH, {
      alvoRoleAtual: "leader",
      alvoUserId: "raiane",
      perfilDesejado: "cdr",
    });

    expect(v.ok).toBe(false);
    expect(v.motivo).toContain("propri");
  });

  it("admin edita a si mesmo", () => {
    expect(
      podeEscreverPessoa(ADMIN, {
        alvoRoleAtual: "admin",
        alvoUserId: "lucas",
        perfilDesejado: "adm",
      }).ok,
    ).toBe(true);
  });
});

describe("INVARIANTE 4 — nao se desativa o ultimo admin", () => {
  it("admin nao desliga o ultimo admin ativo", () => {
    const v = podeEscreverPessoa(ADMIN, {
      adminsAtivos: 1,
      alvoRoleAtual: "admin",
      alvoUserId: "nivea",
      novoStatus: "disabled",
    });

    expect(v.ok).toBe(false);
    expect(v.motivo).toContain("admin");
  });

  it("com dois admins, desligar um passa", () => {
    expect(
      podeEscreverPessoa(ADMIN, {
        adminsAtivos: 2,
        alvoRoleAtual: "admin",
        alvoUserId: "nivea",
        novoStatus: "disabled",
      }).ok,
    ).toBe(true);
  });

  // Rebaixar o ultimo admin tranca a casa igual a desativar.
  it("admin nao rebaixa o ultimo admin", () => {
    expect(
      podeEscreverPessoa(ADMIN, {
        adminsAtivos: 1,
        alvoRoleAtual: "admin",
        alvoUserId: "nivea",
        perfilDesejado: "ldr",
      }).ok,
    ).toBe(false);
  });
});

describe("quem nao tem nada nao escreve nada", () => {
  it("lider comum e recusado mesmo pedindo o inofensivo", () => {
    expect(podeEscreverPessoa(LIDER_COMUM, { perfilDesejado: "op1" }).ok).toBe(false);
  });

  it("papel desconhecido nao vira permissao", () => {
    expect(
      podeEscreverPessoa(
        { id: "x", podeGerirPessoas: false, role: "qualquer-coisa", status: "active" },
        { perfilDesejado: "op1" },
      ).ok,
    ).toBe(false);
  });

  it("todo veredito negado diz o porque", () => {
    const negados = [
      podeEscreverPessoa(RH, { perfilDesejado: "adm" }),
      podeEscreverPessoa(LIDER_COMUM, { perfilDesejado: "op1" }),
      podeEscreverPessoa(RH, { alvoRoleAtual: "admin", alvoUserId: "lucas" }),
    ];

    for (const v of negados) {
      expect(v.ok).toBe(false);
      expect(v.motivo.length).toBeGreaterThan(0);
    }
  });
});
