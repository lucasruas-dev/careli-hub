import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A ROTA DO TERMO DE ACORDO — metade lida como TEXTO, metade exercitada com os leitores mockados.
//
// ⚠️ A PARTE LIDA COMO TEXTO COBRA O QUE O TYPECHECK NÃO VÊ. Sem `maxDuration` a rota cai no teto
// padrão da Vercel e o timeout chega na tela como erro de JSON; com o portão de LEITURA no lugar do
// de escrita, o `viewer` emitiria instrumento para assinatura. As duas trocas compilam limpas.
//
// ⚠️ A PARTE EXERCITADA COBRA A ORDEM. O gate tem de responder ANTES de a rota abrir conexão no C2X:
// medido em 20/09/2026, 22 dos 40 acordos de produção estão reprovados, então quase um em cada dois
// cliques é uma recusa — e cada recusa que passasse pelo legado gastaria uma conexão de um MySQL
// com teto.
const ROTA = readFileSync(join(__dirname, "route.ts"), "utf8");
const CODIGO = ROTA.split("\n")
  .filter((linha) => !/^\s*(\/\/|\/\*|\*)/.test(linha))
  .join("\n");

describe("a rota do termo de acordo, lida como texto", () => {
  it("declara o teto de 30s, o runtime node e o dinâmico", () => {
    expect(CODIGO).toContain("export const maxDuration = 30;");
    expect(CODIGO).toContain('export const runtime = "nodejs";');
    expect(CODIGO).toContain('export const dynamic = "force-dynamic";');
  });

  it("o portão é o de escrita, e só ele", () => {
    expect(CODIGO).toContain("authorizeHadesWrite(request)");
    expect(CODIGO).not.toContain("authorizeHadesRead");
  });

  it("a decisão é da lib: gate e montagem importados, nenhuma régua local", () => {
    expect(CODIGO).toContain('from "@/lib/hades/dossie/termo-de-acordo-gate"');
    expect(CODIGO).toContain("montarTermoDoAcordoEmPdf(acordo)");
    expect(CODIGO).not.toContain("approvalStatus ===");
  });

  // ⚠️ A MONTAGEM DO PAPEL É UMA SÓ, E DESDE 20/09/2026 ISSO IMPORTA: são DOIS caminhos para o
  // mesmo documento — este download e o envio para a Clicksign
  // (`app/api/guardian/termo-de-acordo/assinatura/route.ts`). Uma segunda montagem aqui faria o
  // cliente assinar um PDF diferente do que o operador baixou.
  it("a montagem do papel mora na lib, e não na rota", () => {
    expect(CODIGO).toContain('from "@/lib/hades/acordo/termo-em-pdf"');
    expect(CODIGO).not.toContain("loadHadesAttendanceClient");
    expect(CODIGO).not.toContain("montarTermoDeAcordoPdf(");
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
// O comportamento, com Supabase e C2X mockados.

const estado = vi.hoisted(() => ({
  acordo: null as null | Record<string, unknown>,
  autorizado: true,
  chamadasAoC2x: 0,
  cliente: null as null | Record<string, unknown>,
  falhaNoC2x: false,
}));

vi.mock("@/lib/guardian/auth", () => ({
  authorizeHadesWrite: async () =>
    estado.autorizado
      ? {
          ok: true,
          user: { displayName: "Operadora", email: null, id: "u-1", role: "operator" },
        }
      : { ok: false, response: Response.json({ error: "Sem acesso." }, { status: 403 }) },
}));

vi.mock("@/lib/guardian/compromissos", () => ({
  createGuardianMotorClient: () => ({}),
  getGuardianCompromissoDetail: async () => estado.acordo,
}));

vi.mock("@/lib/guardian/attendance", () => ({
  loadHadesAttendanceClient: async () => {
    estado.chamadasAoC2x += 1;
    if (estado.falhaNoC2x) throw new Error("Too many connections");
    return estado.cliente;
  },
}));

vi.mock("@/lib/guardian/db", () => ({
  sanitizeHadesDbError: (erro: unknown) => String(erro),
}));

const ID = "894dadde-0619-4ccc-b6d7-72e28bad8eea";

function acordoAprovado(): Record<string, unknown> {
  return {
    acquisitionRequestC2xId: 467,
    approvalStatus: "aprovado",
    clientC2xId: 597,
    createdAt: "2026-09-14T18:21:53.435Z",
    kind: "acordo",
    metadata: { agreement_amount: 206, c2x_parcelas: ["1"], original_amount: 200 },
    parcelas: [
      { amount: 103, dueDate: "2026-10-25", sequence: 1 },
      { amount: 103, dueDate: "2026-11-25", sequence: 2 },
    ],
    protocol: "AC-000018",
    status: "ativo",
    submittedAt: "2026-09-14T18:21:53.409Z",
    totalAmount: 206,
  };
}

function clienteDoHades(): Record<string, unknown> {
  return {
    c2xInstallments: [
      {
        acquisitionRequestId: "467",
        dueDateInput: "2026-06-10",
        id: "1",
        number: "Parcela 11/144",
        status: "Vencida",
        unitCode: "LOS2409",
        valueNumber: 200,
      },
    ],
    carteira: {
      unidades: [{ empreendimento: "Lavra Do Ouro", lote: "L09", matricula: "LOS2409", quadra: "Q24" }],
    },
    cpf: "123.456.789-09",
    dados360: {
      endereco: "Rua Inventada - 10",
      estadoCivil: "Solteiro(a)",
      nacionalidade: "Brasileira",
      profissao: "Autônomo",
    },
    nome: "Fulano De Teste",
  };
}

async function chamar(corpo: unknown) {
  const { POST } = await import("./route");
  return POST(
    new Request("http://localhost/api/guardian/termo-de-acordo", {
      body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
      headers: { Authorization: "Bearer x", "Content-Type": "application/json" },
      method: "POST",
    }),
  );
}

beforeEach(() => {
  estado.acordo = acordoAprovado();
  estado.autorizado = true;
  estado.chamadasAoC2x = 0;
  estado.cliente = clienteDoHades();
  estado.falhaNoC2x = false;
});

describe("a rota do termo de acordo, exercitada", () => {
  it("acordo aprovado e confirmado pelo C2X: devolve o PDF para download", async () => {
    const resposta = await chamar({ compromissoId: ID });

    expect(resposta.status).toBe(200);
    expect(resposta.headers.get("content-type")).toBe("application/pdf");
    expect(resposta.headers.get("content-disposition")).toContain("Termo de Acordo - Fulano De Teste - LOS2409");
    const bytes = new Uint8Array(await resposta.arrayBuffer());
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
  });

  it("acordo pendente: 409 com a frase do card, SEM ir ao C2X", async () => {
    estado.acordo = { ...acordoAprovado(), approvalStatus: "pendente" };
    const resposta = await chamar({ compromissoId: ID });

    expect(resposta.status).toBe(409);
    expect(await resposta.json()).toEqual({
      error: "O termo sai depois que o gestor aprovar este acordo.",
    });
    expect(estado.chamadasAoC2x).toBe(0);
  });

  it("o C2X não confirma mais o débito: 422 com a frase, e não 500", async () => {
    estado.cliente = {
      ...clienteDoHades(),
      c2xInstallments: [
        {
          ...(clienteDoHades().c2xInstallments as Record<string, unknown>[])[0],
          status: "Liquidada",
        },
      ],
    };
    const resposta = await chamar({ compromissoId: ID });

    expect(resposta.status).toBe(422);
    expect(((await resposta.json()) as { error: string }).error).toContain("já consta paga no C2X");
  });

  it("id que não é de acordo nenhum: 400 antes de qualquer leitura", async () => {
    const resposta = await chamar({ compromissoId: "abc" });
    expect(resposta.status).toBe(400);
    expect(estado.chamadasAoC2x).toBe(0);
  });

  it("corpo que não é JSON: 400", async () => {
    expect((await chamar("{nao-e-json")).status).toBe(400);
  });

  it("acordo que não existe: 404", async () => {
    estado.acordo = null;
    expect((await chamar({ compromissoId: ID })).status).toBe(404);
  });

  it("cliente que não está no C2X: 404 com frase", async () => {
    estado.cliente = null;
    const resposta = await chamar({ compromissoId: ID });
    expect(resposta.status).toBe(404);
    expect(((await resposta.json()) as { error: string }).error).toContain("não foi encontrado no C2X");
  });

  it("falha do C2X vira frase de 500, sem vazar a mensagem do banco", async () => {
    estado.falhaNoC2x = true;
    const resposta = await chamar({ compromissoId: ID });
    expect(resposta.status).toBe(500);
    const { error } = (await resposta.json()) as { error: string };
    expect(error).toContain("Não foi possível gerar o termo de acordo agora");
    expect(error).not.toContain("Too many connections");
  });

  it("sem permissão de escrita: a resposta do portão", async () => {
    estado.autorizado = false;
    expect((await chamar({ compromissoId: ID })).status).toBe(403);
  });
});
