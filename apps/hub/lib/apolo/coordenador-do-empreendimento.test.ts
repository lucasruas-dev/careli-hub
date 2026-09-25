import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  type CadastroDoC2xPorId,
  coordenadoresDosPedidos,
  coordenadorParaAviso,
  type FontesDoCoordenador,
  idsDoC2xDoPedido,
  type LinhaDoCadastroDoPanteon,
  MOTIVO_C2X_FORA_DO_AR,
  MOTIVO_GRUPO_SEM_DIVISOES,
  MOTIVO_SEM_COORDENADOR,
} from "./coordenador-do-empreendimento";

// O COORDENADOR ACHADO PELO ID, E NUNCA PELA SIGLA (Lucas, 24/09/2026).
//
// O caso real: a Nivea renomeou o 43 no C2X de RECANTO DO VALE/RDV para PORTAL DO IBITURUNA/PDI.
// O Panteon guardava RDV, a busca por sigla voltou vazia e a LUNA não soube da CONECTTA IMOVEIS,
// habilitada 7 minutos depois. E o `group:Lagoa Bonita` nunca achou coordenador nenhum (6 de 6).

type Linha = Record<string, unknown>;

/**
 * Supabase de mentira: responde por tabela e aplica os `.in()` como o PostgREST aplicaria, para o
 * teste falar de QUEM é achado e não de como a consulta se encadeia.
 */
function supabaseFalso(tabelas: Record<string, Linha[] | { erro: string }>) {
  const consultas: Array<{ filtros: Array<[string, unknown]>; tabela: string }> = [];
  const client = {
    from(tabela: string) {
      const registro = { filtros: [] as Array<[string, unknown]>, tabela };
      consultas.push(registro);
      const resposta = () => {
        const fonte = tabelas[tabela] ?? [];
        if (!Array.isArray(fonte)) return { data: null, error: { message: fonte.erro } };
        let linhas = fonte;
        for (const [coluna, valores] of registro.filtros) {
          if (Array.isArray(valores)) linhas = linhas.filter((l) => valores.includes(l[coluna]));
        }
        return { data: linhas, error: null };
      };
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.in = (coluna: string, valores: unknown) => {
        registro.filtros.push([coluna, valores]);
        return q;
      };
      q.then = (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) =>
        Promise.resolve(resposta()).then(ok, falha);
      return q;
    },
  } as unknown as SupabaseClient;
  return { client, consultas };
}

const LUNA_C2X = { entityId: "luna-c2x", name: "LUNA NEGOCIOS IMOBILIARIOS", phone: "(31) 99596-0000", relation: "coordenador_vendas" };
const MATHEUS_C2X = { entityId: "matheus", name: "MATHEUS GUEDES IMOVEIS", phone: "(33) 98731-0000", relation: "coordenador_vendas" };

/** O C2X de mentira, POR ID: é a única pergunta que a busca nova sabe fazer. */
function c2xPorId(porId: Record<string, CadastroDoC2xPorId["players"]>) {
  return vi.fn(async (ids: string[]) => ({
    cadastros: ids.filter((id) => porId[id]).map((id) => ({ enterpriseId: id, players: porId[id]! })),
    ok: true as const,
  }));
}

function fontes(parcial: Partial<FontesDoCoordenador>): FontesDoCoordenador {
  return {
    cadastroDoC2x: parcial.cadastroDoC2x ?? c2xPorId({}),
    cadastroDoPanteon: parcial.cadastroDoPanteon ?? (async () => []),
  };
}

// O cadastro do Panteon como está no banco (24/09/2026): o LAB é o pai "Lagoa Bonita" e as três
// glebas apontam para ele.
const CADASTRO_LAGOA: LinhaDoCadastroDoPanteon[] = [
  { c2xEnterpriseId: "31", codigo: "LAB", id: "pai-lab", nome: "Lagoa Bonita", paiId: null },
  { c2xEnterpriseId: "33", codigo: "LBF", id: "lbf", nome: "Lagoa Bonita · LBF", paiId: "pai-lab" },
  { c2xEnterpriseId: "27", codigo: "LBR", id: "lbr", nome: "Lagoa Bonita · LBR", paiId: "pai-lab" },
  { c2xEnterpriseId: "32", codigo: "LBP", id: "lbp", nome: "Lagoa Bonita · LBP", paiId: "pai-lab" },
  { c2xEnterpriseId: "43", codigo: "PDI", id: "pdi", nome: "Portal do Ibituruna", paiId: null },
];

