// AS VENDAS DO EMPREENDIMENTO, NA LÍNGUA DO DONO DELE.
//
// A leitura é a MESMA da aba Vendas do Apolo (`loadApoloEnterpriseVendas`): os seis estágios do
// funil interno, saídos dos onze do C2X. O que muda aqui é o vocabulário e o recorte.
//
// ⚠️ POR QUE DOBRAR OS SEIS EM QUATRO. O operador da Careli precisa saber se a unidade está em
// "Proposta emitida", "Contrato gerado" ou "Em assinatura", porque cada um desses é uma tarefa
// dele. Para o incorporador, os três são a mesma notícia: alguém está comprando e ainda não
// terminou. O vocabulário que o dono usou ao pedir a tela foi "disponível, reservado, em
// negociação, vendido", e é esse que a tela fala; o detalhe por etapa continua no payload, uma
// camada abaixo, para quem quiser abrir.
//
// ⚠️ O QUE NÃO SAI DAQUI. Nada de documento, telefone ou e-mail de comprador; nada de motivo de
// cancelamento (é onde mora a reprovação de crédito de uma pessoa física). O incorporador é
// CLIENTE, não operador: ele é parte do contrato e enxerga o nome de quem comprou a unidade dele,
// e nada além disso.
import {
  APOLO_VENDA_STAGE_LABELS,
  type ApoloEnterpriseVendas,
  type ApoloVendaStage,
  type ApoloVendaUnit,
} from "@/lib/apolo/vendas";

export type BaldeDeVenda =
  | "bloqueada"
  | "disponivel"
  | "negociacao"
  | "reservado"
  | "vendido";

/** A ordem do fluxo. "Bloqueada" fecha a lista porque é estoque fora da oferta, não etapa. */
export const BALDE_ORDEM: BaldeDeVenda[] = [
  "disponivel",
  "reservado",
  "negociacao",
  "vendido",
  "bloqueada",
];

export const BALDE_LABELS: Record<BaldeDeVenda, string> = {
  bloqueada: "Bloqueada",
  disponivel: "Disponível",
  negociacao: "Em negociação",
  reservado: "Reservado",
  vendido: "Vendido",
};

/** A dobra dos seis estágios do funil interno nos quatro baldes que o cliente lê. */
const BALDE_POR_ESTAGIO: Record<ApoloVendaStage, BaldeDeVenda> = {
  assinatura: "negociacao",
  contrato: "negociacao",
  disponivel: "disponivel",
  faturado: "vendido",
  proposta: "negociacao",
  reservado: "reservado",
};

export type Tally = { units: number; vgv: number };

export type BaldeResumo = {
  balde: BaldeDeVenda;
  /** As etapas internas que caíram neste balde, para quem quiser o detalhe. */
  etapas: { rotulo: string; units: number; vgv: number }[];
  rotulo: string;
  units: number;
  vgv: number;
};

export type ResumoDeVendas = {
  baldes: BaldeResumo[];
  /** Propostas que não seguiram. Contagem apenas: motivo e nome não saem do Apolo interno. */
  perdas: { canceladas: number; distratos: number };
  /** Todas as unidades do empreendimento, incluindo as bloqueadas. */
  total: Tally;
  vendido: Tally;
  /** Quanto do VGV já foi vendido, de 0 a 100. */
  vendidoPct: number;
};

/**
 * O funil e o VGV do jeito que o portal mostra.
 *
 * ⚠️ O TOTAL SOMA AS BLOQUEADAS. A tela interna calcula o VGV somando só os baldes do funil, e
 * por isso mostra um total MENOR que o do empreendimento: no Vista Alegre são R$ 8.186.200 contra
 * os R$ 10.471.900 que a ficha do empreendimento exibe. Para o dono do loteamento, o VGV é o do
 * produto inteiro; a unidade que ele tirou da oferta não deixou de ser dele.
 */
