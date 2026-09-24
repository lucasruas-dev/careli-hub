import { beforeEach, describe, expect, it, vi } from "vitest";

// A FICHA QUE VAI ANEXA À COBRANÇA DA PRÉ-VENDA É A DA CAD COBRADA (revisão de 24/09/2026).
//
// Desde a 0080 a mesma pessoa pode ter CAD em mais de um empreendimento. `montarFichaCad` chamava
// `montarCadDeEntidade` sem o id, que monta a CAD MAIS RECENTE: a cobrança do 20 de quem também tem
// CAD no 38 anexava a ficha do 38, agora com "Empreendimento Villa Paris" impresso no cabeçalho. O
// que está travado aqui:
//   • a cobrança passa o id da CAD dela até `montarCadDeEntidade`;
//   • o PDF é gravado num caminho POR CAD (a Meta baixa depois do envio: outra ficha da mesma pessoa
//     no mesmo caminho seria o anexo que o cliente recebe);
//   • quem não sabe a CAD (a CACÁ) segue chamando sem id, no caminho de sempre.

const estado = vi.hoisted(() => ({
  montarCad: vi.fn(async () => ({ nome: "Maria", secoes: [] })),
  uploads: [] as string[],
}));

vi.mock("@/lib/apolo/cad-de-entidade", () => ({ montarCadDeEntidade: estado.montarCad }));
vi.mock("@/modules/apolo/blocks/cadastro/cad-pdf", () => ({
  montarCadPdf: vi.fn(async () => new Uint8Array([37, 80, 68, 70])),
}));
vi.mock("@/lib/apolo/documentos", () => ({ APOLO_DOCS_BUCKET: "apolo-docs" }));
vi.mock("@/lib/apolo/asaas-prevenda", () => ({
  criarClienteAsaas: vi.fn(),
  criarCobrancaPix: vi.fn(),
}));
vi.mock("@/lib/apolo/disparo-imobiliaria", () => ({
  avisarImobPixEnviado: vi.fn(async () => undefined),
  statusEnvioAoCliente: vi.fn(() => ({})),
}));
vi.mock("@/lib/apolo/prevenda-fluxo", () => ({
  aoEnviarPixPrevenda: vi.fn(async () => ({ etapa: "credenciado", fila: "entrou" })),
  contatosDaFicha: vi.fn(async () => ({ email: null, telefone: "(62) 99999-0001" })),
  registrarDisparoPrevenda: vi.fn(async () => undefined),
}));
vi.mock("@/lib/iris/gmail", () => ({
  getCacaSender: () => "Cacá <caca@careli.adm.br>",
  isGmailConfigured: () => false,
  sendGmailMessage: vi.fn(),
}));
vi.mock("@/lib/iris/meta-whatsapp", () => ({
  MetaWhatsAppSendError: class extends Error {},
  getMetaWhatsAppOutboundConfig: () => ({}),
  sendMetaWhatsAppTemplateMessage: vi.fn(async () => ({ messageId: "wamid.1" })),
}));

import { enviarCobrancaPrevenda, montarFichaCad } from "./cobranca-prevenda";

function adminFalso() {
  return {
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => ({
          data: { signedUrl: `https://storage.test/${path}` },
          error: null,
        }),
        upload: async (path: string) => {
          estado.uploads.push(path);
          return { error: null };
        },
      }),
    },
  } as never;
}

beforeEach(() => {
  estado.montarCad.mockClear();
  estado.uploads.length = 0;
});

describe("montarFichaCad: de qual CAD é a ficha", () => {
  it("com o id: monta a CAD daquele empreendimento e grava num caminho próprio dela", async () => {
    const admin = adminFalso();
    const ficha = await montarFichaCad(admin, "ent-1", "Maria", { enterpriseId: 20 });

    expect(estado.montarCad).toHaveBeenCalledWith(admin, "ent-1", { enterpriseId: "20" });
    expect(estado.uploads).toEqual(["cobranca-prevenda/ent-1-20.pdf"]);
    expect(ficha?.link).toBe("https://storage.test/cobranca-prevenda/ent-1-20.pdf");
  });

  it("id de produto consolidado vira caminho seguro (sem ':' nem espaço)", async () => {
    await montarFichaCad(adminFalso(), "ent-1", "Maria", { enterpriseId: "group:Lagoa Bonita" });
    expect(estado.uploads).toEqual(["cobranca-prevenda/ent-1-group_Lagoa_Bonita.pdf"]);
  });

  it("sem o id (a CACÁ, que atende por CPF): a mais recente, no caminho de sempre", async () => {
    const admin = adminFalso();
    await montarFichaCad(admin, "ent-1", "Maria");

    expect(estado.montarCad).toHaveBeenCalledWith(admin, "ent-1", { enterpriseId: null });
    expect(estado.uploads).toEqual(["cobranca-prevenda/ent-1.pdf"]);
  });
});

describe("enviarCobrancaPrevenda", () => {
  it("anexa a ficha DA CAD cobrada: o id do empreendimento chega a montarCadDeEntidade", async () => {
    const admin = adminFalso();
    const envio = await enviarCobrancaPrevenda({
      admin,
      empreendimento: "Recanto do Pará",
      enterpriseId: "20",
      entityId: "ent-1",
      link: "https://asaas.test/i/abc",
      nome: "Maria",
      valorFmt: "1.000,00",
    });

    expect(estado.montarCad).toHaveBeenCalledTimes(1);
    expect(estado.montarCad).toHaveBeenCalledWith(admin, "ent-1", { enterpriseId: "20" });
    expect(estado.uploads).toEqual(["cobranca-prevenda/ent-1-20.pdf"]);
    expect(envio.anexouCad).toBe(true);
    expect(envio.whatsapp).toBe("enviado");
  });
});
