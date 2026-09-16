import { beforeEach, describe, expect, it, vi } from "vitest";

// CLIENTE NOVO PELO CRM DO PORTAL — as regras de quem vem de fora da Careli.
//
// O que está travado aqui (decisões do Lucas, 16/09/2026):
//   • o produto é obrigatório e tem de ser DA SESSÃO (fora dela: 404, sem ler nada);
//   • a imobiliária é OBRIGATÓRIA (400 sem ela) e tem de estar HABILITADA no produto (senão 422);
//   • a recusa de duplicidade NÃO revela o outro empreendimento nem o id da outra ficha;
//   • quem já tem ficha na Careli ganha a CAD na MESMA ficha (`fichaExistente: "acrescentar"`), sem
//     409 e sem a checagem do CPF dizer que a pessoa existe; CAD no mesmo produto continua 409;
//   • o 201 devolve só `{ aviso, entityId, naEsteira, warnings }`, sem mensagem do banco nos avisos;
//   • só o produto que o portal OPERA: a lista do "Novo cliente" filtra por `operado_por` e a régua
//     de escrita recusa VOC/VOR antes de qualquer gravação;
//   • a MOST pedida pelo portal fica registrada com o ator (usuário e slug), cabe num teto por usuário
//     e só enriquece o documento que a MESMA conta acabou de ler.
// (Revisão da onda 3, 16/09/2026: imobiliária obrigatória, ficha existente, avisos, teto e leitura.)
//
// A gravação compartilhada (`salvarCadastroDoApolo`), a conferência do CPF, as imobiliárias e a MOST
// são mockadas: o teste é da REGRA do portal, não do banco.

const estado = vi.hoisted(() => ({
  cadastro: vi.fn(),
  conferirCpf: vi.fn(),
  enrichCompany: vi.fn(),
  enrichPerson: vi.fn(),
  escrita: vi.fn(),
  exigeRenda: vi.fn(),
  extract: vi.fn(),
  imobiliarias: vi.fn(),
  lerCadastro: vi.fn(),
  mostConfigurada: true,
  salvar: vi.fn(),
  teto: vi.fn(),
}));

vi.mock("@/lib/hercules/cadastro", async (original) => ({
  ...(await original<typeof import("@/lib/hercules/cadastro")>()),
  carregarCadastroDeEmpreendimentos: estado.cadastro,
  lerCadastroDeEmpreendimentos: estado.lerCadastro,
}));

// A régua de escrita no servidor lê o cadastro do banco: aqui ela é o dublê, e o teste é do USO dela.
vi.mock("@/lib/apolo/incorporador/operacao-do-produto-servidor", () => ({
  escritaNoProduto: estado.escrita,
}));

vi.mock("@/lib/apolo/incorporador/teto-do-portal", async (original) => ({
  ...(await original<typeof import("@/lib/apolo/incorporador/teto-do-portal")>()),
  cabeNoTetoDoPortal: estado.teto,
}));

vi.mock("@/lib/guardian/db", () => ({ getHadesDbPool: () => ({ ok: false }) }));

vi.mock("@/lib/apolo/cadastro-salvar", () => ({ salvarCadastroDoApolo: estado.salvar }));

vi.mock("@/lib/apolo/cadastro-checar-cpf", () => ({
  conferirCpfNoEmpreendimento: estado.conferirCpf,
}));

vi.mock("@/lib/apolo/enterprise-settings", () => ({ exigeComprovanteRenda: estado.exigeRenda }));

vi.mock("@/lib/apolo/incorporador/crm", () => ({
  lerImobiliariasVinculadas: estado.imobiliarias,
}));

vi.mock("@/lib/apolo/mostqi", () => ({
  enrichCompany: estado.enrichCompany,
  enrichPerson: estado.enrichPerson,
  extractDocument: estado.extract,
  isMostqiConfigured: () => estado.mostConfigurada,
}));

import type { EmpreendimentoDoCatalogo } from "@/lib/apolo/catalogo-empreendimentos";
import type { AtorDoPortal } from "@/lib/temis/ator";

import {
  avisosSemDetalheDoBanco,
  checarCpfNoPortal,
  documentoLidoPeloAtor,
  configuracaoDoCadastroNoPortal,
  conferirVinculoDoPortal,
  conflitoDoCpfNoPortal,
  donoUploadDoPortal,
  executarMostNoPortal,
  idsDaHabilitacao,
  lerCadastroDaOperacao,
  lerPedidoDoMost,
  nomeDoProduto,
  payloadDoPortal,
  portalDoAtor,
  produtosDoCadastro,
  produtosDoPanteonDaSessao,
  produtosQueOPortalOpera,
  recusaDaEscritaNoCadastro,
  registroDoUsoDoMost,
  respostaDaRecusaNoPortal,
  salvarCadastroDoPortal,
} from "./cadastro-do-portal";

const CATALOGO: EmpreendimentoDoCatalogo[] = [
  {
    codes: ["LBF", "LBR", "LBP"],
    id: "group:Lagoa Bonita",
    name: "LAGOA BONITA",
    stageIds: ["33", "27", "32"],
  },
  { codes: ["VOC", "VOL"], id: "group:Vale do Ouro", name: "VALE DO OURO", stageIds: ["37", "38"] },
  { codes: ["GDN"], id: "50", name: "GARDEN", stageIds: ["50"] },
];

