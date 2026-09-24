import { beforeEach, describe, expect, it, vi } from "vitest";

// O RÓTULO DO CARD E O "MOVER CAD" NA FILA DO BOARD (24/09/2026).
//
// O caso real: a CAD do JONATAS nasceu no VEREDAS DO OURO (19) e era do VALE DO OURO (35). O time
// trocou só o VÍNCULO no Apolo (arquivou o 19, criou o 35). O card passou a dizer "Vale do Ouro",
// porque o rótulo vinha do vínculo primeiro, e continuou agindo na CAD 19, porque o `enterpriseId`
// do card sai da esteira. O crédito leu a configuração do Veredas e credenciou sem Serasa. O que se
// trava aqui:
//   • com CAD, o rótulo é o empreendimento DA CAD (CAD 19 com vínculo 35 mostra VEREDAS DO OURO);
//   • sem CAD (imobiliária), a ordem de sempre: vínculo, cadastro, esteira;
//   • o "Mover CAD" só chega para admin e leader, só na porta do hub, e os destinos são os ids com o
//     portão de CAD aberto (o `group:Vale do Ouro`, com a recepção de CAD desligada, não entra);
//   • (revisão de 24/09/2026) junto com o Mover, cada item leva o id de MERCADO da sua CAD (36 vira 35),
//     os destinos saem no mesmo idioma, e sem o cadastro de empreendimentos não há botão (fail-closed).

const m = vi.hoisted(() => ({ catalogo: vi.fn(), recebendoLanca: false }));

vi.mock("@/lib/apolo/catalogo-empreendimentos", () => ({
  catalogoDeEmpreendimentos: m.catalogo,
}));

// A leitura do portão de CAD de verdade, com um interruptor para simular a leitura que LANÇA (a frente
// do servidor pode trocar o "falha fechada com []" por uma variante que lança).
vi.mock("@/lib/apolo/enterprise-settings", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/apolo/enterprise-settings")>();
  return {
    ...original,
    listEnterprisesRecebendo: (...args: Parameters<typeof original.listEnterprisesRecebendo>) =>
      m.recebendoLanca
        ? Promise.reject(new Error("portão fora do ar"))
        : original.listEnterprisesRecebendo(...args),
  };
});

import {
  destinosDaCad,
  empreendimentosDoCard,
  mercadoPeloCadastro,
  montarFilaDoBoard,
  podeMoverCad,
  semSufixoDeDivisao,
} from "./board-do-servidor";

// O catálogo do C2X como o `agrupar` entrega: o VLO (35) é linha própria, as divisões VOC, VOL e VOR
// viram o grupo, e o VDO (19) é simples.
const CATALOGO = [
  { codes: ["VDO"], id: "19", name: "VEREDAS DO OURO", stageIds: ["19"] },
  { codes: ["VLO"], id: "35", name: "VALE DO OURO", stageIds: ["35"] },
  { codes: ["VOC", "VOL", "VOR"], id: "group:Vale do Ouro", name: "VALE DO OURO", stageIds: ["37", "36", "41"] },
  { codes: ["LBF", "LBR", "LBP"], id: "group:Lagoa Bonita", name: "LAGOA BONITA", stageIds: ["33", "27", "32"] },
];

const nomeDoGrupo = new Map<string, string>();
for (const emp of CATALOGO) {
  for (const real of emp.stageIds) nomeDoGrupo.set(real, emp.name);
  nomeDoGrupo.set(emp.id, emp.name);
}

