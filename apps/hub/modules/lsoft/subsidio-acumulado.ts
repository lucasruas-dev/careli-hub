import type { LiberacaoDaCaixa } from "@/lib/lsoft/classificacao";

/**
 * O acumulado de cada medição da Caixa, contado da PRIMEIRA liberação em diante.
 *
 * ⚠️ A LISTA CHEGA DO MAIS NOVO PARA O MAIS ANTIGO — é a ordem que a tela quer mostrar (a última
 * medição primeiro). Mas "acumulado" só faz sentido na ordem cronológica: por isso soma-se de trás
 * para frente e devolve-se na ordem original. Somar direto na ordem de exibição daria o acumulado
 * invertido, e o erro passaria batido porque os dois extremos batem com o total.
 */
export function acumularLiberacoes(
  liberacoes: LiberacaoDaCaixa[],
): (LiberacaoDaCaixa & { acumulado: number })[] {
  let total = 0;
  return [...liberacoes]
    .reverse()
    .map((liberacao) => {
      total += liberacao.valor;
      return { ...liberacao, acumulado: total };
    })
    .reverse();
}
