import { describe, expect, it } from "vitest";

import {
  casarPlanilhaDeVinculo,
  categoriaCompativel,
  chaveDaColunaDeVinculo,
  type DivisaoDaFamilia,
  filtrarUnidades,
  lerCsvDeVinculo,
  lerFaixaDeLotes,
  planoDeMudancaDeDivisao,
  previaDoVinculo,
  type UnidadeDoUniverso,
} from "./unidade-vinculo";

// O caso REAL medido em 21/09/2026: o Lagoa Bonita tem o pai 31 e as glebas LBR 27, LBP 32, LBF 33,
// e o mesmo terreno tem duas linhas (a do pai é espelho da da gleba, migration 0161). As duas
// categorias vivem no PAI e carimbam unidades das glebas.
const PAI = "31";
const LBR = "27";
const LBP = "32";

const CONDOMINIO = "cat-condominio";
const LOTEAMENTO = "cat-loteamento";

const DIVISOES: DivisaoDaFamilia[] = [
  { codigo: "LAB", enterpriseId: PAI, nome: "Lagoa Bonita", pai: true },
  { codigo: "LBR", enterpriseId: LBR, nome: "Lagoa Bonita Residencial", pai: false },
  { codigo: "LBP", enterpriseId: LBP, nome: "Lagoa Bonita Parque", pai: false },
];

function linha(parcial: Partial<UnidadeDoUniverso> & { id: string }): UnidadeDoUniverso {
  return {
    categoria_id: null,
    codigo: null,
    enterprise_id: LBR,
    espelho_de: null,
    lote: "01",
    quadra: "C",
    situacao: "disponivel",
    ...parcial,
  };
}

/** O par pai + gleba do mesmo chão, como o banco tem hoje. */
function terreno(chave: string, quadra: string, lote: string, extras?: Partial<UnidadeDoUniverso>) {
  return [
    linha({
      codigo: `LAB${quadra}${lote}`,
      enterprise_id: PAI,
      espelho_de: `${chave}-gleba`,
      id: `${chave}-pai`,
      lote: `0${lote}`,
      quadra,
      ...extras,
    }),
    linha({
      codigo: `LBR${quadra}${lote}`,
      enterprise_id: LBR,
      id: `${chave}-gleba`,
      lote,
      quadra,
      ...extras,
    }),
  ];
}

describe("lerFaixaDeLotes", () => {
  it("entende a faixa como o operador escreve", () => {
    for (const texto of ["1-40", "01 a 40", "1 até 40", "1..40"]) {
      const faixa = lerFaixaDeLotes(texto);
      expect(faixa.erro).toBeNull();
      expect(faixa.combina("07")).toBe(true);
      expect(faixa.combina("41")).toBe(false);
    }
  });

  // ⚠️ O ZERO À ESQUERDA NÃO DISTINGUE LOTE: o pai grava "0101" onde a gleba grava "101". Comparar
  // como texto deixaria o "9" de fora de "1-40".
  it("compara como número, não como texto", () => {
    const faixa = lerFaixaDeLotes("1-40");
    expect(faixa.combina("009")).toBe(true);
    expect(faixa.combina("9")).toBe(true);
  });

  it("aceita lista com faixas e avulsos", () => {
    const faixa = lerFaixaDeLotes("1-3, 45, 50-52");
    expect([faixa.combina("2"), faixa.combina("45"), faixa.combina("51")]).toEqual([true, true, true]);
    expect(faixa.combina("44")).toBe(false);
  });

  it("o lote com letra só entra escrito por extenso", () => {
    expect(lerFaixaDeLotes("1-40").combina("12A")).toBe(false);
    expect(lerFaixaDeLotes("12A").combina("12a")).toBe(true);
  });

  // ⚠️ FAIXA MAL DIGITADA NÃO PODE VIRAR "PEGA TUDO": seria o acidente de carimbar o loteamento
  // inteiro com um clique.
  it("faixa que não dá para ler recusa tudo e diz o motivo", () => {
    const faixa = lerFaixaDeLotes("do começo ao fim");
    expect(faixa.erro).toContain("Não entendi a faixa");
    expect(faixa.combina("01")).toBe(false);
  });

  it("vazio não filtra nada", () => {
    const faixa = lerFaixaDeLotes("   ");
    expect(faixa.vazia).toBe(true);
    expect(faixa.combina("qualquer")).toBe(true);
  });
});

