import { describe, expect, it } from "vitest";

import { documentosDoApoloParaPortal } from "./documentos-do-portal";

// `documentosDoApoloParaPortal` DE VERDADE, com um cliente do Supabase falso: a lista vem de
// `listApoloDocuments` (a peça canônica), as marcas e os empreendimentos da pessoa vêm das leituras
// de apoio, e o que sai é a lista filtrada. Falha numa leitura de apoio LANÇA: a rota responde
// erro, nunca a lista crua.

type Linha = Record<string, unknown>;

const DOCUMENTOS: Linha[] = [
  {
    created_at: "2026-09-16T12:00:00Z",
    document_type: "identificacao",
    id: "rg",
    label: "Fulano - RG",
    metadata: { fileName: "rg.pdf", uploadedByName: "ana@careli.adm.br" },
    status: "ready",
    storage_path: "entidade/e1/rg.pdf",
  },
  {
    created_at: "2026-09-16T11:00:00Z",
    document_type: "comprovante-credito",
    id: "serasa",
    label: "Comprovante de credito SR-ABC",
    metadata: { consultaId: "c1", protocolo: "SR-ABC" },
    status: "ready",
    storage_path: "entidade/e1/serasa.pdf",
  },
  {
    created_at: "2026-09-16T10:00:00Z",
    document_type: "cad",
    id: "cad",
    label: "CAD",
    metadata: { origem: "automatico" },
    status: "ready",
    storage_path: "entidade/e1/cad.pdf",
  },
];

// O cadastro do Panteon (pai e filhos): o VLO (35) é o pai do VOL (36) e do VOC (37).
const FAMILIAS: Linha[] = [
  { c2x_enterprise_id: "35", id: "vlo", pai_id: null },
  { c2x_enterprise_id: "36", id: "vol", pai_id: "vlo" },
  { c2x_enterprise_id: "37", id: "voc", pai_id: "vlo" },
  { c2x_enterprise_id: "41", id: "vor", pai_id: "vlo" },
  { c2x_enterprise_id: "39", id: "gdn", pai_id: null },
];

function clienteFalso(opts: { esteira: string[]; falharMarcas?: boolean; marcaDoSerasa?: string }) {
  const from = (tabela: string) => {
    let colunas = "";
    const resultado = (): { data: Linha[] | null; error: null | { message: string } } => {
      if (tabela === "apolo_documents" && colunas.includes("enterpriseId:metadata->>enterpriseId")) {
        if (opts.falharMarcas) return { data: null, error: { message: "fora do ar" } };
        return {
          data: DOCUMENTOS.map((d) => ({
            document_type: d.document_type,
            // O comprovante pago pelo portal nasce marcado; o da Careli, não.
            enterpriseId: d.id === "serasa" ? (opts.marcaDoSerasa ?? null) : null,
            id: d.id,
          })),
          error: null,
        };
      }
      if (tabela === "apolo_documents") return { data: DOCUMENTOS, error: null };
      if (tabela === "apolo_esteira") {
        return { data: opts.esteira.map((id) => ({ enterprise_id: id })), error: null };
      }
      if (tabela === "hercules_empreendimentos") return { data: FAMILIAS, error: null };
      return { data: [], error: null };
    };
    const cadeia = {
      eq: () => cadeia,
      limit: () => Promise.resolve(resultado()),
      order: () => cadeia,
      range: () => Promise.resolve(resultado()),
      select: (lista: string) => {
        colunas = lista;
        return cadeia;
      },
    };
    return cadeia;
  };
  return { from } as unknown as Parameters<typeof documentosDoApoloParaPortal>[0];
}

