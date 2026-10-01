import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// AS DUAS ROTAS PÚBLICAS DO LINK DO CORRETOR AUTÔNOMO (01/10/2026): o portão do CPF e o envio.
//
// O que se trava aqui é a borda aberta ao mundo: sem a pré-sessão nada entra; o CPF do documento tem
// de ser o do portão; os documentos do link são identidade e comprovante (sem certidão); o celular é
// obrigatório; e o ENVIO NÃO REVELA NADA DA BASE: CPF que virou autônomo ou entrou em análise recebe
// a mesma resposta de quem foi aceito, e nenhuma resposta leva id, código ou PDF.

const m = vi.hoisted(() => ({
  guardar: vi.fn(),
  registrar: vi.fn(),
  situacao: vi.fn(),
  vitrine: vi.fn(),
}));

vi.mock("@/lib/publico/cad/rotas", () => ({
  erro: (mensagem = "GENERICO", status = 400) => Response.json({ error: mensagem }, { status }),
  json: (body: unknown, status = 200) => Response.json(body, { status }),
  lerCorpo: async (request: Request) => {
    try {
      return await request.json();
    } catch {
      return null;
    }
  },
  prepararRota: async () => ({ adminClient: {}, inicio: 0, ok: true }),
  recusar: async (_request: Request, response: Response) => response,
  responder: async (_request: Request, _inicio: number, response: Response) => response,
}));
vi.mock("@/lib/publico/cad/log-erros", () => ({ anotarContexto: () => undefined }));
vi.mock("@/lib/apolo/autonomo-do-link", () => ({
  // A mesma régua de lib/apolo/autonomo-do-link.ts (testada lá, com o caso do `/D/g`).
  celularValido: (valor: unknown) => String(valor ?? "").replace(/\D/g, "").length >= 10,
  guardarDocumentosDoPedido: m.guardar,
  MENSAGEM_DO_PORTAO: { "em-analise": "FRASE EM ANALISE", "ja-autonomo": "FRASE JA AUTONOMO" },
  propostaDoLink: (corpo: Record<string, unknown>) => ({
    endereco: corpo.endereco ?? {},
    identidade: corpo.identidade ?? {},
    perfil: corpo.perfil ?? {},
  }),
  registrarPedidoDoLink: m.registrar,
  situacaoDoCpf: m.situacao,
}));
vi.mock("@/lib/apolo/credenciamento", () => ({ listEmpreendimentosParaImobiliaria: m.vitrine }));
vi.mock("@/lib/apolo/documentos", () => ({
  APOLO_DOC_MAX_BYTES: 20 * 1024 * 1024,
  caminhoUploadDiretoValido: (caminho: string, dono: string) => caminho.includes(`/${dono}/`),
  // A mesma regra de lib/apolo/documentos.ts (base64 OU caminho de upload direto).
  documentoTemArquivo: (doc: { fileBase64?: string; storagePath?: string } | null) =>
    Boolean(doc?.fileBase64?.trim() || doc?.storagePath?.trim()),
  MENSAGEM_DOCUMENTO_GRANDE: "GRANDE",
}));

import { POST as enviar } from "./cadastro/route";
import { POST as iniciar } from "./iniciar/route";
import {
  assinarPreSessaoAutonomo,
  assinarPreSessaoImob,
  donoUploadPreAutonomo,
  verificarPreSessaoAutonomo,
} from "@/lib/publico/cad/sessao";

const CPF = "52998224725";
const RECEBIDO = { autenticacao: "", cadBase64: null, recebido: true, savedDocs: [], warnings: [] };
const original = process.env.SESSAO_CAD_SECRET;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SESSAO_CAD_SECRET = "segredo-de-teste";
  m.situacao.mockResolvedValue({ ok: true, situacao: "liberado" });
  m.vitrine.mockResolvedValue([{ id: "35", name: "Vale do Ouro" }]);
  m.guardar.mockImplementation(async (_client: unknown, input: { documentos: unknown[] }) => ({
    documentos: input.documentos,
    ok: true,
  }));
  m.registrar.mockResolvedValue({ ok: true, pedidoId: "pedido-interno" });
});

