import { beforeEach, describe, expect, it, vi } from "vitest";

// O CADASTRO INTERNO QUE HABILITA IMOBILIÁRIA (Lucas, 24/09/2026, "3 - Isso ae").
//
// O wizard do hub grava a imobiliária já habilitada (regra de 17/08) e, até aqui, em silêncio: sem
// auditoria e sem aviso. Em 24/09 a VIDA IMOVEIS, a SANTA FE e a VINICIUS JOHNNY entraram no 43 assim, e
// a LUNA não soube. O que se trava aqui, em `createApoloEntity`:
//   • com a porta do hub ligando (`habilitacaoInterna`), o vínculo de empreendimento NOVO de uma
//     imobiliária (ficha nova ou já existente) chama a auditoria + aviso, com `primeiraVez` pelo papel
//     que ela tinha ANTES de gravar;
//   • o que a ficha já tinha habilitado não é gravado de novo nem avisado (a SANTA FE já estava no 43);
//   • as portas públicas (que rebaixam para `pending` depois) e o prospect não avisam nada;
//   • vínculo recusado pelo banco não avisa; aviso que explode não derruba o cadastro;
//   • (revisão de 24/09/2026) o aviso sai DEPOIS da resposta, e o Vale do Ouro (35) conta como as
//     divisões que a ficha já tem.

const m = vi.hoisted(() => ({ after: vi.fn(), cadastro: vi.fn(), registrar: vi.fn() }));

vi.mock("@/lib/apolo/habilitacao-pelo-cadastro", async (original) => ({
  ...(await original<typeof import("@/lib/apolo/habilitacao-pelo-cadastro")>()),
  registrarHabilitacaoPeloCadastro: m.registrar,
}));
// O `after()` do Next. Por padrão lança, como fora de uma requisição (o aviso roda na hora); o teste
// da resposta troca por uma fila.
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: m.after,
}));
vi.mock("@/lib/hercules/cadastro", () => ({ carregarCadastroDeEmpreendimentos: m.cadastro }));

import { createApoloEntity, type CreateApoloEntityInput } from "./cadastro-persist";

const FICHA = "ent-vida";
const OPERADOR = "766e2df4-c404-472e-9c33-bd65cbf150d8";

type Escrita = { operacao: string; tabela: string; valores: unknown };

function clienteFalso(opcoes: {
  /** A ficha do mesmo CNPJ já existe (veio do C2X). */
  fichaExiste?: boolean;
  /** Status do papel `imobiliaria` que a ficha tinha antes do cadastro. */
  papelAntes?: null | string;
  /** Vínculos de empreendimento `verified` que a ficha já tinha. */
  jaHabilitados?: string[];
  erroNaLeituraDosVinculos?: boolean;
  erroNoInsertDosVinculos?: boolean;
}) {
  const escritas: Escrita[] = [];
  const client = {
    from(tabela: string) {
      let operacao = "select";
      let colunas = "";
      const filtros: Record<string, string> = {};
      const q: Record<string, unknown> = {};

      const resposta = (): { data: unknown; error: unknown } => {
        if (operacao === "insert" && tabela === "apolo_entities") return { data: { id: "ent-nova" }, error: null };
        if (operacao === "insert" && tabela === "apolo_relationships" && opcoes.erroNoInsertDosVinculos) {
          return { data: null, error: { message: "violou constraint" } };
        }
        if (operacao !== "select") return { data: null, error: null };

        if (tabela === "apolo_entity_identifiers") {
          return { data: opcoes.fichaExiste ? [{ entity_id: FICHA }] : [], error: null };
        }
        if (tabela === "apolo_entities") {
          return { data: colunas === "id" ? [] : { display_name: "VIDA IMOVEIS LTDA", metadata: {} }, error: null };
        }
        if (tabela === "apolo_esteira") return { data: [], error: null };
        if (tabela === "apolo_entity_profiles") {
          return { data: opcoes.papelAntes ? { status: opcoes.papelAntes } : null, error: null };
        }
        if (tabela === "apolo_relationships" && filtros.relationship_type === "empreendimento") {
          if (opcoes.erroNaLeituraDosVinculos) return { data: null, error: { message: "timeout" } };
          return {
            data: (opcoes.jaHabilitados ?? []).map((enterpriseId) => ({ metadata: { enterpriseId } })),
            error: null,
          };
        }
        return { data: [], error: null };
      };

      q.select = (selecao?: string) => {
        if (operacao === "select") colunas = String(selecao ?? "");
        return q;
      };
      q.eq = (coluna: string, valor: unknown) => {
        filtros[coluna] = String(valor);
        return q;
      };
      for (const metodo of ["in", "is", "limit", "neq", "not", "or", "order", "range"]) q[metodo] = () => q;
      const escrever = (op: string) => (valores: unknown) => {
        operacao = op;
        escritas.push({ operacao: op, tabela, valores });
        return q;
      };
      q.insert = escrever("insert");
      q.update = escrever("update");
      q.upsert = escrever("upsert");
      q.maybeSingle = async () => resposta();
      q.single = q.maybeSingle;
      q.then = (ok: (r: unknown) => unknown, falha: (e: unknown) => unknown) =>
        Promise.resolve(resposta()).then(ok, falha);
      return q;
    },
  };
  return { client: client as never, escritas };
}