describe("⚠️ o renome da sigla no C2X não quebra mais o aviso", () => {
  it("RDV -> PDI: com a sigla velha no Panteon, a busca vai ao C2X pelo id 43 e acha a LUNA", async () => {
    // O Panteon ainda dizendo RDV, exatamente como estava às 16:55 de 24/09.
    const { client } = supabaseFalso({
      apolo_enterprise_settings: [{ code: "RDV", coordenador_entity_id: null, enterprise_id: "43" }],
    });
    const cadastroDoC2x = c2xPorId({ "43": [LUNA_C2X] });

    const r = (await coordenadoresDosPedidos(client, ["43"], fontes({ cadastroDoC2x }))).get("43");

    expect(r?.coordenadores.map((c) => c.nome)).toEqual(["LUNA NEGOCIOS IMOBILIARIOS"]);
    expect(r?.coordenadores[0]?.telefone).toBe("(31) 99596-0000");
    expect(r?.motivo).toBeUndefined();
    // A pergunta ao legado é o ID. A sigla (RDV ou PDI) não aparece em lugar nenhum.
    expect(cadastroDoC2x).toHaveBeenCalledWith(["43"]);
  });
});

describe("⚠️ group:Lagoa Bonita acha o coordenador", () => {
  it("pelas divisões do pai no cadastro do Panteon, e a mesma pessoa nas três glebas é UMA", async () => {
    const { client } = supabaseFalso({
      // A "sigla" do grupo no Panteon, que não é sigla de nada no C2X: era por isso que falhava.
      apolo_enterprise_settings: [
        { code: "LBF + LBR + LBP", coordenador_entity_id: null, enterprise_id: "group:Lagoa Bonita" },
      ],
    });
    const cadastroDoC2x = c2xPorId({
      "27": [MATHEUS_C2X],
      // O pai tem a LUNA como gerente no C2X (medido em 24/09/2026). Ela NÃO é do produto.
      "31": [LUNA_C2X],
      "32": [MATHEUS_C2X],
      "33": [MATHEUS_C2X],
    });

    const r = (
      await coordenadoresDosPedidos(
        client,
        ["group:Lagoa Bonita"],
        fontes({ cadastroDoC2x, cadastroDoPanteon: async () => CADASTRO_LAGOA }),
      )
    ).get("group:Lagoa Bonita");

    expect(r?.coordenadores.map((c) => c.nome)).toEqual(["MATHEUS GUEDES IMOVEIS"]);
    // O pai (31) não entra: com ele, a habilitação avisaria a LUNA de um produto que não é dela.
    expect(cadastroDoC2x.mock.calls[0]?.[0]?.slice().sort()).toEqual(["27", "32", "33"]);
  });

  it("com o coordenador cadastrado nas glebas (o dado de hoje), o C2X nem é consultado", async () => {
    const { client } = supabaseFalso({
      apolo_contacts: [
        { contact_type: "whatsapp", entity_id: "matheus-panteon", is_primary: true, value: "(33) 98731-9586" },
      ],
      apolo_enterprise_settings: ["33", "27", "32"].map((id) => ({
        coordenador_entity_id: "matheus-panteon",
        enterprise_id: id,
      })),
      apolo_entities: [{ display_name: "MATHEUS GUEDES IMOVEIS", id: "matheus-panteon" }],
    });
    const cadastroDoC2x = c2xPorId({});

    const r = (
      await coordenadoresDosPedidos(
        client,
        ["group:Lagoa Bonita"],
        fontes({ cadastroDoC2x, cadastroDoPanteon: async () => CADASTRO_LAGOA }),
      )
    ).get("group:Lagoa Bonita");

    expect(r?.coordenadores).toEqual([
      {
        entityId: "matheus-panteon",
        fonte: "panteon",
        nome: "MATHEUS GUEDES IMOVEIS",
        telefone: "(33) 98731-9586",
      },
    ]);
    expect(cadastroDoC2x).not.toHaveBeenCalled();
  });
});

