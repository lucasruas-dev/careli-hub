import { describe, expect, it } from "vitest";

import {
  avisosDaProposta,
  conferirProposta,
  type DadosDoAvisoDaProposta,
  dataEscrita,
  diaDoCalendario,
  type PedidoDeProposta,
  VENCIMENTO_DIA_MAXIMO,
} from "./proposta";
import { mascararCpf } from "./reserva";

const AGORA = "2026-09-04T17:00:00.000Z";

const PEDIDO: PedidoDeProposta = {
  compradores: [
    { cpf: "529.982.247-25", nome: "Maria da Silva", participacao: 100, titular: true },
  ],
  entradaMinimaPercentual: null,
  entradaValor: 17_810,
  entradaVezes: 2,
  parcelas: 120,
  primeiraParcelaEm: "2026-10-10",
  reservaId: "res-1",
  unidadeId: "uni-1",
  valorNegociado: 178_100,
  vencimentoDia: 10,
};

const campos = (pedido: PedidoDeProposta, agora = AGORA) =>
  [...new Set(conferirProposta(pedido, agora).map((e) => e.campo))].sort();

describe("conferirProposta", () => {
  it("aceita o pedido completo", () => {
    expect(conferirProposta(PEDIDO, AGORA)).toEqual([]);
  });

  it("⚠️ devolve TODOS os erros de uma vez, não o primeiro", () => {
    // O formulário da proposta é grande e tem uma linha por comprador: reclamar de um campo por vez
    // faria a pessoa clicar em "Gerar proposta" oito vezes para descobrir oito problemas.
    const erros = conferirProposta(
      {
        compradores: [
          { cpf: "111", nome: "Ana Souza", participacao: 40, titular: false },
          { cpf: "222", nome: "Bruno Lima", participacao: 30, titular: false },
        ],
        entradaValor: 100,
        entradaVezes: 0,
        parcelas: 0,
        primeiraParcelaEm: "",
        reservaId: "",
        unidadeId: "",
        valorNegociado: 0,
        vencimentoDia: 31,
      },
      AGORA,
    );

    expect([...new Set(erros.map((e) => e.campo))].sort()).toEqual([
      "cpf",
      "entradaVezes",
      "parcelas",
      "participacao",
      "primeiraParcela",
      "reserva",
      "titular",
      "unidade",
      "valor",
      "vencimentoDia",
    ]);
    // Os dois CPFs ruins aparecem, cada um com o nome de quem errou.
    expect(erros.filter((e) => e.campo === "cpf")).toHaveLength(2);
    expect(erros.find((e) => e.campo === "cpf")?.mensagem).toContain("Ana Souza");
  });

  it("⚠️ a soma das participações fecha 100% mesmo com decimais que não somam redondo", () => {
    // 33,33 + 33,33 + 33,34 dá 100.00000000000001 em ponto flutuante: comparar a soma crua com 100
    // recusaria a divisão mais comum que existe entre três compradores.
    const tres: PedidoDeProposta = {
      ...PEDIDO,
      compradores: [
        { cpf: "529.982.247-25", nome: "Maria da Silva", participacao: 33.33, titular: true },
        { cpf: "168.995.350-09", nome: "João Souza", participacao: 33.33, titular: false },
        { cpf: "231.002.999-81", nome: "Rita Alves", participacao: 33.34, titular: false },
      ],
    };
    expect(conferirProposta(tres, AGORA)).toEqual([]);
  });

  it("⚠️ recusa a proposta que soma 90%, porque 10% do imóvel ficaria sem dono", () => {
    const erros = conferirProposta(
      {
        ...PEDIDO,
        compradores: [
          { cpf: "529.982.247-25", nome: "Maria da Silva", participacao: 60, titular: true },
          { cpf: "168.995.350-09", nome: "João Souza", participacao: 30, titular: false },
        ],
      },
      AGORA,
    );
    expect(erros.map((e) => e.campo)).toEqual(["participacao"]);
    expect(erros[0]?.mensagem).toContain("90,00%");
  });

  it("exige o titular da reserva na lista, e um só", () => {
    const semTitular = campos({
      ...PEDIDO,
      compradores: [
        { cpf: "529.982.247-25", nome: "Maria da Silva", participacao: 100, titular: false },
      ],
    });
    expect(semTitular).toEqual(["titular"]);

    const doisTitulares = campos({
      ...PEDIDO,
      compradores: [
        { cpf: "529.982.247-25", nome: "Maria da Silva", participacao: 50, titular: true },
        { cpf: "168.995.350-09", nome: "João Souza", participacao: 50, titular: true },
      ],
    });
    expect(doisTitulares).toEqual(["titular"]);
  });

  it("⚠️ o piso da entrada é comparado em CENTAVOS: o próprio mínimo passa", () => {
    // 10% de R$ 178.100 dá 17810.000000000002 em ponto flutuante, e a comparação ingênua acusava
    // "abaixo do mínimo" no valor exato do mínimo.
    expect(conferirProposta({ ...PEDIDO, entradaValor: 17_810 }, AGORA)).toEqual([]);
    // E o resíduo de quem chegou ao total somando três partes iguais também passa.
    expect(conferirProposta({ ...PEDIDO, entradaValor: 17_810.000000000004 }, AGORA)).toEqual([]);
  });

  it("um centavo abaixo do piso é abaixo do piso", () => {
    expect(campos({ ...PEDIDO, entradaValor: 17_809.99 })).toEqual(["entrada"]);
  });

  it("⚠️ o piso é do EMPREENDIMENTO, não da casa: o Garden vende a 8%", () => {
    const garden = { ...PEDIDO, entradaMinimaPercentual: 8, entradaValor: 14_248 };
    expect(conferirProposta(garden, AGORA)).toEqual([]);
    // Com o padrão de 10% o mesmo valor seria recusado, e é isso que o campo por empreendimento evita.
    expect(campos({ ...garden, entradaMinimaPercentual: null })).toEqual(["entrada"]);
  });

  it("⚠️ a primeira parcela da entrada não pode ser no passado, mas HOJE vale", () => {
    // Proposta gerada às 14h de Brasília com a primeira parcela hoje: comparar instante contra
    // instante recusaria a data mais natural do mundo.
    expect(conferirProposta({ ...PEDIDO, primeiraParcelaEm: "2026-09-04" }, AGORA)).toEqual([]);
    expect(campos({ ...PEDIDO, primeiraParcelaEm: "2026-09-03" })).toEqual(["primeiraParcela"]);
  });

  it("recusa data ausente e data que não é data", () => {
    expect(campos({ ...PEDIDO, primeiraParcelaEm: "" })).toEqual(["primeiraParcela"]);
    expect(campos({ ...PEDIDO, primeiraParcelaEm: "amanha" })).toEqual(["primeiraParcela"]);
  });

  it("⚠️ dia que não existe no mês é recusado, e não empurrado calado para o fim do mês", () => {
    // A régua conferia só a FORMA `\d{4}-\d{2}-\d{2}`: `2026-02-31` era aprovado, o cronograma
    // deslocava para 28/02 e a mensagem de WhatsApp anunciava 31/02/2026 — o cliente lia uma data
    // e o boleto saía em outra.
    for (const data of ["2026-02-31", "2026-04-31", "2026-13-45", "2026-00-10", "2026-05-00"]) {
      expect(campos({ ...PEDIDO, primeiraParcelaEm: data })).toEqual(["primeiraParcela"]);
    }
    // E o que existe continua passando, inclusive o 29 de fevereiro de ano bissexto.
    expect(conferirProposta({ ...PEDIDO, primeiraParcelaEm: "2028-02-29" }, AGORA)).toEqual([]);
    expect(conferirProposta({ ...PEDIDO, primeiraParcelaEm: "2026-12-31" }, AGORA)).toEqual([]);
  });

  it(`o dia de vencimento vai de 1 a ${VENCIMENTO_DIA_MAXIMO}, e a tela oferece 10 e 20`, () => {
    for (const dia of [1, 10, 20, VENCIMENTO_DIA_MAXIMO]) {
      expect(conferirProposta({ ...PEDIDO, vencimentoDia: dia }, AGORA)).toEqual([]);
    }
    // 31 não existe em sete meses do ano; 0 não existe em nenhum.
    for (const dia of [0, 29, 31, 10.5]) {
      expect(campos({ ...PEDIDO, vencimentoDia: dia })).toEqual(["vencimentoDia"]);
    }
  });

  it("entrada à vista é 1x, e parcela quebrada não é parcela", () => {
    expect(conferirProposta({ ...PEDIDO, entradaVezes: 1 }, AGORA)).toEqual([]);
    expect(campos({ ...PEDIDO, entradaVezes: 2.5 })).toEqual(["entradaVezes"]);
    expect(campos({ ...PEDIDO, parcelas: 120.5 })).toEqual(["parcelas"]);
  });

  it("⚠️ entrada NaN é ausente, não 'zero que passa': campo vazio não gera proposta", () => {
    // Campo vazio ou meio digitado ("R$ ") chega como NaN, e `centavos(NaN) < centavos(piso)` é
    // FALSO: a única régua de dinheiro do módulo passava em silêncio e a proposta saía com entrada
    // zero, financiando o lote inteiro.
    expect(campos({ ...PEDIDO, entradaValor: Number.NaN })).toEqual(["entrada"]);
    expect(campos({ ...PEDIDO, entradaValor: Number.POSITIVE_INFINITY })).toEqual(["entrada"]);
  });

  it("⚠️ NaN em qualquer campo numérico é recusado, um por um", () => {
    // A assimetria que gerou o defeito: `!(x > 0)` rejeita NaN, `<` aceita. Cada campo numérico
    // fica travado aqui para que ninguém troque a checagem por uma comparação de faixa.
    expect(campos({ ...PEDIDO, valorNegociado: Number.NaN })).toEqual(["valor"]);
    expect(campos({ ...PEDIDO, entradaVezes: Number.NaN })).toEqual(["entradaVezes"]);
    expect(campos({ ...PEDIDO, parcelas: Number.NaN })).toEqual(["parcelas"]);
    expect(campos({ ...PEDIDO, vencimentoDia: Number.NaN })).toEqual(["vencimentoDia"]);
    expect(campos({ ...PEDIDO, anuaisQuantidade: Number.NaN })).toEqual(["anuais"]);
    expect(campos({ ...PEDIDO, anuaisValor: Number.NaN })).toEqual(["anuais"]);
    // Participação NaN também não vira 100%: a soma sai NaN e a régua acusa.
    expect(
      campos({
        ...PEDIDO,
        compradores: [
          { cpf: "529.982.247-25", nome: "Maria da Silva", participacao: Number.NaN, titular: true },
        ],
      }),
    ).toEqual(["participacao"]);
  });

  it("⚠️ a entrada tem TETO: R$ 178.100 digitado sem vírgula não vira proposta", () => {
    // Entrada de R$ 1.781.000 num lote de R$ 178.100 passava a régua inteira e virava uma proposta
    // com 120 parcelas de R$ 0,00 anunciada por WhatsApp para três pessoas.
    const erros = conferirProposta({ ...PEDIDO, entradaValor: 1_781_000 }, AGORA);
    expect(erros.map((e) => e.campo)).toEqual(["entrada"]);
    expect(erros[0]?.mensagem).toContain("R$ 178.100,00");

    // Um real a mais também é a mais.
    expect(campos({ ...PEDIDO, entradaValor: 178_101 })).toEqual(["entrada"]);

    // ⚠️ MAS O TETO NAO SOMA OS REFORCOS. Reforco que cai no mes 72 nao e dinheiro de hoje: uma
    // versao anterior somava o nominal deles contra o preco a vista e reprovava SETE composicoes
    // que o proprio simulador recomenda. Quem sabe se a composicao fecha e o cronograma, que
    // desconta os reforcos a valor presente.
    expect(
      campos({ ...PEDIDO, anuaisQuantidade: 10, anuaisValor: 20_000, entradaValor: 17_810 }),
    ).toEqual([]);
  });

  it("entrada igual ao valor negociado passa: é a venda à vista", () => {
    expect(conferirProposta({ ...PEDIDO, entradaValor: 178_100 }, AGORA)).toEqual([]);
    // Com reforço que cabe, também passa.
    expect(
      conferirProposta(
        { ...PEDIDO, anuaisQuantidade: 5, anuaisValor: 2_000, entradaValor: 17_810 },
        AGORA,
      ),
    ).toEqual([]);
  });
});

