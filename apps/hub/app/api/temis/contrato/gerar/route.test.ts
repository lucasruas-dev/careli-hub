import { beforeEach, describe, expect, it, vi } from "vitest";

// A ROTA QUE FECHA O ELO — o que está travado aqui:
//
//   1. o PDF sai do MESMO HTML que a prévia mostrou (as duas rotas, o mesmo byte);
//   2. variável sem valor RECUSA a geração, e nada toca o bucket nem a tabela;
//   3. o documento nasce em `hercules_documentos` com `proposta_id` — que é o elo pelo qual o card
//      da Têmis o encontra — e a segunda geração vira versão nova, marcando a anterior.
//
// Supabase e Chromium mockados: o teste é da REGRA, não da integração.

const estado = vi.hoisted(() => ({
  contratosJaGuardados: [] as Array<{
    caminho: string;
    criado_em: string;
    id: string;
    nome: string;
    observacao: null | string;
    proposta_id: string;
  }>,
  htmlImpresso: [] as string[],
  inseridos: [] as Record<string, unknown>[],
  minutaVazia: false,
  proposta: {
    cliente_documento: "12345678901",
    cliente_entity_id: "ent-1",
    empreendimento_codigo: "TST",
    protocolo_numero: 7,
    unidade_id: "uni-1",
  } as null | Record<string, unknown>,
  removidosDoBucket: [] as string[][],
  semUnidade: false,
  subidos: [] as string[],
  updates: [] as Record<string, unknown>[],
  valores: { cpf_cliente: "111.222.333-44", nome_cliente: "Henrique Sales do Vale" } as Record<
    string,
    string
  >,
}));

vi.mock("@/lib/apolo/auth", () => ({
  authorizeApoloRead: async (request: Request) => {
    const header = request.headers.get("authorization") ?? "";
    if (!/^Bearer\s+\S+/i.test(header)) {
      return { ok: false, response: Response.json({ erro: "sem sessão" }, { status: 401 }) };
    }
    return { ok: true, userId: "user-1" };
  },
}));

// ⚠️ O CHROMIUM NÃO SOBE NO TESTE, mas o HTML que ele receberia é GUARDADO — é a única forma de
// provar que o papel impresso é o mesmo que a tela mostrou.
vi.mock("@/lib/temis/html-para-pdf", () => ({
  gerarPdfDoHtml: async (html: string) => {
    estado.htmlImpresso.push(html);
    return new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"
  },
}));

vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: () => cliente(),
  hashIdentifier: (tipo: string, valor: string) => `${tipo}:${valor}`,
}));

// ⚠️ OS DADOS DA PROPOSTA SÃO MOCKADOS INTEIROS. `dadosDaProposta` faz seis leituras encadeadas e
// tem teste próprio (67 KB dele); reproduzir aquele encadeamento aqui testaria o mock, não a rota.
vi.mock("@/lib/temis/dados-do-contrato", () => ({
  dadosDaProposta: async () => ({
    avisos: ["A unidade não tem matrícula: a qualificação do imóvel sai incompleta."],
    dados: {
      compradores: [
        { ehPessoaFisica: true, temConjuge: false, valores: estado.valores },
      ],
      gerais: {
        __empreendimento_id: "9001",
        empreendimento_codigo: "TST",
        numero_lote: "05",
        numero_quadra: "01",
      },
    },
  }),
}));

// ── O STUB DO SUPABASE ──────────────────────────────────────────────────────

type Contexto = { op: string; payload?: unknown; tabela: string; unico?: boolean };

