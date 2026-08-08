import { describe, expect, it } from "vitest";

import { alertaC2xDaCad } from "./c2x-alerta-board";

// Os casos vieram da produção (05/08): 465 CADs em "credenciado", 97 sem NENHUMA linha em
// apolo_c2x_sync. Dessas 97, só 7 são de verdade (nasceram no Apolo e não subiram); as outras 90
// vieram do sync do C2X, ou seja já existem lá. O teste cobra exatamente essa separação, porque
// acender o aviso nas 90 destruiria a confiança no selo.
const base = {
  etapa: "credenciado",
  falhaSync: null,
  listaSyncCompleta: true,
  metadata: { c2xSynced: false, source: "apolo" },
  temLinhaSync: false,
};

describe("alertaC2xDaCad", () => {
  it("acende 'nunca_enviado' na CAD credenciada que nasceu no Apolo e não tem linha de sync", () => {
    // É o caso das 6 PJ + 1 PF (ex.: VOVO BRAGA PADARIA E MERCEARIA LTDA).
    expect(alertaC2xDaCad(base)).toBe("nunca_enviado");
  });

  it("não acende para quem ainda não é credenciado", () => {
    expect(alertaC2xDaCad({ ...base, etapa: "prevenda" })).toBeNull();
    expect(alertaC2xDaCad({ ...base, etapa: null })).toBeNull();
  });

  it("não acende para ficha que veio do sync do C2X (sem source 'apolo')", () => {
    // As 90 que já existem no legado: sem metadata.source e sem cadastro.
    expect(alertaC2xDaCad({ ...base, metadata: {} })).toBeNull();
    expect(alertaC2xDaCad({ ...base, metadata: null })).toBeNull();
    expect(alertaC2xDaCad({ ...base, metadata: { source: "asana" } })).toBeNull();
  });

  it("não acende para quem JÁ está no C2X", () => {
    expect(
      alertaC2xDaCad({ ...base, metadata: { c2xSynced: true, source: "apolo" } }),
    ).toBeNull();
    expect(
      alertaC2xDaCad({ ...base, metadata: { c2xUserId: 4321, source: "apolo" } }),
    ).toBeNull();
  });

  it("não acende para quem já tem linha na fila do C2X (pendente, resolvido, duplicado)", () => {
    expect(alertaC2xDaCad({ ...base, temLinhaSync: true })).toBeNull();
  });

  it("cala o 'nunca_enviado' quando a leitura da fila veio truncada", () => {
    // Fail-safe: sem a lista inteira não dá para afirmar que ninguém tentou. Melhor silêncio do
    // que acusar quem está certo.
    expect(alertaC2xDaCad({ ...base, listaSyncCompleta: false })).toBeNull();
  });

  it("mantém os avisos de falha, que valem mesmo fora de 'credenciado'", () => {
    expect(alertaC2xDaCad({ ...base, etapa: "prevenda", falhaSync: "erro" })).toBe("erro");
    expect(
      alertaC2xDaCad({
        ...base,
        falhaSync: "sem_confirmacao",
        listaSyncCompleta: false,
        temLinhaSync: true,
      }),
    ).toBe("sem_confirmacao");
  });

  it("a falha ganha do 'nunca_enviado': é o aviso que carrega o motivo", () => {
    expect(alertaC2xDaCad({ ...base, falhaSync: "erro" })).toBe("erro");
  });
});
