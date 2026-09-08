import { PAPEIS, type PapelNoContrato, type Signatario } from "./tipos";

// A ORDEM DE ASSINATURA — quem assina primeiro, e quem espera.
//
// Lucas, 07/09/2026: *"eu uso bastante a ordem de assinatura, ou seja, temos que ter isso também —
// de ter ou não a ordem; se ter, eu apontar essa ordem. (não sei onde isso ia existir) se é na
// geração, ou deixa fixo por empreendimento. Só sei que isso hoje traz um trabalho enorme para
// gente, pois fazemos isso de forma manual."*
//
// ⚠️ O TRABALHO MANUAL É O PROBLEMA A RESOLVER, e ele não é digitar: é LEMBRAR. Hoje alguém abre o
// D4Sign a cada contrato e numera os signatários um por um. Errar a ordem não trava nada — o
// contrato sai, o cliente assina antes da vendedora, e só se descobre quando o jurídico confere.
//
// ── ONDE A REGRA MORA ────────────────────────────────────────────────────────
//
// Na CATEGORIA, com queda para o empreendimento — a mesma cadeia da minuta (0140) e da vendedora
// (0141):
//
//     unidade → categoria → regra de ordem          o recorte que assina diferente
//              ↘ sem categoria → o empreendimento   o caso de todo dia
//
// ⚠️ POR QUE NÃO NA GERAÇÃO, que foi a outra hipótese do Lucas. Porque na geração a pergunta volta a
// cada contrato, e é exatamente aí que se erra por pressa. A ordem de assinatura de um produto não
// muda de venda para venda: ela muda quando o incorporador muda de política — e aí muda para todos
// os contratos daquele produto de uma vez, que é o comportamento certo.
//
// ⚠️ E POR QUE POR PAPEL, e não por pessoa. Quem assina muda a cada venda (outro comprador, outro
// cônjuge, às vezes três compradores); o que NÃO muda é "a vendedora assina depois dos compradores".
// Uma lista de pessoas envelheceria no primeiro contrato; uma lista de papéis vale para a carteira
// inteira.

/**
 * A regra de ordem de um recorte.
 *
 * ⚠️ `ordenada: false` NÃO É "SEM REGRA", é uma decisão: todos assinam ao mesmo tempo. Os dois
 * provedores tratam isso como ordem 0 para todo mundo, e é o que a maioria dos contratos usa hoje.
 */
export type RegraDeOrdem = {
  ordenada: boolean;
  /** Os papéis, do primeiro ao último. Papel que não está aqui assina por último. */
  papeis: PapelNoContrato[];
};

/**
 * O padrão da casa, quando ninguém configurou nada.
 *
 * É a ordem que o Lucas faz hoje na mão, e ela tem uma lógica: o COMPRADOR assina primeiro porque é
 * ele que pode desistir — colher a assinatura da vendedora antes gastaria a formalidade do lado de
 * cá num contrato que talvez não aconteça. As TESTEMUNHAS vão por último porque testemunham um
 * documento já assinado pelas partes.
 *
 * ⚠️ MAS O PADRÃO NASCE DESLIGADO (`ordenada: false`). Ligar a ordem em toda a carteira de uma vez
 * mudaria o comportamento de contratos que hoje saem em paralelo, sem ninguém ter pedido — e o
 * sintoma seria contrato "parado" esperando alguém que antes assinava a qualquer hora.
 */
export const ORDEM_PADRAO: RegraDeOrdem = {
  ordenada: false,
  papeis: [...PAPEIS],
};

/**
 * Distribui a ordem entre quem assina.
 *
 * ⚠️ MESMO PAPEL, MESMO NÚMERO. Três compradores assinam em paralelo entre si e todos antes da
 * vendedora — pôr um comprador para esperar o outro é o que transforma uma venda de casal numa fila
 * de dois dias. Os dois provedores entendem número repetido como "ao mesmo tempo".
 *
 * ⚠️ E OS NÚMEROS SÃO COMPACTADOS. Se o contrato não tem cônjuge nem corretor, os papéis presentes
 * viram 1, 2, 3 — e não 1, 3, 6. A Clicksign aceita buracos, o D4Sign se confunde com eles, e a
 * ordem que a tela mostra passaria a ter degraus que não significam nada.
 *
 * ⚠️ PAPEL FORA DA REGRA ASSINA POR ÚLTIMO, e não primeiro. Um papel novo (um interveniente que a
 * regra antiga não previa) esperando o resto é seguro; ele na frente da vendedora não é.
 */
export function ordenarSignatarios(
  pessoas: Omit<Signatario, "ordem">[],
  regra: RegraDeOrdem = ORDEM_PADRAO,
): Signatario[] {
  if (!regra.ordenada) return pessoas.map((p) => ({ ...p, ordem: 0 }));

  const posicao = (papel: PapelNoContrato): number => {
    const i = regra.papeis.indexOf(papel);
    return i < 0 ? regra.papeis.length : i;
  };

  // Os papéis que ESTÃO neste contrato, na ordem da regra. É o que compacta os números.
  const presentes = [...new Set(pessoas.map((p) => p.papel))].sort((a, b) => posicao(a) - posicao(b));
  const numero = new Map(presentes.map((papel, i) => [papel, i + 1]));

  return pessoas.map((p) => ({ ...p, ordem: numero.get(p.papel) ?? presentes.length }));
}

/**
 * A regra, lida do que está gravado — na categoria, ou no empreendimento.
 *
 * ⚠️ TOLERA O JSONB SUJO DE PROPÓSITO. A coluna guarda uma lista de papéis, e um papel que saiu do
 * código (renomeado, removido) continuaria gravado lá. Descartar o desconhecido e completar o que
 * falta é melhor do que recusar a regra inteira: uma regra recusada faria o contrato voltar
 * silenciosamente ao paralelo, que é justamente o trabalho manual que isto veio eliminar.
 */
export function lerRegraDeOrdem(cru: unknown): RegraDeOrdem {
  if (!cru || typeof cru !== "object") return ORDEM_PADRAO;

  const bruto = cru as { ordenada?: unknown; papeis?: unknown };
  const listados = Array.isArray(bruto.papeis)
    ? bruto.papeis.filter((x): x is PapelNoContrato => PAPEIS.includes(x as PapelNoContrato))
    : [];

  // Sem repetir, e completando com os que faltaram — na ordem canônica.
  const vistos = new Set(listados);
  const papeis = [...new Set(listados), ...PAPEIS.filter((p) => !vistos.has(p))];

  return { ordenada: bruto.ordenada === true, papeis };
}

/** A regra em uma linha, para a tela. */
export function descreverRegra(regra: RegraDeOrdem, rotulo: (p: PapelNoContrato) => string): string {
  if (!regra.ordenada) return "Todos assinam ao mesmo tempo.";
  return regra.papeis.map(rotulo).join(" → ");
}
