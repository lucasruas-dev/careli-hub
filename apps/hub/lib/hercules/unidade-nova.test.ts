import { describe, expect, it } from "vitest";

import {
  apartamentoCanonico,
  chaveDaColunaDeUnidades,
  chaveDaUnidade,
  codigoDaUnidade,
  colunasDaPlanilha,
  conferirPlanilhaDeUnidades,
  ehColunaDaUnidadeVerticalAusente,
  lerCsvDeUnidades,
  linhaDaUnidadeNova,
  MOTIVO_DO_BLOQUEIO_SEM_PRECO,
  rotuloDaUnidade,
  torreCanonica,
  validarUnidade,
  type UnidadeDeLoteamento,
  type UnidadeVertical,
} from "./unidade-nova";

import { nomeDaUnidade } from "./nome-da-unidade";

describe("validarUnidade · loteamento", () => {
  it("normaliza quadra e lote com dois dígitos e número brasileiro", () => {
    const r = validarUnidade("loteamento", {
      area: "1.002,50",
      lote: "Lote 7",
      matricula: " 25.862 ",
      preco: "R$ 140.401,00",
      quadra: "1",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.unidade).toEqual({
      area: 1002.5,
      lote: "07",
      matricula: "25.862",
      motivoDoBloqueio: null,
      preco: 140401,
      quadra: "01",
      situacao: "disponivel",
      tipoProduto: "loteamento",
    });
    expect(r.avisos).toEqual({});
  });

  it("quadra com letra passa intacta, em maiúsculas (Lagoa Bonita)", () => {
    const r = validarUnidade("loteamento", { area: 300, lote: "12a", quadra: "c01" });
    expect(r.ok && r.unidade.tipoProduto === "loteamento" && [r.unidade.quadra, r.unidade.lote]).toEqual([
      "C01",
      "12A",
    ]);
  });

  it("quadra, lote e área obrigatórios", () => {
    const r = validarUnidade("loteamento", { area: "0", lote: "", quadra: " " });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.erros).sort()).toEqual(["area", "lote", "quadra"]);
  });

  it("⚠️ preço em branco é AVISO; preço inválido é ERRO", () => {
    const semPreco = validarUnidade("loteamento", { area: 300, lote: 1, quadra: 1 });
    expect(semPreco.ok).toBe(true);
    if (semPreco.ok) {
      expect(semPreco.unidade.preco).toBeNull();
      expect(semPreco.avisos.preco).toMatch(/VGV/);
      expect(semPreco.avisos.matricula).toMatch(/matrícula/);
    }

    const aCombinar = validarUnidade("loteamento", { area: 300, lote: 1, preco: "a combinar", quadra: 1 });
    expect(aCombinar.ok).toBe(false);
    if (!aCombinar.ok) expect(aCombinar.erros.preco).toMatch(/maior que zero/);
  });

  it("⚠️ sem preço a unidade nasce BLOQUEADA com o motivo fixo, e nunca disponível a R$ 0", () => {
    const semPreco = validarUnidade("loteamento", { area: 300, lote: 1, quadra: 1, situacao: "Disponível" });
    expect(semPreco.ok && [semPreco.unidade.situacao, semPreco.unidade.motivoDoBloqueio]).toEqual([
      "bloqueada",
      MOTIVO_DO_BLOQUEIO_SEM_PRECO,
    ]);
    expect(semPreco.ok && semPreco.avisos.preco).toMatch(/entra bloqueada/);
    // O motivo fixo não dispara o aviso de "bloqueada sem motivo".
    expect(semPreco.ok && semPreco.avisos.motivoDoBloqueio).toBeUndefined();

    // Quem já escolheu Bloqueada fica com o próprio motivo (e o aviso do motivo, se faltou).
    const permuta = validarUnidade("vertical", { andar: 1, apartamento: "101", areaPrivativa: 50, motivoDoBloqueio: "Permuta", situacao: "Bloqueada" });
    expect(permuta.ok && permuta.unidade.motivoDoBloqueio).toBe("Permuta");
    const semMotivo = validarUnidade("loteamento", { area: 300, lote: 1, quadra: 1, situacao: "Bloqueada" });
    expect(semMotivo.ok && semMotivo.unidade.motivoDoBloqueio).toBeNull();
    expect(semMotivo.ok && semMotivo.avisos.motivoDoBloqueio).toMatch(/sem motivo/);

    // Com preço, disponível continua disponível.
    const comPreco = validarUnidade("loteamento", { area: 300, lote: 1, preco: "1.000,00", quadra: 1 });
    expect(comPreco.ok && comPreco.unidade.situacao).toBe("disponivel");
  });

  it("⚠️ unidade nova só nasce Disponível ou Bloqueada", () => {
    const vendida = validarUnidade("loteamento", { area: 300, lote: 1, quadra: 1, situacao: "Vendido" });
    expect(vendida.ok).toBe(false);
    if (!vendida.ok) expect(vendida.erros.situacao).toMatch(/Disponível ou Bloqueada/);

    const bloqueada = validarUnidade("loteamento", {
      area: 300,
      lote: 1,
      motivoDoBloqueio: "Permuta",
      quadra: 1,
      situacao: "Bloqueado para venda",
    });
    expect(bloqueada.ok && [bloqueada.unidade.situacao, bloqueada.unidade.motivoDoBloqueio]).toEqual([
      "bloqueada",
      "Permuta",
    ]);

    const semMotivo = validarUnidade("loteamento", { area: 300, lote: 1, quadra: 1, situacao: "bloqueada" });
    expect(semMotivo.ok && semMotivo.avisos.motivoDoBloqueio).toMatch(/sem motivo/);

    // Motivo em unidade disponível não é gravado: não existe bloqueio para explicar.
    const livre = validarUnidade("loteamento", { area: 300, lote: 1, motivoDoBloqueio: "x", preco: 1, quadra: 1 });
    expect(livre.ok && livre.unidade.motivoDoBloqueio).toBeNull();
  });
});

