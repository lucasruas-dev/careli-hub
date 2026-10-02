import { describe, expect, it } from "vitest";

import type { SignatarioD4Sign } from "@/lib/guardian/d4sign-consulta";

import type { PessoaDoC2x } from "./c2x";
import { fechamentoDaD4Sign, marcasDaD4Sign, quadroDoEnvioDoC2x, quadroSemAMarca, retratoDoRol } from "./quadro";

// O QUADRO DO ENVIO DO C2X E AS MARCAS DA D4SIGN (F3 da fonte única). Pessoas fictícias.

function pessoa(patch: Partial<PessoaDoC2x> & { linhaId: number }): PessoaDoC2x {
  return {
    csId: 3806,
    email: null,
    nome: "Pessoa",
    papelNoEmpreendimento: null,
    perfilC2x: null,
    posicao: 0,
    testemunha: false,
    usuarioC2xId: null,
    ...patch,
  };
}

function assinante(patch: Partial<SignatarioD4Sign>): SignatarioD4Sign {
  return {
    assinadoEm: null,
    assinou: false,
    chave: "k",
    convidadoEm: null,
    documento: "00000000000",
    email: "",
    entregaDoEmail: null,
    nome: "",
    papel: null,
    ...patch,
  };
}

describe("quadroDoEnvioDoC2x", () => {
  it("chave c2x:<ss.id>, e-mail minúsculo, ordem do after_position e papel nulo", () => {
    const [item] = quadroDoEnvioDoC2x([
      pessoa({ email: "Comprador@Exemplo.test", linhaId: 91, nome: "Ana", perfilC2x: "Cliente", posicao: 2 }),
    ]);
    expect(item).toEqual({
      chave: "c2x:91",
      email: "comprador@exemplo.test",
      nome: "Ana",
      ordem: 2,
      papel: null,
      perfil: "Comprador",
      testemunha: false,
    });
  });

  it("perfilDeTela: Huber (2544) é Coordenadora de venda, @careli.adm.br é Backoffice", () => {
    const quadro = quadroDoEnvioDoC2x([
      pessoa({ email: "coord@exemplo.test", linhaId: 1, perfilC2x: "Administrador", usuarioC2xId: 2544 }),
      pessoa({ email: "time@careli.adm.br", linhaId: 2, perfilC2x: "Imobiliária" }),
      pessoa({ email: "cap@exemplo.test", linhaId: 3, papelNoEmpreendimento: "coordenador", perfilC2x: "Imobiliária" }),
    ]);
    expect(quadro.map((i) => i.perfil)).toEqual(["Coordenadora de venda", "Backoffice", "Coordenadora de venda"]);
  });

  // Lucas, 02/10/2026: a testemunha do C2X "Entra agora". Campo próprio, e o papel continua nulo: a régua
  // do comprador (`ehCompradorNoQuadro`) lê o papel, e ela não pode mudar por causa da marca.
  it("a marca de testemunha do C2X vai no campo próprio, sempre escrita (true ou false), e o papel continua nulo", () => {
    const quadro = quadroDoEnvioDoC2x([
      pessoa({ email: "rh@careli.adm.br", linhaId: 1, nome: "Ana Testemunha", testemunha: true }),
      pessoa({ email: "c@exemplo.test", linhaId: 2, nome: "Cliente", perfilC2x: "Cliente" }),
    ]);
    expect(quadro.map((i) => [i.chave, i.testemunha, i.papel])).toEqual([
      ["c2x:1", true, null],
      ["c2x:2", false, null],
    ]);
  });
});

describe("a marca de testemunha no quadro já gravado", () => {
  it("quadroSemAMarca: o quadro antigo (sem o campo) é reconhecido; o novo e o vazio não", () => {
    expect(quadroSemAMarca([{ chave: "c2x:1" }, { chave: "c2x:2" }] as never)).toBe(true);
    expect(quadroSemAMarca([{ testemunha: true }, { testemunha: false }])).toBe(false);
    expect(quadroSemAMarca([])).toBe(false);
  });

  it("retratoDoRol: a mesma chave sem a marca e com a marca são retratos DIFERENTES (o antigo é regravado); com a marca, iguais", () => {
    const antigo = [{ chave: "c2x:1" }, { chave: "c2x:2" }];
    const relido = [
      { chave: "c2x:1", testemunha: true },
      { chave: "c2x:2", testemunha: false },
    ];
    expect(retratoDoRol(antigo)).not.toBe(retratoDoRol(relido));
    expect(retratoDoRol(relido)).toBe(retratoDoRol([...relido]));
    expect(retratoDoRol(relido)).not.toBe(retratoDoRol([{ chave: "c2x:1", testemunha: false }, relido[1] as never]));
  });
});

