import { describe, expect, it } from "vitest";

import {
  abrirFormulario,
  editarCampo,
  faixasAtivas,
  type IndiceDaTabela,
  type LinhaDeFaixa,
  type MemoriaDaFaixa,
  mudarParcelas,
  opcoesDeIndice,
  type PremissaDoFormulario,
  rotuloDoIndiceDaTabela,
  textoDoPreenchimento,
} from "@/lib/hercules/faixa-no-formulario-do-plano";
import {
  aplicarPremissa,
  premissaDoPrazo,
} from "@/lib/hercules/premissa-do-prazo";

// ⚠️ AS FAIXAS DO JARDIM DAS GERAIS (enterprise 40) COMO O BANCO AS GUARDA, lidas em 16/09/2026 —
// com os `numeric` em texto, que é como o PostgREST devolve. A faixa de 37 a 120 existe DUAS vezes:
// a antiga com IPCA, desativada, e a atual com Poupança. A desativada vem PRIMEIRO de propósito: é a
// ordem que faria a escolha errada se o filtro de ativas faltasse.
function linha(
  parcial: Partial<LinhaDeFaixa> & { max: number; min: number },
): LinhaDeFaixa {
  const { max, min, ...resto } = parcial;
  return {
    ativo: true,
    define_entrada: true,
    define_indice: true,
    define_juros: true,
    entrada_percentual: "20.000",
    id: `faixa-${min}-${max}-${String(parcial.ativo ?? true)}`,
    indice_correcao: "SEM_CORRECAO",
    juros_convencao: "equivalente",
    juros_periodicidade: "mensal",
    juros_taxa: "0.0000",
    observacao: null,
    parcela_maxima: max,
    parcela_minima: min,
    ...resto,
  };
}

const JDG: LinhaDeFaixa[] = [
  linha({ max: 24, min: 1 }),
  linha({ indice_correcao: "IPCA_ANUAL", max: 36, min: 25 }),
  linha({
    ativo: false,
    entrada_percentual: "10.000",
    indice_correcao: "IPCA_ANUAL",
    juros_taxa: "0.5000",
    max: 120,
    min: 37,
  }),
  linha({
    entrada_percentual: "10.000",
    indice_correcao: "POUPANCA",
    juros_taxa: "0.5000",
    max: 120,
    min: 37,
  }),
];

/** O plano "Normal" do JDG como está salvo: 120x, IPCA anual, 0,5% ao mês, 10% de entrada. */
const NORMAL_SALVO: PremissaDoFormulario & { parcelas: number } = {
  entradaTexto: "10",
  indiceCorrecao: "IPCA_ANUAL",
  jurosConvencao: "equivalente",
  jurosPeriodicidade: "mensal",
  jurosTexto: "0,5",
  parcelas: 120,
};

/** Simula a tela: aplica o que a função devolveu por cima do que estava. */
function naTelaDepois(
  antes: PremissaDoFormulario,
  resultado: { naTela: null | PremissaDoFormulario },
): PremissaDoFormulario {
  return resultado.naTela ?? antes;
}

describe("⚠️ ABRIR UM PLANO SALVO NÃO TROCA NADA", () => {
  it("o plano de 120x com IPCA continua IPCA, mesmo com a faixa de 37 a 120 mandando Poupança", () => {
    const memoria = abrirFormulario(NORMAL_SALVO);

    expect(memoria.doOperador.indiceCorrecao).toBe("IPCA_ANUAL");
    expect(memoria.doOperador).toEqual({
      entradaTexto: "10",
      indiceCorrecao: "IPCA_ANUAL",
      jurosConvencao: "equivalente",
      jurosPeriodicidade: "mensal",
      jurosTexto: "0,5",
    });
    // Nada veio de faixa, então a tela não diz nada.
    expect(memoria.preenchido).toBeNull();
  });

  it("⚠️ a trava está na ASSINATURA: abrir não recebe faixa nenhuma", () => {
    // Se alguém acrescentar as faixas a `abrirFormulario`, este teste obriga a olhar para a regra.
    expect(abrirFormulario.length).toBe(1);
  });

  it("o evento de Parcelas disparado SEM mudar o número (letra digitada, foco) não preenche", () => {
    const memoria = abrirFormulario(NORMAL_SALVO);
    const resultado = mudarParcelas(memoria, 120, JDG);

    expect(resultado.naTela).toBeNull();
    expect(resultado.memoria).toBe(memoria);
  });

  it("mexer em outro campo do plano salvo não puxa a faixa", () => {
    const memoria = abrirFormulario(NORMAL_SALVO);
    const depois = editarCampo(memoria, "entrada", {
      ...memoria.doOperador,
      entradaTexto: "15",
    });

    expect(depois.doOperador.indiceCorrecao).toBe("IPCA_ANUAL");
    expect(depois.doOperador.entradaTexto).toBe("15");
    expect(depois.preenchido).toBeNull();
  });
});

