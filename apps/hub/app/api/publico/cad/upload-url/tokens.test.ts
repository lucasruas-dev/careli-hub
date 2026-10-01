import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A PERMISSÃO DE UPLOAD DIRETO COM CADA TOKEN (01/10/2026): o link do autônomo ganhou o dono dele, e a
// CAD do cliente e a imobiliária continuam com o dono que sempre tiveram (é ele que o /salvar de cada um
// confere).

const m = vi.hoisted(() => ({ criar: vi.fn() }));

vi.mock("@/lib/apolo/documentos", () => ({ criarUrlDeUploadApoloDocument: m.criar }));
vi.mock("@/lib/publico/cad/rotas", () => ({
  erro: (mensagem = "GENERICO", status = 400) => Response.json({ error: mensagem }, { status }),
  json: (body: unknown, status = 200) => Response.json(body, { status }),
  lerCorpo: async (request: Request) => request.json().catch(() => null),
  prepararRota: async () => ({ adminClient: {}, inicio: 0, ok: true }),
  recusar: async (_request: Request, response: Response) => response,
  responder: async (_request: Request, _inicio: number, response: Response) => response,
}));
vi.mock("@/lib/publico/cad/log-erros", () => ({ anotarContexto: () => undefined }));

import { POST } from "./route";
import {
  assinarPreSessaoAutonomo,
  assinarPreSessaoImob,
  donoUploadPreAutonomo,
  emitirSessao,
} from "@/lib/publico/cad/sessao";

const original = process.env.SESSAO_CAD_SECRET;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SESSAO_CAD_SECRET = "segredo-de-teste";
  m.criar.mockResolvedValue({ bucket: "b", path: "p", token: "t" });
});

afterEach(() => {
  if (original === undefined) delete process.env.SESSAO_CAD_SECRET;
  else process.env.SESSAO_CAD_SECRET = original;
});

const chamar = (headers: Record<string, string>) =>
  POST(
    new Request("https://c2x.app.br/api/publico/cad/upload-url", {
      body: JSON.stringify({ fileName: "rg.pdf" }),
      headers: { "Content-Type": "application/json", ...headers },
      method: "POST",
    }),
  );

describe("o dono do upload por token", () => {
  it("CAD do cliente: o dono da sessão, como antes", async () => {
    const t = emitirSessao({
      corretorEmail: "ana@imob.com.br",
      corretorEntityId: "corretor-1",
      corretorNome: "Ana",
      enterpriseIds: ["10"],
      imobiliariaEntityId: "imob-1",
      imobiliariaNome: "Imob",
      sessaoId: "s-1",
    });
    if (!t.ok) throw new Error("não emitiu");
    await chamar({ "x-cad-sessao": t.token });
    expect(m.criar.mock.calls[0]![0]).toMatchObject({ dono: "s-s-1" });
  });

  it("imobiliária: o dono do CNPJ, como antes", async () => {
    const t = assinarPreSessaoImob({ cnpj: "12345678000195" });
    if (!t.ok) throw new Error("não emitiu");
    await chamar({ "x-cad-pre-sessao-imob": t.token });
    expect(m.criar.mock.calls[0]![0]).toMatchObject({ dono: "c-12345678000195" });
  });

  it("autônomo: o dono resumido do CPF", async () => {
    const t = assinarPreSessaoAutonomo({ cpf: "52998224725" });
    if (!t.ok) throw new Error("não emitiu");
    await chamar({ "x-autonomo-pre-sessao": t.token });
    expect(m.criar.mock.calls[0]![0]).toMatchObject({ dono: donoUploadPreAutonomo({ cpf: "52998224725" }) });
  });

  it("sem token, 401 e nenhuma permissão assinada", async () => {
    expect((await chamar({})).status).toBe(401);
    expect(m.criar).not.toHaveBeenCalled();
  });
});