const USUARIO = "7b1d2c3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e";

/** A Cecílio como o portão entrega: ids JÁ expandidos. Só o VOC do Vale do Ouro e o Garden. */
function ator(extra: Partial<AtorDoPortal> = {}): AtorDoPortal {
  return {
    enterpriseIds: ["37", "50"],
    incorporadorId: "0f6d2c1e-3b4a-4c5d-8e9f-a1b2c3d4e5f6",
    nome: "Maria do Comercial",
    slug: "cecilio-rocha",
    tipo: "portal",
    usuarioId: USUARIO,
    ...extra,
  };
}

const IMOB_HABILITADA = "11111111-2222-4333-8444-555555555555";
const IMOB_PENDENTE = "66666666-7777-4888-9999-aaaaaaaaaaaa";

/**
 * Supabase falso: anota os inserts (a MOST registra em `apolo_ocr_reads`) e responde a conferência
 * da leitura (`documentoLidoPeloAtor`) com `leituras`, anotando os filtros dela.
 */
function clienteFalso(
  respostas: Array<{ code?: string } | null> = [],
  leituras: { data: unknown; error: unknown } = { data: [{ id: "leitura-1" }], error: null },
) {
  const inserts: Array<{ linha: Record<string, unknown>; tabela: string }> = [];
  const filtros: unknown[][] = [];
  const client = {
    from(tabela: string) {
      const q: Record<string, unknown> = {
        insert: async (linha: Record<string, unknown>) => {
          inserts.push({ linha, tabela });
          const erro = respostas.shift() ?? null;
          return { error: erro };
        },
      };
      for (const metodo of ["select", "eq", "gte"]) {
        q[metodo] = (...args: unknown[]) => {
          filtros.push([metodo, ...args]);
          return q;
        };
      }
      q.limit = async () => leituras;
      return q;
    },
  };
  return { client: client as never, filtros, inserts };
}

beforeEach(() => {
  estado.conferirCpf.mockReset();
  estado.enrichCompany.mockReset();
  estado.enrichPerson.mockReset();
  estado.exigeRenda.mockReset();
  estado.exigeRenda.mockResolvedValue(true);
  estado.extract.mockReset();
  estado.imobiliarias.mockReset();
  estado.imobiliarias.mockResolvedValue({
    credenciadas: [
      { documento: null, id: IMOB_HABILITADA, nome: "RR Soluções", verificada: true },
      { documento: null, id: IMOB_PENDENTE, nome: "Pedido em análise", verificada: false },
    ],
    ok: true,
  });
  estado.mostConfigurada = true;
  estado.salvar.mockReset();
  estado.escrita.mockReset();
  estado.escrita.mockResolvedValue("pode");
  estado.lerCadastro.mockReset();
  estado.teto.mockReset();
  estado.teto.mockResolvedValue(true);
});

describe("produtos e habilitação", () => {
  it("oferece só as DIVISÕES que a sessão alcança, sem o grupo", () => {
    expect(produtosDoCadastro(CATALOGO, ["37", "50"])).toEqual([
      { id: "50", nome: "Garden" },
      { id: "37", nome: "Vale do Ouro" },
    ]);
  });

  it("o dono do conjunto vê cada divisão com o código, para distinguir", () => {
    const ids = ["group:Lagoa Bonita", "33", "27", "32"];
    expect(produtosDoCadastro(CATALOGO, ids).map((p) => p.nome)).toEqual([
      "Lagoa Bonita (LBF)",
      "Lagoa Bonita (LBP)",
      "Lagoa Bonita (LBR)",
    ]);
  });

  it("o produto nascido no Panteon entra na lista, só se a sessão o traz", () => {
    const doPanteon = [
      { id: "100012", nome: "Recanto Novo" },
      { id: "100099", nome: "De Outro Dono" },
    ];
    expect(produtosDoCadastro(CATALOGO, ["37", "100012"], doPanteon)).toEqual([
      { id: "100012", nome: "Recanto Novo" },
      { id: "37", nome: "Vale do Ouro" },
    ]);
    expect(nomeDoProduto(CATALOGO, "100012", doPanteon)).toBe("Recanto Novo");
    expect(nomeDoProduto(CATALOGO, "100012")).toBeNull();
  });

  it("produtosDoPanteonDaSessao: só o que o C2X não conhece e a sessão traz; cadastro fora é vazio", async () => {
    estado.cadastro.mockResolvedValue([
      { c2xEnterpriseId: "100012", codigo: "RNV", id: "u-1", nome: "RECANTO NOVO", ordem: 0, paiId: null },
      { c2xEnterpriseId: "100099", codigo: "OUT", id: "u-2", nome: "DE OUTRO DONO", ordem: 0, paiId: null },
      { c2xEnterpriseId: "37", codigo: "VOC", id: "u-3", nome: "VALE DO OURO VOC", ordem: 0, paiId: null },
    ]);
    expect(await produtosDoPanteonDaSessao(ator({ enterpriseIds: ["37", "100012"] }), CATALOGO)).toEqual([
      { id: "100012", nome: "Recanto Novo" },
    ]);

    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    estado.cadastro.mockRejectedValueOnce(new Error("fora"));
    expect(await produtosDoPanteonDaSessao(ator(), CATALOGO)).toEqual([]);
    erro.mockRestore();
  });

  it("a habilitação vale no produto e no grupo dele, nunca na divisão irmã", () => {
    expect(idsDaHabilitacao(CATALOGO, "37")).toEqual(["37", "group:Vale do Ouro"]);
    expect(idsDaHabilitacao(CATALOGO, "50")).toEqual(["50"]);
    expect(idsDaHabilitacao(CATALOGO, "37")).not.toContain("38");
  });

  it("o staging do upload do portal tem prefixo próprio, diferente do operador do hub", () => {
    expect(donoUploadDoPortal(USUARIO)).toBe(`p-${USUARIO}`);
  });
});