describe("filtrarUnidades", () => {
  const universo = [
    ...terreno("c01", "C", "1"),
    ...terreno("c02", "C", "2", { situacao: "vendido" }),
    ...terreno("d10", "D", "10", { categoria_id: CONDOMINIO }),
  ];

  it("filtra por quadra", () => {
    expect(filtrarUnidades(universo, { quadras: ["D"] }).map((u) => u.id)).toEqual([
      "d10-pai",
      "d10-gleba",
    ]);
  });

  it("filtra por faixa de lotes", () => {
    const ids = filtrarUnidades(universo, { faixa: "1-2" }).map((u) => u.id);
    expect(ids).toContain("c01-gleba");
    expect(ids).not.toContain("d10-gleba");
  });

  it("filtra por divisão", () => {
    expect(filtrarUnidades(universo, { divisoes: [LBR] }).every((u) => u.enterprise_id === LBR)).toBe(
      true,
    );
  });

  it("filtra por situação", () => {
    expect(filtrarUnidades(universo, { situacoes: ["vendido"] }).map((u) => u.id)).toEqual([
      "c02-pai",
      "c02-gleba",
    ]);
  });

  it("filtra pelo estado da categoria", () => {
    expect(filtrarUnidades(universo, { categoria: "sem" }).map((u) => u.id)).not.toContain("d10-gleba");
    expect(
      filtrarUnidades(universo, { categoria: "noutra" }, { categoriaAlvo: LOTEAMENTO }).map((u) => u.id),
    ).toEqual(["d10-pai", "d10-gleba"]);
    expect(
      filtrarUnidades(universo, { categoria: "nesta" }, { categoriaAlvo: CONDOMINIO }).map((u) => u.id),
    ).toEqual(["d10-pai", "d10-gleba"]);
  });

  // ⚠️ FAIXA QUEBRADA NÃO PODE ABRIR A LISTA INTEIRA (ver `lerFaixaDeLotes`).
  it("faixa inválida devolve lista vazia", () => {
    expect(filtrarUnidades(universo, { faixa: "mais ou menos" })).toEqual([]);
  });
});

