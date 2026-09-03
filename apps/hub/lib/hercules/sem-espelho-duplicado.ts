// O ESPELHO SAI QUANDO OS FILHOS ESTÃO NA MESA.
//
// ⚠️ POR QUE ISSO EXISTE, na palavra do Lucas (03/09/2026): *"o Pai sempre será a nossa referência
// para tudo, o filho são recortes, visões do pai (...) eu peguei o pai e subdividi ele pois na hora
// de emitir os boletos teria que sair de contas separadas. No C2X não tínhamos essa divisão tão bem
// arquitetada, por isso criávamos outros empreendimentos: era nossa gambiarra"*.
//
// A gambiarra deixou rastro: no C2X, o Vale do Ouro existe QUATRO vezes. O VLO (o espelho) tem 298
// unidades e 165 propostas PRÓPRIAS, e VOC + VOL + VOR têm 301 unidades e 379 propostas — dos
// MESMOS lotes. As 114 unidades do espelho marcadas "vendida" não têm proposta nenhuma, nem
// cancelada: a venda de verdade foi registrada na unidade nova do filho, e o lote do espelho só foi
// marcado para sair da oferta.
//
// ⚠️ ENTÃO SOMAR PAI E FILHOS CONTA CADA VENDA DUAS VEZES. Quem escolhe um produto no filtro já
// está protegido (`expandirIdDoPainel`: pai com filho devolve só os filhos). Quem abre em "todos os
// empreendimentos" NÃO estava: o consolidado somava os quatro, e o VGV faturado do Vale do Ouro
// aparecia R$ 1,5 mi maior do que é.
//
// ⚠️ E O CRITÉRIO É "TEM FILHO NO ESCOPO", não "tem filho cadastrado". Um pai cujos filhos ainda
// não foram cadastrados (ou que a sessão não autoriza) continua respondendo pelos próprios
// números — é ele quem tem o dado, e tirá-lo deixaria o empreendimento inteiro fora da tela.

/** O mínimo que o cadastro precisa dizer para esta regra decidir. */
export type EmpreendimentoNaArvore = {
  c2xEnterpriseId: null | string;
  codigo: string;
  id: string;
  paiId: null | string;
};

/**
 * O que TIRAR do escopo: os espelhos cujos filhos também estão lá.
 *
 * Devolve os dois formatos, porque as duas leituras da tela filtram por chaves diferentes: as
 * propostas por CÓDIGO (`empreendimento_codigo`) e as unidades por ID do C2X (`enterprise_id`).
 * Esquecer um dos dois deixaria metade da duplicação viva — e a metade que sobra é justamente a
 * que aparece na grade.
 */
export function espelhosADescartar(
  cadastro: EmpreendimentoNaArvore[],
  noEscopo: { codigos: Iterable<string>; idsDoC2x: Iterable<string> },
): { codigos: Set<string>; idsDoC2x: Set<string> } {
  const codigosNoEscopo = new Set([...noEscopo.codigos].map((c) => c.trim().toUpperCase()));
  const idsNoEscopo = new Set([...noEscopo.idsDoC2x].map((i) => String(i).trim()));

  const fora = { codigos: new Set<string>(), idsDoC2x: new Set<string>() };

  for (const pai of cadastro) {
    if (pai.paiId !== null) continue;

    const filhos = cadastro.filter((linha) => linha.paiId === pai.id);
    if (filhos.length === 0) continue;

    const algumFilhoNaMesa = filhos.some(
      (f) =>
        codigosNoEscopo.has(f.codigo.trim().toUpperCase()) ||
        (f.c2xEnterpriseId !== null && idsNoEscopo.has(f.c2xEnterpriseId.trim())),
    );
    if (!algumFilhoNaMesa) continue;

    fora.codigos.add(pai.codigo.trim().toUpperCase());
    if (pai.c2xEnterpriseId) fora.idsDoC2x.add(pai.c2xEnterpriseId.trim());
  }

  return fora;
}

/** Atalho: a lista sem os espelhos que os filhos já cobrem. */
export function semEspelhoDuplicado<T extends string>(
  valores: readonly T[],
  descartar: Set<string>,
): T[] {
  return valores.filter((v) => !descartar.has(String(v).trim().toUpperCase()));
}