describe("conferirVinculoDoPortal: escopo e imobiliária", () => {
  const conferir = (enterpriseId: unknown, imobiliariaId: unknown = "", quem = ator()) =>
    conferirVinculoDoPortal({
      adminClient: {} as never,
      ator: quem,
      catalogo: CATALOGO,
      enterpriseId,
      imobiliariaId,
    });

  it("sem produto: 400", async () => {
    expect(await conferir("")).toMatchObject({ ok: false, status: 400 });
  });

  it("produto de fora da sessão: 404, sem ler imobiliária nenhuma", async () => {
    // VOL é a divisão do Lino; o grupo do Vale do Ouro também não é da Cecílio (ela tem só o VOC).
    for (const fora of ["38", "group:Vale do Ouro", "33", "999"]) {
      expect(await conferir(fora, IMOB_HABILITADA)).toEqual({
        error: "Nao encontrado.",
        ok: false,
        status: 404,
      });
    }
    expect(estado.imobiliarias).not.toHaveBeenCalled();
  });

  it("sem imobiliária: 400, sem consultar vínculo (sem ela a CAD não entra na esteira)", async () => {
    expect(await conferir("37")).toEqual({
      error: "Escolha a imobiliária deste cadastro.",
      ok: false,
      status: 400,
    });
    expect(estado.imobiliarias).not.toHaveBeenCalled();
  });

  it("imobiliária NÃO vinculada ao produto: 422", async () => {
    const outra = "99999999-8888-4777-8666-555555555555";
    expect(await conferir("37", outra)).toMatchObject({ ok: false, status: 422 });
  });

  it("imobiliária com vínculo só pendente não habilita CAD: 422", async () => {
    expect(await conferir("37", IMOB_PENDENTE)).toMatchObject({ ok: false, status: 422 });
  });

  it("imobiliária habilitada: o nome sai do vínculo e a leitura usa produto + grupo", async () => {
    expect(await conferir("37", IMOB_HABILITADA.toUpperCase())).toEqual({
      empreendimentoNome: "Vale do Ouro",
      enterpriseId: "37",
      imobiliaria: { id: IMOB_HABILITADA, nome: "RR Soluções" },
      ok: true,
    });
    expect(estado.imobiliarias).toHaveBeenCalledWith({}, ["37", "group:Vale do Ouro"]);
  });

  it("leitura dos vínculos fora do ar: 503, nunca 422", async () => {
    estado.imobiliarias.mockResolvedValue({ erro: "x", ok: false });
    expect(await conferir("37", IMOB_HABILITADA)).toMatchObject({ ok: false, status: 503 });
  });
});

describe("payloadDoPortal", () => {
  it("o corpo não dita papel, origem, dono, corretor nem imobiliária", () => {
    const corpo = {
      corretores: [{ cpf: "1", nome: "x" }],
      origem: "cadastro-formulario",
      ownerUserId: "hub-user",
      perfil: { email: "a@b.com", imobiliariaId: "forjada", imobiliariaLabel: "Forjada" },
      persona: "pf",
      role: "imobiliaria",
      vinculo: { corretorEntityId: "c", corretorNome: "Corretor", enterpriseId: "38" },
    } as never;

    const saida = payloadDoPortal(corpo, {
      empreendimentoNome: "Vale do Ouro",
      enterpriseId: "37",
      imobiliaria: { id: IMOB_HABILITADA, nome: "RR Soluções" },
      ok: true,
    });

    expect(saida).toMatchObject({
      origem: "portal-incorporador",
      ownerUserId: null,
      perfil: { email: "a@b.com", imobiliariaId: IMOB_HABILITADA, imobiliariaLabel: "RR Soluções" },
      role: "prospect",
      vinculo: { empreendimentoNome: "Vale do Ouro", enterpriseId: "37" },
    });
    expect(saida.corretores).toBeUndefined();
    expect(saida.vinculo).not.toHaveProperty("corretorEntityId");
  });
});

