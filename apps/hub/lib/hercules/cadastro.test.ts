import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  carregarCadastroDeEmpreendimentos,
  lerCadastroDeEmpreendimentos,
  limparMemoriaDaMigration0170,
  mapearLinhaDoCadastro,
  soDoPanteon,
} from "./cadastro";

// Client fake: builder encadeável e "thenable", no espírito de recepcao-portoes.test.ts.
// `sem0170: true` simula o banco SEM a migration 0170: o select que pede as colunas novas devolve
// o PGRST204 do schema cache. `erroQualquer` simula um erro que NÃO é de coluna da 0170.
const banco = vi.hoisted(() => ({
  erroQualquer: false,
  linhas: [] as Record<string, unknown>[],
  selects: [] as string[],
  sem0170: false,
}));

vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: () => ({
    from() {
      let colunas = "";
      const builder = {
        eq: () => builder,
        order: () => builder,
        range: () => builder,
        returns: () => builder,
        select(cols: string) {
          colunas = cols;
          banco.selects.push(cols);
          return builder;
        },
        then(resolver: (valor: unknown) => unknown) {
          if (banco.erroQualquer) {
            return Promise.resolve(
              resolver({ data: null, error: { code: "42501", message: "permission denied" } }),
            );
          }
          if (banco.sem0170 && /operado_por|tipo_produto/.test(colunas)) {
            return Promise.resolve(
              resolver({
                data: null,
                error: {
                  code: "PGRST204",
                  message: "Could not find the 'operado_por' column of 'hercules_empreendimentos' in the schema cache",
                },
              }),
            );
          }
          const campos = colunas.split(",");
          const data = banco.linhas.map((l) =>
            Object.fromEntries(Object.entries(l).filter(([k]) => campos.includes(k))),
          );
          return Promise.resolve(resolver({ data, error: null }));
        },
      };
      return builder;
    },
  }),
}));

const LINHA_DO_BANCO = {
  c2x_enterprise_id: " 100000 ",
  cidade: "Ipatinga",
  codigo: "jad",
  id: "u-jad",
  nome: "Ed. Jade",
  operado_por: "inc-cecilio",
  ordem: 3,
  pai_id: null,
  tipo_produto: "vertical",
  uf: "mg",
  vendendo: true,
};

describe("mapearLinhaDoCadastro · colunas da 0170", () => {
  it("lê quem opera e o tipo do produto", () => {
    const linha = mapearLinhaDoCadastro(LINHA_DO_BANCO);
    expect(linha.operadoPor).toBe("inc-cecilio");
    expect(linha.tipoProduto).toBe("vertical");
    expect(linha.c2xEnterpriseId).toBe("100000");
  });

  it("⚠️ sem as colunas: Careli opera, loteamento", () => {
    const { operado_por: _o, tipo_produto: _t, ...semColunas } = LINHA_DO_BANCO;
    const linha = mapearLinhaDoCadastro(semColunas);
    expect(linha.operadoPor).toBeNull();
    expect(linha.tipoProduto).toBe("loteamento");
  });
});

describe("carregarCadastroDeEmpreendimentos · migration 0170 pendente", () => {
  beforeEach(() => {
    banco.erroQualquer = false;
    banco.linhas = [LINHA_DO_BANCO];
    banco.selects = [];
    banco.sem0170 = false;
    limparMemoriaDaMigration0170();
  });

  it("com a 0170, pede as colunas novas numa leitura só", async () => {
    const cadastro = await carregarCadastroDeEmpreendimentos();
    expect(banco.selects).toHaveLength(1);
    expect(cadastro[0]).toMatchObject({ codigo: "JAD", operadoPor: "inc-cecilio", tipoProduto: "vertical" });
  });

  it("⚠️ sem a 0170, repete sem as colunas e NÃO derruba o cadastro", async () => {
    banco.sem0170 = true;
    const cadastro = await carregarCadastroDeEmpreendimentos();
    expect(banco.selects).toHaveLength(2);
    expect(banco.selects[1]).not.toMatch(/operado_por|tipo_produto/);
    expect(cadastro[0]).toMatchObject({ codigo: "JAD", operadoPor: null, tipoProduto: "loteamento" });
  });

  it("⚠️ a 0170 pendente fica na memória: a próxima leitura já vai sem as colunas (uma requisição só)", async () => {
    banco.sem0170 = true;
    await carregarCadastroDeEmpreendimentos();
    banco.selects = [];
    const segunda = await lerCadastroDeEmpreendimentos();
    expect(banco.selects).toHaveLength(1);
    expect(banco.selects[0]).not.toMatch(/operado_por|tipo_produto/);
    expect(segunda.com0170).toBe(false);

    // Esquecida a memória (ou passado o prazo), a leitura volta a pedir as colunas.
    banco.sem0170 = false;
    limparMemoriaDaMigration0170();
    banco.selects = [];
    const terceira = await lerCadastroDeEmpreendimentos();
    expect(banco.selects).toHaveLength(1);
    expect(terceira.com0170).toBe(true);
  });

  it("⚠️ quem grava sabe se as colunas da 0170 vieram", async () => {
    expect((await lerCadastroDeEmpreendimentos()).com0170).toBe(true);
    limparMemoriaDaMigration0170();
    banco.sem0170 = true;
    expect((await lerCadastroDeEmpreendimentos()).com0170).toBe(false);
  });

  it("⚠️ erro que não é de coluna da 0170 continua lançando", async () => {
    banco.erroQualquer = true;
    await expect(carregarCadastroDeEmpreendimentos()).rejects.toThrow(/permission denied/);
    expect(banco.selects).toHaveLength(1);
  });
});


describe("soDoPanteon", () => {
  const CADASTRO = [
    { c2xEnterpriseId: "35", cidade: null, codigo: "VLO", id: "u-vlo", nome: "Vale do Ouro", ordem: 0, paiId: null, uf: null, vendendo: true },
    { c2xEnterpriseId: "9001", cidade: null, codigo: "TST", id: "u-tst", nome: "ZZ TESTE", ordem: 999, paiId: null, uf: null, vendendo: true },
    { c2xEnterpriseId: null, cidade: null, codigo: "LOX", id: "u-lox", nome: "Lavra do Ouro", ordem: 1, paiId: null, uf: null, vendendo: false },
  ];
  const NO_C2X = new Set(["35", "36", "37"]);

  it("⚠️ devolve o que existe SÓ no Panteon", () => {
    // Sem isto o empreendimento some da tela Venda inteira: o escopo do portal é traduzido em
    // códigos pelo catálogo do C2X, e quem não está lá não vira código.
    expect(soDoPanteon(CADASTRO, ["35", "9001"], NO_C2X)).toEqual([
      { codigo: "TST", enterpriseId: "9001" },
    ]);
  });

  it("⚠️ NÃO amplia permissão: só sai o que a sessão já traz", () => {
    expect(soDoPanteon(CADASTRO, ["35"], NO_C2X)).toEqual([]);
    expect(soDoPanteon(CADASTRO, [], NO_C2X)).toEqual([]);
  });

  it("empreendimento sem id do C2X fica de fora", () => {
    // A Lavra do Ouro é pai de grupo sem espelho no legado: não tem id para casar com unidade.
    expect(soDoPanteon(CADASTRO, ["35", "9001", "LOX"], NO_C2X).map((p) => p.codigo)).toEqual(["TST"]);
  });
});
