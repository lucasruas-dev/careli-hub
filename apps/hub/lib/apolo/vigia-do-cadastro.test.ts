import { describe, expect, it } from "vitest";

import {
  alertaDoAviso,
  conferirCadastro,
  idDaImpressao,
  impressaoDigital,
  motivosDoId,
  protocolosAFechar,
  protocolosQueNasceram,
  resumoDasUnidades,
  retratoAtualizado,
  type CadastroParaOVigia,
  type EmpreendimentoNoC2x,
  type HistoricoDoC2x,
  type MotivoDoVigia,
  type RetratoDoC2x,
} from "./vigia-do-cadastro";

// O VIGIA DO CADASTRO (PAN-124, F3). As fixtures são o estado REAL de 30/09/2026, medido só com
// SELECT: `enterprises` do C2X (37 linhas), `hercules_empreendimentos` do Panteon (38 linhas) e o
// prefixo das 5.541 `hercules_unidades` por id. O que estes testes cobram:
//   1. o ensaio: a primeira rodada gera 2 avisos, o do 30 (2 motivos) e o do 43 (sigla);
//   2. os casos do plano: a auditoria 34214 (43, RDV para PDI) dá 1 aviso com sigla e nome; o renome
//      do 42 dá só o de nome; renome igual ao cadastro ou à trilha não avisa;
//   3. o protocolo fecha quando os lados batem, e a notificação sai só no nascimento;
//   4. nada do JSON da auditoria chega ao aviso.

// ── O C2X em 30/09/2026 ──────────────────────────────────────────────────────
const C2X_HOJE: ReadonlyArray<[number, string, string, string]> = [
  [1, "LOU", "LAVRA DO OURO", "Mateus Leme"],
  [2, "SDT", "SERVIDOR DE TREINAMENTO", "Belo Horizonte"],
  [3, "MDS", "MORADA DA SERRA ", "Capitólio"],
  [4, "LOS", "LAVRA DO OURO", "Mateus Leme"],
  [7, "PDV", "PORTAL DOS VALES", "Itambacuri"],
  [10, "PVS", "PORTAL DOS VALES", "Itambacuri"],
  [11, "VBL", "VIVA BOULEVARD", "Conselheiro Lafaiete"],
  [12, "MLN", "MILENIUM ", "Contagem"],
  [13, "RDP", "RIO DE PEDRAS ", "Itabirito"],
  [14, "RPS", "RIO DE PEDRAS ", "Itabirito"],
  [15, "RPC", "RIO DE PEDRAS", "Itabirito"],
  [17, "EDL", "ESTANCIA DO LAGO ", "Ipatinga"],
  [18, "MLC", "MILENIUM MALL", "Contagem"],
  [19, "VDO", "VEREDAS DO OURO", "Pedro Leopoldo"],
  [20, "REP", "CONDOMINIO RECANTO DO PARA", "Pompéu"],
  [21, "MDB", "MORADA DA BRISA", "Itabira"],
  [22, "CDJ", "CIDADE JARDIM", "Ipatinga"],
  [23, "SOU", "SOUL IPANEMA", "Ipatinga"],
  [24, "PRI", "PRIVILEGE RESIDENCE", "Ituiutaba"],
  [26, "HDP", "HARAS DO PASSO", "Itabirito"],
  [27, "LBR", "LAGOA BONITA", "Governador Valadares"],
  [28, "VDP", "VISTAS DA PRAIA RESIDENCIAL", "Almenara"],
  [29, "VAL", "VISTA ALEGRE", "Desterro de Entre Rios"],
  [30, "ACT", "ALDEIA DA CACHOEIRA DAS PEDRAS - TERMO DE ADESAO E TRANSFERENCIA", "Governador Valadares"],
  [31, "LAB", "LAGOA BONITA - MASTERPLAN", "Governador Valadares"],
  [32, "LBP", "LAGOA BONITA", "Governador Valadares"],
  [33, "LBF", "LAGOA BONITA", "Governador Valadares"],
  [34, "TSC", "TESTE SPLIT CARELI", "Belo Horizonte"],
  [35, "VLO", "VALE DO OURO", "Pará de Minas"],
  [36, "VOL", "VALE DO OURO", "Pará de Minas"],
  [37, "VOC", "VALE DO OURO", "Pará de Minas"],
  [38, "RVP", "RESIDENCIAL VILLA PARIS", "João Monlevade"],
  [39, "GDN", "GARDEN", "Pará de Minas"],
  [40, "JDG", "JARDIM DAS GERAIS", "Sabará"],
  [41, "VOR", "VALE DO OURO", "Pará de Minas"],
  [42, "ACP", "ALDEIA DA CACHOEIRA DAS PEDRAS", "Brumadinho"],
  [43, "PTI", "PORTAL IBITURUNA", "Governador Valadares"],
];