describe("a recusa no portal não revela terceiros", () => {
  it("CAD no mesmo produto: 409 com a frase curta, sem o nome do empreendimento nem o id", () => {
    const resposta = respostaDaRecusaNoPortal({ motivo: "cad-no-empreendimento" }, "pf");
    expect(resposta).toEqual({
      corpo: { error: "Este CPF já tem cadastro neste produto.", jaExiste: true },
      status: 409,
    });
    expect(respostaDaRecusaNoPortal({ motivo: "cad-no-empreendimento" }, "pj").corpo.error).toBe(
      "Este CNPJ já tem cadastro neste produto.",
    );
  });

  it("e-mail e núcleo familiar: 409 sem nome de ninguém", () => {
    const email = respostaDaRecusaNoPortal({ motivo: "email-repetido" }, "pf");
    const nucleo = respostaDaRecusaNoPortal({ motivo: "nucleo-familiar" }, "pf");
    expect(email.status).toBe(409);
    expect(nucleo.status).toBe(409);
    expect(JSON.stringify([email, nucleo])).not.toMatch(/entityIdExistente|JOÃO|Vale do Ouro/);
  });

  it("os avisos do 201 saem sem a mensagem do banco", () => {
    expect(
      avisosSemDetalheDoBanco([
        'esteira: duplicate key value violates unique constraint "apolo_esteira_pkey"',
        "documento identificacao: new row violates row-level security policy",
        "documento identificacao: outra",
        "CAD: falha ao gerar o PDF (x)",
      ]),
    ).toEqual(["esteira", "documento identificacao", "CAD"]);
  });

  it("verificação fora do ar é 503 e falha sem motivo é 500", () => {
    expect(respostaDaRecusaNoPortal({ motivo: "verificacao-indisponivel" }, "pf").status).toBe(503);
    expect(respostaDaRecusaNoPortal({}, "pf").status).toBe(500);
  });

  it("a checagem do CPF traduz o conflito e descarta a frase do hub", () => {
    const traduzido = conflitoDoCpfNoPortal({
      mensagem: "O CPF do cônjuge do JOÃO DA SILVA já possui CAD para o empreendimento VALE DO OURO.",
      tipo: "titular-ja-e-conjuge-de-quem-tem-cad",
    });
    expect(traduzido?.mensagem).toBe(
      "Este CPF já aparece como cônjuge em um cadastro deste produto. Casal é um cadastro só por produto.",
    );
    expect(conflitoDoCpfNoPortal(null)).toBeNull();
  });
});

describe("salvarCadastroDoPortal", () => {
  const corpo = (extra: Record<string, unknown> = {}) =>
    ({
      persona: "pf",
      role: "prospect",
      vinculo: { enterpriseId: "37" },
      ...extra,
    }) as never;

  it("papel diferente de prospect: 400, sem gravar", async () => {
    const r = await salvarCadastroDoPortal({
      adminClient: {} as never,
      ator: ator(),
      catalogo: CATALOGO,
      payload: corpo({ role: "imobiliaria" }),
    });
    expect(r.status).toBe(400);
    expect(estado.salvar).not.toHaveBeenCalled();
  });

  it("produto fora do escopo: 404, sem gravar", async () => {
    const r = await salvarCadastroDoPortal({
      adminClient: {} as never,
      ator: ator(),
      catalogo: CATALOGO,
      payload: corpo({ vinculo: { enterpriseId: "38" } }),
    });
    expect(r).toEqual({ corpo: { error: "Nao encontrado." }, status: 404 });
    expect(estado.salvar).not.toHaveBeenCalled();
  });

  it("sem imobiliária: 400, sem gravar", async () => {
    const r = await salvarCadastroDoPortal({
      adminClient: {} as never,
      ator: ator(),
      catalogo: CATALOGO,
      payload: corpo(),
    });
    expect(r).toEqual({ corpo: { error: "Escolha a imobiliária deste cadastro." }, status: 400 });
    expect(estado.salvar).not.toHaveBeenCalled();
  });

  it("imobiliária não vinculada: 422, sem gravar", async () => {
    const r = await salvarCadastroDoPortal({
      adminClient: {} as never,
      ator: ator(),
      catalogo: CATALOGO,
      payload: corpo({ perfil: { imobiliariaId: "99999999-8888-4777-8666-555555555555" } }),
    });
    expect(r.status).toBe(422);
    expect(estado.salvar).not.toHaveBeenCalled();
  });

  it("duplicado no mesmo produto: 409 sem o id nem a frase do hub", async () => {
    estado.salvar.mockResolvedValue({
      ok: false,
      recusa: {
        entityIdExistente: "ficha-de-outra-pessoa",
        error: "Este CPF já tem CAD cadastrada no empreendimento VALE DO OURO. Não precisa reenviar.",
        motivo: "cad-no-empreendimento",
        ok: false,
      },
      tipo: "recusado",
    });

    const r = await salvarCadastroDoPortal({
      adminClient: {} as never,
      ator: ator(),
      catalogo: CATALOGO,
      payload: corpo({ perfil: { imobiliariaId: IMOB_HABILITADA } }),
    });

    expect(r).toEqual({
      corpo: { error: "Este CPF já tem cadastro neste produto.", jaExiste: true },
      status: 409,
    });
    expect(JSON.stringify(r)).not.toContain("ficha-de-outra-pessoa");
  });

  it("grava como o usuário do portal, entra no board, aproveita a ficha existente e limpa os avisos", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    estado.salvar.mockResolvedValue({
      corpo: {
        autenticacao: "CAD-2026-ABCD1234",
        cadBase64: null,
        entityId: "ent-1",
        ok: true,
        savedDocs: ["cad"],
        warnings: ["documento renda: new row violates row-level security policy for table x"],
      },
      esteira: "gravada",
      ok: true,
    });

    const r = await salvarCadastroDoPortal({
      adminClient: {} as never,
      ator: ator(),
      catalogo: CATALOGO,
      payload: corpo({
        origem: "forjada",
        ownerUserId: "hub-user",
        perfil: { imobiliariaId: IMOB_HABILITADA },
      }),
    });

    expect(r.status).toBe(201);
    // SÓ os quatro campos: o código de autenticação e o PDF poderiam ser os da ficha que a Careli já
    // tinha (decisão do Lucas, 16/09/2026: nada do que a Careli já tem volta na resposta).
    expect(r.corpo).toEqual({
      aviso: "O cadastro entrou no board de cadastro, na etapa de validação.",
      entityId: "ent-1",
      naEsteira: true,
      warnings: ["documento renda"],
    });
    expect(JSON.stringify(r.corpo)).not.toContain("row-level security");
    expect(aviso).toHaveBeenCalled();
    aviso.mockRestore();

    const chamada = estado.salvar.mock.calls[0]?.[0];
    expect(chamada.fichaExistente).toBe("acrescentar");
    expect(chamada.autor.donoUpload).toBe(`p-${USUARIO}`);
    expect(chamada.autor.ownerUserId).toBeNull();
    expect(chamada.autor.registro).toEqual({
      nome: "Maria do Comercial",
      origem: "portal",
      slug: "cecilio-rocha",
      usuarioId: USUARIO,
    });
    expect(await chamada.autor.nome()).toBe("Maria do Comercial");
    expect(chamada.origemDaEsteira).toBe("portal-incorporador");
    expect(chamada.payload).toMatchObject({
      origem: "portal-incorporador",
      ownerUserId: null,
      perfil: { imobiliariaId: IMOB_HABILITADA, imobiliariaLabel: "RR Soluções" },
      vinculo: { empreendimentoNome: "Vale do Ouro", enterpriseId: "37" },
    });
  });
});