describe("mudar as parcelas preenche o que a faixa define", () => {
  it("120 → 100 no JDG: Poupança, 0,5% ao mês e 10% de entrada, e a tela diz de onde veio", () => {
    const resultado = mudarParcelas(abrirFormulario(NORMAL_SALVO), 100, JDG);

    expect(resultado.naTela).toEqual({
      entradaTexto: "10",
      indiceCorrecao: "POUPANCA",
      jurosConvencao: "equivalente",
      jurosPeriodicidade: "mensal",
      jurosTexto: "0,5",
    });
    expect(resultado.memoria.preenchido).toEqual({
      campos: ["entrada", "indice", "juros"],
      parcelaMaxima: 120,
      parcelaMinima: 37,
    });
    expect(textoDoPreenchimento(resultado.memoria.preenchido!)).toBe(
      "Preenchido pela faixa de 37 a 120 parcelas.",
    );
  });

  it("⚠️ o JDG com DUAS faixas de 37 a 120 escolhe a ATIVA (Poupança), não a primeira da lista", () => {
    const resultado = mudarParcelas(abrirFormulario(NORMAL_SALVO), 60, JDG);
    expect(resultado.naTela?.indiceCorrecao).toBe("POUPANCA");
  });

  it("faixa de 25 a 36 do JDG troca para IPCA e zera os juros (a faixa DIZ sem juros)", () => {
    const resultado = mudarParcelas(abrirFormulario(NORMAL_SALVO), 36, JDG);

    expect(resultado.naTela?.indiceCorrecao).toBe("IPCA_ANUAL");
    expect(resultado.naTela?.jurosTexto).toBe("0");
    expect(resultado.naTela?.entradaTexto).toBe("20");
    expect(resultado.memoria.preenchido?.parcelaMinima).toBe(25);
  });

  it("⚠️ a mesma conta de `aplicarPremissa`, prazo a prazo: o cadastro não pode divergir do simulador", () => {
    const plano = {
      entradaPercentual: 10,
      indiceCorrecao: "IPCA_ANUAL",
      jurosConvencao: "proporcional",
      jurosPeriodicidade: "anual",
      jurosTaxa: 8,
    };
    const doOperador = {
      entradaTexto: "10",
      indiceCorrecao: "IPCA_ANUAL",
      jurosConvencao: "proporcional",
      jurosPeriodicidade: "anual",
      jurosTexto: "8",
      parcelas: 999,
    };

    for (const parcelas of [1, 24, 25, 36, 37, 100, 120]) {
      const tela = mudarParcelas(abrirFormulario(doOperador), parcelas, JDG).naTela!;
      const conta = aplicarPremissa(
        plano,
        premissaDoPrazo(faixasAtivas(JDG), parcelas),
      )!;

      expect(Number(tela.entradaTexto.replace(",", ".")), `entrada em ${parcelas}`).toBe(
        conta.entradaPercentual,
      );
      expect(tela.indiceCorrecao, `índice em ${parcelas}`).toBe(conta.indiceCorrecao);
      expect(tela.jurosConvencao, `convenção em ${parcelas}`).toBe(conta.jurosConvencao);
      expect(tela.jurosPeriodicidade, `periodicidade em ${parcelas}`).toBe(
        conta.jurosPeriodicidade,
      );
      expect(Number(tela.jurosTexto.replace(",", ".")), `juros em ${parcelas}`).toBe(
        conta.jurosTaxa,
      );
    }
  });
});

