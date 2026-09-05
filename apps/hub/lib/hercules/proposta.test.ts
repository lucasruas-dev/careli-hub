import { describe, expect, it } from "vitest";

import { vencimentoEmDias } from "./reserva";

import {
  avisosDaProposta,
  avisosDeCancelamentoDaProposta,
  conferirCancelamentoDaProposta,
  conferirProposta,
  MOTIVOS_DE_CANCELAMENTO_DA_PROPOSTA,
  type DadosDoAvisoDaProposta,
  dataEscrita,
  diaDoCalendario,
  type PedidoDeProposta,
  VENCIMENTO_DIA_MAXIMO,
  PRAZO_PADRAO_DA_PROPOSTA,
  PRAZOS_DA_PROPOSTA,
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
  validadeEm: "2026-09-11T02:59:59.000Z",
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
        validadeEm: "",
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
      "validade",
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
  // A validade GRAVADA com a proposta, a mesma do PEDIDO: fim do dia 11/09 no fuso da operação.
  validadeEm: "2026-09-11T02:59:59.000Z",
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

  it("⚠️ as três dizem até quando a proposta vale", () => {
    // Quem circula é o WhatsApp, não o PDF: condição sem prazo é lida como preço parado no tempo, e
    // o corretor repassa a mensagem como veio.
    for (const aviso of avisosDaProposta(DADOS)) {
      expect(aviso.texto).toContain("*10/09/2026*");
    }
  });

  it("⚠️ a validade é a GRAVADA e vira o dia em Brasília, não o dia em UTC", () => {
    // A validade termina às 23:59:59 do fuso da operação, que é 02:59:59Z do dia seguinte: lida em
    // UTC, a mensagem prometeria um dia a mais de preço garantido.
    const avisos = avisosDaProposta({ ...DADOS, validadeEm: "2026-09-11T02:59:59.000Z" });
    for (const aviso of avisos) {
      expect(aviso.texto).not.toContain("11/09/2026");
    }
  });

  it("sem validade a linha some, em vez de sair pela metade", () => {
    // As propostas importadas do C2X não têm prazo. "Válida até *" sem o dia seria uma mensagem
    // quebrada na conversa com o cliente.
    for (const aviso of avisosDaProposta({ ...DADOS, validadeEm: null })) {
      expect(aviso.texto).not.toContain("válida até");
      expect(aviso.texto).not.toContain("Válida até");
      expect(aviso.texto).not.toContain("\n\n\n");
    }
  });
});

describe("a validade da proposta", () => {
  // Lucas (05/09/2026): *"vamos fazer igual a reserva, colocar os dias de prazo, 3 - 5 - 7 - 10"*.
  it("os prazos são os que a tela oferece, e são maiores que os da reserva", () => {
    expect([...PRAZOS_DA_PROPOSTA]).toEqual([3, 5, 7, 10]);
    expect(PRAZOS_DA_PROPOSTA).toContain(PRAZO_PADRAO_DA_PROPOSTA);
  });

  it("sem validade não há proposta", () => {
    expect(campos({ ...PEDIDO, validadeEm: "" })).toContain("validade");
    expect(campos({ ...PEDIDO, validadeEm: "quinta que vem" })).toContain("validade");
  });

  it("⚠️ validade no passado é recusada — proposta vencida não é proposta", () => {
    expect(campos({ ...PEDIDO, validadeEm: "2026-09-01T12:00:00.000Z" })).toContain("validade");
  });

  it("⚠️ e há teto: preço congelado sem data não é proposta, é promessa", () => {
    const longe = new Date(Date.parse(AGORA) + 45 * 86_400_000).toISOString();
    expect(campos({ ...PEDIDO, validadeEm: longe })).toContain("validade");
  });

  it("o prazo da tela cabe no teto — os quatro", () => {
    for (const dias of PRAZOS_DA_PROPOSTA) {
      const ate = vencimentoEmDias(AGORA, dias);
      expect(campos({ ...PEDIDO, validadeEm: ate })).not.toContain("validade");
    }
  });
});

