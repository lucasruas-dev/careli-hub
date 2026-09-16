import { describe, expect, it } from "vitest";

import {
  atorDoHub,
  type AtorDoHub,
  type AtorDoPortal,
  enterpriseNoAlcance,
  idDoAutor,
  nomeDoAutor,
  operadoPorDoAtor,
  origemDoAtor,
  trabalhoNoAlcance,
} from "./ator";

// O ALCANCE DE QUEM OPERA A TÊMIS — a regra que separa a Careli da Cecílio no mesmo banco.
//
// ⚠️ OS IDS SÃO OS DE VERDADE (medidos no catálogo): VOC 37 é da Cecílio, VOL 36 é do Lino; LBF 33,
// LBR 27 e LBP 32 são as três glebas do Lagoa Bonita. É a assimetria entre dono do conjunto e dono de
// uma divisão que os testes abaixo prendem.

const CECILIO = "0f6d2c1e-3b4a-4c5d-8e9f-a1b2c3d4e5f6";
const OUTRO_INCORPORADOR = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

const hub: AtorDoHub = { nome: "Jurídico", papel: "leader", tipo: "hub", userId: "user-hub" };

function portal(enterpriseIds: string[]): AtorDoPortal {
  return {
    enterpriseIds,
    incorporadorId: CECILIO,
    nome: "  Maria da Cecílio  ",
    slug: "cecilio-rocha",
    tipo: "portal",
    usuarioId: "user-portal",
  };
}

describe("enterpriseNoAlcance", () => {
  it("o hub alcança qualquer empreendimento", () => {
    expect(enterpriseNoAlcance(hub, "36")).toBe(true);
    expect(enterpriseNoAlcance(hub, "group:Lagoa Bonita")).toBe(true);
  });

  it("o portal alcança só o que está na lista expandida", () => {
    const ator = portal(["37"]);
    expect(enterpriseNoAlcance(ator, "37")).toBe(true);
    // A gleba do Lino, no mesmo pai: fora.
    expect(enterpriseNoAlcance(ator, "36")).toBe(false);
  });

  it("aceita o id numérico do C2X e ignora espaço em volta", () => {
    const ator = portal(["37"]);
    expect(enterpriseNoAlcance(ator, 37)).toBe(true);
    expect(enterpriseNoAlcance(ator, " 37 ")).toBe(true);
  });

  it("dono do GRUPO alcança o grupo e cada divisão (a lista já vem expandida por idsDaSessao)", () => {
    const ator = portal(["group:Lagoa Bonita", "33", "27", "32"]);
    expect(enterpriseNoAlcance(ator, "group:Lagoa Bonita")).toBe(true);
    expect(enterpriseNoAlcance(ator, "33")).toBe(true);
    expect(enterpriseNoAlcance(ator, "27")).toBe(true);
    expect(enterpriseNoAlcance(ator, "32")).toBe(true);
  });

  it("dono de UMA divisão NÃO alcança o grupo nem as outras divisões", () => {
    // ⚠️ SE ESTA LINHA FALHAR, a gleba do Fernando passou a abrir e editar a minuta do consolidado,
    // que vale para as glebas do Raposo e do Paulo.
    const ator = portal(["33"]);
    expect(enterpriseNoAlcance(ator, "group:Lagoa Bonita")).toBe(false);
    expect(enterpriseNoAlcance(ator, "27")).toBe(false);
  });

  it("id vazio, nulo ou torto nunca está no alcance do portal", () => {
    const ator = portal(["37"]);
    expect(enterpriseNoAlcance(ator, "")).toBe(false);
    expect(enterpriseNoAlcance(ator, "   ")).toBe(false);
    expect(enterpriseNoAlcance(ator, null)).toBe(false);
    expect(enterpriseNoAlcance(ator, undefined)).toBe(false);
    expect(enterpriseNoAlcance(ator, { id: "37" })).toBe(false);
    expect(enterpriseNoAlcance(ator, Number.NaN)).toBe(false);
  });

  it("portal sem empreendimento nenhum não alcança nada", () => {
    expect(enterpriseNoAlcance(portal([]), "37")).toBe(false);
  });
});

