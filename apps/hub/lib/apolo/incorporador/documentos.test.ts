import { describe, expect, it } from "vitest";

import type { ApoloCarteiraUnit } from "@/lib/apolo/carteira";
import type { ApoloDocumentItem } from "@/lib/apolo/documentos";

import {
  anexosDoC2x,
  contratosAssinados,
  docsDoApolo,
  type LinhaAnexoC2x,
} from "./documentos";

// A ABA DOCUMENTOS ENTREGA ARQUIVO DE PESSOA PARA UM CLIENTE EXTERNO. Os testes cobrem o
// contrato do payload (allowlist, nada de caminho de storage ou uuid alheio) e a regra dura da
// fonte C2X: metadado SIM, URL NUNCA (o binário vive num S3 sem credencial nossa).

const docApolo = (over: Partial<ApoloDocumentItem>): ApoloDocumentItem => ({
  createdAt: "2026-08-01T10:00:00Z",
  documentType: "rg",
  fileName: "rg-frente.pdf",
  hasFile: true,
  id: "doc-1",
  label: "RG",
  sizeBytes: 1000,
  status: "ready",
  uploadedBy: "Operador",
  ...over,
});

const unidade = (over: Partial<ApoloCarteiraUnit>): ApoloCarteiraUnit => ({
  block: "02",
  client: { entityId: "e1", name: "JOSE" },
  code: "VALQ02L18",
  contractCode: null,
  contractDocumentId: null,
  enterpriseCode: "VAL",
  enterpriseName: "VISTA ALEGRE",
  faturadoAt: "2026-05-10",
  id: "100",
  imobiliaria: null,
  lot: "18",
  maxOverdueDays: 0,
  overdueAmount: 0,
  overdueInstallments: 0,
  paidAmount: 0,
  toReceiveAmount: 0,
  totalContract: 0,
  ...over,
});

describe("docsDoApolo", () => {
  it("mapeia por allowlist: id, nome, tipo, data — nunca o caminho do storage", () => {
    const [doc] = docsDoApolo([docApolo({})]);

    expect(doc).toEqual({
      abrivel: true,
      criadoEm: "2026-08-01T10:00:00Z",
      fonte: "apolo",
      id: "doc-1",
      nome: "RG",
      tipo: "rg",
    });
    expect(Object.keys(doc ?? {}).sort()).toEqual([
      "abrivel",
      "criadoEm",
      "fonte",
      "id",
      "nome",
      "tipo",
    ]);
  });

  it("linha sem arquivo aparece mas não abre (registro órfão, igual ao painel interno)", () => {
    const [doc] = docsDoApolo([docApolo({ hasFile: false })]);

    expect(doc?.abrivel).toBe(false);
  });

  it("sem label usa o nome do arquivo", () => {
    const [doc] = docsDoApolo([docApolo({ label: "" })]);

    expect(doc?.nome).toBe("rg-frente.pdf");
  });
});

describe("contratosAssinados", () => {
  it("um card por uuidDoc, com o código da unidade no nome", () => {
    const contratos = contratosAssinados([
      unidade({ contractDocumentId: "uuid-a", id: "100" }),
    ]);

    expect(contratos).toEqual([
      {
        abrivel: true,
        criadoEm: "2026-05-10",
        fonte: "contrato",
        id: "uuid-a",
        nome: "Contrato assinado · VALQ02L18",
        tipo: "Contrato (D4Sign)",
      },
    ]);
  });

  it("o mesmo uuid em duas linhas de contrato não duplica o card", () => {
    const contratos = contratosAssinados([
      unidade({ contractDocumentId: "uuid-a", id: "100" }),
      unidade({ contractDocumentId: "uuid-a", id: "101" }),
    ]);

    expect(contratos).toHaveLength(1);
  });

  it("unidade sem assinatura no D4Sign não vira card", () => {
    expect(contratosAssinados([unidade({ contractDocumentId: null })])).toEqual([]);
    expect(contratosAssinados([unidade({ contractDocumentId: "  " })])).toEqual([]);
  });
});

describe("anexosDoC2x", () => {
  const linha = (over: Partial<LinhaAnexoC2x>): LinhaAnexoC2x => ({
    blob_id: 42,
    content_type: "application/pdf",
    created_at: "2025-01-04T17:05:08Z",
    dono: "User",
    filename: "comprovante-renda.pdf",
    ...over,
  });

  it("⚠️ anexo do C2X NUNCA é abrível — sem credencial S3, URL inventada é link quebrado", () => {
    const [anexo] = anexosDoC2x([linha({})]);

    expect(anexo?.abrivel).toBe(false);
    expect(anexo?.fonte).toBe("c2x");
    // O payload é só metadado: nada de key, checksum ou URL.
    expect(Object.keys(anexo ?? {}).sort()).toEqual([
      "abrivel",
      "criadoEm",
      "fonte",
      "id",
      "nome",
      "tipo",
    ]);
  });

  it("anexo do cônjuge é rotulado, para o loteador saber de quem é o documento", () => {
    const [anexo] = anexosDoC2x([linha({ dono: "Spouse", filename: "rg-ana.pdf" })]);

    expect(anexo?.nome).toBe("rg-ana.pdf (cônjuge)");
  });

  it("blob sem nome de arquivo não vira card (não há o que mostrar)", () => {
    expect(anexosDoC2x([linha({ filename: "  " })])).toEqual([]);
    expect(anexosDoC2x([linha({ filename: null })])).toEqual([]);
  });
});