describe("empreendimentosDoCard (sem I/O)", () => {
  it("⚠️ CAD no 19 com vínculo no 35: o card mostra o empreendimento DA CAD, não o do vínculo", () => {
    expect(
      empreendimentosDoCard({
        doCadastro: [],
        doVinculo: ["VALE DO OURO"],
        esteira: { empreendimento: "VEREDAS DO OURO", enterprise_id: "19" },
        nomeDoGrupo,
      }),
    ).toEqual(["VEREDAS DO OURO"]);
  });

  it("CAD numa divisão mostra o nome de mercado, nunca a sigla do filho", () => {
    expect(
      empreendimentosDoCard({
        doCadastro: [],
        doVinculo: [],
        esteira: { empreendimento: "Vale do Ouro · VOL", enterprise_id: "36" },
        nomeDoGrupo,
      }),
    ).toEqual(["VALE DO OURO"]);
  });

  it("id que o catálogo não conhece (C2X fora do ar): o texto da esteira, sem o sufixo de divisão", () => {
    expect(
      empreendimentosDoCard({
        doCadastro: ["Garden"],
        doVinculo: ["LAGOA BONITA"],
        esteira: { empreendimento: "Lagoa Bonita · LBR", enterprise_id: "27" },
        nomeDoGrupo: new Map(),
      }),
    ).toEqual(["Lagoa Bonita"]);
  });

  it("CAD sem nome nenhum fica sem rótulo: cair no vínculo seria o defeito de volta", () => {
    expect(
      empreendimentosDoCard({
        doCadastro: ["Garden"],
        doVinculo: ["VALE DO OURO"],
        esteira: { empreendimento: null, enterprise_id: "9999" },
        nomeDoGrupo,
      }),
    ).toEqual([]);
  });

  it("imobiliária (sem CAD) segue a ordem de sempre: vínculo, cadastro, esteira", () => {
    expect(
      empreendimentosDoCard({
        doCadastro: ["Garden"],
        doVinculo: ["LAGOA BONITA", "VALE DO OURO"],
        esteira: undefined,
        nomeDoGrupo,
      }),
    ).toEqual(["LAGOA BONITA", "VALE DO OURO"]);
    expect(
      empreendimentosDoCard({ doCadastro: ["Garden"], doVinculo: [], esteira: null, nomeDoGrupo }),
    ).toEqual(["Garden"]);
    expect(empreendimentosDoCard({ doCadastro: [], doVinculo: [], nomeDoGrupo })).toEqual([]);
  });
});

describe("semSufixoDeDivisao", () => {
  it("tira a sigla do filho e deixa o resto como está", () => {
    expect(semSufixoDeDivisao("Vale do Ouro · VOL")).toBe("Vale do Ouro");
    expect(semSufixoDeDivisao("Lavra do Ouro · LOS")).toBe("Lavra do Ouro");
    expect(semSufixoDeDivisao("VEREDAS DO OURO")).toBe("VEREDAS DO OURO");
    expect(semSufixoDeDivisao("ZZ TESTE - nao e empreendimento real")).toBe(
      "ZZ TESTE - nao e empreendimento real",
    );
    expect(semSufixoDeDivisao(null)).toBe("");
  });
});

describe("podeMoverCad", () => {
  it("só a coordenação (admin e leader); analista e leitor não", () => {
    expect(podeMoverCad("admin")).toBe(true);
    expect(podeMoverCad("leader")).toBe(true);
    expect(podeMoverCad("operator")).toBe(false);
    expect(podeMoverCad("viewer")).toBe(false);
    expect(podeMoverCad(null)).toBe(false);
    expect(podeMoverCad(undefined)).toBe(false);
  });
});