describe("previaDoVinculo", () => {
  const universo = [
    ...terreno("c01", "C", "1"),
    ...terreno("c02", "C", "2", { categoria_id: LOTEAMENTO }),
    ...terreno("c03", "C", "3", { categoria_id: CONDOMINIO }),
  ];
  const nomes = new Map([
    [CONDOMINIO, "Condomínio"],
    [LOTEAMENTO, "Loteamento"],
  ]);

  it("o gêmeo do pai entra sem o operador escolher", () => {
    const previa = previaDoVinculo(["c01-gleba"], universo, {
      categoriaAlvo: CONDOMINIO,
      nomeDaCategoria: nomes,
    });
    expect(previa.ids.sort()).toEqual(["c01-gleba", "c01-pai"]);
    expect(previa.terrenos).toBe(1);
    expect(previa.porParentesco).toBe(1);
    expect(previa.semCategoria).toBe(1);
  });

  it("diz de qual categoria o lote está saindo, pelo nome", () => {
    const previa = previaDoVinculo(["c02-gleba"], universo, {
      categoriaAlvo: CONDOMINIO,
      nomeDaCategoria: nomes,
    });
    expect(previa.trocamDeCategoria).toEqual([{ de: "Loteamento", terrenos: 1 }]);
  });

  // ⚠️ REGRAVAR O MESMO VALOR MEXERIA EM `atualizado_em` E NO CARIMBO DE 907 LINHAS À TOA — foi o
  // estrago que as migrations 0161 e 0162 fizeram em 710 linhas.
  it("quem já está na categoria não entra na gravação", () => {
    const previa = previaDoVinculo(["c03-gleba"], universo, {
      categoriaAlvo: CONDOMINIO,
      nomeDaCategoria: nomes,
    });
    expect(previa.jaEstao).toBe(1);
    expect(previa.ids).toEqual([]);
  });

  // ⚠️ PAI CARIMBADO E GLEBA SEM CATEGORIA É JUSTAMENTE O QUE O VÍNCULO POR TERRENO CONSERTA.
  it("o terreno meio carimbado não conta como pronto", () => {
    const meio = [
      linha({ enterprise_id: PAI, espelho_de: "x-gleba", id: "x-pai", categoria_id: CONDOMINIO, lote: "07", quadra: "E" }),
      linha({ enterprise_id: LBR, id: "x-gleba", lote: "07", quadra: "E" }),
    ];
    const previa = previaDoVinculo(["x-gleba"], meio, { categoriaAlvo: CONDOMINIO });
    expect(previa.jaEstao).toBe(0);
    expect(previa.ids.sort()).toEqual(["x-gleba", "x-pai"]);
  });

  // ⚠️ AVISO, E NÃO TRAVA (Lucas, 15/09/2026: *"não muda nada o que já está venda andando"*).
  it("conta a venda andando sem impedir o vínculo", () => {
    const vendido = [
      linha({ enterprise_id: LBR, id: "v1", lote: "09", quadra: "F", situacao: "vendido", temVendaViva: true }),
    ];
    const previa = previaDoVinculo(["v1"], vendido, { categoriaAlvo: CONDOMINIO });
    expect(previa.vendaAndando).toBe(1);
    expect(previa.ids).toEqual(["v1"]);
  });

  it("tirar a categoria de quem não tem não grava nada", () => {
    const previa = previaDoVinculo(["c01-gleba"], universo, { categoriaAlvo: null });
    expect(previa.jaEstao).toBe(1);
    expect(previa.ids).toEqual([]);
  });
});

describe("categoriaCompativel", () => {
  const condominio = { enterpriseId: PAI, nome: "Condomínio" };

  // ⚠️ A CATEGORIA MORA NO PAI E CARIMBA UNIDADE DE FILHO: é o cadastro real de 907 lotes.
  it("a categoria do pai vale para a unidade da gleba", () => {
    expect(categoriaCompativel(condominio, { enterprise_id: LBR }, [PAI, LBR, LBP]).ok).toBe(true);
  });

  it("a categoria de outro empreendimento é recusada com a frase", () => {
    const fora = categoriaCompativel(condominio, { enterprise_id: "35" }, [PAI, LBR, LBP]);
    expect(fora.ok).toBe(false);
    if (!fora.ok) expect(fora.motivo).toContain("outro empreendimento");
  });

  it("unidade sem empreendimento é recusada", () => {
    expect(categoriaCompativel(condominio, { enterprise_id: null }, [PAI]).ok).toBe(false);
  });
});

