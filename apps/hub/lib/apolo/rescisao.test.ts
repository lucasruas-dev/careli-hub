import { describe, expect, it } from "vitest";

import {
  calcularRescisao,
  deducaoDe,
  dinheiroPorExtenso,
  percentual,
  PERCENTUAIS_PADRAO,
} from "./rescisao";

// ⚠️ O CASO REAL DO PAPEL DE HOJE. Todos os números vêm do PDF que o Lucas mandou em 15/09/2026
// (LAVRA DO OURO, Quadra 06 — Lote 10, emitido em 25/06/2026). Se esta suíte ficar verde, o
// documento gerado pelo Panteon produz exatamente o que o jurídico produz à mão.
const CASO_REAL = {
  comissaoEmReais: 4705.22,
  parcelasVencidas: 963.88,
  totalPago: 16135.33,
  valorDeTabela: 72388,
};

describe("a conta do caso real", () => {
  const conta = calcularRescisao(CASO_REAL);

  // ⚠️ A BASE É TABELA MENOS COMISSÃO, e conferir isso foi o que impediu a multa de sair errada:
  // cobrar a comissão dentro da base E como linha própria a cobraria duas vezes.
  it("a base é o valor de tabela menos a comissão", () => {
    expect(conta.base).toBe(67682.78);
  });

  it("multa penal de 10% sobre a base", () => {
    expect(conta.deducoes[0]?.valor).toBe(6768.28);
  });

  it("publicidade de 4% sobre a base", () => {
    expect(conta.deducoes[1]?.valor).toBe(2707.31);
  });

  it("corretagem é o valor do contrato, não um recálculo", () => {
    expect(conta.deducoes[2]?.valor).toBe(4705.22);
  });

  // ⚠️ TRIBUTO INCIDE SOBRE O QUE ENTROU, não sobre o valor do imóvel. Usar a base aqui daria
  // R$ 4.013,59 em vez de R$ 956,83 — quatro vezes mais.
  it("tributos de 5,93% sobre o TOTAL PAGO", () => {
    expect(conta.deducoes[3]?.valor).toBe(956.83);
  });

  it("as parcelas vencidas entram como estão", () => {
    expect(conta.deducoes[4]?.valor).toBe(963.88);
  });

  // ⚠️⚠️ AQUI O PAPEL DE HOJE ERRA A SOMA, E O ERRO INVERTE O RESULTADO. As cinco linhas da tabela
  // do PDF somam R$ 16.101,52; o papel escreve "Total de deduções e encargos: R$ 16.583,46". A
  // diferença é R$ 481,94 — exatamente METADE das parcelas vencidas (963,88 ÷ 2), o que tem cara
  // de conta feita à mão em que a última linha entrou uma vez e meia.
  //
  // A consequência não é cosmética: pelo papel o cliente DEVE R$ 448,13; pela soma correta SOBRAM
  // R$ 33,81 para ele. O Panteon soma as linhas que imprime — um documento que mostra cinco
  // parcelas e um total que não é a soma delas não se sustenta na frente de ninguém.
  //
  // Reportado ao Lucas em 15/09/2026, junto da entrega.
  it("o total é a soma das linhas impressas", () => {
    expect(conta.totalDeDeducoes).toBe(16101.52);
  });

  it("e como o pago supera as deduções, há restituição", () => {
    expect(conta.saldoARestituir).toBe(33.81);
    expect(conta.saldoResidual).toBe(0);
  });

  it("a soma bate linha a linha, sem sobra escondida", () => {
    const soma = conta.deducoes.reduce((t, l) => t + l.valor, 0);
    expect(Math.round(soma * 100) / 100).toBe(conta.totalDeDeducoes);
  });

  it("a base de cálculo sai escrita, para o papel explicar de onde veio", () => {
    expect(conta.deducoes[0]?.base).toBe("10% sobre R$ 67.682,78");
    expect(conta.deducoes[3]?.base).toBe("5,93% sobre R$ 16.135,33");
    expect(conta.deducoes[2]?.base).toBe("Conforme contrato");
  });

  // ⚠️ "10% SOBRE R$ 67.682,78" NÃO DIZ O QUE SÃO OS R$ 67.682,78. A simulação de 16/09/2026 imprime
  // a base em palavras numa coluna própria, e o nome sai daqui porque só a conta sabe qual base a
  // premissa escolheu. As linhas que não são percentual não inventam base.
  it("e diz, em palavras, sobre o que cada percentual incidiu", () => {
    expect(conta.deducoes.map((linha) => [linha.rubrica, linha.incideSobre])).toEqual([
      ["clausula_penal", "valor de tabela menos a comissão"],
      ["publicidade", "valor de tabela menos a comissão"],
      ["corretagem", null],
      ["tributos", "total pago"],
      ["parcelas_vencidas", null],
    ]);
  });

  it("a base em palavras segue a premissa cadastrada, e a corretagem pelo percentual também tem a dela", () => {
    const cadastrada = calcularRescisao({
      parcelasVencidas: 0,
      premissas: {
        clausula_penal: { base: "total_pago", percentual: 10, periodicidade: "unica" },
      },
      totalPago: 16135.33,
      valorDeTabela: 72388,
    });

    expect(deducaoDe(cadastrada, "clausula_penal")?.incideSobre).toBe("total pago");
    expect(deducaoDe(cadastrada, "corretagem")?.incideSobre).toBe("valor de tabela");
  });
});

