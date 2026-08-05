import { describe, expect, it } from "vitest";

import { decodeDataUrl, tipoAceitoPeloBucket } from "./attachment-backfill";

// O bucket de anexos tem LISTA BRANCA de tipos e compara o texto inteiro. A migracao dos 47
// anexos legados parou no primeiro arquivo por causa disso, com a mensagem "upload falhou" —
// que nao dizia o motivo. Cada caso abaixo trava um jeito de o arquivo ficar preso no banco.

describe("tipoAceitoPeloBucket", () => {
  // O QUE QUEBROU: a gravacao de tela produz `video/webm;codecs=vp8`. E' webm, mas o sufixo do
  // codec fazia a comparacao exata do bucket falhar. 17 dos 47 anexos parados eram este caso.
  it("tira o sufixo de codec do webm", () => {
    expect(tipoAceitoPeloBucket("video/webm;codecs=vp8")).toBe("video/webm");
    expect(tipoAceitoPeloBucket("video/webm;codecs=vp9,opus")).toBe("video/webm");
    expect(tipoAceitoPeloBucket("audio/webm;codecs=opus")).toBe("audio/webm");
  });

  it("aceita os tipos que o bucket ja libera", () => {
    expect(tipoAceitoPeloBucket("image/png")).toBe("image/png");
    expect(tipoAceitoPeloBucket("image/jpeg")).toBe("image/jpeg");
    expect(tipoAceitoPeloBucket("application/pdf")).toBe("application/pdf");
    expect(tipoAceitoPeloBucket("video/mp4")).toBe("video/mp4");
  });

  // Planilha e CSV nao estao na lista do bucket. Em vez de perder o arquivo, guarda como
  // binario generico — que esta' liberado. Melhor com tipo generico do que preso no banco.
  it("cai para binario generico quando o tipo nao e aceito", () => {
    expect(
      tipoAceitoPeloBucket(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    ).toBe("application/octet-stream");
    expect(tipoAceitoPeloBucket("text/csv")).toBe("application/octet-stream");
    expect(tipoAceitoPeloBucket("application/zip")).toBe("application/octet-stream");
  });

  it("normaliza caixa e espaco", () => {
    expect(tipoAceitoPeloBucket("  IMAGE/PNG  ")).toBe("image/png");
    expect(tipoAceitoPeloBucket("Video/WebM; codecs=vp8")).toBe("video/webm");
  });

  it("sem tipo nenhum nao quebra", () => {
    expect(tipoAceitoPeloBucket(null)).toBe("application/octet-stream");
    expect(tipoAceitoPeloBucket(undefined)).toBe("application/octet-stream");
    expect(tipoAceitoPeloBucket("")).toBe("application/octet-stream");
  });
});

// O MESMO `;codecs=` derrubou o parser do data-URL, e ali o sintoma era pior: a migracao
// dizia "data-URL invalido", como se o arquivo estivesse corrompido. Nao estava — o base64
// inteiro estava no banco, so' nao sabiamos ler o cabecalho.
describe("decodeDataUrl", () => {
  it("le gravacao de tela com parametro de codec no tipo", () => {
    const lido = decodeDataUrl("data:video/webm;codecs=vp8;base64,AAEC");

    expect(lido?.mimeType).toBe("video/webm;codecs=vp8");
    expect(lido?.bytes).toEqual(Buffer.from("AAEC", "base64"));
  });

  it("le tipo simples", () => {
    expect(decodeDataUrl("data:image/png;base64,iVBORw0=")?.mimeType).toBe(
      "image/png",
    );
  });

  it("le tipo com varios parametros", () => {
    expect(
      decodeDataUrl("data:video/webm;codecs=vp9,opus;base64,AAEC")?.mimeType,
    ).toBe("video/webm;codecs=vp9,opus");
  });

  it("recusa o que nao e data-URL de base64", () => {
    expect(decodeDataUrl("https://exemplo.com/a.png")).toBeNull();
    expect(decodeDataUrl("data:image/png,semBase64")).toBeNull();
    expect(decodeDataUrl("")).toBeNull();
    expect(decodeDataUrl("data:image/png;base64,")).toBeNull();
  });
});