afterEach(() => {
  if (original === undefined) delete process.env.SESSAO_CAD_SECRET;
  else process.env.SESSAO_CAD_SECRET = original;
});

const post = (url: string, corpo: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://c2x.app.br${url}`, {
    body: JSON.stringify(corpo),
    headers: { "Content-Type": "application/json", ...headers },
    method: "POST",
  });

describe("o portão do CPF", () => {
  it("CPF inválido para antes de qualquer consulta", async () => {
    const resposta = await iniciar(post("/api/publico/autonomo/iniciar", { cpf: "111.111.111-11" }));
    expect(resposta.status).toBe(400);
    expect(m.situacao).not.toHaveBeenCalled();
  });

  it("CPF livre recebe a pré-sessão amarrada a ele", async () => {
    const resposta = await iniciar(post("/api/publico/autonomo/iniciar", { cpf: "529.982.247-25" }));
    const corpo = (await resposta.json()) as { preSessao: string; status: string };
    expect(corpo.status).toBe("ok");
    expect(verificarPreSessaoAutonomo(corpo.preSessao)).toEqual({ ok: true, pre: { cpf: CPF } });
  });

  it("CPF JÁ CADASTRADO devolve só a frase fixa: sem nome, sem id, sem token", async () => {
    m.situacao.mockResolvedValue({ ok: true, situacao: "ja-autonomo" });
    const resposta = await iniciar(post("/api/publico/autonomo/iniciar", { cpf: CPF }));
    expect(await resposta.json()).toEqual({ mensagem: "FRASE JA AUTONOMO", status: "ja-autonomo" });
  });

  it("leitura que falha é indisponibilidade, e não liberação", async () => {
    m.situacao.mockResolvedValue({ ok: false });
    const resposta = await iniciar(post("/api/publico/autonomo/iniciar", { cpf: CPF }));
    expect(resposta.status).toBe(503);
    expect(await resposta.json()).not.toHaveProperty("preSessao");
  });
});

function corpoValido() {
  return {
    documentos: [
      { categoria: "identificacao", fileBase64: "QUJD", fileName: "rg.jpg" },
      { categoria: "comprovante_endereco", fileBase64: "QUJD", fileName: "luz.jpg" },
    ],
    empreendimentosDeInteresse: ["35", "999-inventado"],
    identidade: { cpf: CPF, naturalidade: "Belo Horizonte - MG", nome: "JOANA DA SILVA" },
    // Casada: no link NÃO se pede certidão nem documento do cônjuge (Lucas, 01/10/2026).
    perfil: { email: "joana@email.com", estadoCivilId: "2", telefone: "+55 31 99999-0000" },
  };
}

function token(cpf = CPF) {
  const emitido = assinarPreSessaoAutonomo({ cpf });
  if (!emitido.ok) throw new Error("não emitiu");
  return { "x-autonomo-pre-sessao": emitido.token };
}

const enviarCorpo = (corpo: unknown, cabecalhos = token()) =>
  enviar(post("/api/publico/autonomo/cadastro", corpo, cabecalhos));