describe("quando sobra para o cliente", () => {
  // Muito pago, pouca dedução: é o caso do contrato antigo, quase quitado.
  const conta = calcularRescisao({
    comissaoEmReais: 1000,
    parcelasVencidas: 0,
    totalPago: 60000,
    valorDeTabela: 70000,
  });

  it("o saldo a restituir aparece", () => {
    // base 69.000; multa 6.900; publicidade 2.760; corretagem 1.000; tributos 3.558 → 14.218
    expect(conta.totalDeDeducoes).toBe(14218);
    expect(conta.saldoARestituir).toBe(45782);
  });

  it("e não há residual", () => {
    expect(conta.saldoResidual).toBe(0);
  });
});

describe("o saldo nunca sai negativo", () => {
  // ⚠️ UM "SALDO A RESTITUIR DE -R$ 448,13" SERIA LIDO COMO DEVOLUÇÃO. Quando as deduções passam,
  // o que existe é dívida — e ela tem nome próprio.
  it("os dois lados são exclusivos", () => {
    const conta = calcularRescisao(CASO_REAL);
    expect(conta.saldoARestituir === 0 || conta.saldoResidual === 0).toBe(true);
  });

  it("empate exato não gera nem um nem outro", () => {
    const conta = calcularRescisao({
      comissaoEmReais: 0,
      parcelasVencidas: 0,
      totalPago: 14000,
      valorDeTabela: 100000,
    });
    // base 100.000; multa 10.000; publicidade 4.000; tributos 830,20 → 14.830,20
    expect(conta.saldoARestituir).toBe(0);
    expect(conta.saldoResidual).toBe(830.2);
  });
});

describe("a comissão", () => {
  it("quando o contrato traz o valor, ele manda", () => {
    const conta = calcularRescisao({ ...CASO_REAL, comissaoEmReais: 3000 });
    expect(conta.comissao).toBe(3000);
    expect(conta.base).toBe(69388);
  });

  // ⚠️ RECALCULAR SÓ QUANDO NÃO HÁ VALOR. A comissão saiu do caixa lá atrás; se a tabela do lote
  // mudou desde então, refazer a conta daria um número que ninguém pagou.
  it("sem valor, cai no percentual", () => {
    const conta = calcularRescisao({ ...CASO_REAL, comissaoEmReais: null });
    expect(conta.comissao).toBe(4705.22);
  });

  it("valor inválido não vira NaN", () => {
    const conta = calcularRescisao({ ...CASO_REAL, comissaoEmReais: Number.NaN });
    expect(conta.comissao).toBe(4705.22);
  });
});

describe("os percentuais são parâmetro", () => {
  it("o padrão é o praticado hoje", () => {
    expect(PERCENTUAIS_PADRAO).toEqual({
      corretagem: 6.5,
      // ⚠️ POR MÊS, e só entra na conta quando há posse cadastrada — ver o bloco de fruição abaixo.
      fruicao: 0.75,
      multa: 10,
      publicidade: 4,
      tributos: 5.93,
    });
  });

  // ⚠️ CONTRATO DE OUTRA SAFRA TEM OUTRO PERCENTUAL, e cravar o de hoje no código faria o
  // documento de um contrato antigo sair errado sem ninguém perceber.
  it("dá para sobrepor um só, sem repetir os outros", () => {
    const conta = calcularRescisao({ ...CASO_REAL, percentuais: { multa: 20 } });
    expect(conta.deducoes[0]?.valor).toBe(13536.56);
    expect(conta.deducoes[1]?.valor).toBe(2707.31);
  });
});