describe("⚠️ coordenador_entity_id prevalece", () => {
  it("o cadastrado no Panteon ganha do C2X, com o telefone do apolo_contacts (whatsapp antes de phone)", async () => {
    const { client } = supabaseFalso({
      apolo_contacts: [
        { contact_type: "phone", entity_id: "luna-panteon", is_primary: true, value: "(31) 3333-0000" },
        { contact_type: "whatsapp", entity_id: "luna-panteon", is_primary: true, value: "(31) 99596-8349" },
      ],
      apolo_enterprise_settings: [
        { code: "PDI", coordenador_entity_id: "luna-panteon", enterprise_id: "43" },
      ],
      apolo_entities: [{ display_name: "LUNA NEGOCIOS IMOBILIARIOS", id: "luna-panteon" }],
    });
    // O C2X diria outra pessoa. Não importa: o Panteon cadastrou a LUNA.
    const cadastroDoC2x = c2xPorId({ "43": [{ ...LUNA_C2X, entityId: "outro", name: "OUTRO COORDENADOR" }] });

    const r = (await coordenadoresDosPedidos(client, ["43"], fontes({ cadastroDoC2x }))).get("43");

    expect(r?.coordenadores).toEqual([
      {
        entityId: "luna-panteon",
        fonte: "panteon",
        nome: "LUNA NEGOCIOS IMOBILIARIOS",
        telefone: "(31) 99596-8349",
      },
    ]);
    // Com o telefone no Panteon, o legado nem é perguntado.
    expect(cadastroDoC2x).not.toHaveBeenCalled();
  });

  it("o do GRUPO, cadastrado na linha do grupo, vale para todas as divisões", async () => {
    const { client } = supabaseFalso({
      apolo_contacts: [{ contact_type: "whatsapp", entity_id: "coord-grupo", value: "31999990000" }],
      apolo_enterprise_settings: [
        { coordenador_entity_id: "coord-grupo", enterprise_id: "group:Lagoa Bonita" },
        { coordenador_entity_id: "matheus-panteon", enterprise_id: "33" },
      ],
      apolo_entities: [
        { display_name: "COORDENADOR DO GRUPO", id: "coord-grupo" },
        { display_name: "MATHEUS GUEDES IMOVEIS", id: "matheus-panteon" },
      ],
    });

    const r = (
      await coordenadoresDosPedidos(
        client,
        ["group:Lagoa Bonita"],
        fontes({ cadastroDoPanteon: async () => CADASTRO_LAGOA }),
      )
    ).get("group:Lagoa Bonita");

    expect(r?.coordenadores.map((c) => c.nome)).toEqual(["COORDENADOR DO GRUPO"]);
  });

  it("sem telefone no Panteon, usa o do C2X SÓ se for a mesma entidade", async () => {
    const { client } = supabaseFalso({
      apolo_enterprise_settings: [{ coordenador_entity_id: "luna-c2x", enterprise_id: "43" }],
      apolo_entities: [{ display_name: "LUNA NEGOCIOS IMOBILIARIOS", id: "luna-c2x" }],
    });

    const r = (
      await coordenadoresDosPedidos(client, ["43"], fontes({ cadastroDoC2x: c2xPorId({ "43": [LUNA_C2X] }) }))
    ).get("43");

    expect(r?.coordenadores[0]).toMatchObject({
      entityId: "luna-c2x",
      fonte: "panteon",
      telefone: "(31) 99596-0000",
    });
  });

  it("⚠️ o caso do Garden: Panteon sem telefone e C2X com OUTRA entidade não troca o coordenador", async () => {
    // Medido em 24/09/2026: GDN, SDT, CDJ e ADT têm no Panteon a CARELI ACESSORIA (só e-mail) e, no
    // C2X, a CARELI ASSESSORIA FINANCEIRA, outra entidade. Mandar para a do legado seria desobedecer
    // o cadastro do Panteon; o certo é registrar que falta o telefone.
    const { client } = supabaseFalso({
      apolo_enterprise_settings: [{ coordenador_entity_id: "careli-acessoria", enterprise_id: "39" }],
      apolo_entities: [{ display_name: "CARELI ACESSORIA", id: "careli-acessoria" }],
    });
    const cadastroDoC2x = c2xPorId({
      "39": [{ entityId: "careli-financeira", name: "CARELI ASSESSORIA FINANCEIRA LTDA", phone: "31999994143", relation: "coordenador_vendas" }],
    });

    const r = (await coordenadoresDosPedidos(client, ["39"], fontes({ cadastroDoC2x }))).get("39");

    expect(r?.coordenadores).toEqual([
      {
        entityId: "careli-acessoria",
        fonte: "panteon",
        motivoSemTelefone: "Coordenador CARELI ACESSORIA sem telefone no cadastro do Panteon.",
        nome: "CARELI ACESSORIA",
        telefone: null,
      },
    ]);
  });

  it("entidade que não existe mais (merge, arquivamento) devolve a unidade ao C2X", async () => {
    const { client } = supabaseFalso({
      apolo_enterprise_settings: [{ coordenador_entity_id: "apagada", enterprise_id: "43" }],
      apolo_entities: [],
    });

    const r = (
      await coordenadoresDosPedidos(client, ["43"], fontes({ cadastroDoC2x: c2xPorId({ "43": [LUNA_C2X] }) }))
    ).get("43");

    expect(r?.coordenadores.map((c) => [c.nome, c.fonte])).toEqual([["LUNA NEGOCIOS IMOBILIARIOS", "c2x"]]);
  });
});