describe("destinosDaCad", () => {
  it("nomeia pelo catálogo (o grupo também) e ordena pelo nome", () => {
    expect(destinosDaCad(["35", "19", "group:Lagoa Bonita", "35"], nomeDoGrupo)).toEqual([
      { id: "group:Lagoa Bonita", nome: "LAGOA BONITA" },
      { id: "35", nome: "VALE DO OURO" },
      { id: "19", nome: "VEREDAS DO OURO" },
    ]);
  });

  it("⚠️ o `group:*` sem nome no catálogo NÃO se nomeia pelo próprio id: não é oferecido", () => {
    // O defeito: com o C2X fora na carga, o seletor oferecia "LAGOA BONITA" (tirado do id), e a rota,
    // que não nomeia mais pelo id, gravava a sigla do settings ("LBF + LBR + LBP") ou respondia 400.
    expect(destinosDaCad(["group:Rio de Pedras"], new Map())).toEqual([]);
    expect(destinosDaCad(["group:Lagoa Bonita", "35"], new Map([["35", "VALE DO OURO"]]))).toEqual([
      { id: "35", nome: "VALE DO OURO" },
    ]);
  });

  it("id sem nome no catálogo não entra (fail-closed): nada de id cru para escolher", () => {
    expect(destinosDaCad(["35", "100123"], nomeDoGrupo)).toEqual([{ id: "35", nome: "VALE DO OURO" }]);
    expect(destinosDaCad(["35", "19"], new Map())).toEqual([]);
  });

  it("dois ids com o mesmo nome aparecem os dois, com o id ao lado, em vez de um sumir calado", () => {
    expect(destinosDaCad(["35", "group:Vale do Ouro"], nomeDoGrupo)).toEqual([
      { id: "35", nome: "VALE DO OURO (35)" },
      { id: "group:Vale do Ouro", nome: "VALE DO OURO (group:Vale do Ouro)" },
    ]);
  });

  it("⚠️ com a régua de mercado, o destino sai no id de mercado, e o mesmo produto vira um só", () => {
    // Hoje nenhum id que recebe CAD é divisão (medido em 24/09/2026). Se uma divisão passar a receber,
    // ela não pode aparecer como um segundo "VALE DO OURO" com outro id: vira o 35, como a rota faria.
    const mercadoDe = mercadoPeloCadastro(CADASTRO);
    expect(destinosDaCad(["36", "35", "19", "group:Vale do Ouro"], nomeDoGrupo, mercadoDe)).toEqual([
      { id: "35", nome: "VALE DO OURO" },
      { id: "19", nome: "VEREDAS DO OURO" },
    ]);
  });
});

// O cadastro do Panteon (`hercules_empreendimentos`) do jeito que a régua de mercado lê: o VLO (35) é o
// pai das divisões VOC (37), VOL (36) e VOR (41); o VDO (19) é simples.
const CADASTRO = [
  { c2xEnterpriseId: "35", codigo: "VLO", id: "h-vlo", nome: "Vale do Ouro", paiId: null },
  { c2xEnterpriseId: "37", codigo: "VOC", id: "h-voc", nome: "Vale do Ouro · VOC", paiId: "h-vlo" },
  { c2xEnterpriseId: "36", codigo: "VOL", id: "h-vol", nome: "Vale do Ouro · VOL", paiId: "h-vlo" },
  { c2xEnterpriseId: "41", codigo: "VOR", id: "h-vor", nome: "Vale do Ouro · VOR", paiId: "h-vlo" },
  { c2xEnterpriseId: "19", codigo: "VDO", id: "h-vdo", nome: "Veredas do Ouro", paiId: null },
];

describe("mercadoPeloCadastro", () => {
  it("a divisão sobe para o pai espelho; o simples fica como está", () => {
    const mercadoDe = mercadoPeloCadastro(CADASTRO);
    expect(mercadoDe("36")).toBe("35");
    expect(mercadoDe("37")).toBe("35");
    expect(mercadoDe("group:Vale do Ouro")).toBe("35");
    expect(mercadoDe("35")).toBe("35");
    expect(mercadoDe("19")).toBe("19");
  });
});

// ── A FILA INTEIRA, com um banco de mentira que filtra por `eq` e `in` ─────────────────────────────

type Linha = Record<string, unknown>;
type Erro = null | { message: string };
type Consulta = {
  eq: (coluna: string, valor: unknown) => Consulta;
  gte: () => Consulta;
  in: (coluna: string, valores: unknown[]) => Consulta;
  limit: () => Consulta;
  maybeSingle: () => Promise<{ data: Linha | null; error: Erro }>;
  not: () => Consulta;
  or: () => Consulta;
  order: () => Consulta;
  range: () => Consulta;
  select: () => Consulta;
  then: <T>(resolver: (r: { data: Linha[] | null; error: Erro }) => T) => Promise<T>;
};