describe("validarUnidade · vertical", () => {
  it("normaliza torre, apartamento, andar e vagas", () => {
    const r = validarUnidade("vertical", {
      andar: "3º andar",
      apartamento: "Apto 0304",
      areaPrivativa: "68,45",
      preco: "450.000,00",
      tipologia: " 2 quartos,  1 suíte ",
      torre: "Torre a",
      vagas: "2 vagas",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.unidade).toEqual({
      andar: 3,
      apartamento: "304",
      areaPrivativa: 68.45,
      matricula: null,
      motivoDoBloqueio: null,
      preco: 450000,
      situacao: "disponivel",
      tipologia: "2 quartos, 1 suíte",
      tipoProduto: "vertical",
      torre: "A",
      vagas: 2,
    });
  });

  it("torre é opcional; térreo é 0; subsolo é negativo; vaga zero é zero", () => {
    const r = validarUnidade("vertical", { andar: "Térreo", apartamento: 1, areaPrivativa: 40, vagas: 0 });
    expect(r.ok && r.unidade.tipoProduto === "vertical" && [r.unidade.torre, r.unidade.andar, r.unidade.vagas]).toEqual([
      null,
      0,
      0,
    ]);
    const subsolo = validarUnidade("vertical", { andar: "-1", apartamento: "L1", areaPrivativa: 40 });
    expect(subsolo.ok && subsolo.unidade.tipoProduto === "vertical" && subsolo.unidade.andar).toBe(-1);
  });

  it("andar, apartamento e área privativa obrigatórios; quadra e lote não são pedidos", () => {
    const r = validarUnidade("vertical", { lote: "01", quadra: "01" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.erros).sort()).toEqual(["andar", "apartamento", "areaPrivativa"]);
  });

  it("recusa andar quebrado, vaga negativa e apartamento com símbolo", () => {
    const r = validarUnidade("vertical", {
      andar: "3,5",
      apartamento: "30/4",
      areaPrivativa: 40,
      torre: "A-1",
      vagas: "-1",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.erros).sort()).toEqual(["andar", "apartamento", "torre", "vagas"]);
  });
});

describe("canônicos", () => {
  it("torre sem prefixo e sem zero à esquerda", () => {
    expect(torreCanonica("Torre A")).toBe("A");
    expect(torreCanonica("bloco 02")).toBe("2");
    expect(torreCanonica("Norte")).toBe("NORTE");
    expect(torreCanonica("  ")).toBeNull();
  });

  it("apartamento sem prefixo e sem zero à esquerda", () => {
    expect(apartamentoCanonico("Apto. 0304")).toBe("304");
    expect(apartamentoCanonico("ap1203a")).toBe("1203A");
    expect(apartamentoCanonico("A1")).toBe("A1");
    expect(apartamentoCanonico("")).toBeNull();
  });
});

describe("codigoDaUnidade", () => {
  it("⚠️ loteamento segue o padrão do C2X: prefixo + quadra + lote (JDG0617)", () => {
    expect(codigoDaUnidade("jdg", "loteamento", { lote: "17", quadra: "6" })).toBe("JDG0617");
    expect(codigoDaUnidade("LAB", "loteamento", { lote: "1", quadra: "C01" })).toBe("LABC0101");
  });

  it("⚠️ vertical usa hífen e nunca se lê como quadra/lote", () => {
    expect(codigoDaUnidade("JAD", "vertical", { apartamento: "304", torre: "A" })).toBe("JAD-A-304");
    expect(codigoDaUnidade("JAD", "vertical", { apartamento: "1203" })).toBe("JAD-1203");
    // A leitura de hoje decompõe JDG0617 em quadra e lote; o código vertical escapa dela.
    expect(nomeDaUnidade({ codigo: "JAD-1203", lote: null, quadra: null })).toBe("JAD-1203");
    expect(nomeDaUnidade({ codigo: "JAD1203", lote: null, quadra: null })).toBe("Quadra 12 · Lote 03");
  });

  it("sem as partes ou sem prefixo, devolve vazio", () => {
    expect(codigoDaUnidade("JAD", "vertical", { torre: "A" })).toBe("");
    expect(codigoDaUnidade("", "loteamento", { lote: "1", quadra: "1" })).toBe("");
    expect(codigoDaUnidade("JDG", "loteamento", { quadra: "1" })).toBe("");
  });
});

describe("rotuloDaUnidade", () => {
  it("escreve os dois tipos", () => {
    expect(rotuloDaUnidade("loteamento", { lote: "5", quadra: "1" })).toBe("Quadra 01 · Lote 05");
    expect(rotuloDaUnidade("vertical", { apartamento: "304", torre: "a" })).toBe("Torre A · Apto 304");
    expect(rotuloDaUnidade("vertical", { apartamento: "304", torre: null })).toBe("Apto 304");
  });

  it("sem as partes cai no código (e decompõe o de loteamento)", () => {
    expect(rotuloDaUnidade("loteamento", { codigo: "JDG0617" })).toBe("Quadra 06 · Lote 17");
    expect(rotuloDaUnidade("vertical", { codigo: "JAD-A-304" })).toBe("JAD-A-304");
  });
});

describe("chaveDaUnidade", () => {
  it("mesmo terreno ou mesmo apartamento, com grafias diferentes", () => {
    expect(chaveDaUnidade("loteamento", { lote: "7", quadra: "01" })).toBe(
      chaveDaUnidade("loteamento", { lote: "07", quadra: "1" }),
    );
    expect(chaveDaUnidade("vertical", { apartamento: "Apto 0304", torre: "Torre A" })).toBe(
      chaveDaUnidade("vertical", { apartamento: "304", torre: "a" }),
    );
  });
});

describe("linhaDaUnidadeNova", () => {
  const LOTE: UnidadeDeLoteamento = {
    area: 300,
    lote: "07",
    matricula: "25.862",
    motivoDoBloqueio: null,
    preco: 140401,
    quadra: "01",
    situacao: "disponivel",
    tipoProduto: "loteamento",
  };

  const APTO: UnidadeVertical = {
    andar: 3,
    apartamento: "304",
    areaPrivativa: 68.45,
    matricula: null,
    motivoDoBloqueio: "Permuta",
    preco: null,
    situacao: "bloqueada",
    tipologia: "2 quartos",
    tipoProduto: "vertical",
    torre: "A",
    vagas: 1,
  };

  it("⚠️ lote não manda as colunas da 0171", () => {
    const linha = linhaDaUnidadeNova(LOTE, { autor: null, enterpriseId: " 39 ", prefixo: "GDN" });
    expect(linha).toEqual({
      area: 300,
      codigo: "GDN0107",
      enterprise_id: "39",
      lote: "07",
      matricula: "25.862",
      preco_tabela: 140401,
      quadra: "01",
      situacao: "disponivel",
      workspace_id: "careli",
    });
    for (const coluna of ["torre", "andar", "apartamento", "tipologia", "vagas", "bloqueado_em"]) {
      expect(Object.keys(linha)).not.toContain(coluna);
    }
  });

  it("⚠️ apartamento vai para as colunas próprias, área privativa em `area`, quadra e lote nulos", () => {
    const agora = new Date("2026-09-16T12:00:00.000Z");
    const linha = linhaDaUnidadeNova(APTO, {
      agora,
      autor: { id: "u-1", nome: "Maria" },
      enterpriseId: "100000",
      prefixo: "JAD",
    });
    expect(linha).toEqual({
      andar: 3,
      apartamento: "304",
      area: 68.45,
      bloqueado_em: "2026-09-16T12:00:00.000Z",
      bloqueado_por: "u-1",
      bloqueado_por_nome: "Maria",
      bloqueio_motivo: "Permuta",
      codigo: "JAD-A-304",
      enterprise_id: "100000",
      lote: null,
      matricula: null,
      preco_tabela: null,
      quadra: null,
      situacao: "bloqueada",
      tipologia: "2 quartos",
      torre: "A",
      vagas: 1,
      workspace_id: "careli",
    });
  });
});

describe("ehColunaDaUnidadeVerticalAusente", () => {
  it("reconhece só as colunas da 0171", () => {
    expect(
      ehColunaDaUnidadeVerticalAusente({
        code: "PGRST204",
        message: "Could not find the 'apartamento' column of 'hercules_unidades' in the schema cache",
      }),
    ).toBe(true);
    expect(ehColunaDaUnidadeVerticalAusente({ code: "42703", message: 'column "vagas" does not exist' })).toBe(true);
    expect(ehColunaDaUnidadeVerticalAusente({ code: "42703", message: 'column "quadraa" does not exist' })).toBe(false);
    expect(ehColunaDaUnidadeVerticalAusente({ code: "23505", message: "torre duplicada" })).toBe(false);
    expect(ehColunaDaUnidadeVerticalAusente(undefined)).toBe(false);
  });
});

describe("planilha", () => {
  it("colunas de cada tipo", () => {
    expect(colunasDaPlanilha("loteamento").filter((c) => c.obrigatoria).map((c) => c.chave)).toEqual([
      "quadra",
      "lote",
      "area",
    ]);
    expect(colunasDaPlanilha("vertical").filter((c) => c.obrigatoria).map((c) => c.chave)).toEqual([
      "andar",
      "apartamento",
      "areaPrivativa",
    ]);
    expect(colunasDaPlanilha("vertical").map((c) => c.chave)).not.toContain("quadra");
  });

  it("cabeçalho do dia a dia vira a chave certa em cada tipo", () => {
    expect(chaveDaColunaDeUnidades("loteamento", "Área (m²)")).toBe("area");
    expect(chaveDaColunaDeUnidades("vertical", "Área (m²)")).toBe("areaPrivativa");
    expect(chaveDaColunaDeUnidades("vertical", "Área privativa")).toBe("areaPrivativa");
    expect(chaveDaColunaDeUnidades("vertical", "Apto")).toBe("apartamento");
    expect(chaveDaColunaDeUnidades("vertical", "Bloco")).toBe("torre");
    expect(chaveDaColunaDeUnidades("vertical", "Vagas de garagem")).toBe("vagas");
    expect(chaveDaColunaDeUnidades("vertical", "Quadra")).toBe("");
    expect(chaveDaColunaDeUnidades("loteamento", "Preço")).toBe("preco");
    expect(chaveDaColunaDeUnidades("loteamento", "Situação")).toBe("situacao");
    expect(chaveDaColunaDeUnidades("loteamento", "Motivo do bloqueio")).toBe("motivoDoBloqueio");
    expect(chaveDaColunaDeUnidades("loteamento", "Observação")).toBe("");
  });

  it("CSV com ponto e vírgula, linha em branco some", () => {
    const csv = String.fromCharCode(0xfeff) + "Torre;Andar;Apartamento;Área privativa (m²);Valor\nA;3;304;68,45;450.000,00\n;;;;\n\nB;1;101;50;\n";
    expect(lerCsvDeUnidades("vertical", csv)).toEqual([
      { andar: "3", apartamento: "304", areaPrivativa: "68,45", preco: "450.000,00", torre: "A" },
      { andar: "1", apartamento: "101", areaPrivativa: "50", preco: "", torre: "B" },
    ]);
  });

  it("⚠️ loteamento: duplicado na planilha, já existente, erro e aviso por linha", () => {
    const r = conferirPlanilhaDeUnidades(
      "loteamento",
      [
        { area: "300", lote: "1", preco: "100000", quadra: "1", matricula: "1" }, // linha 2: entra
        { area: "300", lote: "01", preco: "100000", quadra: "01", matricula: "1" }, // 3: repetida da 2
        { area: "300", lote: "2", preco: "100000", quadra: "1", matricula: "1" }, // 4: já existe (código)
        { area: "300", lote: "3", preco: "100000", quadra: "1", matricula: "1" }, // 5: já existe (partes)
        { area: "", lote: "4", quadra: "1" }, // 6: erro de área
        { area: "300", lote: "5", quadra: "1" }, // 7: entra com avisos
      ],
      {
        codigosExistentes: ["gdn0102"],
        prefixo: "gdn",
        unidadesExistentes: [{ lote: "3", quadra: "01" }, { lote: null, quadra: null }],
      },
    );

    expect(r.unidades.map((u) => [u.linha, u.codigo, u.rotulo])).toEqual([
      [2, "GDN0101", "Quadra 01 · Lote 01"],
      [7, "GDN0105", "Quadra 01 · Lote 05"],
    ]);

    const erros = r.problemas.filter((p) => !p.soAviso).map((p) => [p.linha, p.campo]);
    expect(erros).toEqual([
      [3, "quadra/lote"],
      [4, "quadra/lote"],
      [5, "quadra/lote"],
      [6, "area"],
    ]);
    expect(r.problemas.find((p) => p.linha === 3)?.motivo).toMatch(/linha 2 já traz Quadra 01 · Lote 01/);

    const avisos = r.problemas.filter((p) => p.soAviso).map((p) => [p.linha, p.campo]);
    expect(avisos).toEqual([
      [7, "preco"],
      [7, "matricula"],
    ]);
  });

  it("⚠️ loteamento: partes diferentes que geram o MESMO código são recusadas na planilha", () => {
    const r = conferirPlanilhaDeUnidades(
      "loteamento",
      [
        { area: "300", lote: "011", matricula: "1", preco: "1", quadra: "01" }, // 2: JDG01011
        { area: "300", lote: "11", matricula: "1", preco: "1", quadra: "010" }, // 3: JDG01011 também
      ],
      { prefixo: "JDG" },
    );
    expect(r.unidades.map((u) => u.codigo)).toEqual(["JDG01011"]);
    expect(r.problemas).toEqual([
      {
        campo: "quadra/lote",
        linha: 3,
        motivo: "Quadra 010 · Lote 11 gera o código JDG01011, o mesmo da linha 2, que é outra unidade. Confira a quadra e o lote.",
        valor: "JDG01011",
      },
    ]);
  });

  it("⚠️ vertical: mesma torre e apartamento repetidos; torre diferente é outra unidade", () => {
    const r = conferirPlanilhaDeUnidades(
      "vertical",
      [
        { andar: 3, apartamento: "304", areaPrivativa: 68, matricula: "1", preco: 1, torre: "A" }, // 2
        { andar: 3, apartamento: "304", areaPrivativa: 68, matricula: "1", preco: 1, torre: "B" }, // 3
        { andar: 3, apartamento: "0304", areaPrivativa: 68, matricula: "1", preco: 1, torre: "Torre A" }, // 4
        { andar: 1, apartamento: "101", areaPrivativa: 50, matricula: "1", preco: 1 }, // 5: já existe
        { andar: 2, apartamento: "201", areaPrivativa: 50, matricula: "1", preco: 1, situacao: "vendida" }, // 6
      ],
      { prefixo: "JAD", unidadesExistentes: [{ apartamento: "101", torre: null }] },
    );

    expect(r.unidades.map((u) => [u.linha, u.codigo, u.rotulo])).toEqual([
      [2, "JAD-A-304", "Torre A · Apto 304"],
      [3, "JAD-B-304", "Torre B · Apto 304"],
    ]);
    expect(r.problemas.map((p) => [p.linha, p.campo, Boolean(p.soAviso)])).toEqual([
      [4, "torre/apartamento", false],
      [5, "torre/apartamento", false],
      [6, "situacao", false],
    ]);
  });

  it("produto sem código trava toda linha válida", () => {
    const r = conferirPlanilhaDeUnidades("vertical", [{ andar: 1, apartamento: "101", areaPrivativa: 50 }], {
      prefixo: " ",
    });
    expect(r.unidades).toEqual([]);
    expect(r.problemas.map((p) => p.campo)).toEqual(["codigo"]);
  });
});