// ── O cadastro do Panteon em 30/09/2026 (os pais sem id, LOX, PDX e RDX, não entram) ──
const CADASTRO_HOJE: ReadonlyArray<[string, string, string, string, string]> = [
  ["1", "LOU", "Lavra do Ouro · LOU", "Mateus Leme", "MG"],
  ["3", "MDS", "Morada da Serra", "Capitólio", "MG"],
  ["4", "LOS", "Lavra do Ouro · LOS", "Mateus Leme", "MG"],
  ["7", "PDV", "Portal dos Vales · PDV", "Itambacuri", "MG"],
  ["10", "PVS", "Portal dos Vales · PVS", "Itambacuri", "MG"],
  ["11", "VBL", "Viva Boulevard", "Conselheiro Lafaiete", "MG"],
  ["12", "MLN", "Milenium", "Contagem", "MG"],
  ["13", "RDP", "Rio de Pedras · RDP", "Itabirito", "MG"],
  ["14", "RPS", "Rio de Pedras · RPS", "Itabirito", "MG"],
  ["15", "RPC", "Rio de Pedras · RPC", "Itabirito", "MG"],
  ["17", "EDL", "Estancia do Lago", "Ipatinga", "MG"],
  ["18", "MLC", "Milenium Mall", "Contagem", "MG"],
  ["19", "VDO", "Veredas do Ouro", "Pedro Leopoldo", "MG"],
  ["20", "REP", "Recanto do Pará", "Pompéu", "MG"],
  ["21", "MDB", "Morada da Brisa", "Itabira", "MG"],
  ["22", "CDJ", "Cidade Jardim", "Ipatinga", "MG"],
  ["23", "SOU", "Soul Ipanema", "Ipatinga", "MG"],
  ["24", "PRI", "Privilege Residence", "Ituiutaba", "MG"],
  ["26", "HDP", "Haras do Passo", "Itabirito", "MG"],
  ["27", "LBR", "Lagoa Bonita · LBR", "Governador Valadares", "MG"],
  ["28", "VDP", "Vistas da Praia", "Almenara", "MG"],
  ["29", "VAL", "Vista Alegre", "Desterro de Entre Rios", "MG"],
  ["31", "LAB", "Lagoa Bonita", "Governador Valadares", "MG"],
  ["32", "LBP", "Lagoa Bonita · LBP", "Governador Valadares", "MG"],
  ["33", "LBF", "Lagoa Bonita · LBF", "Governador Valadares", "MG"],
  ["35", "VLO", "Vale do Ouro", "Pará de Minas", "MG"],
  ["36", "VOL", "Vale do Ouro · VOL", "Pará de Minas", "MG"],
  ["37", "VOC", "Vale do Ouro · VOC", "Pará de Minas", "MG"],
  ["38", "RVP", "Villa Paris", "João Monlevade", "MG"],
  ["39", "GDN", "Garden", "Pará de Minas", "MG"],
  ["40", "JDG", "Jardim das Gerais", "Sabará", "MG"],
  ["41", "VOR", "Vale do Ouro · VOR", "Pará de Minas", "MG"],
  ["42", "ACP", "Aldeia das Cachoeiras das Pedras", "Brumadinho", "MG"],
  ["43", "PDI", "Portal do Ibituruna", "Governador Valadares", "MG"],
  ["9001", "TST", "ZZ TESTE - nao e empreendimento real", "Goiania", "GO"],
];

