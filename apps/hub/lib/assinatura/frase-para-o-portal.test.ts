import { describe, expect, it } from "vitest";

import {
  ENVIO_POR_OUTRO_CANAL,
  fraseParaOAtor,
  INDEFERIMENTO_POR_OUTRO_CANAL,
  RECUSA_POR_OUTRO_CANAL,
} from "./frase-para-o-portal";

// A FRASE DA D4SIGN NÃO ATRAVESSA PARA O PORTAL (plano da fonte única, seção 5; revisão da F2).

const DA_D4SIGN =
  "O contrato desta venda está em assinatura na D4Sign, enviado pelo C2X (registro reg-1, documento 3f2a-uuid), e daqui só se cancela envelope da Clicksign.";

describe("fraseParaOAtor", () => {
  it("o hub recebe a frase interna inteira", () => {
    expect(fraseParaOAtor(true, DA_D4SIGN, RECUSA_POR_OUTRO_CANAL)).toBe(DA_D4SIGN);
  });

  it("⚠️ o portal recebe a neutra, sem C2X, D4Sign nem o documento", () => {
    const frase = fraseParaOAtor(false, DA_D4SIGN, RECUSA_POR_OUTRO_CANAL);
    expect(frase).toBe(RECUSA_POR_OUTRO_CANAL);
    expect(frase).not.toMatch(/C2X|D4Sign|Clicksign|espelho|3f2a/i);
  });

  it("frase que não fala da D4Sign passa como está (e o nulo continua nulo)", () => {
    expect(fraseParaOAtor(false, "Trabalho nao encontrado.", RECUSA_POR_OUTRO_CANAL)).toBe("Trabalho nao encontrado.");
    expect(fraseParaOAtor(false, null, INDEFERIMENTO_POR_OUTRO_CANAL)).toBeNull();
  });

  it("as três neutras não carregam vocabulário interno nem travessão", () => {
    for (const neutra of [ENVIO_POR_OUTRO_CANAL, INDEFERIMENTO_POR_OUTRO_CANAL, RECUSA_POR_OUTRO_CANAL]) {
      expect(neutra).not.toMatch(/C2X|D4Sign|Clicksign|espelho|—/i);
    }
  });
});
