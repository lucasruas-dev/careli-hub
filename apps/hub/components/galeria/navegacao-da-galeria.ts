// A NAVEGAÇÃO DO VISUALIZADOR DE MÍDIA — as contas, sem tela.
//
// Fica fora do componente para ser testada sem React e para qualquer galeria da casa (produto,
// anexos do Hermes, fotos da Iris) andar do mesmo jeito: a última foto leva à primeira, e o
// contador diz "3 de 12", nunca "índice 2".

/** O índice depois de andar `passo` casas, dando a volta nas pontas. */
export function indiceVizinho(indice: number, total: number, passo: number): number {
  if (!Number.isInteger(total) || total <= 0) return 0;
  const atual = Number.isInteger(indice) ? indice : 0;
  return (((atual + Math.trunc(passo)) % total) + total) % total;
}

/** "3 de 12" — em base 1, como a pessoa conta. */
export function contadorDaGaleria(indice: number, total: number): string {
  if (!Number.isInteger(total) || total <= 0) return "";
  const atual = Math.min(Math.max(0, Math.trunc(indice)), total - 1);
  return `${atual + 1} de ${total}`;
}

/**
 * O gesto de arrastar vira troca de mídia? Devolve o passo (+1 próxima, -1 anterior) ou 0.
 *
 * ⚠️ SÓ O ARRASTO HORIZONTAL CLARO CONTA: 50 px no mínimo e mais horizontal que vertical. Sem a
 * segunda condição, rolar a legenda ou puxar a página no celular trocaria a foto no meio da
 * conversa com o cliente.
 */
export function passoDoArrasto(dx: number, dy: number, minimo = 50): -1 | 0 | 1 {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return 0;
  if (Math.abs(dx) < minimo || Math.abs(dx) <= Math.abs(dy) * 1.5) return 0;
  // Arrastar para a ESQUERDA traz a próxima, como em toda galeria de celular.
  return dx < 0 ? 1 : -1;
}