describe("checarCpfNoPortal", () => {
  const CPF = "529.982.247-25";

  it("produto de fora da sessão: 404 antes de consultar", async () => {
    const r = await checarCpfNoPortal({
      adminClient: {} as never,
      ator: ator(),
      corpo: { cpf: CPF, enterpriseId: "38" },
    });
    expect(r.status).toBe(404);
    expect(estado.conferirCpf).not.toHaveBeenCalled();
  });

  it("conflito sai traduzido, sem o nome do empreendimento", async () => {
    estado.conferirCpf.mockResolvedValue({
      conflito: {
        mensagem: "Este CPF já possui CAD para o empreendimento VALE DO OURO.",
        tipo: "cpf-ja-tem-cad",
      },
    });
    const r = await checarCpfNoPortal({
      adminClient: {} as never,
      ator: ator(),
      corpo: { cpf: CPF, enterpriseId: "37" },
    });
    expect(r).toEqual({
      corpo: {
        data: {
          conferido: true,
          conflito: { mensagem: "Este CPF já tem cadastro neste produto.", tipo: "cpf-ja-tem-cad" },
        },
      },
      status: 200,
    });
    expect(estado.conferirCpf).toHaveBeenCalledWith(
      {},
      { cpf: "52998224725", cpfConjuge: "", enterpriseId: "37" },
    );
  });

  it("CPF sem CAD no produto: livre, mesmo que a pessoa tenha ficha na Careli (não é conflito)", async () => {
    // A conferência do produto não achou nada. Ter ficha em outro produto não aparece aqui: a CAD
    // entra na mesma ficha no salvar, e dizer "já existe" seria devolver o que a Careli sabe.
    estado.conferirCpf.mockResolvedValue({ conflito: null });
    const livre = await checarCpfNoPortal({
      adminClient: {} as never,
      ator: ator(),
      corpo: { cpf: CPF, enterpriseId: "37" },
    });
    expect(livre).toEqual({ corpo: { data: { conferido: true, conflito: null } }, status: 200 });
  });

  it("leitura da esteira que falhou: não conferido, e o salvar decide", async () => {
    estado.conferirCpf.mockResolvedValue(null);
    const semCerteza = await checarCpfNoPortal({
      adminClient: {} as never,
      ator: ator(),
      corpo: { cpf: CPF, enterpriseId: "37" },
    });
    expect(semCerteza.corpo).toEqual({ data: { conferido: false, conflito: null } });
  });

  it("CPF incompleto: não conferido, sem consulta", async () => {
    const r = await checarCpfNoPortal({
      adminClient: {} as never,
      ator: ator(),
      corpo: { cpf: "529", enterpriseId: "37" },
    });
    expect(r.corpo).toEqual({ data: { conferido: false, conflito: null } });
    expect(estado.conferirCpf).not.toHaveBeenCalled();
  });
});

/** Uma linha do cadastro do Panteon com quem opera (a coluna da 0170). */
function linhaDoCadastro(c2xEnterpriseId: string, operadoPor: null | string) {
  return {
    c2xEnterpriseId,
    cidade: null,
    codigo: `P${c2xEnterpriseId}`,
    id: `linha-${c2xEnterpriseId}`,
    nome: `PRODUTO ${c2xEnterpriseId}`,
    operadoPor,
    ordem: 0,
    paiId: null,
    uf: null,
    vendendo: true,
  };
}

