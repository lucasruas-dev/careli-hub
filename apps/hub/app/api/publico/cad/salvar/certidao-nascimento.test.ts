import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A CERTIDÃO DE NASCIMENTO NO LINK PÚBLICO DA CAD (02/10/2026).
//
// A terceira porta de envio. O empreendimento sai do TOKEN assinado, nunca do corpo, e é dele que
// a chave "Certidão de nascimento" é lida. A regra de documentos é a de verdade
// (lib/apolo/cadastro-obrigatorios.ts); o persist é o dublê: chegar nele é "passou da trava".

const m = vi.hoisted(() => ({
  certidao: vi.fn(async (_client: unknown, _id: unknown) => false),
  criar: vi.fn(),
  renda: vi.fn(async () => false),
}));

vi.mock("@/lib/apolo/cadastro-persist", () => ({ createApoloEntity: m.criar }));
vi.mock("@/lib/apolo/enterprise-settings", () => ({
  exigeCertidaoNascimento: m.certidao,
  exigeComprovanteRenda: m.renda,
}));
vi.mock("@/lib/apolo/cadastro-upload", () => ({
  agruparEUploadDocumentos: vi.fn(),
  documentoTemArquivo: (doc: { fileBase64?: string; storagePath?: string } | null) =>
    Boolean(doc?.fileBase64?.trim() || doc?.storagePath?.trim()),
}));
vi.mock("@/lib/apolo/documentos", () => ({
  APOLO_DOC_MAX_BYTES: 50 * 1024 * 1024,
  MENSAGEM_DOCUMENTO_GRANDE: "Documento grande demais.",
  caminhoUploadDiretoValido: () => true,
  uploadApoloDocument: vi.fn(),
}));
vi.mock("@/lib/apolo/empreendimento-de-mercado", () => ({
  nomeDeMercadoDoEmpreendimento: vi.fn(async () => "Vale do Ouro"),
}));
vi.mock("@/lib/publico/cad/dados", () => ({
  gravarVinculoEsteira: vi.fn(),
  nomeDoEmpreendimento: vi.fn(async () => "Vale do Ouro"),
  registrarOrigemPublica: vi.fn(),
}));
vi.mock("@/modules/apolo/blocks/cadastro/cad-pdf", () => ({ montarCadPdf: vi.fn() }));
vi.mock("@/lib/publico/cad/rotas", () => ({
  erro: (mensagem = "GENERICO", status = 400) => Response.json({ error: mensagem }, { status }),
  json: (body: unknown, status = 200) => Response.json(body, { status }),
  lerCorpo: async (request: Request) => request.json().catch(() => null),
  prepararRota: async () => ({ adminClient: { marca: "admin" }, inicio: 0, ok: true }),
  recusar: async (_request: Request, response: Response) => response,
  responder: async (_request: Request, _inicio: number, response: Response) => response,
}));
vi.mock("@/lib/publico/cad/log-erros", () => ({ anotarContexto: () => undefined }));

import { emitirSessao } from "@/lib/publico/cad/sessao";

import { POST } from "./route";

const original = process.env.SESSAO_CAD_SECRET;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SESSAO_CAD_SECRET = "segredo-de-teste";
  m.certidao.mockResolvedValue(false);
  m.renda.mockResolvedValue(false);
  // Chegar no persist é "passou da trava"; ele recusa logo em seguida para o teste parar aqui.
  m.criar.mockResolvedValue({ error: "parou depois da trava", ok: false });
});

afterEach(() => {
  if (original === undefined) delete process.env.SESSAO_CAD_SECRET;
  else process.env.SESSAO_CAD_SECRET = original;
});

const arquivo = (categoria: string) => ({
  categoria,
  fileBase64: "QkFTRTY0",
  fileName: `${categoria}.pdf`,
  mimeType: "application/pdf",
});

function token(): string {
  const t = emitirSessao({
    corretorEmail: "ana@imob.com.br",
    corretorEntityId: "corretor-1",
    corretorNome: "Ana",
    enterpriseId: "37",
    enterpriseIds: ["37"],
    imobiliariaEntityId: "imob-1",
    imobiliariaNome: "Imob",
    sessaoId: "s-1",
  });
  if (!t.ok) throw new Error("não emitiu");
  return t.token;
}

const enviar = (corpo: Record<string, unknown>) =>
  POST(
    new Request("https://c2x.app.br/api/publico/cad/salvar", {
      body: JSON.stringify({
        documentos: [arquivo("identificacao"), arquivo("comprovante_endereco")],
        identidade: { cpf: "52998224725", naturalidade: "Goiânia / GO", nome: "MARIA" },
        perfil: { estadoCivilId: "1" },
        persona: "pf",
        role: "prospect",
        ...corpo,
      }),
      headers: { "Content-Type": "application/json", "x-cad-sessao": token() },
      method: "POST",
    }),
  );

describe("certidão de nascimento no link público da CAD", () => {
  it("chave LIGADA e solteiro sem a certidão: 400 e a ficha não nasce", async () => {
    m.certidao.mockResolvedValue(true);
    const resposta = await enviar({});
    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({
      error: "Anexe a certidão de nascimento para enviar o cadastro.",
    });
    expect(m.criar).not.toHaveBeenCalled();
    // O empreendimento é o do TOKEN.
    expect(m.certidao).toHaveBeenCalledWith({ marca: "admin" }, "37");
  });

  it("chave LIGADA e solteiro com a certidão: passa da trava", async () => {
    m.certidao.mockResolvedValue(true);
    await enviar({
      documentos: [
        arquivo("identificacao"),
        arquivo("comprovante_endereco"),
        arquivo("certidao_nascimento"),
      ],
    });
    expect(m.criar).toHaveBeenCalledTimes(1);
  });

  it("chave DESLIGADA: solteiro sem a certidão passa, como hoje", async () => {
    await enviar({});
    expect(m.criar).toHaveBeenCalledTimes(1);
  });

  it("a chave NÃO vem do corpo, nem o empreendimento", async () => {
    m.certidao.mockResolvedValue(true);
    const resposta = await enviar({
      certidaoNascimentoHabilitada: false,
      enterpriseId: "99",
      exigeCertidaoNascimento: false,
      vinculo: { enterpriseId: "99" },
    });
    expect(resposta.status).toBe(400);
    expect(m.criar).not.toHaveBeenCalled();
    expect(m.certidao).toHaveBeenCalledWith({ marca: "admin" }, "37");
  });
});