// ── O prefixo das unidades do Panteon por id, em 30/09/2026 ──
// ⚠️ As do 31 (495) e do 35 (298) incluem as que têm segmento_id (LBF/LBP/LBR e VOC/VOL): o código
// delas começa pela sigla do id, LAB e VLO, e é isso que o teste do segmento cobra.
const UNIDADES_HOJE: ReadonlyArray<[string, string, number]> = [
  ["1", "LOU", 216], ["2", "SDT", 5], ["3", "MDS", 88], ["4", "LOS", 277], ["7", "PDV", 157],
  ["10", "PVS", 114], ["11", "VBL", 42], ["12", "MLN", 40], ["13", "RDP", 374], ["15", "RPC", 13],
  ["17", "EDL", 88], ["18", "MLC", 28], ["19", "VDO", 369], ["20", "REP", 199], ["21", "MDB", 87],
  ["22", "CDJ", 532], ["23", "SOU", 29], ["24", "PRI", 6], ["26", "HDP", 191], ["27", "LBR", 240],
  ["28", "VDP", 138], ["29", "VAL", 126], ["30", "ADT", 31], ["31", "LAB", 495], ["32", "LBP", 125],
  ["33", "LBF", 47], ["34", "TSC", 1], ["35", "VLO", 298], ["36", "VOL", 141], ["37", "VOC", 157],
  ["38", "RVP", 97], ["39", "GDN", 404], ["40", "JDG", 250], ["41", "VOR", 4], ["42", "ACP", 120],
  ["9001", "TST", 12],
];

// ── O que a auditoria do C2X diz que os ids já se chamaram (valores ANTERIORES das trocas) ──
const HISTORICO_HOJE = new Map<string, HistoricoDoC2x>([
  ["30", { nomes: ["LAGOA BONITA - ADITIVO", "CARELI - ADITIVOS"], siglas: ["LAG", "ADT"] }],
  ["42", { nomes: ["ALDEIA DAS CACHOEIRAS DAS PEDRAS", "ALDEIA DA CACHOEIRAS DAS PEDRAS"], siglas: [] }],
  ["43", { nomes: ["RECANTO DO VALE", "PORTAL DO IBITURUNA"], siglas: ["RDV", "PDI", "PLI"] }],
]);

function c2xDe(linhas: typeof C2X_HOJE): Map<string, EmpreendimentoNoC2x> {
  return new Map(
    linhas.map(([id, codigo, nome, cidade]) => [
      String(id),
      { cidade, codigo, id: String(id), nome: nome.trim(), uf: "MG" },
    ]),
  );
}

function cadastroDe(linhas: typeof CADASTRO_HOJE): Map<string, CadastroParaOVigia> {
  return new Map(
    linhas.map(([c2xId, codigo, nome, cidade, uf]) => [
      c2xId,
      { c2xId, cidade, codigo, id: `uuid-${c2xId}`, nome, uf },
    ]),
  );
}

function unidadesDe(linhas: typeof UNIDADES_HOJE): Map<string, string[]> {
  return new Map(
    linhas.map(([id, prefixo, n]) => [
      id,
      Array.from({ length: n }, (_, i) => `${prefixo}${String(i + 1).padStart(4, "0")}`),
    ]),
  );
}

function retrato(parcial: Partial<RetratoDoC2x> & Pick<RetratoDoC2x, "codigo" | "enterpriseId" | "nome">): RetratoDoC2x {
  return {
    cidade: "Governador Valadares",
    nomeAceito: parcial.nome,
    nomesAnteriores: [],
    prefixosDivergentes: 0,
    siglaDivergenteAceita: false,
    siglasAnteriores: [],
    uf: "MG",
    ultimaAuditoriaId: null,
    ...parcial,
  };
}