export function resumoDeVendas(vendas: ApoloEnterpriseVendas): ResumoDeVendas {
  const acumulado = new Map<BaldeDeVenda, BaldeResumo>(
    BALDE_ORDEM.map((balde) => [
      balde,
      { balde, etapas: [], rotulo: BALDE_LABELS[balde], units: 0, vgv: 0 },
    ]),
  );

  for (const bucket of vendas.funnel) {
    const alvo = acumulado.get(BALDE_POR_ESTAGIO[bucket.stage]);
    if (!alvo) continue;

    alvo.units += bucket.units;
    alvo.vgv += bucket.vgv;

    // A etapa só aparece se tiver alguma coisa: linha "Contrato gerado: 0" não informa nada e
    // ainda faz o cliente perguntar o que é.
    if (bucket.units > 0) {
      alvo.etapas.push({
        rotulo: APOLO_VENDA_STAGE_LABELS[bucket.stage],
        units: bucket.units,
        vgv: bucket.vgv,
      });
    }
  }

  const bloqueada = acumulado.get("bloqueada")!;
  bloqueada.units += vendas.bloqueadas.units;
  bloqueada.vgv += vendas.bloqueadas.vgv;

  const baldes = BALDE_ORDEM.map((balde) => acumulado.get(balde)!);
  const total = baldes.reduce<Tally>(
    (soma, balde) => ({ units: soma.units + balde.units, vgv: soma.vgv + balde.vgv }),
    { units: 0, vgv: 0 },
  );
  const vendido = acumulado.get("vendido")!;

  const canceladas =
    vendas.terminals.find((t) => t.terminal === "cancelado")?.proposals ?? 0;
  const distratos =
    vendas.terminals.find((t) => t.terminal === "distrato")?.proposals ?? 0;

  return {
    baldes,
    perdas: { canceladas, distratos },
    total: { units: total.units, vgv: arredondar(total.vgv) },
    vendido: { units: vendido.units, vgv: arredondar(vendido.vgv) },
    vendidoPct: total.vgv > 0 ? arredondar((vendido.vgv / total.vgv) * 100) : 0,
  };
}

export type MesDeVenda = { mes: string; units: number; vgv: number };

export type RitmoDeVendas = {
  /** O que foi vendido ANTES da janela. Sem isto, o gráfico some com a maior parte da história. */
  anteriores: Tally;
  /** Unidades por mês, contadas do primeiro mês com venda até hoje. */
  mediaMensal: number;
  meses: MesDeVenda[];
  /** Vendida sem data de mudança de estágio no C2X: fica fora do gráfico, e a tela avisa. */
  semData: number;
};

/**
 * O RITMO: as unidades já vendidas, distribuídas pelo mês em que a venda foi concluída.
 *
 * ⚠️ A DATA É A DA UNIDADE, NÃO A DO EVENTO. Poderia sair do histórico de transições, mas ali a
 * mesma unidade aparece de novo a cada vez que ela volta ao estágio, e o gráfico passaria a somar
 * mais vendas do que o empreendimento tem. Contando pelo estado ATUAL da unidade e pela data em
 * que ela chegou nele, o gráfico fecha com o card: no Vista Alegre, 39 unidades e R$ 3.334.100
 * espalhados por seis meses, exatamente o total vendido.
 *
 * O mês é apurado no fuso de São Paulo. Venda registrada às 21h de 31 de janeiro é de janeiro
 * para quem vendeu, e viraria fevereiro se a conta fosse feita em UTC.
 */
export function ritmoDeVendas(
  unidades: ApoloVendaUnit[],
  agoraMs: number,
  mesesNaJanela = 12,
): RitmoDeVendas {
  const vendidas = unidades.filter((u) => BALDE_POR_ESTAGIO[u.stage] === "vendido");
  const janela = janelaDeMeses(agoraMs, mesesNaJanela);
  const dentro = new Map<string, MesDeVenda>(
    janela.map((mes) => [mes, { mes, units: 0, vgv: 0 }]),
  );

  const anteriores: Tally = { units: 0, vgv: 0 };
  let semData = 0;

  for (const unidade of vendidas) {
    const mes = unidade.stageSince ? mesDe(unidade.stageSince) : null;

    if (!mes) {
      semData += 1;
      continue;
    }

    const alvo = dentro.get(mes);

    if (alvo) {
      alvo.units += 1;
      alvo.vgv += unidade.vgv;
    } else {
      anteriores.units += 1;
      anteriores.vgv += unidade.vgv;
    }
  }

  const meses = janela.map((mes) => {
    const item = dentro.get(mes)!;
    return { ...item, vgv: arredondar(item.vgv) };
  });

  // A média conta a partir do PRIMEIRO mês com venda: começar antes do lançamento diluiria o
  // ritmo em meses em que não havia o que vender, e o número serve para projetar o estoque.
  const primeiro = meses.findIndex((mes) => mes.units > 0);
  const ativos = primeiro === -1 ? 0 : meses.length - primeiro;
  const vendidasNaJanela = meses.reduce((soma, mes) => soma + mes.units, 0);

  return {
    anteriores: { units: anteriores.units, vgv: arredondar(anteriores.vgv) },
    mediaMensal: ativos > 0 ? arredondar(vendidasNaJanela / ativos) : 0,
    meses,
    semData,
  };
}

