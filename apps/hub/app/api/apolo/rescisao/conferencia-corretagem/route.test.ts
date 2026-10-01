import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A ROTA DA CONFERÊNCIA DA CORRETAGEM ZERO — metade lida como TEXTO, metade exercitada com o Supabase
// e a guarda do C2X simulados.
//
// ⚠️ A PARTE LIDA COMO TEXTO COBRA O QUE O TYPECHECK NÃO ALCANÇA, pelo mesmo motivo da rota da posse:
// o `workspace_id` trocado por um uuid casa zero linhas em silêncio (a conferência "grava" e o termo
// segue recusando), e o portão trocado pelo de escrita deixaria o operador de atendimento responder
// "houve corretagem?" no lugar da coordenação.
const ROTA = readFileSync(join(__dirname, "route.ts"), "utf8");
const CODIGO = ROTA.split("\n")
  .filter((linha) => !/^\s*(\/\/|\/\*|\*)/.test(linha))
  .join("\n");

/** O trecho do código que pertence a um verbo, até a próxima função exportada. */
function blocoDo(metodo: "GET" | "PUT"): string {
  const inicio = CODIGO.indexOf(`export async function ${metodo}(`);
  const resto = CODIGO.slice(inicio + 1);
  const fim = resto.indexOf("\nexport async function ");
  return fim === -1 ? resto : resto.slice(0, fim);
}

type Consulta = { filtros: Array<[string, unknown]>; limite: null | number; ordens: Array<[string, unknown]>; tabela: string };

const estado = vi.hoisted(() => ({
  autorizacao: "coordenacao" as "coordenacao" | "negada" | "sem_sessao",
  comSupabase: true,
  conferivel: { ok: true, valorDeTabela: 93900 } as { error?: string; ok: boolean; status?: number; valorDeTabela?: null | number },
  consultas: [] as Array<{ filtros: Array<[string, unknown]>; limite: null | number; ordens: Array<[string, unknown]>; tabela: string }>,
  errosDaLeitura: null as null | { code?: string; message: string },
  errosDoInsert: null as null | { code?: string; message: string },
  guardas: [] as Array<{ escopo: { c2xId: number; contratoId: number }; opcoes: unknown }>,
  gravacoes: [] as Array<{ tabela: string; valores: Record<string, unknown> }>,
  linhas: [] as Array<Record<string, unknown>>,
  operacoesProibidas: [] as string[],
}));

vi.mock("@/lib/apolo/auth", () => ({
  authorizeApoloCoordenacao: async () => {
    if (estado.autorizacao === "sem_sessao") {
      return { ok: false, response: Response.json({ error: "Sessao do Apolo ausente." }, { status: 401 }) };
    }
    if (estado.autorizacao === "negada") {
      return { ok: false, response: Response.json({ error: "Usuario sem acesso ao Apolo." }, { status: 403 }) };
    }
    return { nome: "Coordenadora", ok: true, userId: "3f7a2c18-9d4b-4f2a-8a11-0c5e6b7d8e90" };
  },
}));

vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: () =>
    estado.comSupabase
      ? {
          from: (tabela: string) => {
            const consulta: Consulta = { filtros: [], limite: null, ordens: [], tabela };
            const construtor = {
              eq: (coluna: string, valor: unknown) => {
                consulta.filtros.push([coluna, valor]);
                return construtor;
              },
              insert: async (valores: Record<string, unknown>) => {
                estado.gravacoes.push({ tabela, valores });
                return { error: estado.errosDoInsert };
              },
              limit: (n: number) => {
                consulta.limite = n;
                return construtor;
              },
              order: (coluna: string, opcoes: unknown) => {
                consulta.ordens.push([coluna, opcoes]);
                return construtor;
              },
              select: () => {
                estado.consultas.push(consulta);
                return construtor;
              },
              then: (resolver: (valor: unknown) => unknown) =>
                Promise.resolve({ data: estado.linhas, error: estado.errosDaLeitura }).then(resolver),
              // Qualquer escrita que não seja insert tem de derrubar o teste (histórico: só insert).
              update: () => {
                estado.operacoesProibidas.push("update");
                return construtor;
              },
              upsert: () => {
                estado.operacoesProibidas.push("upsert");
                return construtor;
              },
            };
            return construtor;
          },
        }
      : null,
}));

