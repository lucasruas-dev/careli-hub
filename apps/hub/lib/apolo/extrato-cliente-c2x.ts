// LEITURA DO C2X para o EXTRATO DO CLIENTE COMPRADOR (read-only, MySQL legado).
//
// Só o acesso ao banco mora aqui. A régua — o que é pago, o que entra no saldo, o que é
// reajuste — está em `extrato-cliente.ts`, que é puro justamente para poder ser importado pelo
// painel client-side sem arrastar o driver MySQL para o bundle.
//
// Nunca lança: C2X indisponível vira `{ ok: false, error }`, como nas libs vizinhas.
import type { RowDataPacket } from "mysql2";
import type { Pool } from "mysql2/promise";

import {
  hojeEmBrasilia,
  mascararDocumento,
  montarExtratoDoContrato,
  type ExtratoClienteContrato,
  type ExtratoClienteData,
  type ExtratoClienteParcelaBruta,
  type ExtratoClienteTitular,
} from "@/lib/apolo/extrato-cliente";
import { EXCLUDED_ENTERPRISE_CODES } from "@/lib/guardian/c2x-analytics";
import { getHadesDbPool } from "@/lib/guardian/db";

/** Estágios que encerram o contrato: o extrato sai só com o histórico pago, sem saldo. */
const ESTAGIOS_ENCERRADOS = [7, 10, 11];

export type ExtratoClienteResultado =
  | { data: ExtratoClienteData; ok: true }
  | { error: string; ok: false };

// ────────────────────────────────────────────────────────────────────────────────────────────
// LEITURA DO C2X (read-only). Nunca lança: indisponibilidade vira { ok:false, error }.
// ────────────────────────────────────────────────────────────────────────────────────────────

type ContratoRow = RowDataPacket & {
  act_date: null | string;
  area: null | number | string;
  block: null | string;
  client_1: null | number;
  client_2: null | number;
  client_3: null | number;
  client_4: null | number;
  client_5: null | number;
  contractual_interest: null | number | string;
  enterprise_code: null | string;
  enterprise_name: null | string;
  id: number;
  index_name: null | string;
  custom_plan: null | number;
  lot: null | string;
  parcels: null | number;
  percentage_1: null | number | string;
  percentage_2: null | number | string;
  percentage_3: null | number | string;
  percentage_4: null | number | string;
  percentage_5: null | number | string;
  price: null | number | string;
  sign_date: null | string;
  stage_id: number;
  stage_name: null | string;
  unity: null | string;
};

type ParcelaRow = RowDataPacket & {
  acquisition_request_id: number;
  current_signal_parcel: null | number;
  current_total_parcel: null | number;
  description: null | string;
  due_date: null | string;
  id: number;
  initial_value: null | number | string;
  interest_value: null | number | string;
  mulct_value: null | number | string;
  paid_value: null | number | string;
  parcel_type_id: number;
  parcel_type_name: null | string;
  payment_asaas_invoice_url: null | string;
  payment_asaas_url: null | string;
  payment_date: null | string;
  payment_status_id: number;
  payment_to_delete: null | number;
  reference_date: null | string;
  total_parcels: null | number;
  total_signal_parcels: null | number;
};

type PessoaRow = RowDataPacket & {
  cnpj: null | string;
  cpf: null | string;
  id: number;
  name: null | string;
};

export type ExtratoClienteEscopo = {
  /** `users.id` do C2X — o mesmo que a entidade do Apolo guarda como c2xId. */
  c2xId: number;
  /** Opcional: recorta num contrato só (`acquisition_requests.id`). */
  contratoId?: null | number;
  /** Opcional (testes/relatório retroativo). Default: hoje em Brasília. */
  hoje?: string;
};

