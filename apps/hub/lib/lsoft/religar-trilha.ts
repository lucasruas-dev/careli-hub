import { digitalDaParcela } from "./impressao-digital";

// RELIGAR A TRILHA DE EDIÇÃO ÀS PARCELAS NOVAS, depois de uma carga do LSoft.
//
// A carga apaga `lsoft_parcelas` e regrava com ids novos. Desde a migration 0188 a trilha não morre
// mais junto (a FK virou `SET NULL`): ela fica ÓRFÃ, com `parcela_id` nulo, guardando a impressão
// digital e o retrato da parcela no momento da edição. Esta função decide, para cada linha órfã,
// qual parcela nova é a mesma parcela de antes.
//
// ⚠️ É PURA DE PROPÓSITO: recebe as linhas e as parcelas, devolve o plano. Quem lê e grava é o
// script (`scripts/lsoft/reconciliar-trilha.mjs`). Separar assim é o que permite provar os casos
// difíceis em teste, sem precisar rodar uma carga de verdade para descobrir que a baixa foi parar
// no lote do vizinho.
//
// ⚠️ A DIFERENÇA PARA A CLASSIFICAÇÃO (reconciliar-classificacao.mjs): lá cada parcela tem no máximo
// UMA marca; aqui a mesma parcela tem VÁRIAS linhas (uma baixa grava três: paga, valor_recebido,
// data_recebido). Por isso a unidade de trabalho não é a linha, é o GRUPO de linhas que falavam da
// mesma parcela antiga. O grupo inteiro vai para a mesma parcela nova, ou fica inteiro órfão.
//
// ⚠️ NENHUMA REDE ADIVINHA, e aqui isso é mais estrito que na classificação. A trilha não guarda a
// observação da parcela, e é a observação ("LOTE 22 QUADRA 13") que separa dois lotes do mesmo
// cliente com o mesmo valor e o mesmo vencimento. Então, fora da digital exata, uma rede só aceita
// candidata ÚNICA. Havendo duas, o grupo fica órfão e é relatado: abater a baixa no lote errado é
// pior do que deixá-la esperando alguém olhar. Medido em 24/09/2026: zero das 160 parcelas com
// trilha tinham gêmea, mas a categoria 17 vai trazer apartamentos do mesmo valor aos montes.

/** A linha da trilha como o script a lê do banco. */
export type LinhaDaTrilha = {
  cliente_codigo: string;
  empreendimento_no_momento: null | string;
  id: string;
  impressao_digital: null | string;
  ordinal: null | number;
  parcela_id: null | string;
  valor_no_momento: null | number | string;
  vencimento_no_momento: null | string;
};

/** A parcela nova, como a carga acabou de gravar. */
export type ParcelaNova = {
  cliente_codigo: string;
  empreendimento: string;
  id: string;
  observacoes: null | string;
  origem: string;
  parcela: null | string;
  valor: number | string;
  vencimento: null | string;
};

export type Via = "digital" | "vencimentoEValor" | "soValor";

export type PlanoDeReligamento = {
  /** Uma entrada por LINHA da trilha a atualizar. */
  atualizacoes: Array<{ id: string; parcela_id: string; via: Via }>;
  contagem: {
    /** Grupos (parcelas antigas) cuja parcela ainda existia: nada a fazer. */
    jaLigados: number;
    religadosPorDigital: number;
    religadosPorVencimentoEValor: number;
    religadosSoPorValor: number;
    /** Grupos sem par seguro. As linhas continuam órfãs. */
    orfaos: number;
  };
  /** Os grupos que ficaram sem par, para o relatório. */
  orfaos: Array<{ chave: string; linhas: number; motivo: string }>;
};

const txt = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const dinheiro = (v: unknown): string => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : txt(v);
};

