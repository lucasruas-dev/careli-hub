import { beforeEach, describe, expect, it, vi } from "vitest";

// A TRAVA DO "EXCLUIR" DO VÍNCULO DE EMPREENDIMENTO (24/09/2026), com o banco FALSO em memória.
//
// Foi por esta rota que a CAD do JONATAS ficou no produto errado: o time arquivou o vínculo do
// Veredas do Ouro (19), criou o do Vale do Ouro (35), e a CAD continuou no 19. O que este arquivo trava:
//   • arquivar o vínculo de empreendimento de quem tem CAD naquele produto dá 409 com a frase que
//     aponta o Mover CAD, e NADA é arquivado;
//   • a comparação é pela régua de mercado: CAD em "group:Vale do Ouro" com vínculo no 37 (divisão)
//     é o mesmo produto;
//   • quem decide é a EXISTÊNCIA da CAD, não o perfil (revisão de 24/09/2026): a imobiliária que
//     também tem CAD de cliente trava igual; a imobiliária sem CAD (o vínculo é o credenciamento dela)
//     segue livre;
//   • a frase do 409 diz que é a COORDENAÇÃO quem move (a rota aceita o analista, o botão não);
//   • vínculo de outro produto, vínculo duplicado do mesmo produto e vínculo que não é de
//     empreendimento seguem livres;
//   • leitura que falha não vira "pode arquivar": 503.

const m = vi.hoisted(() => ({ banco: null as unknown }));

vi.mock("@/lib/apolo/auth", () => ({
  authorizeApoloWrite: vi.fn(async () => ({ nome: null, ok: true, userId: "u-1" })),
}));
vi.mock("@/lib/apolo/server", () => ({ createApoloAdminClient: () => m.banco }));

import { POST } from "./route";

type Linha = Record<string, unknown>;
type Filtro = [coluna: string, op: string, valor: unknown];

function bancoFalso(tabelas: Record<string, Linha[]>, falhas: Record<string, Linha> = {}) {
  const escritas: Array<{ op: string; tabela: string }> = [];
  const client = {
    from(tabela: string) {
      const q = { de: 0, filtros: [] as Filtro[], limite: Infinity, op: "select", valores: {} as Linha };
      const casa = (linha: Linha) =>
        q.filtros.every(([coluna, op, valor]) => {
          const v = linha[coluna];
          if (op === "eq") return String(v ?? "") === String(valor);
          if (op === "neq") return String(v ?? "") !== String(valor);
          if (op === "is") return v === null || v === undefined;
          return true;
        });
      const executar = () => {
        const falha = falhas[`${tabela}:${q.op}`];
        if (falha) return { data: null, error: falha };
        const linhas = (tabelas[tabela] ??= []);
        if (q.op === "insert") {
          escritas.push({ op: "insert", tabela });
          linhas.push({ ...q.valores });
          return { data: null, error: null };
        }
        const alvo = linhas.filter(casa);
        if (q.op === "update") {
          escritas.push({ op: "update", tabela });
          for (const linha of alvo) Object.assign(linha, q.valores);
          return { data: null, error: null };
        }
        return { data: alvo.slice(q.de, q.de + q.limite).map((l) => ({ ...l })), error: null };
      };
      const cadeia: Record<string, unknown> = {};
      const filtro = (op: string) => (coluna: string, valor?: unknown) => {
        q.filtros.push([coluna, op, valor]);
        return cadeia;
      };
      Object.assign(cadeia, {
        eq: filtro("eq"),
        insert: (valores: Linha) => {
          q.op = "insert";
          q.valores = valores;
          return cadeia;
        },
        is: filtro("is"),
        limit: (n: number) => {
          q.limite = n;
          return cadeia;
        },
        neq: filtro("neq"),
        order: () => cadeia,
        range: (de: number, ate: number) => {
          q.de = de;
          q.limite = ate - de + 1;
          return cadeia;
        },
        returns: () => cadeia,
        select: () => cadeia,
        then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) =>
          Promise.resolve(executar()).then(ok, erro),
        update: (valores: Linha) => {
          q.op = "update";
          q.valores = valores;
          return cadeia;
        },
      });
      return cadeia;
    },
  };
  return { client, escritas, tabelas };
}