const CECILIO_ID = ator().incorporadorId;
const GURGEL_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

/** VOC (37) é da Gurgel; o Garden (50 aqui) e o produto nascido no portal (100012) são da Cecílio. */
const OPERACAO = {
  com0170: true,
  linhas: [
    linhaDoCadastro("37", GURGEL_ID),
    linhaDoCadastro("50", CECILIO_ID.toUpperCase()),
    linhaDoCadastro("100012", CECILIO_ID),
  ],
};

describe("quem opera o produto (decisão do Lucas, 16/09/2026)", () => {
  it("portalDoAtor: o portal da régua sai do ator já revalidado", () => {
    expect(portalDoAtor(ator())).toEqual({
      incorporadorId: CECILIO_ID,
      slug: "cecilio-rocha",
      tipo: "incorporador",
    });
  });

  it("produtosQueOPortalOpera: VOC fica de fora, Garden e o produto do portal ficam", () => {
    const produtos = [
      { id: "50", nome: "Garden" },
      { id: "37", nome: "Vale do Ouro" },
      { id: "100012", nome: "Recanto Novo" },
      { id: "999", nome: "Sem cadastro" },
    ];
    expect(produtosQueOPortalOpera(produtos, ator(), OPERACAO)).toEqual([
      { id: "50", nome: "Garden" },
      { id: "100012", nome: "Recanto Novo" },
    ]);
    // Sem a 0170 ninguém opera nada: a lista some.
    expect(produtosQueOPortalOpera(produtos, ator(), { ...OPERACAO, com0170: false })).toEqual([]);
  });

  it("recusaDaEscritaNoCadastro: produto ausente ou de fora não pergunta à régua (400/404 de sempre)", async () => {
    expect(await recusaDaEscritaNoCadastro(ator(), "")).toBeNull();
    expect(await recusaDaEscritaNoCadastro(ator(), "38")).toBeNull();
    expect(estado.escrita).not.toHaveBeenCalled();
  });

  it("recusaDaEscritaNoCadastro: pergunta à régua com o portal do ator e devolve a recusa", async () => {
    expect(await recusaDaEscritaNoCadastro(ator(), "50")).toBeNull();
    expect(estado.escrita).toHaveBeenCalledWith(
      { incorporadorId: CECILIO_ID, slug: "cecilio-rocha", tipo: "incorporador" },
      ["50"],
    );

    estado.escrita.mockResolvedValueOnce("so-consulta");
    expect(await recusaDaEscritaNoCadastro(ator(), " 37 ")).toBe("so-consulta");
    estado.escrita.mockResolvedValueOnce("indisponivel");
    expect(await recusaDaEscritaNoCadastro(ator(), 37)).toBe("indisponivel");
  });

  it("lerCadastroDaOperacao: leitura que lança vira nulo, nunca 'a Careli opera tudo'", async () => {
    estado.lerCadastro.mockResolvedValueOnce(OPERACAO);
    expect(await lerCadastroDaOperacao()).toBe(OPERACAO);

    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    estado.lerCadastro.mockRejectedValueOnce(new Error("fora"));
    expect(await lerCadastroDaOperacao()).toBeNull();
    erro.mockRestore();
  });
});

describe("configuracaoDoCadastroNoPortal", () => {
  it("sem produto: só os produtos que o portal OPERA (o VOC é da Gurgel e some)", async () => {
    const r = await configuracaoDoCadastroNoPortal({
      adminClient: null,
      ator: ator(),
      cadastro: OPERACAO,
      catalogo: CATALOGO,
      enterpriseId: null,
    });
    expect(r).toEqual({
      corpo: { data: { produtos: [{ id: "50", nome: "Garden" }] } },
      status: 200,
    });
  });

  it("sem cadastro ou sem a 0170: 503 com a lista vazia (sem provar quem opera, nenhum produto)", async () => {
    for (const cadastro of [null, { ...OPERACAO, com0170: false }]) {
      const r = await configuracaoDoCadastroNoPortal({
        adminClient: null,
        ator: ator(),
        cadastro,
        catalogo: CATALOGO,
        enterpriseId: null,
      });
      expect(r).toEqual({
        corpo: {
          data: { produtos: [] },
          error: "Não foi possível conferir os produtos que você opera agora. Tente de novo em instantes.",
        },
        status: 503,
      });
    }
  });

  it("sem catálogo: 503, e não 'nenhum produto'", async () => {
    const r = await configuracaoDoCadastroNoPortal({
      adminClient: null,
      ator: ator(),
      cadastro: OPERACAO,
      catalogo: [],
      enterpriseId: null,
    });
    expect(r.status).toBe(503);
  });

  it("sem catálogo mas com produto do Panteon na sessão: oferece o do Panteon", async () => {
    const r = await configuracaoDoCadastroNoPortal({
      adminClient: null,
      ator: ator({ enterpriseIds: ["100012"] }),
      cadastro: OPERACAO,
      catalogo: [],
      doPanteon: [{ id: "100012", nome: "Recanto Novo" }],
      enterpriseId: null,
    });
    expect(r).toEqual({
      corpo: { data: { produtos: [{ id: "100012", nome: "Recanto Novo" }] } },
      status: 200,
    });
  });

  it("produto de fora: 404; de dentro: exigências e só as imobiliárias habilitadas", async () => {
    expect(
      (
        await configuracaoDoCadastroNoPortal({
          adminClient: {} as never,
          ator: ator(),
          catalogo: CATALOGO,
          enterpriseId: "38",
        })
      ).status,
    ).toBe(404);

    const r = await configuracaoDoCadastroNoPortal({
      adminClient: {} as never,
      ator: ator(),
      catalogo: CATALOGO,
      enterpriseId: "37",
    });
    expect(r).toEqual({
      corpo: {
        data: {
          comprovanteRenda: true,
          imobiliarias: [{ id: IMOB_HABILITADA, nome: "RR Soluções" }],
          produto: { id: "37", nome: "Vale do Ouro" },
        },
      },
      status: 200,
    });
  });
});

