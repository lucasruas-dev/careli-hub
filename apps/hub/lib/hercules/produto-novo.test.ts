import { describe, expect, it } from "vitest";

import {
  codigoDoProduto,
  ehColunaDoProdutoAusente,
  ehIdDoPanteon,
  tipoProdutoDe,
  validarProdutoNovo,
  type EntradaDeProdutoNovo,
} from "./produto-novo";

const JADE: EntradaDeProdutoNovo = {
  cidade: "Ipatinga",
  codigo: "JAD",
  nome: "Ed. Jade",
  tipoProduto: "vertical",
  uf: "MG",
};

// Os dois lados: GDN e VOC existem no C2X; TST só no Panteon.
const EXISTENTES = new Set(["GDN", "VOC", "VLO", "TST"]);

describe("validarProdutoNovo", () => {
  it("aceita e normaliza um produto válido", () => {
    const r = validarProdutoNovo(
      { cidade: "  Ipatinga ", codigo: " jad ", nome: "  Ed.   Jade ", tipoProduto: "Vertical", uf: "mg" },
      { codigosExistentes: EXISTENTES },
    );
    expect(r).toEqual({
      ok: true,
      produto: {
        cidade: "Ipatinga",
        codigo: "JAD",
        nome: "Ed. Jade",
        paiCodigo: null,
        tipoProduto: "vertical",
        uf: "MG",
      },
    });
  });

  it("⚠️ recusa código que já existe no C2X OU no Panteon, sem ligar para caixa", () => {
    const noC2x = validarProdutoNovo({ ...JADE, codigo: "gdn" }, { codigosExistentes: EXISTENTES });
    expect(noC2x.ok).toBe(false);
    if (!noC2x.ok) expect(noC2x.erros.codigo).toMatch(/GDN já está em uso/);

    // O conjunto pode vir cru do banco (minúsculo, com espaço): a régua normaliza os dois lados.
    const cru = validarProdutoNovo(JADE, { codigosExistentes: new Set([" jad "]) });
    expect(cru.ok).toBe(false);
  });

  it("código: 2 a 6 letras ou números, começando por letra", () => {
    const erroDe = (codigo: string) => {
      const r = validarProdutoNovo({ ...JADE, codigo }, { codigosExistentes: EXISTENTES });
      return r.ok ? null : (r.erros.codigo ?? null);
    };
    expect(erroDe("")).toMatch(/Informe o código/);
    expect(erroDe("J")).toMatch(/2 a 6/);
    expect(erroDe("JADEAZL")).toMatch(/2 a 6/);
    expect(erroDe("12")).toMatch(/começando por letra/);
    expect(erroDe("JA D")).toMatch(/sem espaço/);
    expect(erroDe("JÁD")).toMatch(/sem espaço nem acento/);
    expect(erroDe("GT2")).toBeNull();
    expect(erroDe("ONSKY")).toBeNull();
  });

  it("nome, cidade, UF e tipo obrigatórios, com mensagem para a tela", () => {
    const r = validarProdutoNovo(
      { cidade: " ", codigo: "JAD", nome: "", tipoProduto: "", uf: "" },
      { codigosExistentes: EXISTENTES },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.erros).sort()).toEqual(["cidade", "nome", "tipoProduto", "uf"]);
  });

  it("UF só entre as 27", () => {
    const r = validarProdutoNovo({ ...JADE, uf: "XX" }, { codigosExistentes: EXISTENTES });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros.uf).toMatch(/UF inválida/);
    expect(validarProdutoNovo({ ...JADE, uf: "df" }, { codigosExistentes: EXISTENTES }).ok).toBe(true);
  });

  it("tipo só loteamento ou vertical", () => {
    const r = validarProdutoNovo({ ...JADE, tipoProduto: "predio" }, { codigosExistentes: EXISTENTES });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros.tipoProduto).toMatch(/Tipo inválido/);
  });

  it("nome e cidade compridos demais", () => {
    const r = validarProdutoNovo(
      { ...JADE, cidade: "x".repeat(81), nome: "x".repeat(121) },
      { codigosExistentes: EXISTENTES },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erros.nome).toMatch(/120/);
      expect(r.erros.cidade).toMatch(/80/);
    }
  });

  it("pai: não pode ser ele mesmo e, com a lista, precisa ser um pai possível", () => {
    const eleMesmo = validarProdutoNovo({ ...JADE, paiCodigo: "jad" }, { codigosExistentes: EXISTENTES });
    expect(eleMesmo.ok).toBe(false);
    if (!eleMesmo.ok) expect(eleMesmo.erros.paiCodigo).toMatch(/dele mesmo/);

    const filhoDeFilho = validarProdutoNovo(
      { ...JADE, codigo: "VOX", paiCodigo: "VOC" },
      { codigosExistentes: EXISTENTES, paisPossiveis: new Set(["VLO", "GDN"]) },
    );
    expect(filhoDeFilho.ok).toBe(false);
    if (!filhoDeFilho.ok) expect(filhoDeFilho.erros.paiCodigo).toMatch(/VOC não pode ser pai/);

    const ok = validarProdutoNovo(
      { ...JADE, codigo: "VOX", paiCodigo: " vlo " },
      { codigosExistentes: EXISTENTES, paisPossiveis: new Set(["VLO"]) },
    );
    expect(ok.ok && ok.produto.paiCodigo).toBe("VLO");

    // Pai vazio = produto raiz.
    const raiz = validarProdutoNovo({ ...JADE, paiCodigo: "  " }, { codigosExistentes: EXISTENTES });
    expect(raiz.ok && raiz.produto.paiCodigo).toBeNull();
  });
});

