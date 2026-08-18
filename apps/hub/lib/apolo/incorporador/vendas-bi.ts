import { getHadesDbPool } from "@/lib/guardian/db";
import type { ApoloVendaUnit } from "@/lib/apolo/vendas";

import { baldeDaUnidade, mesDe } from "./vendas-resumo";

// OS INDICADORES DE VENDAS DO BI, calculados no servidor sobre o histórico do C2X.
//
// A referência é o "Careli - Dashboard Recanto.pbit" do Lucas (páginas "Vendas" e "Cenário de
// Vendas"): tudo sai de `acquisition_request_historics`, pelo `new_acquisition_request_stage_id`:
//
//   • Proposta  = estágio 9 ("Proposta realizada");
//   • Faturada  = estágio 4 ("Faturado");
//   • Cancelada = estágio 7 ("Cancelado"), com `old_stage <> 1` — cancelamento direto da reserva
//     não chegou a ser proposta e não conta (regra do BI);
//   • % Cancelamento = canceladas ÷ propostas;
//   • Deadline = dias entre a ÚLTIMA proposta antes do faturamento e o faturamento, na média.
//
// ⚠️ CONTA-SE POR UNIDADE, NÃO POR PROPOSTA (decisão do plano). A mesma unidade pode ter duas
// propostas no ano (caiu e revendeu); para o dono do loteamento, "propostas geradas" responde
// "quantas unidades tiveram proposta", não "quantos registros o C2X criou". A dedupe fica com o
// PRIMEIRO evento de cada unidade em cada métrica; o VGV soma o preço da unidade uma vez.
//
// ⚠️ ISTO É UMA SEGUNDA LEITURA NO C2X, e é de propósito que ela mora aqui e não numa rota irmã:
// os campos entram no MESMO payload de /api/incorporador/vendas (um fetch só na tela), e a query
// é uma, agregada em memória por função PURA — testável sem banco.
//
// O QUE NÃO SAI DAQUI: nome de comprador, motivo de cancelamento, plano comercial. O ranking de
// imobiliárias sai das unidades JÁ carregadas (`rankingDeImobiliarias`), sem consulta extra. O
// "Cenário Analítico" do BI (unidade/quadra/lote/cliente/imobiliária/preço) já É a tabela de
// unidades que a TelaVendas mostra — a coluna "Plano" fica de fora, declarado: plano comercial,
// juros e corretor são internos (mesma decisão que deixou o VendaPropostaModal fora do portal).

export type TallyBI = {
  un: number;
  vgv: number;
};

export type MesDeVendasBI = {
  canceladas: TallyBI;
  faturadas: TallyBI;
  /** "YYYY-MM", fuso de São Paulo (mesma régua do ritmo de vendas). */
  mes: string;
  propostas: TallyBI;
};

export type RankingImobiliaria = {
  nome: string;
  unidades: number;
  vgv: number;
};

export type IndicadoresDeVendasBI = {
  canceladas: TallyBI;
  /** Canceladas ÷ propostas, JÁ em 0–100 (lição do bug do ×100 da TelaCarteira). */
  cancelamentoPct: number;
  /** Média de dias entre a última proposta e o faturamento; nulo sem faturamento medível. */
  deadlineMedioDias: null | number;
  faturadas: TallyBI;
  /** `true` quando a leitura do histórico bateu no teto e os números podem estar incompletos. */
  parcial: boolean;
  propostas: TallyBI;
  /** Imobiliárias por unidades VENDIDAS (estado atual), da maior para a menor. */
  ranking: RankingImobiliaria[];
  /** 12 meses, do mais antigo ao atual, pelo mês do evento. */
  serieMensal: MesDeVendasBI[];
};

/**
 * Um evento de estágio do histórico, já reduzido ao que a conta precisa.
 * Exportado porque `montarIndicadoresDeVendasBI` é função PURA sobre ele (testes sem C2X).
 */
export type EventoDeVenda = {
  arId: number;
  /** ISO do evento (`historics.created_at`). */
  em: string;
  estagioAnterior: null | number;
  novoEstagio: number;
  precoDaUnidade: number;
  unitId: string;
};