describe("⚠️ reforço anual não cabe além do prazo", () => {
  it("recusa mais reforços do que o contrato tem aniversários", () => {
    // O defeito que isto prende: escolher 6 reforços num plano de 120 meses e depois reduzir o
    // prazo para 60 deixava os 6 de pé. Dois balões vencendo DEPOIS da última mensal, a "última
    // parcela" do PDF caindo em novembro de 2032 num contrato de 60 meses e — porque os reforços
    // são abatidos a valor presente — a mensal impressa 23% menor do que a que o cliente vai pagar.
    const erros = conferirProposta(
      { ...PEDIDO, anuaisQuantidade: 6, anuaisValor: 30_000, parcelas: 60 },
      AGORA,
    );
    expect(erros.map((e) => e.campo)).toContain("anuais");
    expect(erros.find((e) => e.campo === "anuais")?.mensagem).toContain("no máximo 5");
  });

  it("aceita exatamente os aniversários que cabem", () => {
    expect(
      conferirProposta({ ...PEDIDO, anuaisQuantidade: 5, anuaisValor: 30_000, parcelas: 60 }, AGORA),
    ).toEqual([]);
  });

  it("⚠️ contrato de menos de um ano não comporta reforço anual", () => {
    const erros = conferirProposta(
      { ...PEDIDO, anuaisQuantidade: 1, anuaisValor: 10_000, parcelas: 6 },
      AGORA,
    );
    expect(erros.find((e) => e.campo === "anuais")?.mensagem).toContain("menos de 12 parcelas");
  });
});

describe("conferirCancelamentoDaProposta", () => {
  const PEDIDO_OK = { detalhe: null, motivo: "Cliente desistiu", unidadeId: "uni-1" };

  it("aceita um motivo da lista", () => {
    expect(conferirCancelamentoDaProposta(PEDIDO_OK)).toEqual([]);
  });

  it("recusa motivo fora da lista", () => {
    // Sem a lista fechada, o motivo vira texto livre e o histórico da unidade deixa de responder
    // "por que este lote soltou" em linguagem que dê para contar.
    const erros = conferirCancelamentoDaProposta({ ...PEDIDO_OK, motivo: "porque sim" });
    expect(erros.map((e) => e.campo)).toContain("motivo");
  });

  it("⚠️ 'Outro' sem detalhe é cancelamento sem motivo", () => {
    expect(
      conferirCancelamentoDaProposta({ ...PEDIDO_OK, motivo: "Outro" }).map((e) => e.campo),
    ).toContain("detalhe");
    expect(
      conferirCancelamentoDaProposta({
        detalhe: "o cliente achou o lote pequeno",
        motivo: "Outro",
        unidadeId: "uni-1",
      }),
    ).toEqual([]);
  });

  it("exige a unidade", () => {
    expect(
      conferirCancelamentoDaProposta({ ...PEDIDO_OK, unidadeId: "  " }).map((e) => e.campo),
    ).toContain("unidade");
  });

  it("⚠️ os motivos NÃO são os da reserva: a proposta já mostrou preço ao cliente", () => {
    const motivos = MOTIVOS_DE_CANCELAMENTO_DA_PROPOSTA as readonly string[];
    expect(motivos).toContain("Condições não aceitas");
    expect(motivos).toContain("Cliente pediu outro plano");
    // "Reserva feita por engano" não cabe aqui: o engano é da proposta, que já saiu no papel.
    expect(motivos).not.toContain("Reserva feita por engano");
  });
});

