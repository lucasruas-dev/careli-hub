// A ABA HISTÓRICO DA FICHA DO PORTAL DO INCORPORADOR — a ficha corrida FILTRADA para o que o
// cliente externo pode ver:
//
//   • VENDA      — os marcos da proposta (acquisition_request_historics: reserva, proposta,
//                  contrato, assinatura, faturamento), SEMPRE estreitados pelos codes da sessão;
//   • PAGAMENTO  — só o que foi PAGO (pago em, valor), também estreitado por code;
//   • REUNIÃO    — as reuniões do Chronos em que a pessoa participou (loadChronos, o mesmo
//                  loader da timeline interna).
//
// FICAM DE FORA, de propósito: atendimentos da Iris, negociações do Hades e eventos manuais
// (anotações do time). São operação interna da Careli — a conversa de cobrança e a nota do
// analista não são assunto do loteador. Exclusão pendente de ratificação do Lucas; se ele quiser
// alguma dessas fontes, o filtro é `eventosDoPortal` abaixo, num lugar só.
//
// ⚠️ POR QUE NÃO REUSAR loadApoloEntityTimeline INTEIRO: as consultas de venda/pagamento de lá
// filtram só por client_id, SEM empreendimento — a mesma pessoa pode ter lote de OUTRO loteador,
// e a ficha corrida completa entregaria o nome do empreendimento alheio na tela deste cliente.
// Aqui as duas consultas são refeitas com `e.id in (...)`: os codes da sessão, traduzidos no id do
// empreendimento no C2X.
//
// ⚠️ PELO ID, NÃO PELA SIGLA (PAN-124). Até 25/09/2026 o filtro era `e.code in (codes da sessão)`, e
// a sigla muda quando alguém renomeia no legado (o 43 foi de RDV para PDI em 24/09/2026): a ficha
// corrida daquele empreendimento sumia sem erro. O id não muda; a tradução é pelo MESMO catálogo de
// onde o escopo tirou as siglas, então o conjunto é o de hoje.
import type { RowDataPacket } from "mysql2";

import { filtroPorIds } from "@/lib/apolo/c2x-pelo-id";
import { idsDoC2xDasSiglasAoVivo } from "@/lib/apolo/c2x-pelo-id-servidor";
import { createApoloAdminClient } from "@/lib/apolo/server";
import {
  loadChronos,
  somenteEmailsDeCliente,
  type ApoloTimelineEntry,
} from "@/lib/apolo/timeline";
import { getHadesDbPool } from "@/lib/guardian/db";

import { lerC2xUserId, lerCadastroDaPessoa } from "./ficha-cadastro";
import { pessoaNoEscopo } from "./pessoa-no-escopo";
import type { TipoDaFicha } from "./crm";
import type { SessaoIncorporador } from "./sessao";

// ── TIPOS DO PAYLOAD ────────────────────────────────────────────────────────

export type CategoriaDoHistorico = "pagamento" | "reuniao" | "venda";

export type EventoDoHistorico = {
  categoria: CategoriaDoHistorico;
  /** ISO. Ordena a lista; o filtro de período da tela corta por dia sobre ela. */
  data: string;
  /** true = a fonte só tem a DATA (pagamento do C2X); a tela não mostra hora. */
  dataSemHora: boolean;
  descricao: string;
  id: string;
  titulo: string;
  /** Valor em R$ quando o evento é dinheiro (pagamento); nulo nos demais. */
  valor: null | number;
};

// ── REGRAS PURAS ────────────────────────────────────────────────────────────

// Estágios que saem na ficha do cliente: os marcos de avanço da venda (reserva→faturado).
// Cancelado/reprovado/distrato (7, 8, 10, 11) ficam fora — ruptura de contrato é conversa da
// Careli com o comprador antes de ser linha do extrato do loteador (pendente ratificação; a aba
// Vendas do portal já mostra os cancelamentos agregados).
const ESTAGIOS_DO_PORTAL = new Set([1, 2, 3, 4, 5, 6, 9]);

export type LinhaVendaHistorico = {
  block: null | string;
  enterprise_name: null | string;
  hist_id: number | string;
  lot: null | string;
  occurred_at: null | string;
  stage_id: null | number;
  stage_name: null | string;
};

export function eventoDeVenda(linha: LinhaVendaHistorico): EventoDoHistorico | null {
  if (!ESTAGIOS_DO_PORTAL.has(Number(linha.stage_id))) return null;

  const unidade = [
    linha.block ? `Q${linha.block}` : null,
    linha.lot ? `L${String(linha.lot).replace(/^L/i, "")}` : null,
  ]
    .filter(Boolean)
    .join("·");

  return {
    categoria: "venda",
    data: String(linha.occurred_at ?? ""),
    dataSemHora: false,
    descricao: [unidade, linha.enterprise_name?.trim()].filter(Boolean).join(" · "),
    id: `venda:${linha.hist_id}`,
    titulo: linha.stage_name?.trim() || "Venda",
    valor: null,
  };
}

