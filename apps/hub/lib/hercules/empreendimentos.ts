// A ÁRVORE DE EMPREENDIMENTOS DO HÉRCULES — pai, visões e os números dos cards.
//
// Lucas (02/09/2026): *"ter o empreendimento pai, e os filhos"* · *"o espelho sempre será o pai,
// porque lá que vai morar todos os registros, vendas"* · *"os filhos podem ter visões segmentadas"*.
//
// ⚠️ AS UNIDADES MORAM NO PAI. O pai com id do C2X (o espelho: VLO 35, LAB 31) tem em
// `hercules_unidades` o conjunto INTEIRO; os filhos são recortes desse conjunto (`segmento_id`).
// Somar pai + filhos contaria cada lote duas vezes — foi o que a tabela do Apolo fazia com o Vale do
// Ouro, mostrando VLO, VOC e VOL como três empreendimentos soltos.
//
// ⚠️ PAI SEM ID DO C2X (Lavra do Ouro: LOS + LOU) não tem unidade própria: o conjunto é a união
// das unidades dos filhos, e aí cada filho é dono das suas. As duas regras vivem numa função só,
// `unidadesDoPai`, para a tela e o importador de masterplan somarem igual.
//
// É tudo função pura, sem banco: a tela e o importador recebem as linhas e chamam daqui.

export type SituacaoDaUnidade =
  | "bloqueada"
  | "disponivel"
  | "reservada"
  | "vendida";

export type LinhaDeEmpreendimento = {
  c2xEnterpriseId: null | string;
  cidade: null | string;
  codigo: string;
  id: string;
  nome: string;
  ordem: number;
  paiId: null | string;
  uf: null | string;
  vendendo: boolean;
};

export type UnidadeParaSomar = {
  enterpriseId: string;
  precoTabela: number;
  segmentoId: null | string;
  situacao: SituacaoDaUnidade | string;
};

export type Cards = Record<SituacaoDaUnidade | "total", { unidades: number; valor: number }>;

export type VisaoDoEmpreendimento = LinhaDeEmpreendimento & { cards: Cards };

export type EmpreendimentoPai = LinhaDeEmpreendimento & {
  cards: Cards;
  /** Os filhos = as visões segmentadas. Vazio para empreendimento único (Garden). */
  visoes: VisaoDoEmpreendimento[];
};

const SITUACOES: SituacaoDaUnidade[] = [
  "disponivel",
  "reservada",
  "vendida",
  "bloqueada",
];

function cardsVazios(): Cards {
  const base = { unidades: 0, valor: 0 };
  return {
    bloqueada: { ...base },
    disponivel: { ...base },
    reservada: { ...base },
    total: { ...base },
    vendida: { ...base },
  };
}

/** Soma unidades e valor por situação. Situação desconhecida conta só no total. */
export function somarCards(unidades: UnidadeParaSomar[]): Cards {
  const cards = cardsVazios();
  for (const u of unidades) {
    const valor = Number.isFinite(u.precoTabela) ? u.precoTabela : 0;
    cards.total.unidades += 1;
    cards.total.valor += valor;
    const situacao = SITUACOES.find((s) => s === u.situacao);
    if (situacao) {
      cards[situacao].unidades += 1;
      cards[situacao].valor += valor;
    }
  }
  return cards;
}

/**
 * As unidades de um PAI: as do espelho, quando ele tem id do C2X; senão a união das dos filhos.
 * Sempre sem repetição — é a única forma de o card "Total" bater com o masterplan.
 */
export function unidadesDoPai(
  pai: LinhaDeEmpreendimento,
  filhos: LinhaDeEmpreendimento[],
  unidades: UnidadeParaSomar[],
): UnidadeParaSomar[] {
  if (pai.c2xEnterpriseId) {
    const alvo = pai.c2xEnterpriseId;
    return unidades.filter((u) => u.enterpriseId === alvo);
  }
  const ids = new Set(filhos.map((f) => f.c2xEnterpriseId).filter((x): x is string => Boolean(x)));
  return unidades.filter((u) => ids.has(u.enterpriseId));
}

/**
 * As unidades de uma VISÃO (filho). Se o pai é espelho, o recorte é `segmento_id`; se o pai não
 * tem unidades próprias, a visão é dona das unidades do próprio id do C2X.
 *
 * ⚠️ VISÃO AINDA NÃO SEGMENTADA (importação não rodou) mostra ZERO, e não o conjunto inteiro:
 * mostrar tudo faria o Cecílio ver os lotes do Lino na "visão VOC" — o mesmo vazamento que a
 * memória reference_empreendimento_divisoes_niveis manda evitar.
 */
export function unidadesDaVisao(
  pai: LinhaDeEmpreendimento,
  visao: LinhaDeEmpreendimento,
  unidades: UnidadeParaSomar[],
): UnidadeParaSomar[] {
  if (pai.c2xEnterpriseId) {
    return unidades.filter((u) => u.segmentoId === visao.id);
  }
  return visao.c2xEnterpriseId
    ? unidades.filter((u) => u.enterpriseId === visao.c2xEnterpriseId)
    : [];
}

/**
 * Monta a árvore para a tela inicial do Hércules: um item por pai, com cards e visões.
 * Ordem: quem está vendendo primeiro, depois `ordem`, depois nome.
 */
export function arvoreDeEmpreendimentos(
  linhas: LinhaDeEmpreendimento[],
  unidades: UnidadeParaSomar[],
): EmpreendimentoPai[] {
  const pais = linhas.filter((l) => l.paiId === null);
  const filhosDe = new Map<string, LinhaDeEmpreendimento[]>();
  for (const l of linhas) {
    if (l.paiId === null) continue;
    const lista = filhosDe.get(l.paiId) ?? [];
    lista.push(l);
    filhosDe.set(l.paiId, lista);
  }

  return pais
    .map((pai) => {
      const filhos = [...(filhosDe.get(pai.id) ?? [])].sort(
        (a, b) => a.ordem - b.ordem || a.codigo.localeCompare(b.codigo),
      );
      return {
        ...pai,
        cards: somarCards(unidadesDoPai(pai, filhos, unidades)),
        visoes: filhos.map((f) => ({ ...f, cards: somarCards(unidadesDaVisao(pai, f, unidades)) })),
      };
    })
    .sort(
      (a, b) =>
        Number(b.vendendo) - Number(a.vendendo) ||
        a.ordem - b.ordem ||
        a.nome.localeCompare(b.nome, "pt-BR"),
    );
}

/** Os cards do topo: a soma de todos os pais (sem repetir, porque cada pai já não repete). */
export function cardsConsolidados(arvore: EmpreendimentoPai[]): Cards {
  const total = cardsVazios();
  for (const pai of arvore) {
    for (const chave of [...SITUACOES, "total"] as const) {
      total[chave].unidades += pai.cards[chave].unidades;
      total[chave].valor += pai.cards[chave].valor;
    }
  }
  return total;
}
