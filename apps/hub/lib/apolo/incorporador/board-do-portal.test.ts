import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  autorDoCreditoNoPortal,
  autorizarOperacaoDeVenda,
  autorizarPortalQueOperaSozinho,
  cadNoEscopo,
  ORIGEM_ACEITA_SEM_A_0167,
  origemDaReserva,
  origemDoAutorNoPortal,
  origemRecusadaSemA0167,
} from "./board-do-portal";
import { criarSessaoIncorporador, INCORPORADOR_COOKIE, type SessaoIncorporador } from "./sessao";

// A revalidação da conta (a porta da Têmis do portal) lê o banco; aqui só importa SE ela é chamada.
const portaoDaTemis = vi.hoisted(() => ({ autorizar: vi.fn() }));
vi.mock("@/lib/temis/portao-do-portal", () => ({ autorizarTemisDoPortal: portaoDaTemis.autorizar }));

// O PORTÃO DA VENDA NO SERVIDOR, com COOKIE ASSINADO DE VERDADE.
//
// Lucas (16/09/2026): o portal do Cecílio vira réplica do /comercial/gurgel, *"a Cecilio quem vai
// fazer é o proprio time deles"*. As rotas de venda e de board, que eram só do comercial, passam a
// aceitar também o incorporador da lista explícita (`portalOperaVenda`). O que este arquivo trava:
//   • o Cecílio PASSA (senão a tela acende o botão e o servidor responde 404);
//   • o cer, o vistaalegre e qualquer outro incorporador continuam no 404 de antes (o furo que a
//     porta fechou já foi pago em produção: incorporador cancelando proposta do comercial por HTTP);
//   • nenhuma rota de board/venda volta para `autorizar` ou para o portão antigo.
//
// ⚠️ SEM MOCK DA SESSÃO. Um mock de `autorizar` provaria só o mock; aqui o token é emitido e lido
// pelo mesmo código que roda em produção, e o slug viaja DENTRO da assinatura, como no login.

const SEGREDO = "segredo-de-teste-do-portao-da-venda";

beforeAll(() => {
  vi.stubEnv("SESSAO_INCORPORADOR_SECRET", SEGREDO);
});

afterAll(() => {
  vi.unstubAllEnvs();
});

function pedidoCom(dados: Pick<SessaoIncorporador, "slug" | "tipo">): Request {
  const token = criarSessaoIncorporador(
    {
      enterpriseIds: ["37", "39"],
      enterpriseIdsComCarteira: ["37", "39"],
      incorporadorId: "inc-1",
      incorporadorNome: "Portal de teste",
      slug: dados.slug,
      tipo: dados.tipo,
      usuarioId: "usr-1",
      usuarioNome: "Pessoa de teste",
    },
    Date.now(),
  );
  return new Request("https://c2x.app.br/api/incorporador/venda", {
    headers: { cookie: `${INCORPORADOR_COOKIE}=${token}` },
  });
}

