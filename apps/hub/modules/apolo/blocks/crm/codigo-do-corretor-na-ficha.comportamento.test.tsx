// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ApoloEntity, ApoloProfile } from "@/lib/apolo/types";

// O CÓDIGO DO CORRETOR AUTÔNOMO APARECE NA FICHA DO CRM — E SÓ ALI.
//
// Lucas (27/09/2026), corrigindo a si mesmo na mesma conversa: *"minto, somente no CRM"*. O código
// não entra na reserva, na proposta, no contrato nem no BI. Esta é a ÚNICA tela que o mostra.
//
// ⚠️ E ELE NUNCA APARECE COMO IMOBILIÁRIA: *"NAO QUERO TER A INFORMACAO QUE PODE TER PESSOA FISICA
// COMO IMOBILIARIA, isso sera bem restrito"*. O rótulo do código fala de corretor autônomo.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { codigoDoCorretorDaFicha } = await import("../../data/apolo-derive");
const { RecordHeader } = await import("./record-workspace");

const entidade = (extra: Partial<ApoloEntity>, profiles: ApoloProfile[] = ["corretor"]): ApoloEntity =>
  ({
    addresses: [],
    audit: [],
    commercialLinks: [],
    confidenceScore: 0,
    contacts: [],
    createdAt: "27/09/2026",
    displayName: "JOAO CORRETOR",
    documentMasked: "529.982.247-25",
    documents: [],
    financial: {},
    id: "c34d4b6c-ac71-43ca-b7c2-6a7ec7f69c29",
    kind: "pf",
    locationLabel: "Goiania - GO",
    nextAction: "Revisar dados cadastrais",
    profiles,
    relationships: [],
    serviceSignals: [],
    status: "review",
    timeline: [],
    updatedAt: "27/09/2026",
    ...extra,
  }) as unknown as ApoloEntity;

describe("codigoDoCorretorDaFicha", () => {
  it("mostra o código do autônomo", () => {
    expect(codigoDoCorretorDaFicha(entidade({ codigoCorretor: "CA-0007" }))).toBe("CA-0007");
  });

  it("sem código não mostra nada (os 131 corretores que vieram do C2X não têm)", () => {
    expect(codigoDoCorretorDaFicha(entidade({}))).toBeNull();
    expect(codigoDoCorretorDaFicha(entidade({ codigoCorretor: "   " }))).toBeNull();
  });

  it("quem não tem o papel corretor não mostra código, mesmo se a coluna tiver algo", () => {
    expect(
      codigoDoCorretorDaFicha(entidade({ codigoCorretor: "CA-0007" }, ["prospect"])),
    ).toBeNull();
  });
});

describe("a ficha do CRM", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("imprime o código do corretor autônomo no cabeçalho da ficha", () => {
    act(() => {
      root.render(<RecordHeader entity={entidade({ codigoCorretor: "CA-0007" })} />);
    });

    expect(container.textContent).toContain("CA-0007");
    // O autônomo não é imobiliária em lugar nenhum da ficha.
    expect(container.textContent?.toLowerCase()).not.toContain("imobiliar");
    expect(container.textContent?.toLowerCase()).not.toContain("imobiliár");
  });

  it("ficha sem código não imprime nada a mais", () => {
    act(() => {
      root.render(<RecordHeader entity={entidade({})} />);
    });

    expect(container.textContent).not.toContain("CA-");
  });
});
