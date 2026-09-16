import { describe, expect, it } from "vitest";

import type { ApoloEntity } from "@/lib/apolo/types";

import { matchesApoloFilters } from "./apolo-derive";

// So o que o filtro le. O resto do tipo nao entra na decisao.
function ficha(parcial: Partial<ApoloEntity>): ApoloEntity {
  return {
    commercialLinks: [],
    contacts: [],
    displayName: "",
    documentMasked: "",
    documents: [],
    locationLabel: "",
    nextAction: "",
    profiles: [],
    relationships: [],
    serviceSignals: [],
    timeline: [],
    ...parcial,
  } as unknown as ApoloEntity;
}

// A ficha do print do Lucas (16/09/2026): servidor achava, lista escondia.
const ELIZABETE = ficha({
  displayName: "ELIZABETE APARECIDA DAS DORES",
  documentMasked: "691.093.206-44",
});

describe("matchesApoloFilters — documento", () => {
  // ⚠️ O BUG DO PRINT: a busca ia ao servidor, o servidor devolvia a ficha (e o painel abria),
  // mas este filtro da TELA procurava "69109320644" dentro de "691.093.206-44" e escondia a
  // linha. Resultado: ficha aberta a direita, "Nenhum relacionamento encontrado" a esquerda.
  it("acha o CPF digitado sem pontuacao", () => {
    expect(matchesApoloFilters(ELIZABETE, "69109320644", "all")).toBe(true);
  });

  it("continua achando o CPF com pontuacao", () => {
    expect(matchesApoloFilters(ELIZABETE, "691.093.206-44", "all")).toBe(true);
  });

  it("acha o CNPJ com e sem pontuacao", () => {
    const empresa = ficha({ displayName: "EMPRESA", documentMasked: "68.172.042/0001-43" });

    expect(matchesApoloFilters(empresa, "68172042000143", "all")).toBe(true);
    expect(matchesApoloFilters(empresa, "68.172.042/0001-43", "all")).toBe(true);
  });

  // Nao pode virar "qualquer numero acha qualquer ficha".
  it("CPF de outra pessoa nao acha esta ficha", () => {
    expect(matchesApoloFilters(ELIZABETE, "04610713632", "all")).toBe(false);
  });

  it("a busca por nome continua igual", () => {
    expect(matchesApoloFilters(ELIZABETE, "elizabete", "all")).toBe(true);
    expect(matchesApoloFilters(ELIZABETE, "fulano", "all")).toBe(false);
  });

  // O filtro de perfil continua mandando: achar o documento nao fura o recorte escolhido.
  it("o filtro de perfil continua valendo sobre o documento", () => {
    expect(matchesApoloFilters(ELIZABETE, "69109320644", "imobiliaria")).toBe(false);
  });
});
