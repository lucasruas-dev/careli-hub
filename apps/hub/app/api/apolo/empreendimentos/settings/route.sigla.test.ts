import { beforeEach, describe, expect, it, vi } from "vitest";

// O CLIQUE NA TELA NÃO REGRAVA MAIS A SIGLA DO EMPREENDIMENTO (Lucas, 24/09/2026: "pode" para travar
// as portas por onde o C2X ainda mexe no Panteon).
//
// A tela do Apolo manda `code` em todo POST/PATCH de settings e de política, e esse `code` é a sigla
// que o C2X mostra NA HORA. As rotas repassavam; o toggle de credenciamento ainda zerava a sigla
// quando a chamada vinha sem ela. Aqui o corpo traz `code: "XYZ"` de propósito: a sigla gravada tem
// de continuar sendo a do cadastro do Panteon.

type Linha = Record<string, unknown>;

const m = vi.hoisted(() => ({
  admin: vi.fn(),
  escrita: vi.fn(),
  leitura: vi.fn(),
  varrer: vi.fn(),
}));

vi.mock("@/lib/apolo/auth", () => ({ authorizeApoloRead: m.leitura, authorizeApoloWrite: m.escrita }));
vi.mock("@/lib/apolo/server", () => ({ createApoloAdminClient: m.admin }));
vi.mock("@/lib/apolo/prevenda-varredura", () => ({ varrerPrevendaDesligada: m.varrer }));
// A política importa a leitura do C2X para o GET; o PATCH não usa.
vi.mock("@/lib/apolo/politica-comercial", () => ({ loadPoliticaComercial: vi.fn() }));

import { PATCH as PATCH_POLITICA } from "../politica/route";
import { PATCH, POST } from "./route";

// Banco em memória com o encadeamento que os setters usam (ver enterprise-settings.sigla.test.ts).
function bancoFake(settings: Linha[], cadastro: Linha[]) {
  const tabelas: Record<string, Linha[]> = {
    apolo_enterprise_settings: settings.map((l) => ({ ...l })),
    hercules_empreendimentos: cadastro.map((l) => ({ ...l })),
  };
  const client = {
    from(tabela: string) {
      const filtros: Array<[string, unknown]> = [];
      let patch: Linha | null = null;
      const linhas = (tabelas[tabela] ??= []);
      const casam = () => linhas.filter((l) => filtros.every(([c, v]) => l[c] === v));
      const executar = () => {
        if (patch) {
          for (const l of casam()) Object.assign(l, patch);
          return { data: null, error: null };
        }
        return { data: casam().map((l) => ({ ...l })), error: null };
      };
      const builder = {
        eq(c: string, v: unknown) {
          filtros.push([c, v]);
          return builder;
        },
        insert(l: Linha) {
          linhas.push({ ...l });
          return Promise.resolve({ data: null, error: null });
        },
        limit: () => builder,
        maybeSingle: () => {
          const r = executar();
          return Promise.resolve({ data: (r.data as Linha[] | null)?.[0] ?? null, error: null });
        },
        select: () => builder,
        then: (r: (x: unknown) => unknown, j?: (e: unknown) => unknown) => Promise.resolve(executar()).then(r, j),
        update(p: Linha) {
          patch = p;
          return builder;
        },
        upsert(l: Linha, o?: { onConflict?: string }) {
          const k = o?.onConflict ?? "id";
          const atual = linhas.find((x) => x[k] === l[k]);
          if (atual) Object.assign(atual, l);
          else linhas.push({ ...l });
          return Promise.resolve({ data: null, error: null });
        },
      };
      return builder;
    },
  };
  return { client, settings: (id: string) => tabelas.apolo_enterprise_settings?.find((l) => l.enterprise_id === id) };
}

const CADASTRO: Linha[] = [
  { c2x_enterprise_id: "43", codigo: "PDI", workspace_id: "careli" },
  { c2x_enterprise_id: "33", codigo: "LBF", workspace_id: "careli" },
  { c2x_enterprise_id: "27", codigo: "LBR", workspace_id: "careli" },
];

let banco: ReturnType<typeof bancoFake>;

const pedir = (metodo: "PATCH" | "POST", corpo: unknown) =>
  new Request("https://c2x.app.br/api/apolo/empreendimentos/settings", {
    body: JSON.stringify(corpo),
    headers: { authorization: "Bearer x", "content-type": "application/json" },
    method: metodo,
  });

beforeEach(() => {
  banco = bancoFake(
    [
      { code: "PDI", credenciamento_ativo: true, enterprise_id: "43", recepcao_imobiliaria: true },
      { code: "ADT", credenciamento_ativo: false, enterprise_id: "30" },
    ],
    CADASTRO,
  );
  for (const mock of Object.values(m)) mock.mockReset();
  m.escrita.mockResolvedValue({ ok: true, userId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" });
  m.admin.mockImplementation(() => banco.client);
});

describe("POST /api/apolo/empreendimentos/settings (toggle Recebendo CAD)", () => {
  it("clicar com code 'XYZ' no corpo não muda a sigla gravada", async () => {
    const resposta = await POST(pedir("POST", { ativo: false, code: "XYZ", enterpriseId: "43" }));

    expect(resposta.status).toBe(200);
    expect(banco.settings("43")).toMatchObject({ code: "PDI", credenciamento_ativo: false });
  });

  it("clicar SEM code não zera a sigla", async () => {
    const resposta = await POST(pedir("POST", { ativo: true, enterpriseId: "30" }));

    expect(resposta.status).toBe(200);
    expect(banco.settings("30")).toMatchObject({ code: "ADT", credenciamento_ativo: true });
  });
});

describe("PATCH /api/apolo/empreendimentos/settings (sub-etapas)", () => {
  it("o portão de imobiliária com code 'XYZ' no corpo não muda a sigla gravada", async () => {
    const resposta = await PATCH(
      pedir("PATCH", { code: "XYZ", enterpriseId: "43", recepcaoImobiliaria: false }),
    );

    expect(resposta.status).toBe(200);
    expect(banco.settings("43")).toMatchObject({ code: "PDI", recepcao_imobiliaria: false });
  });
});

describe("PATCH /api/apolo/empreendimentos/politica (várias divisões numa chamada)", () => {
  it("cada divisão nova nasce com a PRÓPRIA sigla do cadastro, e não com a que a tela mandou", async () => {
    // A tela manda a sigla da primeira divisão para todas; antes a LBR nascia "LBF".
    const resposta = await PATCH_POLITICA(
      new Request("https://c2x.app.br/api/apolo/empreendimentos/politica", {
        body: JSON.stringify({ code: "LBF", enterpriseIds: ["33", "27"], gestaoCarteiraPercentual: 97 }),
        headers: { authorization: "Bearer x", "content-type": "application/json" },
        method: "PATCH",
      }),
    );

    expect(resposta.status).toBe(200);
    expect(banco.settings("33")).toMatchObject({ code: "LBF", gestao_carteira_percentual: 97 });
    expect(banco.settings("27")).toMatchObject({ code: "LBR", gestao_carteira_percentual: 97 });
  });
});
