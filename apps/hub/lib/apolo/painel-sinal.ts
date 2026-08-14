// CENÁRIO DE PAGAMENTOS DA ENTRADA (ATO + SINAL) — lido do C2X (read-only).
//
// ESCOPO (Lucas, 14/08): "só vão vir as parcelas do ato e sinal, somente". É a mesma definição de
// entrada do `Diag - Entrada Bruta (Contrato)` do Power BI da Careli (aba Financiamento):
// `Perfil de Parcela IN {"Ato","Sinal"}`. As mensais ficam de fora — elas são a carteira, não a
// entrada. `parcel_types` do legado: 1 Ato, 2 Sinal, 3 Parcela, 4 Avulso.
//
// ⚠️ SEM VALOR LÍQUIDO, DE PROPÓSITO (Lucas, 14/08): "não quero valor líquido, quero o cenário de
// pagamentos". O BI antigo desconta a comissão do loteador da entrada e mostra a receita líquida
// — número de DONO, não de coordenador. Quem acompanha a venda precisa saber o que foi gerado, o
// que o cliente quitou, o que ainda vai vencer e o que venceu sem pagar. Se um dia o painel do
// incorporador precisar do líquido, a regra é: comissão do empreendimento
// (`commercial_policies.total_value_commission`, que varia — Vale do Ouro 6%, Vista Alegre 7,5%)
// aplicada sobre o VGV da unidade e descontada INTEIRA da entrada. Fica registrado aqui para não
// precisar redescobrir, mas não entra nesta tela.
//
// Cache de 5 minutos: o legado tem pool curto e esta é uma tela pública — dez coordenadores com a
// aba aberta não podem virar dez consultas.
import type { RowDataPacket } from "mysql2";

import { getHadesDbPool } from "@/lib/guardian/db";

const TTL_MS = 5 * 60 * 1000;

/** `payment_statuses` do C2X: 5 Pago, 6 Aguardando pagamento, 7 Atrasado. */
const PAGO = 5;
const AGUARDANDO = 6;
const ATRASADO = 7;

export type BoletoDoSinal = {
  cliente: string;
  emitidoEm: null | string;
  /** "1/1" no Ato; "2/3" no sinal parcelado; "única" quando não é parcelado. */
  parcela: string;
  pagoEm: null | string;
  /** Sem `payment_asaas_id`: não há link de pagamento ligado à cobrança. */
  semBoleto: boolean;
  status: "a_vencer" | "atrasado" | "outro" | "quitado";
  /** "Ato" ou "Sinal". */
  tipo: string;
  unidade: string;
  valor: number;
  /** O que efetivamente entrou (traz juros e multa quando houve atraso). */
  valorPago: number;
  vencimento: null | string;
};

type Faixa = { n: number; valor: number };

export type ResumoDoSinal = {
  atrasado: Faixa;
  atualizadoEm: string;
  aVencer: Faixa;
  boletos: BoletoDoSinal[];
  /** Tudo que foi gerado no período, pago ou não. */
  gerado: Faixa;
  /** Clientes distintos com entrada gerada. */
  clientes: number;
  quitado: Faixa;
  /** Boletos sem link do Asaas — a fila de conferência do financeiro. */
  semBoleto: number;
  /** Unidades distintas com entrada gerada. */
  unidades: number;
  /** Vence nos próximos 7 dias e ainda não foi pago: é o que o coordenador cobra hoje. */
  vencendo: Faixa;
};

export type ResultadoSinal =
  | { dados: ResumoDoSinal; ok: true }
  | { erro: string; ok: false };

type Bruta = RowDataPacket & {
  asaas_id: null | string;
  cliente: null | string;
  criado: null | string;
  paid_value: null | number | string;
  pago_em: null | string;
  parcela: null | number;
  parcela_total: null | number;
  status: null | number;
  tipo: null | string;
  unidade: null | string;
  valor: null | number | string;
  vencimento: null | string;
};

const CONSULTA = `
  select
    coalesce(nullif(trim(cli.name), ''), 'Sem nome') as cliente,
    coalesce(nullif(trim(u.name), ''), concat(e.code, ' ', coalesce(u.block, ''), coalesce(u.lot, ''))) as unidade,
    pt.name as tipo,
    p.initial_value as valor,
    p.paid_value,
    p.payment_status_id as status,
    date_format(p.due_date, '%Y-%m-%d') as vencimento,
    date_format(p.payment_date, '%Y-%m-%d') as pago_em,
    date_format(p.created_at, '%Y-%m-%d') as criado,
    p.current_signal_parcel as parcela,
    p.total_signal_parcels as parcela_total,
    p.payment_asaas_id as asaas_id
  from payments p
  join acquisition_requests ar on ar.id = p.acquisition_request_id
  join enterprise_unities u on u.id = ar.enterprise_unity_id
  join enterprises e on e.id = u.enterprise_id
  left join parcel_types pt on pt.id = p.parcel_type_id
  left join users cli on cli.id = ar.client_id
  where u.enterprise_id in (?)
    and p.parcel_type_id in (1, 2)
    and p.payment_to_delete = 0
  order by p.due_date, cliente`;