describe("trabalhoNoAlcance", () => {
  it("o hub alcança qualquer trabalho, inclusive o que a Cecílio confecciona", () => {
    expect(trabalhoNoAlcance(hub, { enterprise_id: "37", operado_por: null })).toBe(true);
    expect(trabalhoNoAlcance(hub, { enterprise_id: "37", operado_por: CECILIO })).toBe(true);
  });

  it("o portal alcança o trabalho que é DELE e está no escopo", () => {
    expect(trabalhoNoAlcance(portal(["37"]), { enterprise_id: "37", operado_por: CECILIO })).toBe(
      true,
    );
  });

  it("a venda da Gurgel no produto da Cecílio (operado_por nulo) fica com a Careli", () => {
    expect(trabalhoNoAlcance(portal(["37"]), { enterprise_id: "37", operado_por: null })).toBe(
      false,
    );
    expect(trabalhoNoAlcance(portal(["37"]), { enterprise_id: "37", operado_por: "" })).toBe(false);
  });

  it("trabalho de outro incorporador não entra, mesmo no mesmo empreendimento", () => {
    expect(
      trabalhoNoAlcance(portal(["37"]), { enterprise_id: "37", operado_por: OUTRO_INCORPORADOR }),
    ).toBe(false);
  });

  it("trabalho DELE fora do escopo da conta não entra", () => {
    // Conta com recorte menor que o do portal: o dono bate e o empreendimento não.
    expect(trabalhoNoAlcance(portal(["37"]), { enterprise_id: "40", operado_por: CECILIO })).toBe(
      false,
    );
  });

  it("compara o uuid sem diferenciar maiúsculas", () => {
    expect(
      trabalhoNoAlcance(portal(["37"]), { enterprise_id: "37", operado_por: CECILIO.toUpperCase() }),
    ).toBe(true);
  });
});

describe("autor e origem", () => {
  it("nomeDoAutor apara e devolve nulo quando não há nome, sem inventar autor", () => {
    expect(nomeDoAutor(portal(["37"]))).toBe("Maria da Cecílio");
    expect(nomeDoAutor({ ...hub, nome: "   " })).toBeNull();
  });

  it("origemDoAtor diz a porta", () => {
    expect(origemDoAtor(hub)).toBe("hub");
    expect(origemDoAtor(portal(["37"]))).toBe("portal");
  });

  it("idDoAutor usa o usuário de cada porta", () => {
    expect(idDoAutor(hub)).toBe("user-hub");
    expect(idDoAutor(portal(["37"]))).toBe("user-portal");
  });

  it("operadoPorDoAtor: nulo para a Careli, o incorporador para o portal", () => {
    expect(operadoPorDoAtor(hub)).toBeNull();
    expect(operadoPorDoAtor(portal(["37"]))).toBe(CECILIO);
  });
});

describe("atorDoHub (a única forma de montar o ator do hub)", () => {
  it("usa o usuário e o nome que o portão devolveu, com o papel do portão usado", () => {
    expect(atorDoHub({ nome: "Jurídico", userId: "u1" }, "coordenacao")).toEqual({
      nome: "Jurídico",
      papel: "coordenacao",
      tipo: "hub",
      userId: "u1",
    });
  });

  it("nome ausente vira texto vazio, e o autor gravado é nulo (nunca a palavra null)", () => {
    const semNome = atorDoHub({ nome: null, userId: "u1" }, "leitura");
    expect(semNome.nome).toBe("");
    expect(nomeDoAutor(semNome)).toBeNull();
    expect(atorDoHub({ userId: "u2" }, "leitura").nome).toBe("");
  });

  // ⚠️ PRAZO PRÓPRIO (revisão do conjunto, 16/09/2026): o `import()` do serviço dos trabalhos carrega
  // a Têmis inteira e, com a suíte completa rodando em paralelo, passava dos 5 s padrão do vitest. O
  // teste não mede tempo: só confere que a reexportação é a mesma função.
  it("é a mesma função reexportada pelo serviço dos trabalhos", async () => {
    const servico = await import("./trabalho-servico");
    expect(servico.atorDoHub).toBe(atorDoHub);
  }, 60_000);
});
