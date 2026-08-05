import { describe, expect, it } from "vitest";

import {
  interpretarIdentidadeLembrada,
  mascararDocumento,
} from "./identidade-lembrada";

// Esta memoria libera dado FINANCEIRO de cliente: cada caso abaixo e' um jeito de liberar
// pra quem nao deveria.
const AGORA = new Date("2026-07-26T12:00:00.000Z");

const valido = {
  c2xClientId: "12345",
  displayName: "Leonardo Meneses Faria",
  documentoMascarado: "•••7618",
  validadoEm: "2026-07-20T10:00:00.000Z", // 6 dias atras
};

describe("mascararDocumento", () => {
  it("guarda so' os 4 ultimos digitos", () => {
    expect(mascararDocumento("121.257.476-18")).toBe("•••7618");
  });

  it("recusa fragmento curto demais pra mascarar", () => {
    expect(mascararDocumento("12")).toBeNull();
  });
});

describe("interpretarIdentidadeLembrada", () => {
  it("aceita identidade dentro da validade", () => {
    expect(interpretarIdentidadeLembrada(valido, AGORA)).toEqual(valido);
  });

  it("EXPIRA depois de 30 dias: obriga validar de novo", () => {
    expect(
      interpretarIdentidadeLembrada(
        { ...valido, validadoEm: "2026-06-20T10:00:00.000Z" }, // 36 dias
        AGORA,
      ),
    ).toBeNull();
  });

  it("aceita no limite da validade (30 dias)", () => {
    expect(
      interpretarIdentidadeLembrada(
        { ...valido, validadoEm: "2026-06-27T10:00:00.000Z" }, // 29 dias
        AGORA,
      ),
    ).not.toBeNull();
  });

  it("recusa data no futuro (registro corrompido ou relogio adulterado)", () => {
    expect(
      interpretarIdentidadeLembrada(
        { ...valido, validadoEm: "2026-08-10T10:00:00.000Z" },
        AGORA,
      ),
    ).toBeNull();
  });

  it("recusa sem c2xClientId: sem cadastro nao ha' identidade", () => {
    expect(
      interpretarIdentidadeLembrada({ ...valido, c2xClientId: "" }, AGORA),
    ).toBeNull();
  });

  it("recusa sem data de validacao", () => {
    expect(
      interpretarIdentidadeLembrada({ ...valido, validadoEm: "" }, AGORA),
    ).toBeNull();
  });

  it("recusa data invalida", () => {
    expect(
      interpretarIdentidadeLembrada(
        { ...valido, validadoEm: "ontem" },
        AGORA,
      ),
    ).toBeNull();
  });

  it("recusa lixo (null, string, array)", () => {
    expect(interpretarIdentidadeLembrada(null, AGORA)).toBeNull();
    expect(interpretarIdentidadeLembrada("sim", AGORA)).toBeNull();
    expect(interpretarIdentidadeLembrada([valido], AGORA)).toBeNull();
  });

  it("sobrevive sem nome (nao inventa titular)", () => {
    const semNome = interpretarIdentidadeLembrada(
      { ...valido, displayName: "   " },
      AGORA,
    );

    expect(semNome?.displayName).toBeNull();
    expect(semNome?.c2xClientId).toBe("12345");
  });
});