describe("⚠️ não encontrado vira motivo, e não silêncio", () => {
  it("sem coordenador no Panteon nem no C2X", async () => {
    const { client } = supabaseFalso({});
    const r = (await coordenadoresDosPedidos(client, ["43"], fontes({}))).get("43");
    expect(r).toEqual({ coordenadores: [], motivo: MOTIVO_SEM_COORDENADOR });
  });

  it("C2X fora do ar (erro devolvido ou exceção) diz que foi o C2X", async () => {
    const { client } = supabaseFalso({});
    const fora = fontes({ cadastroDoC2x: async () => ({ error: "timeout", ok: false as const }) });
    expect((await coordenadoresDosPedidos(client, ["43"], fora)).get("43")?.motivo).toBe(MOTIVO_C2X_FORA_DO_AR);

    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const explode = fontes({
      cadastroDoC2x: async () => {
        throw new Error("ECONNRESET");
      },
    });
    expect((await coordenadoresDosPedidos(client, ["43"], explode)).get("43")?.motivo).toBe(
      MOTIVO_C2X_FORA_DO_AR,
    );
    erro.mockRestore();
  });

  it("grupo que o cadastro do Panteon não sabe dividir", async () => {
    const { client } = supabaseFalso({});
    const r = (await coordenadoresDosPedidos(client, ["group:Não Existe"], fontes({}))).get("group:Não Existe");
    expect(r).toEqual({ coordenadores: [], motivo: MOTIVO_GRUPO_SEM_DIVISOES });
  });

  it("falha ao ler o settings não derruba: o C2X por id ainda responde", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { client } = supabaseFalso({ apolo_enterprise_settings: { erro: "boom" } });
    const r = (
      await coordenadoresDosPedidos(client, ["43"], fontes({ cadastroDoC2x: c2xPorId({ "43": [LUNA_C2X] }) }))
    ).get("43");
    expect(r?.coordenadores.map((c) => c.nome)).toEqual(["LUNA NEGOCIOS IMOBILIARIOS"]);
    erro.mockRestore();
  });
});

describe("idsDoC2xDoPedido", () => {
  it("id numérico passa como veio", () => {
    expect(idsDoC2xDoPedido(" 43 ", [])).toEqual(["43"]);
    expect(idsDoC2xDoPedido("", [])).toEqual([]);
  });

  it("grupo vira as divisões do pai, sem o pai, e o nome casa sem acento nem caixa", () => {
    expect(idsDoC2xDoPedido("group:lagoa bonita", CADASTRO_LAGOA).sort()).toEqual(["27", "32", "33"]);
  });

  it("pai renomeado no Panteon: as siglas de ENTERPRISE_GROUPS, casadas no CÓDIGO DO PANTEON", () => {
    const renomeado = CADASTRO_LAGOA.map((l) => (l.id === "pai-lab" ? { ...l, nome: "Lagoa Bonita Residencial" } : l));
    expect(idsDoC2xDoPedido("group:Lagoa Bonita", renomeado).sort()).toEqual(["27", "32", "33"]);
  });

  it("grupo desconhecido não inventa divisão", () => {
    expect(idsDoC2xDoPedido("group:Qualquer", CADASTRO_LAGOA)).toEqual([]);
  });
});

describe("coordenadorParaAviso", () => {
  it("devolve o primeiro com telefone que sirva para WhatsApp", async () => {
    const { client } = supabaseFalso({});
    const r = await coordenadorParaAviso(client, "43", fontes({ cadastroDoC2x: c2xPorId({ "43": [LUNA_C2X] }) }));
    expect(r).toEqual({ nome: "LUNA NEGOCIOS IMOBILIARIOS", telefone: "(31) 99596-0000" });
  });

  it("sem telefone, diz de quem falta; sem ninguém, diz que não há", async () => {
    const { client } = supabaseFalso({});
    const semTelefone = await coordenadorParaAviso(
      client,
      "1",
      fontes({ cadastroDoC2x: c2xPorId({ "1": [{ ...LUNA_C2X, name: "GLENDER", phone: null }] }) }),
    );
    expect(semTelefone).toEqual({
      motivo: "Coordenador GLENDER sem telefone no C2X.",
      nome: "GLENDER",
      telefone: null,
    });

    const ninguem = await coordenadorParaAviso(client, "43", fontes({}));
    expect(ninguem).toEqual({ motivo: MOTIVO_SEM_COORDENADOR, nome: null, telefone: null });
  });
});