describe("marcasDaD4Sign", () => {
  const quadro = quadroDoEnvioDoC2x([
    pessoa({ email: "a@exemplo.test", linhaId: 10, nome: "Ana Souza" }),
    pessoa({ email: "b@exemplo.test", linhaId: 11, nome: "Bruno Lima" }),
  ]);

  it("pareia pelo e-mail e manda a CHAVE do item com a data em -03:00", () => {
    const r = marcasDaD4Sign(quadro, [
      assinante({ assinadoEm: "2026-09-12T02:30:00Z", assinou: true, email: "b@exemplo.test", nome: "Bruno Lima" }),
      assinante({ email: "a@exemplo.test", nome: "Ana Souza" }),
    ]);
    expect(r.marcas).toEqual([
      { assinadoEm: "2026-09-11T23:30:00.000-03:00", chave: "c2x:11", email: "b@exemplo.test", recusadoEm: null },
    ]);
    expect(r.naoPareados).toBe(0);
    expect(r.rolDiferente).toBe(false);
  });

  it("e-mail vazio no C2X é pareado pelo NOME sem acento e recebe a marca", () => {
    const semEmail = quadroDoEnvioDoC2x([pessoa({ email: null, linhaId: 20, nome: "JOSÉ  DA SILVA" })]);
    const r = marcasDaD4Sign(semEmail, [
      assinante({ assinadoEm: "2026-09-10T10:00:00-03:00", assinou: true, email: "jose@exemplo.test", nome: "Jose da Silva" }),
    ]);
    expect(r.marcas.map((m) => m.chave)).toEqual(["c2x:20"]);
  });

  it("dois itens com o MESMO e-mail e um assinado na D4Sign dão UMA marca, com a chave do item pareado", () => {
    const repetido = quadroDoEnvioDoC2x([
      pessoa({ email: "corretor@exemplo.test", linhaId: 30, nome: "Carlos" }),
      pessoa({ email: "corretor@exemplo.test", linhaId: 31, nome: "Carlos" }),
    ]);
    const r = marcasDaD4Sign(repetido, [
      assinante({ assinadoEm: "2026-09-10T10:00:00-03:00", assinou: true, email: "corretor@exemplo.test", nome: "Carlos" }),
      assinante({ email: "corretor@exemplo.test", nome: "Carlos" }),
    ]);
    expect(r.marcas).toHaveLength(1);
    expect(r.marcas[0]?.chave).toBe("c2x:30");
  });

  it("o mesmo caso com o assinado em SEGUNDO: a marca vai para o item pareado com ele (c2x:31), não para o 1º do e-mail", () => {
    const repetido = quadroDoEnvioDoC2x([
      pessoa({ email: "corretor@exemplo.test", linhaId: 30, nome: "Carlos" }),
      pessoa({ email: "corretor@exemplo.test", linhaId: 31, nome: "Carlos" }),
    ]);
    const r = marcasDaD4Sign(repetido, [
      assinante({ email: "corretor@exemplo.test", nome: "Carlos" }),
      assinante({ assinadoEm: "2026-09-10T10:00:00-03:00", assinou: true, email: "corretor@exemplo.test", nome: "Carlos" }),
    ]);
    expect(r.marcas).toHaveLength(1);
    expect(r.marcas[0]?.chave).toBe("c2x:31");
  });

  it("as chaves de saída das marcas são SÓ chave, email, assinadoEm e recusadoEm (nada do CPF nem do sign_info)", () => {
    const r = marcasDaD4Sign(quadro, [
      assinante({
        assinadoEm: "2026-09-10T10:00:00-03:00",
        assinou: true,
        documento: "12345678901",
        email: "a@exemplo.test",
        nome: "Ana Souza",
      }),
    ]);
    for (const marca of r.marcas) {
      expect(Object.keys(marca).sort()).toEqual(["assinadoEm", "chave", "email", "recusadoEm"]);
    }
    expect(JSON.stringify(r)).not.toMatch(/\d{11}/);
  });

  it("rol diferente (a D4Sign tem alguém que o quadro não tem) é sinalizado", () => {
    const r = marcasDaD4Sign(quadro, [
      assinante({ email: "a@exemplo.test", nome: "Ana Souza" }),
      assinante({ email: "b@exemplo.test", nome: "Bruno Lima" }),
      assinante({ email: "c@exemplo.test", nome: "Carla" }),
    ]);
    expect(r.rolDiferente).toBe(true);
    expect(r.naoPareados).toBe(1);
  });
});

describe("fechamentoDaD4Sign", () => {
  it("é a última assinatura de todos, em -03:00; sem nenhuma, nulo", () => {
    expect(
      fechamentoDaD4Sign([
        assinante({ assinadoEm: "2026-09-10T10:00:00-03:00", assinou: true }),
        assinante({ assinadoEm: "2026-09-12T02:30:00Z", assinou: true }),
        assinante({ assinou: false }),
      ]),
    ).toBe("2026-09-11T23:30:00.000-03:00");
    expect(fechamentoDaD4Sign([assinante({ assinou: false })])).toBeNull();
  });
});