function responder(ctx: Contexto): { data: unknown; error: null | { message: string } } {
  if (ctx.tabela === "temis_minutas") {
    if (estado.minutaVazia) return { data: [], error: null };
    return {
      data: [
        {
          conteudo: [
            {
              children: [
                { text: "Comprador: " },
                { children: [{ text: "" }], nome: "nome_cliente", type: "variavel" },
                { text: ", CPF " },
                { children: [{ text: "" }], nome: "cpf_cliente", type: "variavel" },
                { text: "." },
              ],
              type: "p",
            },
          ],
          id: "minuta-1",
          nome: "Teste Minuta",
          versao: 1,
        },
      ],
      error: null,
    };
  }

  if (ctx.tabela === "hercules_propostas") {
    if (!estado.proposta) return { data: null, error: null };
    return {
      data: estado.semUnidade ? { ...estado.proposta, unidade_id: null } : estado.proposta,
      error: null,
    };
  }

  if (ctx.tabela === "hub_users") {
    return { data: { display_name: "Zeus" }, error: null };
  }

  if (ctx.tabela === "hercules_documentos") {
    if (ctx.op === "insert") {
      estado.inseridos.push(ctx.payload as Record<string, unknown>);
      return { data: { id: `doc-${estado.inseridos.length}` }, error: null };
    }
    if (ctx.op === "update") {
      estado.updates.push(ctx.payload as Record<string, unknown>);
      return { data: null, error: null };
    }
    // `maybeSingle` é a abertura de UM documento; a lista é a leitura por proposta.
    return ctx.unico
      ? { data: estado.contratosJaGuardados[0] ?? null, error: null }
      : { data: estado.contratosJaGuardados, error: null };
  }

  return { data: null, error: null };
}

function consulta(tabela: string) {
  const ctx: Contexto = { op: "select", tabela };
  const proprios: Record<string, unknown> = {
    insert: (payload: unknown) => {
      ctx.op = "insert";
      ctx.payload = payload;
      return builder;
    },
    maybeSingle: async () => {
      ctx.unico = true;
      return responder(ctx);
    },
    single: async () => {
      ctx.unico = true;
      return responder(ctx);
    },
    then: (aceitar: (v: unknown) => unknown, recusar?: (e: unknown) => unknown) =>
      Promise.resolve(responder(ctx)).then(aceitar, recusar),
    update: (payload: unknown) => {
      ctx.op = "update";
      ctx.payload = payload;
      return builder;
    },
  };

  const builder: Record<string, unknown> = new Proxy(proprios, {
    get(alvo, prop) {
      if (prop in alvo) return alvo[prop as string];
      // Qualquer filtro (`eq`, `in`, `is`, `order`, `limit`, `select`…) só encadeia.
      return () => builder;
    },
  });

  return builder;
}

function cliente() {
  return {
    from: (tabela: string) => consulta(tabela),
    storage: {
      from: () => ({
        createSignedUrl: async (caminho: string) => ({
          data: { signedUrl: `https://x/sign/${caminho}` },
          error: null,
        }),
        remove: async (caminhos: string[]) => {
          estado.removidosDoBucket.push(caminhos);
          return { data: null, error: null };
        },
        upload: async (caminho: string) => {
          estado.subidos.push(caminho);
          return { data: { path: caminho }, error: null };
        },
      }),
    },
  } as never;
}

import { GET, POST } from "@/app/api/temis/contrato/gerar/route";
import { POST as PREVIA } from "@/app/api/temis/contrato/previa/route";

const AUTORIZADO = { authorization: "Bearer tok", "content-type": "application/json" };
const PROPOSTA = "641f22ac-6c4a-4133-afec-49fa7b7e1765";

function pedido(corpo: unknown, url = "https://x/api/temis/contrato/gerar") {
  return new Request(url, { body: JSON.stringify(corpo), headers: AUTORIZADO, method: "POST" });
}

beforeEach(() => {
  estado.contratosJaGuardados = [];
  estado.htmlImpresso = [];
  estado.inseridos = [];
  estado.minutaVazia = false;
  estado.proposta = {
    cliente_documento: "12345678901",
    cliente_entity_id: "ent-1",
    empreendimento_codigo: "TST",
    protocolo_numero: 7,
    unidade_id: "uni-1",
  };
  estado.removidosDoBucket = [];
  estado.semUnidade = false;
  estado.subidos = [];
  estado.updates = [];
  estado.valores = { cpf_cliente: "111.222.333-44", nome_cliente: "Henrique Sales do Vale" };
});

// ── 1. O MESMO HTML ─────────────────────────────────────────────────────────