describe("o que a faixa NÃO preenche", () => {
  it("faixa INATIVA é ignorada: nada preenchido, nada dito", () => {
    const soInativa = [linha({ ativo: false, indice_correcao: "POUPANCA", max: 120, min: 37 })];
    const memoria = abrirFormulario(NORMAL_SALVO);
    const resultado = mudarParcelas(memoria, 100, soInativa);

    expect(resultado.naTela).toEqual(memoria.doOperador);
    expect(resultado.memoria.preenchido).toBeNull();
  });

  it("número fora de toda faixa não preenche e não diz nada", () => {
    const memoria = abrirFormulario(NORMAL_SALVO);
    const resultado = mudarParcelas(memoria, 150, JDG);

    expect(resultado.naTela).toEqual(memoria.doOperador);
    expect(resultado.memoria.preenchido).toBeNull();
    expect(resultado.memoria.parcelas).toBe(150);
  });

  it("empreendimento sem faixa cadastrada: nada muda", () => {
    const memoria = abrirFormulario(NORMAL_SALVO);
    const resultado = mudarParcelas(memoria, 100, []);

    expect(resultado.naTela).toEqual(memoria.doOperador);
    expect(resultado.memoria.preenchido).toBeNull();
  });

  it("⚠️ faixa que NÃO define juros não zera o juros digitado", () => {
    const naoOpinaSobreJuros = [
      linha({
        define_entrada: false,
        define_juros: false,
        entrada_percentual: null,
        indice_correcao: "IGPM_ANUAL",
        juros_taxa: null,
        max: 120,
        min: 37,
      }),
    ];
    const memoria = abrirFormulario({
      ...NORMAL_SALVO,
      jurosPeriodicidade: "anual",
      jurosTexto: "0,72",
    });
    const resultado = mudarParcelas(memoria, 100, naoOpinaSobreJuros);

    expect(resultado.naTela?.jurosTexto).toBe("0,72");
    expect(resultado.naTela?.jurosPeriodicidade).toBe("anual");
    expect(resultado.naTela?.entradaTexto).toBe("10");
    expect(resultado.naTela?.indiceCorrecao).toBe("IGPM_ANUAL");
    expect(resultado.memoria.preenchido?.campos).toEqual(["indice"]);
  });

  it("e faixa que define juros com taxa NULA quer dizer SEM JUROS: o campo fica vazio", () => {
    const semJuros = [linha({ juros_taxa: null, max: 12, min: 1 })];
    const resultado = mudarParcelas(abrirFormulario(NORMAL_SALVO), 10, semJuros);

    expect(resultado.naTela?.jurosTexto).toBe("");
    expect(resultado.memoria.preenchido?.campos).toContain("juros");
  });
});

describe("a troca à mão e as teclas intermediárias", () => {
  it("⚠️ trocar à mão não é desfeito pela faixa até o operador mexer nas parcelas de novo", () => {
    let memoria: MemoriaDaFaixa = abrirFormulario(NORMAL_SALVO);
    let tela: PremissaDoFormulario = memoria.doOperador;

    const preenchido = mudarParcelas(memoria, 100, JDG);
    memoria = preenchido.memoria;
    tela = naTelaDepois(tela, preenchido);
    expect(tela.indiceCorrecao).toBe("POUPANCA");

    // O operador prefere IPCA mensal.
    tela = { ...tela, indiceCorrecao: "IPCA_MENSAL" };
    memoria = editarCampo(memoria, "indice", tela);
    // O índice sai do aviso; entrada e juros continuam vindo da faixa.
    expect(memoria.preenchido?.campos).toEqual(["entrada", "juros"]);

    // O evento de Parcelas dispara com o mesmo número: a escolha dele fica.
    const mesmo = mudarParcelas(memoria, 100, JDG);
    tela = naTelaDepois(tela, mesmo);
    expect(tela.indiceCorrecao).toBe("IPCA_MENSAL");

    // Mudou as parcelas: a faixa volta a mandar.
    const outra = mudarParcelas(mesmo.memoria, 90, JDG);
    tela = naTelaDepois(tela, outra);
    expect(tela.indiceCorrecao).toBe("POUPANCA");
    expect(outra.memoria.preenchido?.campos).toEqual(["entrada", "indice", "juros"]);
  });

  it("trocar à mão TODOS os campos preenchidos apaga o aviso", () => {
    let memoria = mudarParcelas(abrirFormulario(NORMAL_SALVO), 100, JDG).memoria;
    const tela = { ...memoria.doOperador, entradaTexto: "12", indiceCorrecao: "TR_MENSAL", jurosTexto: "1" };
    memoria = editarCampo(memoria, "entrada", tela);
    memoria = editarCampo(memoria, "indice", tela);
    memoria = editarCampo(memoria, "juros", tela);

    expect(memoria.preenchido).toBeNull();
  });

  it("⚠️ digitar 120 tecla a tecla não deixa resto da faixa de 1 a 12 no plano", () => {
    const escada = [
      linha({ entrada_percentual: "50.000", max: 12, min: 1 }),
      linha({
        define_entrada: false,
        define_juros: false,
        entrada_percentual: null,
        indice_correcao: "IPCA_ANUAL",
        max: 120,
        min: 37,
      }),
    ];
    const salvo = { ...NORMAL_SALVO, entradaTexto: "10", indiceCorrecao: "SEM_CORRECAO", parcelas: 0 };
    let memoria = abrirFormulario(salvo);
    let tela: PremissaDoFormulario = memoria.doOperador;

    for (const parcelas of [1, 12, 120]) {
      const passo = mudarParcelas(memoria, parcelas, escada);
      memoria = passo.memoria;
      tela = naTelaDepois(tela, passo);
    }

    // Em "1" e "12" a entrada foi 50%; em 120 a faixa não opina, e volta a do operador.
    expect(tela.entradaTexto).toBe("10");
    expect(tela.jurosTexto).toBe("0,5");
    expect(tela.indiceCorrecao).toBe("IPCA_ANUAL");
    expect(memoria.preenchido?.campos).toEqual(["indice"]);
  });

  it("⚠️ juros digitado olhando o 'ao mês' da faixa volta COM o 'ao mês', e não com o 'ao ano' antigo", () => {
    const salvo = { ...NORMAL_SALVO, jurosPeriodicidade: "anual", jurosTexto: "8" };
    let memoria = mudarParcelas(abrirFormulario(salvo), 100, JDG).memoria;
    // Na tela: 0,5 ao mês, da faixa. O operador digita 0,6 por cima.
    const tela = { ...memoria.doOperador, jurosPeriodicidade: "mensal", jurosTexto: "0,6" };
    memoria = editarCampo(memoria, "juros", tela);

    // Prazo sem faixa: volta ao que o operador escreveu — 0,6 AO MÊS.
    const semFaixa = mudarParcelas(memoria, 150, JDG);
    expect(semFaixa.naTela?.jurosTexto).toBe("0,6");
    expect(semFaixa.naTela?.jurosPeriodicidade).toBe("mensal");
  });

  it("apagar o campo para redigitar (0 parcelas) não preenche nada", () => {
    const memoria = mudarParcelas(abrirFormulario(NORMAL_SALVO), 0, JDG);
    expect(memoria.naTela?.indiceCorrecao).toBe("IPCA_ANUAL");
    expect(memoria.memoria.preenchido).toBeNull();
  });
});

