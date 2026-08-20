import { describe, expect, it } from "vitest";

import {
  chaveDaColuna,
  conferirPlanilha,
  doisDigitos,
  lerCsv,
  nomeDaUnidade,
  numeroBR,
  payloadDaUnidade,
} from "./cadastrar-unidades";

describe("numeroBR", () => {
  it("lê o formato brasileiro, que é como a planilha vem", () => {
    // ⚠️ O CASO QUE MOTIVA A FUNÇÃO: "1.002,00" é MIL E DOIS. Number() devolveria NaN, e um
    // parser ingênuo que só troca vírgula por ponto devolveria 1.00200 — um lote de R$ 140.401
    // viraria R$ 140,40 sem nada acusar.
    expect(numeroBR("1.002,00")).toBe(1002);
    expect(numeroBR("140.401,00")).toBe(140401);
    expect(numeroBR("1.234.567,89")).toBeCloseTo(1234567.89, 2);
    expect(numeroBR("600,00")).toBe(600);
  });

  it("aceita número puro, que é o que o Excel devolve em célula numérica", () => {
    expect(numeroBR(1002)).toBe(1002);
    expect(numeroBR(1002.5)).toBe(1002.5);
  });

  it("distingue ponto de milhar de ponto decimal", () => {
    // Sem vírgula, o ponto só é decimal quando sobram 1 ou 2 casas.
    expect(numeroBR("1.000")).toBe(1000);
    expect(numeroBR("1000.5")).toBe(1000.5);
    expect(numeroBR("1000.50")).toBe(1000.5);
  });

  it("tira R$, m² e espaço sem reclamar", () => {
    expect(numeroBR("R$ 140.401,00")).toBe(140401);
    expect(numeroBR("1.000,00 m²")).toBe(1000);
    expect(numeroBR("  1000  ")).toBe(1000);
  });

  it("devolve null no que não é número, em vez de zero", () => {
    // Zero passaria na validação de "preenchido" e criaria unidade de R$ 0.
    expect(numeroBR("")).toBeNull();
    expect(numeroBR(null)).toBeNull();
    expect(numeroBR("a definir")).toBeNull();
  });
});

describe("doisDigitos", () => {
  it("iguala a planilha ao C2X, que guarda 01", () => {
    // Sem isto, a conferência de duplicidade não acha o que existe e cria tudo de novo.
    expect(doisDigitos("1")).toBe("01");
    expect(doisDigitos(1)).toBe("01");
    expect(doisDigitos("01")).toBe("01");
    expect(doisDigitos("156")).toBe("156");
  });

  it("preserva quadra com letra, que a Lagoa Bonita usa", () => {
    expect(doisDigitos("C01")).toBe("C01");
    expect(doisDigitos("c01")).toBe("C01");
    expect(doisDigitos("A")).toBe("A");
  });
});

describe("nomeDaUnidade", () => {
  it("monta o código como o C2X faz", () => {
    expect(nomeDaUnidade("VOC", "1", "7")).toBe("VOC0107");
    expect(nomeDaUnidade("gdn", 12, 3)).toBe("GDN1203");
  });
});

