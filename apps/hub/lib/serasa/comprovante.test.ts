import { beforeEach, describe, expect, it, vi } from "vitest";

// A MARCA DE EMPREENDIMENTO DO COMPROVANTE (16/09/2026).
//
// O comprovante pago pelo portal que opera sozinho (Cecílio) nasce com `metadata.enterpriseId`, a CAD
// da análise, e é essa marca que decide para qual portal ele sai (documentos-do-portal.ts). Duas
// travas aqui: quem chama passa a marca na MESMA gravação (`metadataExtra`), e regerar (o "Baixar
// comprovante" do hub apaga o anterior da mesma consulta) herda a marca do anterior.

const m = vi.hoisted(() => ({
  upload: vi.fn(async () => ({ id: "doc-novo", ok: true }) as { error?: string; id?: string; ok: boolean }),
}));

vi.mock("@/lib/apolo/documentos", () => ({ uploadApoloDocument: m.upload }));
vi.mock("@/lib/apolo/esteira-cad", () => ({ lerCadDaEsteira: async () => ({ empreendimento: "Garden" }) }));
vi.mock("@/lib/apolo/limite-credito", () => ({ resolverLimiteCredito: async () => 1000 }));
vi.mock("@/lib/serasa/comprovante-pdf", () => ({ montarComprovantePdf: async () => new Uint8Array([1, 2, 3]) }));
vi.mock("@/lib/serasa/comprovante-token", () => ({
  emitirTokenComprovante: () => ({ ok: false }),
  verificarTokenComprovante: () => ({ ok: false }),
}));

import { gerarESalvarComprovante, metadataDoComprovante } from "./comprovante";

type Linha = Record<string, unknown>;

const CONSULTA = {
  ambiente: "producao",
  created_at: "2026-09-16T12:00:00.000Z",
  documento: "52998224725",
  entity_id: "11111111-2222-4333-8444-555555555555",
  finalidade: "analise-credito-cad",
  id: "abcdef12-0000-4000-8000-000000000000",
  report_name: "RELATORIO_BASICO_PF_PME",
  resposta: {},
  solicitado_por: null,
  status: "sucesso",
  tipo_pessoa: "pf",
};

function clienteFalso(anteriores: Linha[]) {
  const apagados: unknown[] = [];
  const client = {
    from(tabela: string) {
      const cadeia: Record<string, unknown> = {};
      Object.assign(cadeia, {
        contains: () => Promise.resolve({ data: anteriores, error: null }),
        delete: () => ({
          eq: (_coluna: string, valor: unknown) => {
            apagados.push(valor);
            return Promise.resolve({ error: null });
          },
        }),
        eq: () => cadeia,
        maybeSingle: () =>
          Promise.resolve({
            data: tabela === "serasa_consultas" ? CONSULTA : { display_name: "Cliente", legal_name: null },
            error: null,
          }),
        select: () => cadeia,
      });
      return cadeia;
    },
    storage: { from: () => ({ remove: async () => ({ error: null }) }) },
  } as unknown as Parameters<typeof gerarESalvarComprovante>[0];
  return { apagados, client };
}

const metadataDoUpload = () =>
  ((m.upload.mock.calls[0] as unknown as [{ metadataExtra: Linha }] | undefined)?.[0]?.metadataExtra);

beforeEach(() => {
  m.upload.mockClear();
});

describe("metadataDoComprovante", () => {
  const base = { consultaId: "c1", protocolo: "SR-1" };

  it("sem extra e sem anterior: só as chaves da idempotência, como sempre", () => {
    expect(metadataDoComprovante({ ...base, anteriores: [] })).toEqual({ consultaId: "c1", protocolo: "SR-1" });
  });

  it("a marca pedida por quem chama vale, mesmo com um anterior marcado diferente", () => {
    expect(
      metadataDoComprovante({
        ...base,
        anteriores: [{ metadata: { enterpriseId: "37" } }],
        extra: { enterpriseId: "39" },
      }),
    ).toEqual({ consultaId: "c1", enterpriseId: "39", protocolo: "SR-1" });
  });

  it("sem marca pedida: herda a do anterior da mesma consulta", () => {
    expect(
      metadataDoComprovante({
        ...base,
        anteriores: [{ metadata: { consultaId: "c1" } }, { metadata: { enterpriseId: "39" } }],
      }),
    ).toEqual({ consultaId: "c1", enterpriseId: "39", protocolo: "SR-1" });
  });

  it("o extra não desliga a idempotência (consultaId e protocolo são sempre os da consulta)", () => {
    expect(
      metadataDoComprovante({ ...base, anteriores: [], extra: { consultaId: "outra", protocolo: "X" } }),
    ).toEqual({ consultaId: "c1", protocolo: "SR-1" });
  });

  it("marca vazia do anterior não conta", () => {
    expect(
      metadataDoComprovante({ ...base, anteriores: [{ metadata: { enterpriseId: "  " } }] }),
    ).toEqual({ consultaId: "c1", protocolo: "SR-1" });
  });
});

describe("gerarESalvarComprovante", () => {
  it("o portal passa a marca e ela vai na mesma gravação do upload", async () => {
    const { client } = clienteFalso([]);
    const r = await gerarESalvarComprovante(client, CONSULTA.id, {
      metadataExtra: { enterpriseId: "39" },
      uploadedByName: "Análise de crédito",
    });
    expect(r).toEqual({ documentId: "doc-novo", ok: true });
    expect(metadataDoUpload()).toEqual({
      consultaId: CONSULTA.id,
      enterpriseId: "39",
      protocolo: "SR-ABCDEF12",
    });
  });

  it("regerar pelo hub (sem marca) apaga o anterior e herda a marca dele", async () => {
    const { apagados, client } = clienteFalso([
      {
        id: "doc-velho",
        metadata: { consultaId: CONSULTA.id, enterpriseId: "39" },
        storage_bucket: null,
        storage_path: "x/y.pdf",
      },
    ]);
    await gerarESalvarComprovante(client, CONSULTA.id, { uploadedByName: "Analise de credito" });
    expect(apagados).toEqual(["doc-velho"]);
    expect(metadataDoUpload()).toEqual({
      consultaId: CONSULTA.id,
      enterpriseId: "39",
      protocolo: "SR-ABCDEF12",
    });
  });

  it("regerar comprovante que nunca teve marca continua sem marca (o hub não inventa dono)", async () => {
    const { client } = clienteFalso([
      { id: "doc-velho", metadata: { consultaId: CONSULTA.id }, storage_bucket: null, storage_path: null },
    ]);
    await gerarESalvarComprovante(client, CONSULTA.id);
    expect(metadataDoUpload()).toEqual({ consultaId: CONSULTA.id, protocolo: "SR-ABCDEF12" });
  });
});
