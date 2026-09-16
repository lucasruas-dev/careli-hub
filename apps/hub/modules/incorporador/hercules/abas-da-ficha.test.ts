import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { abasDaFicha, destinoDoResumo } from "./abas-da-ficha";

// A RÉGUA DE ABAS DA FICHA DO PRODUTO, POR MODO.
//
// ⚠️ O COMERCIAL NÃO PODE MUDAR. A Gurgel está no ar com cinco abas e "Cadastro" é o board de CADs
// para ela; o modo incorporador (o portal da Cecílio) ganhou a sua régua sem tocar nessa.

describe("abasDaFicha", () => {
  it("⚠️ comercial: as cinco de sempre, na mesma ordem", () => {
    expect(abasDaFicha("comercial").map((a) => a.id)).toEqual([
      "resumo",
      "cadastro",
      "imobiliarias",
      "unidades",
      "links",
    ]);
  });

  it("incorporador: a ordem do pedido do Lucas (16/09/2026)", () => {
    expect(abasDaFicha("incorporador").map((a) => a.rotulo)).toEqual([
      "Resumo",
      "Cadastro",
      "Board",
      "Imobiliárias",
      "Unidades",
      "Relacionamentos",
      "Políticas comerciais",
      "Links",
      "Arquivos",
    ]);
  });

  it("incorporador: sem Mapa, Vendas, Carteira e Setup, nem com Minutas ligada", () => {
    for (const opcoes of [{}, { minutas: true }]) {
      const ids: string[] = abasDaFicha("incorporador", opcoes).map((a) => a.id);
      for (const fora of ["mapa", "vendas", "carteira", "setup"]) {
        expect(ids).not.toContain(fora);
      }
    }
  });

  // (16/09/2026) MINUTAS SÓ NO PRODUTO QUE O PORTAL OPERA. A Cecílio edita os modelos do Garden e do
  // que nasce no portal; no VOC e no VOR (da Careli) a aba não aparece.
  it("⚠️ incorporador com minutas: a aba aparece depois de Políticas comerciais", () => {
    expect(abasDaFicha("incorporador", { minutas: true }).map((a) => a.id)).toEqual([
      "resumo",
      "cadastro",
      "board",
      "imobiliarias",
      "unidades",
      "relacionamentos",
      "politica",
      "minutas",
      "links",
      "arquivos",
    ]);
    const minutas = abasDaFicha("incorporador", { minutas: true }).find((a) => a.id === "minutas");
    expect(minutas?.rotulo).toBe("Minutas");
  });

  it("⚠️ incorporador sem minutas (produto só consulta, ou sem a opção): a aba não aparece", () => {
    expect(abasDaFicha("incorporador", { minutas: false }).map((a) => a.id)).not.toContain("minutas");
    expect(abasDaFicha("incorporador").map((a) => a.id)).not.toContain("minutas");
  });

  it("⚠️ comercial nunca tem Minutas, nem pedindo", () => {
    expect(abasDaFicha("comercial", { minutas: true }).map((a) => a.id)).toEqual([
      "resumo",
      "cadastro",
      "imobiliarias",
      "unidades",
      "links",
    ]);
  });

  // (16/09/2026, revisão) A RÉPLICA DA TELA EMPREENDIMENTO, COM AS EXCLUSÕES ESCRITAS. Uma aba nova
  // no Apolo que não entre no portal tem que aparecer aqui como decisão, e não sumir calada (foi o
  // que aconteceu com Etapas na primeira versão).
  it("incorporador: toda aba do Apolo está na régua, menos as exclusões decididas", () => {
    const view = readFileSync(
      join(__dirname, "../../apolo/blocks/empreendimentos/empreendimentos-view.tsx"),
      "utf8",
    );
    const bloco = view.slice(view.indexOf("const detailTabs = ["), view.indexOf("] as const;"));
    const doApolo = [...bloco.matchAll(/id: "([a-z]+)"/g)].map((m) => m[1] ?? "");
    expect(doApolo.length).toBeGreaterThan(5);

    // Minutas saiu das exclusões em 16/09/2026: está na régua, ligada no produto que o portal opera.
    const EXCLUIDAS = ["carteira", "filhos", "mapa", "setup", "vendas"];
    const doPortal: string[] = abasDaFicha("incorporador", { minutas: true }).map((a) => a.id);
    expect(doApolo.filter((id) => !EXCLUIDAS.includes(id) && !doPortal.includes(id))).toEqual([]);
  });

  it("nenhuma aba repetida em nenhum modo", () => {
    for (const modo of ["comercial", "incorporador"] as const) {
      for (const minutas of [false, true]) {
        const ids = abasDaFicha(modo, { minutas }).map((a) => a.id);
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
  });
});

describe("destinoDoResumo", () => {
  it("⚠️ no incorporador o atalho das CADs leva ao Board, não aos dados do empreendimento", () => {
    expect(destinoDoResumo("incorporador", "cadastro")).toBe("board");
  });

  it("no comercial nada muda", () => {
    expect(destinoDoResumo("comercial", "cadastro")).toBe("cadastro");
    expect(destinoDoResumo("comercial", "imobiliarias")).toBe("imobiliarias");
    expect(destinoDoResumo("comercial", "unidades")).toBe("unidades");
  });

  it("imobiliárias e unidades seguem iguais no incorporador", () => {
    expect(destinoDoResumo("incorporador", "imobiliarias")).toBe("imobiliarias");
    expect(destinoDoResumo("incorporador", "unidades")).toBe("unidades");
  });
});
