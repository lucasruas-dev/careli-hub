import { describe, expect, it } from "vitest";

import {
  setEnterpriseAnaliseCredito,
  setEnterpriseComissaoCoordenadora,
  setEnterpriseComissaoImobiliaria,
  setEnterpriseComprovanteRenda,
  setEnterpriseCoordenadora,
  setEnterpriseCredenciamento,
  setEnterpriseEntradaMinima,
  setEnterpriseGestaoCarteira,
  setEnterpriseLimiteCredito,
  setEnterpriseOrdemDeAssinatura,
  setEnterprisePrevenda,
  setEnterpriseRecepcaoCad,
  setEnterpriseRecepcaoImobiliaria,
  setEnterpriseValorPix,
  siglaDoCadastro,
} from "./enterprise-settings";

// A SIGLA DE `apolo_enterprise_settings` DEIXA DE VIR DA TELA (Lucas, 24/09/2026: "pode" para travar
// as portas por onde o C2X ainda mexe no Panteon).
//
// A tela manda a sigla que o C2X mostra na hora. Os setters gravavam essa sigla, e o
// `setEnterpriseCredenciamento` gravava `code: input.code ?? null`, apagando-a quando a chamada não
// trazia nenhuma. Com o 43 renomeado no legado (RDV virou PDI) e a sigla parada aqui, o aviso ao
// coordenador (que busca pela sigla) voltou vazio e a LUNA não foi avisada da CONECTTA.
//
// O que estes testes cobram, em TODOS os setters:
//   1. a sigla gravada é a do cadastro do Panteon (`hercules_empreendimentos.codigo`), pelo id;
//   2. sigla velha é realinhada no primeiro clique (RDV vira PDI);
//   3. sem sigla do cadastro (o 30, fora do cadastro; o grupo da Lagoa Bonita; leitura que falhou),
//      a sigla da linha existente FICA, não vira nula;
//   4. linha nova nasce com a sigla do cadastro, ou sem sigla, nunca com a da tela.

type Linha = Record<string, unknown>;

// Banco em memória com o encadeamento que os setters usam: select/eq/limit/maybeSingle, update/eq,
// insert e upsert (este casando pela coluna de `onConflict`, como o Postgres).
function bancoFake(inicial: { cadastro: Linha[]; settings: Linha[] }, opcoes?: { cadastroFalha?: boolean }) {
  const tabelas: Record<string, Linha[]> = {
    apolo_enterprise_settings: inicial.settings.map((l) => ({ ...l })),
    hercules_empreendimentos: inicial.cadastro.map((l) => ({ ...l })),
  };

  const client = {
    from(tabela: string) {
      const filtros: Array<[string, unknown]> = [];
      let operacao: "select" | "update" = "select";
      let patch: Linha = {};
      const linhas = (tabelas[tabela] ??= []);
      const casam = () => linhas.filter((l) => filtros.every(([coluna, valor]) => l[coluna] === valor));

      const executar = () => {
        if (tabela === "hercules_empreendimentos" && opcoes?.cadastroFalha) {
          return { data: null, error: { message: "cadastro fora do ar" } };
        }
        if (operacao === "update") {
          for (const l of casam()) Object.assign(l, patch);
          return { data: null, error: null };
        }
        return { data: casam().map((l) => ({ ...l })), error: null };
      };

      const builder = {
        eq(coluna: string, valor: unknown) {
          filtros.push([coluna, valor]);
          return builder;
        },
        insert(linha: Linha) {
          linhas.push({ ...linha });
          return Promise.resolve({ data: null, error: null });
        },
        limit() {
          return builder;
        },
        maybeSingle() {
          const r = executar();
          return Promise.resolve({ data: (r.data as Linha[] | null)?.[0] ?? null, error: r.error });
        },
        select() {
          return builder;
        },
        then(resolver: (v: unknown) => unknown, rejeitar?: (e: unknown) => unknown) {
          return Promise.resolve(executar()).then(resolver, rejeitar);
        },
        update(novo: Linha) {
          operacao = "update";
          patch = novo;
          return builder;
        },
        upsert(linha: Linha, o?: { onConflict?: string }) {
          const chave = o?.onConflict ?? "id";
          const atual = linhas.find((l) => l[chave] === linha[chave]);
          if (atual) Object.assign(atual, linha);
          else linhas.push({ ...linha });
          return Promise.resolve({ data: null, error: null });
        },
      };
      return builder;
    },
  };

  const settings = (id: string) => tabelas.apolo_enterprise_settings?.find((l) => l.enterprise_id === id);
  return { client: client as never, settings };
}