describe("a MOST pelo portal", () => {
  it("só as três ações do wizard; laboratório e autenticação ficam de fora", () => {
    expect(lerPedidoDoMost({ action: "probe", cpf: "1" })).toMatchObject({ ok: false, status: 400 });
    expect(lerPedidoDoMost({ action: "authenticate" })).toMatchObject({ ok: false, status: 400 });
    expect(lerPedidoDoMost({ action: "extract" })).toMatchObject({ ok: false, status: 400 });
    expect(lerPedidoDoMost({ action: "extract", fileBase64: "x".repeat(28_000_001) })).toMatchObject({
      ok: false,
      status: 413,
    });
    // `datasets` e `query` mudam o preço: não passam.
    expect(
      lerPedidoDoMost({ action: "enrich", cpf: "529.982.247-25", datasets: ["caro"], query: "GOLD" }),
    ).toEqual({ ok: true, pedido: { acao: "enrich", cpf: "52998224725" } });
  });

  it("a linha do uso leva o ator; enriquecimento sem documento e com chave que não é hash", () => {
    const linha = registroDoUsoDoMost({
      acao: "enrich",
      ator: ator(),
      custoPorImagem: 0.506,
      idDaConsulta: "abc",
      resultado: "mostqi",
    });
    expect(linha).toMatchObject({
      custo_brl: null,
      extracao: {
        acao: "enrich",
        ator: { nome: "Maria do Comercial", origem: "portal", slug: "cecilio-rocha", usuarioId: USUARIO },
      },
      file_sha256: "consulta:abc",
      lido_por: USUARIO,
      source_id: "cecilio-rocha",
      source_system: "portal-incorporador",
      tipo: "enrichment",
    });

    expect(
      registroDoUsoDoMost({
        acao: "extract",
        ator: ator({ usuarioId: "nao-e-uuid" }),
        custoPorImagem: 0.5,
        idDaConsulta: "x",
      }),
    ).toMatchObject({ file_sha256: "falha:x", lido_por: null, tipo: "iocr" });
  });

  it("leitura cobrada: devolve a extração e registra com o hash do byte e o ator", async () => {
    const extracao = {
      cadastro: { cpf: "529.982.247-25", nome: "MARIA" },
      confiancaDocumento: 0.9,
      documentType: "rg",
      fields: [],
    };
    estado.extract.mockResolvedValue(extracao);
    const { client, inserts } = clienteFalso();

    const r = await executarMostNoPortal({
      adminClient: client,
      ator: ator(),
      pedido: { acao: "extract", fileBase64: "data:image/png;base64,aGVsbG8=", fileName: "rg.png" },
    });

    expect(r).toEqual({ corpo: { data: extracao }, status: 200 });
    expect(estado.extract).toHaveBeenCalledWith({
      fileBase64: "aGVsbG8=",
      fileName: "rg.png",
      returnImage: true,
    });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.tabela).toBe("apolo_ocr_reads");
    expect(inserts[0]?.linha).toMatchObject({
      extracao: { cpf: "52998224725", documentType: "rg" },
      // sha256("hello")
      file_sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      source_id: "cecilio-rocha",
      tipo: "iocr",
    });
  });

  it("a mesma foto lida de novo registra a releitura com chave própria", async () => {
    estado.extract.mockResolvedValue({ cadastro: {}, documentType: "rg", fields: [] });
    const { client, inserts } = clienteFalso([{ code: "23505" }, null]);

    await executarMostNoPortal({
      adminClient: client,
      ator: ator(),
      pedido: { acao: "extract", fileBase64: "aGVsbG8=", fileName: "rg.png" },
    });

    expect(inserts).toHaveLength(2);
    expect(String(inserts[1]?.linha.file_sha256)).toMatch(/^releitura:/);
  });

  it("sem a chave da MOST (modo simulado) não há custo nem registro", async () => {
    estado.mostConfigurada = false;
    estado.enrichPerson.mockResolvedValue({ source: "mock" });
    const { client, inserts } = clienteFalso();

    const r = await executarMostNoPortal({
      adminClient: client,
      ator: ator(),
      pedido: { acao: "enrich", cpf: "52998224725" },
    });

    expect(r.status).toBe(200);
    expect(inserts).toHaveLength(0);
  });

  it("CPF incompleto não consulta a MOST, então não registra", async () => {
    estado.enrichPerson.mockResolvedValue({ source: "unavailable" });
    const { client, inserts } = clienteFalso();

    await executarMostNoPortal({
      adminClient: client,
      ator: ator(),
      pedido: { acao: "enrich", cpf: "529" },
    });

    expect(inserts).toHaveLength(0);
  });

  it("falha ao registrar nunca derruba a resposta da consulta paga", async () => {
    estado.enrichCompany.mockResolvedValue({ source: "mostqi" });
    const lida = { data: [{ id: "leitura-1" }], error: null };
    const consulta: Record<string, unknown> = {
      eq: () => consulta,
      gte: () => consulta,
      insert: async () => {
        throw new Error("rede");
      },
      limit: async () => lida,
      select: () => consulta,
    };
    const client = { from: () => consulta } as never;
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const r = await executarMostNoPortal({
      adminClient: client,
      ator: ator(),
      pedido: { acao: "enrich-company", cnpj: "12345678000195" },
    });

    expect(r).toEqual({ corpo: { data: { source: "mostqi" } }, status: 200 });
    aviso.mockRestore();
  });

  it("enriquecimento de documento que ESTA conta não leu: não consulta a MOST nem cobra", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client, filtros, inserts } = clienteFalso([], { data: [], error: null });

    const r = await executarMostNoPortal({
      adminClient: client,
      agora: Date.parse("2026-09-16T12:00:00Z"),
      ator: ator(),
      pedido: { acao: "enrich", cpf: "52998224725" },
    });

    expect(r.status).toBe(200);
    expect(r.corpo).toMatchObject({ data: { available: false, nomeMae: "", source: "unavailable", telefones: [] } });
    expect(estado.enrichPerson).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
    // A conferência é da MESMA conta, do mesmo portal, do mesmo número, nas últimas 12 horas.
    expect(filtros).toEqual(
      expect.arrayContaining([
        ["eq", "source_system", "portal-incorporador"],
        ["eq", "source_id", "cecilio-rocha"],
        ["eq", "tipo", "iocr"],
        ["eq", "extracao->ator->>usuarioId", USUARIO],
        ["eq", "extracao->>cpf", "52998224725"],
        ["gte", "created_at", "2026-09-16T00:00:00.000Z"],
      ]),
    );
    aviso.mockRestore();
  });

  it("enriquecimento de documento lido por esta conta: consulta e registra", async () => {
    estado.enrichPerson.mockResolvedValue({ source: "mostqi" });
    const { client, inserts } = clienteFalso();

    const r = await executarMostNoPortal({
      adminClient: client,
      ator: ator(),
      pedido: { acao: "enrich", cpf: "52998224725" },
    });

    expect(r).toEqual({ corpo: { data: { source: "mostqi" } }, status: 200 });
    expect(estado.enrichPerson).toHaveBeenCalledWith("52998224725");
    expect(inserts).toHaveLength(1);
  });

  it("a leitura registra o CNPJ ao lado do CPF, para o enriquecimento da empresa conferir", () => {
    const linha = registroDoUsoDoMost({
      acao: "extract",
      ator: ator(),
      custoPorImagem: 0.5,
      extracao: { cadastro: { cnpj: "12.345.678/0001-95" }, documentType: "cartao-cnpj" },
      fileSha256: "abc",
      idDaConsulta: "x",
    });
    expect(linha).toMatchObject({ extracao: { cnpj: "12345678000195", cpf: null } });
  });

  it("conferência da leitura que falha é não: fail-closed", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = clienteFalso([], { data: null, error: { code: "08006" } });
    expect(await documentoLidoPeloAtor(client, ator(), "cpf", "52998224725")).toBe(false);
    expect(await documentoLidoPeloAtor(null, ator(), "cpf", "52998224725")).toBe(false);
    aviso.mockRestore();
  });

  it("teto da conta batido: 429 antes de qualquer consulta paga, nas três ações", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    estado.teto.mockResolvedValue(false);
    const { client, inserts } = clienteFalso();

    for (const pedido of [
      { acao: "extract" as const, fileBase64: "aGVsbG8=", fileName: "rg.png" },
      { acao: "enrich" as const, cpf: "52998224725" },
      { acao: "enrich-company" as const, cnpj: "12345678000195" },
    ]) {
      const r = await executarMostNoPortal({ adminClient: client, ator: ator(), pedido });
      expect(r.status).toBe(429);
    }

    expect(estado.extract).not.toHaveBeenCalled();
    expect(estado.enrichPerson).not.toHaveBeenCalled();
    expect(estado.enrichCompany).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
    expect(estado.teto.mock.calls.map((c) => c[2])).toEqual([
      "leitura-de-documento",
      "consulta-paga",
      "consulta-paga",
    ]);
    aviso.mockRestore();
  });

  it("modo simulado (sem a chave da MOST) não conta teto", async () => {
    estado.mostConfigurada = false;
    estado.enrichPerson.mockResolvedValue({ source: "mock" });
    await executarMostNoPortal({
      adminClient: clienteFalso().client,
      ator: ator(),
      pedido: { acao: "enrich", cpf: "52998224725" },
    });
    expect(estado.teto).not.toHaveBeenCalled();
  });
});
