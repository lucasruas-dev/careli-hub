// A FAIXA NO FORMULÁRIO DO PLANO — o que ela preenche, e QUANDO.
//
// Lucas (16/09/2026), com dois prints do campo CORREÇÃO DO SALDO na aba Planos Comerciais: *"nao
// alterou aqui porque? com base na quantidade de parcelas deveria trazer preenchido"*. A regra da
// faixa já existia e já tinha teste (`premissaDoPrazo`), mas só o simulador de proposta a usava: o
// cadastro do plano nunca foi ligado nela, e ainda oferecia uma lista CRAVADA de cinco índices em que
// a Poupança — o índice da faixa de 37 a 120 parcelas do Jardim das Gerais — nem existia.
//
// ⚠️ ABRIR NÃO PREENCHE, E ISTO É A TRAVA MAIS IMPORTANTE DO ARQUIVO. Um plano salvo com IPCA que o
// operador só abre para conferir não pode virar Poupança porque alguém mudou a faixa depois: o
// plano já pode ter vendido, e o contrato de quem comprou nele diz IPCA. Por isso `abrirFormulario`
// nem recebe as faixas — a trava está na assinatura, e não num `if` que alguém apaga sem ver. O
// preenchimento só acontece em `mudarParcelas`, e só quando o número de fato MUDA.
//
// ⚠️ DUAS MEMÓRIAS, E NÃO UMA: o que está na tela e o que o OPERADOR escreveu. Quem digita "120"
// passa por "1" e "12" antes, e cada tecla cai numa faixa diferente. Se a faixa de 1 a 12 define a
// entrada e a de 37 a 120 não define, preencher por cima do que já estava na tela deixaria a entrada
// da faixa de 1 a 12 num plano de 120 — resto de uma tecla intermediária saindo no contrato. Cada
// mudança de parcelas recomeça do que o operador escreveu (`doOperador`) e põe por cima SÓ a faixa
// que contém o número final.
//
// ⚠️ A MESMA RÉGUA DO SIMULADOR, sem precedência nova: `premissaDoPrazo` escolhe a faixa (CONTER, e
// não "a mais próxima") e separa "sem juros" de "não opino". As faixas são as do PRÓPRIO
// empreendimento, sem herdar do pai — é o que `TelaVenda` e a rota da proposta entregam ao simulador
// (`faixasDePrazo[enterpriseId]`). Se um dia a faixa passar a herdar, muda lá e aqui juntos.

import {
  type FaixaDePrazo,
  premissaDoPrazo,
} from "@/lib/hercules/premissa-do-prazo";
import { rotuloDoIndice } from "@/lib/temis/planos";

/** Uma linha de `temis_indices` (migration 0154), como `GET /api/temis/faixas` devolve. */
export type IndiceDaTabela = {
  aplicacao: string;
  codigo: string;
  exige_parametro: boolean;
  fonte: string;
  nome: string;
  sigla: string;
};

/** Uma linha de `temis_faixas_de_prazo` (migration 0155), como `GET /api/temis/faixas` devolve. */
export type LinhaDeFaixa = {
  ativo: boolean;
  define_entrada: boolean;
  define_indice: boolean;
  define_juros: boolean;
  /** O PostgREST devolve `numeric` como texto ("10.000"). */
  entrada_percentual: null | number | string;
  id: string;
  indice_correcao: null | string;
  juros_convencao: string;
  juros_periodicidade: string;
  juros_taxa: null | number | string;
  observacao: null | string;
  parcela_maxima: number;
  parcela_minima: number;
};

/** O que a aba de faixas leu, com o empreendimento de quem é — para a resposta atrasada não valer para outro. */
export type TabelaDasFaixas = {
  enterpriseId: string;
  faixas: LinhaDeFaixa[];
  indices: IndiceDaTabela[];
};