export async function loadExtratoDoCliente(
  escopo: ExtratoClienteEscopo,
): Promise<ExtratoClienteResultado> {
  const hoje = escopo.hoje ?? hojeEmBrasilia();

  if (!Number.isInteger(escopo.c2xId) || escopo.c2xId <= 0) {
    return {
      data: {
        cliente: { c2xId: 0, documentoMascarado: null, nome: null },
        contratos: [],
        posicaoEm: hoje,
      },
      ok: true,
    };
  }

  const poolResult = getHadesDbPool();

  if (!poolResult.ok) {
    return {
      error: `Configuracao C2X ausente: ${poolResult.missing.join(", ")}.`,
      ok: false,
    };
  }

  const excluidos = EXCLUDED_ENTERPRISE_CODES.map(() => "?").join(", ");

  try {
    // ⚠️ O COMPRADOR PODE SER O COADQUIRENTE. O C2X guarda até cinco titulares na mesma linha
    // (`client_id` + `client_2_id`..`client_5_id`); filtrar só por `client_id` faria o extrato
    // de quem comprou junto voltar vazio.
    //
    // ⚠️ E NÃO FILTRAMOS POR ESTÁGIO ATIVO. Quem cancelou é justamente quem liga pedindo o
    // extrato (para pedir devolução). O critério é ter carteira: pelo menos uma parcela ativa —
    // e, como parcela paga tem status 5, isso já inclui o histórico de quem cancelou.
    //
    // ⚠️ O PLANO VEM DE `ar.commercial_plan_id`, NÃO de `commercial_plans.acquisition_request_id`.
    // Medido em 27/08/2026: o segundo caminho traz o índice de correção em 502 contratos de
    // 4.817; o primeiro, em 2.876 — todos os que têm plano. Era por isso que LOU aparecia "sem
    // índice" quando na verdade é IPCA ANUAL.
    const [contratoRows] = await poolResult.pool.query<ContratoRow[]>(
      `select
         ar.id,
         ar.acquisition_request_stage_id as stage_id,
         ars.name as stage_name,
         date_format(ar.act_date, '%Y-%m-%d') as act_date,
         date_format(ar.sign_date, '%Y-%m-%d') as sign_date,
         ar.client_id as client_1,
         ar.client_2_id as client_2,
         ar.client_3_id as client_3,
         ar.client_4_id as client_4,
         ar.client_5_id as client_5,
         ar.percentage_client_1 as percentage_1,
         ar.percentage_client_2 as percentage_2,
         ar.percentage_client_3 as percentage_3,
         ar.percentage_client_4 as percentage_4,
         ar.percentage_client_5 as percentage_5,
         eu.name as unity,
         eu.block,
         eu.lot,
         eu.area,
         eu.price,
         e.code as enterprise_code,
         e.name as enterprise_name,
         cp.parcels,
         cp.contractual_interest,
         imc.name as index_name,
         -- O C2X MARCA O PLANO PERSONALIZADO, e a gente ignorava: custom_commercial_plan e 1 em
         -- 428 contratos. Neles o plano comercial e ponto de partida, nao descricao, e e por isso
         -- que o parcelamento do molde discordava do contrato.
         ar.custom_commercial_plan as custom_plan
       from acquisition_requests ar
       join enterprise_unities eu on eu.id = ar.enterprise_unity_id
       join enterprises e on e.id = eu.enterprise_id
       left join acquisition_request_stages ars on ars.id = ar.acquisition_request_stage_id
       left join commercial_plans cp on cp.id = ar.commercial_plan_id
       left join index_monetary_corrections imc on imc.id = cp.index_monetary_correction_id
       where ? in (ar.client_id, ar.client_2_id, ar.client_3_id, ar.client_4_id, ar.client_5_id)
         and e.code not in (${excluidos})
         and exists (
           select 1 from payments p
            where p.acquisition_request_id = ar.id
              and coalesce(p.payment_to_delete, 0) = 0
              and p.payment_status_id in (5, 6, 7)
         )
       order by e.code, eu.name
       limit 60`,
      [escopo.c2xId, ...EXCLUDED_ENTERPRISE_CODES],
    );

    const filtrados = escopo.contratoId
      ? contratoRows.filter((row) => row.id === escopo.contratoId)
      : contratoRows;

    if (!filtrados.length) {
      const clienteVazio = await carregarPessoas(poolResult.pool, [escopo.c2xId]);
      const eu = clienteVazio.get(escopo.c2xId);

      return {
        data: {
          cliente: {
            c2xId: escopo.c2xId,
            documentoMascarado: mascararDocumento(eu?.documento ?? null),
            nome: eu?.nome ?? null,
          },
          contratos: [],
          posicaoEm: hoje,
        },
        ok: true,
      };
    }

    const ids = filtrados.map((row) => row.id);
    const marcadores = ids.map(() => "?").join(", ");

    const [parcelaRows] = await poolResult.pool.query<ParcelaRow[]>(
      `select
         p.id,
         p.acquisition_request_id,
         p.parcel_type_id,
         pt.name as parcel_type_name,
         p.payment_status_id,
         p.payment_to_delete,
         date_format(p.reference_date, '%Y-%m-%d') as reference_date,
         date_format(p.due_date, '%Y-%m-%d') as due_date,
         date_format(p.payment_date, '%Y-%m-%d') as payment_date,
         p.initial_value,
         p.paid_value,
         p.interest_value,
         p.mulct_value,
         p.current_signal_parcel,
         p.total_signal_parcels,
         p.current_total_parcel,
         p.total_parcels,
         nullif(trim(p.payment_asaas_url), '') as payment_asaas_url,
         nullif(trim(p.payment_asaas_invoice_url), '') as payment_asaas_invoice_url,
         p.description
       from payments p
       left join parcel_types pt on pt.id = p.parcel_type_id
       where p.acquisition_request_id in (${marcadores})
         and coalesce(p.payment_to_delete, 0) = 0
         and p.payment_status_id in (5, 6, 7)
       order by p.acquisition_request_id, p.parcel_type_id, p.current_total_parcel, p.due_date, p.id`,
      ids,
    );

    const pessoasIds = new Set<number>([escopo.c2xId]);
    for (const row of filtrados) {
      for (const id of [row.client_1, row.client_2, row.client_3, row.client_4, row.client_5]) {
        if (id) {
          pessoasIds.add(id);
        }
      }
    }
    const pessoas = await carregarPessoas(poolResult.pool, Array.from(pessoasIds));

    const porContrato = new Map<number, ExtratoClienteParcelaBruta[]>();
    for (const row of parcelaRows) {
      const lista = porContrato.get(row.acquisition_request_id) ?? [];
      lista.push(mapearParcela(row));
      porContrato.set(row.acquisition_request_id, lista);
    }

    const contratos = filtrados
      .map((row) => {
        const parcelas = porContrato.get(row.id) ?? [];

        // ⚠️ `commercial_plans.parcels` É O MOLDE DO PRODUTO, NÃO O CONTRATO. Medido em
        // 02/09/2026: 256 contratos usam o plano 340 ("PLANO-NORMAL", que diz 144x) e CINCO deles
        // têm outra contagem — 60, 24, 100, 3 e 1. O TIAGO EUSTAQUIO (LOS0302) é um deles: o
        // extrato dele estampava "Plano: 144x - IPCA ANUAL" no topo e "27 de 62 parcelas
        // quitadas" logo abaixo, os dois números na mesma página, discordando.
        //
        // ⚠️ QUEM SABE O TAMANHO DO CONTRATO É A PARCELA. `payments.total_parcels` é gravado pelo
        // próprio C2X em cada linha e diz 60 para este contrato. O molde só entra quando não há
        // parcela nenhuma para perguntar.
        const doRegistro = parcelas
          .map((parcela) => parcela.parcelaTotal)
          .filter((n): n is number => typeof n === "number" && n > 0);
        const contrato = mapearContrato(row, pessoas);

        return montarExtratoDoContrato({
          contrato: {
            ...contrato,
            planoParcelas: doRegistro.length > 0 ? Math.max(...doRegistro) : contrato.planoParcelas,
          },
          hoje,
          parcelas,
        });
      })
      // Contrato sem nenhuma linha ativa não vira peça (não deveria acontecer — o EXISTS já
      // garante —, mas o extrato é entregue ao cliente e uma página em branco é pior que nada).
      .filter((relatorio) => relatorio.totais.parcelasTotal > 0);

    const eu = pessoas.get(escopo.c2xId);

    return {
      data: {
        cliente: {
          c2xId: escopo.c2xId,
          documentoMascarado: mascararDocumento(eu?.documento ?? null),
          nome: eu?.nome ?? null,
        },
        contratos,
        posicaoEm: hoje,
      },
      ok: true,
    };
  } catch (error) {
    console.error("[apolo][extrato-cliente] falha ao carregar o extrato do comprador", error);
    return { error: "Nao foi possivel carregar o extrato do cliente.", ok: false };
  }
}

