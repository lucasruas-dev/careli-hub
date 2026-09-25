// ⚠️ A PREMISSA NÃO ERA UM LUGAR, ERA UM `useMemo` DENTRO DE UM COMPONENTE.
//
// Nívea (24/09/2026), sobre a proposta 000038 (Vale do Ouro, Quadra 12 · Lote 22, compradora TAISA
// FERNANDA BATISTA): *"Na proposta não está saindo o novo cenário de juros e correção."* Ela havia
// escolhido na tela "Juros % a.m. = 0" e "Correção = poupança anual", o resumo ao lado dizia "sem
// juros, com poupança anual", e o PDF saiu com "Juros 0,7207% a.m." e "Correção IPCA anual".
//
// ⚠️ AFIRMAÇÃO EM CAIXA ALTA: O DEFEITO NÃO ERA DO PAPEL, ERA DA CONTA. Medido no banco em
// 24/09/2026: `select condicoes->'totais', condicoes->'reajustes' from hercules_propostas where
// protocolo_numero = 38` devolve `totais.mensais = R$ 138.130,32` e quatro degraus de reajuste
// (2.595,00 · 2.719,84 · 2.964,61 · 3.231,41, os três últimos corrigidos). Sem juros seriam
// 48 × R$ 2.595,00 = R$ 124.560,00. São R$ 13.570,32 numa venda de R$ 138.401,00 — quase 10% do
// negócio — GRAVADOS, e não só impressos.
//
// ⚠️ E O R$ 2.595,00 DA TELA PARECIA CERTO PORQUE NO SACOC O PRIMEIRO CICLO É AMORTIZAÇÃO PURA
// (`cronograma.ts`, `faixasDeReajuste`): 124.560 ÷ 48 = 2.595,00 COM ou SEM juros. O único número
// que a corretora conferiu é justamente o que coincide nos dois cenários. Do 13º mês em diante eles
// se separam.
//
// A composição "CADASTRO → FAIXA DE PRAZO → o que o corretor escreveu por cima" existia só dentro
// de `modules/incorporador/hercules/SimuladorDeProposta.tsx` (o `useMemo` de `cru`), e por isso nem
// a modal, nem o corpo do pedido, nem a rota conseguiam alcançá-la. Este arquivo é essa composição
// virando peça: uma função pura que os três lados podem chamar e comparar.
//
// ⚠️ ELE NÃO REESCREVE CONTA NENHUMA. Como `aplicarPremissa`, ele troca o OBJETO que entra em
// `montarCronograma`, `taxaMensal` e no PDF. É o que impede o defeito histórico da casa (04/09/2026,
// R$ 2.157,44 no cartão e R$ 1.500,00 no papel): enquanto todo mundo receber o mesmo plano, tela,
// PDF e contrato contam a mesma história.

import {
  type PlanoComercial,
  taxaMensal,
} from "@/lib/apolo/planos-comerciais";
import {
  aplicarPremissa,
  type FaixaDePrazo,
  type PremissaEncontrada,
  premissaDoPrazo,
} from "@/lib/hercules/premissa-do-prazo";
import { sistemaDoCadastro } from "@/lib/hercules/simulacao";

/** Quem decidiu este campo. A ordem de força é cadastro < faixa < corretor. */
export type OrigemDaPremissa = "cadastro" | "corretor" | "faixa";

/**
 * O mínimo que um plano precisa ter para passar por aqui.
 *
 * ⚠️ AS UNIÕES CHEGAM ALARGADAS PARA `string`, de propósito: a rota serializa o plano e JSON não
 * carrega união. `PlanoDaVenda` é esse mesmo `PlanoComercial` alargado, e `taxaMensal` só compara
 * com literais — o `cast` é de tipo, nunca de valor.
 */
export type PlanoParaPremissa = {
  entradaPercentual: number;
  indiceCorrecao: string;
  jurosConvencao: string;
  jurosPeriodicidade: string;
  jurosTaxa: null | number;
  sistemaAmortizacao?: null | string;
};

export type PlanoEfetivo<T> = {
  /**
   * O corretor escreveu juros ou índice por cima? É o que abre a caixa de nota na modal.
   *
   * ⚠️ "POR CIMA DO QUÊ" É A FAIXA, E NÃO O CADASTRO. Quando a faixa de prazo já mandou (o caso do
   * VOC de 1 a 24, sem juros e sem correção), o corretor que deixa tudo como está NÃO alterou nada
   * e não deve nota nenhuma: aquele cenário é cadastro aprovado pela diretoria.
   */
  alteradaPeloCorretor: boolean;
  /** O plano do CADASTRO, intacto — o molde, para depois se distinguir do que foi negociado. */
  doCadastro: null | T;
  indiceDe: OrigemDaPremissa;
  jurosDe: OrigemDaPremissa;
  /** O plano que VALE. Sem faixa e sem alteração, é o mesmo objeto do cadastro, por identidade. */
  plano: null | T;
  /** A faixa que governou este prazo, quando havia uma. */
  premissaDaFaixa: null | PremissaEncontrada;
  /** Já normalizado ("SACOC" → "sacoc"). Nem a faixa nem o corretor mexem nele hoje. */
  sistemaAmortizacao: ReturnType<typeof sistemaDoCadastro>;
  /** A taxa MENSAL do plano efetivo, pela convenção dele. 0 quando não há plano. */
  taxaAoMes: number;
};