describe("avisosDeCancelamentoDaProposta", () => {
  const DADOS = {
    cliente: "Maria da Silva",
    codigo: "000003",
    corretor: "Nívea Ferreira",
    empreendimento: "Garden",
    imobiliaria: "Raiane Imobiliária",
    motivo: "Crédito não aprovado",
    unidade: "Quadra 03 · Lote 07",
  };

  it("fala com os três", () => {
    expect(avisosDeCancelamentoDaProposta(DADOS).map((a) => a.papel)).toEqual([
      "corretor",
      "imobiliaria",
      "coordenador",
    ]);
  });

  it("⚠️ diz que o PDF não vale mais — é a única coisa que desfaz o papel já enviado", () => {
    // O documento está no celular de três pessoas e não some de lá. Sem esta frase o corretor
    // segue com um preço na mão que a casa não sustenta mais.
    const paraFora = avisosDeCancelamentoDaProposta(DADOS).filter((a) => a.papel !== "coordenador");
    expect(paraFora).toHaveLength(2);
    for (const aviso of paraFora) expect(aviso.texto).toContain("não vale mais");
  });

  it("todas dizem o motivo e que a unidade voltou", () => {
    for (const aviso of avisosDeCancelamentoDaProposta(DADOS)) {
      expect(aviso.texto).toContain("Crédito não aprovado");
      expect(aviso.texto.toLowerCase()).toContain("disponibilidade");
    }
  });

  it("⚠️ sem corretor não sobra linha em branco nem 'null' no meio da mensagem", () => {
    const avisos = avisosDeCancelamentoDaProposta({ ...DADOS, corretor: null });
    for (const aviso of avisos) {
      expect(aviso.texto).not.toContain("null");
      expect(aviso.texto).not.toContain("\n\n\n");
    }
    // O coordenador é quem precisa saber que o corretor não estava registrado.
    const coord = avisos.find((a) => a.papel === "coordenador");
    expect(coord?.texto).toContain("não informado");
  });

  it("sem COD a mensagem não inventa um código vazio", () => {
    for (const aviso of avisosDeCancelamentoDaProposta({ ...DADOS, codigo: null })) {
      expect(aviso.texto).not.toContain("COD *");
    }
  });
});

describe("⚠️ a régua da entrada montada no servidor", () => {
  it("aceita a montagem que fecha o combinado", () => {
    expect(
      conferirProposta(
        { ...PEDIDO, entradaParcelas: [10_000, 7_810], entradaValor: 17_810, entradaVezes: 2 },
        AGORA,
      ),
    ).toEqual([]);
  });

  it("⚠️ aceita somar MAIS: o cliente pode pagar mais no ato", () => {
    expect(
      conferirProposta(
        { ...PEDIDO, entradaParcelas: [15_000, 10_000], entradaValor: 17_810, entradaVezes: 2 },
        AGORA,
      ),
    ).toEqual([]);
  });

  it("⚠️ recusa somar MENOS — a tela confere, mas o servidor não confia nela", () => {
    // Um corpo montado à mão passaria entrada de R$ 1.000 em quatro parcelas dizendo que o
    // combinado eram R$ 17.810, e a proposta sairia com o financiado errado e a parcela
    // subestimada no papel do cliente.
    const erros = conferirProposta(
      { ...PEDIDO, entradaParcelas: [500, 500], entradaValor: 17_810, entradaVezes: 2 },
      AGORA,
    );
    expect(erros.find((e) => e.campo === "entrada")?.mensagem).toContain("somam menos");
  });

  it("recusa parcela zerada ou negativa dentro da montagem", () => {
    const erros = conferirProposta(
      { ...PEDIDO, entradaParcelas: [17_810, 0], entradaValor: 17_810, entradaVezes: 2 },
      AGORA,
    );
    expect(erros.find((e) => e.campo === "entrada")?.mensagem).toContain("precisa de um valor");
  });

  it("sem montagem, nada muda — é o caminho de sempre", () => {
    expect(conferirProposta({ ...PEDIDO, entradaParcelas: null }, AGORA)).toEqual([]);
    expect(conferirProposta({ ...PEDIDO, entradaParcelas: [] }, AGORA)).toEqual([]);
  });

  it("⚠️ a soma é em centavos: 8.905,01 + 8.904,99 fecha 17.810", () => {
    expect(
      conferirProposta(
        { ...PEDIDO, entradaParcelas: [8_905.01, 8_904.99], entradaValor: 17_810, entradaVezes: 2 },
        AGORA,
      ),
    ).toEqual([]);
  });
});