const cache = new Map<string, { dados: ResumoDoSinal; em: number }>();

/** Hoje e daqui a 7 dias, em ISO curto e no fuso de São Paulo (o vencimento é uma DATA, não um instante). */
function janela(): { emSeteDias: string; hoje: string } {
  const agora = new Date();
  const sp = new Date(agora.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const seteDias = new Date(sp);
  seteDias.setDate(seteDias.getDate() + 7);
  return { emSeteDias: iso(seteDias), hoje: iso(sp) };
}

export async function carregarSinal(ids: number[]): Promise<ResultadoSinal> {
  const chave = [...ids].sort((a, b) => a - b).join(",");
  const guardado = cache.get(chave);
  if (guardado && Date.now() - guardado.em < TTL_MS) {
    return { dados: guardado.dados, ok: true };
  }

  const pool = getHadesDbPool();
  if (!pool.ok) {
    // Falha FECHADA, igual ao painel de assinatura: cache velho com carimbo honesto é melhor que
    // painel que some. Quem lê vê "atualizado às …" e sabe o que está olhando.
    if (guardado) return { dados: guardado.dados, ok: true };
    return { erro: `Configuração do C2X ausente: ${pool.missing.join(", ")}.`, ok: false };
  }

  try {
    const [linhas] = await pool.pool.query<Bruta[]>(CONSULTA, [ids]);

    const boletos: BoletoDoSinal[] = linhas.map((linha) => {
      const status = Number(linha.status);
      const tipo = String(linha.tipo ?? "").trim() || "Sinal";
      const total = Number(linha.parcela_total ?? 0);

      return {
        cliente: String(linha.cliente ?? "").trim(),
        emitidoEm: linha.criado,
        // O Ato é sempre parcela única; o sinal pode ser parcelado em até `max_signal_parcels`.
        parcela:
          tipo === "Ato"
            ? "1/1"
            : total > 1
              ? `${Number(linha.parcela ?? 0)}/${total}`
              : "única",
        pagoEm: linha.pago_em,
        semBoleto: String(linha.asaas_id ?? "").trim().length === 0,
        status:
          status === PAGO
            ? "quitado"
            : status === AGUARDANDO
              ? "a_vencer"
              : status === ATRASADO
                ? "atrasado"
                : "outro",
        tipo,
        unidade: String(linha.unidade ?? "").replace(/\s+/g, " ").trim(),
        valor: Number(linha.valor ?? 0),
        valorPago: Number(linha.paid_value ?? 0),
        vencimento: linha.vencimento,
      };
    });

    const faixa = (filtro: (b: BoletoDoSinal) => boolean): Faixa => {
      const doGrupo = boletos.filter(filtro);
      return {
        n: doGrupo.length,
        // No quitado vale o que ENTROU (`paid_value` traz juros e multa); nos demais, o devido.
        valor: doGrupo.reduce(
          (total, b) => total + (b.status === "quitado" ? b.valorPago || b.valor : b.valor),
          0,
        ),
      };
    };

    const { emSeteDias, hoje } = janela();

    const dados: ResumoDoSinal = {
      atrasado: faixa((b) => b.status === "atrasado"),
      atualizadoEm: new Date().toISOString(),
      aVencer: faixa((b) => b.status === "a_vencer"),
      boletos,
      clientes: new Set(boletos.map((b) => b.cliente)).size,
      gerado: faixa(() => true),
      quitado: faixa((b) => b.status === "quitado"),
      semBoleto: boletos.filter((b) => b.semBoleto).length,
      unidades: new Set(boletos.map((b) => b.unidade)).size,
      vencendo: faixa(
        (b) =>
          b.status === "a_vencer" &&
          Boolean(b.vencimento) &&
          b.vencimento! >= hoje &&
          b.vencimento! <= emSeteDias,
      ),
    };

    cache.set(chave, { dados, em: Date.now() });
    return { dados, ok: true };
  } catch (error) {
    console.error("[painel-sinal] falha ao ler o C2X", error);
    if (guardado) return { dados: guardado.dados, ok: true };
    return { erro: "Não foi possível ler o C2X agora.", ok: false };
  }
}