function primeiraRodada() {
  const c2x = c2xDe(C2X_HOJE);
  const cadastros = cadastroDe(CADASTRO_HOJE);

  return conferirCadastro({
    auditorias: new Map([["43", 34722], ["30", 33689], ["42", 31502]]),
    c2x,
    cadastros,
    historico: HISTORICO_HOJE,
    ids: new Set([...c2x.keys(), ...cadastros.keys()]),
    nomesAntigosDoCadastro: new Map(),
    retratos: new Map(),
    unidades: unidadesDe(UNIDADES_HOJE),
  });
}

describe("vigia do cadastro: o ensaio com o estado de 30/09/2026", () => {
  it("a primeira rodada gera 2 avisos: o 30 com 2 motivos e o 43 com a sigla", () => {
    const { avisos } = primeiraRodada();

    expect(avisos.map((aviso) => aviso.enterpriseId)).toEqual(["30", "43"]);
    expect(avisos[0]!.motivos).toEqual<MotivoDoVigia[]>([
      { tipo: "sem_cadastro" },
      { encontrados: ["ADT"], esperado: "ACT", fora: 31, tipo: "prefixo", total: 31 },
    ]);
    expect(avisos[1]!.motivos).toEqual<MotivoDoVigia[]>([
      { cadastro: "PDI", c2x: "PTI", tipo: "sigla" },
    ]);
  });

  it("nenhum aviso de nome, cidade ou UF: o retrato nasce aceitando os 18 nomes de mercado diferentes", () => {
    const tipos = primeiraRodada().avisos.flatMap((aviso) => aviso.motivos.map((m) => m.tipo));

    expect(tipos).not.toContain("nome");
    expect(tipos).not.toContain("cidade");
    expect(tipos).not.toContain("uf");
  });

  it("o retrato tem os 37 ids do C2X, testes inclusive, e nenhum id inventado do Panteon", () => {
    const { conferidos, retratos } = primeiraRodada();
    const ids = retratos.map((r) => r.enterpriseId);

    expect(retratos).toHaveLength(37);
    expect(ids).toContain("2");
    expect(ids).toContain("34");
    expect(ids).not.toContain("9001");
    // conferidos = sem os de teste (2 e 34) e sem o ZZ TESTE
    expect(conferidos).toHaveLength(35);
    expect(conferidos).not.toContain("2");
    expect(conferidos).not.toContain("34");
    expect(conferidos).not.toContain("9001");
  });

  it("o retrato do 43 guarda o que ele já se chamou, sem repetir o nome de hoje", () => {
    const r43 = primeiraRodada().retratos.find((r) => r.enterpriseId === "43")!;

    expect(r43.codigo).toBe("PTI");
    expect(r43.nomeAceito).toBe("PORTAL IBITURUNA");
    expect(r43.siglasAnteriores).toEqual(["RDV", "PDI", "PLI"]);
    expect(r43.nomesAnteriores).toEqual(["RECANTO DO VALE", "PORTAL DO IBITURUNA"]);
    expect(r43.ultimaAuditoriaId).toBe(34722);
  });

  it("o prefixo é pela sigla do id, não pelo segmento: LAB (31) e VLO (35) não alarmam", () => {
    const { avisos, retratos } = primeiraRodada();

    expect(avisos.find((a) => a.enterpriseId === "31")).toBeUndefined();
    expect(avisos.find((a) => a.enterpriseId === "35")).toBeUndefined();
    expect(retratos.find((r) => r.enterpriseId === "30")!.prefixosDivergentes).toBe(31);
  });
});