describe("dinheiro não carrega sujeira de ponto flutuante", () => {
  it("arredonda para centavos", () => {
    const conta = calcularRescisao({
      comissaoEmReais: 0,
      parcelasVencidas: 0.1 + 0.2,
      totalPago: 0,
      valorDeTabela: 0,
    });
    expect(conta.deducoes[4]?.valor).toBe(0.3);
  });
});

describe("percentual", () => {
  it("usa vírgula decimal, como o comercial escreve", () => {
    expect(percentual(6.5)).toBe("6,50%");
    expect(percentual(5.93)).toBe("5,93%");
    // ⚠️ INTEIRO SEM CASA DECIMAL é o que o papel assinado escreve: o modelo de 25/06/2026 traz
    // "Multa penal (10%)" e "4% sobre R$ 67.682,78", ao lado de "Corretagem (6,50%)".
    expect(percentual(10)).toBe("10%");
    expect(percentual(4)).toBe("4%");
  });
});

// ⚠️ O POR EXTENSO É TESTADO EM `lib/temis/por-extenso.test.ts`, e não de novo aqui. Escrevi uma
// segunda implementação antes de procurar pela existente; ela foi apagada. Este bloco guarda só a
// ligação — que a rescisão usa a régua da casa, e não uma cópia.
describe("o valor por extenso vem da régua da casa", () => {
  it("escreve 'um mil', a convenção de documento financeiro", () => {
    expect(dinheiroPorExtenso(1000)).toBe("um mil reais");
  });

  it("e o saldo do caso real", () => {
    expect(dinheiroPorExtenso(963.88)).toContain("novecentos e sessenta e três reais");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// O QUE ENTROU EM 15/09/2026: FRUIÇÃO, PREMISSAS CADASTRADAS, AVISOS E ORIGEM POR LINHA
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠️ OS 23 TESTES ACIMA NÃO FORAM TOCADOS, DE PROPÓSITO. Eles são o caso real do papel de
// 25/06/2026 conferido linha a linha contra o que o jurídico produz à mão — são o marco, e marco
// não se reescreve quando a função cresce. O que mudou hoje entra embaixo, em blocos novos.
//
// ⚠️ O QUE ESTES BLOCOS PROTEGEM, EM UMA FRASE CADA:
//   • a fruição só existe com posse, e por isso o array de deduções MUDA DE TAMANHO entre dois
//     contratos do mesmo empreendimento — quem indexa por posição lê a linha errada;
//   • a base cadastrada muda o NÚMERO, não só o texto, senão a tela de premissas é enfeite;
//   • chave presente com `undefined` não pode virar `NaN` impresso no papel do cliente;
//   • toda linha diz de onde veio, e o que caiu na praxe vira aviso para quem assina.

/**
 * O mesmo caso real, agora com posse cadastrada.
 *
 * ⚠️ A FRUIÇÃO PEDE DOIS NÚMEROS, E NÃO UM. Sem `mesesDeFruicao` a rubrica inteira some (não houve
 * posse); com os meses mas sem `valorDoContratoAtualizado` a base não existe e a linha sai do papel
 * com aviso. Os dois caminhos estão testados abaixo.
 */
const CASO_COM_POSSE = {
  ...CASO_REAL,
  mesesDeFruicao: 21.5,
  valorDoContratoAtualizado: 82437.15,
};

describe("a fruição só entra na conta quando houve posse", () => {
  // ⚠️ A AUSÊNCIA DE POSSE É O ESTADO NORMAL DE QUEM CHEGA À RESCISÃO. A minuta da Lavra do Ouro
  // concede a posse "após 2 (dois) anos ... E DESDE QUE ESTEJA(M) ELE(S) EM DIA": o inadimplente —
  // de quem se faz rescisão — nunca a recebeu. Por isso a linha some CALADA, sem aviso.
  it("sem meses de fruição, a rubrica não existe e o papel tem cinco linhas", () => {
    const conta = calcularRescisao(CASO_REAL);
    expect(deducaoDe(conta, "fruicao")).toBeUndefined();
    expect(conta.deducoes).toHaveLength(5);
  });

  it("com meses de fruição, a linha aparece e o papel passa a ter seis", () => {
    const conta = calcularRescisao(CASO_COM_POSSE);
    expect(deducaoDe(conta, "fruicao")).toBeDefined();
    expect(conta.deducoes).toHaveLength(6);
  });

  // ⚠️ A ORDEM NÃO É DECORATIVA: quem lê de cima para baixo vê primeiro o que é do contrato
  // (multa, publicidade, corretagem), depois o que é do que entrou (tributos), depois o tempo de
  // ocupação (fruição) e por último a dívida corrente (parcelas vencidas).
  it("e ela entra ENTRE os tributos e as parcelas vencidas", () => {
    const conta = calcularRescisao(CASO_COM_POSSE);
    expect(conta.deducoes.map((l) => l.rubrica)).toEqual([
      "clausula_penal",
      "publicidade",
      "corretagem",
      "tributos",
      "fruicao",
      "parcelas_vencidas",
    ]);
  });

  // ⚠️⚠️ ESTE É O TESTE QUE JUSTIFICA `deducaoDe` EXISTIR, e ele prova o defeito em vez de só
  // descrevê-lo: a MESMA posição 4 devolve "parcelas vencidas" num contrato e "fruição" no outro.
  // Quem escrever `deducoes[4].valor` esperando a dívida corrente vai imprimir a fruição no dia em
  // que alguém cadastrar a posse — e o número estará errado sem que nada quebre.
  it("por isso a linha se procura pela rubrica, nunca pela posição", () => {
    const semPosse = calcularRescisao(CASO_REAL);
    const comPosse = calcularRescisao(CASO_COM_POSSE);

    // A rubrica acha a MESMA linha nos dois contratos...
    expect(deducaoDe(semPosse, "parcelas_vencidas")?.valor).toBe(963.88);
    expect(deducaoDe(comPosse, "parcelas_vencidas")?.valor).toBe(963.88);

    // ...enquanto o índice 4 troca de dono no meio do caminho.
    expect(semPosse.deducoes[4]?.rubrica).toBe("parcelas_vencidas");
    expect(comPosse.deducoes[4]?.rubrica).toBe("fruicao");
  });

  it("zero e nulo são 'não houve posse', não 'fruição de zero real'", () => {
    const zero = calcularRescisao({ ...CASO_COM_POSSE, mesesDeFruicao: 0 });
    const nulo = calcularRescisao({ ...CASO_COM_POSSE, mesesDeFruicao: null });
    expect(deducaoDe(zero, "fruicao")).toBeUndefined();
    expect(deducaoDe(nulo, "fruicao")).toBeUndefined();
    expect(zero.deducoes).toHaveLength(5);
    expect(nulo.deducoes).toHaveLength(5);
  });
});

describe("a conta da fruição", () => {
  const conta = calcularRescisao(CASO_COM_POSSE);

  // ⚠️ A ARITMÉTICA FEITA À MÃO, para o número não ser apenas "o que a função devolveu":
  //
  //     valor do contrato atualizado    R$ 82.437,15
  //     0,75% ao mês                    R$    618,278625   ← 82.437,15 × 0,0075
  //     × 21,5 meses                    R$ 13.292,9904375  ← 618,278625 × 21,5
  //     arredondado em centavos         R$ 13.292,99
  it("é 0,75% ao mês sobre o contrato atualizado, por 21,5 meses", () => {
    expect(deducaoDe(conta, "fruicao")?.valor).toBe(13292.99);
  });

  // ⚠️ O PAPEL PRECISA IMPRIMIR OS TRÊS ELEMENTOS — alíquota, base e meses. Uma linha que diz só
  // "Fruição R$ 13.292,99" é indefensável na frente do advogado do cliente: ele não tem como
  // conferir a conta, e a primeira pergunta é "por quantos meses?".
  it("e o papel explica de onde o número saiu", () => {
    expect(deducaoDe(conta, "fruicao")?.base).toBe(
      "0,75% ao mês sobre R$ 82.437,15, por 21,5 meses",
    );
    expect(deducaoDe(conta, "fruicao")?.descricao).toBe("Fruição (0,75% ao mês)");
  });

  // ⚠️ A FRUIÇÃO INVERTE O RESULTADO DO CASO REAL, e é bom que o teste mostre isso: sem ela sobram
  // R$ 33,81 para o cliente; com 21,5 meses de ocupação ele passa a DEVER R$ 13.259,18.
  it("e ela vira o resultado do papel de cabeça para baixo", () => {
    // 6.768,28 + 2.707,31 + 4.705,22 + 956,83 + 13.292,99 + 963,88 = 29.394,51
    expect(conta.totalDeDeducoes).toBe(29394.51);
    expect(conta.saldoARestituir).toBe(0);
    expect(conta.saldoResidual).toBe(13259.18);
  });
});

describe("o buraco do undefined", () => {
  // ⚠️⚠️ ESTE TESTE EXISTE PORQUE O DEFEITO CHEGOU A SER ESCRITO. O spread ingênuo
  // `{ ...PERCENTUAIS_PADRAO, ...entrada.percentuais }` deixa a CHAVE PRESENTE COM `undefined`
  // sobrescrever o padrão, e `(67.682,78 × undefined) / 100` é `NaN`.
  //
  // `NaN` é o pior tipo de erro que existe num documento financeiro: ele não estoura, atravessa a
  // soma, sobrevive ao `Math.round` e sai impresso na frente do cliente. Um loader que monta o
  // objeto com `{ multa: linha?.percentual }` produz exatamente isso sem ninguém ter decidido nada.
  it("chave presente com undefined cai no padrão de 10%, e não em NaN", () => {
    const conta = calcularRescisao({ ...CASO_REAL, percentuais: { multa: undefined } });
    expect(deducaoDe(conta, "clausula_penal")?.valor).toBe(6768.28);
    expect(Number.isNaN(deducaoDe(conta, "clausula_penal")?.valor)).toBe(false);
  });

  it("e com os cinco percentuais em undefined o papel sai idêntico ao caso real", () => {
    const conta = calcularRescisao({
      ...CASO_REAL,
      percentuais: {
        corretagem: undefined,
        fruicao: undefined,
        multa: undefined,
        publicidade: undefined,
        tributos: undefined,
      },
    });
    expect(conta.totalDeDeducoes).toBe(16101.52);
    expect(conta.saldoARestituir).toBe(33.81);
    expect(conta.deducoes.every((l) => Number.isFinite(l.valor))).toBe(true);
  });
});

describe("os avisos dizem a quem assina o que não foi conferido", () => {
  // ⚠️ UM TERMO QUE AFIRMA "10% CONFORME CONTRATO" SEM CADASTRO É UMA AFIRMAÇÃO QUE O JURÍDICO VAI
  // TER DE DEFENDER. O aviso não é enfeite de tela: é o que separa "a Careli aplicou a praxe" de
  // "a Careli aplicou o que está no contrato deste empreendimento".
  it("sem cadastro nenhum, as quatro rubricas da praxe viram pendência", () => {
    const conta = calcularRescisao(CASO_REAL);
    const tudo = conta.avisos.join(" | ");
    expect(conta.avisos).toHaveLength(4);
    expect(tudo).toContain("Multa penal usou o percentual de praxe (10%)");
    expect(tudo).toContain("Publicidade usou o percentual de praxe (4%)");
    expect(tudo).toContain("Corretagem usou o percentual de praxe (6,50%)");
    expect(tudo).toContain("Tributos usou o percentual de praxe (5,93%)");
  });

  // ⚠️ E A FRUIÇÃO NÃO APARECE NA LISTA, o que parece uma falta e é a regra. Sem posse a rubrica
  // não existe — não há o que cadastrar, não há o que conferir. Avisar aqui treinaria quem assina a
  // ignorar a lista inteira, que é o jeito conhecido de matar um alerta.
  it("e a fruição NÃO é citada, porque sem posse a rubrica sequer existe", () => {
    const conta = calcularRescisao(CASO_REAL);
    expect(conta.avisos.some((a) => a.includes("Fruição"))).toBe(false);
  });

  it("mas com posse e sem cadastro, aí sim ela vira a quinta pendência", () => {
    const conta = calcularRescisao(CASO_COM_POSSE);
    expect(conta.avisos).toHaveLength(5);
    expect(conta.avisos).toContain(
      "Fruição usou o percentual de praxe (0,75%): não há premissa cadastrada para este empreendimento.",
    );
  });

  it("com as cinco rubricas cadastradas, não sobra aviso nenhum", () => {
    const conta = calcularRescisao({
      ...CASO_REAL,
      premissas: {
        clausula_penal: {
          base: "valor_de_tabela_menos_comissao",
          clausula: null,
          percentual: 10,
          periodicidade: "unica",
        },
        corretagem: {
          base: "valor_efetivo",
          clausula: null,
          percentual: null,
          periodicidade: "unica",
        },
        fruicao: {
          base: "valor_do_contrato_atualizado",
          clausula: null,
          percentual: 0.75,
          periodicidade: "mensal",
        },
        publicidade: {
          base: "valor_de_tabela_menos_comissao",
          clausula: null,
          percentual: 4,
          periodicidade: "unica",
        },
        tributos: { base: "total_pago", clausula: null, percentual: 5.93, periodicidade: "unica" },
      },
    });
    expect(conta.avisos).toEqual([]);
    // E a conta continua a do papel: cadastrar a praxe não muda número nenhum.
    expect(conta.totalDeDeducoes).toBe(16101.52);
  });
});

describe("cada linha diz de onde veio o número", () => {
  const conta = calcularRescisao({
    ...CASO_REAL,
    premissas: {
      publicidade: {
        base: "valor_de_tabela_menos_comissao",
        clausula: "Cláusula 8.2, alínea b",
        percentual: 3,
        periodicidade: "unica",
      },
    },
  });

  it("rubrica cadastrada sai com origem 'cadastrada'", () => {
    expect(deducaoDe(conta, "publicidade")?.origem).toBe("cadastrada");
  });

  it("rubrica sem cadastro sai com origem 'padrao', na mesma conta", () => {
    expect(deducaoDe(conta, "clausula_penal")?.origem).toBe("padrao");
    expect(deducaoDe(conta, "corretagem")?.origem).toBe("padrao");
    expect(deducaoDe(conta, "tributos")?.origem).toBe("padrao");
  });

  // ⚠️ A ORIGEM SEM O NÚMERO SERIA ROTULAGEM VAZIA: dizer "cadastrada" e continuar deduzindo os 4%
  // da praxe é pior do que não dizer nada.
  it("e o percentual cadastrado é o que realmente entra na conta", () => {
    // 67.682,78 × 3% = 2.030,4834 → R$ 2.030,48, contra os R$ 2.707,31 dos 4% da praxe.
    expect(deducaoDe(conta, "publicidade")?.valor).toBe(2030.48);
    expect(deducaoDe(conta, "publicidade")?.base).toBe("3% sobre R$ 67.682,78");
  });
});

describe("a base cadastrada muda o número, e não só o texto", () => {
  // ⚠️ ESTE É O TESTE QUE IMPEDE A TELA DE PREMISSAS DE VIRAR ENFEITE. Nos 3.020 contratos com
  // texto do C2X a mesma cláusula penal incide ora sobre o "valor total do contrato", ora sobre o
  // "valor do imóvel atualizado", ora sobre o "total pago" — e a base do papel de hoje (tabela
  // menos comissão) não aparece em contrato nenhum. Se cadastrar a base não mudasse o valor
  // deduzido, o campo seria decoração e o termo continuaria dizendo o que o Word dizia.
  const conta = calcularRescisao({
    ...CASO_REAL,
    premissas: {
      clausula_penal: {
        base: "total_pago",
        clausula: null,
        percentual: 10,
        periodicidade: "unica",
      },
    },
  });

  it("os MESMOS 10%, agora sobre o total pago, dão outro número", () => {
    // 16.135,33 × 10% = 1.613,533 → R$ 1.613,53 ... contra os R$ 6.768,28 da base da praxe.
    expect(deducaoDe(conta, "clausula_penal")?.valor).toBe(1613.53);
    expect(deducaoDe(calcularRescisao(CASO_REAL), "clausula_penal")?.valor).toBe(6768.28);
  });

  it("e o texto da linha diz sobre o que incidiu", () => {
    expect(deducaoDe(conta, "clausula_penal")?.base).toBe("10% sobre R$ 16.135,33");
  });

  it("o total acompanha a base, sem sobra escondida", () => {
    // 1.613,53 + 2.707,31 + 4.705,22 + 956,83 + 963,88 = 10.946,77
    expect(conta.totalDeDeducoes).toBe(10946.77);
    const soma = conta.deducoes.reduce((t, l) => t + l.valor, 0);
    expect(Math.round(soma * 100) / 100).toBe(conta.totalDeDeducoes);
  });
});

describe("a base que não foi informada tira a linha do papel, com aviso", () => {
  // ⚠️ DEDUZIR SOBRE UM VALOR QUE NÃO EXISTE SERIA INVENTAR A DEDUÇÃO. A premissa manda calcular
  // sobre o contrato atualizado, e o contrato atualizado não veio: a saída honesta é a linha não
  // sair e quem assina saber por quê — nunca um zero silencioso, que o cliente leria como "a
  // Careli abriu mão da multa".
  const conta = calcularRescisao({
    ...CASO_REAL,
    premissas: {
      clausula_penal: {
        base: "valor_do_contrato_atualizado",
        clausula: null,
        percentual: 10,
        periodicidade: "unica",
      },
    },
  });

  it("a linha simplesmente não entra", () => {
    expect(deducaoDe(conta, "clausula_penal")).toBeUndefined();
    expect(conta.deducoes).toHaveLength(4);
  });

  it("e o total NÃO inclui a rubrica que ficou de fora", () => {
    // 2.707,31 + 4.705,22 + 956,83 + 963,88 = 9.333,24 — exatamente os R$ 16.101,52 do caso real
    // menos os R$ 6.768,28 da multa que não pôde ser calculada.
    expect(conta.totalDeDeducoes).toBe(9333.24);
    expect(conta.totalDeDeducoes).toBe(Math.round((16101.52 - 6768.28) * 100) / 100);
  });

  it("o aviso nomeia a rubrica e o valor que faltou", () => {
    expect(conta.avisos).toContain(
      "Multa penal não entrou na conta: a premissa manda calcular sobre o valor do contrato atualizado, que não foi informado.",
    );
  });

  // ⚠️ E A FRUIÇÃO DA PRAXE CAI NO MESMO BURACO, sem premissa nenhuma cadastrada: a base padrão
  // dela JÁ É o contrato atualizado. Posse cadastrada e valor atualizado ausente é a combinação
  // que a tela vai produzir com mais frequência, porque são dois campos de telas diferentes.
  it("a fruição da praxe cai no mesmo buraco quando o valor atualizado não veio", () => {
    const semValor = calcularRescisao({ ...CASO_REAL, mesesDeFruicao: 21.5 });
    expect(deducaoDe(semValor, "fruicao")).toBeUndefined();
    expect(semValor.deducoes).toHaveLength(5);
    expect(semValor.totalDeDeducoes).toBe(16101.52);
    expect(semValor.avisos).toContain(
      "Fruição não entrou na conta: a premissa manda calcular sobre o valor do contrato atualizado, que não foi informado.",
    );
  });
});

describe("a cláusula cadastrada vai impressa na linha", () => {
  // ⚠️ É O TRECHO DO CONTRATO QUE SUSTENTA A ALÍQUOTA na frente do cliente. Sem ele o termo afirma
  // um percentual e manda o leitor confiar; com ele, o leitor confere.
  const TRECHO =
    "Cláusula 9ª, § 2º — multa compensatória de 10% (dez por cento) sobre o valor do contrato.";

  const conta = calcularRescisao({
    ...CASO_REAL,
    premissas: {
      clausula_penal: {
        base: "valor_de_tabela_menos_comissao",
        clausula: TRECHO,
        percentual: 10,
        periodicidade: "unica",
      },
    },
  });

  it("a linha carrega o trecho do contrato, palavra por palavra", () => {
    expect(deducaoDe(conta, "clausula_penal")?.clausula).toBe(TRECHO);
  });

  // ⚠️ `null` E NÃO STRING VAZIA: quem monta o documento decide pular o parágrafo com um `if`, e
  // `""` passaria no `if` de algumas implementações imprimindo uma citação em branco.
  it("e quem não tem cadastro carrega null, nunca string vazia", () => {
    expect(deducaoDe(conta, "publicidade")?.clausula).toBeNull();
    expect(deducaoDe(conta, "corretagem")?.clausula).toBeNull();
    expect(deducaoDe(conta, "parcelas_vencidas")?.clausula).toBeNull();
  });
});