type PessoaMap = Map<number, { documento: null | string; nome: string }>;

async function carregarPessoas(pool: Pool, ids: number[]): Promise<PessoaMap> {
  const mapa: PessoaMap = new Map();

  if (!ids.length) {
    return mapa;
  }

  const marcadores = ids.map(() => "?").join(", ");
  const [rows] = await pool.query<PessoaRow[]>(
    `select
       u.id,
       coalesce(nullif(trim(u.name), ''), nullif(trim(u.fantasy_name), ''), nullif(trim(u.social_name), '')) as name,
       u.cpf,
       u.cnpj
     from users u
     where u.id in (${marcadores})`,
    ids,
  );

  for (const row of rows) {
    mapa.set(row.id, {
      documento: texto(row.cpf) ?? texto(row.cnpj),
      nome: texto(row.name) ?? `Cliente ${row.id}`,
    });
  }

  return mapa;
}

function mapearContrato(row: ContratoRow, pessoas: PessoaMap): ExtratoClienteContrato {
  const slots: Array<[null | number, null | number | string]> = [
    [row.client_1, row.percentage_1],
    [row.client_2, row.percentage_2],
    [row.client_3, row.percentage_3],
    [row.client_4, row.percentage_4],
    [row.client_5, row.percentage_5],
  ];

  const titulares: ExtratoClienteTitular[] = slots
    .map(([id, percentual], indice) => {
      if (!id) {
        return null;
      }
      const pessoa = pessoas.get(id);
      const documento = pessoa?.documento ?? null;

      // ⚠️ SÓ O MASCARADO ATRAVESSA. O CPF/CNPJ inteiro não tem consumidor (nem a tela nem o
      // PDF o leem) e o JSON desta rota vira o extrato que circula por WhatsApp e e-mail.
      return {
        documentoMascarado: mascararDocumento(documento),
        nome: pessoa?.nome ?? `Cliente ${id}`,
        ordem: indice + 1,
        percentual: numeroOuNulo(percentual),
      };
    })
    .filter((titular): titular is ExtratoClienteTitular => titular !== null);

  return {
    area: numeroOuNulo(row.area),
    codigo: texto(row.unity) ?? `Contrato ${row.id}`,
    dataAssinatura: texto(row.sign_date),
    dataAto: texto(row.act_date),
    empreendimentoCodigo: texto(row.enterprise_code) ?? "-",
    empreendimentoNome: texto(row.enterprise_name),
    encerrado: ESTAGIOS_ENCERRADOS.includes(row.stage_id),
    estagio: row.stage_id,
    estagioNome: texto(row.stage_name),
    id: row.id,
    indiceCorrecao: texto(row.index_name),
    jurosContratuais: numeroOuNulo(row.contractual_interest),
    lote: texto(row.lot),
    planoPadraoParcelas: numeroOuNulo(row.parcels),
    planoParcelas: numeroOuNulo(row.parcels),
    planoPersonalizado: Boolean(row.custom_plan),
    precoTabela: numeroOuNulo(row.price),
    quadra: texto(row.block),
    titulares,
  };
}