describe("diaDoCalendario com hora", () => {
  // ⚠️ O Date.parse do V8 nao recusa dia fora do mes no ISO com hora: ele ROLA a data. 31/11 vira
  // 01/12 sem erro, e a mensagem de WhatsApp anunciaria uma data que o boleto nao vai ter.
  it("dia que nao existe no mes e recusado tambem no ISO com hora", () => {
    expect(diaDoCalendario("2026-11-31T12:00:00Z")).toBeNull();
    expect(diaDoCalendario("2026-04-31T00:00:00-03:00")).toBeNull();
    expect(diaDoCalendario("2026-02-30T09:00:00Z")).toBeNull();
  });

  it("o ISO com hora de um dia que existe continua valendo", () => {
    expect(diaDoCalendario("2026-10-10T12:00:00Z")).toBe("2026-10-10");
    // 2028 e bissexto; 2026 nao — e por isso 29/02/2026 e recusado logo acima.
    expect(diaDoCalendario("2028-02-29T12:00:00Z")).toBe("2028-02-29");
  });
});

describe("diaDoCalendario", () => {
  it("⚠️ data sem hora NÃO passa por fuso: 2026-10-10 continua sendo o dia 10", () => {
    // Convertida para Brasília, a meia-noite UTC do dia 10 vira o dia 9 — o mesmo defeito que já
    // deslocou o mês na leitura de planilha.
    expect(diaDoCalendario("2026-10-10")).toBe("2026-10-10");
    expect(dataEscrita("2026-10-10")).toBe("10/10/2026");
  });

  it("ISO com hora vira o dia em Brasília, não o dia em UTC", () => {
    // 01:30 UTC do dia 11 ainda é dia 10 em Goiás.
    expect(diaDoCalendario("2026-10-11T01:30:00.000Z")).toBe("2026-10-10");
  });

  it("o que não é data devolve nulo, e o texto sai vazio", () => {
    expect(diaDoCalendario("")).toBeNull();
    expect(diaDoCalendario("amanhã")).toBeNull();
    expect(dataEscrita(null)).toBe("");
  });

  it("⚠️ dia que não existe no mês é nulo, e não vira 31/02/2026 no WhatsApp", () => {
    expect(diaDoCalendario("2026-02-31")).toBeNull();
    expect(diaDoCalendario("2026-04-31")).toBeNull();
    expect(diaDoCalendario("2026-13-45")).toBeNull();
    expect(dataEscrita("2026-02-31")).toBe("");
    // Fevereiro de ano bissexto tem 29; o de 2026 não.
    expect(diaDoCalendario("2028-02-29")).toBe("2028-02-29");
    expect(diaDoCalendario("2026-02-29")).toBeNull();
  });
});

