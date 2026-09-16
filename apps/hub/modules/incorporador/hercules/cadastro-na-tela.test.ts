import { describe, expect, it } from "vitest";

import { validarProdutoNovo } from "@/lib/hercules/produto-novo";
import {
  chaveDaColunaDeUnidades,
  colunasDaPlanilha,
  conferirPlanilhaDeUnidades,
  type LinhaDaPlanilhaDeUnidades,
  validarUnidade,
} from "@/lib/hercules/unidade-nova";

import {
  cabecalhoDaColuna,
  camposDoFormulario,
  camposVaziosDaUnidade,
  codigoEnquantoDigita,
  COLUNAS_DE_TEXTO,
  contagemDaConferencia,
  DESCRICAO_DO_CAMPO,
  exemploDeCodigoDaUnidade,
  instrucoesDoModelo,
  lerRespostaDaConferencia,
  lerRespostaDaCriacao,
  lerRespostaDaImportacao,
  lerRespostaDoProdutoNovo,
  linhaDoFormulario,
  linhasConferidas,
  linhasDaConferenciaDaRota,
  linhaTemConteudo,
  nomeDoArquivoDoModelo,
  OPCOES_DE_TIPO_DE_PRODUTO,
  problemasNoFormulario,
  rotuloDaLinha,
  sugerirCodigoDoProduto,
  valorDaCelula,
} from "./cadastro-na-tela";

describe("produto: código na digitação e sugestão", () => {
  it("limpa enquanto digita: maiúsculas, sem acento, sem espaço nem hífen, até 6", () => {
    expect(codigoEnquantoDigita("ed jáde-1")).toBe("EDJADE");
    expect(codigoEnquantoDigita("on sky")).toBe("ONSKY");
    expect(codigoEnquantoDigita("gt2")).toBe("GT2");
    // Começar por número a limpeza não resolve: fica para a régua explicar.
    expect(codigoEnquantoDigita("12ab")).toBe("12AB");
    expect(codigoEnquantoDigita("")).toBe("");
  });

  it("sugere pelo nome sem as palavras de tipo, e o sugerido passa na régua do produto", () => {
    const casos: [string, string][] = [
      ["Ed. Jade", "JAD"],
      ["Edifício Esmeralda", "ESM"],
      ["Giant Towers", "GT"],
      ["On Sky", "OS"],
      ["Residencial Vale do Sol", "VS"],
      ["Guaimbê", "GUA"],
      ["4 Estações", "EST"],
    ];
    for (const [nome, esperado] of casos) {
      const sugerido = sugerirCodigoDoProduto(nome);
      expect(sugerido, nome).toBe(esperado);
      const r = validarProdutoNovo(
        { cidade: "Ipatinga", codigo: sugerido, nome, tipoProduto: "vertical", uf: "MG" },
        { codigosExistentes: new Set() },
      );
      expect(r.ok, nome).toBe(true);
    }
  });

  it("não sugere o que já existe (sem diferença de caixa) e não inventa sem nome", () => {
    expect(sugerirCodigoDoProduto("Ed. Jade", ["jad"])).toBe("JAD2");
    expect(sugerirCodigoDoProduto("Ed. Jade", new Set(["JAD", "JAD2"]))).toBe("JAD3");
    expect(sugerirCodigoDoProduto("")).toBe("");
    expect(sugerirCodigoDoProduto("Ed.")).toBe("");
    expect(sugerirCodigoDoProduto("Residencial de 1")).toBe("");
  });

  it("as opções de tipo gravam os dois valores da CHECK da 0170", () => {
    expect(OPCOES_DE_TIPO_DE_PRODUTO.map((o) => o.chave)).toEqual(["loteamento", "vertical"]);
    expect(OPCOES_DE_TIPO_DE_PRODUTO.find((o) => o.chave === "vertical")?.titulo).toBe("Prédio");
  });
});