function mapearParcela(row: ParcelaRow): ExtratoClienteParcelaBruta {
  return {
    aExcluir: Boolean(row.payment_to_delete),
    boletoUrl: texto(row.payment_asaas_url),
    competencia: texto(row.reference_date),
    descricao: texto(row.description),
    faturaUrl: texto(row.payment_asaas_invoice_url),
    id: row.id,
    juros: numero(row.interest_value),
    multa: numero(row.mulct_value),
    pagamento: texto(row.payment_date),
    parcelaAtual: numeroOuNulo(row.current_total_parcel),
    parcelaTotal: numeroOuNulo(row.total_parcels),
    sinalAtual: numeroOuNulo(row.current_signal_parcel),
    sinalTotal: numeroOuNulo(row.total_signal_parcels),
    statusId: row.payment_status_id,
    tipo: texto(row.parcel_type_name),
    tipoId: row.parcel_type_id,
    valorInicial: numero(row.initial_value),
    valorPago: numero(row.paid_value),
    vencimento: texto(row.due_date),
  };
}

function numero(valor: null | number | string | undefined): number {
  const parsed = typeof valor === "number" ? valor : Number(valor ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function numeroOuNulo(valor: null | number | string | undefined): null | number {
  if (valor === null || valor === undefined || valor === "") {
    return null;
  }
  const parsed = Number(valor);
  return Number.isFinite(parsed) ? parsed : null;
}

function texto(valor: null | string | undefined): null | string {
  const trimmed = typeof valor === "string" ? valor.trim() : "";
  return trimmed ? trimmed : null;
}