/**
 * A identidade da parcela ANTIGA a que um grupo de linhas se refere.
 *
 * ⚠️ NÃO É SÓ A DIGITAL. Duas parcelas genuinamente idênticas têm a mesma digital, e quem as separa
 * é o ordinal. E a mesma digital pode aparecer com retratos diferentes se a linha foi editada em
 * dias distintos; o retrato é que diz o que a parcela era.
 */
function chaveDoGrupo(l: LinhaDaTrilha): string {
  return [
    txt(l.impressao_digital),
    String(Math.max(Number(l.ordinal) || 1, 1)),
    txt(l.cliente_codigo),
    txt(l.empreendimento_no_momento),
    txt(l.vencimento_no_momento),
    dinheiro(l.valor_no_momento),
  ].join("¦");
}

function indexar(parcelas: ParcelaNova[], chave: (p: ParcelaNova) => string): Map<string, ParcelaNova[]> {
  const mapa = new Map<string, ParcelaNova[]>();
  for (const p of parcelas) {
    const k = chave(p);
    const lista = mapa.get(k);
    if (lista) lista.push(p);
    else mapa.set(k, [p]);
  }
  // Ordem estável por id: é a mesma régua do ordinal na classificação e na gravação.
  for (const lista of mapa.values()) lista.sort((a, b) => a.id.localeCompare(b.id));
  return mapa;
}

/**
 * O plano de religamento: qual parcela nova recebe cada linha órfã da trilha.
 *
 * Três redes, da mais estrita à mais frouxa:
 *   1. a digital exata mais o ordinal: nada mudou na parcela;
 *   2. cliente + empreendimento + vencimento + valor, SÓ SE ÚNICA: a parcela foi paga entre as
 *      cargas (a `origem` virou "recebido" e a digital mudou) ou a observação foi corrigida;
 *   3. cliente + empreendimento + valor, SÓ SE ÚNICA: o vencimento também mudou.
 */
