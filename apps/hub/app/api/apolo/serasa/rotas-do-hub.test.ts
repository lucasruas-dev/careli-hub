import { readFileSync } from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// AS ROTAS DE CRÉDITO DO HUB DEPOIS DA EXTRAÇÃO (16/09/2026): cascas finas, com os MESMOS portões.
//
// A regra saiu para `lib/serasa/*-servico.ts` para o portal que opera sozinho usar o mesmo código.
// O que não pode mudar no hub, travado aqui: consultar é da ESCRITA (admin, leader, operator) nos dois
// verbos, aprovar com restrição é só da COORDENAÇÃO, o portão responde antes de qualquer serviço, e o
// serviço recebe o autor do hub com o papel da porta. As respostas do serviço (status, corpo e o
// no-store do GET) saem como vieram. O comportamento do serviço para o hub é testado em lib/serasa.
//
// (revisão de 16/09/2026) O nome do autor do hub vai null: o serviço não usa o nome do hub, e ler
// `auth.nome` amarrava as cascas à mudança de `lib/apolo/auth.ts` de outra onda, ainda fora do git.
//
// (16/09/2026, D9) Com `forcar`, a casca pergunta à porta da coordenação e manda o papel ao serviço:
// só a coordenação cobra nova consulta dentro de 30 dias.

const m = vi.hoisted(() => ({
  aprovar: vi.fn(async () => ({ corpo: { data: { ok: true } }, status: 200 })),
  consultar: vi.fn(async () => ({ corpo: { error: "x" }, status: 428 })),
  coordenacao: vi.fn(),
  escrita: vi.fn(),
  situacao: vi.fn(async () => ({
    corpo: { data: { configurado: true } },
    headers: { "Cache-Control": "no-store" },
    status: 200,
  })),
}));

vi.mock("@/lib/apolo/auth", () => ({
  authorizeApoloCoordenacao: m.coordenacao,
  authorizeApoloWrite: m.escrita,
}));
vi.mock("@/lib/apolo/server", () => ({ createApoloAdminClient: () => ({ cliente: "admin" }) }));
vi.mock("@/lib/serasa/consulta-servico", async (original) => ({
  // A régua de quem força (`podeForcarNovaConsulta`) e o recado são os de verdade; só a consulta e
  // a situação (banco e Serasa) são trocadas.
  ...(await original<typeof import("@/lib/serasa/consulta-servico")>()),
  consultarCredito: m.consultar,
  situacaoDoCredito: m.situacao,
}));
vi.mock("@/lib/serasa/aprovar-restricao-servico", () => ({ aprovarComRestricao: m.aprovar }));

import {
  type AutorDoCredito,
  type CorpoDaConsulta,
  MENSAGEM_SO_COORDENACAO_FORCA,
  podeForcarNovaConsulta,
} from "@/lib/serasa/consulta-servico";

import { POST as aprovar } from "./aprovar-restricao/route";
import { GET, POST } from "./consultar/route";

const USER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ok = { nome: "Cinthia", ok: true, userId: USER };
const negado = () => ({
  ok: false,
  response: NextResponse.json({ error: "Usuario sem acesso ao Apolo." }, { status: 403 }),
});

beforeEach(() => {
  for (const mock of Object.values(m)) mock.mockClear();
  m.escrita.mockResolvedValue(ok);
  m.coordenacao.mockResolvedValue(ok);
});

