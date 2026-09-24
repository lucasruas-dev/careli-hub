import { beforeEach, describe, expect, it, vi } from "vitest";

// A BANCADA DA PRÉ-VENDA ANEXA A FICHA DA CAD QUE ELA MESMA PLANTOU (revisão de 24/09/2026).
//
// A bancada só conhece o NOME do produto ("Vale do Ouro"). `plantarFichaPrevenda` traduzia esse nome
// para o id por conta própria, mas a ficha anexa (`montarCadDeEntidade`) e o movimento da esteira
// (`aoEnviarPixPrevenda`) saíam sem id, isto é, da CAD MAIS RECENTE da pessoa, que pode ser de outro
// produto e agora imprime "Empreendimento <outro>" no cabeçalho. O que está travado aqui: o nome é
// traduzido UMA vez, e o mesmo id vai para as três pontas.

const estado = vi.hoisted(() => ({
  aoEnviar: vi.fn(async () => ({ etapa: "credenciado", fila: "entrou" })),
  montarCad: vi.fn(async () => ({ nome: "Maria", secoes: [] })),
  plantar: vi.fn(async () => ({ contatos: "gravados", esteira: "criada em pré-venda" })),
  resolverPorNome: vi.fn(async (): Promise<null | string> => "20"),
}));

vi.mock("@/lib/apolo/auth", () => ({
  authorizeApoloWrite: vi.fn(async () => ({ ok: true, userId: "u-1" })),
}));
vi.mock("@/lib/apolo/asaas-prevenda", () => ({
  asaasMyAccount: vi.fn(),
  consultarCobranca: vi.fn(),
  criarClienteAsaas: vi.fn(),
  criarCobrancaPix: vi.fn(),
  obterQrCodePix: vi.fn(),
}));
vi.mock("@/lib/apolo/cad-de-entidade", () => ({ montarCadDeEntidade: estado.montarCad }));
vi.mock("@/lib/apolo/cobranca-prevenda", () => ({ remetentePrevenda: () => "caca@careli.adm.br" }));
vi.mock("@/lib/apolo/documentos", () => ({ APOLO_DOCS_BUCKET: "apolo-docs" }));
vi.mock("@/lib/apolo/emails-prevenda", () => ({
  montarEmailCobranca: () => ({ bodyHtml: "", bodyText: "", subjectLine: "" }),
  montarEmailRecibo: () => ({ bodyHtml: "", bodyText: "", subjectLine: "" }),
}));
vi.mock("@/lib/apolo/limite-credito", () => ({ resolverEnterpriseIdPorNome: estado.resolverPorNome }));
vi.mock("@/lib/apolo/prevenda-fluxo", () => ({
  aoEnviarPixPrevenda: estado.aoEnviar,
  contatosDaFicha: vi.fn(async () => ({ email: null, telefone: "(62) 99999-0001" })),
  plantarFichaPrevenda: estado.plantar,
  registrarDisparoPrevenda: vi.fn(async () => undefined),
}));
vi.mock("@/lib/iris/gmail", () => ({
  getCacaSender: () => "caca@careli.adm.br",
  isGmailConfigured: () => false,
  sendGmailMessage: vi.fn(),
}));
vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: () => ({
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://storage.test/${path}` } }),
        upload: async () => ({ error: null }),
      }),
    },
  }),
}));
vi.mock("@/lib/iris/caca-agent", () => ({
  lookupApoloByDocument: vi.fn(async () => ({ displayName: "MARIA", entityId: "ent-1" })),
}));
vi.mock("@/modules/apolo/blocks/cadastro/cad-pdf", () => ({
  montarCadPdf: vi.fn(async () => new Uint8Array([37, 80, 68, 70])),
}));
vi.mock("@/lib/iris/meta-whatsapp", () => ({
  MetaWhatsAppSendError: class extends Error {},
  createMetaWhatsAppMessageTemplate: vi.fn(),
  getMetaWhatsAppOutboundConfig: () => ({}),
  listMetaWhatsAppMessageTemplates: vi.fn(),
  sendMetaWhatsAppTemplateMessage: vi.fn(async () => ({ messageId: "wamid.1" })),
  uploadMetaWhatsAppTemplateHeaderMedia: vi.fn(),
}));

import { POST } from "./route";

function pedido(corpo: Record<string, unknown>) {
  return new Request("http://hub.test/api/apolo/asaas/bancada", {
    body: JSON.stringify(corpo),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

const DISPARO = {
  acao: "disparar-cobranca",
  cpfCnpj: "529.982.247-25",
  empreendimento: "Recanto do Pará",
  link: "https://asaas.test/i/abc",
  nome: "Maria",
};

beforeEach(() => {
  estado.aoEnviar.mockClear();
  estado.montarCad.mockClear();
  estado.plantar.mockClear();
  estado.resolverPorNome.mockReset();
  estado.resolverPorNome.mockResolvedValue("20");
});

describe("bancada: disparar-cobranca", () => {
  it("o id traduzido do nome vai para a CAD plantada, a ficha anexa e o movimento da esteira", async () => {
    const resposta = await POST(pedido(DISPARO));
    expect(resposta.status).toBe(200);

    expect(estado.resolverPorNome).toHaveBeenCalledTimes(1);
    expect(estado.resolverPorNome).toHaveBeenCalledWith("Recanto do Pará");
    expect(estado.plantar).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ enterpriseId: "20", entityId: "ent-1" }),
    );
    expect(estado.montarCad).toHaveBeenCalledWith(expect.anything(), "ent-1", { enterpriseId: "20" });
    expect(estado.aoEnviar).toHaveBeenCalledWith(
      expect.objectContaining({ enterpriseId: "20", entityId: "ent-1" }),
    );
  });

  it("nome que não traduz: segue sem id (e a CAD omite a linha se a pessoa tiver mais de uma)", async () => {
    estado.resolverPorNome.mockResolvedValue(null);
    await POST(pedido(DISPARO));
    expect(estado.montarCad).toHaveBeenCalledWith(expect.anything(), "ent-1", { enterpriseId: null });
  });
});