describe("planoDeMudancaDeDivisao", () => {
  const livre = linha({ codigo: "LBRC07", enterprise_id: LBR, id: "livre", lote: "07", quadra: "C" });
  const vendida = linha({
    codigo: "LBRC08",
    enterprise_id: LBR,
    id: "vendida",
    lote: "08",
    quadra: "C",
    situacao: "vendido",
  });
  const comProposta = linha({
    codigo: "LBRC09",
    enterprise_id: LBR,
    id: "com-proposta",
    lote: "09",
    quadra: "C",
    temVendaViva: true,
  });
  const espelho = linha({
    codigo: "LABC10",
    enterprise_id: PAI,
    espelho_de: "outra",
    id: "espelho",
    lote: "010",
    quadra: "C",
  });

  it("move a unidade livre e avisa o que muda junto", () => {
    const plano = planoDeMudancaDeDivisao(["livre"], [livre], {
      destino: LBP,
      divisoes: DIVISOES,
    });
    expect(plano.mover).toEqual([{ codigo: "LBRC07", de: LBR, para: LBP, unidadeId: "livre" }]);
    expect(plano.avisos.join(" ")).toContain("Lagoa Bonita Parque");
    // ⚠️ O CÓDIGO NÃO ACOMPANHA A MUDANÇA, e o masterplan casa pelo código.
    expect(plano.avisos.join(" ")).toContain("masterplan");
  });

  // ⚠️ RECUSA COM FRASE, e não aviso: trocar a divisão no meio da negociação troca a minuta, a
  // comissão e quem enxerga o lote.
  it("recusa a unidade com venda viva", () => {
    const plano = planoDeMudancaDeDivisao(["com-proposta"], [comProposta], {
      destino: LBP,
      divisoes: DIVISOES,
    });
    expect(plano.mover).toEqual([]);
    expect(plano.recusas[0]?.motivo).toContain("venda em andamento");
  });

  it("recusa a unidade que não está livre", () => {
    const plano = planoDeMudancaDeDivisao(["vendida"], [vendida], {
      destino: LBP,
      divisoes: DIVISOES,
    });
    expect(plano.recusas[0]?.motivo).toContain("vendido");
  });

  it("recusa o registro antigo do terreno", () => {
    const plano = planoDeMudancaDeDivisao(["espelho"], [espelho], {
      destino: LBP,
      divisoes: DIVISOES,
    });
    expect(plano.recusas[0]?.motivo).toContain("registro antigo");
  });

  // ⚠️ DUAS LINHAS DO MESMO CHÃO NA MESMA GLEBA é o estrago que nenhuma FK impede.
  it("recusa quando o mesmo terreno já existe no destino", () => {
    const gemea = linha({ codigo: "LBPC07", enterprise_id: LBP, id: "gemea", lote: "7", quadra: "C" });
    const plano = planoDeMudancaDeDivisao(["livre"], [livre, gemea], {
      destino: LBP,
      divisoes: DIVISOES,
    });
    expect(plano.mover).toEqual([]);
    expect(plano.recusas[0]?.motivo).toContain("mesmo terreno já existe");
  });

  it("recusa quando o código já é de outra unidade do destino", () => {
    const mesmoCodigo = linha({
      codigo: "LBRC07",
      enterprise_id: LBP,
      id: "homonima",
      lote: "99",
      quadra: "Z",
    });
    const plano = planoDeMudancaDeDivisao(["livre"], [livre, mesmoCodigo], {
      destino: LBP,
      divisoes: DIVISOES,
    });
    expect(plano.recusas[0]?.motivo).toContain("Já existe uma unidade LBRC07");
  });

  it("destino fora da família é recusado", () => {
    const plano = planoDeMudancaDeDivisao(["livre"], [livre], {
      destino: "35",
      divisoes: DIVISOES,
    });
    expect(plano.recusas[0]?.motivo).toContain("não é deste empreendimento");
  });

  it("quem já está no destino não é erro, é nada a fazer", () => {
    const plano = planoDeMudancaDeDivisao(["livre"], [livre], {
      destino: LBR,
      divisoes: DIVISOES,
    });
    expect(plano.jaNoDestino).toBe(1);
    expect(plano.mover).toEqual([]);
    expect(plano.recusas).toEqual([]);
  });
});