describe("/api/apolo/serasa/consultar", () => {
  it("GET: portão de escrita, autor do hub e a query como sempre (entityId e enterpriseId)", async () => {
    const r = await GET(
      new Request("https://c2x.app.br/api/apolo/serasa/consultar?entityId=abc&enterpriseId=37"),
    );
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    expect(m.situacao).toHaveBeenCalledWith({
      autor: { nome: null, papel: "escrita", tipo: "hub", userId: USER },
      client: { cliente: "admin" },
      enterpriseId: "37",
      entityId: "abc",
    });
  });

  it("POST: o corpo vai inteiro para o serviço, e a resposta volta como veio", async () => {
    const corpo = { confirmado: false, entityId: "abc", reportName: "R" };
    const r = await POST(
      new Request("https://c2x.app.br/api/apolo/serasa/consultar", {
        body: JSON.stringify(corpo),
        method: "POST",
      }),
    );
    expect(r.status).toBe(428);
    expect(await r.json()).toEqual({ error: "x" });
    expect(m.consultar).toHaveBeenCalledWith({
      autor: { nome: null, papel: "escrita", tipo: "hub", userId: USER },
      client: { cliente: "admin" },
      corpo,
    });
    // Sem `forcar`, a porta da coordenação nem é consultada (nenhuma ida extra ao banco).
    expect(m.coordenacao).not.toHaveBeenCalled();
  });

  // (16/09/2026, D9) Decisão do Lucas: no hub, só a coordenação força nova consulta em 30 dias. A
  // consulta falsa abaixo aplica a régua DE VERDADE (`podeForcarNovaConsulta`) sobre o autor que a
  // rota montou; o serviço completo (a guardada, o recado e o veredito do cônjuge) é testado em
  // lib/serasa/consulta-servico.test.ts.
  describe("forcar dentro da janela", () => {
    const GUARDADA = { id: "consulta-velha", resumo: { score: 580 } };
    const consultaComJanela = async (input: { autor: AutorDoCredito; corpo: CorpoDaConsulta }) =>
      input.corpo.forcar && podeForcarNovaConsulta(input.autor)
        ? { corpo: { data: { reaproveitada: false } }, status: 200 }
        : {
            corpo: {
              data: {
                consultaAnterior: GUARDADA,
                forcarRecusado: true,
                mensagem: MENSAGEM_SO_COORDENACAO_FORCA,
                reaproveitada: true,
              },
            },
            status: 200,
          };

    const pedirDeNovo = () =>
      POST(
        new Request("https://c2x.app.br/api/apolo/serasa/consultar", {
          body: JSON.stringify({ confirmado: true, entityId: "abc", forcar: true }),
          method: "POST",
        }),
      );

    it("analista (operator) com forcar: recebe a guardada com o recado, sem cobrança", async () => {
      m.consultar.mockImplementation(consultaComJanela as never);
      m.coordenacao.mockResolvedValue(negado());

      const r = await pedirDeNovo();
      const corpo = (await r.json()) as { data: Record<string, unknown> };

      expect(m.coordenacao).toHaveBeenCalledTimes(1);
      expect((m.consultar.mock.calls[0] as unknown as [{ autor: AutorDoCredito }])[0].autor).toEqual({
        nome: null,
        papel: "escrita",
        tipo: "hub",
        userId: USER,
      });
      expect(corpo.data).toEqual({
        consultaAnterior: GUARDADA,
        forcarRecusado: true,
        mensagem: "Só a coordenação pode pedir uma nova consulta dentro de 30 dias.",
        reaproveitada: true,
      });
    });

    it("coordenação (leader) com forcar: o serviço recebe o papel da coordenação e cobra de novo", async () => {
      m.consultar.mockImplementation(consultaComJanela as never);
      m.coordenacao.mockResolvedValue(ok);

      const r = await pedirDeNovo();
      const corpo = (await r.json()) as { data: Record<string, unknown> };

      expect((m.consultar.mock.calls[0] as unknown as [{ autor: AutorDoCredito }])[0].autor).toEqual({
        nome: null,
        papel: "coordenacao",
        tipo: "hub",
        userId: USER,
      });
      expect(corpo.data).toEqual({ reaproveitada: false });
    });

    it("a porta da coordenação que falha vira escrita: na dúvida, não cobra", async () => {
      m.consultar.mockImplementation(consultaComJanela as never);
      m.coordenacao.mockRejectedValue(new Error("hub_users fora do ar"));

      const r = await pedirDeNovo();
      const corpo = (await r.json()) as { data: Record<string, unknown> };

      expect(r.status).toBe(200);
      expect(corpo.data.forcarRecusado).toBe(true);
    });
  });

  it("sem acesso: a resposta do portão, sem serviço", async () => {
    m.escrita.mockResolvedValue(negado());
    const r = await POST(new Request("https://c2x.app.br/x", { body: "{}", method: "POST" }));
    expect(r.status).toBe(403);
    expect(m.consultar).not.toHaveBeenCalled();
    expect((await GET(new Request("https://c2x.app.br/x?entityId=a"))).status).toBe(403);
    expect(m.situacao).not.toHaveBeenCalled();
    expect(m.coordenacao).not.toHaveBeenCalled();
  });
});

describe("/api/apolo/serasa/aprovar-restricao", () => {
  it("só a coordenação: o portão é o da coordenação, e não o de escrita", async () => {
    const r = await aprovar(
      new Request("https://c2x.app.br/x", { body: JSON.stringify({ entityId: "abc" }), method: "POST" }),
    );
    expect(r.status).toBe(200);
    expect(m.coordenacao).toHaveBeenCalledTimes(1);
    expect(m.escrita).not.toHaveBeenCalled();
    expect(m.aprovar).toHaveBeenCalledWith({
      autor: { nome: null, papel: "coordenacao", tipo: "hub", userId: USER },
      client: { cliente: "admin" },
      corpo: { entityId: "abc" },
    });
  });

  it("analista (sem coordenação): a resposta do portão, sem serviço", async () => {
    m.coordenacao.mockResolvedValue(negado());
    const r = await aprovar(new Request("https://c2x.app.br/x", { body: "{}", method: "POST" }));
    expect(r.status).toBe(403);
    expect(m.aprovar).not.toHaveBeenCalled();
  });
});

describe("as cascas não dependem de `auth.nome`", () => {
  it("nenhuma das duas rotas lê o nome da porta do hub", () => {
    for (const rota of ["consultar/route.ts", "aprovar-restricao/route.ts"]) {
      const texto = readFileSync(path.join(__dirname, rota), "utf8");
      // O comentário da rota cita `auth.nome` para explicar; o que não pode é o código usar.
      expect(texto).not.toMatch(/[:=(,]\s*auth\.nome/);
    }
  });
});