// O que o wizard do hub manda para a imobiliária (via `salvarCadastroDoApolo`).
const IMOBILIARIA: CreateApoloEntityInput = {
  dedupPorDocumento: true,
  empreendimentos: [{ id: "43", label: "PORTAL DO IBITURUNA" }],
  empresa: { cnpj: "12.345.678/0001-90", razaoSocial: "VIDA IMOVEIS LTDA" },
  ownerUserId: OPERADOR,
  persona: "pj",
  role: "imobiliaria",
};

const vinculosGravados = (escritas: Escrita[]) =>
  escritas
    .filter((e) => e.tabela === "apolo_relationships" && e.operacao === "insert")
    .flatMap((e) => e.valores as Array<{ metadata: { enterpriseId?: string }; relationship_type: string }>)
    .filter((linha) => linha.relationship_type === "empreendimento")
    .map((linha) => linha.metadata.enterpriseId);

beforeEach(() => {
  m.registrar.mockReset();
  m.registrar.mockResolvedValue({ auditou: true, coordenadores: { avisados: 1, falharam: 0 } });
  m.after.mockReset();
  m.after.mockImplementation(() => {
    throw new Error("`after` was called outside a request scope.");
  });
  // O cadastro do Panteon: o Vale do Ouro (VLO 35) é o pai de VOC 37, VOL 36 e VOR 41.
  m.cadastro.mockReset();
  m.cadastro.mockResolvedValue([
    { c2xEnterpriseId: "35", codigo: "VLO", id: "h-vlo", nome: "Vale do Ouro", paiId: null },
    { c2xEnterpriseId: "37", codigo: "VOC", id: "h-voc", nome: "Vale do Ouro · VOC", paiId: "h-vlo" },
    { c2xEnterpriseId: "36", codigo: "VOL", id: "h-vol", nome: "Vale do Ouro · VOL", paiId: "h-vlo" },
    { c2xEnterpriseId: "41", codigo: "VOR", id: "h-vor", nome: "Vale do Ouro · VOR", paiId: "h-vlo" },
    { c2xEnterpriseId: "43", codigo: "PDI", id: "h-pdi", nome: "Portal do Ibituruna", paiId: null },
  ]);
});

describe("createApoloEntity: revisão de 24/09/2026", () => {
  it("⚠️ o aviso ao coordenador sai DEPOIS da resposta: o salvamento não espera o WhatsApp", async () => {
    const depois: Array<() => Promise<unknown>> = [];
    m.after.mockImplementation((tarefa: () => Promise<unknown>) => {
      depois.push(tarefa);
    });
    // Um aviso que nunca termina (o gateway pendurado): o salvamento tem que voltar assim mesmo.
    m.registrar.mockImplementation(() => new Promise(() => undefined));

    const { client, escritas } = clienteFalso({});
    const r = await createApoloEntity(client, IMOBILIARIA, { habilitacaoInterna: true });

    expect(r.ok).toBe(true);
    expect(vinculosGravados(escritas)).toEqual(["43"]);
    expect(m.registrar).not.toHaveBeenCalled();
    expect(depois).toHaveLength(1);

    void depois[0]?.();
    expect(m.registrar).toHaveBeenCalledTimes(1);
    expect(m.registrar.mock.calls[0]?.[1]).toMatchObject({ entityId: "ent-nova", primeiraVez: true });
  });

  it("⚠️ a PALHARES (36, 37 e 41 pela página pública) salva no wizard com o Vale do Ouro (35): nada novo", async () => {
    const { client, escritas } = clienteFalso({
      fichaExiste: true,
      jaHabilitados: ["36", "37", "41"],
      papelAntes: "active",
    });
    await createApoloEntity(
      client,
      { ...IMOBILIARIA, empreendimentos: [{ id: "35", label: "VALE DO OURO" }] },
      { habilitacaoInterna: true },
    );

    expect(vinculosGravados(escritas)).toEqual([]);
    expect(m.registrar).not.toHaveBeenCalled();
  });
});

