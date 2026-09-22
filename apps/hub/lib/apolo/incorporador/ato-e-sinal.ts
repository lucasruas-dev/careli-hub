import { numeroDaParcela } from "@/lib/apolo/numero-da-parcela";
import { perfilDaParcela, type SituacaoDaParcela } from "@/lib/apolo/incorporador/carteira-liquida";

// AS PARCELAS DE ATO E SINAL, AGRUPADAS PELO PEDIDO — não pela unidade.
//
// ⚠️ A CHAVE É O PEDIDO DE AQUISIÇÃO, E ISTO É O CONSERTO DE UM BUG MEDIDO (21/09/2026). Lucas,
// vendo a carteira do Vale do Ouro filtrada por "niv": *"tem alguns boletos vencidos que estão em
// nome da nivea, isso deve ser erro"*.
//
// O que acontecia: o mapa era montado por `enterprise_unities.id` e a LINHA da carteira nasce por
// pedido (`group by ... ar.id` em lib/apolo/carteira.ts). Quando a mesma unidade tem mais de um
// pedido — o normal, porque a reserva cancelada continua no legado ao lado da venda que vingou —
// cada linha recebia o balde INTEIRO da unidade. Resultado medido na unidade 5762 (VOC 12/21): as
// 9 parcelas de ato e sinal, R$ 14.980,13, apareciam DUAS vezes, as duas sob o nome da compradora
// de um pedido CANCELADO (4 parcelas de teste, R$ 140) — enquanto o dinheiro é do comprador do
// pedido vivo (R$ 14.840 no pedido 4807, faturado). E o vencido de R$ 3.710 vencendo em 20/09,
// que é dele, aparecia cobrado no nome dela.
//
// Alcance medido no legado: 21 unidades em 5 empreendimentos (VOC 10, VOL 6, REP 3, LOU 1, SDT 1)
// têm mais de um pedido com parcela de ato ou sinal, gerando 22 linhas repetidas e
// R$ 298.066,63 contados em duplicidade nos cards do coordenador, dos quais R$ 17.985,19 de
// vencido. Em todas as 21 o pedido a mais está CANCELADO: não existe unidade com duas vendas
// vivas hoje — mas, quando existir, cada uma vai mostrar o SEU dinheiro.
//
// A régua fica aqui, pura, porque quem a usa é uma rota que fala com o C2X: assim ela tem teste.

/** Uma linha crua da leitura de Ato e Sinal (o `select` vive na rota da carteira). */
export type LinhaDeAtoESinal = {
  /** `acquisition_requests.id` — a CHAVE do balde. Ver o cabeçalho deste arquivo. */
  ar_id: number | string;
  dias_atraso: null | number | string;
  due_date: null | string;
  invoice_url: null | string;
  ja_venceu: null | number | string;
  pago_no_mes: null | number | string;
  parcel_type: null | string;
  parcela_n: null | number | string;
  parcela_total: null | number | string;
  payment_date: null | string;
  payment_id: number | string;
  payment_url: null | string;
  sinal_n: null | number | string;
  sinal_total: null | number | string;
  situacao: null | string;
  unit_id: number | string;
  valor_em_aberto: null | number | string;
  valor_pago: null | number | string;
  valor_previsto: null | number | string;
};

export type ParcelaDeAtoESinal = {
  /** Fatura/Boleto Asaas: `payment_asaas_url` primeiro, `payment_asaas_invoice_url` de fallback (a mesma escolha de parcelas-portal.ts). */
  boletoUrl: null | string;
  diasDeAtraso: number;
  id: string;
  /** `true` = o vencimento já passou (pago ou não). É o denominador da inadimplência, como no bruto. */
  jaVenceu: boolean;
  /** "1/1" no Ato, "n/total" no Sinal (a régua de numero-da-parcela.ts). */
  numero: string;
  pagoEm: null | string;
  /** `true` = paga com pagamento no mês corrente (o card "Recuperação" do bruto). */
  pagoNoMes: boolean;
  perfil: "Ato" | "Sinal";
  situacao: SituacaoDaParcela;
  /** O principal (valor cheio da parcela), a mesma régua de `PRINCIPAL` em carteira.ts. */
  valor: number;
  /** Em aberto COM encargos quando vencida (a régua `OUTSTANDING` de carteira.ts); 0 quando não. */
  valorEmAberto: number;
  valorPago: number;
  vencimento: null | string;
};

/** Teto de segurança da leitura de Ato e Sinal: bateu, `parcial` vem `true` e a tela avisa. */
export const TETO_ATO_E_SINAL = 20000;

const numero = (valor: unknown): number => {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const http = (valor: unknown): null | string => {
  const texto = typeof valor === "string" ? valor.trim() : "";
  return /^https?:\/\//i.test(texto) ? texto : null;
};

/**
 * Agrupa as linhas cruas por PEDIDO (`ar_id`), descartando o que não é ato nem sinal.
 *
 * `parcial` = a leitura bateu no teto e a lista não é completa; a tela do coordenador avisa em vez
 * de somar errado calada.
 */
export function agruparAtoESinalPorPedido(cruas: LinhaDeAtoESinal[]): {
  parcial: boolean;
  porPedido: Map<string, ParcelaDeAtoESinal[]>;
} {
  const parcial = cruas.length > TETO_ATO_E_SINAL;
  const porPedido = new Map<string, ParcelaDeAtoESinal[]>();

  for (const linha of cruas.slice(0, TETO_ATO_E_SINAL)) {
    // A régua canônica decide; o LIKE do SQL só reduziu o volume.
    const perfil = perfilDaParcela(linha.parcel_type);
    if (perfil !== "ato" && perfil !== "sinal") continue;

    const situacao = linha.situacao;
    const pedidoId = String(linha.ar_id ?? "").trim();
    // Parcela sem pedido não existe no C2X (o join é obrigatório); se aparecer, ela não tem dono e
    // não pode ser somada no dono de ninguém.
    if (!pedidoId) continue;

    const lista = porPedido.get(pedidoId) ?? [];
    lista.push({
      // A fatura primeiro, o PDF cru de fallback: a mesma escolha documentada em parcelas-portal.ts.
      boletoUrl: http(linha.payment_url) ?? http(linha.invoice_url),
      diasDeAtraso: numero(linha.dias_atraso),
      id: String(linha.payment_id),
      jaVenceu: numero(linha.ja_venceu) === 1,
      numero: numeroDaParcela({
        parcelaAtual: linha.parcela_n == null ? null : numero(linha.parcela_n),
        parcelaTotal: linha.parcela_total == null ? null : numero(linha.parcela_total),
        sinalAtual: linha.sinal_n == null ? null : numero(linha.sinal_n),
        sinalTotal: linha.sinal_total == null ? null : numero(linha.sinal_total),
        tipo: linha.parcel_type,
      }),
      pagoEm: linha.payment_date,
      pagoNoMes: numero(linha.pago_no_mes) === 1,
      perfil: perfil === "ato" ? "Ato" : "Sinal",
      situacao: situacao === "paga" ? "paga" : situacao === "vencida" ? "vencida" : "a_vencer",
      valor: numero(linha.valor_previsto),
      valorEmAberto: numero(linha.valor_em_aberto),
      valorPago: numero(linha.valor_pago),
      vencimento: linha.due_date,
    });
    porPedido.set(pedidoId, lista);
  }

  return { parcial, porPedido };
}