describe("vigia do cadastro: os casos do plano", () => {
  it("a auditoria 34214 (43, RDV para PDI) gera 1 aviso com 2 motivos, sigla e nome", () => {
    const { avisos, retratos } = conferirCadastro({
      auditorias: new Map([["43", 34214]]),
      c2x: new Map([["43", { cidade: "Governador Valadares", codigo: "PDI", id: "43", nome: "PORTAL DO IBITURUNA", uf: "MG" }]]),
      cadastros: new Map([["43", { c2xId: "43", cidade: "Governador Valadares", codigo: "RDV", id: "uuid-43", nome: "Recanto do Vale", uf: "MG" }]]),
      ids: ["43"],
      nomesAntigosDoCadastro: new Map(),
      retratos: new Map([["43", retrato({ codigo: "RDV", enterpriseId: "43", nome: "RECANTO DO VALE", ultimaAuditoriaId: 34101 })]]),
      unidades: new Map(),
    });

    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.motivos.map((m) => m.tipo)).toEqual(["sigla", "nome"]);
    expect(retratos[0]!.siglasAnteriores).toEqual(["RDV"]);
    expect(retratos[0]!.nomesAnteriores).toEqual(["RECANTO DO VALE"]);
    expect(retratos[0]!.ultimaAuditoriaId).toBe(34214);
  });

  it("o renome do 42 no C2X gera só o aviso de nome", () => {
    const { avisos } = conferirCadastro({
      auditorias: new Map([["42", 31501]]),
      c2x: new Map([["42", { cidade: "Brumadinho", codigo: "ACP", id: "42", nome: "ALDEIA DA CACHOEIRAS DAS PEDRAS", uf: "MG" }]]),
      cadastros: new Map([["42", { c2xId: "42", cidade: "Brumadinho", codigo: "ACP", id: "uuid-42", nome: "Aldeia das Cachoeiras das Pedras", uf: "MG" }]]),
      ids: ["42"],
      nomesAntigosDoCadastro: new Map(),
      retratos: new Map([["42", retrato({ cidade: "Brumadinho", codigo: "ACP", enterpriseId: "42", nome: "ALDEIA DAS CACHOEIRAS DAS PEDRAS" })]]),
      unidades: new Map([["42", ["ACP0101", "ACPPARQUE GUAIBIM-0210"]]]),
    });

    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.motivos).toEqual<MotivoDoVigia[]>([
      { aceito: "ALDEIA DAS CACHOEIRAS DAS PEDRAS", c2x: "ALDEIA DA CACHOEIRAS DAS PEDRAS", tipo: "nome" },
    ]);
  });

  it("renome no C2X igual ao nome do cadastro não avisa: só o retrato anda (o silêncio)", () => {
    const anterior = retrato({ codigo: "PDI", enterpriseId: "43", nome: "RECANTO DO VALE" });
    const novo = retratoAtualizado({
      anterior,
      auditoriaId: 34214,
      c2x: { cidade: "Governador Valadares", codigo: "PDI", id: "43", nome: "PORTAL DO IBITURUNA", uf: "MG" },
      nomesDoPanteon: ["Portal do Ibituruna"],
      prefixosDivergentes: 0,
    });

    expect(novo.nomeAceito).toBe("PORTAL DO IBITURUNA");
    expect(novo.nomesAnteriores).toEqual(["RECANTO DO VALE"]);
    expect(
      motivosDoId({
        cadastro: { c2xId: "43", cidade: "Governador Valadares", codigo: "PDI", id: "uuid-43", nome: "Portal do Ibituruna", uf: "MG" },
        c2x: { cidade: "Governador Valadares", codigo: "PDI", id: "43", nome: "PORTAL DO IBITURUNA", uf: "MG" },
        retrato: novo,
        unidades: null,
      }),
    ).toEqual([]);
  });

  it("renome no C2X para um nome que já valeu no cadastro (trilha da 0192) também não avisa", () => {
    const { avisos, retratos } = conferirCadastro({
      auditorias: new Map([["40", 40000]]),
      c2x: new Map([["40", { cidade: "Sabará", codigo: "JDG", id: "40", nome: "JARDINS DE SABARA", uf: "MG" }]]),
      cadastros: new Map([["40", { c2xId: "40", cidade: "Sabará", codigo: "JDG", id: "uuid-40", nome: "Jardim das Gerais", uf: "MG" }]]),
      ids: ["40"],
      nomesAntigosDoCadastro: new Map([["uuid-40", ["Jardins de Sabará"]]]),
      retratos: new Map([["40", retrato({ cidade: "Sabará", codigo: "JDG", enterpriseId: "40", nome: "JARDIM DAS GERAIS" })]]),
      unidades: new Map([["40", ["JDG0101"]]]),
    });

    expect(avisos).toEqual([]);
    expect(retratos[0]!.nomeAceito).toBe("JARDINS DE SABARA");
  });

  it("sigla aceita cala o motivo; o C2X trocando de novo derruba o aceite", () => {
    const base = {
      cadastro: { c2xId: "43", cidade: "Governador Valadares", codigo: "PDI", id: "uuid-43", nome: "Portal do Ibituruna", uf: "MG" },
      unidades: null,
    };
    const aceito = retrato({ codigo: "PTI", enterpriseId: "43", nome: "PORTAL IBITURUNA", siglaDivergenteAceita: true });
    const c2xPti = { cidade: "Governador Valadares", codigo: "PTI", id: "43", nome: "PORTAL IBITURUNA", uf: "MG" };

    expect(motivosDoId({ ...base, c2x: c2xPti, retrato: aceito })).toEqual([]);

    const c2xPtx = { ...c2xPti, codigo: "PTX" };
    const depois = retratoAtualizado({ anterior: aceito, auditoriaId: 40001, c2x: c2xPtx, nomesDoPanteon: [], prefixosDivergentes: 0 });

    expect(depois.siglaDivergenteAceita).toBe(false);
    expect(motivosDoId({ ...base, c2x: c2xPtx, retrato: depois }).map((m) => m.tipo)).toEqual(["sigla"]);
  });

  it("cidade e UF comparam sem acento e sem caixa, e divergência de verdade vira motivo", () => {
    const cadastro = { c2xId: "39", cidade: "Pará de Minas", codigo: "GDN", id: "uuid-39", nome: "Garden", uf: "MG" };
    const r = retrato({ cidade: "PARA DE MINAS", codigo: "GDN", enterpriseId: "39", nome: "GARDEN" });

    expect(motivosDoId({ cadastro, c2x: { cidade: "PARA DE  MINAS", codigo: "GDN", id: "39", nome: "GARDEN", uf: "mg" }, retrato: r, unidades: null })).toEqual([]);
    expect(
      motivosDoId({ cadastro, c2x: { cidade: "Itaúna", codigo: "GDN", id: "39", nome: "GARDEN", uf: "MG" }, retrato: r, unidades: null }),
    ).toEqual([{ cadastro: "Pará de Minas", c2x: "Itaúna", tipo: "cidade" }]);
  });

  it("id legado que sumiu do C2X avisa; produto do Panteon (100000+) e ZZ TESTE não", () => {
    const { avisos } = conferirCadastro({
      auditorias: new Map(),
      c2x: new Map(),
      cadastros: new Map([
        ["44", { c2xId: "44", cidade: "Contagem", codigo: "XPT", id: "uuid-44", nome: "Exemplo", uf: "MG" }],
        ["100001", { c2xId: "100001", cidade: "Contagem", codigo: "NOV", id: "uuid-n", nome: "Novo do Panteon", uf: "MG" }],
        ["9001", { c2xId: "9001", cidade: "Goiania", codigo: "TST", id: "uuid-t", nome: "ZZ TESTE - nao e empreendimento real", uf: "GO" }],
      ]),
      ids: ["44", "100001", "9001"],
      nomesAntigosDoCadastro: new Map(),
      retratos: new Map(),
      unidades: new Map(),
    });

    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.motivos).toEqual([{ codigo: "XPT", tipo: "sumiu_do_c2x" }]);
    expect(alertaDoAviso(avisos[0]!, new Date("2026-09-30T10:00:00Z")).level).toBe("alto");
  });
});