vi.mock("@/lib/apolo/termo-de-rescisao-server", () => ({
  conferirContratoDeCorretagemZero: async (
    escopo: { c2xId: number; contratoId: number },
    opcoes?: unknown,
  ) => {
    estado.guardas.push({ escopo, opcoes });
    return estado.conferivel;
  },
}));

import * as modulo from "./route";
import { GET, PUT } from "./route";

function pedido(corpo: unknown, bruto?: string): Request {
  return new Request("http://localhost/api/apolo/rescisao/conferencia-corretagem", {
    body: bruto ?? JSON.stringify(corpo),
    headers: { Authorization: "Bearer token-de-teste", "Content-Type": "application/json" },
    method: "PUT",
  });
}

function leitura(query: string): Request {
  return new Request(`http://localhost/api/apolo/rescisao/conferencia-corretagem${query}`, {
    headers: { Authorization: "Bearer token-de-teste" },
  });
}

const SEM_CORRETAGEM = {
  c2xId: 77,
  contrato: 2417,
  observacao: "Contrato assinado não prevê intermediação.",
  resultado: "sem_corretagem",
};

const COM_CORRETAGEM = {
  c2xId: 77,
  contrato: 2417,
  observacao: "Cláusula 3.2 do contrato assinado.",
  resultado: "com_corretagem",
  valor: "7.000,50",
};