// `falhar`: tabelas cuja leitura volta com erro (o banco fora do ar só naquele pedaço).
function bancoFalso(tabelas: Record<string, Linha[]>, falhar: readonly string[] = []) {
  const consultas: string[] = [];
  const from = (tabela: string): Consulta => {
    consultas.push(tabela);
    const erro: Erro = falhar.includes(tabela) ? { message: "fora do ar" } : null;
    let linhas = [...(tabelas[tabela] ?? [])];
    // Filtro só em coluna que a linha tem: `metadata->>source` e afins passam direto.
    const filtrar = (coluna: string, aceita: (valor: unknown) => boolean) => {
      linhas = linhas.filter((linha) => !(coluna in linha) || aceita(linha[coluna]));
    };
    const q: Consulta = {
      eq: (coluna, valor) => {
        filtrar(coluna, (v) => String(v) === String(valor));
        return q;
      },
      gte: () => q,
      in: (coluna, valores) => {
        filtrar(coluna, (v) => valores.map(String).includes(String(v)));
        return q;
      },
      limit: () => q,
      maybeSingle: async () => ({ data: erro ? null : (linhas[0] ?? null), error: erro }),
      not: () => q,
      or: () => q,
      order: () => q,
      // Uma página só: o cadastro de teste cabe nela.
      range: () => q,
      select: () => q,
      then: (resolver) =>
        Promise.resolve(erro ? { data: null, error: erro } : { data: linhas, error: null }).then(resolver),
    };
    return q;
  };
  return { cliente: { from } as unknown as Parameters<typeof montarFilaDoBoard>[0], consultas };
}

const JONATAS = "c34d4b6c-ac71-43ca-b7c2-6a7ec7f69c29";
const NIVEA = "c9451037-f47e-4039-a531-4231dfb5cae9";

function tabelas(papel: string): Record<string, Linha[]> {
  return {
    apolo_enterprise_settings: [
      { credenciamento_ativo: true, enterprise_id: "19", prevenda_habilitada: false, recepcao_cad: true, valor_pix: null },
      { credenciamento_ativo: true, enterprise_id: "35", prevenda_habilitada: false, recepcao_cad: true, valor_pix: null },
      // Ativo, mas com a recepção de CAD desligada (medido em 24/09/2026): não é destino.
      { credenciamento_ativo: true, enterprise_id: "group:Vale do Ouro", prevenda_habilitada: true, recepcao_cad: false, valor_pix: 1000 },
    ],
    apolo_entities: [
      {
        created_at: "2026-09-21T18:14:51Z",
        display_name: "JONATAS BRUCE DE OLIVEIRA",
        document_masked: "062.***.***-02",
        entity_kind: "pf",
        id: JONATAS,
        legal_name: "JONATAS BRUCE DE OLIVEIRA",
        metadata: { bornRole: "prospect", source: "apolo" },
        primary_city: null,
        primary_state: null,
        status: "active",
      },
    ],
    apolo_esteira: [
      {
        analista_id: null,
        atualizado_em: "2026-09-24T15:50:53Z",
        chegou_em: "2026-09-21T18:14:52Z",
        corretor: null,
        created_at: "2026-09-21T18:14:52Z",
        empreendimento: "VEREDAS DO OURO",
        enterprise_id: "19",
        entity_id: JONATAS,
        etapa: "credenciado",
        imobiliaria: null,
        motivo: null,
        pago_em: null,
      },
    ],
    apolo_relationships: [
      { entity_id: JONATAS, metadata: { enterpriseId: "19" }, relationship_type: "empreendimento", status: "archived" },
      { entity_id: JONATAS, metadata: { enterpriseId: "35" }, relationship_type: "empreendimento", status: "verified" },
    ],
    hercules_empreendimentos: CADASTRO.map((linha) => ({
      c2x_enterprise_id: linha.c2xEnterpriseId,
      codigo: linha.codigo,
      id: linha.id,
      nome: linha.nome,
      pai_id: linha.paiId,
    })),
    hub_users: [{ display_name: "Nivea", email: "nivea@careli.adm.br", id: NIVEA, role: papel }],
  };
}