describe("o PDF sai do mesmo HTML que a prévia mostrou", () => {
  // ⚠️ ESTE É O TESTE QUE FAZ A CONFERÊNCIA VALER. Se as duas rotas montassem o contrato por
  // caminhos próprios, aprovar na tela não diria nada sobre o papel — e a divergência apareceria
  // meses depois, num contrato já assinado.
  it("byte a byte", async () => {
    const daPrevia = (await (
      await PREVIA(pedido({ propostaId: PROPOSTA }, "https://x/api/temis/contrato/previa"))
    ).json()) as { html: string };

    const r = await POST(pedido({ propostaId: PROPOSTA }));
    expect(r.status).toBe(200);

    expect(estado.htmlImpresso).toHaveLength(1);
    expect(estado.htmlImpresso[0]).toBe(daPrevia.html);
    expect(daPrevia.html).toContain("Henrique Sales do Vale");
  });
});

// ── 2. LACUNA RECUSA ────────────────────────────────────────────────────────

describe("variável sem valor não vira arquivo", () => {
  it("recusa com 409, devolve a lista e não toca o bucket nem a tabela", async () => {
    // A minuta pede `cpf_cliente`; o comprador deixa de tê-lo.
    estado.valores = { nome_cliente: "Henrique Sales do Vale" };

    const r = await POST(pedido({ propostaId: PROPOSTA }));
    expect(r.status).toBe(409);

    const corpo = (await r.json()) as { erro: string; semValor: string[] };
    expect(corpo.semValor).toEqual(["cpf_cliente"]);
    expect(corpo.erro).toContain("cpf_cliente");

    // ⚠️ NADA FICA PARA TRÁS. Um PDF no bucket sem linha na tabela é armazenamento pago para
    // sempre; uma linha sem arquivo é um contrato que abre em erro com cara de existir.
    expect(estado.htmlImpresso).toHaveLength(0);
    expect(estado.subidos).toHaveLength(0);
    expect(estado.inseridos).toHaveLength(0);
  });

  // ⚠️ A PRÉVIA CONTINUA ABRINDO. Ela é o rascunho: bloquear a geração não pode bloquear a
  // conferência, senão ninguém descobre O QUE falta.
  it("a prévia do mesmo contrato continua respondendo 200", async () => {
    estado.valores = { nome_cliente: "Henrique Sales do Vale" };
    const r = await PREVIA(pedido({ propostaId: PROPOSTA }, "https://x/api/temis/contrato/previa"));
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { html: string; semValor: string[] };
    expect(corpo.semValor).toEqual(["cpf_cliente"]);
    // O buraco continua impresso no corpo — é a decisão de `preencherContrato`.
    expect(corpo.html).toContain("[cpf_cliente]");
  });
});

// ── 3. O DOCUMENTO E O ELO COM O CARD ───────────────────────────────────────