describe("o envio", () => {
  it("sem a pré-sessão não entra, nem com o token de outro link", async () => {
    expect((await enviar(post("/api/publico/autonomo/cadastro", corpoValido()))).status).toBe(401);
    const imob = assinarPreSessaoImob({ cnpj: "12345678000195" });
    if (!imob.ok) throw new Error("não emitiu");
    expect((await enviarCorpo(corpoValido(), { "x-autonomo-pre-sessao": imob.token })).status).toBe(401);
    expect(m.registrar).not.toHaveBeenCalled();
  });

  it("ANTI-TROCA: o CPF do documento tem de ser o do portão", async () => {
    expect((await enviarCorpo(corpoValido(), token("11144477735"))).status).toBe(400);
    expect(m.registrar).not.toHaveBeenCalled();
  });

  it("corpo que tenta virar imobiliária ou pessoa jurídica é recusado", async () => {
    for (const forjado of [{ role: "imobiliaria" }, { persona: "pj" }]) {
      expect((await enviarCorpo({ ...corpoValido(), ...forjado })).status).toBe(400);
    }
    expect(m.registrar).not.toHaveBeenCalled();
  });

  it("sem o comprovante de endereço não grava; sem a certidão, grava", async () => {
    const semComprovante = corpoValido();
    semComprovante.documentos = semComprovante.documentos.filter(
      (doc) => doc.categoria !== "comprovante_endereco",
    );
    const recusada = await enviarCorpo(semComprovante);
    expect(recusada.status).toBe(400);
    expect(((await recusada.json()) as { error: string }).error).toContain("comprovante de endereço");
    expect((await enviarCorpo(corpoValido())).status).toBe(201);
  });

  it("celular curto não passa (o caso que o `/D/g` deixava passar)", async () => {
    for (const telefone of ["", "31 9999-000", "DDDDDDDDDDDD"]) {
      const corpo = corpoValido();
      corpo.perfil.telefone = telefone;
      expect((await enviarCorpo(corpo)).status).toBe(400);
    }
    expect(m.registrar).not.toHaveBeenCalled();
  });

  it("arquivo grande só vale se foi o portão DESTE CPF que pediu o upload", async () => {
    const alheio = corpoValido();
    alheio.documentos[0] = {
      categoria: "identificacao",
      fileName: "rg.pdf",
      storagePath: "entidade/_pendente/a-de-outra-pessoa/rg.pdf",
    } as never;
    expect((await enviarCorpo(alheio)).status).toBe(400);

    const doDono = corpoValido();
    doDono.documentos[0] = {
      categoria: "identificacao",
      fileName: "rg.pdf",
      storagePath: `entidade/_pendente/${donoUploadPreAutonomo({ cpf: CPF })}/rg.pdf`,
    } as never;
    expect((await enviarCorpo(doDono)).status).toBe(201);
    expect(m.guardar.mock.calls[0]![1]).toMatchObject({ dono: donoUploadPreAutonomo({ cpf: CPF }) });
  });

  it("o interesse é lido contra a vitrine do servidor: id inventado cai e o rótulo é o do servidor", async () => {
    await enviarCorpo(corpoValido());
    expect(m.registrar.mock.calls[0]![1].empreendimentosDeInteresse).toEqual([
      { id: "35", label: "Vale do Ouro" },
    ]);
  });

  it("o sucesso é sempre o mesmo corpo: sem id, sem código, sem PDF", async () => {
    const resposta = await enviarCorpo(corpoValido());
    expect(resposta.status).toBe(201);
    const corpo = await resposta.json();
    expect(corpo).toEqual(RECEBIDO);
    expect(JSON.stringify(corpo)).not.toContain("pedido-interno");
  });

  it("O ENVIO NÃO REVELA: CPF que virou autônomo ou entrou em análise recebe a MESMA resposta, sem gravar", async () => {
    for (const situacao of ["ja-autonomo", "em-analise"]) {
      m.situacao.mockResolvedValue({ ok: true, situacao });
      const resposta = await enviarCorpo(corpoValido());
      expect(resposta.status).toBe(201);
      expect(await resposta.json()).toEqual(RECEBIDO);
    }
    expect(m.registrar).not.toHaveBeenCalled();
    expect(m.guardar).not.toHaveBeenCalled();
  });

  it("o teto geral por hora vira 429 com frase genérica", async () => {
    m.registrar.mockResolvedValue({ motivo: "teto", ok: false });
    const resposta = await enviarCorpo(corpoValido());
    expect(resposta.status).toBe(429);
    expect(JSON.stringify(await resposta.json())).not.toMatch(/\d/);
  });

  it("qualquer outra falha de gravação vira a frase genérica", async () => {
    m.registrar.mockResolvedValue({ motivo: "falha", ok: false });
    const resposta = await enviarCorpo(corpoValido());
    expect(resposta.status).toBe(500);
    expect(await resposta.json()).toEqual({ error: "GENERICO" });
  });
});