beforeEach(() => {
  estado.autorizacao = "coordenacao";
  estado.comSupabase = true;
  estado.conferivel = { ok: true, valorDeTabela: 93900 };
  estado.consultas = [];
  estado.errosDaLeitura = null;
  estado.errosDoInsert = null;
  estado.guardas = [];
  estado.gravacoes = [];
  estado.linhas = [];
  estado.operacoesProibidas = [];
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("a rota, lida como texto", () => {
  it("o workspace é `careli`, e não um uuid", () => {
    expect(ROTA).toContain('const WORKSPACE = "careli"');
    expect(ROTA).not.toMatch(/const WORKSPACE = "[0-9a-f]{8}-/);
  });

  it("o portão é o da coordenação nos dois verbos, e nenhum outro", () => {
    expect(CODIGO).toContain("await authorizeApoloCoordenacao(request)");
    expect(CODIGO).not.toContain("authorizeApoloWrite");
    expect(CODIGO).not.toContain("authorizeApoloRead");
    expect(blocoDo("GET")).toContain("await portao(");
    expect(blocoDo("PUT")).toContain("await portao(");
  });

  it("declara maxDuration = 30, dinâmica e em Node, como a rota do PDF", () => {
    expect(CODIGO).toMatch(/export const maxDuration = 30;/);
    expect(CODIGO).toContain('export const dynamic = "force-dynamic";');
    expect(CODIGO).toContain('export const runtime = "nodejs";');
  });

  it("a ordem do PUT é auth, corpo, infraestrutura, validação, guarda", () => {
    const put = blocoDo("PUT");
    const posicoes = [
      "await portao(",
      "await request.json()",
      "createApoloAdminClient()",
      "idPlausivel(corpo.c2xId)",
      "await conferirContratoDeCorretagemZero(",
    ].map((trecho) => put.indexOf(trecho));

    expect(posicoes.every((p) => p >= 0)).toBe(true);
    expect([...posicoes].sort((a, b) => a - b)).toEqual(posicoes);
  });

  it("só exporta o que um arquivo de rota do Next aceita", () => {
    expect(Object.keys(modulo).sort()).toEqual(["GET", "PUT", "dynamic", "maxDuration", "runtime"]);
  });

  it("o C2X é só consultado por aqui (a guarda mora na lib), e a gravação é só INSERT", () => {
    expect(CODIGO).not.toContain("getHadesDbPool");
    expect(CODIGO).toContain(".insert(");
    expect(CODIGO).not.toContain(".upsert(");
    expect(CODIGO).not.toContain(".update(");
    expect(CODIGO).not.toContain(".delete(");
  });

  it("o valor é lido pela lib compartilhada com o painel, e não por uma cópia local", () => {
    expect(CODIGO).toContain('from "@/lib/apolo/valor-em-reais-br"');
    expect(CODIGO).toContain("lerValorEmReaisBr(corpo.valor)");
  });
});

describe("as guardas do PUT", () => {
  it("sem sessão: devolve a resposta do portão (401)", async () => {
    estado.autorizacao = "sem_sessao";
    const resposta = await PUT(pedido(SEM_CORRETAGEM));
    expect(resposta.status).toBe(401);
  });

  it("quem não é coordenação: 403 com a frase da regra", async () => {
    estado.autorizacao = "negada";
    const resposta = await PUT(pedido(SEM_CORRETAGEM));

    expect(resposta.status).toBe(403);
    expect(await resposta.json()).toEqual({
      error: "Só a coordenação (admin ou líder) registra a conferência da corretagem.",
    });
    expect(estado.gravacoes).toHaveLength(0);
  });

  it.each([["não é json", "{quebrado"], ["null", "null"], ["array", "[]"], ["texto", '"texto"']])(
    "corpo %s: 400",
    async (_nome, bruto) => {
      const resposta = await PUT(pedido(null, bruto));
      expect(resposta.status).toBe(400);
      expect(await resposta.json()).toEqual({ error: "Corpo inválido." });
    },
  );

  it("sem Supabase: 503, antes de validar o conteúdo", async () => {
    estado.comSupabase = false;
    const resposta = await PUT(pedido({ resultado: "qualquer coisa" }));
    expect(resposta.status).toBe(503);
  });

  it.each([
    ["sem cliente", { ...SEM_CORRETAGEM, c2xId: undefined }],
    ["contrato torto", { ...SEM_CORRETAGEM, contrato: "abc" }],
    ["contrato zero", { ...SEM_CORRETAGEM, contrato: 0 }],
    ["resultado desconhecido", { ...SEM_CORRETAGEM, resultado: "talvez" }],
    ["sem observação", { ...SEM_CORRETAGEM, observacao: "   " }],
    ["observação de 1001 caracteres", { ...SEM_CORRETAGEM, observacao: "a".repeat(1001) }],
    ["valor num 'não houve'", { ...SEM_CORRETAGEM, valor: 100 }],
    ["'houve' sem valor", { ...COM_CORRETAGEM, valor: undefined }],
    ["'houve' com valor zero", { ...COM_CORRETAGEM, valor: "0,00" }],
    ["'houve' com valor negativo", { ...COM_CORRETAGEM, valor: -5 }],
    ["'houve' com valor em texto", { ...COM_CORRETAGEM, valor: "muito" }],
    ["'houve' com três casas", { ...COM_CORRETAGEM, valor: "10,123" }],
    ["'houve' com número de três casas", { ...COM_CORRETAGEM, valor: 7.005 }],
    ["'houve' com valor gigante", { ...COM_CORRETAGEM, valor: 1e12 }],
  ])("%s: 400, e nada é consultado nem gravado", async (_nome, corpo) => {
    const resposta = await PUT(pedido(corpo));

    expect(resposta.status).toBe(400);
    expect(typeof (await resposta.json()).error).toBe("string");
    expect(estado.guardas).toHaveLength(0);
    expect(estado.gravacoes).toHaveLength(0);
  });

  it("observação de exatamente 1000 caracteres passa, e a de 1001 recusa com a frase do limite", async () => {
    const no_limite = await PUT(pedido({ ...SEM_CORRETAGEM, observacao: "a".repeat(1000) }));
    expect(no_limite.status).toBe(200);

    const acima = await PUT(pedido({ ...SEM_CORRETAGEM, observacao: "a".repeat(1001) }));
    expect(acima.status).toBe(400);
    expect((await acima.json()).error).toContain("1000 caracteres");
  });
});

// ⚠️ O ACHADO DE 01/10/2026: "7.000" gravava R$ 7,00. Aqui o valor atravessa a ROTA INTEIRA, e o que
// chega ao insert é o número certo; o que é ambíguo recusa com a frase do formato e não grava nada.
describe("o valor, de ponta a ponta", () => {
  it.each([
    ["7.000", 7000],
    ["12.500", 12500],
    ["R$ 12.500", 12500],
    ["3.500", 3500],
    ["7.000,50", 7000.5],
    ["7000", 7000],
    ["7000,5", 7000.5],
    [7000, 7000],
    [7000.5, 7000.5],
  ])("%j grava %d", async (valor, esperado) => {
    const resposta = await PUT(pedido({ ...COM_CORRETAGEM, valor }));

    expect(resposta.status).toBe(200);
    expect(estado.gravacoes.at(-1)?.valores.valor_em_reais).toBe(esperado);
    expect((await resposta.json()).data.valor).toBe(esperado);
  });

  it("1.000.000,00 é lido como um milhão (e cai no teto do valor de tabela, não na leitura)", async () => {
    estado.conferivel = { ok: true, valorDeTabela: 5_000_000 };
    const resposta = await PUT(pedido({ ...COM_CORRETAGEM, valor: "1.000.000,00" }));

    expect(resposta.status).toBe(200);
    expect(estado.gravacoes[0]?.valores.valor_em_reais).toBe(1_000_000);
  });

  it.each(["7.5", "7.00", "7000.50", "7,000.50", "7.000.5", "7,", ",50", "7.00,00", "1.0000", "", "-7000", "7000,505"])(
    "%j é recusado com 400 e a frase do formato, e nada é consultado nem gravado",
    async (valor) => {
      const resposta = await PUT(pedido({ ...COM_CORRETAGEM, valor }));

      expect(resposta.status).toBe(400);
      expect((await resposta.json()).error).toContain("7.000,50");
      expect(estado.guardas).toHaveLength(0);
      expect(estado.gravacoes).toHaveLength(0);
    },
  );
});

describe("a guarda do C2X no PUT", () => {
  it("passa o cliente e o contrato do corpo para a guarda, exigindo zero (o padrão)", async () => {
    await PUT(pedido(SEM_CORRETAGEM));
    expect(estado.guardas).toEqual([{ escopo: { c2xId: 77, contratoId: 2417 }, opcoes: undefined }]);
  });

  it("contrato de outro cliente: 404 com a frase, e nada é gravado", async () => {
    estado.conferivel = { error: "Este contrato não está entre os contratos deste cliente.", ok: false, status: 404 };
    const resposta = await PUT(pedido(SEM_CORRETAGEM));

    expect(resposta.status).toBe(404);
    expect(await resposta.json()).toEqual({ error: "Este contrato não está entre os contratos deste cliente." });
    expect(estado.gravacoes).toHaveLength(0);
  });

  it("comissão que não é zero: 422 com a frase, e nada é gravado", async () => {
    estado.conferivel = { error: "O contrato de corretagem desta venda não registra R$ 0,00.", ok: false, status: 422 };
    const resposta = await PUT(pedido(COM_CORRETAGEM));

    expect(resposta.status).toBe(422);
    expect((await resposta.json()).error).toContain("R$ 0,00");
    expect(estado.gravacoes).toHaveLength(0);
  });

  // ⚠️ ACHADO DA REVISÃO (30/09/2026): R$ 700.000 no lugar de R$ 7.000 deixaria a base da multa
  // negativa. O teto é o valor de tabela da unidade.
  it("valor da corretagem igual ou acima do valor de tabela: 400, e nada é gravado", async () => {
    const resposta = await PUT(pedido({ ...COM_CORRETAGEM, valor: "700.000,00" }));

    expect(resposta.status).toBe(400);
    expect((await resposta.json()).error).toContain("não é menor que o valor de tabela");
    expect(estado.gravacoes).toHaveLength(0);
  });

  it("logo abaixo do valor de tabela ainda grava", async () => {
    const resposta = await PUT(pedido({ ...COM_CORRETAGEM, valor: "93.899,99" }));
    expect(resposta.status).toBe(200);
  });

  it("unidade sem valor de tabela: 'houve' recusa com 422, e 'não houve' grava", async () => {
    estado.conferivel = { ok: true, valorDeTabela: null };

    const houve = await PUT(pedido(COM_CORRETAGEM));
    expect(houve.status).toBe(422);
    expect(estado.gravacoes).toHaveLength(0);

    const naoHouve = await PUT(pedido(SEM_CORRETAGEM));
    expect(naoHouve.status).toBe(200);
  });

  it("C2X fora do ar: 503", async () => {
    estado.conferivel = { error: "Não foi possível ler o contrato no C2X.", ok: false, status: 503 };
    const resposta = await PUT(pedido(SEM_CORRETAGEM));
    expect(resposta.status).toBe(503);
  });
});

describe("a gravação", () => {
  it("'não houve': INSERT com o carimbo e sem valor (nunca update nem upsert)", async () => {
    const resposta = await PUT(pedido(SEM_CORRETAGEM));

    expect(resposta.status).toBe(200);
    expect(estado.gravacoes).toHaveLength(1);
    const { tabela, valores } = estado.gravacoes[0]!;
    expect(tabela).toBe("hercules_conferencia_corretagem");
    expect(valores).toMatchObject({
      conferido_por: "3f7a2c18-9d4b-4f2a-8a11-0c5e6b7d8e90",
      conferido_por_nome: "Coordenadora",
      contrato_c2x_id: 2417,
      observacao: "Contrato assinado não prevê intermediação.",
      resultado: "sem_corretagem",
      valor_em_reais: null,
      workspace_id: "careli",
    });
    expect(typeof valores.conferido_em).toBe("string");
    expect(estado.operacoesProibidas).toEqual([]);
  });

  it("corrigir é gravar de novo: cada PUT é uma linha nova", async () => {
    await PUT(pedido(COM_CORRETAGEM));
    await PUT(pedido({ ...COM_CORRETAGEM, valor: "7.500,00" }));

    expect(estado.gravacoes).toHaveLength(2);
    expect(estado.gravacoes.map((g) => g.valores.valor_em_reais)).toEqual([7000.5, 7500]);
    expect(estado.operacoesProibidas).toEqual([]);
  });

  it("'houve': o valor em formato brasileiro vira número", async () => {
    const resposta = await PUT(pedido(COM_CORRETAGEM));

    expect(resposta.status).toBe(200);
    expect(estado.gravacoes[0]!.valores).toMatchObject({ resultado: "com_corretagem", valor_em_reais: 7000.5 });
    expect((await resposta.json()).data).toEqual({ contrato: 2417, resultado: "com_corretagem", valor: 7000.5 });
  });

  it("a observação vai aparada", async () => {
    await PUT(pedido({ ...SEM_CORRETAGEM, observacao: "  visto no contrato  " }));
    expect(estado.gravacoes[0]!.valores.observacao).toBe("visto no contrato");
  });

  it("tabela ausente: 503 com a frase", async () => {
    estado.errosDoInsert = {
      code: "PGRST205",
      message: "Could not find the table 'public.hercules_conferencia_corretagem' in the schema cache",
    };
    const resposta = await PUT(pedido(SEM_CORRETAGEM));

    expect(resposta.status).toBe(503);
    expect(await resposta.json()).toEqual({ error: "A tabela da conferência ainda não foi criada." });
  });

  it("outro erro do banco: 500 com a frase, sem vazar a mensagem", async () => {
    estado.errosDoInsert = { message: "deadlock detected" };
    const resposta = await PUT(pedido(SEM_CORRETAGEM));

    expect(resposta.status).toBe(500);
    expect(JSON.stringify(await resposta.json())).not.toContain("deadlock");
  });
});

// ⚠️ O GET É A TELA DE "VER OU CORRIGIR" (01/10/2026). Mesmo portão da coordenação, mesma guarda do
// pertencimento, mas SEM exigir comissão zero: quem corrige uma conferência antiga precisa vê-la
// mesmo que o C2X já tenha mudado.
describe("o GET", () => {
  const registro = (sobre: Record<string, unknown> = {}) => ({
    conferido_em: "2026-10-01T15:00:00.000Z",
    conferido_por_nome: "Coordenadora",
    id: "a1",
    observacao: "Cláusula 3.2.",
    resultado: "com_corretagem",
    valor_em_reais: "7000.50",
    ...sobre,
  });

  it("sem sessão: 401; quem não é coordenação: 403 com a frase", async () => {
    estado.autorizacao = "sem_sessao";
    expect((await GET(leitura("?c2xId=77&contrato=2417"))).status).toBe(401);

    estado.autorizacao = "negada";
    const negada = await GET(leitura("?c2xId=77&contrato=2417"));
    expect(negada.status).toBe(403);
    expect((await negada.json()).error).toContain("Só a coordenação (admin ou líder)");
  });

  it.each(["", "?c2xId=77", "?contrato=2417", "?c2xId=abc&contrato=2417", "?c2xId=77&contrato=0"])(
    "pedido %j sem cliente ou contrato: 400",
    async (query) => {
      const resposta = await GET(leitura(query));
      expect(resposta.status).toBe(400);
      expect(estado.guardas).toHaveLength(0);
    },
  );

  it("sem Supabase: 503", async () => {
    estado.comSupabase = false;
    expect((await GET(leitura("?c2xId=77&contrato=2417"))).status).toBe(503);
  });

  it("confere o pertencimento SEM exigir comissão zero", async () => {
    await GET(leitura("?c2xId=77&contrato=2417"));
    expect(estado.guardas).toEqual([
      { escopo: { c2xId: 77, contratoId: 2417 }, opcoes: { exigirZero: false } },
    ]);
  });

  it("contrato de outro cliente: 404", async () => {
    estado.conferivel = { error: "Este contrato não está entre os contratos deste cliente.", ok: false, status: 404 };
    const resposta = await GET(leitura("?c2xId=77&contrato=2417"));
    expect(resposta.status).toBe(404);
    expect(estado.consultas).toHaveLength(0);
  });

  it("devolve a atual (a mais recente) e o histórico, com o número já convertido", async () => {
    estado.linhas = [
      registro(),
      registro({ conferido_em: "2026-09-30T12:00:00.000Z", id: "a0", resultado: "sem_corretagem", valor_em_reais: null }),
    ];
    const resposta = await GET(leitura("?c2xId=77&contrato=2417"));

    expect(resposta.status).toBe(200);
    const { data } = await resposta.json();
    expect(data.atual).toEqual({
      conferido_em: "2026-10-01T15:00:00.000Z",
      conferido_por_nome: "Coordenadora",
      observacao: "Cláusula 3.2.",
      resultado: "com_corretagem",
      valor: 7000.5,
    });
    expect(data.historico).toHaveLength(2);
    expect(data.historico[1]).toMatchObject({ resultado: "sem_corretagem", valor: null });
  });

  it("sem registro nenhum: atual nulo e histórico vazio (200, não 404)", async () => {
    const resposta = await GET(leitura("?c2xId=77&contrato=2417"));

    expect(resposta.status).toBe(200);
    expect((await resposta.json()).data).toEqual({ atual: null, historico: [] });
  });

  it("lê as 10 mais recentes, da mais nova para a mais velha (conferido_em desc, id desc), do contrato", async () => {
    await GET(leitura("?c2xId=77&contrato=2417"));

    const consulta = estado.consultas[0]!;
    expect(consulta.tabela).toBe("hercules_conferencia_corretagem");
    expect(consulta.filtros).toEqual([
      ["workspace_id", "careli"],
      ["contrato_c2x_id", 2417],
    ]);
    expect(consulta.ordens).toEqual([
      ["conferido_em", { ascending: false }],
      ["id", { ascending: false }],
    ]);
    expect(consulta.limite).toBe(10);
  });

  it("tabela ausente: 503 com a frase; outro erro: 503 sem vazar a mensagem", async () => {
    estado.errosDaLeitura = {
      code: "PGRST205",
      message: "Could not find the table 'public.hercules_conferencia_corretagem' in the schema cache",
    };
    const ausente = await GET(leitura("?c2xId=77&contrato=2417"));
    expect(ausente.status).toBe(503);
    expect((await ausente.json()).error).toBe("A tabela da conferência ainda não foi criada.");

    estado.errosDaLeitura = { message: "connection reset" };
    const outro = await GET(leitura("?c2xId=77&contrato=2417"));
    expect(outro.status).toBe(503);
    expect(JSON.stringify(await outro.json())).not.toContain("connection reset");
  });
});

// ⚠️ TIPO ERRADO ENVIADO DIRETO À API (01/10/2026, achado da segunda revisão da Publicação).
// `String({})` é "[object Object]" e `String(["a"])` é "a": a observação, que é a PROVA da conferência,
// podia ser gravada como lixo. Texto é só `string`; id é só texto ou número; resultado é só uma das
// duas strings do conjunto. Qualquer outra coisa recusa com 400, e nada é consultado nem gravado.
describe("tipo errado no corpo", () => {
  const tortos: Array<[string, unknown]> = [
    ["objeto", { a: 1 }],
    ["array de texto", ["a"]],
    ["array vazio", []],
    ["número", 42],
    ["booleano", true],
    ["nulo", null],
  ];

  it.each(tortos)("observação %s: 400 com a frase da observação, e nada é gravado", async (_nome, observacao) => {
    const resposta = await PUT(pedido({ ...SEM_CORRETAGEM, observacao }));

    expect(resposta.status).toBe(400);
    expect((await resposta.json()).error).toContain("Escreva a observação");
    expect(estado.guardas).toHaveLength(0);
    expect(estado.gravacoes).toHaveLength(0);
  });

  it.each(tortos)("resultado %s: 400, e nada é gravado", async (_nome, resultado) => {
    const resposta = await PUT(pedido({ ...SEM_CORRETAGEM, resultado }));

    expect(resposta.status).toBe(400);
    expect((await resposta.json()).error).toContain("Escolha o resultado");
    expect(estado.gravacoes).toHaveLength(0);
  });

  it.each([
    ["objeto", { a: 1 }],
    ["array de um elemento (String(['77']) seria '77')", ["77"]],
    ["array de número", [77]],
    ["booleano", true],
    ["nulo", null],
    ["número com casas", 77.5],
  ])("c2xId %s: 400, e nada é gravado", async (_nome, c2xId) => {
    const resposta = await PUT(pedido({ ...SEM_CORRETAGEM, c2xId }));

    expect(resposta.status).toBe(400);
    expect(estado.guardas).toHaveLength(0);
    expect(estado.gravacoes).toHaveLength(0);
  });

  it.each([
    ["objeto", { a: 1 }],
    ["array de um elemento", ["2417"]],
    ["array de número", [2417]],
    ["booleano", true],
    ["nulo", null],
  ])("contrato %s: 400, e nada é gravado", async (_nome, contrato) => {
    const resposta = await PUT(pedido({ ...SEM_CORRETAGEM, contrato }));

    expect(resposta.status).toBe(400);
    expect(estado.guardas).toHaveLength(0);
    expect(estado.gravacoes).toHaveLength(0);
  });

  it("texto e número válidos continuam passando como id", async () => {
    const comTexto = await PUT(pedido({ ...SEM_CORRETAGEM, c2xId: "77", contrato: "2417" }));
    expect(comTexto.status).toBe(200);
    expect(estado.guardas.at(-1)?.escopo).toEqual({ c2xId: 77, contratoId: 2417 });
  });

  it("a observação em texto continua aparada e aceita", async () => {
    const resposta = await PUT(pedido({ ...SEM_CORRETAGEM, observacao: "  ok  " }));
    expect(resposta.status).toBe(200);
    expect(estado.gravacoes.at(-1)?.valores.observacao).toBe("ok");
  });
});
