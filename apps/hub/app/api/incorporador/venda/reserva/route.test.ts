import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A ROTA DA RESERVA, LIDA COMO TEXTO — o mesmo método de bloqueio/route.test.ts, pelo mesmo motivo:
// importar a rota exigiria Supabase, cookie assinado e cadastro, e o que se protege aqui (portão
// trocado, origem cravada, migration esquecida) é visível no texto e invisível para o typecheck.
const ROTA = readFileSync(join(__dirname, "route.ts"), "utf8");

// A migration que autoriza o valor novo na CHECK. Sai do repositório, não do banco: o teste prova
// que quem sobe o código tem o arquivo, não que ele foi aplicado (isso é a ORDEM DE DEPLOY escrita
// no cabeçalho dela).
const MIGRATION = readFileSync(
  join(
    __dirname,
    "../../../../../../../packages/database/migrations/0167_origem_incorporador_na_reserva.sql",
  ),
  "utf8",
);

describe("a autorização", () => {
  it("é a de quem opera a venda, nos três verbos", () => {
    const chamadas = ROTA.match(/autorizarOperacaoDeVenda\(request\)/g) ?? [];
    expect(chamadas.length).toBe(3);
    expect(ROTA).not.toMatch(/\bautorizar\(request\)/);
    expect(ROTA).not.toContain("autorizarComercial");
  });
});