describe("o contrato guardado", () => {
  it("nasce ligado à proposta, com tipo contrato e na pasta da unidade", async () => {
    const r = await POST(pedido({ propostaId: PROPOSTA }));
    expect(r.status).toBe(200);

    expect(estado.inseridos).toHaveLength(1);
    const linha = estado.inseridos[0]!;
    // ⚠️ `proposta_id` É O ELO COM O CARD DA TÊMIS (`temis_trabalhos.proposta_id`). Sem ele o
    // arquivo existe e o board não sabe.
    expect(linha.proposta_id).toBe(PROPOSTA);
    // ⚠️ `tipo` É O QUE PINTA O SELO DE "gerado pelo sistema" nas duas abas que já leem a tabela.
    expect(linha.tipo).toBe("contrato");
    expect(linha.unidade_id).toBe("uni-1");
    expect(linha.protocolo_numero).toBe(7);
    expect(linha.mime).toBe("application/pdf");
    expect(linha.enviado_por_nome).toBe("Zeus");
    // ⚠️ O CPF VAI COMO HASH — é a chave pela qual a ficha do Apolo acha o documento.
    expect(linha.cliente_documento_hash).toBe("cpf:12345678901");

    // ⚠️ A PASTA É A DA UNIDADE: é a única que `caminhoDaUnidadeValido` aceita na abertura pelo
    // portal. Fora dela o contrato abriria em 404 na aba onde o coordenador o procura.
    expect(estado.subidos[0]).toMatch(/^hercules\/documentos\/uni-1\//);
  });

  it("o nome traz empreendimento, unidade, comprador, data e versão", async () => {
    await POST(pedido({ propostaId: PROPOSTA }));
    const nome = String(estado.inseridos[0]!.nome);
    expect(nome).toContain("TST");
    expect(nome).toContain("Q01 L05");
    expect(nome).toContain("Henrique Sales do Vale");
    expect(nome.endsWith(" v1.pdf")).toBe(true);
  });

  // ⚠️ GERAR DUAS VEZES NÃO PODE PRODUZIR DOIS DOCUMENTOS VÁLIDOS. A segunda é uma VERSÃO, e a
  // anterior recebe na observação a frase que diz quem a substituiu.
  it("a segunda geração vira versão 2 e marca a anterior", async () => {
    estado.contratosJaGuardados = [
      {
        caminho: "hercules/documentos/uni-1/antigo.pdf",
        criado_em: "2026-09-09T10:00:00Z",
        id: "doc-antigo",
        nome: "Contrato - TST - Q01 L05 - Henrique Sales do Vale - 2026-09-09 v1.pdf",
        observacao: null,
        proposta_id: PROPOSTA,
      },
    ];

    const r = await POST(pedido({ propostaId: PROPOSTA }));
    const corpo = (await r.json()) as { data: { versao: number } };
    expect(corpo.data.versao).toBe(2);
    expect(String(estado.inseridos[0]!.nome).endsWith(" v2.pdf")).toBe(true);

    expect(estado.updates).toHaveLength(1);
    expect(String(estado.updates[0]!.observacao)).toContain("Substituído pela versão 2");
  });

  it("recusa quando a proposta não aponta para unidade nenhuma", async () => {
    estado.semUnidade = true;
    const r = await POST(pedido({ propostaId: PROPOSTA }));
    expect(r.status).toBe(409);
    expect(estado.inseridos).toHaveLength(0);
  });

  it("recusa quando não há minuta publicada, sem chamar o Chromium", async () => {
    estado.minutaVazia = true;
    const r = await POST(pedido({ propostaId: PROPOSTA }));
    expect(r.status).toBe(409);
    expect(estado.htmlImpresso).toHaveLength(0);
  });
});

// ── A PORTA ─────────────────────────────────────────────────────────────────

describe("o portão", () => {
  it("sem Bearer não gera nada", async () => {
    const r = await POST(
      new Request("https://x/api/temis/contrato/gerar", {
        body: JSON.stringify({ propostaId: PROPOSTA }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(r.status).toBe(401);
    expect(estado.htmlImpresso).toHaveLength(0);
  });

  it("o GET devolve o link assinado do contrato guardado", async () => {
    await POST(pedido({ propostaId: PROPOSTA }));
    const caminho = String(estado.inseridos[0]!.caminho);
    estado.contratosJaGuardados = [
      {
        caminho,
        criado_em: "2026-09-09T10:00:00Z",
        id: "doc-1",
        nome: String(estado.inseridos[0]!.nome),
        observacao: null,
        proposta_id: PROPOSTA,
      },
    ];

    const r = await GET(
      new Request("https://x/api/temis/contrato/gerar?documento=doc-1", { headers: AUTORIZADO }),
    );
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { data: { url: string } };
    expect(corpo.data.url).toContain("https://x/sign/");
    expect(caminho.length).toBeGreaterThan(0);
  });

  it("o GET por proposta lista o que já foi gerado", async () => {
    estado.contratosJaGuardados = [
      {
        caminho: "hercules/documentos/uni-1/x.pdf",
        criado_em: "2026-09-09T10:00:00Z",
        id: "doc-1",
        nome: "Contrato - TST - Q01 L05 - Henrique - 2026-09-09 v1.pdf",
        observacao: null,
        proposta_id: PROPOSTA,
      },
    ];
    const r = await GET(
      new Request(`https://x/api/temis/contrato/gerar?proposta=${PROPOSTA}`, {
        headers: AUTORIZADO,
      }),
    );
    const corpo = (await r.json()) as { data: { contratos: Array<{ versao: number }> } };
    expect(corpo.data.contratos).toHaveLength(1);
    expect(corpo.data.contratos[0]!.versao).toBe(1);
  });
});
