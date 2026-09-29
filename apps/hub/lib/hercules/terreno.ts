// O TERRENO: QUAIS LINHAS DE `hercules_unidades` SÃO O MESMO CHÃO — puro, sem banco.
//
// ⚠️ EXTRAÍDO DE `lerSituacaoDasUnidades` (situacao-da-unidade.ts) NA F3 DA FONTE ÚNICA, SEM MUDAR O
// COMPORTAMENTO: a régua da situação passa a importar daqui, com os testes dela verdes. O espelho da
// D4Sign (lib/assinatura/espelho-d4sign/) precisa da MESMA união para achar a venda de um envio do
// C2X: a reserva no pai (VLO) e a venda no filho (VOC/VOL) caem no mesmo terreno. Uma segunda régua
// (a v1 do plano usava `coalesce(espelho_de, id)`) erraria justamente a gleba irmã solta (0.8).
//
// O TERRENO É (empreendimento pai, quadra, lote): a linha do pai, a linha viva para onde ela aponta
// (`espelho_de`) e toda linha viva de uma gleba FILHA daquele pai com a mesma quadra e lote. Por que
// cada pedaço existe está nos comentários de `lerSituacaoDasUnidades`, que continuam lá.

/** O que a união lê de uma linha. */
export type LinhaDoTerreno = {
  enterprise_id: number | string;
  espelho_de: null | string;
  id: string;
  lote: null | string;
  quadra: null | string;
};

/**
 * Quadra ou lote comparável: sem espaço, sem caixa e sem zero à esquerda ("06" e "6" são o mesmo
 * lote). A carga grava "06" hoje; basta uma linha escrita "6" para o terreno se partir em dois, e
 * terreno partido é lote vendido duas vezes.
 */
export function parteDoLote(valor: null | string): string {
  return String(valor ?? "").trim().toUpperCase().replace(/^0+(?=\d)/, "");
}

export function chaveDoLote(ent: string, quadra: null | string, lote: null | string): string {
  return `${ent}|${parteDoLote(quadra)}|${parteDoLote(lote)}`;
}

/**
 * As glebas filhas de cada pai, deduzidas de para onde as linhas do pai apontam.
 *
 * @param doPai As linhas do pai (as que têm `espelho_de`) da família que interessa.
 * @param porId Todas as linhas conhecidas, por id (é por ele que o alvo do `espelho_de` é achado).
 */
export function glebasFilhasDoPai<L extends LinhaDoTerreno>(
  doPai: readonly L[],
  porId: ReadonlyMap<string, L>,
): Map<string, Set<string>> {
  const filhasDoPai = new Map<string, Set<string>>();
  for (const a of doPai) {
    const alvo = a.espelho_de ? porId.get(a.espelho_de) : undefined;
    if (!alvo) continue;
    const filhas = filhasDoPai.get(String(a.enterprise_id)) ?? new Set<string>();
    filhas.add(String(alvo.enterprise_id));
    filhasDoPai.set(String(a.enterprise_id), filhas);
  }
  return filhasDoPai;
}

/**
 * Cada linha cai num terreno: devolve `id → "terreno:<raiz>"` para toda linha de `porId`.
 *
 * ⚠️ OS GRUPOS SE JUNTAM, NUNCA SE SOBRESCREVEM (18/09/2026, achado da revisão). A primeira versão
 * dava a cada linha do pai o próprio grupo e gravava o da linha viva por cima: com duas linhas do
 * pai apontando para a mesma viva, a primeira ficava sozinha com o processo dela e a viva saía
 * livre. Aqui é uma união: tudo que se liga (pai → viva, pai → gleba com a mesma quadra e lote)
 * termina no mesmo terreno, em qualquer ordem de leitura.
 */
export function unirTerrenos<L extends LinhaDoTerreno>(
  porId: ReadonlyMap<string, L>,
  doPai: readonly L[],
  filhasDoPai: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, string> {
  const raiz = new Map<string, string>();
  const acharRaiz = (id: string): string => {
    let r = id;
    while (raiz.has(r) && raiz.get(r) !== r) r = raiz.get(r) as string;
    raiz.set(id, r);
    return r;
  };
  const juntar = (a: string, b: string) => {
    const ra = acharRaiz(a);
    const rb = acharRaiz(b);
    if (ra !== rb) raiz.set(rb, ra);
  };
  const linhasDoLote = new Map<string, string[]>();
  for (const l of porId.values()) {
    if (l.espelho_de) continue;
    const chave = chaveDoLote(String(l.enterprise_id), l.quadra, l.lote);
    linhasDoLote.set(chave, [...(linhasDoLote.get(chave) ?? []), l.id]);
  }
  for (const a of doPai) {
    if (a.espelho_de) juntar(a.id, a.espelho_de);
    for (const filha of filhasDoPai.get(String(a.enterprise_id)) ?? []) {
      for (const viva of linhasDoLote.get(chaveDoLote(filha, a.quadra, a.lote)) ?? []) juntar(a.id, viva);
    }
  }
  const grupoDe = new Map<string, string>();
  for (const l of porId.values()) grupoDe.set(l.id, `terreno:${acharRaiz(l.id)}`);
  return grupoDe;
}

/**
 * Atalho para quem JÁ TEM a tabela inteira na mão (o espelho da D4Sign): as linhas do pai são as que
 * têm `espelho_de`, e a união sai de uma vez.
 *
 * ⚠️ `lerSituacaoDasUnidades` NÃO USA ESTE ATALHO: ela lê só a família dos empreendimentos pedidos e
 * busca as glebas irmãs no meio do caminho, então chama as duas peças de cima em separado.
 */
export function terrenosDasUnidades<L extends LinhaDoTerreno>(linhas: Iterable<L>): Map<string, string> {
  const porId = new Map<string, L>();
  for (const l of linhas) porId.set(l.id, l);
  const doPai = [...porId.values()].filter((l) => Boolean(l.espelho_de));
  return unirTerrenos(porId, doPai, glebasFilhasDoPai(doPai, porId));
}