describe("lerRespostaDoProdutoNovo", () => {
  it("sucesso devolve o id e o código normalizado; id numérico vira texto", () => {
    expect(lerRespostaDoProdutoNovo(201, { data: { codigo: "jad", enterpriseId: "100000" } })).toEqual({
      codigo: "JAD",
      enterpriseId: "100000",
      ok: true,
      recarregarSessao: false,
    });
    expect(lerRespostaDoProdutoNovo(200, { data: { codigo: "GT", enterpriseId: 100001 } })).toMatchObject({
      enterpriseId: "100001",
      ok: true,
    });
  });

  it("⚠️ o aviso da rota do portal para recarregar a sessão chega à tela", () => {
    const r = lerRespostaDoProdutoNovo(201, { data: { codigo: "JAD", enterpriseId: "100000", recarregarSessao: true } });
    expect(r.ok && r.recarregarSessao).toBe(true);
  });

  it("o erro do operador (porta do hub) cai no campo dele", () => {
    expect(
      lerRespostaDoProdutoNovo(422, {
        error: "Confira os campos destacados.",
        erros: { operadoPorIncorporadorSlug: "Esse portal não existe ou está desativado." },
      }),
    ).toEqual({
      erros: { operadoPorIncorporadorSlug: "Esse portal não existe ou está desativado." },
      mensagem: "Confira os campos destacados.",
      ok: false,
    });
  });

  it("2xx sem o id não é sucesso e manda conferir a lista antes de tentar de novo", () => {
    const r = lerRespostaDoProdutoNovo(200, { data: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.mensagem).toContain("pode ter sido criado");
    expect(lerRespostaDoProdutoNovo(200, null).ok).toBe(false);
  });

  it("422 põe o erro no campo (no topo ou em data), e ignora chave que não é campo", () => {
    expect(
      lerRespostaDoProdutoNovo(422, { erros: { codigo: "O código JAD já está em uso.", outra: "x", uf: "UF inválida." } }),
    ).toEqual({ erros: { codigo: "O código JAD já está em uso.", uf: "UF inválida." }, mensagem: null, ok: false });
    expect(lerRespostaDoProdutoNovo(422, { data: { erros: { nome: "Informe o nome do produto." } } })).toEqual({
      erros: { nome: "Informe o nome do produto." },
      mensagem: null,
      ok: false,
    });
  });

  it("409 sem erros é código repetido; 503, 403 e 500 têm mensagem própria; `error` do servidor vence", () => {
    expect(lerRespostaDoProdutoNovo(409, { error: "O código JAD já está em uso." })).toEqual({
      erros: { codigo: "O código JAD já está em uso." },
      mensagem: null,
      ok: false,
    });
    const pendente = lerRespostaDoProdutoNovo(503, {});
    expect(!pendente.ok && pendente.mensagem).toContain("ainda não está liberado");
    const semAcesso = lerRespostaDoProdutoNovo(403, null);
    expect(!semAcesso.ok && semAcesso.mensagem).toContain("não permite");
    const geral = lerRespostaDoProdutoNovo(500, "<html>");
    expect(!geral.ok && geral.mensagem).toContain("Não foi possível criar");
    const doServidor = lerRespostaDoProdutoNovo(503, { error: "Migration 0170 pendente." });
    expect(!doServidor.ok && doServidor.mensagem).toBe("Migration 0170 pendente.");
  });
});

describe("unidade: formulário de uma", () => {
  it("exemplo de código por tipo, vazio sem prefixo", () => {
    expect(exemploDeCodigoDaUnidade("JAD", "vertical")).toBe("JAD-A-304");
    expect(exemploDeCodigoDaUnidade("jdg", "loteamento")).toBe("JDG0107");
    expect(exemploDeCodigoDaUnidade("", "vertical")).toBe("");
  });

  it("os campos saem das colunas da planilha do tipo, sem situação e motivo", () => {
    expect(camposDoFormulario("loteamento").map((c) => c.chave)).toEqual(["quadra", "lote", "area", "preco", "matricula"]);
    expect(camposDoFormulario("vertical").map((c) => c.chave)).toEqual([
      "torre",
      "andar",
      "apartamento",
      "tipologia",
      "vagas",
      "areaPrivativa",
      "preco",
      "matricula",
    ]);
    const vertical = camposDoFormulario("vertical");
    expect(vertical.find((c) => c.chave === "areaPrivativa")).toMatchObject({ obrigatoria: true, teclado: "decimal" });
    expect(vertical.find((c) => c.chave === "vagas")?.teclado).toBe("numeric");
    expect(vertical.find((c) => c.chave === "andar")?.dica).toContain("térreo");
    expect(vertical.find((c) => c.chave === "apartamento")?.dica).toBeNull();
  });

  it("a linha só leva as chaves do tipo, sem vazio, e o motivo só com Bloqueada", () => {
    const campos = {
      ...camposVaziosDaUnidade(),
      andar: " 3 ",
      apartamento: "0304",
      areaPrivativa: "68,45",
      motivoDoBloqueio: "Permuta",
      quadra: "01",
      torre: "a",
    };
    expect(linhaDoFormulario("vertical", campos)).toEqual({
      andar: "3",
      apartamento: "0304",
      areaPrivativa: "68,45",
      situacao: "Disponível",
      torre: "a",
    });
    const bloqueada = linhaDoFormulario("vertical", { ...campos, situacao: "Bloqueada" });
    expect(bloqueada.motivoDoBloqueio).toBe("Permuta");

    const r = validarUnidade("vertical", linhaDoFormulario("vertical", { ...campos, preco: "450.000,00" }));
    expect(r.ok && r.unidade).toMatchObject({ apartamento: "304", situacao: "disponivel", torre: "A" });
    // Sem preço, a mesma unidade entra bloqueada (a régua é a da fundação).
    const semPreco = validarUnidade("vertical", linhaDoFormulario("vertical", campos));
    expect(semPreco.ok && semPreco.unidade.situacao).toBe("bloqueada");

    const lote = linhaDoFormulario("loteamento", { ...camposVaziosDaUnidade(), apartamento: "304", area: "300", lote: "7", quadra: "1" });
    expect(lote).toEqual({ area: "300", lote: "7", quadra: "1", situacao: "Disponível" });
  });

  it("problemas da rota: campo vai no campo, aviso no aviso, o resto é geral", () => {
    expect(
      problemasNoFormulario([
        { campo: "area", linha: 2, motivo: "A área precisa ser um número maior que zero.", valor: "0" },
        { campo: "area", linha: 2, motivo: "segundo motivo", valor: "0" },
        { campo: "preco", linha: 2, motivo: "Sem valor de tabela.", soAviso: true, valor: "" },
        { campo: "quadra/lote", linha: 2, motivo: "Quadra 01 · Lote 07 já está cadastrada neste produto.", valor: "JDG0107" },
        { campo: "outro", linha: 2, motivo: "aviso solto", soAviso: true, valor: "" },
      ]),
    ).toEqual({
      avisos: { preco: "Sem valor de tabela." },
      erros: { area: "A área precisa ser um número maior que zero." },
      gerais: ["Quadra 01 · Lote 07 já está cadastrada neste produto."],
    });
  });
});

describe("planilha: leitura e modelo", () => {
  it("célula: número e texto ficam, objeto vira o texto visível, vazio vira texto vazio", () => {
    expect(valorDaCelula(300.5, "300,50")).toBe(300.5);
    expect(valorDaCelula("01", "01")).toBe("01");
    expect(valorDaCelula(null, "")).toBe("");
    expect(valorDaCelula({ richText: [{ text: "C01" }] }, "C01")).toBe("C01");
    expect(valorDaCelula({ formula: "A1*2", result: 600 }, "600")).toBe("600");
    expect(valorDaCelula(new Date("2026-09-16T00:00:00Z"), "16/09/2026")).toBe("16/09/2026");
  });

  it("linha em branco não tem conteúdo", () => {
    expect(linhaTemConteudo({ lote: " ", quadra: "" })).toBe(false);
    expect(linhaTemConteudo({ lote: 7 })).toBe(true);
    expect(linhaTemConteudo({})).toBe(false);
  });

  it("o cabeçalho do modelo volta para a chave certa nos dois tipos (o modelo reimporta)", () => {
    for (const tipo of ["loteamento", "vertical"] as const) {
      for (const coluna of colunasDaPlanilha(tipo)) {
        expect(chaveDaColunaDeUnidades(tipo, cabecalhoDaColuna(coluna)), `${tipo}:${coluna.rotulo}`).toBe(coluna.chave);
      }
    }
    expect(cabecalhoDaColuna({ chave: "quadra", exemplo: "01", obrigatoria: true, rotulo: "Quadra" })).toBe("Quadra *");
  });

  it("as partes com zero à esquerda vão como texto no Excel", () => {
    expect([...COLUNAS_DE_TEXTO].sort()).toEqual(["apartamento", "lote", "matricula", "quadra", "torre"]);
  });

  it("nome do arquivo por produto e tipo", () => {
    expect(nomeDoArquivoDoModelo("JAD", "vertical")).toBe("modelo-unidades-jad-predio.xlsx");
    expect(nomeDoArquivoDoModelo("", "loteamento")).toBe("modelo-unidades-produto-loteamento.xlsx");
  });

  it("a aba de instruções explica toda coluna, traz o exemplo à parte e não usa travessão", () => {
    const linhas = instrucoesDoModelo("vertical", { codigo: "jad", nome: "Ed. Jade" });
    expect(linhas[0]).toEqual(["Produto", "Ed. Jade (JAD)"]);
    for (const coluna of colunasDaPlanilha("vertical")) {
      expect(linhas).toContainEqual([cabecalhoDaColuna(coluna), DESCRICAO_DO_CAMPO[coluna.chave]]);
      expect(linhas).toContainEqual([coluna.rotulo, coluna.exemplo]);
    }
    expect(linhas.some(([, texto]) => texto.includes("JAD-A-304"))).toBe(true);
    const tudo = [...linhas.flat(), ...Object.values(DESCRICAO_DO_CAMPO)].join(" ");
    // Meia-risca e travessão montados por código, para o caractere não viver no fonte.
    const tracos = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);
    expect(tudo).not.toMatch(tracos);

    expect(instrucoesDoModelo("loteamento", { codigo: "JDG" })[0]).toEqual(["Produto", "JDG"]);
  });
});

