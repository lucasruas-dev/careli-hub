import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// AS DUAS ROTAS PÚBLICAS DO LINK DO CORRETOR AUTÔNOMO (01/10/2026): o portão do CPF e o cadastro.
//
// O que se trava aqui é a borda aberta ao mundo: sem a pré-sessão nada entra; o CPF do documento tem
// de ser o do portão; os documentos do link são identidade e comprovante (sem certidão); a recusa
// pública não diz de quem é o e-mail; e nenhuma resposta leva id de ficha ou dado de outra pessoa.

const m = vi.hoisted(() => ({
  pdf: vi.fn(),
  registrar: vi.fn(),
  situacao: vi.fn(),
  upload: vi.fn(),
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
  MENSAGEM_DO_PORTAO: { "em-analise": "FRASE EM ANALISE", "ja-autonomo": "FRASE JA AUTONOMO" },
  registrarCadastroDoLink: m.registrar,
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
  uploadApoloDocument: m.upload,
}));
vi.mock("@/modules/apolo/blocks/cadastro/cad-pdf", () => ({ montarCadPdf: m.pdf }));

import { POST as cadastrar } from "./cadastro/route";
import { POST as iniciar } from "./iniciar/route";
import {
  assinarPreSessaoAutonomo,
  assinarPreSessaoImob,
  donoUploadPreAutonomo,
  verificarPreSessaoAutonomo,
} from "@/lib/publico/cad/sessao";

const CPF = "52998224725";
const original = process.env.SESSAO_CAD_SECRET;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SESSAO_CAD_SECRET = "segredo-de-teste";
  m.situacao.mockResolvedValue({ ok: true, situacao: "liberado" });
  m.vitrine.mockResolvedValue([{ id: "35", name: "Vale do Ouro" }]);
  m.registrar.mockResolvedValue({
    autenticacao: "CAD-2026-ABCDEF12",
    entityId: "id-interno-da-ficha",
    fichaExistia: false,
    ok: true,
    savedDocs: ["identificacao", "comprovante_endereco"],
    warnings: ["papel: algo interno"],
  });
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
    const corpo = await resposta.json();
    expect(corpo).toEqual({ mensagem: "FRASE JA AUTONOMO", status: "ja-autonomo" });
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
    cad: null,
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