// Mesmo teto defensivo da carteira: um erro de escopo nunca vira SELECT sem fim. Se bater,
// `parcial` vem `true` e a tela avisa em vez de somar errado calada.
const TETO_DE_EVENTOS = 20000;

const ESTAGIO_PROPOSTA = 9;
const ESTAGIO_FATURADO = 4;
const ESTAGIO_CANCELADO = 7;

/** Os 12 meses "YYYY-MM" que terminam no mês de `agoraMs` (São Paulo), do mais antigo ao atual. */
function janelaDeMeses(agoraMs: number): string[] {
  const atual = mesDe(new Date(agoraMs).toISOString());
  if (!atual) return [];

  const [anoCru, mesCru] = atual.split("-");
  const ano = Number(anoCru);
  const mes = Number(mesCru);
  if (!Number.isFinite(ano) || !Number.isFinite(mes)) return [];

  const saida: string[] = [];
  for (let passo = 11; passo >= 0; passo -= 1) {
    const indice = ano * 12 + (mes - 1) - passo;
    saida.push(`${Math.floor(indice / 12)}-${String((indice % 12) + 1).padStart(2, "0")}`);
  }
  return saida;
}

function tallyVazio(): TallyBI {
  return { un: 0, vgv: 0 };
}

function arredondar(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

/**
 * A classificação do evento nas três métricas do BI.
 *
 * Cancelada exige `old_stage <> 1` (regra do BI: quem caiu direto da reserva nunca foi proposta).
 * Evento SEM estágio anterior registrado CONTA como cancelamento: no C2X um 7 sem `old_stage`
 * veio de proposta em andamento na prática, e descartá-lo esconderia perda real do cliente.
 */
function metricaDoEvento(
  evento: EventoDeVenda,
): "cancelada" | "faturada" | "proposta" | null {
  if (evento.novoEstagio === ESTAGIO_PROPOSTA) return "proposta";
  if (evento.novoEstagio === ESTAGIO_FATURADO) return "faturada";
  if (evento.novoEstagio === ESTAGIO_CANCELADO && evento.estagioAnterior !== 1) {
    return "cancelada";
  }
  return null;
}

/**
 * Os KPIs de vendas do BI, como função PURA sobre os eventos (ordenados do mais antigo ao mais
 * novo) e as unidades já carregadas pela rota.
 */
export function montarIndicadoresDeVendasBI(
  eventos: EventoDeVenda[],
  unidades: ApoloVendaUnit[],
  agoraMs: number,
  parcial = false,
): IndicadoresDeVendasBI {
  const meses = janelaDeMeses(agoraMs);
  const serie = new Map<string, MesDeVendasBI>(
    meses.map((mes) => [
      mes,
      { canceladas: tallyVazio(), faturadas: tallyVazio(), mes, propostas: tallyVazio() },
    ]),
  );

  // Dedupe POR UNIDADE em cada métrica: fica o primeiro evento (a lista chega em ordem).
  const totais = {
    cancelada: tallyVazio(),
    faturada: tallyVazio(),
    proposta: tallyVazio(),
  };
  const vistas = {
    cancelada: new Set<string>(),
    faturada: new Set<string>(),
    proposta: new Set<string>(),
  };

  // Deadline: por CONTRATO (acquisition_request) — a última proposta antes do primeiro
  // faturamento daquele mesmo contrato.
  const ultimaPropostaPorAr = new Map<number, number>();
  const deadlines: number[] = [];
  const arJaFaturado = new Set<number>();

  /** O que cada unidade somou em "faturadas", para poder ser desfeito se ela cancelar depois. */
  const faturamentoContado = new Map<string, { mes: null | string; vgv: number }>();

  for (const evento of eventos) {
    const quandoMs = Date.parse(evento.em);

    if (evento.novoEstagio === ESTAGIO_PROPOSTA && Number.isFinite(quandoMs)) {
      ultimaPropostaPorAr.set(evento.arId, quandoMs);
    }
    if (
      evento.novoEstagio === ESTAGIO_FATURADO &&
      Number.isFinite(quandoMs) &&
      !arJaFaturado.has(evento.arId)
    ) {
      arJaFaturado.add(evento.arId);
      const propostaMs = ultimaPropostaPorAr.get(evento.arId);
      if (propostaMs !== undefined && quandoMs >= propostaMs) {
        deadlines.push((quandoMs - propostaMs) / 86_400_000);
      }
    }

    const metrica = metricaDoEvento(evento);

    // ⚠️ FATURAMENTO DESFEITO POR CANCELAMENTO POSTERIOR NÃO É FATURAMENTO.
    //
    // Achado com o Lucas em 18/08/2026: o portal do CER mostrava "Faturadas 1 · R$ 148.401" ao
    // lado de "Vendido R$ 0" e "Unidades vendidas 0". Os dois estavam certos pela régua de cada
    // um — a VOC1221 passou pelo estágio 4 em 12/08 e HOJE está no 7 (Cancelado) —, e a faixa
    // ficava se contradizendo: a mesma unidade era contada como faturada E como cancelada, em
    // direções opostas.
    //
    // A régua que vale é a do estado final: quem cancelou depois não vendeu. Como os eventos
    // chegam em ordem, basta desfazer no cancelamento o que o faturamento somou — inclusive no
    // mês em que ele foi somado, senão o gráfico continua mostrando uma barra de venda que não
    // existiu.
    //
    // ⚠️ E LIBERA A UNIDADE para contar de novo: unidade que fatura, cancela e fatura outra vez
    // é venda de verdade na segunda passagem. Manter o dedupe travado a esconderia para sempre.
    if (metrica === "cancelada") {
      const desfazer = faturamentoContado.get(evento.unitId);
      if (desfazer) {
        totais.faturada.un -= 1;
        totais.faturada.vgv -= desfazer.vgv;
        const alvoDoMes = desfazer.mes ? serie.get(desfazer.mes) : undefined;
        if (alvoDoMes) {
          alvoDoMes.faturadas.un -= 1;
          alvoDoMes.faturadas.vgv -= desfazer.vgv;
        }
        faturamentoContado.delete(evento.unitId);
        vistas.faturada.delete(evento.unitId);
      }
    }

    if (!metrica || vistas[metrica].has(evento.unitId)) continue;
    vistas[metrica].add(evento.unitId);

    totais[metrica].un += 1;
    totais[metrica].vgv += evento.precoDaUnidade;

    const mes = mesDe(evento.em);
    if (metrica === "faturada") {
      faturamentoContado.set(evento.unitId, { mes, vgv: evento.precoDaUnidade });
    }
    const alvo = mes ? serie.get(mes) : undefined;
    if (alvo) {
      const balde =
        metrica === "proposta"
          ? alvo.propostas
          : metrica === "faturada"
            ? alvo.faturadas
            : alvo.canceladas;
      balde.un += 1;
      balde.vgv += evento.precoDaUnidade;
    }
  }

  return {
    canceladas: { un: totais.cancelada.un, vgv: arredondar(totais.cancelada.vgv) },
    cancelamentoPct:
      totais.proposta.un > 0
        ? arredondar((totais.cancelada.un / totais.proposta.un) * 100)
        : 0,
    deadlineMedioDias:
      deadlines.length > 0
        ? arredondar(deadlines.reduce((soma, dias) => soma + dias, 0) / deadlines.length)
        : null,
    faturadas: { un: totais.faturada.un, vgv: arredondar(totais.faturada.vgv) },
    parcial,
    propostas: { un: totais.proposta.un, vgv: arredondar(totais.proposta.vgv) },
    ranking: rankingDeImobiliarias(unidades),
    serieMensal: meses.map((mes) => {
      const item = serie.get(mes)!;
      return {
        canceladas: { un: item.canceladas.un, vgv: arredondar(item.canceladas.vgv) },
        faturadas: { un: item.faturadas.un, vgv: arredondar(item.faturadas.vgv) },
        mes,
        propostas: { un: item.propostas.un, vgv: arredondar(item.propostas.vgv) },
      };
    }),
  };
}

/**
 * O "Ranking de Imobiliária" do BI: imobiliária × unidades vendidas, pelo ESTADO ATUAL das
 * unidades (mesma fonte do card "Vendido" da tela — os números não brigam entre si).
 */
export function rankingDeImobiliarias(unidades: ApoloVendaUnit[]): RankingImobiliaria[] {
  const porNome = new Map<string, RankingImobiliaria>();

  for (const unidade of unidades) {
    if (baldeDaUnidade(unidade) !== "vendido") continue;
    const nome = unidade.imobiliaria?.name?.trim();
    if (!nome) continue;

    const alvo = porNome.get(nome.toLowerCase()) ?? { nome, unidades: 0, vgv: 0 };
    alvo.unidades += 1;
    alvo.vgv += unidade.vgv;
    porNome.set(nome.toLowerCase(), alvo);
  }

  return [...porNome.values()]
    .map((linha) => ({ ...linha, vgv: arredondar(linha.vgv) }))
    .sort((a, b) => b.unidades - a.unidades || b.vgv - a.vgv || a.nome.localeCompare(b.nome, "pt-BR"))
    .slice(0, 10);
}

type LinhaDeEvento = {
  ar_id: number | string;
  em: Date | null | string;
  estagio_anterior: null | number | string;
  novo_estagio: null | number | string;
  preco: null | number | string;
  unit_id: number | string;
};

/**
 * Lê os eventos de estágio 9/4/7 do C2X (READ-ONLY) para os empreendimentos JÁ FILTRADOS pelo
 * escopo da sessão — esta função NÃO autoriza nada: quem chama tem que ter passado por
 * `codigosDaSessao`.
 */
export async function lerEventosDeVendas(
  codes: string[],
): Promise<{ eventos: EventoDeVenda[]; ok: true; parcial: boolean } | { error: string; ok: false }> {
  const validos = [...new Set(codes.map((c) => c.trim().toUpperCase()).filter(Boolean))];
  if (validos.length === 0) return { eventos: [], ok: true, parcial: false };

  const pool = getHadesDbPool();
  if (!pool.ok) {
    return { error: `Configuracao C2X ausente: ${pool.missing.join(", ")}.`, ok: false };
  }

  const marcadores = validos.map(() => "?").join(", ");

  try {
    const [linhas] = await pool.pool.query(
      `select h.created_at                            as em,
              h.new_acquisition_request_stage_id      as novo_estagio,
              h.old_acquisition_request_stage_id      as estagio_anterior,
              ar.id                                   as ar_id,
              u.id                                    as unit_id,
              u.price                                 as preco
         from acquisition_request_historics h
         join acquisition_requests ar on ar.id = h.acquisition_request_id
         join enterprise_unities u on u.id = ar.enterprise_unity_id
         join enterprises e on e.id = u.enterprise_id
        where e.code in (${marcadores})
          and h.new_acquisition_request_stage_id in (${ESTAGIO_FATURADO}, ${ESTAGIO_CANCELADO}, ${ESTAGIO_PROPOSTA})
        order by h.created_at asc, h.id asc
        limit ${TETO_DE_EVENTOS}`,
      validos,
    );

    const cruas = linhas as LinhaDeEvento[];
    const eventos: EventoDeVenda[] = [];

    for (const linha of cruas) {
      // `created_at` chega como Date do mysql2; a defesa cobre driver devolvendo string.
      const data =
        linha.em instanceof Date ? linha.em : linha.em ? new Date(String(linha.em)) : null;
      const em = data && !Number.isNaN(data.getTime()) ? data.toISOString() : null;
      const novo = Number(linha.novo_estagio ?? 0);
      if (!em || !novo) continue;

      eventos.push({
        arId: Number(linha.ar_id),
        em,
        estagioAnterior:
          linha.estagio_anterior === null || linha.estagio_anterior === undefined
            ? null
            : Number(linha.estagio_anterior),
        novoEstagio: novo,
        precoDaUnidade: Number(linha.preco ?? 0),
        unitId: String(linha.unit_id),
      });
    }

    return { eventos, ok: true, parcial: cruas.length >= TETO_DE_EVENTOS };
  } catch (error) {
    console.error("[apolo][incorporador] falha ao ler o historico de vendas", error);
    return { error: "Nao foi possivel ler o historico de vendas agora.", ok: false };
  }
}