describe("conferência na tela", () => {
  it("rótulo da linha que ainda não é unidade, pelo que a pessoa escreveu", () => {
    expect(rotuloDaLinha("loteamento", { lote: 7, quadra: 1 })).toBe("Quadra 01 · Lote 07");
    expect(rotuloDaLinha("loteamento", { quadra: "1" })).toBe("Quadra 01");
    expect(rotuloDaLinha("vertical", { apartamento: "0304" })).toBe("Apto 304");
    expect(rotuloDaLinha("vertical", { torre: "Torre b" })).toBe("Torre B");
    expect(rotuloDaLinha("vertical", {})).toBe("");
  });

  it("uma linha por linha da planilha: entra, entra com aviso, não entra", () => {
    const brutas: LinhaDaPlanilhaDeUnidades[] = [
      { area: "300", lote: "1", matricula: "10", preco: "100.000,00", quadra: "1" },
      { area: "300", lote: "2", quadra: "1" },
      { lote: "3", quadra: "1" },
      { area: "300", lote: "01", matricula: "11", preco: "1", quadra: "01" },
    ];
    const conferencia = conferirPlanilhaDeUnidades("loteamento", brutas, { prefixo: "JDG" });
    const linhas = linhasConferidas("loteamento", "JDG", brutas, conferencia);

    expect(linhas.map((l) => [l.linha, l.estado])).toEqual([
      [2, "ok"],
      [3, "aviso"],
      [4, "erro"],
      [5, "erro"],
    ]);
    expect(linhas[0]).toMatchObject({ codigo: "JDG0101", mensagens: [], rotulo: "Quadra 01 · Lote 01" });
    expect(linhas[1]?.mensagens.every((m) => m.soAviso)).toBe(true);
    expect(linhas[2]).toMatchObject({ codigo: "JDG0103", rotulo: "Quadra 01 · Lote 03" });
    expect(linhas[2]?.mensagens[0]?.campo).toBe("area");
    expect(linhas[3]?.mensagens[0]?.motivo).toContain("Repetida: a linha 2");

    expect(contagemDaConferencia(linhas)).toEqual({ aviso: 1, erro: 2, ok: 1, prontas: 2, total: 4 });
  });

  it("linha que a conferência não devolveu é erro, nunca ok", () => {
    const brutas: LinhaDaPlanilhaDeUnidades[] = [{ apartamento: "101", andar: "1", areaPrivativa: "50" }, { apartamento: "102" }];
    const linhas = linhasConferidas("vertical", "JAD", brutas, {
      problemas: [],
      unidades: [{ codigo: "JAD-101", linha: 2, rotulo: "Apto 101" }],
    });
    expect(linhas[0]?.estado).toBe("ok");
    expect(linhas[1]).toMatchObject({ codigo: "JAD-102", estado: "erro", rotulo: "Apto 102" });
    expect(linhas[1]?.mensagens[0]?.motivo).toContain("não trouxe esta linha");
  });
});