const DADOS: DadosDoAvisoDaProposta = {
  cliente: "Maria da Silva",
  codigo: "000123",
  compradores: 2,
  corretor: "João Souza",
  cpf: "529.982.247-25",
  empreendimento: "Vale do Ouro",
  entradaTotal: 17_810,
  entradaVezes: 2,
  imobiliaria: "Gurgel Imóveis",
  parcela: 1_480.5,
  // O exemplo base é um plano de parcela fixa (PRICE); o SACOC, que reajusta, tem teste próprio.
  parcelaFixa: true,
  parcelas: 120,
  primeiraParcelaEm: "2026-10-10",
  unidade: "Quadra 12 · Lote 06",
  valorNegociado: 178_100,
  vencimentoDia: 10,
};

describe("avisosDaProposta", () => {
  it("escreve uma mensagem para cada destinatário", () => {
    expect(avisosDaProposta(DADOS).map((a) => a.papel).sort()).toEqual([
      "coordenador",
      "corretor",
      "imobiliaria",
    ]);
  });

  it("⚠️ o COD vai nas TRÊS mensagens", () => {
    // É o número que o corretor anotou na reserva e o que ele diz no telefone seis meses depois.
    for (const aviso of avisosDaProposta(DADOS)) {
      expect(aviso.texto).toContain("000123");
      expect(aviso.texto).toContain("COD");
    }
  });

  it("⚠️ negrito de WhatsApp é UM asterisco", () => {
    // Dois asteriscos é Markdown e chega literal na conversa do cliente. A máscara do CPF sai da
    // comparação: os asteriscos dela são conteúdo, não formatação.
    for (const aviso of avisosDaProposta(DADOS)) {
      const semMascara = aviso.texto.split(mascararCpf(DADOS.cpf)).join("");
      expect(semMascara).not.toContain("**");
    }
  });

  it("⚠️ o CPF vai MASCARADO, porque mensagem enviada não volta", () => {
    for (const aviso of avisosDaProposta(DADOS)) {
      expect(aviso.texto).toContain("***.982.247-**");
      expect(aviso.texto).not.toContain("529.982.247-25");
      expect(aviso.texto).not.toContain("52998224725");
    }
  });

  it("⚠️ sem corretor as três frases continuam de pé", () => {
    const avisos = avisosDaProposta({ ...DADOS, corretor: null });
    const porPapel = new Map(avisos.map((a) => [a.papel, a.texto]));

    expect(porPapel.get("corretor")).toContain("Olá, tudo bem!");
    expect(porPapel.get("imobiliaria")).toContain("Proposta no nome da imobiliária");
    expect(porPapel.get("coordenador")).toContain("Corretor: não informado");
    // E nenhuma sai com "undefined" ou "null" no lugar do nome.
    for (const aviso of avisos) {
      expect(aviso.texto).not.toContain("undefined");
      expect(aviso.texto).not.toContain("null");
    }
  });

  it("as condições combinadas aparecem: valor, entrada em partes iguais, parcela e dia", () => {
    const corretor = avisosDaProposta(DADOS).find((a) => a.papel === "corretor")?.texto ?? "";
    expect(corretor).toContain("R$ 178.100,00");
    expect(corretor).toContain("R$ 17.810,00");
    expect(corretor).toContain("2x");
    expect(corretor).toContain("10/10/2026");
    expect(corretor).toContain("120x de R$ 1.480,50");
    expect(corretor).toContain("todo dia *10*");
  });

  it("⚠️ no plano que REAJUSTA a mensagem diz 'a partir de', nas três", () => {
    // O SACOC é o plano de 21 dos 24 empreendimentos e a parcela muda no 13º mês. "120x de
    // R$ 1.480,50" faz o corretor repassar ao cliente um número que o boleto do ano seguinte
    // desmente; o PDF mostra as faixas, mas quem circula é o WhatsApp.
    for (const aviso of avisosDaProposta({ ...DADOS, parcelaFixa: false })) {
      expect(aviso.texto).toContain("120x a partir de R$ 1.480,50");
      expect(aviso.texto).toContain("reajuste anual");
      expect(aviso.texto).not.toContain("120x de R$ 1.480,50");
    }
  });

  it("⚠️ sem a marca, a mensagem assume que REAJUSTA — prometer de menos não quebra promessa", () => {
    // Quem chama pode esquecer de passar `parcelaFixa`, e o padrão precisa ser o conservador:
    // assumir parcela fixa transformaria o esquecimento em promessa quebrada com o cliente.
    const { parcelaFixa: _, ...semMarca } = DADOS;
    for (const aviso of avisosDaProposta(semMarca)) {
      expect(aviso.texto).toContain("a partir de");
      expect(aviso.texto).not.toContain("120x de R$ 1.480,50");
    }
  });

  it("no plano de parcela fixa a frase continua curta, sem ressalva nenhuma", () => {
    for (const aviso of avisosDaProposta(DADOS)) {
      expect(aviso.texto).toContain("120x de R$ 1.480,50");
      expect(aviso.texto).not.toContain("reajuste");
    }
  });

  it("⚠️ o espaço do R$ é comum, não o não quebrável do Intl", () => {
    // O NBSP é invisível no log e no diff, e faz a conferência do texto falhar sem explicar por quê.
    for (const aviso of avisosDaProposta(DADOS)) {
      expect(aviso.texto).not.toContain(" ");
    }
  });

  it("o coordenador recebe o quadro completo, com quantos compradores são", () => {
    const texto = avisosDaProposta(DADOS).find((a) => a.papel === "coordenador")?.texto ?? "";
    expect(texto).toContain("Quadra 12 · Lote 06");
    expect(texto).toContain("Gurgel Imóveis");
    expect(texto).toContain("João Souza");
    expect(texto).toContain("Compradores: *2*");

    // Comprador único não vira linha: dizer "Compradores: 1" é gastar linha para não informar nada.
    const sozinho = avisosDaProposta({ ...DADOS, compradores: 1 }).find(
      (a) => a.papel === "coordenador",
    )?.texto;
    expect(sozinho).not.toContain("Compradores:");
  });

  it("⚠️ comprador único não deixa buraco no meio da lista do coordenador", () => {
    // A linha ausente virava string vazia cercada de conteúdo dos dois lados, e o filtro do juntar
    // só derruba vazio REPETIDO: o coordenador recebia um salto entre "Cliente" e "Imobiliária".
    const texto =
      avisosDaProposta({ ...DADOS, compradores: 1 }).find((a) => a.papel === "coordenador")
        ?.texto ?? "";
    const linhas = texto.split("\n");
    expect(linhas.indexOf("Imobiliária: *Gurgel Imóveis*")).toBe(
      linhas.findIndex((l) => l.startsWith("Cliente:")) + 1,
    );

    // E nenhuma das três mensagens tem duas linhas em branco seguidas, com ou sem os campos
    // opcionais preenchidos.
    for (const dados of [
      DADOS,
      { ...DADOS, compradores: 1 },
      { ...DADOS, codigo: "", compradores: 1, corretor: null },
    ]) {
      for (const aviso of avisosDaProposta(dados)) {
        expect(aviso.texto).not.toContain("\n\n\n");
      }
    }
  });

  it("as três dizem que o PDF vai anexado", () => {
    for (const aviso of avisosDaProposta(DADOS)) {
      expect(aviso.texto).toContain("PDF");
    }
  });
});