describe("autorizarOperacaoDeVenda", () => {
  it("sem cookie: 401, antes de qualquer pergunta sobre o portal", async () => {
    const auth = autorizarOperacaoDeVenda(new Request("https://c2x.app.br/api/incorporador/venda"));
    expect(auth.ok).toBe(false);
    if (!auth.ok) expect(auth.response.status).toBe(401);
  });

  it("cookie adulterado: 401 (a assinatura não fecha)", () => {
    const pedido = pedidoCom({ slug: "cer", tipo: "incorporador" });
    const cookie = pedido.headers.get("cookie") ?? "";
    const adulterado = new Request("https://c2x.app.br/api/incorporador/venda", {
      headers: { cookie: `${cookie}x` },
    });
    const auth = autorizarOperacaoDeVenda(adulterado);
    expect(auth.ok).toBe(false);
    if (!auth.ok) expect(auth.response.status).toBe(401);
  });

  it("portal comercial: passa", () => {
    const auth = autorizarOperacaoDeVenda(pedidoCom({ slug: "gurgel", tipo: "comercial" }));
    expect(auth.ok).toBe(true);
    if (auth.ok) expect(auth.sessao.slug).toBe("gurgel");
  });

  it("cecilio-rocha (incorporador que opera a própria venda): passa", () => {
    const auth = autorizarOperacaoDeVenda(pedidoCom({ slug: "cecilio-rocha", tipo: "incorporador" }));
    expect(auth.ok).toBe(true);
    if (auth.ok) {
      expect(auth.sessao.slug).toBe("cecilio-rocha");
      expect(auth.sessao.tipo).toBe("incorporador");
    }
  });

  for (const slug of ["cer", "vistaalegre", "lagoabonita", "valedoouro", "mmendes"]) {
    it(`${slug} (incorporador que só lê): continua 404 "Nao encontrado."`, async () => {
      const auth = autorizarOperacaoDeVenda(pedidoCom({ slug, tipo: "incorporador" }));
      expect(auth.ok).toBe(false);
      if (!auth.ok) {
        expect(auth.response.status).toBe(404);
        expect(await auth.response.json()).toEqual({ error: "Nao encontrado." });
      }
    });
  }

  it("o 404 do incorporador é IDÊNTICO ao de produto fora do escopo (sem oráculo)", async () => {
    const auth = autorizarOperacaoDeVenda(pedidoCom({ slug: "cer", tipo: "incorporador" }));
    expect(auth.ok).toBe(false);
    if (!auth.ok) {
      const { foraDoEscopo } = await import("./escopo");
      const referencia = foraDoEscopo();
      expect(auth.response.status).toBe(referencia.status);
      expect(await auth.response.json()).toEqual(await referencia.json());
    }
  });

  it("slug parecido não passa: a lista é exata", () => {
    for (const slug of ["cecilio", "cecilio-rocha-2", "cecílio-rocha"]) {
      const auth = autorizarOperacaoDeVenda(pedidoCom({ slug, tipo: "incorporador" }));
      expect(auth.ok).toBe(false);
    }
  });
});

// O CRÉDITO E AS ETAPAS DE DECISÃO NO PORTAL (16/09/2026): só quem opera SOZINHO. Decisão do Lucas:
// a Cecílio faz a análise de crédito e o credenciamento no portal; a Gurgel (comercial) não, porque o
// crédito das vendas dela continua com a Careli; os incorporadores padrão nem sabem do Serasa.
describe("autorizarPortalQueOperaSozinho", () => {
  const vigente = { enterpriseIds: ["37"], slug: "cecilio-rocha", tipo: "incorporador" };

  it("comercial (Gurgel) e padrão (cer): 404 sem revalidar conta (sem ida ao banco)", async () => {
    portaoDaTemis.autorizar.mockReset();
    for (const sessao of [
      { slug: "gurgel", tipo: "comercial" as const },
      { slug: "cer", tipo: "incorporador" as const },
      // O slug do Cecílio num portal COMERCIAL continua sendo comercial: não confecciona.
      { slug: "cecilio-rocha", tipo: "comercial" as const },
    ]) {
      const auth = await autorizarPortalQueOperaSozinho(new Request("https://c2x.app.br/x"), sessao);
      expect(auth.ok).toBe(false);
      if (!auth.ok) {
        expect(auth.response.status).toBe(404);
        expect(await auth.response.json()).toEqual({ error: "Nao encontrado." });
      }
    }
    expect(portaoDaTemis.autorizar).not.toHaveBeenCalled();
  });

  it("Cecílio: passa pela revalidação e devolve a sessão VIGENTE", async () => {
    portaoDaTemis.autorizar.mockReset();
    portaoDaTemis.autorizar.mockResolvedValue({ ator: {}, ok: true, sessao: vigente });
    const auth = await autorizarPortalQueOperaSozinho(new Request("https://c2x.app.br/x"), {
      slug: "cecilio-rocha",
      tipo: "incorporador",
    });
    expect(portaoDaTemis.autorizar).toHaveBeenCalledTimes(1);
    expect(auth.ok && auth.sessao).toBe(vigente);
  });

  it("Cecílio com a conta que não dá para conferir: a resposta da revalidação (503) volta", async () => {
    portaoDaTemis.autorizar.mockReset();
    portaoDaTemis.autorizar.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "x" }), { status: 503 }),
    });
    const auth = await autorizarPortalQueOperaSozinho(new Request("https://c2x.app.br/x"), {
      slug: "cecilio-rocha",
      tipo: "incorporador",
    });
    expect(auth.ok).toBe(false);
    if (!auth.ok) expect(auth.response.status).toBe(503);
  });

  it("o autor do crédito leva nome, slug, incorporador e conta do portal", () => {
    expect(
      autorDoCreditoNoPortal({
        incorporadorId: "inc-1",
        slug: "cecilio-rocha",
        usuarioId: "usr-1",
        usuarioNome: "Maria",
      }),
    ).toEqual({ incorporadorId: "inc-1", nome: "Maria", slug: "cecilio-rocha", tipo: "portal", usuarioId: "usr-1" });
  });

  it("as rotas de crédito do portal passam pelas DUAS portas, nesta ordem", () => {
    for (const rota of ["consultar", "aprovar-restricao"]) {
      const texto = readFileSync(join(API, "board", "[id]", "serasa", rota, "route.ts"), "utf8");
      const venda = texto.indexOf("autorizarOperacaoDeVenda(request)");
      const sozinho = texto.indexOf("autorizarPortalQueOperaSozinho(request, auth.sessao)");
      const escopo = texto.indexOf("cadNoEscopo(");
      expect(venda).toBeGreaterThan(-1);
      expect(sozinho).toBeGreaterThan(venda);
      expect(escopo).toBeGreaterThan(sozinho);
    }
  });
});

