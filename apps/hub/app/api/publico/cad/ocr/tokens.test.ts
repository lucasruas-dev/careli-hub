import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A LEITURA DE DOCUMENTO PÚBLICA COM CADA TOKEN (01/10/2026).
//
// O link do corretor autônomo passou a usar esta rota, e com o token DELE só a leitura da foto vale:
// o portão emite token para qualquer CPF, e a consulta paga (`enrich`, `enrich-company`) devolveria
// dados pessoais de terceiros (segunda rodada de revisão da Publicação). O resto deste arquivo prova o
// contrário para os outros dois links: a CAD do cliente e o auto-cadastro da imobiliária continuam
// podendo exatamente o que podiam.

const m = vi.hoisted(() => ({ empresa: vi.fn(), extrair: vi.fn(), pessoa: vi.fn() }));

vi.mock("@/lib/apolo/mostqi", () => ({
  enrichCompany: m.empresa,
  enrichPerson: m.pessoa,
  extractDocument: m.extrair,
}));
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
import { assinarPreSessaoAutonomo, assinarPreSessaoImob, emitirSessao } from "@/lib/publico/cad/sessao";

const CPF = "52998224725";
const original = process.env.SESSAO_CAD_SECRET;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SESSAO_CAD_SECRET = "segredo-de-teste";
  m.extrair.mockResolvedValue({ fields: {} });
  m.pessoa.mockResolvedValue({ nome: "X" });
  m.empresa.mockResolvedValue({ razao: "Y" });
});

afterEach(() => {
  if (original === undefined) delete process.env.SESSAO_CAD_SECRET;
  else process.env.SESSAO_CAD_SECRET = original;
});

function tokenDe(tipo: "autonomo" | "cad" | "imob"): Record<string, string> {
  if (tipo === "autonomo") {
    const t = assinarPreSessaoAutonomo({ cpf: CPF });
    if (!t.ok) throw new Error("não emitiu");
    return { "x-autonomo-pre-sessao": t.token };
  }
  if (tipo === "imob") {
    const t = assinarPreSessaoImob({ cnpj: "12345678000195" });
    if (!t.ok) throw new Error("não emitiu");
    return { "x-cad-pre-sessao-imob": t.token };
  }
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
  return { "x-cad-sessao": t.token };
}

const chamar = (corpo: unknown, headers: Record<string, string>) =>
  POST(
    new Request("https://c2x.app.br/api/publico/cad/ocr", {
      body: JSON.stringify(corpo),
      headers: { "Content-Type": "application/json", ...headers },
      method: "POST",
    }),
  );

describe("com o token do autônomo", () => {
  it("lê a foto", async () => {
    const resposta = await chamar({ action: "extract", fileBase64: "QUJD" }, tokenDe("autonomo"));
    expect(resposta.status).toBe(200);
    expect(m.extrair).toHaveBeenCalledTimes(1);
  });

  it("NÃO consulta CPF nenhum, nem o do próprio token, nem com query/datasets do corpo", async () => {
    for (const corpo of [
      { action: "enrich", cpf: CPF },
      { action: "enrich", cpf: "11144477735", datasets: ["gold"], query: "CARELI_PF_04" },
    ]) {
      expect((await chamar(corpo, tokenDe("autonomo"))).status).toBe(403);
    }
    expect(m.pessoa).not.toHaveBeenCalled();
  });

  it("NÃO consulta CNPJ", async () => {
    const resposta = await chamar({ action: "enrich-company", cnpj: "12345678000195" }, tokenDe("autonomo"));
    expect(resposta.status).toBe(403);
    expect(m.empresa).not.toHaveBeenCalled();
  });
});

describe("os outros links continuam como estavam", () => {
  it("a CAD do cliente consulta o CPF, com query e datasets, como antes", async () => {
    const resposta = await chamar(
      { action: "enrich", cpf: "11144477735", datasets: ["a"], query: "Q" },
      tokenDe("cad"),
    );
    expect(resposta.status).toBe(200);
    expect(m.pessoa).toHaveBeenCalledWith("11144477735", { datasets: ["a"], query: "Q" });
  });

  it("a imobiliária consulta o CNPJ e o CPF dos sócios, como antes", async () => {
    expect((await chamar({ action: "enrich-company", cnpj: "12345678000195" }, tokenDe("imob"))).status).toBe(200);
    expect((await chamar({ action: "enrich", cpf: "11144477735" }, tokenDe("imob"))).status).toBe(200);
  });

  it("sem token nenhum, nada", async () => {
    expect((await chamar({ action: "extract", fileBase64: "QUJD" }, {})).status).toBe(401);
  });
});