const PESSOA = "c34d4b6c-ac71-43ca-b7c2-6a7ec7f69c29";

const HERCULES: Linha[] = [
  { c2x_enterprise_id: "35", codigo: "VLO", id: "h-vlo", nome: "Vale do Ouro", pai_id: null },
  { c2x_enterprise_id: "37", codigo: "VOC", id: "h-voc", nome: "Vale do Ouro · VOC", pai_id: "h-vlo" },
  { c2x_enterprise_id: "36", codigo: "VOL", id: "h-vol", nome: "Vale do Ouro · VOL", pai_id: "h-vlo" },
  { c2x_enterprise_id: "41", codigo: "VOR", id: "h-vor", nome: "Vale do Ouro · VOR", pai_id: "h-vlo" },
  { c2x_enterprise_id: "19", codigo: "VDO", id: "h-vdo", nome: "Veredas do Ouro", pai_id: null },
].map((l) => ({ ...l, workspace_id: "careli" }));

const vinculo = (id: string, enterpriseId: string, label: string): Linha => ({
  entity_id: PESSOA,
  id,
  label,
  metadata: { enterpriseId },
  related_entity_id: null,
  relationship_type: "empreendimento",
  status: "verified",
});

function montar(entrada: {
  esteira?: string[];
  imobiliaria?: boolean;
  vinculos: Linha[];
}, falhas: Record<string, Linha> = {}) {
  const banco = bancoFalso(
    {
      apolo_entity_profiles: entrada.imobiliaria
        ? [{ entity_id: PESSOA, profile: "imobiliaria", status: "active" }]
        : [{ entity_id: PESSOA, profile: "prospect", status: "active" }],
      apolo_esteira: (entrada.esteira ?? []).map((eid) => ({ entity_id: PESSOA, enterprise_id: eid, etapa: "credito" })),
      apolo_relationships: entrada.vinculos,
      apolo_timeline_events: [],
      hercules_empreendimentos: HERCULES.map((l) => ({ ...l })),
    },
    falhas,
  );
  m.banco = banco.client;
  return banco;
}

const arquivar = (corpo: Linha) =>
  POST(
    new Request("https://c2x.app.br/api/apolo/relationships/archive", {
      body: JSON.stringify({ entityId: PESSOA, ...corpo }),
      headers: { authorization: "Bearer x" },
      method: "POST",
    }),
  );

beforeEach(() => {
  m.banco = null;
});