describe("ehIdDoPanteon", () => {
  it("⚠️ só id numérico >= 100000 é do Panteon", () => {
    expect(ehIdDoPanteon("100000")).toBe(true);
    expect(ehIdDoPanteon(" 100003 ")).toBe(true);
    expect(ehIdDoPanteon(100001)).toBe(true);
    expect(ehIdDoPanteon("37")).toBe(false);
    // O ZZ TESTE foi escrito à mão com 9001: é legado para esta régua.
    expect(ehIdDoPanteon("9001")).toBe(false);
    expect(ehIdDoPanteon("99999")).toBe(false);
    expect(ehIdDoPanteon("pai:abc")).toBe(false);
    expect(ehIdDoPanteon("")).toBe(false);
    expect(ehIdDoPanteon(null)).toBe(false);
    expect(ehIdDoPanteon(undefined)).toBe(false);
  });
});

describe("tipoProdutoDe", () => {
  it("⚠️ ausente ou desconhecido vira loteamento (0170 pendente)", () => {
    expect(tipoProdutoDe("vertical")).toBe("vertical");
    expect(tipoProdutoDe(" VERTICAL ")).toBe("vertical");
    expect(tipoProdutoDe("loteamento")).toBe("loteamento");
    expect(tipoProdutoDe(undefined)).toBe("loteamento");
    expect(tipoProdutoDe(null)).toBe("loteamento");
    expect(tipoProdutoDe("predio")).toBe("loteamento");
  });
});

describe("codigoDoProduto", () => {
  it("normaliza para comparar", () => {
    expect(codigoDoProduto(" jad ")).toBe("JAD");
    expect(codigoDoProduto(null)).toBe("");
  });
});

describe("ehColunaDoProdutoAusente", () => {
  it("reconhece o 42703 e o PGRST204 das colunas da 0170", () => {
    expect(
      ehColunaDoProdutoAusente({
        code: "42703",
        message: "column hercules_empreendimentos.operado_por does not exist",
      }),
    ).toBe(true);
    expect(
      ehColunaDoProdutoAusente({
        code: "PGRST204",
        message: "Could not find the 'tipo_produto' column of 'hercules_empreendimentos' in the schema cache",
      }),
    ).toBe(true);
    expect(ehColunaDoProdutoAusente({ code: "42703", message: 'column "criado_origem" does not exist' })).toBe(true);
  });

  it("⚠️ NÃO engole erro de outra coluna nem erro que não é de coluna", () => {
    expect(ehColunaDoProdutoAusente({ code: "42703", message: 'column "vendendoo" does not exist' })).toBe(false);
    expect(ehColunaDoProdutoAusente({ code: "42501", message: "permission denied operado_por" })).toBe(false);
    expect(ehColunaDoProdutoAusente(null)).toBe(false);
    expect(ehColunaDoProdutoAusente("operado_por")).toBe(false);
  });
});
