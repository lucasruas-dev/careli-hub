// A BUSCA DE PROPONENTE — quem pode entrar numa proposta junto com o titular.
//
// Lucas (05/09/2026), vendo o campo pedir nome e CPF digitados na mão: *"tem que buscar dentro da
// base, ou seja, a regra vale a mesma, se não tiver cad credenciado não tem como ir para
// proposta"*.
//
// ⚠️ DIGITAR CRIA UMA PESSOA QUE NÃO EXISTE. O campo antigo aceitava qualquer nome com qualquer
// CPF válido: bastava o dígito verificador fechar. Quem escrevesse "Beatriz Almeida" com o CPF
// certo criava um comprador que o Apolo nunca viu — sem CAD, sem crédito analisado, sem entidade —
// e ele entrava no PDF, na minuta e no contrato como se fosse cadastrado. A régua do titular era
// dura (CAD credenciada no empreendimento) e a do segundo comprador não existia, no MESMO papel.
//
// ⚠️ E A REGRA É A MESMA DOS DOIS LADOS. Não é "o titular é conferido e o resto é confiança": os
// dois assinam o contrato, os dois respondem pela dívida. Por isso a busca devolve a decisão de
// `decidirPelasLinhas` — a MESMA função que libera o titular —, e não uma segunda parecida.
//
// ⚠️ A BUSCA É DENTRO DO ESCOPO, e isso é privacidade, não preguiça. Procurar na base inteira do
// Apolo devolveria nome e CPF de qualquer pessoa da casa para qualquer corretor com acesso ao
// portal comercial. Aqui só aparece quem tem CAD NESTE empreendimento (ou na família dele) — o
// mesmo recorte que a tela Venda já lê para contar o funil.

import { soDigitos } from "@/lib/apolo/documento";

/** Como cada candidato volta para a tela. */
export type ProponenteEncontrado = {
  /** `true` quando a CAD dele está credenciada — só então a tela deixa adicionar. */
  credenciado: boolean;
  cpf: string;
  /** A etapa da CAD, quando ela não libera. */
  etapa: null | string;
  id: string;
  /** A frase que explica por que ele não pode entrar. `null` quando pode. */
  motivo: null | string;
  nome: string;
};

/** O mínimo que a busca precisa saber de uma pessoa da base. */
export type CandidatoDaBase = {
  documento: null | string;
  id: string;
  nome: null | string;
};

/**
 * Quantos candidatos a tela recebe.
 *
 * ⚠️ POUCOS DE PROPÓSITO. Uma lista longa de nomes e CPFs numa modal não ajuda a escolher e vira
 * exposição de dado pessoal a mais. Quem não achou em oito refina o termo — e digitar o CPF inteiro
 * sempre cai no alvo exato.
 */
export const MAXIMO_DE_CANDIDATOS = 8;

/**
 * Menos que isto não busca.
 *
 * ⚠️ DUAS LETRAS DEVOLVERIAM MEIA BASE, e a cada tecla. Três é o ponto em que a busca começa a
 * significar alguma coisa; para CPF a régua é outra (ver `termoDaBusca`), porque ninguém digita
 * três dígitos de um CPF esperando resultado útil.
 */
export const MINIMO_DE_LETRAS = 3;

export type TermoDaBusca =
  | { digitos: string; tipo: "cpf" }
  | { texto: string; tipo: "nome" }
  | { tipo: "curto" };

/**
 * O que o corretor digitou: um CPF, um nome, ou pouco demais para procurar.
 *
 * ⚠️ O CPF É RECONHECIDO PELOS DÍGITOS, não pelo formato. O corretor cola "058.183.866-19" do
 * WhatsApp, digita "05818386619" no teclado numérico, ou traz "058 183 866 19" de uma planilha —
 * é a mesma pergunta. Só a partir de 4 dígitos: "058" ainda é gente demais.
 */