// Fotografia de 24/09/2026: o cadastro já diz PDI; o settings do 43 ficou RDV (antes do conserto de
// dado); o 30 está fora do cadastro com ADT; o grupo da Lagoa Bonita guarda a junção das siglas.
const CADASTRO: Linha[] = [
  { c2x_enterprise_id: "43", codigo: "PDI", workspace_id: "careli" },
  { c2x_enterprise_id: "33", codigo: "LBF", workspace_id: "careli" },
  { c2x_enterprise_id: "27", codigo: "LBR", workspace_id: "careli" },
];
const SETTINGS: Linha[] = [
  { code: "RDV", credenciamento_ativo: true, enterprise_id: "43" },
  { code: "ADT", credenciamento_ativo: false, enterprise_id: "30" },
  { code: "LBF + LBR + LBP", credenciamento_ativo: true, enterprise_id: "group:Lagoa Bonita" },
];

describe("siglaDoCadastro", () => {
  it("é a do cadastro do Panteon, pelo id do C2X", async () => {
    const { client } = bancoFake({ cadastro: CADASTRO, settings: [] });
    expect(await siglaDoCadastro(client, "43")).toBe("PDI");
  });

  it("id fora do cadastro, grupo ou leitura que falhou: null (quem grava preserva)", async () => {
    const { client } = bancoFake({ cadastro: CADASTRO, settings: [] });
    expect(await siglaDoCadastro(client, "30")).toBeNull();
    expect(await siglaDoCadastro(client, "group:Lagoa Bonita")).toBeNull();

    const fora = bancoFake({ cadastro: CADASTRO, settings: [] }, { cadastroFalha: true });
    expect(await siglaDoCadastro(fora.client, "43")).toBeNull();
  });
});

describe("setEnterpriseCredenciamento: o toggle não mexe mais na sigla por conta da tela", () => {
  it("sigla velha é realinhada com o cadastro (RDV vira PDI)", async () => {
    const banco = bancoFake({ cadastro: CADASTRO, settings: SETTINGS });
    const r = await setEnterpriseCredenciamento({ adminClient: banco.client, ativo: false, enterpriseId: "43" });

    expect(r.ok).toBe(true);
    expect(banco.settings("43")).toMatchObject({ code: "PDI", credenciamento_ativo: false });
  });

  it("chamada sem sigla NÃO zera a do empreendimento fora do cadastro (o 30 fica ADT)", async () => {
    // Antes: `code: input.code ?? null` no upsert, e o 30 perdia a sigla num clique.
    const banco = bancoFake({ cadastro: CADASTRO, settings: SETTINGS });
    await setEnterpriseCredenciamento({ adminClient: banco.client, ativo: true, enterpriseId: "30" });

    expect(banco.settings("30")).toMatchObject({ code: "ADT", credenciamento_ativo: true });
  });

  it("grupo: a sigla que já existe fica", async () => {
    const banco = bancoFake({ cadastro: CADASTRO, settings: SETTINGS });
    await setEnterpriseCredenciamento({
      adminClient: banco.client,
      ativo: false,
      enterpriseId: "group:Lagoa Bonita",
    });

    expect(banco.settings("group:Lagoa Bonita")?.code).toBe("LBF + LBR + LBP");
  });

  it("cadastro fora do ar: a sigla fica como está, e o toggle salva", async () => {
    const banco = bancoFake({ cadastro: CADASTRO, settings: SETTINGS }, { cadastroFalha: true });
    const r = await setEnterpriseCredenciamento({ adminClient: banco.client, ativo: false, enterpriseId: "43" });

    expect(r.ok).toBe(true);
    expect(banco.settings("43")).toMatchObject({ code: "RDV", credenciamento_ativo: false });
  });

  it("linha nova nasce com a sigla do cadastro", async () => {
    const banco = bancoFake({ cadastro: CADASTRO, settings: [] });
    await setEnterpriseCredenciamento({ adminClient: banco.client, ativo: true, enterpriseId: "43" });

    expect(banco.settings("43")).toMatchObject({ code: "PDI", credenciamento_ativo: true });
  });
});