export type UnidadeDoPortal = {
  balde: BaldeDeVenda;
  bloco: null | string;
  /** Nome de quem comprou. O incorporador é parte do contrato; documento e contato não saem. */
  comprador: null | string;
  /** Desde quando a unidade está nesta situação (ISO), ou nulo. */
  desde: null | string;
  /**
   * A CHAVE do estágio do funil interno ("proposta", "assinatura"…), além do rótulo `situacao`.
   * É o que permite ao Pipeline do portal agrupar colunas IDÊNTICAS às do kanban do Apolo sem
   * fazer engenharia reversa do rótulo. Não expõe dado novo: é a mesma informação de `situacao`,
   * em forma de chave estável.
   */
  etapa: ApoloVendaStage;
  /** Quem vendeu. Informação comercial do dono do empreendimento, que paga a comissão. */
  imobiliaria: null | string;
  lote: null | string;
  /** Etapa exata dentro do balde ("Em assinatura"), para a linha da lista dizer o pé em que está. */
  situacao: string;
  unidade: string;
  /**
   * O id da unidade no C2X — a CHAVE do popup da proposta (`/vendas/proposta?unitId=…`). É o
   * ÚNICO id que atravessa, de propósito: a rota que o recebe confere `unidadeNoEscopo` ANTES de
   * qualquer leitura (mesmo desenho do `unit.id` que a TelaCarteira já usa no modal de parcelas),
   * então o número não abre porta. `arId` e o `entityId` do CRM continuam de fora.
   */
  unitId: null | number;
  valor: number;
};

/**
 * A lista de unidades recortada para o portal: só o que o dono do empreendimento precisa ver.
 *
 * Ficam de fora `arId` e o `entityId` do CRM: nenhum aparece na tela, e id que trafega é id que
 * um dia alguém tenta usar como parâmetro. O `unitId` é a exceção DELIBERADA (é o que liga o
 * popup da proposta na TelaVendas), e só passa porque a rota que o consome reconfere o escopo
 * antes da query — ver o comentário no tipo `UnidadeDoPortal`.
 */
export function unidadesParaOPortal(unidades: ApoloVendaUnit[]): UnidadeDoPortal[] {
  return unidades.map((unidade) => {
    const balde = baldeDaUnidade(unidade);

    return {
      balde,
      bloco: unidade.block,
      comprador: unidade.client?.name ?? null,
      desde: unidade.stageSince,
      etapa: unidade.stage,
      imobiliaria: unidade.imobiliaria?.name ?? null,
      lote: unidade.lot,
      situacao:
        balde === "bloqueada"
          ? BALDE_LABELS.bloqueada
          : APOLO_VENDA_STAGE_LABELS[unidade.stage],
      unidade: unidade.code,
      // `ApoloVendaUnit.id` chega como string do loader; id que não vira número positivo sai
      // nulo, e o clique daquela linha simplesmente não liga (a tela degrada, não quebra).
      unitId: Number(unidade.id) > 0 ? Number(unidade.id) : null,
      valor: unidade.vgv,
    };
  });
}

/**
 * O balde de UMA unidade, pela mesma regra do agregado: bloqueada só conta à parte quando não há
 * venda em andamento. Unidade com proposta viva é assunto de venda, mesmo com a trava ligada.
 */
export function baldeDaUnidade(unidade: ApoloVendaUnit): BaldeDeVenda {
  const balde = BALDE_POR_ESTAGIO[unidade.stage];

  return balde === "disponivel" && unidade.blocked ? "bloqueada" : balde;
}

/** "2026-08" no fuso de São Paulo. */
export function mesDe(iso: string): null | string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return null;

  const partes = new Intl.DateTimeFormat("pt-BR", {
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
    year: "numeric",
  }).formatToParts(data);

  const ano = partes.find((p) => p.type === "year")?.value;
  const mes = partes.find((p) => p.type === "month")?.value;

  return ano && mes ? `${ano}-${mes}` : null;
}

/** Os N meses que terminam no mês de hoje, do mais antigo para o mais novo. */
function janelaDeMeses(agoraMs: number, quantidade: number): string[] {
  const atual = mesDe(new Date(agoraMs).toISOString());
  if (!atual) return [];

  const partes = atual.split("-");
  const ano = Number(partes[0]);
  const mes = Number(partes[1]);

  if (!Number.isFinite(ano) || !Number.isFinite(mes)) return [];

  const saida: string[] = [];

  for (let passo = quantidade - 1; passo >= 0; passo -= 1) {
    // Aritmética em índice de mês absoluto: evita `setMonth`, que estoura para o mês seguinte
    // quando o dia atual não existe no mês de destino (31 de março voltando um mês).
    const indice = ano * 12 + (mes - 1) - passo;
    const anoAlvo = Math.floor(indice / 12);
    const mesAlvo = (indice % 12) + 1;

    saida.push(`${anoAlvo}-${String(mesAlvo).padStart(2, "0")}`);
  }

  return saida;
}

function arredondar(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}