/**
 * O nome do índice no seletor: sigla + aplicação, e o aviso de valor manual.
 *
 * ⚠️ UM LUGAR SÓ PARA AS DUAS TELAS. A aba de faixas já montava este texto; o formulário do plano
 * tinha a própria lista com outros nomes. Um índice escrito de dois jeitos na mesma página faz o
 * operador achar que são dois índices.
 *
 * ⚠️ O AVISO DE VALOR MANUAL vai no nome da opção porque é onde a pessoa está olhando na hora de
 * escolher. Índice sem fonte automática vira cláusula de contrato sem número por trás: alguém terá
 * que informar o valor à mão a cada competência. "Sem correção" é manual e não precisa de número.
 */
export function rotuloDoIndiceDaTabela(
  indice: Pick<IndiceDaTabela, "aplicacao" | "codigo" | "fonte" | "sigla">,
): string {
  const aplicacao = indice.aplicacao === "nenhuma" ? "" : ` ${indice.aplicacao}`;
  const manual =
    indice.fonte === "manual" && indice.codigo !== "SEM_CORRECAO"
      ? " · valor manual"
      : "";
  return `${indice.sigla}${aplicacao}${manual}`;
}

export type OpcaoDeIndice = {
  /** O índice do plano não está entre os ATIVOS da tabela. Ele aparece mesmo assim. */
  foraDaTabela: boolean;
  rotulo: string;
  valor: string;
};

/**
 * As opções do seletor de índice: as da TABELA, e o índice atual do plano sempre.
 *
 * ⚠️ O ÍNDICE ATUAL NUNCA PODE FALTAR. Um `<select>` cujo `value` não tem `<option>` mostra a
 * primeira opção — e, ao salvar, grava a primeira. Foi assim que a lista cravada trocava Poupança
 * por "sem correção" calada. Índice desativado na tabela, ou lista que ainda não chegou, não pode
 * reabrir esse buraco por outro caminho.
 *
 * `indices` nulo = a lista ainda não chegou (ou falhou): só o atual aparece, sem ser acusado de
 * estar fora da tabela, porque não se sabe.
 */
export function opcoesDeIndice(
  indices: null | readonly IndiceDaTabela[],
  atual: string,
): OpcaoDeIndice[] {
  const opcoes: OpcaoDeIndice[] = (indices ?? []).map((i) => ({
    foraDaTabela: false,
    rotulo: rotuloDoIndiceDaTabela(i),
    valor: i.codigo,
  }));

  if (!opcoes.some((o) => o.valor === atual)) {
    const conhecida = indices !== null;
    opcoes.unshift({
      foraDaTabela: conhecida,
      rotulo: !atual
        ? "Escolha o índice"
        : conhecida
          ? `${rotuloDoIndice(atual)} · fora da lista ativa`
          : rotuloDoIndice(atual),
      valor: atual,
    });
  }

  return opcoes;
}

