import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApoloCarteiraUnit } from "@/lib/apolo/carteira";
import type { ApoloDocumentItem } from "@/lib/apolo/documentos";

// (16/09/2026) As leituras de banco que `montarDocumentos` e `abrirDocumento` fazem são trocadas por
// falsas só para o bloco "o portal que opera sozinho" lá embaixo. As funções puras dos outros blocos
// não passam por nenhuma delas.
const m = vi.hoisted(() => ({
  filtrados: vi.fn(async () => [] as unknown[]),
  pessoa: vi.fn(),
}));

vi.mock("./documentos-do-portal", () => ({ documentosDoApoloParaPortal: m.filtrados }));
vi.mock("./pessoa-no-escopo", () => ({ pessoaNoEscopo: m.pessoa }));
vi.mock("./ficha-cadastro", () => ({ lerC2xUserId: async () => null }));
vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: () => ({
    from: () => {
      throw new Error("sem banco no teste");
    },
  }),
}));
vi.mock("@/lib/apolo/incorporador/escopo", () => ({ codigosDaSessao: async () => [] }));

import type { SessaoIncorporador } from "./sessao";

import { codigoDaVenda } from "@/lib/hercules/codigo-da-venda";
import {
  abrirDocumento,
  docsDaVenda,
  anexosDoC2x,
  contratosAssinados,
  docsDoApolo,
  type LinhaAnexoC2x,
  montarDocumentos,
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

describe("docsDaVenda", () => {
  it("⚠️ o COD entra no nome: no Apolo o eixo é a PESSOA, não a venda", () => {
    // A mesma pessoa pode ter documento de duas vendas. Sem o protocolo escrito, dois "RG.pdf" na
    // ficha ficam indistinguíveis — e o agrupamento por protocolo, que a aba do Hércules garante,
    // não existe nesta tela.
    const lista = docsDaVenda(
      [
        {
          criado_em: "2026-09-06T12:00:00Z",
          id: "d1",
          nome: "RG.pdf",
          protocolo_numero: 6,
          tipo: "documento",
        },
      ],
      codigoDaVenda,
    );

    expect(lista[0]?.nome).toBe("000006 · RG.pdf");
    expect(lista[0]?.fonte).toBe("venda");
    expect(lista[0]?.abrivel).toBe(true);
  });

  it("sem protocolo, o nome sai limpo — e o documento não some", () => {
    const lista = docsDaVenda(
      [
        {
          criado_em: "2026-09-06T12:00:00Z",
          id: "d2",
          nome: "Comprovante.pdf",
          protocolo_numero: null,
          tipo: "documento",
        },
      ],
      codigoDaVenda,
    );
    expect(lista[0]?.nome).toBe("Comprovante.pdf");
  });

  it("lista vazia não vira nada", () => {
    expect(docsDaVenda([], codigoDaVenda)).toEqual([]);
  });
});

// (16/09/2026, crédito no portal) O CRM DO PORTAL QUE OPERA SOZINHO. O board do Cecílio já passava
// `operaSozinho` e mostrava o comprovante do Serasa das CADs do escopo; o CRM do mesmo portal não
// passava e escondia. A lista e a abertura dizem a mesma coisa, pela mesma régua do board
// (`portalConfeccionaContrato`), senão o comprovante apareceria na lista e responderia 404 ao abrir.
describe("o CRM passa operaSozinho nas duas portas (lista e abertura)", () => {
  const sessao = (perfil: Pick<SessaoIncorporador, "slug" | "tipo">) =>
    ({
      enterpriseIds: ["39"],
      incorporadorId: `inc-${perfil.slug}`,
      usuarioId: "u1",
      usuarioNome: "Maria",
      ...perfil,
    }) as unknown as SessaoIncorporador;

  const contextoDaChamada = () =>
    (m.filtrados.mock.calls[0] as unknown as [unknown, string, Record<string, unknown>])[2];

  beforeEach(() => {
    // Os documentos da venda leem o banco falso e caem no log de falha: esperado aqui.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    m.filtrados.mockClear();
    m.pessoa.mockReset();
    m.pessoa.mockResolvedValue({
      enterpriseIds: ["39"],
      entityId: "e1",
      ok: true,
      unidadesDaPessoa: [],
    });
  });

  it.each([
    [{ slug: "cecilio-rocha", tipo: "incorporador" }, { comercial: false, operaSozinho: true }],
    [{ slug: "gurgel", tipo: "comercial" }, { comercial: true, operaSozinho: false }],
    [{ slug: "cer", tipo: "incorporador" }, { comercial: false, operaSozinho: false }],
  ] as const)("lista de %o: %o", async (perfil, esperado) => {
    const r = await montarDocumentos({ id: "e1", sessao: sessao(perfil), tipo: "prospect" });
    expect(r.ok).toBe(true);
    expect(contextoDaChamada()).toEqual({ ...esperado, imobiliaria: false, recorte: new Set(["39"]) });
  });

  it.each([
    [{ slug: "cecilio-rocha", tipo: "incorporador" }, true],
    [{ slug: "gurgel", tipo: "comercial" }, false],
    [{ slug: "cer", tipo: "incorporador" }, false],
  ] as const)("abertura de %o: operaSozinho %s, e o id fora da lista filtrada é 404", async (perfil, operaSozinho) => {
    const r = await abrirDocumento({
      doc: "doc-1",
      fonte: "apolo",
      id: "e1",
      sessao: sessao(perfil),
      tipo: "prospect",
    });
    expect(r).toEqual({ ok: false, status: 404 });
    expect(contextoDaChamada()).toMatchObject({ imobiliaria: false, operaSozinho });
  });
});