describe("conferirPlanilha", () => {
  const boa = { area: "1.000,00", lote: "07", quadra: "01", valor: "140.401,00" };

  it("aceita a linha mínima e assume Disponível", () => {
    const { problemas, unidades } = conferirPlanilha([boa]);

    expect(unidades).toHaveLength(1);
    expect(unidades[0]).toMatchObject({
      area: 1000,
      lote: "07",
      quadra: "01",
      saleBlocked: 0,
      statusId: 1,
      valor: 140401,
    });
    // Sem matrícula é aviso, não erro: a unidade sobe.
    expect(problemas.every((p) => p.soAviso)).toBe(true);
  });

  it("mapeia os status em português, com e sem acento", () => {
    const linhas = [
      { ...boa, lote: "01", status: "Disponível" },
      { ...boa, lote: "02", status: "disponivel" },
      { ...boa, lote: "03", status: "Bloqueado" },
      { ...boa, lote: "04", status: "BLOQUEADO PARA VENDA" },
      { ...boa, lote: "05", status: "Reservado" },
      { ...boa, lote: "06", status: "Em negociação" },
      { ...boa, lote: "07", status: "Vendido" },
    ];
    const { unidades } = conferirPlanilha(linhas);

    expect(unidades.map((u) => u.statusId)).toEqual([1, 1, 5, 5, 2, 3, 4]);
    // ⚠️ O FLAG ANDA JUNTO: "Bloqueado" liga os dois campos, e não só o status.
    expect(unidades.map((u) => u.saleBlocked)).toEqual([0, 0, 1, 1, 0, 0, 0]);
  });

  it("recusa status que não existe, em vez de chutar Disponível", () => {
    const { problemas, unidades } = conferirPlanilha([{ ...boa, status: "à venda com placa" }]);

    expect(unidades).toHaveLength(0);
    expect(problemas.some((p) => p.campo === "status" && !p.soAviso)).toBe(true);
  });

  it("avisa quando o status depende de uma proposta que não existe", () => {
    // Vendido/Reservado/Em negociação sobem, mas com aviso: sem contrato por trás, a tela de
    // Vendas passa a contar uma venda que não aconteceu.
    const { problemas, unidades } = conferirPlanilha([{ ...boa, status: "Vendido" }]);

    expect(unidades).toHaveLength(1);
    expect(problemas.some((p) => p.campo === "status" && p.soAviso)).toBe(true);
  });

  it("trava a linha sem quadra, lote, área ou valor", () => {
    // ⚠️ LOTES DIFERENTES DE PROPÓSITO. Com o mesmo lote nas quatro, a checagem de duplicidade
    // dispara junto e o teste passa a medir duas coisas ao mesmo tempo — foi o que aconteceu na
    // primeira versão, que esperava 4 erros e recebeu 5.
    const { problemas, unidades } = conferirPlanilha([
      { ...boa, lote: "01", quadra: "" },
      { ...boa, lote: "" },
      { ...boa, area: "", lote: "03" },
      { ...boa, lote: "04", valor: "a combinar" },
    ]);

    expect(unidades).toHaveLength(0);
    const erros = problemas.filter((p) => !p.soAviso);
    expect(erros).toHaveLength(4);
    expect(erros.map((e) => e.campo).sort()).toEqual(["area", "lote", "quadra", "valor"]);
  });

  it("recusa área e valor zerados", () => {
    const { unidades } = conferirPlanilha([{ ...boa, area: "0" }, { ...boa, valor: "0" }]);
    expect(unidades).toHaveLength(0);
  });

  it("pega a mesma quadra e lote repetidos na planilha", () => {
    // Duas linhas iguais criariam duas unidades no C2X, e a segunda só apareceria na hora de vender.
    const { problemas, unidades } = conferirPlanilha([boa, { ...boa }]);

    expect(unidades).toHaveLength(1);
    const repetida = problemas.find((p) => p.campo === "quadra/lote");
    expect(repetida?.motivo).toContain("linha 2");
    expect(repetida?.linha).toBe(3);
  });

  it("compara duplicidade JÁ normalizada", () => {
    // "1"/"01" e "7"/"07" são a mesma unidade. Sem normalizar antes de comparar, as duas passariam.
    const { unidades } = conferirPlanilha([
      { area: "1000", lote: "7", quadra: "1", valor: "1000" },
      { area: "1000", lote: "07", quadra: "01", valor: "1000" },
    ]);

    expect(unidades).toHaveLength(1);
  });

  it("numera a linha como o Excel mostra, contando o cabeçalho", () => {
    const { problemas } = conferirPlanilha([{ ...boa, quadra: "" }]);
    // Primeira linha de dados é a 2 na tela do Excel.
    expect(problemas[0]?.linha).toBe(2);
  });
});

describe("payloadDaUnidade", () => {
  it("monta o corpo que o C2X espera", () => {
    const [unidade] = conferirPlanilha([
      { area: "1.000,00", lote: "7", matricula: "25.862", quadra: "1", status: "Disponível", valor: "140.401,00" },
    ]).unidades;

    expect(payloadDaUnidade(unidade!, 35, "VLO")).toEqual({
      area: 1000,
      block: "01",
      enterprise_id: 35,
      enterprise_unity_type_id: 1,
      lot: "07",
      name: "VLO0107",
      price: 140401,
      registration: "25.862",
      registration_number: "25.862",
      sale_blocked: 0,
      sale_status_id: 1,
    });
  });

  it("omite a matrícula quando não veio, em vez de mandar vazio", () => {
    const [unidade] = conferirPlanilha([
      { area: "1000", lote: "1", quadra: "1", valor: "1000" },
    ]).unidades;

    const corpo = payloadDaUnidade(unidade!, 39, "GDN");
    expect(corpo).not.toHaveProperty("registration");
    expect(corpo).not.toHaveProperty("registration_number");
  });
});

describe("chaveDaColuna", () => {
  it("aceita como cada um escreve o cabeçalho", () => {
    // A planilha vem do cartório, do loteador, do corretor — cada um escreve de um jeito.
    expect(chaveDaColuna("Quadra")).toBe("quadra");
    expect(chaveDaColuna("QUADRA")).toBe("quadra");
    expect(chaveDaColuna("Área (m²)")).toBe("area");
    expect(chaveDaColuna("area")).toBe("area");
    expect(chaveDaColuna("Metragem")).toBe("area");
    expect(chaveDaColuna("metragem_m2")).toBe("area");
    expect(chaveDaColuna("Valor (R$)")).toBe("valor");
    expect(chaveDaColuna("Preço")).toBe("valor");
    expect(chaveDaColuna("Matrícula")).toBe("matricula");
    expect(chaveDaColuna("Situação")).toBe("status");
  });

  it("ignora coluna que não conhece, em vez de adivinhar", () => {
    // Adivinhar poria o valor de "Observações" dentro de um campo de verdade.
    expect(chaveDaColuna("Observações")).toBe("");
    expect(chaveDaColuna("")).toBe("");
  });
});