function numeroDaLinha(valor: null | number | string): null | number {
  if (valor === null || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

/**
 * As faixas que valem para preencher, já no formato de `premissaDoPrazo`.
 *
 * ⚠️ SÓ AS ATIVAS, E ANTES DE ESCOLHER. A faixa desativada continua no banco para explicar o plano
 * que ela gerou, e ocupa o MESMO intervalo da que a substituiu — o Jardim das Gerais tem duas de 37
 * a 120, uma com IPCA desativada e outra com Poupança ativa. `premissaDoPrazo` desempata pela menor
 * `parcelaMinima`, e as duas empatam: sem este filtro, a ordem de leitura decidiria o índice.
 */
export function faixasAtivas(linhas: readonly LinhaDeFaixa[]): FaixaDePrazo[] {
  return linhas
    .filter((l) => l.ativo === true)
    .map((l) => ({
      defineEntrada: l.define_entrada,
      defineIndice: l.define_indice,
      defineJuros: l.define_juros,
      entradaPercentual: numeroDaLinha(l.entrada_percentual),
      indiceCorrecao: l.indice_correcao,
      jurosConvencao: l.juros_convencao,
      jurosPeriodicidade: l.juros_periodicidade,
      jurosTaxa: numeroDaLinha(l.juros_taxa),
      parcelaMaxima: Number(l.parcela_maxima),
      parcelaMinima: Number(l.parcela_minima),
    }));
}

/** Número → texto do campo, na vírgula do português. Nulo vira campo vazio. */
export function paraTexto(valor: null | number | undefined): string {
  if (valor === null || valor === undefined) return "";
  return String(valor).replace(".", ",");
}

/**
 * Os campos que a faixa pode preencher, como o FORMULÁRIO os guarda.
 *
 * ⚠️ ENTRADA E JUROS SÃO TEXTO porque é assim que a tela os guarda: converter a cada tecla reescreve
 * "12," embaixo do dedo de quem digita. Guardar o texto aqui também faz a volta ao que o operador
 * escreveu ser exata, e não uma reconversão.
 */
export type PremissaDoFormulario = {
  entradaTexto: string;
  indiceCorrecao: string;
  jurosConvencao: string;
  jurosPeriodicidade: string;
  jurosTexto: string;
};

/** Os três grupos de campo que uma faixa governa. Periodicidade e convenção andam com os juros. */
export type CampoDaFaixa = "entrada" | "indice" | "juros";

/** O que a tela diz perto dos campos: qual faixa preencheu, e quais campos. */
export type Preenchimento = {
  campos: CampoDaFaixa[];
  parcelaMaxima: number;
  parcelaMinima: number;
};

export type MemoriaDaFaixa = {
  /** O que o operador escreveu, ou o plano salvo trouxe — sem faixa nenhuma por cima. */
  doOperador: PremissaDoFormulario;
  /** As parcelas da última vez. É a comparação que separa "mudou" de "o evento disparou à toa". */
  parcelas: number;
  /** Nulo = nenhum campo da tela veio de faixa, e a tela não diz nada. */
  preenchido: null | Preenchimento;
};

/**
 * O formulário acabou de abrir, com um plano salvo ou com um plano novo.
 *
 * ⚠️ NÃO RECEBE AS FAIXAS, DE PROPÓSITO. Ver o cabeçalho: abrir não pode trocar nada, e a forma mais
 * segura de garantir isso é esta função não ter como consultar faixa nenhuma.
 */
export function abrirFormulario(
  plano: PremissaDoFormulario & { parcelas: number },
): MemoriaDaFaixa {
  return {
    doOperador: {
      entradaTexto: plano.entradaTexto,
      indiceCorrecao: plano.indiceCorrecao,
      jurosConvencao: plano.jurosConvencao,
      jurosPeriodicidade: plano.jurosPeriodicidade,
      jurosTexto: plano.jurosTexto,
    },
    parcelas: plano.parcelas,
    preenchido: null,
  };
}

/**
 * O operador mexeu à mão num campo que a faixa governa.
 *
 * ⚠️ A TROCA À MÃO VENCE ATÉ AS PARCELAS MUDAREM DE NOVO. O campo sai do aviso de "preenchido pela
 * faixa" (ele não veio mais dela) e o valor vira do operador — é para ele que a tela volta se o
 * próximo prazo não tiver faixa.
 *
 * ⚠️ OS JUROS SE GUARDAM EM GRUPO: taxa, periodicidade e convenção, como estão NA TELA. Quem digita
 * "0,6" olhando "ao mês" preenchido pela faixa escreveu 0,6% ao mês; guardar só a taxa e voltar com a
 * periodicidade antiga ("ao ano") transformaria o que ele digitou em outro número.
 */
export function editarCampo(
  memoria: MemoriaDaFaixa,
  campo: CampoDaFaixa,
  naTela: PremissaDoFormulario,
): MemoriaDaFaixa {
  const doOperador: PremissaDoFormulario = { ...memoria.doOperador };

  if (campo === "entrada") doOperador.entradaTexto = naTela.entradaTexto;
  if (campo === "indice") doOperador.indiceCorrecao = naTela.indiceCorrecao;
  if (campo === "juros") {
    doOperador.jurosConvencao = naTela.jurosConvencao;
    doOperador.jurosPeriodicidade = naTela.jurosPeriodicidade;
    doOperador.jurosTexto = naTela.jurosTexto;
  }

  const campos = (memoria.preenchido?.campos ?? []).filter((c) => c !== campo);

  return {
    ...memoria,
    doOperador,
    preenchido:
      memoria.preenchido && campos.length > 0
        ? { ...memoria.preenchido, campos }
        : null,
  };
}

export type ResultadoDasParcelas = {
  memoria: MemoriaDaFaixa;
  /** O que a tela passa a mostrar. Nulo = as parcelas não mudaram, e nada se mexe. */
  naTela: null | PremissaDoFormulario;
};

/**
 * O operador mudou o campo Parcelas: a faixa que CONTÉM o número preenche o que ela define.
 *
 * ⚠️ SÓ O QUE A FAIXA DEFINE. Os `define_*` separam "sem juros" de "não opino" — e é
 * `premissaDoPrazo` quem já faz essa separação, com teste. Aqui se lê o que ela devolveu com as
 * MESMAS perguntas de `aplicarPremissa`: entrada e índice quando vieram preenchidos, juros quando a
 * faixa `defineJuros` (e aí taxa nula é SEM JUROS, campo vazio). Faixa que não opina sobre juros
 * deixa os juros do operador onde estão.
 *
 * ⚠️ SEM FAIXA QUE CONTENHA O NÚMERO, NADA É PREENCHIDO E NADA É DITO: a tela volta ao que o operador
 * escreveu. É o estado normal de empreendimento sem faixa cadastrada, e é também o que limpa o resto
 * de uma faixa que valia para a tecla anterior.
 */
export function mudarParcelas(
  memoria: MemoriaDaFaixa,
  parcelas: number,
  faixas: readonly LinhaDeFaixa[],
): ResultadoDasParcelas {
  if (parcelas === memoria.parcelas) return { memoria, naTela: null };

  const base = memoria.doOperador;
  const premissa = premissaDoPrazo(faixasAtivas(faixas), parcelas);

  if (!premissa) {
    return {
      memoria: { ...memoria, parcelas, preenchido: null },
      naTela: { ...base },
    };
  }

  const naTela: PremissaDoFormulario = { ...base };
  const campos: CampoDaFaixa[] = [];

  if (premissa.entradaPercentual != null) {
    naTela.entradaTexto = paraTexto(premissa.entradaPercentual);
    campos.push("entrada");
  }

  if (premissa.indiceCorrecao != null) {
    naTela.indiceCorrecao = premissa.indiceCorrecao;
    campos.push("indice");
  }

  // ⚠️ AQUI O NULO É VALOR: faixa que define juros com taxa nula quer dizer SEM JUROS, e o campo
  // fica vazio — que é como o formulário escreve "sem juros". A convenção e a periodicidade vão
  // junto, sempre: "0,5" sem o "ao mês" da faixa é outro número.
  if (premissa.faixa.defineJuros) {
    naTela.jurosConvencao = premissa.jurosConvencao ?? base.jurosConvencao;
    naTela.jurosPeriodicidade =
      premissa.jurosPeriodicidade ?? base.jurosPeriodicidade;
    naTela.jurosTexto = paraTexto(premissa.jurosTaxa);
    campos.push("juros");
  }

  return {
    memoria: {
      ...memoria,
      parcelas,
      preenchido:
        campos.length > 0
          ? {
              campos,
              parcelaMaxima: premissa.faixa.parcelaMaxima,
              parcelaMinima: premissa.faixa.parcelaMinima,
            }
          : null,
    },
    naTela,
  };
}

/** A frase perto do campo. "Planos de 37 a 120 parcelas" é o vocabulário da aba de faixas. */
export function textoDoPreenchimento(preenchido: Preenchimento): string {
  return `Preenchido pela faixa de ${preenchido.parcelaMinima} a ${preenchido.parcelaMaxima} parcelas.`;
}
