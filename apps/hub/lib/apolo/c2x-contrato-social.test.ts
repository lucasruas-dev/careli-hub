import { describe, expect, it } from "vitest";

import { lerContratoSocialParaC2x } from "./c2x-write-server";

// O CONTRATO SOCIAL que sobe junto com o cliente PJ. Regra do Lucas em 05/08: "pode subir o que
// estamos coletando" — o mesmo arquivo que o corretor anexa na etapa Documentos do cadastro.
//
// O que estes testes travam: o anexo NUNCA pode derrubar o cadastro, e a falha dele NUNCA pode
// sumir. Toda recusa volta com `motivo` legível, e quem chama envia a ficha assim mesmo.

type Doc = {
  id: string;
  metadata: { fileName?: string; sizeBytes?: number } | null;
  storage_bucket: string | null;
  storage_path: string | null;
};

// Cliente Supabase de mentira: só o que `lerContratoSocialParaC2x` usa (a consulta encadeada em
// apolo_documents e o download do Storage). `baixados` registra o que foi buscado no bucket, para
// provar que arquivo grande é cortado ANTES de passar pela memória da function.
function clienteFalso(opts: {
  baixados: string[];
  bytes?: Uint8Array | null;
  doc?: Doc | null;
  erroConsulta?: string;
}) {
  const consulta = {
    eq: () => consulta,
    limit: async () =>
      opts.erroConsulta
        ? { data: null, error: { message: opts.erroConsulta } }
        : { data: opts.doc ? [opts.doc] : [], error: null },
    order: () => consulta,
    select: () => consulta,
  };
  return {
    from: () => consulta,
    storage: {
      from: () => ({
        download: async (caminho: string) => {
          opts.baixados.push(caminho);
          if (!opts.bytes) return { data: null, error: { message: "sem arquivo" } };
          return { data: new Blob([opts.bytes as unknown as BlobPart]), error: null };
        },
      }),
    },
  } as unknown as Parameters<typeof lerContratoSocialParaC2x>[0];
}

const DOC_VOVO: Doc = {
  id: "5d96a6b8-8789-497a-9aca-fc9a980ca258",
  metadata: { fileName: "CONTRATO SOCIAL (12).pdf", sizeBytes: 1_859_529 },
  storage_bucket: "apolo-documents",
  storage_path:
    "entidade/227e1603-e6b9-4aa8-a322-ece230d9ccad/f5cbb198-CONTRATO_SOCIAL__12_.pdf",
};

describe("lerContratoSocialParaC2x", () => {
  it("monta o anexo com o nome de parte que o C2X espera", async () => {
    const baixados: string[] = [];
    const r = await lerContratoSocialParaC2x(
      clienteFalso({ baixados, bytes: new Uint8Array([37, 80, 68, 70]), doc: DOC_VOVO }),
      "227e1603-e6b9-4aa8-a322-ece230d9ccad",
    );

    expect(r.motivo).toBeNull();
    expect(r.documentoId).toBe(DOC_VOVO.id);
    expect(r.anexo?.campo).toBe("social_contract"); // = active_storage_attachments.name
    expect(r.anexo?.fileName).toBe("CONTRATO SOCIAL (12).pdf");
    expect(r.anexo?.contentType).toBe("application/pdf");
    expect(r.anexo?.bytes.byteLength).toBe(4);
    expect(baixados).toEqual([DOC_VOVO.storage_path]);
  });

  it("sem documento anexado devolve motivo legível, e não exceção", async () => {
    const r = await lerContratoSocialParaC2x(clienteFalso({ baixados: [], doc: null }), "e1");
    expect(r.anexo).toBeNull();
    expect(r.motivo).toContain("Contrato social");
  });

  // Arquivo grande é cortado pelo tamanho DECLARADO na linha, sem baixar: 20MB de PDF passando
  // pela memória da function só para ser recusado depois é desperdício.
  it("acima do limite não sobe, não baixa, e diz o tamanho", async () => {
    const baixados: string[] = [];
    const r = await lerContratoSocialParaC2x(
      clienteFalso({
        baixados,
        doc: { ...DOC_VOVO, metadata: { fileName: "gigante.pdf", sizeBytes: 25 * 1024 * 1024 } },
      }),
      "e1",
    );
    expect(r.anexo).toBeNull();
    expect(r.motivo).toContain("25.00 MB");
    expect(r.motivo).toContain("20.00 MB");
    expect(baixados).toEqual([]);
  });

  it("arquivo em outro bucket não é lido do lugar errado", async () => {
    const r = await lerContratoSocialParaC2x(
      clienteFalso({ baixados: [], doc: { ...DOC_VOVO, storage_bucket: "outro-bucket" } }),
      "e1",
    );
    expect(r.anexo).toBeNull();
    expect(r.motivo).toContain("outro-bucket");
  });

  it("download que falha vira motivo, não erro solto", async () => {
    const r = await lerContratoSocialParaC2x(
      clienteFalso({ baixados: [], bytes: null, doc: DOC_VOVO }),
      "e1",
    );
    expect(r.anexo).toBeNull();
    expect(r.motivo).toContain("baixar");
  });

  it("falha na consulta ao Apolo também vira motivo", async () => {
    const r = await lerContratoSocialParaC2x(
      clienteFalso({ baixados: [], erroConsulta: "timeout" }),
      "e1",
    );
    expect(r.anexo).toBeNull();
    expect(r.motivo).toContain("timeout");
  });
});
