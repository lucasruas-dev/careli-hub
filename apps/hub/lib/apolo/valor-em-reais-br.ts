// O VALOR EM REAIS NO FORMATO BRASILEIRO ESTRITO — a única régua que lê o que a coordenação digita
// na conferência da corretagem. Pura, sem servidor: a rota (`conferencia-corretagem`) e o painel do
// extrato usam esta MESMA função, para o que a tela mostra na confirmação ser exatamente o que a
// rota vai gravar.
//
// ⚠️ PONTO É SEMPRE MILHAR, VÍRGULA É SEMPRE DECIMAL (achado da revisão da Publicação, 01/10/2026).
// A primeira leitura tratava "7.000" como milhar só quando havia vírgula; sem ela, o ponto virava
// decimal e "7.000" gravava R$ 7,00, "R$ 12.500" gravava R$ 12,50 e "3.500" gravava R$ 3,50, tudo
// com 200, num número que depois sai impresso no papel do cliente. A ambiguidade não tem leitura
// segura (para o inglês, "7.000" também é sete), então o formato é um só e o resto é RECUSADO com a
// frase do formato esperado, em vez de adivinhado.
//
// Aceito: "R$" e espaços opcionais na frente, depois
//   com milhar ... 1 a 3 dígitos, grupos de ".ddd", e vírgula com 1 ou 2 casas opcional
//                  ("7.000", "12.500", "7.000,50", "1.000.000,00")
//   sem milhar ... só dígitos, e vírgula com 1 ou 2 casas opcional ("7000", "7000,5")
// Recusado: "7.5", "7.00", "7000.50", "7,000.50", "7.000.5", "7,", ",50", "7.00,00", "1.0000",
// vazio, negativo e mais de 2 casas.
//
// Número JSON (`typeof number`) é inequívoco e entra se for finito, positivo e com no máximo 2 casas.
// O teto é o do `numeric(12,2)` da coluna (menor que 10^10); o teto do preço do lote é da rota.

import { dinheiro } from "@/lib/apolo/extrato-cliente";
import { dinheiroPorExtenso } from "@/lib/temis/por-extenso";

/** A frase que o painel e a rota mostram quando o valor não é legível. */
export const FRASE_DO_FORMATO_DO_VALOR =
  "Não entendi o valor. Use o formato brasileiro, ex.: 7.000,50 (ponto separa o milhar e vírgula separa os centavos).";

const COM_MILHAR = /^\d{1,3}(\.\d{3})+(,\d{1,2})?$/;
const SEM_MILHAR = /^\d+(,\d{1,2})?$/;

/** O limite exclusivo do `numeric(12,2)`: 10 dígitos inteiros. */
const TETO_DA_COLUNA = 1e10;

/** O valor em reais (positivo, até 2 casas), ou `null` se não for um valor utilizável. */
export function lerValorEmReaisBr(valor: unknown): null | number {
  let numero: number;

  if (typeof valor === "number") {
    if (!Number.isFinite(valor)) return null;
    // No máximo 2 casas: 7.005 é recusado (o número JSON não tem como dizer qual centavo foi lido).
    const emCentavos = Math.round(valor * 100);
    if (Math.abs(emCentavos - valor * 100) >= 1e-6) return null;
    numero = valor;
  } else if (typeof valor === "string") {
    const bruto = valor.trim().replace(/^R\$\s*/i, "").trim();
    if (!COM_MILHAR.test(bruto) && !SEM_MILHAR.test(bruto)) return null;
    // A regex já garante no máximo 2 casas; o arredondamento só tira o ruído do ponto flutuante.
    numero = Math.round(Number(bruto.replace(/\./g, "").replace(",", ".")) * 100) / 100;
  } else {
    return null;
  }

  if (!Number.isFinite(numero) || numero <= 0 || numero >= TETO_DA_COLUNA) return null;
  return numero;
}

/** O teto da observação da conferência: o do CHECK da 0202, da rota e do `maxLength` do painel. */
export const LIMITE_DA_OBSERVACAO_DA_CONFERENCIA = 1000;

export type ResultadoDaConferencia = "com_corretagem" | "sem_corretagem";

/**
 * O resultado da conferência escrito para a coordenação ler antes de confirmar e depois de gravar:
 * "houve corretagem de R$ 7.000,00 (sete mil reais)" ou "não houve corretagem".
 *
 * ⚠️ O VALOR POR EXTENSO ESTÁ AQUI PARA QUEM CONFIRMA NÃO ERRAR UM ZERO (01/10/2026): "7.000" e
 * "70.000" parecem iguais de relance, "sete mil reais" e "setenta mil reais" não. É a mesma função
 * (`dinheiroPorExtenso`, pura) que escreve os valores dos contratos.
 */
export function descreverConferencia(
  resultado: ResultadoDaConferencia,
  valor: null | number,
): string {
  if (resultado === "sem_corretagem") return "não houve corretagem";
  // ⚠️ "HOUVE" SEM VALOR NUNCA VIRA "NÃO HOUVE": seria dizer o contrário do que foi registrado.
  if (valor === null) return "houve corretagem (valor não informado)";
  // O Intl separa o "R$" do número com espaço sem quebra; na frase da tela vai um espaço comum.
  const formatado = dinheiro(valor).replace(/\u00a0/g, " ");
  return `houve corretagem de ${formatado} (${dinheiroPorExtenso(valor)})`;
}