export function planejarReligamentoDaTrilha(linhas: LinhaDaTrilha[], parcelas: ParcelaNova[]): PlanoDeReligamento {
  const vivas = new Set(parcelas.map((p) => p.id));

  const porDigital = indexar(parcelas, (p) => digitalDaParcela(p));
  const porVencimentoEValor = indexar(parcelas, (p) =>
    [txt(p.cliente_codigo), txt(p.empreendimento), txt(p.vencimento), dinheiro(p.valor)].join("¦"),
  );
  const soPorValor = indexar(parcelas, (p) =>
    [txt(p.cliente_codigo), txt(p.empreendimento), dinheiro(p.valor)].join("¦"),
  );

  // Só a trilha de PARCELA entra. A do cadastro não tem digital e nunca perdeu o alvo: o importador
  // faz upsert de clientes por código, sem apagar.
  const deParcela = linhas.filter((l) => l.impressao_digital);

  // Agrupa por parcela antiga. Um grupo é "já ligado" se QUALQUER linha dele ainda aponta para uma
  // parcela viva: esse é o alvo do grupo inteiro, e ele reserva a parcela antes das religações.
  const grupos = new Map<string, LinhaDaTrilha[]>();
  for (const l of deParcela) {
    const k = chaveDoGrupo(l);
    const g = grupos.get(k);
    if (g) g.push(l);
    else grupos.set(k, [l]);
  }

  const usadas = new Set<string>();
  const alvoDoGrupo = new Map<string, string>();

  // ⚠️ RESERVA ANTES DE RELIGAR, como na classificação: sem isto um grupo órfão poderia tomar a
  // parcela de um grupo sadio que só seria visitado depois.
  for (const [k, g] of grupos) {
    const viva = g.find((l) => l.parcela_id && vivas.has(l.parcela_id));
    if (viva?.parcela_id) {
      alvoDoGrupo.set(k, viva.parcela_id);
      usadas.add(viva.parcela_id);
    }
  }

  const plano: PlanoDeReligamento = {
    atualizacoes: [],
    contagem: {
      jaLigados: alvoDoGrupo.size,
      orfaos: 0,
      religadosPorDigital: 0,
      religadosPorVencimentoEValor: 0,
      religadosSoPorValor: 0,
    },
    orfaos: [],
  };

  const unicaLivre = (lista: ParcelaNova[] | undefined): null | ParcelaNova => {
    const livres = (lista ?? []).filter((p) => !usadas.has(p.id));
    return livres.length === 1 ? (livres[0] ?? null) : null;
  };

  for (const [k, g] of grupos) {
    const jaTem = alvoDoGrupo.get(k);
    if (jaTem) {
      // Linhas do mesmo grupo que perderam o alvo (editadas antes de uma carga parcial) voltam para
      // a parcela que o resto do grupo já aponta.
      for (const l of g) {
        if (l.parcela_id !== jaTem) plano.atualizacoes.push({ id: l.id, parcela_id: jaTem, via: "digital" });
      }
      continue;
    }

    // Um grupo nasce com a primeira linha (push), então nunca é vazio; a guarda existe para o tipo.
    const modelo = g[0];
    if (!modelo) continue;
    const ordinal = Math.max(Number(modelo.ordinal) || 1, 1);
    let achada: null | ParcelaNova = null;
    let via: Via = "digital";

    // Rede 1: a digital exata. Aqui o ordinal escolhe entre gêmeas genuínas, porque a digital
    // inteira bateu: não é chute, é a mesma posição que a gravação usou.
    //
    // ⚠️ A POSIÇÃO É ENTRE TODAS AS GÊMEAS, NUNCA ENTRE AS LIVRES. A gravação calcula o ordinal na
    // lista completa ordenada por id (carteira.ts). Contar só as livres desloca o índice: com três
    // gêmeas e a primeira já religada, o ordinal 2 apontaria para a TERCEIRA. E sem "puxar para a
    // última" quando o ordinal passa do tamanho: se a gêmea 2 foi paga e sua digital mudou, a
    // trilha dela não pode cair na gêmea 1. Ela desce para as redes seguintes, que exigem único.
    const todasDaDigital = porDigital.get(txt(modelo.impressao_digital)) ?? [];
    const naPosicao = todasDaDigital[ordinal - 1];
    if (naPosicao && !usadas.has(naPosicao.id)) achada = naPosicao;

    if (!achada && modelo.vencimento_no_momento) {
      achada = unicaLivre(
        porVencimentoEValor.get(
          [
            txt(modelo.cliente_codigo),
            txt(modelo.empreendimento_no_momento),
            txt(modelo.vencimento_no_momento),
            dinheiro(modelo.valor_no_momento),
          ].join("¦"),
        ),
      );
      via = "vencimentoEValor";
    }

    if (!achada) {
      achada = unicaLivre(
        soPorValor.get(
          [txt(modelo.cliente_codigo), txt(modelo.empreendimento_no_momento), dinheiro(modelo.valor_no_momento)].join(
            "¦",
          ),
        ),
      );
      via = "soValor";
    }

    if (!achada) {
      plano.contagem.orfaos += 1;
      plano.orfaos.push({
        chave: `${txt(modelo.cliente_codigo)} · ${txt(modelo.empreendimento_no_momento)} · venc ${txt(
          modelo.vencimento_no_momento,
        )} · R$ ${dinheiro(modelo.valor_no_momento)}`,
        linhas: g.length,
        motivo: "nenhuma parcela nova casa com segurança (sumiu, ou tem gêmea que a trilha não sabe separar)",
      });
      continue;
    }

    usadas.add(achada.id);
    if (via === "digital") plano.contagem.religadosPorDigital += 1;
    else if (via === "vencimentoEValor") plano.contagem.religadosPorVencimentoEValor += 1;
    else plano.contagem.religadosSoPorValor += 1;

    for (const l of g) plano.atualizacoes.push({ id: l.id, parcela_id: achada.id, via });
  }

  return plano;
}