export function termoDaBusca(cru: string): TermoDaBusca {
  const texto = String(cru ?? "").trim();
  const digitos = soDigitos(texto);

  // ⚠️ SÓ VIRA CPF SE O QUE SOBROU FOR (QUASE) SÓ DÍGITO, e a régua é a PROPORÇÃO, não a presença
  // nem uma folga fixa. "Ana 3" tem um dígito em quatro caracteres e continua sendo um nome;
  // "058.183.866-19" tem onze em catorze e é documento. Uma folga de três caracteres (o primeiro
  // desenho) resolvia a pontuação do CPF mas quebrava em texto curto: "Ana 3" caía como documento
  // porque 1 ≥ 4 − 3.
  const semEspaco = texto.replace(/\s/g, "").length;
  const soDigito = digitos.length > 0 && digitos.length >= semEspaco * 0.6;
  if (soDigito) {
    // ⚠️ DÍGITO DE MENOS NÃO VIRA BUSCA POR NOME. "058" tem três caracteres e passaria na régua de
    // letras, indo procurar "058" dentro dos nomes — nenhum resultado, e o corretor concluindo que
    // o cliente não tem cadastro quando ele só não terminou de digitar o CPF.
    return digitos.length >= 4 ? { digitos: digitos.slice(0, 11), tipo: "cpf" } : { tipo: "curto" };
  }

  if (texto.length < MINIMO_DE_LETRAS) return { tipo: "curto" };
  return { texto, tipo: "nome" };
}

/**
 * Texto comparável: sem acento, sem caixa, sem espaço repetido.
 *
 * ⚠️ SEM ISTO, "JOAO" NÃO ACHA "João". A base tem nome vindo do C2X em caixa alta e sem acento,
 * nome digitado na CAD com acento, e nome de planilha com espaço duplo — a mesma pessoa escrita de
 * três jeitos. Quem busca digita um quarto.
 */
export function comparavel(valor: null | string): string {
  return String(valor ?? "")
    .normalize("NFD")
    // Os diacríticos combinantes, escritos por código: o intervalo literal é invisível no editor e
    // já chegou a ser quebrado por uma edição automática neste mesmo arquivo.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Este candidato casa com o termo?
 *
 * ⚠️ TODA PALAVRA DO TERMO TEM QUE APARECER, em qualquer ordem. "silva maria" acha "MARIA DA
 * SILVA", que é como as pessoas procuram — sobrenome primeiro quando é o que lembram. Exigir a
 * frase inteira na ordem faria "maria silva" não achar "Maria da Silva", pelo "da" no meio.
 */
export function casa(candidato: CandidatoDaBase, termo: TermoDaBusca): boolean {
  if (termo.tipo === "curto") return false;

  if (termo.tipo === "cpf") {
    return soDigitos(candidato.documento ?? "").startsWith(termo.digitos);
  }

  const nome = comparavel(candidato.nome);
  if (!nome) return false;
  return comparavel(termo.texto)
    .split(" ")
    .every((palavra) => nome.includes(palavra));
}

/**
 * A ordem em que os candidatos aparecem.
 *
 * ⚠️ CREDENCIADO PRIMEIRO, e não alfabético puro: são os únicos que a tela deixa adicionar, e
 * enterrá-los no meio de homônimos sem CAD faz o corretor concluir que "não tem". Depois, nome.
 */
export function ordenar(a: ProponenteEncontrado, b: ProponenteEncontrado): number {
  if (a.credenciado !== b.credenciado) return a.credenciado ? -1 : 1;
  return comparavel(a.nome).localeCompare(comparavel(b.nome), "pt-BR");
}

/**
 * Este CPF já está entre os compradores?
 *
 * ⚠️ COMPARA POR DÍGITOS. O titular vem do banco cru ("52998224725") e o candidato vem formatado
 * ("529.982.247-25"): comparar texto deixaria a MESMA pessoa entrar duas vezes, e a soma das
 * participações fecharia 100% com um comprador repetido — que vira contrato com uma pessoa que não
 * existe.
 */
export function jaEstaNaLista(cpf: string, jaEscolhidos: string[]): boolean {
  const alvo = soDigitos(cpf);
  return jaEscolhidos.some((c) => soDigitos(c) === alvo);
}