// Uma segunda pessoa, com a CAD gravada na DIVISÃO 36 (Vale do Ouro · VOL): medido em 24/09/2026, há
// CADs assim no banco (2 no 36; 1 em cada uma de 37, 41 e das divisões do Lagoa Bonita).
const DIVISAO = "5a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d";
function comCadNaDivisao(papel: string): Record<string, Linha[]> {
  const base = tabelas(papel);
  return {
    ...base,
    apolo_entities: [
      ...(base.apolo_entities ?? []),
      {
        created_at: "2026-09-10T12:00:00Z",
        display_name: "CLIENTE DO VOL",
        document_masked: "111.***.***-11",
        entity_kind: "pf",
        id: DIVISAO,
        legal_name: "CLIENTE DO VOL",
        metadata: { bornRole: "prospect", source: "apolo" },
        primary_city: null,
        primary_state: null,
        status: "active",
      },
    ],
    apolo_esteira: [
      ...(base.apolo_esteira ?? []),
      {
        analista_id: null,
        atualizado_em: "2026-09-10T12:00:00Z",
        chegou_em: "2026-09-10T12:00:00Z",
        corretor: null,
        created_at: "2026-09-10T12:00:00Z",
        empreendimento: "Vale do Ouro · VOL",
        enterprise_id: "36",
        entity_id: DIVISAO,
        etapa: "credito",
        imobiliaria: null,
        motivo: null,
        pago_em: null,
      },
    ],
  };
}

