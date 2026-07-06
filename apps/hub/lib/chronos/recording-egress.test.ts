import { describe, expect, it } from "vitest";

import { resolveRecordingContentType } from "./recording-egress";

describe("resolveRecordingContentType", () => {
  it("regressão 2-6/jul: octet-stream do Whereby NUNCA passa (bucket recusa)", () => {
    expect(
      resolveRecordingContentType({
        fileName: null,
        headerContentType: "application/octet-stream",
        mimeType: null,
      }),
    ).toBe("video/mp4");
    expect(
      resolveRecordingContentType({
        fileName: "gravacao",
        headerContentType: "application/octet-stream",
        mimeType: "application/octet-stream",
      }),
    ).toBe("video/mp4");
  });

  it("extensão do arquivo manda (mp4/webm/m4a)", () => {
    expect(
      resolveRecordingContentType({
        fileName: "reuniao-2026.MP4",
        headerContentType: "application/octet-stream",
        mimeType: null,
      }),
    ).toBe("video/mp4");
    expect(
      resolveRecordingContentType({
        fileName: "sala.webm",
        headerContentType: null,
        mimeType: null,
      }),
    ).toBe("video/webm");
    expect(
      resolveRecordingContentType({
        fileName: "audio.m4a",
        headerContentType: null,
        mimeType: null,
      }),
    ).toBe("audio/mp4");
  });

  it("mime confiável de vídeo/áudio é respeitado quando não há extensão", () => {
    expect(
      resolveRecordingContentType({
        fileName: "sem-extensao",
        headerContentType: "video/quicktime",
        mimeType: null,
      }),
    ).toBe("video/quicktime");
  });
});