describe("vigia do cadastro: protocolo e notificação", () => {
  const sigla43 = impressaoDigital("43", [{ cadastro: "PDI", c2x: "PTI", tipo: "sigla" }]);
  const trinta = impressaoDigital("30", [
    { tipo: "sem_cadastro" },
    { encontrados: ["ADT"], esperado: "ACT", fora: 31, tipo: "prefixo", total: 31 },
  ]);

  it("a impressão leva os valores e não as contagens: uma unidade ADT a mais não abre protocolo novo", () => {
    const comMais = impressaoDigital("30", [
      { tipo: "sem_cadastro" },
      { encontrados: ["ADT"], esperado: "ACT", fora: 32, tipo: "prefixo", total: 32 },
    ]);

    expect(comMais).toBe(trinta);
    expect(trinta).toBe("cadastro-c2x:30:prefixo=ACT:ADT|sem_cadastro");
    expect(idDaImpressao(trinta)).toBe("30");
    expect(idDaImpressao("outra-fonte:30")).toBeNull();
  });

  it("fecha o protocolo do id conferido que voltou a bater, e só ele", () => {
    const abertos = [
      { fingerprint: sigla43, protocol: "AL-0101" },
      { fingerprint: trinta, protocol: "AL-0102" },
      { fingerprint: "cadastro-c2x:42:nome=X", protocol: "AL-0103" },
    ];

    // Rodada por evento no 43 e no 30: o 43 bateu, o 30 segue igual, o 42 não foi conferido.
    expect(protocolosAFechar(abertos, ["43", "30"], [trinta])).toEqual([
      { fingerprint: sigla43, protocol: "AL-0101" },
    ]);
  });

  it("divergência que muda fecha o protocolo velho (a nova nasce com o seu)", () => {
    const novo = impressaoDigital("43", [{ cadastro: "PDI", c2x: "PTX", tipo: "sigla" }]);

    expect(protocolosAFechar([{ fingerprint: sigla43, protocol: "AL-0101" }], ["43"], [novo])).toHaveLength(1);
  });

  it("notifica só o protocolo que nasceu nesta rodada, e só os do vigia", () => {
    const nascidos = protocolosQueNasceram([
      { fingerprint: sigla43, occurrenceCount: 1 },
      { fingerprint: trinta, occurrenceCount: 4 },
      { fingerprint: "zeus:api-lenta", occurrenceCount: 1 },
    ]);

    expect(nascidos.map((p) => p.fingerprint)).toEqual([sigla43]);
  });

  it("o alerta vai no formato do Zeus, com o protocolo no comando e nada da auditoria do C2X", () => {
    const [aviso30] = primeiraRodada().avisos;
    const alerta = alertaDoAviso(aviso30!, new Date("2026-09-30T10:00:00Z"));
    const texto = JSON.stringify(alerta);

    expect(alerta.type).toBe("cadastro_divergente");
    expect(alerta.level).toBe("medio");
    expect(alerta.fingerprint).toBe(trinta);
    expect(alerta.command).toContain(alerta.protocol);
    expect(alerta.receivedResult).toContain("31 de 31 unidades do Panteon começam por ADT");
    for (const proibido of ["audited_changes", "username", "remote_address", "user_id", "request_uuid"]) {
      expect(texto).not.toContain(proibido);
    }
  });
});

describe("vigia do cadastro: o prefixo das unidades", () => {
  it("o código não tem formato fixo depois da sigla", () => {
    expect(resumoDasUnidades(["ACP0101", "ACPPARQUE GUAIBIM-0210", " acp0102 "], "ACP")).toEqual({
      encontrados: [],
      esperado: "ACP",
      fora: 0,
      total: 3,
    });
    expect(resumoDasUnidades(["RVPF01", "ADT0101"], "RVP").encontrados).toEqual(["ADT"]);
  });
});
