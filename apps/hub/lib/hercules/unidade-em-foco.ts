// QUAL LOTE A FICHA ESTÁ MOSTRANDO.
//
// ⚠️ ISTO É PURO PORQUE JÁ ERROU DUAS VEZES NO MESMO DIA, das duas pontas:
//
//  1. O RETRATO ENVELHECIA. O `foco` guarda o OBJETO da unidade como ela estava no clique, e nada
//     o ressincronizava depois que a tela recarregava. Quem reservava, gerava a proposta e voltava
//     a olhar a MESMA ficha via o mapa repintado e a trilha em "Proposta", mas o chip continuava
//     dizendo "Reserva" e o botão continuava oferecendo "Cancelar reserva" — que respondia 409
//     apontando para um botão que a tela não mostrava.
//
//  2. A LISTA NÃO CHEGAVA NA UNIDADE. Clicar numa linha do analítico foca uma PROPOSTA, não um
//     lote, e a ficha abria com os quatro botões apagados dizendo "Escolha uma unidade" — numa tela
//     que estava mostrando o cliente, o valor e o histórico daquele lote. Pela grade funcionava.
//     A diferença não tinha explicação nenhuma para quem usa.
//
// A regra é uma frase: o mapa recém-carregado manda; o retrato do clique é o fallback; e as duas
// portas (grade e lista) levam ao mesmo lote, porque a proposta carrega o `unidadeId`.

/** O mínimo que esta decisão precisa saber de uma unidade. */
export type UnidadeIdentificavel = { id: string };

/** O mínimo que ela precisa saber do foco. */
export type FocoDaFicha<U extends UnidadeIdentificavel> =
  | null
  | { proposta: { unidadeId: null | string }; tipo: "proposta" }
  | { tipo: "unidade"; unidade: U };

/** O id do lote que a ficha deve mostrar, venha o clique da grade ou da lista. */
export function idDaUnidadeEmFoco(foco: FocoDaFicha<UnidadeIdentificavel>): null | string {
  if (!foco) return null;
  if (foco.tipo === "unidade") return foco.unidade.id;
  return foco.proposta.unidadeId ?? null;
}

/**
 * A unidade que a ficha mostra: a versão FRESCA do mapa, com o retrato do clique de reserva.
 *
 * ⚠️ O FALLBACK SÓ VALE PARA O CLIQUE NA GRADE. Pela lista não há retrato nenhum — se a unidade não
 * está no mapa carregado (outro produto, outro recorte), não há o que mostrar, e devolver algo
 * inventado seria pior do que devolver nada.
 */
export function unidadeEmFoco<U extends UnidadeIdentificavel>(
  foco: FocoDaFicha<U>,
  unidadesDoMapa: U[],
): null | U {
  const id = idDaUnidadeEmFoco(foco);
  if (!id) return null;

  const fresca = unidadesDoMapa.find((u) => u.id === id);
  if (fresca) return fresca;

  return foco && foco.tipo === "unidade" ? foco.unidade : null;
}