// Os outros setters: todos passam pela mesma régua. Cada um recebe o id e grava o próprio campo.
const SETTERS: Array<[string, (client: never, enterpriseId: string) => Promise<{ ok: boolean }>]> = [
  ["análise de crédito", (c, id) => setEnterpriseAnaliseCredito({ adminClient: c, enterpriseId: id, habilitada: true })],
  ["comprovante de renda", (c, id) => setEnterpriseComprovanteRenda({ adminClient: c, enterpriseId: id, habilitada: true })],
  ["pré-venda", (c, id) => setEnterprisePrevenda({ adminClient: c, enterpriseId: id, habilitada: false })],
  ["recepção de CAD", (c, id) => setEnterpriseRecepcaoCad({ adminClient: c, enterpriseId: id, habilitada: false })],
  [
    "recepção de imobiliária",
    (c, id) => setEnterpriseRecepcaoImobiliaria({ adminClient: c, enterpriseId: id, habilitada: false }),
  ],
  ["valor do PIX", (c, id) => setEnterpriseValorPix({ adminClient: c, enterpriseId: id, valor: 1500 })],
  ["limite de crédito", (c, id) => setEnterpriseLimiteCredito({ adminClient: c, enterpriseId: id, limite: 2000 })],
  ["gestão de carteira", (c, id) => setEnterpriseGestaoCarteira({ adminClient: c, enterpriseId: id, percentual: 97 })],
  ["entrada mínima", (c, id) => setEnterpriseEntradaMinima({ adminClient: c, enterpriseId: id, percentual: 10 })],
  [
    "comissão da coordenadora",
    (c, id) => setEnterpriseComissaoCoordenadora({ adminClient: c, enterpriseId: id, percentual: 1 }),
  ],
  [
    "comissão da imobiliária",
    (c, id) => setEnterpriseComissaoImobiliaria({ adminClient: c, enterpriseId: id, percentual: 5 }),
  ],
  [
    "coordenadora",
    (c, id) =>
      setEnterpriseCoordenadora({
        adminClient: c,
        enterpriseId: id,
        entityId: "fb8bf3fc-d7d3-5855-a615-74be8c6f235c",
      }),
  ],
  [
    "ordem de assinatura",
    (c, id) => setEnterpriseOrdemDeAssinatura({ adminClient: c, enterpriseId: id, ordem: null, ordenada: false }),
  ],
];

describe.each(SETTERS)("setter de %s", (_nome, gravar) => {
  it("linha existente com sigla velha: realinha com o cadastro", async () => {
    const banco = bancoFake({ cadastro: CADASTRO, settings: SETTINGS });
    expect((await gravar(banco.client, "43")).ok).toBe(true);
    expect(banco.settings("43")?.code).toBe("PDI");
  });

  it("linha existente fora do cadastro: a sigla fica (não zera)", async () => {
    const banco = bancoFake({ cadastro: CADASTRO, settings: SETTINGS });
    expect((await gravar(banco.client, "30")).ok).toBe(true);
    expect(banco.settings("30")?.code).toBe("ADT");
  });

  it("grupo: a sigla que já existe fica", async () => {
    const banco = bancoFake({ cadastro: CADASTRO, settings: SETTINGS });
    expect((await gravar(banco.client, "group:Lagoa Bonita")).ok).toBe(true);
    expect(banco.settings("group:Lagoa Bonita")?.code).toBe("LBF + LBR + LBP");
  });

  it("linha nova: nasce com a sigla do cadastro, e sem credenciamento ligado", async () => {
    const banco = bancoFake({ cadastro: CADASTRO, settings: [] });
    expect((await gravar(banco.client, "33")).ok).toBe(true);
    expect(banco.settings("33")).toMatchObject({ code: "LBF", credenciamento_ativo: false });
  });

  it("linha nova fora do cadastro: nasce sem sigla", async () => {
    const banco = bancoFake({ cadastro: CADASTRO, settings: [] });
    expect((await gravar(banco.client, "30")).ok).toBe(true);
    expect(banco.settings("30")?.code).toBeNull();
  });
});
