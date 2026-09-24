import { type ExtratoClienteParcelaBruta, TIPO_MENSAL } from "@/lib/apolo/extrato-cliente";
import {
  defasagemDoContrato,
  type LinhaDaDefasagem,
  resumirDefasagem,
  type ResumoDaDefasagem,
} from "@/lib/apolo/reajuste/defasagem";
import { EXCLUDED_ENTERPRISE_CODES } from "@/lib/guardian/c2x-analytics";
import { getHadesDbPool } from "@/lib/guardian/db";

// A LEITURA DA DEFASAGEM NO C2X — read-only, uma consulta só.
//
// ⚠️ UMA CONSULTA PARA A CARTEIRA INTEIRA, e não uma por contrato. São 118.033 mensais em 874
// contratos, e a leitura fecha em 1,6 s; 874 consultas seriadas levariam minutos e derrubariam a
// rota no teto da Vercel. A régua (`defasagemDoContrato`) é PURA e roda sobre o que voltou.
//
// ⚠️ A RÉGUA NÃO MORA AQUI. Esta camada só busca e monta; quem decide o que é defasagem é
// `defasagem.ts`, que tem teste. Foi assim que o extrato evitou ter duas contas do mesmo número.

const LOTE = 20000;
const TETO = 200000;

type LinhaCrua = {
  ar: number | string;
  boletoUrl: null | string;
  cliente: null | string;
  code: string;
  competencia: null | string;
  descricao: null | string;
  faturaUrl: null | string;
  id: number;
  juros: null | number;
  multa: null | number;
  pagamento: null | string;
  parcelaAtual: null | number;
  parcelaTotal: null | number;
  sinalAtual: null | number;
  sinalTotal: null | number;
  statusId: null | number;
  tipo: null | string;
  tipoId: number;
  unidade: null | string;
  valorInicial: null | number;
  valorPago: null | number;
  vencimento: null | string;
};

function paraBruta(linha: LinhaCrua): ExtratoClienteParcelaBruta {
  return {
    // A consulta já exclui as marcadas para exclusão; o campo fica por simetria com o extrato.
    aExcluir: false,
    boletoUrl: linha.boletoUrl,
    competencia: linha.competencia,
    descricao: linha.descricao,
    faturaUrl: linha.faturaUrl,
    id: Number(linha.id),
    juros: Number(linha.juros ?? 0),
    multa: Number(linha.multa ?? 0),
    pagamento: linha.pagamento,
    parcelaAtual: linha.parcelaAtual == null ? null : Number(linha.parcelaAtual),
    parcelaTotal: linha.parcelaTotal == null ? null : Number(linha.parcelaTotal),
    sinalAtual: linha.sinalAtual == null ? null : Number(linha.sinalAtual),
    sinalTotal: linha.sinalTotal == null ? null : Number(linha.sinalTotal),
    statusId: Number(linha.statusId ?? 0),
    tipo: linha.tipo,
    tipoId: Number(linha.tipoId),
    valorInicial: Number(linha.valorInicial ?? 0),
    valorPago: Number(linha.valorPago ?? 0),
    vencimento: linha.vencimento,
  };
}

export type CarteiraComDefasagem = {
  linhas: LinhaDaDefasagem[];
  /** `true` = a leitura bateu no teto e a lista NÃO é completa. A tela avisa. */
  parcial: boolean;
  resumo: ResumoDaDefasagem;
};

/**
 * Mede a defasagem de toda a carteira, ou dos códigos pedidos.
 *
 * @param codes Códigos de empreendimento. Vazio = a carteira inteira.
 */
export async function carregarDefasagem(
  codes: string[] = [],
): Promise<{ data: CarteiraComDefasagem; ok: true } | { error: string; ok: false }> {
  const pool = getHadesDbPool();
  if (!pool.ok) {
    return { error: `Configuracao C2X ausente: ${pool.missing.join(", ")}.`, ok: false };
  }

  const pedidos = [...new Set(codes.map((c) => c.trim().toUpperCase()).filter(Boolean))];
  const excluidos = EXCLUDED_ENTERPRISE_CODES.map(() => "?").join(", ");
  const filtroDeCodigo = pedidos.length > 0 ? `and e.code in (${pedidos.map(() => "?").join(", ")})` : "";

  const cruas: LinhaCrua[] = [];
  let cursor = 0;
  let parcial = false;

  try {
    for (;;) {
      const [lote] = await pool.pool.query(
        `select
           p.acquisition_request_id                  as ar,
           e.code                                    as code,
           trim(concat(coalesce(eu.block, ''), ' ', coalesce(eu.lot, ''))) as unidade,
           coalesce(nullif(trim(cli.name), ''), nullif(trim(cli.social_name), '')) as cliente,
           p.id                                      as id,
           p.current_total_parcel                    as parcelaAtual,
           p.total_parcels                           as parcelaTotal,
           p.current_signal_parcel                   as sinalAtual,
           p.total_signal_parcels                    as sinalTotal,
           p.parcel_type_id                          as tipoId,
           pt.name                                   as tipo,
           p.payment_status_id                       as statusId,
           p.initial_value                           as valorInicial,
           p.paid_value                              as valorPago,
           p.interest_value                          as juros,
           p.mulct_value                             as multa,
           p.description                             as descricao,
           p.payment_asaas_url                       as boletoUrl,
           p.payment_asaas_invoice_url               as faturaUrl,
           date_format(p.due_date, '%Y-%m-%d')       as vencimento,
           date_format(p.payment_date, '%Y-%m-%d')   as pagamento,
           date_format(p.reference_date, '%Y-%m-%d') as competencia
         from payments p
         join acquisition_requests ar on ar.id = p.acquisition_request_id
         join enterprise_unities eu on eu.id = ar.enterprise_unity_id
         join enterprises e on e.id = eu.enterprise_id
         left join parcel_types pt on pt.id = p.parcel_type_id
         left join users cli on cli.id = ar.client_id
        where p.parcel_type_id = ${TIPO_MENSAL}
          and coalesce(p.payment_to_delete, 0) = 0
          and e.code not in (${excluidos})
          ${filtroDeCodigo}
          and p.id > ?
        order by p.id asc
        limit ${LOTE}`,
        [...EXCLUDED_ENTERPRISE_CODES, ...pedidos, cursor],
      );

      const linhas = lote as LinhaCrua[];
      cruas.push(...linhas);

      if (linhas.length < LOTE) break;
      if (cruas.length >= TETO) {
        parcial = true;
        break;
      }
      cursor = Number(linhas.at(-1)?.id ?? 0);
    }
  } catch (erro) {
    console.error("[apolo][defasagem] falha ao ler o C2X", erro);
    return { error: "Não foi possível ler a carteira agora.", ok: false };
  }

  const porContrato = new Map<string, LinhaCrua[]>();
  for (const linha of cruas) {
    const chave = String(linha.ar);
    porContrato.set(chave, [...(porContrato.get(chave) ?? []), linha]);
  }

  const linhas: LinhaDaDefasagem[] = [];
  for (const [contrato, doContrato] of porContrato) {
    const primeira = doContrato[0];
    linhas.push({
      cliente: primeira?.cliente ?? null,
      code: primeira?.code ?? "",
      contratoId: contrato,
      defasagem: defasagemDoContrato(doContrato.map(paraBruta)),
      unidade: String(primeira?.unidade ?? "").trim(),
    });
  }

  // O maior rombo primeiro: é por ele que a operação começa.
  linhas.sort((a, b) => b.defasagem.porParcela - a.defasagem.porParcela);

  return { data: { linhas, parcial, resumo: resumirDefasagem(linhas) }, ok: true };
}