describe("createApoloEntity: a habilitação pelo cadastro interno", () => {
  it("imobiliária NOVA pelo hub: grava o vínculo e avisa, como primeira vez", async () => {
    const { client, escritas } = clienteFalso({});
    const r = await createApoloEntity(client, IMOBILIARIA, { habilitacaoInterna: true });

    expect(r.ok).toBe(true);
    expect(vinculosGravados(escritas)).toEqual(["43"]);
    expect(m.registrar).toHaveBeenCalledTimes(1);
    expect(m.registrar.mock.calls[0]?.[1]).toEqual({
      autorUserId: OPERADOR,
      cnpj: "12.345.678/0001-90",
      empreendimentos: [{ enterpriseId: "43", label: "PORTAL DO IBITURUNA" }],
      entityId: "ent-nova",
      imobiliaria: "VIDA IMOVEIS LTDA",
      primeiraVez: true,
    });
  });

  it("⚠️ a VIDA IMOVEIS (ficha do C2X, papel ativo) no 43: avisa, e não é primeira vez", async () => {
    const { client, escritas } = clienteFalso({ fichaExiste: true, jaHabilitados: ["29"], papelAntes: "active" });
    await createApoloEntity(client, IMOBILIARIA, { habilitacaoInterna: true });

    expect(vinculosGravados(escritas)).toEqual(["43"]);
    expect(m.registrar).toHaveBeenCalledTimes(1);
    expect(m.registrar.mock.calls[0]?.[1]).toMatchObject({
      empreendimentos: [{ enterpriseId: "43", label: "PORTAL DO IBITURUNA" }],
      entityId: FICHA,
      primeiraVez: false,
    });
  });

  it("ficha existente cujo papel ainda estava em review: é a primeira vez", async () => {
    const { client } = clienteFalso({ fichaExiste: true, papelAntes: "review" });
    await createApoloEntity(client, IMOBILIARIA, { habilitacaoInterna: true });
    expect(m.registrar.mock.calls[0]?.[1]).toMatchObject({ primeiraVez: true });
  });

  it("⚠️ a SANTA FE já habilitada no 43: não grava a segunda linha e não avisa de novo", async () => {
    const { client, escritas } = clienteFalso({ fichaExiste: true, jaHabilitados: ["43"], papelAntes: "active" });
    const r = await createApoloEntity(client, IMOBILIARIA, { habilitacaoInterna: true });

    expect(r.ok).toBe(true);
    expect(vinculosGravados(escritas)).toEqual([]);
    expect(m.registrar).not.toHaveBeenCalled();
  });

  it("⚠️ porta pública (sem `habilitacaoInterna`): nada é avisado, o vínculo nasce como sempre", async () => {
    // /api/publico/imobiliaria/cadastro e /credenciar rebaixam o vínculo para `pending` logo depois:
    // avisar aqui seria anunciar uma habilitação que ninguém validou.
    const { client, escritas } = clienteFalso({});
    await createApoloEntity(client, { ...IMOBILIARIA, dedupPorDocumento: false, ownerUserId: null });
    expect(vinculosGravados(escritas)).toEqual(["43"]);
    expect(m.registrar).not.toHaveBeenCalled();
  });

  it("prospect pelo hub não é habilitação de imobiliária", async () => {
    const { client } = clienteFalso({});
    await createApoloEntity(
      client,
      { ...IMOBILIARIA, empresa: { cnpj: "12.345.678/0001-90", razaoSocial: "CLIENTE PJ" }, role: "prospect" },
      { habilitacaoInterna: true },
    );
    expect(m.registrar).not.toHaveBeenCalled();
  });

  it("vínculo recusado pelo banco não habilitou nada: não avisa", async () => {
    const { client } = clienteFalso({ erroNoInsertDosVinculos: true });
    const r = await createApoloEntity(client, IMOBILIARIA, { habilitacaoInterna: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.join(" ")).toContain("relacionamentos");
    expect(m.registrar).not.toHaveBeenCalled();
  });

  it("⚠️ leitura dos vínculos da ficha que falha não cala o aviso: grava e avisa como novo", async () => {
    const { client, escritas } = clienteFalso({ erroNaLeituraDosVinculos: true, fichaExiste: true, papelAntes: "active" });
    const r = await createApoloEntity(client, IMOBILIARIA, { habilitacaoInterna: true });
    expect(vinculosGravados(escritas)).toEqual(["43"]);
    expect(m.registrar).toHaveBeenCalledTimes(1);
    if (r.ok) expect(r.warnings.join(" ")).toContain("vinculos da ficha");
  });

  it("aviso que explode não derruba o cadastro, que já está gravado", async () => {
    m.registrar.mockRejectedValue(new Error("gateway fora do ar"));
    const { client } = clienteFalso({});
    const r = await createApoloEntity(client, IMOBILIARIA, { habilitacaoInterna: true });
    expect(r.ok).toBe(true);
  });
});