export type LinhaPagamentoHistorico = {
  enterprise_name: null | string;
  paid_value: null | number | string;
  parcel_label: null | string;
  parcel_type: null | string;
  payment_day: null | string;
  payment_id: number | string;
};

export function eventoDePagamento(linha: LinhaPagamentoHistorico): EventoDoHistorico | null {
  if (!linha.payment_day) return null;

  const valor = Number(linha.paid_value);
  const detalhe = [linha.parcel_type?.trim(), linha.parcel_label?.trim()]
    .filter(Boolean)
    .join(" ");

  return {
    categoria: "pagamento",
    // Meio-dia neutro: o C2X só tem a DATA do pagamento (mesma regra da timeline interna).
    data: `${linha.payment_day}T12:00:00-03:00`,
    dataSemHora: true,
    descricao: [detalhe, linha.enterprise_name?.trim()].filter(Boolean).join(" · "),
    id: `pagamento:${linha.payment_id}`,
    titulo: "Pagamento realizado",
    valor: Number.isFinite(valor) ? valor : null,
  };
}

/** Reunião do Chronos → evento do portal (o loader interno já traz título/descrição/data). */
export function eventoDeReuniao(entrada: ApoloTimelineEntry): EventoDoHistorico | null {
  if (entrada.source !== "chronos") return null;

  return {
    categoria: "reuniao",
    data: entrada.date,
    dataSemHora: entrada.dateOnly,
    descricao: entrada.description,
    id: entrada.id,
    titulo: entrada.title,
    valor: null,
  };
}

/**
 * Junta e ordena (mais recente primeiro), cortando o que ainda não aconteceu — agenda não é
 * ficha corrida (uma reunião recorrente do Chronos gera ocorrência até 2087).
 *
 * A comparação é por TIMESTAMP, não por string: as fontes misturam offset -03:00 (C2X) e Z
 * (Chronos), e comparar texto ordenaria errado entre elas.
 */