describe("documentosDoApoloParaPortal", () => {
  it("pessoa só no produto do portal: RG e CAD saem, o Serasa não; ninguém da Careli no uploadedBy", async () => {
    const lista = await documentosDoApoloParaPortal(clienteFalso({ esteira: ["37"] }), "e1", {
      imobiliaria: false,
      recorte: new Set(["37", "39"]),
    });
    expect(lista.map((doc) => doc.id)).toEqual(["rg", "cad"]);
    expect(lista.every((doc) => doc.uploadedBy === null)).toBe(true);
  });

  it("pessoa com CAD em outro loteamento: a CAD sem marca some, o RG fica", async () => {
    const lista = await documentosDoApoloParaPortal(clienteFalso({ esteira: ["37", "12"] }), "e1", {
      imobiliaria: false,
      recorte: new Set(["37", "39"]),
    });
    expect(lista.map((doc) => doc.id)).toEqual(["rg"]);
  });

  // (16/09/2026, revisão) As CADs do Vale do Ouro moram no 35 (VLO). O cer (sessão 37) e o CRM do
  // Cecílio perdiam a CAD do próprio comprador, porque o 35 nunca está em `idsDaSessao`.
  it("CAD no espelho do pai (35) aparece para a sessão da divisão (37); o Serasa continua fora", async () => {
    const lista = await documentosDoApoloParaPortal(clienteFalso({ esteira: ["35"] }), "e1", {
      imobiliaria: false,
      recorte: new Set(["37"]),
    });
    expect(lista.map((doc) => doc.id)).toEqual(["rg", "cad"]);
  });

  it("o espelho não abre o irmão: CAD no 36 (VOL) não aparece para a sessão do 37", async () => {
    const lista = await documentosDoApoloParaPortal(clienteFalso({ esteira: ["36"] }), "e1", {
      imobiliaria: false,
      recorte: new Set(["37"]),
    });
    expect(lista.map((doc) => doc.id)).toEqual(["rg"]);
  });

  it("no comercial o comprovante do Serasa volta a aparecer", async () => {
    const lista = await documentosDoApoloParaPortal(clienteFalso({ esteira: ["37"] }), "e1", {
      comercial: true,
      imobiliaria: false,
      recorte: new Set(["37", "39"]),
    });
    expect(lista.map((doc) => doc.id)).toEqual(["rg", "serasa", "cad"]);
  });

  // (16/09/2026, crédito no portal) O Cecílio faz o crédito dos clientes dele: o comprovante das CADs
  // do escopo sai; o da pessoa que também tem CAD em outro loteamento, não.
  it("no portal que opera sozinho o comprovante (marcado, o que ele pagou) sai para quem só tem CAD no escopo", async () => {
    const lista = await documentosDoApoloParaPortal(clienteFalso({ esteira: ["37"], marcaDoSerasa: "37" }), "e1", {
      imobiliaria: false,
      operaSozinho: true,
      recorte: new Set(["37", "39"]),
    });
    expect(lista.map((doc) => doc.id)).toEqual(["rg", "serasa", "cad"]);
    expect(lista.every((doc) => doc.uploadedBy === null)).toBe(true);
  });

  // (16/09/2026, D5) E o RG sem marca também: a ficha de quem já era cliente da Careli é aproveitada
  // pelo portal que opera sozinho, sem devolver o que a Careli guardou para a CAD de outro produto.
  it("no portal que opera sozinho, CAD em outro loteamento esconde o comprovante, a CAD e o RG sem marca", async () => {
    const lista = await documentosDoApoloParaPortal(clienteFalso({ esteira: ["37", "12"] }), "e1", {
      imobiliaria: false,
      operaSozinho: true,
      recorte: new Set(["37", "39"]),
    });
    expect(lista.map((doc) => doc.id)).toEqual([]);
  });

  it("a mesma pessoa de dois produtos no comercial e no portal padrão: o RG continua saindo", async () => {
    for (const contexto of [{ comercial: true }, {}]) {
      const lista = await documentosDoApoloParaPortal(clienteFalso({ esteira: ["37", "12"] }), "e1", {
        ...contexto,
        imobiliaria: false,
        recorte: new Set(["37", "39"]),
      });
      expect(lista.map((doc) => doc.id)).toContain("rg");
    }
  });

  // (16/09/2026, revisão do conjunto) ⚠️ O D5 NÃO ABRE O VALE DO OURO. Cadastrar no Garden o CPF de
  // um comprador do VLO (CAD no 35) punha a pessoa no escopo, e o espelho (35) somado ao recorte
  // {37, 39, 41} liberava tudo o que a Careli guarda dela.
  it("⚠️ portal que opera sozinho: pessoa {35, 39} com sessão {37, 39, 41} não recebe documento sem marca", async () => {
    const lista = await documentosDoApoloParaPortal(clienteFalso({ esteira: ["35", "39"] }), "e1", {
      imobiliaria: false,
      operaSozinho: true,
      recorte: new Set(["37", "39", "41"]),
    });
    expect(lista).toEqual([]);
  });

  it("portal que opera sozinho: com CAD numa divisão do recorte (37), o espelho (35) volta a valer", async () => {
    const lista = await documentosDoApoloParaPortal(clienteFalso({ esteira: ["35", "37"] }), "e1", {
      imobiliaria: false,
      operaSozinho: true,
      recorte: new Set(["37", "39", "41"]),
    });
    // O comprovante sem marca é da Careli e não sai (ver documentos-do-portal.ts, passo 2).
    expect(lista.map((doc) => doc.id)).toEqual(["rg", "cad"]);
  });

  it("D4: o comercial recebe quem anexou (uploadedBy); os outros portais, não", async () => {
    const comercial = await documentosDoApoloParaPortal(clienteFalso({ esteira: ["37"] }), "e1", {
      comercial: true,
      imobiliaria: false,
      recorte: new Set(["37", "39"]),
    });
    expect(comercial.find((doc) => doc.id === "rg")?.uploadedBy).toBe("ana@careli.adm.br");
  });

  it("falha ao ler as marcas: lança, não devolve a lista crua", async () => {
    await expect(
      documentosDoApoloParaPortal(clienteFalso({ esteira: ["37"], falharMarcas: true }), "e1", {
        imobiliaria: false,
        recorte: new Set(["37"]),
      }),
    ).rejects.toThrow("fora do ar");
  });
});