describe("o seletor de índice lê a TABELA", () => {
  const TABELA: IndiceDaTabela[] = [
    {
      aplicacao: "nenhuma",
      codigo: "SEM_CORRECAO",
      exige_parametro: false,
      fonte: "manual",
      nome: "Contrato sem correcao monetaria",
      sigla: "sem correcao",
    },
    {
      aplicacao: "anual",
      codigo: "IPCA_ANUAL",
      exige_parametro: false,
      fonte: "ibge_sidra",
      nome: "Indice Nacional de Precos ao Consumidor Amplo",
      sigla: "IPCA",
    },
    {
      aplicacao: "anual",
      codigo: "POUPANCA",
      exige_parametro: false,
      fonte: "bcb_sgs",
      nome: "Rendimento da caderneta de poupanca",
      sigla: "Poupanca",
    },
    {
      aplicacao: "mensal",
      codigo: "CUB",
      exige_parametro: true,
      fonte: "manual",
      nome: "Custo Unitario Basico da Construcao",
      sigla: "CUB/m2",
    },
  ];

  it("o rótulo é o da aba de faixas: sigla + aplicação, e o aviso de valor manual", () => {
    expect(TABELA.map(rotuloDoIndiceDaTabela)).toEqual([
      "sem correcao",
      "IPCA anual",
      "Poupanca anual",
      "CUB/m2 mensal · valor manual",
    ]);
  });

  it("a Poupança está no seletor — a lista cravada de cinco não tinha", () => {
    const opcoes = opcoesDeIndice(TABELA, "IPCA_ANUAL");
    expect(opcoes.map((o) => o.valor)).toEqual(["SEM_CORRECAO", "IPCA_ANUAL", "POUPANCA", "CUB"]);
    expect(opcoes.every((o) => !o.foraDaTabela)).toBe(true);
  });

  it("⚠️ o índice ATUAL do plano aparece mesmo desativado na tabela — senão o select cai calado na primeira", () => {
    const opcoes = opcoesDeIndice(TABELA, "INCC_M_MENSAL");

    expect(opcoes[0]).toEqual({
      foraDaTabela: true,
      rotulo: "INCC-M mensal · fora da lista ativa",
      valor: "INCC_M_MENSAL",
    });
    expect(opcoes).toHaveLength(TABELA.length + 1);
  });

  it("lista que ainda não chegou: só o atual, sem acusá-lo de estar fora", () => {
    expect(opcoesDeIndice(null, "POUPANCA")).toEqual([
      { foraDaTabela: false, rotulo: "poupança anual", valor: "POUPANCA" },
    ]);
  });
});

describe("a conversão da linha do banco", () => {
  it("numeric em texto vira número, e só as ativas passam", () => {
    const ativas = faixasAtivas(JDG);

    expect(ativas).toHaveLength(3);
    expect(ativas[2]).toMatchObject({
      entradaPercentual: 10,
      indiceCorrecao: "POUPANCA",
      jurosTaxa: 0.5,
      parcelaMaxima: 120,
      parcelaMinima: 37,
    });
  });
});