describe("lerCsv", () => {
  it("descobre o separador, que muda conforme quem salvou", () => {
    // ⚠️ O Excel em português salva com ponto e vírgula; o resto do mundo, com vírgula. Cravar um
    // faria metade das planilhas virar uma coluna só, e o erro apareceria como "quadra em branco"
    // em todas as linhas — mensagem que não ajuda a descobrir que o problema era o separador.
    const comPontoEVirgula = "Quadra;Lote;Área (m²);Valor (R$)\n01;07;1000,00;140401,00";
    const comVirgula = "Quadra,Lote,Área (m²),Valor (R$)\n01,07,1000.00,140401.00";

    expect(lerCsv(comPontoEVirgula)).toEqual([
      { area: "1000,00", lote: "07", quadra: "01", valor: "140401,00" },
    ]);
    expect(lerCsv(comVirgula)).toEqual([
      { area: "1000.00", lote: "07", quadra: "01", valor: "140401.00" },
    ]);
  });

  it("engole o BOM que o Excel põe no começo", () => {
    // Sem isto, a primeira coluna vira "\ufeffQuadra" e não casa com nada.
    const { unidades } = conferirPlanilha(
      lerCsv("\ufeffQuadra;Lote;Metragem;Valor\n01;07;1000;140401"),
    );
    expect(unidades).toHaveLength(1);
    expect(unidades[0]?.quadra).toBe("01");
  });

  it("aceita CRLF, que é como o Windows salva", () => {
    expect(lerCsv("Quadra;Lote;Área;Valor\r\n01;07;1000;140401\r\n")).toHaveLength(1);
  });

  it("devolve vazio no arquivo só com cabeçalho", () => {
    expect(lerCsv("Quadra;Lote;Área;Valor")).toEqual([]);
    expect(lerCsv("")).toEqual([]);
  });

  it("do CSV até a unidade pronta, no caminho inteiro", () => {
    // O teste que amarra as duas pontas: o que sai do arquivo tem que virar unidade válida.
    const csv = [
      "Quadra;Lote;Área (m²);Valor (R$);Matrícula;Status;Tipo",
      "01;07;1.000,00;140.401,00;25.862;Disponível;Unidade interna",
      "01;08;1.002,00;136.561,00;25.863;Bloqueado;Unidade interna",
    ].join("\n");

    const { problemas, unidades } = conferirPlanilha(lerCsv(csv));

    expect(problemas.filter((p) => !p.soAviso)).toHaveLength(0);
    expect(unidades).toHaveLength(2);
    expect(unidades[0]).toMatchObject({ area: 1000, matricula: "25.862", statusId: 1, valor: 140401 });
    expect(unidades[1]).toMatchObject({ area: 1002, saleBlocked: 1, statusId: 5 });
  });
});

// ⚠️ O CASO QUE MOTIVOU ISTO (Lucas, 20/08/2026): *"vou testar depois, pois eu ainda não tenho o
// valor dessas matrículas"*. Ter matrícula, quadra, lote e metragem do cartório e o preço só
// semanas depois é o caso comum — e exigir o valor obrigaria a inventar um número, que entraria no
// VGV sem ninguém desconfiar.
describe("unidade sem valor de tabela", () => {
  const semValor = { area: "1.000,00", lote: "07", matricula: "25.862", quadra: "01" };

  it("sobe com preço zero e avisa, em vez de travar a linha", () => {
    const { problemas, unidades } = conferirPlanilha([semValor]);

    expect(unidades).toHaveLength(1);
    expect(unidades[0]?.valor).toBe(0);

    const aviso = problemas.find((p) => p.campo === "valor");
    expect(aviso?.soAviso).toBe(true);
    expect(aviso?.motivo).toContain("VGV");
  });

  it("mas continua recusando valor que não é número", () => {
    // Em branco é "ainda não sei"; "a combinar" é alguém achando que dá para escrever qualquer
    // coisa no campo de preço.
    const { problemas, unidades } = conferirPlanilha([{ ...semValor, valor: "a combinar" }]);

    expect(unidades).toHaveLength(0);
    expect(problemas.some((p) => p.campo === "valor" && !p.soAviso)).toBe(true);
  });

  it("e recusando zero escrito à mão", () => {
    // Zero digitado é diferente de campo vazio: quem escreveu 0 provavelmente errou.
    const { unidades } = conferirPlanilha([{ ...semValor, valor: "0" }]);
    expect(unidades).toHaveLength(0);
  });

  it("o payload sai com price 0, que é o que o C2X exige receber", () => {
    const [unidade] = conferirPlanilha([semValor]).unidades;
    expect(payloadDaUnidade(unidade!, 42, "ACP")).toMatchObject({
      area: 1000,
      block: "01",
      lot: "07",
      price: 0,
      registration: "25.862",
    });
  });
});