/**
 * A taxa que o corretor escreveu, ou nulo quando ele não escreveu nada.
 *
 * ⚠️ TAXA VAZIA VOLTA À PREMISSA, NÃO A ZERO — e esta é a regra mais fácil de quebrar deste
 * arquivo. Apagar o campo é DESFAZER a alteração; para dizer "sem juros" ele escreve 0, e aí é uma
 * alteração de verdade e a nota abre. Um `Number("")` devolve 0 e faria as duas coisas serem a
 * mesma: o campo limpo zeraria os juros de um contrato calado.
 */
function taxaEscrita(bruto: null | number | string | undefined): null | number {
  if (bruto == null) return null;
  if (typeof bruto === "number") {
    return Number.isFinite(bruto) && bruto >= 0 ? bruto : null;
  }
  if (bruto.trim() === "") return null;
  const n = Number(bruto.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * O plano que vale, na ordem: CADASTRO → FAIXA DE PRAZO → o que o corretor escreveu por cima.
 *
 * ⚠️ O CORRETOR É O ÚLTIMO, e é assim que tem que ser: a faixa entrega a premissa "conforme
 * cadastro e alinhamento", e a alteração dele é uma decisão comercial que vence o cadastro — com a
 * nota logo em seguida, que é o preço de poder fazer isso.
 *
 * ⚠️ SEM FAIXA E SEM ALTERAÇÃO, DEVOLVE O MESMO OBJETO, por identidade. É o que deixa quem chama
 * perguntar `efetivo.plano === planoDoCadastro` para saber se houve premissa nenhuma, e é o que
 * mantém `useMemo` sem recalcular à toa num empreendimento sem faixa cadastrada.
 */
export function planoEfetivo<T extends PlanoParaPremissa>(entrada: {
  faixasDePrazo?: null | readonly FaixaDePrazo[];
  indiceSobrescrito?: null | string;
  /** Como o campo entrega ("0,5") ou como o pedido carrega (0.5). Vazio = não mexeu. */
  jurosSobrescrito?: null | number | string;
  parcelas: number;
  plano: null | T | undefined;
}): PlanoEfetivo<T> {
  const doCadastro = entrada.plano ?? null;

  const premissaDaFaixa = premissaDoPrazo(
    entrada.faixasDePrazo ?? [],
    entrada.parcelas,
  );
  const daFaixa =
    (aplicarPremissa(doCadastro as never, premissaDaFaixa) as
      | null
      | T
      | undefined) ?? null;

  const taxa = taxaEscrita(entrada.jurosSobrescrito);
  const mexeuNaTaxa = taxa != null;
  const indice =
    entrada.indiceSobrescrito == null || entrada.indiceSobrescrito === ""
      ? null
      : entrada.indiceSobrescrito;
  const mexeuNoIndice = indice != null;

  const plano =
    daFaixa && (mexeuNaTaxa || mexeuNoIndice)
      ? {
          ...daFaixa,
          ...(mexeuNaTaxa ? { jurosTaxa: taxa } : {}),
          ...(mexeuNoIndice ? { indiceCorrecao: indice } : {}),
        }
      : daFaixa;

  return {
    alteradaPeloCorretor: plano !== daFaixa,
    doCadastro,
    indiceDe: mexeuNoIndice
      ? "corretor"
      : premissaDaFaixa?.indiceCorrecao != null
        ? "faixa"
        : "cadastro",
    // ⚠️ A PERGUNTA É `defineJuros`, E NÃO `jurosTaxa != null` — a mesma armadilha de
    // `aplicarPremissa`. Faixa com `defineJuros` e taxa nula quer dizer SEM JUROS, e é ela quem
    // mandou; ler o nulo como "não opinou" faria a faixa "1 a 12 sem juros" não existir nunca.
    jurosDe: mexeuNaTaxa
      ? "corretor"
      : premissaDaFaixa?.faixa.defineJuros
        ? "faixa"
        : "cadastro",
    plano,
    premissaDaFaixa,
    sistemaAmortizacao: sistemaDoCadastro(plano?.sistemaAmortizacao ?? null),
    taxaAoMes: plano ? taxaMensal(plano as unknown as PlanoComercial) : 0,
  };
}