describe("a origem gravada", () => {
  // Lucas (16/09/2026): o Cecílio opera a própria venda, *"sem o time administrativo da Careli"*.
  // A reserva dele não é do coordenador, e a coluna existe justamente para dizer de onde veio.
  // (16/09/2026, D1) A sessão é a REVALIDADA pela régua de escrita, e não a do cookie cru.
  it("sai da sessão, e não cravada em 'coordenador'", () => {
    expect(ROTA).toContain("const origem = origemDaReserva(sessao);");
    expect(ROTA).toContain("await inserirReserva(origem);");
    expect(ROTA).not.toMatch(/origem:\s*"coordenador"/);
  });

  // (16/09/2026, revisão) A rede para o código subir antes da 0167: só a recusa DA CHECK da origem
  // regrava com a origem antiga, e só depois da primeira tentativa com a origem da sessão.
  it("a origem antiga só entra pela rede da 0167, depois da tentativa com a da sessão", () => {
    const primeira = ROTA.indexOf("await inserirReserva(origem);");
    const rede = ROTA.indexOf("if (error && origemRecusadaSemA0167(error, origem))");
    const segunda = ROTA.indexOf("await inserirReserva(ORIGEM_ACEITA_SEM_A_0167)");
    expect(primeira).toBeGreaterThan(-1);
    expect(rede).toBeGreaterThan(primeira);
    expect(segunda).toBeGreaterThan(rede);
    expect(ROTA.match(/inserirReserva\(/g)?.length).toBe(2);
  });

  it("nunca sai do corpo do pedido", () => {
    expect(ROTA).not.toMatch(/origem:\s*corpo\./);
  });
});

describe("a migration 0167", () => {
  it("troca a CHECK pelo nome real da 0125, de forma idempotente", () => {
    expect(MIGRATION).toContain("drop constraint if exists hercules_reservas_origem");
    expect(MIGRATION).toContain("add constraint hercules_reservas_origem");
  });

  it("aceita 'incorporador' sem perder nenhuma origem que a 0125 aceitava", () => {
    const check = MIGRATION.match(/check \(origem in \(([^)]*)\)\)/);
    expect(check).not.toBeNull();
    const valores = (check?.[1] ?? "").split(",").map((v) => v.trim().replace(/'/g, ""));
    for (const antiga of ["coordenador", "salao", "corretor", "interno"]) {
      expect(valores).toContain(antiga);
    }
    expect(valores).toContain("incorporador");
  });

  it("declara a ordem de deploy: banco antes do código", () => {
    expect(MIGRATION).toMatch(/ORDEM DE DEPLOY/);
  });
});

// ── A ROTA DE VERDADE: QUEM OPERA O PRODUTO DECIDE A ESCRITA ──────────────────
//
// Decisão do Lucas (16/09/2026): no portal do Cecílio a reserva só vale no produto operado por ele
// (o Garden, 39); no VOC (37, operado pela Careli) é só consulta. A Gurgel (comercial) reserva como
// sempre, sem ir ao banco perguntar quem opera. E a reserva do Cecílio não avisa ninguém por WhatsApp.
//
// A régua de escrita (`operacao-do-produto-servidor.ts`) roda DE VERDADE: o que é trocado são as
// peças que tocam banco e cookie (cadastro, escopo, revalidação da conta, Supabase e o gateway).

type Linha = Record<string, unknown>;

const estado = vi.hoisted(() => ({
  avisados: 0,
  com0170: true,
  inseridos: [] as Array<{ linha: unknown; tabela: string }>,
  leuCadastroDeOperacao: 0,
  naoEnviados: 0,
  permitidos: ["37", "39"] as string[],
  revalidou: 0,
  sessao: {} as Record<string, unknown>,
  unidade: {} as Record<string, unknown>,
  atualizados: [] as Array<{ linha: unknown; tabela: string }>,
}));

const CECILIO = {
  incorporadorId: "inc-cecilio",
  slug: "cecilio-rocha",
  tipo: "incorporador",
  usuarioId: "u-cecilio",
  usuarioNome: "Maria do Cecílio",
};

const GURGEL = {
  incorporadorId: "inc-gurgel",
  slug: "gurgel",
  tipo: "comercial",
  usuarioId: "u-gurgel",
  usuarioNome: "Nivea",
};

const CADASTRO = [
  { c2xEnterpriseId: "35", codigo: "VLO", id: "vlo", nome: "Vale do Ouro", operadoPor: null, paiId: null },
  { c2xEnterpriseId: "37", codigo: "VOC", id: "voc", nome: "VOC", operadoPor: null, paiId: "vlo" },
  { c2xEnterpriseId: "39", codigo: "GDN", id: "gdn", nome: "Garden", operadoPor: "inc-cecilio", paiId: null },
];

vi.mock("@/lib/apolo/incorporador/board-do-portal", () => ({
  autorizarOperacaoDeVenda: () => ({ ok: true, sessao: estado.sessao }),
  autorizarPortalQueOperaSozinho: async (_request: Request, sessao: unknown) => {
    estado.revalidou += 1;
    return { ok: true, sessao };
  },
  ORIGEM_ACEITA_SEM_A_0167: "coordenador",
  origemDaReserva: (sessao: { tipo?: string }) =>
    sessao.tipo === "comercial" ? "coordenador" : "incorporador",
  origemRecusadaSemA0167: () => false,
}));

vi.mock("@/lib/apolo/incorporador/escopo", async () => {
  const { NextResponse } = await import("next/server");
  return {
    foraDoEscopo: () => NextResponse.json({ error: "Não encontrado." }, { status: 404 }),
    idsDaSessao: async () => estado.permitidos,
  };
});

vi.mock("@/lib/hercules/cadastro", () => ({
  carregarCadastroDeEmpreendimentos: async () => CADASTRO,
  lerCadastroDeEmpreendimentos: async () => {
    estado.leuCadastroDeOperacao += 1;
    return { com0170: estado.com0170, linhas: CADASTRO };
  },
}));

vi.mock("@/lib/hercules/quem-pode-vender", () => ({
  familiaDoEmpreendimento: (_cadastro: unknown, id: string) => [id],
  podemVender: async () => ({ ok: true }),
  quemPodeVender: async () => [],
}));

vi.mock("@/lib/hercules/avisos-da-venda", async () => {
  const { portalConfeccionaContrato } = await import("@/lib/apolo/incorporador/perfis-de-portal");
  return {
    avisarSobreAVenda: async () => {
      estado.avisados += 1;
      return [{ ok: true, para: "imobiliaria" }];
    },
    destinatariosDaVenda: async () => ({
      coordenadores: [],
      corretor: null,
      imobiliaria: { nome: "Imobiliária", telefone: null },
    }),
    registrarAvisoNaoEnviado: async () => {
      estado.naoEnviados += 1;
      return [];
    },
    // A régua de verdade é a de `avisos-da-venda.ts` (testada lá); aqui ela só é refeita sem o gateway.
    vendaAvisaPeloWhatsapp: (sessao: { slug?: null | string; tipo?: null | string }) =>
      !portalConfeccionaContrato(sessao.slug, sessao.tipo),
  };
});

vi.mock("@/lib/apolo/server", () => {
  const consulta = (tabela: string) => {
    let inserido = false;
    const resposta = (): { data: unknown; error: null } => {
      if (inserido) return { data: { id: "res-1", protocolo_numero: 7 }, error: null };
      if (tabela === "hercules_unidades") return { data: estado.unidade, error: null };
      if (tabela === "hercules_reservas") {
        return {
          data: {
            corretor_entity_id: null,
            empreendimento_id: "voc",
            id: "res-viva",
            imobiliaria_entity_id: "imo-1",
            proponentes: [{ nome: "Ana" }],
            protocolo_numero: 7,
            situacao: "ativa",
          },
          error: null,
        };
      }
      return { data: null, error: null };
    };
    const cadeia: Linha = {
      then: (ok: (r: unknown) => unknown, falha?: (e: unknown) => unknown) =>
        Promise.resolve(resposta()).then(ok, falha),
    };
    for (const metodo of ["eq", "in", "maybeSingle", "select"]) cadeia[metodo] = () => cadeia;
    cadeia.insert = (linha: unknown) => {
      inserido = true;
      estado.inseridos.push({ linha, tabela });
      return cadeia;
    };
    cadeia.update = (linha: unknown) => {
      estado.atualizados.push({ linha, tabela });
      return cadeia;
    };
    return cadeia;
  };
  return { createApoloAdminClient: () => ({ from: consulta }) };
});

import { PATCH, POST } from "./route";

const DAQUI_A_TRES_DIAS = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

const reservar = () =>
  POST(
    new Request("https://c2x.app.br/api/incorporador/venda/reserva", {
      body: JSON.stringify({
        imobiliariaEntityId: "imo-1",
        proponente: { cpf: "529.982.247-25", nome: "Maria da Silva", telefone: "62991234567" },
        unidadeId: "u-1",
        validadeEm: DAQUI_A_TRES_DIAS,
      }),
      method: "POST",
    }),
  );

const cancelar = () =>
  PATCH(
    new Request("https://c2x.app.br/api/incorporador/venda/reserva", {
      body: JSON.stringify({ motivo: "Cliente desistiu", unidadeId: "u-1" }),
      method: "PATCH",
    }),
  );

const unidadeEm = (enterpriseId: string, preco: null | string = "136521.00") => ({
  codigo: "VOC1206",
  enterprise_id: enterpriseId,
  id: "u-1",
  lote: "06",
  preco_tabela: preco,
  quadra: "12",
  situacao: "disponivel",
});

const reservasGravadas = () => estado.inseridos.filter((i) => i.tabela === "hercules_reservas");

beforeEach(() => {
  estado.avisados = 0;
  estado.atualizados = [];
  estado.com0170 = true;
  estado.inseridos = [];
  estado.leuCadastroDeOperacao = 0;
  estado.naoEnviados = 0;
  estado.permitidos = ["37", "39"];
  estado.revalidou = 0;
  estado.sessao = CECILIO;
  estado.unidade = unidadeEm("37");
});

describe("POST: a régua de quem opera o produto (D1)", () => {
  it("⚠️ Cecílio no VOC (37, operado pela Careli): 403 só consulta, e nada é gravado", async () => {
    const resposta = await reservar();
    expect(resposta.status).toBe(403);
    expect(await resposta.json()).toMatchObject({ soConsulta: true });
    expect(reservasGravadas()).toHaveLength(0);
    expect(estado.atualizados).toHaveLength(0);
  });

  it("Cecílio no Garden (39, operado por ele): grava, com a origem do portal", async () => {
    estado.unidade = unidadeEm("39");
    const resposta = await reservar();
    expect(resposta.status).toBe(200);
    expect(reservasGravadas()).toHaveLength(1);
    expect(reservasGravadas()[0]?.linha).toMatchObject({ criado_por: "u-cecilio", origem: "incorporador" });
    expect(estado.revalidou).toBe(1);
  });

  it("⚠️ a reserva do Cecílio não chama o WhatsApp: registra que o aviso não saiu", async () => {
    estado.unidade = unidadeEm("39");
    await reservar();
    expect(estado.avisados).toBe(0);
    expect(estado.naoEnviados).toBe(1);
  });

  it("a Gurgel (comercial) no VOC grava como sempre, sem ler quem opera e avisando os três", async () => {
    estado.sessao = GURGEL;
    const resposta = await reservar();
    expect(resposta.status).toBe(200);
    expect(reservasGravadas()).toHaveLength(1);
    expect(estado.leuCadastroDeOperacao).toBe(0);
    expect(estado.revalidou).toBe(0);
    expect(estado.avisados).toBe(1);
    expect(estado.naoEnviados).toBe(0);
  });

  it("sem a 0170 não dá para provar quem opera: 503, e o Garden também não grava", async () => {
    estado.com0170 = false;
    estado.unidade = unidadeEm("39");
    const resposta = await reservar();
    expect(resposta.status).toBe(503);
    expect(reservasGravadas()).toHaveLength(0);
  });
});

describe("POST: a guarda do preço de tabela", () => {
  it.each([null, "0", "1.00"])("preço %s: 409 e nada gravado", async (preco) => {
    estado.sessao = GURGEL;
    estado.unidade = unidadeEm("37", preco);
    const resposta = await reservar();
    expect(resposta.status).toBe(409);
    expect(((await resposta.json()) as { error: string }).error).toBe(
      "Esta unidade está sem preço de tabela e não pode ser reservada.",
    );
    expect(reservasGravadas()).toHaveLength(0);
  });
});

describe("PATCH: cancelar a reserva também é escrita", () => {
  it("⚠️ Cecílio no VOC: 403, e a reserva não é tocada", async () => {
    estado.unidade = { ...unidadeEm("37"), situacao: "reservada" };
    const resposta = await cancelar();
    expect(resposta.status).toBe(403);
    expect(estado.atualizados).toHaveLength(0);
  });

  it("Cecílio no Garden cancela, e o aviso do cancelamento também não sai", async () => {
    estado.unidade = { ...unidadeEm("39"), situacao: "reservada" };
    const resposta = await cancelar();
    expect(resposta.status).toBe(200);
    expect(estado.atualizados.some((a) => a.tabela === "hercules_reservas")).toBe(true);
    expect(estado.avisados).toBe(0);
    expect(estado.naoEnviados).toBe(1);
  });
});