describe("o cadastro", () => {
  it("sem a pré-sessão não entra, nem com o token de outro link", async () => {
    const semToken = await cadastrar(post("/api/publico/autonomo/cadastro", corpoValido()));
    expect(semToken.status).toBe(401);
    const imob = assinarPreSessaoImob({ cnpj: "12345678000195" });
    if (!imob.ok) throw new Error("não emitiu");
    const comOutro = await cadastrar(
      post("/api/publico/autonomo/cadastro", corpoValido(), { "x-autonomo-pre-sessao": imob.token }),
    );
    expect(comOutro.status).toBe(401);
    expect(m.registrar).not.toHaveBeenCalled();
  });

  it("ANTI-TROCA: o CPF do documento tem de ser o do portão", async () => {
    const resposta = await cadastrar(
      post("/api/publico/autonomo/cadastro", corpoValido(), token("11144477735")),
    );
    expect(resposta.status).toBe(400);
    expect(m.registrar).not.toHaveBeenCalled();
  });

  it("corpo que tenta virar imobiliária ou pessoa jurídica é recusado", async () => {
    for (const forjado of [{ role: "imobiliaria" }, { persona: "pj" }]) {
      const resposta = await cadastrar(
        post("/api/publico/autonomo/cadastro", { ...corpoValido(), ...forjado }, token()),
      );
      expect(resposta.status).toBe(400);
    }
    expect(m.registrar).not.toHaveBeenCalled();
  });

  it("sem o comprovante de endereço não grava; sem a certidão, grava", async () => {
    const semComprovante = corpoValido();
    semComprovante.documentos = semComprovante.documentos.filter(
      (doc) => doc.categoria !== "comprovante_endereco",
    );
    const recusada = await cadastrar(post("/api/publico/autonomo/cadastro", semComprovante, token()));
    expect(recusada.status).toBe(400);
    expect(((await recusada.json()) as { error: string }).error).toContain("comprovante de endereço");

    const aceita = await cadastrar(post("/api/publico/autonomo/cadastro", corpoValido(), token()));
    expect(aceita.status).toBe(201);
  });

  it("arquivo grande só vale se foi o portão DESTE CPF que pediu o upload", async () => {
    const corpo = corpoValido();
    corpo.documentos[0] = {
      categoria: "identificacao",
      fileName: "rg.pdf",
      storagePath: "staging/a-de-outra-pessoa/rg.pdf",
    } as never;
    const resposta = await cadastrar(post("/api/publico/autonomo/cadastro", corpo, token()));
    expect(resposta.status).toBe(400);

    const doDono = corpoValido();
    doDono.documentos[0] = {
      categoria: "identificacao",
      fileName: "rg.pdf",
      storagePath: `staging/${donoUploadPreAutonomo({ cpf: CPF })}/rg.pdf`,
    } as never;
    expect((await cadastrar(post("/api/publico/autonomo/cadastro", doDono, token()))).status).toBe(201);
  });

  it("sem celular não grava: é por ele que a Careli responde", async () => {
    const corpo = corpoValido();
    corpo.perfil.telefone = "";
    const resposta = await cadastrar(post("/api/publico/autonomo/cadastro", corpo, token()));
    expect(resposta.status).toBe(400);
    expect(m.registrar).not.toHaveBeenCalled();
  });

  it("FICHA QUE JÁ EXISTIA: nem o código de autenticação dela nem o PDF voltam para quem preencheu", async () => {
    m.registrar.mockResolvedValue({
      autenticacao: "CAD-2025-DAVITIMA",
      entityId: "ficha-do-comprador",
      fichaExistia: true,
      ok: true,
      savedDocs: [],
      warnings: [],
    });
    const resposta = await cadastrar(
      post("/api/publico/autonomo/cadastro", { ...corpoValido(), cad: { secoes: [{}] } }, token()),
    );
    expect(resposta.status).toBe(201);
    const corpo = await resposta.json();
    expect(corpo).toMatchObject({ autenticacao: "", cadBase64: null, recebido: true });
    expect(JSON.stringify(corpo)).not.toContain("CAD-2025-DAVITIMA");
    expect(m.pdf).not.toHaveBeenCalled();
  });

  it("o interesse é lido contra a vitrine do servidor: id inventado cai e o rótulo é o do servidor", async () => {
    await cadastrar(post("/api/publico/autonomo/cadastro", corpoValido(), token()));
    expect(m.registrar.mock.calls[0]![1].empreendimentosDeInteresse).toEqual([
      { id: "35", label: "Vale do Ouro" },
    ]);
  });

  it("o sucesso não devolve o id da ficha nem os avisos internos", async () => {
    const resposta = await cadastrar(post("/api/publico/autonomo/cadastro", corpoValido(), token()));
    const corpo = await resposta.json();
    expect(corpo).not.toHaveProperty("entityId");
    expect(JSON.stringify(corpo)).not.toContain("id-interno-da-ficha");
    expect(corpo).toMatchObject({ autenticacao: "CAD-2026-ABCDEF12", warnings: [] });
  });

  it("CPF que virou autônomo ou entrou em análise depois do portão é recusado no envio", async () => {
    m.situacao.mockResolvedValue({ ok: true, situacao: "em-analise" });
    const resposta = await cadastrar(post("/api/publico/autonomo/cadastro", corpoValido(), token()));
    expect(resposta.status).toBe(409);
    expect(m.registrar).not.toHaveBeenCalled();
  });

  it("E-MAIL DE OUTRA PESSOA: 409 com o que fazer, sem dizer de quem é", async () => {
    m.registrar.mockResolvedValue({
      ok: false,
      recusa: { error: "Este e-mail já está no cadastro de MARIA SOUZA", motivo: "email-repetido", ok: false },
    });
    const resposta = await cadastrar(post("/api/publico/autonomo/cadastro", corpoValido(), token()));
    expect(resposta.status).toBe(409);
    const texto = JSON.stringify(await resposta.json());
    expect(texto).toContain("e-mail");
    expect(texto).not.toContain("MARIA");
  });

  it("qualquer outra falha de gravação vira a frase genérica", async () => {
    m.registrar.mockResolvedValue({ ok: false, recusa: null });
    const resposta = await cadastrar(post("/api/publico/autonomo/cadastro", corpoValido(), token()));
    expect(resposta.status).toBe(500);
    expect(await resposta.json()).toEqual({ error: "GENERICO" });
  });
});