describe("POST /api/apolo/relationships/archive: o vínculo de empreendimento da CAD", () => {
  it("o caso do Jonatas: CAD no 19, excluir o vínculo do 19 dá 409 e nada é arquivado", async () => {
    const banco = montar({
      esteira: ["19"],
      vinculos: [vinculo("v-19", "19", "VEREDAS DO OURO"), vinculo("v-35", "35", "Vale do Ouro")],
    });
    const r = await arquivar({ label: "VEREDAS DO OURO" });

    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({
      enterpriseIdDaCad: "19",
      error:
        "Este empreendimento é o da CAD. Para trocar o empreendimento, a coordenação usa Mover CAD no Board.",
    });
    expect(banco.escritas).toHaveLength(0);
    expect(banco.tabelas.apolo_relationships?.every((v) => v.status === "verified")).toBe(true);
  });

  it("equivalência pela régua de mercado: CAD em group:Vale do Ouro e vínculo na divisão (37) dá 409", async () => {
    const banco = montar({
      esteira: ["group:Vale do Ouro"],
      vinculos: [vinculo("v-37", "37", "VOC")],
    });
    const r = await arquivar({ label: "VOC" });
    expect(r.status).toBe(409);
    expect(banco.escritas).toHaveLength(0);
  });

  it("e o contrário: CAD no 35 (pai) e vínculo no grupo legado também dá 409", async () => {
    montar({ esteira: ["35"], vinculos: [vinculo("v-g", "group:Vale do Ouro", "Vale do Ouro")] });
    expect((await arquivar({ label: "Vale do Ouro" })).status).toBe(409);
  });

  it("imobiliária que TAMBÉM tem CAD no produto: trava igual (a b343b378, CAD de cliente no 20)", async () => {
    // Antes a isenção era pelo perfil, e este arquivamento passava: o "exclui e adiciona" recriava o
    // caso do Jonatas numa CAD viva. Agora decide a existência da CAD no produto equivalente.
    const banco = montar({
      esteira: ["35"],
      imobiliaria: true,
      vinculos: [vinculo("v-35", "35", "Vale do Ouro")],
    });
    const r = await arquivar({ label: "Vale do Ouro" });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ enterpriseIdDaCad: "35" });
    expect(banco.escritas).toHaveLength(0);
    expect(banco.tabelas.apolo_relationships?.[0]?.status).toBe("verified");
  });

  it("imobiliária SEM CAD segue livre: o vínculo de empreendimento dela é o credenciamento", async () => {
    const banco = montar({ imobiliaria: true, vinculos: [vinculo("v-35", "35", "Vale do Ouro")] });
    const r = await arquivar({ label: "Vale do Ouro" });
    expect(r.status).toBe(200);
    expect(banco.tabelas.apolo_relationships?.[0]?.status).toBe("archived");
  });

  it("imobiliária com CAD em OUTRO produto: o vínculo do credenciamento segue livre", async () => {
    const banco = montar({
      esteira: ["19"],
      imobiliaria: true,
      vinculos: [vinculo("v-19", "19", "VEREDAS DO OURO"), vinculo("v-35", "35", "Vale do Ouro")],
    });
    const r = await arquivar({ label: "Vale do Ouro" });
    expect(r.status).toBe(200);
    expect(banco.tabelas.apolo_relationships?.find((v) => v.id === "v-35")?.status).toBe("archived");
    expect(banco.tabelas.apolo_relationships?.find((v) => v.id === "v-19")?.status).toBe("verified");
  });

  it("vínculo de OUTRO produto (a CAD já mora no 35): arquiva normalmente", async () => {
    const banco = montar({
      esteira: ["35"],
      vinculos: [vinculo("v-19", "19", "VEREDAS DO OURO"), vinculo("v-35", "35", "Vale do Ouro")],
    });
    const r = await arquivar({ label: "VEREDAS DO OURO" });
    expect(r.status).toBe(200);
    expect(banco.tabelas.apolo_relationships?.find((v) => v.id === "v-19")?.status).toBe("archived");
    expect(banco.tabelas.apolo_relationships?.find((v) => v.id === "v-35")?.status).toBe("verified");
  });

  it("vínculo DUPLICADO do mesmo produto: pode sair, porque outro vínculo ativo ainda cobre a CAD", async () => {
    const banco = montar({
      esteira: ["35"],
      vinculos: [vinculo("v-35", "35", "Vale do Ouro"), vinculo("v-g", "group:Vale do Ouro", "VOC + VOL + VOR")],
    });
    const r = await arquivar({ label: "VOC + VOL + VOR" });
    expect(r.status).toBe(200);
    expect(banco.tabelas.apolo_relationships?.find((v) => v.id === "v-g")?.status).toBe("archived");
  });

  it("pessoa sem CAD e vínculo que não é de empreendimento: seguem livres", async () => {
    montar({ vinculos: [vinculo("v-35", "35", "Vale do Ouro")] });
    expect((await arquivar({ label: "Vale do Ouro" })).status).toBe(200);

    const banco = montar({
      esteira: ["35"],
      vinculos: [
        vinculo("v-35", "35", "Vale do Ouro"),
        {
          entity_id: PESSOA,
          id: "v-corretor",
          label: "RONILSON",
          metadata: {},
          related_entity_id: "corretor-1",
          relationship_type: "corretor",
          status: "verified",
        },
      ],
    });
    const r = await arquivar({ relatedEntityId: "corretor-1" });
    expect(r.status).toBe(200);
    expect(banco.tabelas.apolo_relationships?.find((v) => v.id === "v-corretor")?.status).toBe("archived");
  });

  it("leitura que falha não vira 'pode arquivar': 503, nada arquivado", async () => {
    const banco = montar(
      { esteira: ["19"], vinculos: [vinculo("v-19", "19", "VEREDAS DO OURO")] },
      { "apolo_esteira:select": { message: "timeout" } },
    );
    const r = await arquivar({ label: "VEREDAS DO OURO" });
    expect(r.status).toBe(503);
    expect(banco.escritas).toHaveLength(0);
  });
});