describe("origemDaReserva", () => {
  it("comercial grava 'coordenador', como sempre gravou", () => {
    expect(origemDaReserva({ tipo: "comercial" })).toBe("coordenador");
  });

  it("incorporador que opera a venda grava 'incorporador' (CHECK ampliada pela 0167)", () => {
    expect(origemDaReserva({ tipo: "incorporador" })).toBe("incorporador");
  });
});

describe("origemDoAutorNoPortal (auditoria do board)", () => {
  it("comercial continua 'portal-comercial'; o incorporador que opera a venda ganha o próprio rótulo", () => {
    expect(origemDoAutorNoPortal({ tipo: "comercial" })).toBe("portal-comercial");
    expect(origemDoAutorNoPortal({ tipo: "incorporador" })).toBe("portal-incorporador");
  });

  it("a rota de etapa grava pela sessão, e não cravado", () => {
    const texto = readFileSync(join(API, "board", "[id]", "etapa", "route.ts"), "utf8");
    expect(texto).toContain("origem: origemDoAutorNoPortal(auth.sessao)");
    expect(texto).not.toMatch(/origem:\s*"portal-comercial"/);
  });
});

describe("origemRecusadaSemA0167 (a rede da ordem de deploy)", () => {
  const recusaDaCheck = {
    code: "23514",
    message:
      'new row for relation "hercules_reservas" violates check constraint "hercules_reservas_origem"',
  };

  it("reconhece a CHECK da origem recusando 'incorporador'", () => {
    expect(origemRecusadaSemA0167(recusaDaCheck, "incorporador")).toBe(true);
    expect(ORIGEM_ACEITA_SEM_A_0167).toBe("coordenador");
  });

  it("não engole outra CHECK, outro código nem a origem do comercial", () => {
    expect(
      origemRecusadaSemA0167({ code: "23514", message: "violates check constraint \"outra\"" }, "incorporador"),
    ).toBe(false);
    expect(origemRecusadaSemA0167({ ...recusaDaCheck, code: "23505" }, "incorporador")).toBe(false);
    expect(origemRecusadaSemA0167(recusaDaCheck, "coordenador")).toBe(false);
    expect(origemRecusadaSemA0167(null, "incorporador")).toBe(false);
  });
});