describe("a planilha de vínculo", () => {
  it("entende os cabeçalhos do dia a dia", () => {
    expect(chaveDaColunaDeVinculo("Quadra")).toBe("quadra");
    expect(chaveDaColunaDeVinculo("LOTE")).toBe("lote");
    expect(chaveDaColunaDeVinculo("Categoria")).toBe("categoria");
    expect(chaveDaColunaDeVinculo("Gleba")).toBe("divisao");
    expect(chaveDaColunaDeVinculo("Divisão")).toBe("divisao");
    expect(chaveDaColunaDeVinculo("Valor (R$)")).toBe("");
  });

  it("descobre o separador do Excel em português", () => {
    const linhas = lerCsvDeVinculo("Quadra;Lote;Categoria\nC;01;Condomínio\n");
    expect(linhas).toEqual([{ categoria: "Condomínio", lote: "01", quadra: "C" }]);
  });

  const universo = [...terreno("c01", "C", "1"), ...terreno("c02", "C", "2")];
  const categorias = [
    { enterpriseId: PAI, id: CONDOMINIO, nome: "Condomínio" },
    { enterpriseId: PAI, id: LOTEAMENTO, nome: "Loteamento" },
  ];
  const contexto = { categorias, divisoes: DIVISOES, familia: [PAI, LBR, LBP], universo };

  // ⚠️ CASA POR QUADRA + LOTE, NÃO PELO CÓDIGO: o código muda de prefixo entre os níveis.
  it("casa a linha da planilha com a unidade viva do terreno", () => {
    const relatorio = casarPlanilhaDeVinculo(
      [{ categoria: "CONDOMINIO", lote: "01", quadra: "C" }],
      contexto,
    );
    expect(relatorio.casaram).toEqual([
      { categoriaId: CONDOMINIO, linha: 2, rotulo: "LBRC1", unidadeId: "c01-gleba" },
    ]);
    expect(relatorio.resumo.comCategoria).toBe(1);
  });

  // ⚠️ NOME QUE NÃO EXISTE É RECUSA DA LINHA, NUNCA "SEM CATEGORIA": passar com nulo apagaria a
  // categoria de um lote por causa de um acento digitado errado.
  it("categoria desconhecida não casa, e diz o nome", () => {
    const relatorio = casarPlanilhaDeVinculo(
      [{ categoria: "Caução", lote: "01", quadra: "C" }],
      contexto,
    );
    expect(relatorio.casaram).toEqual([]);
    expect(relatorio.naoCasaram[0]?.motivo).toContain('"Caução" não existe');
  });

  it("lote que não existe não casa", () => {
    const relatorio = casarPlanilhaDeVinculo(
      [{ categoria: "Condomínio", lote: "99", quadra: "Z" }],
      contexto,
    );
    expect(relatorio.naoCasaram[0]?.motivo).toContain("Nenhum lote");
  });

  it("linha repetida é recusada, apontando a primeira", () => {
    const relatorio = casarPlanilhaDeVinculo(
      [
        { categoria: "Condomínio", lote: "01", quadra: "C" },
        { categoria: "Loteamento", lote: "1", quadra: "C" },
      ],
      contexto,
    );
    expect(relatorio.casaram).toHaveLength(1);
    expect(relatorio.naoCasaram[0]?.motivo).toContain("a linha 2 já traz");
  });

  it("célula em branco não mexe na categoria; a palavra sem apaga", () => {
    const relatorio = casarPlanilhaDeVinculo(
      [
        { categoria: "", lote: "01", quadra: "C" },
        { categoria: "sem", lote: "02", quadra: "C" },
      ],
      contexto,
    );
    expect(relatorio.resumo.semMudanca).toBe(1);
    expect(relatorio.casaram).toEqual([
      { categoriaId: null, linha: 3, rotulo: "LBRC2", unidadeId: "c02-gleba" },
    ]);
  });

  it("a divisão casa pelo código, pelo nome e pelo id", () => {
    for (const valor of ["LBP", "Lagoa Bonita Parque", LBP]) {
      const relatorio = casarPlanilhaDeVinculo([{ divisao: valor, lote: "01", quadra: "C" }], contexto);
      expect(relatorio.casaram[0]?.divisaoDestino).toBe(LBP);
    }
  });

  it("divisão de fora da família não casa", () => {
    const relatorio = casarPlanilhaDeVinculo(
      [{ divisao: "VOL", lote: "01", quadra: "C" }],
      contexto,
    );
    expect(relatorio.naoCasaram[0]?.motivo).toContain("não é deste empreendimento");
  });

  it("linha sem quadra ou sem lote não casa", () => {
    const relatorio = casarPlanilhaDeVinculo([{ categoria: "Condomínio", lote: "", quadra: "C" }], contexto);
    expect(relatorio.naoCasaram[0]?.motivo).toContain("Sem quadra e lote");
  });
});