describe("montarFilaDoBoard: o card do JONATAS e o Mover CAD", () => {
  beforeEach(() => {
    m.catalogo.mockReset();
    m.catalogo.mockResolvedValue(CATALOGO);
  });

  it("⚠️ CAD 19 com vínculo 35: o card diz VEREDAS DO OURO e age no 19", async () => {
    const { cliente } = bancoFalso(tabelas("leader"));
    const fila = await montarFilaDoBoard(cliente, { usuarioId: NIVEA });
    if (!fila.ok) throw new Error(fila.error);

    const card = fila.data.itens.find((item) => item.id === JONATAS);
    expect(card?.enterpriseId).toBe("19");
    expect(card?.empreendimentos).toEqual(["VEREDAS DO OURO"]);
  });

  it("coordenação (leader) recebe os destinos do portão de CAD, sem o grupo de recepção desligada", async () => {
    const { cliente } = bancoFalso(tabelas("leader"));
    const fila = await montarFilaDoBoard(cliente, { usuarioId: NIVEA });
    if (!fila.ok) throw new Error(fila.error);

    expect(fila.data.moverCad).toEqual({
      destinos: [
        { id: "35", nome: "VALE DO OURO" },
        { id: "19", nome: "VEREDAS DO OURO" },
      ],
    });
  });

  it("analista (operator) não recebe o campo: a tela não mostra o botão", async () => {
    const { cliente } = bancoFalso(tabelas("operator"));
    const fila = await montarFilaDoBoard(cliente, { usuarioId: NIVEA });
    if (!fila.ok) throw new Error(fila.error);

    expect(fila.data.moverCad).toBeUndefined();
    expect(JSON.parse(JSON.stringify(fila.data))).not.toHaveProperty("moverCad");
  });

  it("a porta do portal (recorte) nunca recebe, nem para quem é leader no hub", async () => {
    const { cliente, consultas } = bancoFalso(tabelas("leader"));
    const fila = await montarFilaDoBoard(cliente, {
      recorte: { ids: new Set(["19"]), nomes: ["VEREDAS DO OURO"], usuario: { id: NIVEA, nome: "Nivea" } },
      usuarioId: NIVEA,
    });
    if (!fila.ok) throw new Error(fila.error);

    expect(fila.data.moverCad).toBeUndefined();
    expect(fila.data.itens.map((item) => item.empreendimentos)).toEqual([["VEREDAS DO OURO"]]);
    // O portão de CAD nem é lido no portal, nem o cadastro da régua de mercado.
    expect(consultas.filter((tabela) => tabela === "apolo_enterprise_settings")).toHaveLength(1);
    expect(consultas).not.toContain("hercules_empreendimentos");
  });

  it("⚠️ junto com o Mover, cada card leva o id de MERCADO da sua CAD (a divisão 36 vira 35)", async () => {
    // O defeito: o card da CAD 36 diz VALE DO OURO e o seletor oferecia o "Vale do Ouro" (35), que a
    // rota recusa sempre (é o mesmo produto). A tela só consegue tirar o 35 se souber que o 36 é o 35.
    const { cliente } = bancoFalso(comCadNaDivisao("leader"));
    const fila = await montarFilaDoBoard(cliente, { usuarioId: NIVEA });
    if (!fila.ok) throw new Error(fila.error);

    const doVol = fila.data.itens.find((item) => item.id === DIVISAO);
    expect(doVol?.enterpriseId).toBe("36");
    expect(doVol?.enterpriseIdDeMercado).toBe("35");
    expect(doVol?.empreendimentos).toEqual(["VALE DO OURO"]);
    expect(fila.data.itens.find((item) => item.id === JONATAS)?.enterpriseIdDeMercado).toBe("19");
  });

  it("sem o Mover (analista), o item não leva o id de mercado, e o cadastro nem é lido", async () => {
    const { cliente, consultas } = bancoFalso(comCadNaDivisao("operator"));
    const fila = await montarFilaDoBoard(cliente, { usuarioId: NIVEA });
    if (!fila.ok) throw new Error(fila.error);

    for (const item of fila.data.itens) expect(item).not.toHaveProperty("enterpriseIdDeMercado");
    expect(consultas).not.toContain("hercules_empreendimentos");
  });

  it("⚠️ cadastro de empreendimentos fora do ar: sem o botão (fail-closed), e o Board carrega igual", async () => {
    // Sem o cadastro o seletor não sabe qual é o produto da CAD, e a rota responderia 503 de qualquer jeito.
    const { cliente } = bancoFalso(comCadNaDivisao("leader"), ["hercules_empreendimentos"]);
    const fila = await montarFilaDoBoard(cliente, { usuarioId: NIVEA });
    if (!fila.ok) throw new Error(fila.error);

    expect(fila.data.moverCad).toBeUndefined();
    expect(fila.data.itens).toHaveLength(2);
    for (const item of fila.data.itens) expect(item).not.toHaveProperty("enterpriseIdDeMercado");
  });

  it("⚠️ catálogo do C2X fora do ar: os destinos saem VAZIOS, nem o `group:*` entra pelo próprio id", async () => {
    // Vazio é o sinal que a tela lê como "não carregou". Antes, o grupo com o portão aberto aparecia
    // nomeado pelo id, sozinho na lista, e era o destino que a rota gravaria com a sigla.
    m.catalogo.mockResolvedValue([]);
    const base = tabelas("leader");
    const { cliente } = bancoFalso({
      ...base,
      apolo_enterprise_settings: [
        ...(base.apolo_enterprise_settings ?? []),
        { credenciamento_ativo: true, enterprise_id: "group:Lagoa Bonita", prevenda_habilitada: false, recepcao_cad: true, valor_pix: null },
      ],
    });
    const fila = await montarFilaDoBoard(cliente, { usuarioId: NIVEA });
    if (!fila.ok) throw new Error(fila.error);

    expect(fila.data.moverCad).toEqual({ destinos: [] });
  });

  it("portão de CAD fora do ar (leitura com erro): os destinos saem vazios, e o Board carrega igual", async () => {
    const { cliente } = bancoFalso(tabelas("leader"), ["apolo_enterprise_settings"]);
    const fila = await montarFilaDoBoard(cliente, { usuarioId: NIVEA });
    if (!fila.ok) throw new Error(fila.error);

    expect(fila.data.moverCad).toEqual({ destinos: [] });
    expect(fila.data.itens).toHaveLength(1);
  });

  it("⚠️ leitura do portão que LANÇA não derruba a fila: os destinos saem vazios", async () => {
    m.recebendoLanca = true;
    try {
      const { cliente } = bancoFalso(tabelas("leader"));
      const fila = await montarFilaDoBoard(cliente, { usuarioId: NIVEA });
      if (!fila.ok) throw new Error(fila.error);

      expect(fila.data.moverCad).toEqual({ destinos: [] });
      expect(fila.data.itens).toHaveLength(1);
    } finally {
      m.recebendoLanca = false;
    }
  });

  it("sem uuid (atalho local) não há papel para ler, e o botão não aparece", async () => {
    const { cliente } = bancoFalso(tabelas("admin"));
    const fila = await montarFilaDoBoard(cliente, { usuarioId: "local-hub-user" });
    if (!fila.ok) throw new Error(fila.error);
    expect(fila.data.moverCad).toBeUndefined();
  });
});