describe("conferência da rota", () => {
  const brutas: LinhaDaPlanilhaDeUnidades[] = [
    { area: "300", lote: "1", matricula: "10", preco: "1", quadra: "1" },
    { area: "300", lote: "2", quadra: "1" },
    { area: "300", lote: "3", matricula: "12", preco: "1", quadra: "1" },
    { lote: "4", quadra: "1" },
  ];

  it("uma linha por linha da planilha, com o que a rota julgou", () => {
    const linhas = linhasDaConferenciaDaRota("loteamento", "SOL", brutas, [
      { codigo: "SOL0101", linha: 2, problemas: [], resultado: "ok", rotulo: "Quadra 01 · Lote 01" },
      {
        codigo: "SOL0102",
        linha: 3,
        problemas: [{ campo: "preco", linha: 3, motivo: "Sem valor de tabela.", soAviso: true, valor: "" }],
        resultado: "aviso",
        rotulo: "Quadra 01 · Lote 02",
      },
      {
        codigo: "SOL0103",
        linha: 4,
        problemas: [{ campo: "quadra/lote", linha: 4, motivo: "Quadra 01 · Lote 03 já está cadastrada neste produto (SOL0103).", valor: "SOL0103" }],
        resultado: "erro",
        rotulo: "Quadra 01 · Lote 03",
      },
    ]);
    expect(linhas.map((l) => [l.linha, l.estado, l.codigo])).toEqual([
      [2, "ok", "SOL0101"],
      [3, "aviso", "SOL0102"],
      [4, "erro", "SOL0103"],
      // ⚠️ A linha que a rota não devolveu é erro, nunca ok.
      [5, "erro", "SOL0104"],
    ]);
    expect(linhas[3]?.mensagens[0]?.motivo).toContain("não trouxe esta linha");
    expect(contagemDaConferencia(linhas)).toEqual({ aviso: 1, erro: 2, ok: 1, prontas: 2, total: 4 });
  });

  it("⚠️ 'ok' com um problema que não é aviso é erro (a tela confia no motivo, não no rótulo)", () => {
    const [linha] = linhasDaConferenciaDaRota("vertical", "JAD", [{ andar: "1", apartamento: "101", areaPrivativa: "50" }], [
      {
        codigo: null,
        linha: 2,
        problemas: [{ campo: "andar", linha: 2, motivo: "Informe o andar.", valor: "" }],
        resultado: "ok",
        rotulo: null,
      },
    ]);
    expect(linha).toMatchObject({ codigo: "JAD-101", estado: "erro", rotulo: "Apto 101" });
  });

  it("lerRespostaDaConferencia: lê `data.linhas`, o bloqueio e a contagem de hoje; resultado estranho vira erro", () => {
    const r = lerRespostaDaConferencia(200, {
      data: {
        bloqueioDaGravacao: "O cadastro de apartamentos ainda não está liberado. Fale com a Careli.",
        colunas: [],
        linhas: [
          { codigo: "JAD-101", linha: 2, problemas: [{ campo: "preco", linha: 2, motivo: "Sem valor", soAviso: true, valor: "" }], resultado: "aviso", rotulo: "Apto 101", unidade: {} },
          { codigo: "JAD-102", linha: 3, problemas: [{ campo: "x", linha: "y", motivo: "malformado" }], resultado: "talvez", rotulo: "Apto 102" },
          { linha: "sem número" },
        ],
        produto: { codigo: "JAD" },
        resumo: {},
        unidadesHoje: 42,
      },
    });
    expect(r).toEqual({
      bloqueioDaGravacao: "O cadastro de apartamentos ainda não está liberado. Fale com a Careli.",
      linhas: [
        { codigo: "JAD-101", linha: 2, problemas: [{ campo: "preco", linha: 2, motivo: "Sem valor", soAviso: true, valor: "" }], resultado: "aviso", rotulo: "Apto 101" },
        { codigo: "JAD-102", linha: 3, problemas: [], resultado: "erro", rotulo: "Apto 102" },
      ],
      ok: true,
      unidadesHoje: 42,
    });
  });

  it("conferência que falha: a mensagem do servidor, ou a padrão por status; o formato antigo não passa", () => {
    expect(lerRespostaDaConferencia(404, { error: "Produto não encontrado." })).toEqual({
      mensagem: "Produto não encontrado.",
      ok: false,
    });
    const semCorpo = lerRespostaDaConferencia(500, null);
    expect(!semCorpo.ok && semCorpo.mensagem).toContain("conferir a planilha");
    const pendente = lerRespostaDaConferencia(503, {});
    expect(!pendente.ok && pendente.mensagem).toContain("ainda não está liberado");
    expect(lerRespostaDaConferencia(200, { data: { conferencia: { problemas: [], unidades: [] } } }).ok).toBe(false);
  });
});