describe("⚠️ a faixa do prazo é RÉGUA, e não só cor de texto na tela", () => {
  /** A tabela do ZZ TESTE, num lote de R$ 140.000. */
  const TABELA = [
    { entradaPercentual: 10, nome: "PLANO NORMAL", parcelas: 120 },
    { entradaPercentual: 20, nome: "PLANO CURTO", parcelas: 60 },
    { entradaPercentual: 40, nome: "PLANO INVESTIDOR", parcelas: 36 },
  ];
  const NO_LOTE = {
    ...PEDIDO,
    entradaVezes: 1,
    planosDaTabela: TABELA,
    valorNegociado: 140_000,
  };

  it("recusa 30 parcelas com os 10% da casa — o caso que o Lucas ditou", () => {
    // Antes disto, a tela pintava "Abaixo do mínimo de 40%" e o botão gerava assim mesmo: o PDF
    // saía por WhatsApp com R$ 42.000 de entrada a menos do que a tabela manda.
    const erros = conferirProposta(
      { ...NO_LOTE, entradaValor: 14_000, parcelas: 30 },
      AGORA,
    );
    const daEntrada = erros.find((e) => e.campo === "entrada");
    expect(daEntrada).toBeDefined();
    expect(daEntrada?.mensagem).toContain("56.000,00");
    // A frase diz de quem é a régua: sem isso, "mínimo R$ 56.000" num produto que vende a 10%
    // parece defeito do sistema.
    expect(daEntrada?.mensagem).toContain("PLANO INVESTIDOR");
  });

  it("aceita 30 parcelas com os 40% que a faixa exige", () => {
    expect(
      conferirProposta({ ...NO_LOTE, entradaValor: 56_000, parcelas: 30 }, AGORA),
    ).toEqual([]);
  });

  it("48 parcelas caem no CURTO: 28k passa, 14k não", () => {
    expect(conferirProposta({ ...NO_LOTE, entradaValor: 28_000, parcelas: 48 }, AGORA)).toEqual([]);
    expect(
      conferirProposta({ ...NO_LOTE, entradaValor: 14_000, parcelas: 48 }, AGORA).some(
        (e) => e.campo === "entrada",
      ),
    ).toBe(true);
  });

  it("no prazo longo vale o piso da casa, e 10% passa", () => {
    expect(
      conferirProposta({ ...NO_LOTE, entradaValor: 14_000, parcelas: 120 }, AGORA),
    ).toEqual([]);
  });

  it("⚠️ sem a tabela, sobra o piso da casa — o comportamento de quem ainda não a manda", () => {
    // A rota passa `planosDaTabela`; um chamador antigo que não passe não pode quebrar.
    expect(
      conferirProposta(
        { ...NO_LOTE, entradaValor: 14_000, parcelas: 30, planosDaTabela: null },
        AGORA,
      ),
    ).toEqual([]);
  });

  it("a régua da entrada montada também respeita a faixa", () => {
    // Montar 4 parcelas que somam 14k num prazo de 30 não escapa da faixa.
    const erros = conferirProposta(
      {
        ...NO_LOTE,
        entradaParcelas: [3_500, 3_500, 3_500, 3_500],
        entradaValor: 14_000,
        entradaVezes: 4,
        parcelas: 30,
      },
      AGORA,
    );
    expect(erros.some((e) => e.campo === "entrada")).toBe(true);
  });
});

describe("⚠️ a mensagem não promete parcelas iguais numa entrada montada", () => {
  const AVISO: DadosDoAvisoDaProposta = {
    cliente: "Maria da Silva",
    codigo: "000003",
    compradores: 1,
    corretor: "Nívea",
    cpf: "52998224725",
    empreendimento: "ZZ TESTE",
    entradaTotal: 28_000,
    entradaVezes: 4,
    imobiliaria: "Raiane",
    parcela: 1_866.67,
    parcelaFixa: false,
    parcelas: 60,
    primeiraParcelaEm: "2026-10-10",
    unidade: "Quadra 01 · Lote 04",
    validadeEm: "2026-09-12T02:59:59.000Z",
    valorNegociado: 140_000,
    vencimentoDia: 10,
  };

  it("com parcelas desiguais, diz o valor da primeira", () => {
    // O corretor lê "R$ 28.000 em 4x" no celular, divide por quatro e promete R$ 7.000 ao cliente.
    const textos = avisosDaProposta({ ...AVISO, entradaPrimeira: 10_000 });
    for (const t of textos.filter((x) => x.papel !== "coordenador")) {
      expect(t.texto).toContain("a 1ª de");
      expect(t.texto).toContain("10.000,00");
    }
  });

  it("na divisão igual não polui a frase", () => {
    // 28.000 / 4 = 7.000: dizer "a 1ª de R$ 7.000" é ruído.
    const textos = avisosDaProposta({ ...AVISO, entradaPrimeira: 7_000 });
    for (const t of textos) expect(t.texto).not.toContain("a 1ª de");
  });

  it("sem o campo, a frase é a de sempre", () => {
    const textos = avisosDaProposta(AVISO);
    for (const t of textos) expect(t.texto).not.toContain("a 1ª de");
  });
});