// A PORTA DA IMOBILIÁRIA EM `cadNoEscopo` (revisão de 16/09/2026): com `enterpriseId: null` a ficha
// cai no default "CAD mais recente". Imobiliária que tenha CAD em outro produto não pode entrar por
// ela, senão o portal lê e grava a CAD de outro loteamento.
describe("cadNoEscopo: a porta da imobiliária", () => {
  const ENTIDADE = "11111111-2222-4333-8444-555555555555";

  function clienteFalso(opts: { esteiraFora: string[] }) {
    const from = (tabela: string) => {
      let filtraRecorte = false;
      const resultado = () => {
        if (tabela === "apolo_esteira") {
          // A primeira leitura (com `.in` do recorte) nunca acha; a segunda (sem recorte) acha a de fora.
          return {
            data: filtraRecorte ? [] : opts.esteiraFora.map((id) => ({ enterprise_id: id })),
            error: null,
          };
        }
        if (tabela === "apolo_entity_profiles") return { data: { entity_id: ENTIDADE }, error: null };
        if (tabela === "apolo_relationships") {
          return { data: [{ metadata: { enterpriseId: "39" } }], error: null };
        }
        return { data: null, error: null };
      };
      const cadeia = {
        eq: () => cadeia,
        in: () => {
          filtraRecorte = true;
          return cadeia;
        },
        limit: () => Promise.resolve(resultado()),
        maybeSingle: () => Promise.resolve(resultado()),
        order: () => cadeia,
        select: () => cadeia,
      };
      return cadeia;
    };
    return { from } as unknown as Parameters<typeof cadNoEscopo>[0];
  }

  const recorte = {
    ids: new Set(["39"]),
    nomes: ["Garden"],
    sessao: { tipo: "incorporador" } as SessaoIncorporador,
  };

  it("imobiliária sem CAD nenhuma, com vínculo no recorte: entra com enterpriseId nulo", async () => {
    const escopo = await cadNoEscopo(clienteFalso({ esteiraFora: [] }), ENTIDADE, recorte);
    expect(escopo.ok && escopo.escopo).toEqual({ enterpriseId: null, imobiliaria: true });
  });

  it("imobiliária que tem CAD em outro produto: 404, nunca a CAD de fora pelo default", async () => {
    const escopo = await cadNoEscopo(clienteFalso({ esteiraFora: ["33"] }), ENTIDADE, recorte);
    expect(escopo.ok).toBe(false);
  });
});

// A VARREDURA DAS ROTAS. Trocar o portão rota a rota é como nasce a porta esquecida: a de board
// aberta e a de venda fechada, ou uma rota nova copiada de um arquivo antigo com `autorizar`.
const API = join(__dirname, "../../../app/api/incorporador");

function rotasEm(pasta: string): string[] {
  const achadas: string[] = [];
  for (const nome of readdirSync(pasta)) {
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) achadas.push(...rotasEm(caminho));
    else if (nome === "route.ts") achadas.push(caminho);
  }
  return achadas;
}

describe("as rotas de board e venda", () => {
  const rotas = [...rotasEm(join(API, "board")), ...rotasEm(join(API, "venda"))];

  it("existem (a varredura não passa por estar olhando a pasta errada)", () => {
    expect(rotas.length).toBeGreaterThanOrEqual(19);
  });

  for (const rota of rotas) {
    const relativa = rota.slice(API.length + 1).replace(/\\/g, "/");
    it(`${relativa}: passa por autorizarOperacaoDeVenda e por nenhuma porta mais larga`, () => {
      const texto = readFileSync(rota, "utf8");
      expect(texto).toContain("autorizarOperacaoDeVenda(request)");
      expect(texto).not.toMatch(/\bautorizar\(request\)/);
      expect(texto).not.toMatch(/\bsessaoDoRequest\(/);
      expect(texto).not.toContain("autorizarComercial");
    });
  }

  it("contratos usa a MESMA régua (portalOperaVenda), e não mais ehPortalComercial", () => {
    const texto = readFileSync(join(API, "contratos", "route.ts"), "utf8");
    expect(texto).toContain("portalOperaVenda(sessao.slug, sessao.tipo)");
    expect(texto).not.toContain("ehPortalComercial");
  });
});