describe("respostas da gravação", () => {
  it("importar: o sucesso é o que o banco releu", () => {
    expect(
      lerRespostaDaImportacao(200, {
        data: {
          avisos: [{ campo: "matricula", linha: 2, motivo: "Sem matrícula", soAviso: true, valor: "" }],
          criadas: 1,
          produto: { codigo: "JAD" },
          unidades: [{ codigo: "JAD-A-304", id: "u-1", rotulo: "Torre A · Apto 304", situacao: "disponivel" }, { codigo: "sem id" }],
        },
      }),
    ).toEqual({
      avisos: [{ campo: "matricula", linha: 2, motivo: "Sem matrícula", soAviso: true, valor: "" }],
      ok: true,
      unidades: [{ codigo: "JAD-A-304", id: "u-1", rotulo: "Torre A · Apto 304", situacao: "disponivel" }],
    });

    // ⚠️ 200 sem as unidades relidas não é sucesso.
    const semProva = lerRespostaDaImportacao(200, { data: { criadas: 3 } });
    expect(!semProva.ok && semProva.mensagem).toContain("sem confirmar");
  });

  it("importar recusado: 422 traz a conferência; 500 traz o que faltou; o resto é mensagem", () => {
    const recusado = lerRespostaDaImportacao(422, {
      data: { bloqueioDaGravacao: null, linhas: [{ codigo: "JAD-101", linha: 2, problemas: [], resultado: "erro", rotulo: "Apto 101" }] },
      error: "1 linha tem problema, e nada foi gravado. Corrija a planilha e envie de novo.",
    });
    expect(recusado).toEqual({
      faltando: [],
      linhas: [{ codigo: "JAD-101", linha: 2, problemas: [], resultado: "erro", rotulo: "Apto 101" }],
      mensagem: "1 linha tem problema, e nada foi gravado. Corrija a planilha e envie de novo.",
      ok: false,
    });

    const incompleto = lerRespostaDaImportacao(500, { data: { faltando: ["JAD-102", 7], unidades: [] }, error: "Parte das unidades não apareceu." });
    expect(!incompleto.ok && incompleto.faltando).toEqual(["JAD-102"]);

    const corrida = lerRespostaDaImportacao(409, { error: "Uma das unidades acabou de ser cadastrada por outra pessoa." });
    expect(corrida).toMatchObject({ linhas: null, mensagem: "Uma das unidades acabou de ser cadastrada por outra pessoa.", ok: false });
    const semAcesso = lerRespostaDaImportacao(401, null);
    expect(!semAcesso.ok && semAcesso.mensagem).toContain("não permite");
  });

  it("criar: a unidade relida; a recusa com conferência vai para os campos, sem mensagem repetida", () => {
    expect(
      lerRespostaDaCriacao(200, { data: { avisos: [], unidade: { codigo: "SOL0107", id: "u-7", rotulo: "Quadra 01 · Lote 07", situacao: "bloqueada" } } }),
    ).toEqual({ avisos: [], ok: true, unidade: { codigo: "SOL0107", id: "u-7", rotulo: "Quadra 01 · Lote 07", situacao: "bloqueada" } });

    const jaExiste = lerRespostaDaCriacao(409, {
      data: {
        linhas: [
          {
            codigo: "SOL0107",
            linha: 2,
            problemas: [{ campo: "quadra/lote", linha: 2, motivo: "Quadra 01 · Lote 07 já está cadastrada neste produto (SOL0107).", valor: "SOL0107" }],
            resultado: "erro",
            rotulo: "Quadra 01 · Lote 07",
          },
        ],
      },
      error: "Quadra 01 · Lote 07 já está cadastrada neste produto (SOL0107).",
    });
    expect(jaExiste).toEqual({
      mensagem: null,
      ok: false,
      problemas: [{ campo: "quadra/lote", linha: 2, motivo: "Quadra 01 · Lote 07 já está cadastrada neste produto (SOL0107).", valor: "SOL0107" }],
    });

    // Sem conferência (a corrida no índice, 503): a mensagem da rota.
    expect(lerRespostaDaCriacao(409, { error: "Esta unidade acabou de ser cadastrada por outra pessoa." })).toEqual({
      mensagem: "Esta unidade acabou de ser cadastrada por outra pessoa.",
      ok: false,
      problemas: [],
    });
    expect(lerRespostaDaCriacao(200, { data: { unidade: null } }).ok).toBe(false);
  });
});