export function ordenarHistorico(
  eventos: Array<EventoDoHistorico | null>,
  agoraIso: string,
): EventoDoHistorico[] {
  const ts = (valor: string): number => {
    const parsed = Date.parse(valor);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const agora = ts(agoraIso);

  return eventos
    .filter((evento): evento is EventoDoHistorico => evento !== null)
    .filter((evento) => !evento.data || ts(evento.data) <= agora)
    .sort((a, b) => ts(b.data) - ts(a.data));
}

// ── LEITURAS (C2X escopado + Chronos) ───────────────────────────────────────

type VendaRow = RowDataPacket & LinhaVendaHistorico;
type PagamentoRow = RowDataPacket & LinhaPagamentoHistorico;

/**
 * Os ids do C2X dos codes da sessão, para as duas leituras abaixo. Vazio quando não há o que
 * consultar: sigla sem id no C2X (produto nascido no Panteon, que é o esperado e não falha) ou
 * catálogo indisponível (C2X fora). Nos dois casos a ficha corrida sai sem venda e sem pagamento,
 * como já saía quando a consulta ao C2X caía.
 */
export async function idsDoEscopoNoC2x(codes: string[]): Promise<number[]> {
  if (codes.length === 0) return [];
  const traduzido = await idsDoC2xDasSiglasAoVivo(codes);
  if (!traduzido.ok) {
    console.error("[incorporador][historico] sem tradução de sigla para id", traduzido.erro);
    return [];
  }
  return traduzido.ids;
}

/**
 * Os marcos de venda da pessoa nos empreendimentos do escopo (`ids` = `enterprises.id` do C2X, já
 * traduzidos por `idsDoEscopoNoC2x`). Lista vazia = nada a consultar.
 */
export async function lerVendasDoEscopo(
  c2xUserId: number,
  ids: readonly number[],
): Promise<LinhaVendaHistorico[]> {
  const doEscopo = filtroPorIds("e.id", ids);
  const pool = getHadesDbPool();
  if (!pool.ok || !doEscopo) return [];

  try {
    // Mesma consulta da timeline interna (lib/apolo/timeline.ts → loadVendas), com o filtro de
    // empreendimento que lá não existe: `e.id in (ids do escopo)`.
    const [linhas] = await pool.pool.query<VendaRow[]>(
      `select min(arh.id) as hist_id,
              date_format(min(arh.created_at), '%Y-%m-%dT%H:%i:%s-03:00') as occurred_at,
              arh.new_acquisition_request_stage_id as stage_id,
              s.name as stage_name,
              e.name as enterprise_name, eu.block, eu.lot
         from acquisition_request_historics arh
         join acquisition_requests ar on ar.id = arh.acquisition_request_id
         join enterprise_unities eu on eu.id = ar.enterprise_unity_id
         join enterprises e on e.id = eu.enterprise_id
         join acquisition_request_stages s on s.id = arh.new_acquisition_request_stage_id
        where ar.client_id = ? and ${doEscopo.sql}
        group by ar.id, arh.new_acquisition_request_stage_id, date(arh.created_at),
                 s.name, e.name, eu.block, eu.lot
        order by occurred_at desc
        limit 300`,
      [c2xUserId, ...doEscopo.params],
    );

    return linhas;
  } catch {
    return [];
  }
}

/** Os pagamentos da pessoa nos empreendimentos do escopo (`ids` como em `lerVendasDoEscopo`). */
export async function lerPagamentosDoEscopo(
  c2xUserId: number,
  ids: readonly number[],
): Promise<LinhaPagamentoHistorico[]> {
  const doEscopo = filtroPorIds("e.id", ids);
  const pool = getHadesDbPool();
  if (!pool.ok || !doEscopo) return [];

  try {
    // Só o PAGO (payment_status_id = 5): a régua do que venceu e não foi pago é assunto da aba
    // Financeiro; a ficha corrida do cliente externo registra o que aconteceu.
    const [linhas] = await pool.pool.query<PagamentoRow[]>(
      `select p.id as payment_id,
              date_format(p.payment_date, '%Y-%m-%d') as payment_day,
              p.paid_value,
              pt.name as parcel_type,
              case
                when lower(pt.name) = 'sinal'
                  then concat(coalesce(p.current_signal_parcel, '-'), '/', coalesce(p.total_signal_parcels, '-'))
                when lower(pt.name) = 'parcela'
                  then concat(coalesce(p.current_total_parcel, '-'), '/', coalesce(p.total_parcels, '-'))
                else ''
              end as parcel_label,
              e.name as enterprise_name
         from payments p
         join acquisition_requests ar on ar.id = p.acquisition_request_id
         join enterprise_unities eu on eu.id = ar.enterprise_unity_id
         join enterprises e on e.id = eu.enterprise_id
         join parcel_types pt on pt.id = p.parcel_type_id
        where ar.client_id = ? and ${doEscopo.sql}
          and (p.payment_to_delete is null or p.payment_to_delete = 0)
          and p.payment_status_id = 5
        order by p.payment_date desc
        limit 300`,
      [c2xUserId, ...doEscopo.params],
    );

    return linhas;
  } catch {
    return [];
  }
}

export type ResultadoDoHistorico =
  | { eventos: EventoDoHistorico[]; ok: true }
  | { ok: false; status: 404 | 503 };

/** O histórico da pessoa, provado no escopo e filtrado para o que o portal mostra. */
export async function montarHistorico({
  id,
  sessao,
  tipo,
}: {
  id: string;
  sessao: SessaoIncorporador;
  tipo: TipoDaFicha;
}): Promise<ResultadoDoHistorico> {
  const pessoa = await pessoaNoEscopo({ id, sessao, tipo });
  if (!pessoa.ok) return pessoa;

  const admin = createApoloAdminClient();

  // Identidade para as fontes: c2xId (venda/pagamento) e e-mails (reuniões). Os e-mails são uso
  // interno do servidor — entram na consulta do Chronos e NÃO saem no payload.
  const [c2xUserId, cadastro] = await Promise.all([
    admin ? lerC2xUserId(admin, pessoa.entityId) : Promise.resolve(null),
    admin
      ? lerCadastroDaPessoa({ enterpriseIds: pessoa.enterpriseIds, entityId: pessoa.entityId })
      : Promise.resolve(null),
  ]);

  const emails = somenteEmailsDeCliente(cadastro?.emails ?? []);

  // A tradução sigla → id é UMA para as duas leituras, e só acontece quando há quem procurar no C2X.
  // Encadeada (e não esperada antes) para não segurar a leitura das reuniões do Chronos.
  const idsNoC2x = c2xUserId ? idsDoEscopoNoC2x(pessoa.codes) : Promise.resolve<number[]>([]);

  const [vendas, pagamentos, reunioes] = await Promise.all([
    c2xUserId
      ? idsNoC2x.then((ids) => lerVendasDoEscopo(c2xUserId, ids))
      : Promise.resolve([]),
    c2xUserId
      ? idsNoC2x.then((ids) => lerPagamentosDoEscopo(c2xUserId, ids))
      : Promise.resolve([]),
    admin && emails.length > 0
      ? loadChronos(admin, emails).catch(() => [] as ApoloTimelineEntry[])
      : Promise.resolve([] as ApoloTimelineEntry[]),
  ]);

  return {
    eventos: ordenarHistorico(
      [
        ...vendas.map(eventoDeVenda),
        ...pagamentos.map(eventoDePagamento),
        ...reunioes.map(eventoDeReuniao),
      ],
      new Date().toISOString(),
    ),
    ok: true,
  };
}
