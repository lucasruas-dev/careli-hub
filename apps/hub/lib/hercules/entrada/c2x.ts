import type { RowDataPacket } from "mysql2/promise";

import { type ConexaoDeLeitura, instanteDeBrasilia, LOTE_DO_IN_NO_C2X } from "@/lib/assinatura/espelho-d4sign/c2x";

import type { PedidoDoTerreno } from "./elo";
import type { ParcelaDoC2x, PedidoDoC2x } from "./regra";

// O QUE O CARD DO PRÉ-FATURAMENTO LÊ NO C2X: o pedido do envio da D4Sign, os pedidos do terreno das
// nativas da Clicksign e as parcelas de Ato, Sinal e Avulso do pedido. SÓ SELECT, numa conexão com
// `START TRANSACTION READ ONLY` (quem abre e fecha é `ler-entrada.ts`, com `abrirLeituraDoC2x`/
// `fecharLeituraDoC2x` do espelho da D4Sign, a mesma trava).
//
// ⚠️ SÃO AS CONSULTAS DA F8 (`lib/hercules/faturamento/pagamento-c2x.ts`, branch local
// fix/assinatura-fonte-unica) com o que faltava a elas, medido em 02/10/2026: `initial_value` (o Ato
// de R$ 0,00 das vendas redigitadas) e o tipo 4, Avulso (o REP D L163 pagou a entrada em dois
// Avulso). E `total_signal_parcels`, para a tela escrever "Sinal 1/3".
//
// ⚠️ O TETO DE CADA CONSULTA É CURTO (`TIMEOUT_DA_CONSULTA_NA_TELA_MS`), E NÃO OS 20 s DO ESPELHO: aqui
// tem uma pessoa esperando o card abrir. Passou do tempo, a tela diz que não conseguiu ler.
//
// ⚠️ O DOCUMENTO DO COMPRADOR (consulta 2) VIVE SÓ EM MEMÓRIA: devolvido em `PedidoDoTerreno` para o
// elo comparar e descartar; nunca gravado, logado nem devolvido à rota.
//
// ⚠️ AS DATAS SAEM COMO TEXTO (`date_format`): `due_date` e `payment_date` são DATE, e o pool fala UTC;
// um `new Date` do driver poderia mudar o dia. O `updated_at` (DATETIME, Brasília sem fuso) sai como
// texto e vira ISO com `-03:00` por `instanteDeBrasilia`.

/** O teto de UMA consulta feita com o card abrindo. */
export const TIMEOUT_DA_CONSULTA_NA_TELA_MS = 5_000;

/** (1) O pedido de um envio da D4Sign (`contract_signatures.id`). */
export const SQL_PEDIDO_DO_ENVIO = `select arc.acquisition_request_id as ar_id
  from contract_signatures cs
  join acquisition_request_contracts arc on arc.id = cs.acquisition_request_contract_id
 where cs.id = ?`;

/**
 * (2) Os pedidos das unidades do terreno, com o documento do comprador (EM MEMÓRIA).
 *
 * ⚠️ SÓ OS ESTÁGIOS QUE PODEM SER O PEDIDO DO BOLETO (2 a 6 e 9, `ESTAGIOS_DO_PEDIDO_DO_BOLETO`): o
 * filtro é no SQL para não trazer o documento de terceiros de reservas e de pedidos desfeitos. O teste
 * confere que a lista daqui é a mesma do elo.
 */
export const SQL_PEDIDOS_DAS_UNIDADES = `select ar.id as ar_id,
       ar.acquisition_request_stage_id as estagio,
       client.cpf as documento
  from acquisition_requests ar
  left join users client on client.id = ar.client_id
 where ar.enterprise_unity_id in (?)
   and ar.acquisition_request_stage_id in (2, 3, 4, 5, 6, 9)`;

/** (3) O estágio do pedido e as parcelas de Ato, Sinal e Avulso (todas: quem filtra é a regra). */
export const SQL_PARCELAS_DA_ENTRADA = `select ar.id as ar_id,
       ar.acquisition_request_stage_id as estagio,
       p.id as parcela_id,
       p.parcel_type_id as tipo,
       p.payment_status_id as status,
       p.initial_value as valor,
       date_format(p.due_date, '%Y-%m-%d') as vencimento,
       date_format(p.payment_date, '%Y-%m-%d') as pago_em,
       date_format(p.updated_at, '%Y-%m-%d %H:%i:%s') as marcado_em_brasilia,
       p.current_signal_parcel as parcela_do_sinal,
       p.total_signal_parcels as total_do_sinal,
       coalesce(p.payment_to_delete, 0) as apagada
  from acquisition_requests ar
  left join payments p on p.acquisition_request_id = ar.id and p.parcel_type_id in (1, 2, 4)
 where ar.id = ?
 order by p.id`;

type LinhaDoEnvio = RowDataPacket & { ar_id: number | string };
type LinhaDoPedidoDaUnidade = RowDataPacket & {
  ar_id: number | string;
  documento: null | string;
  estagio: null | number | string;
};
type LinhaDaParcela = RowDataPacket & {
  apagada: null | number | string;
  ar_id: number | string;
  estagio: null | number | string;
  marcado_em_brasilia: null | string;
  pago_em: null | string;
  parcela_do_sinal: null | number | string;
  parcela_id: null | number | string;
  status: null | number | string;
  tipo: null | number | string;
  total_do_sinal: null | number | string;
  /** DECIMAL: o mysql2 devolve texto ("1000.00"). */
  valor: null | number | string;
  vencimento: null | string;
};

const inteiro = (valor: unknown): null | number => {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isSafeInteger(n) ? n : null;
};

const texto = (valor: unknown): null | string => {
  const t = valor === null || valor === undefined ? "" : String(valor).trim();
  return t || null;
};

const reais = (valor: unknown): null | number => {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
};

/** (1) O pedido do envio, ou `null` quando o C2X não o tem. */
export async function pedidoDoEnvio(conexao: ConexaoDeLeitura, csId: number): Promise<null | number> {
  const [linhas] = await conexao.query<LinhaDoEnvio[]>(
    { sql: SQL_PEDIDO_DO_ENVIO, timeout: TIMEOUT_DA_CONSULTA_NA_TELA_MS },
    [csId],
  );
  return inteiro(linhas[0]?.ar_id);
}

/** (2) Os pedidos das unidades do C2X, com os dígitos do documento do comprador EM MEMÓRIA. */
export async function pedidosDasUnidades(
  conexao: ConexaoDeLeitura,
  unidadesC2x: readonly number[],
): Promise<PedidoDoTerreno[]> {
  const unicas = [...new Set(unidadesC2x)];
  const pedidos: PedidoDoTerreno[] = [];
  for (let i = 0; i < unicas.length; i += LOTE_DO_IN_NO_C2X) {
    const [linhas] = await conexao.query<LinhaDoPedidoDaUnidade[]>(
      { sql: SQL_PEDIDOS_DAS_UNIDADES, timeout: TIMEOUT_DA_CONSULTA_NA_TELA_MS },
      [unicas.slice(i, i + LOTE_DO_IN_NO_C2X)],
    );
    for (const l of linhas) {
      const ar = inteiro(l.ar_id);
      if (ar === null) continue;
      pedidos.push({
        arId: ar,
        documentoDoComprador: String(l.documento ?? "").replace(/\D/g, ""),
        estagio: inteiro(l.estagio),
      });
    }
  }
  return pedidos;
}

/** (3) O pedido com o estágio e as parcelas de Ato, Sinal e Avulso. `null` = o C2X não tem o pedido. */
export async function pedidoComAEntrada(conexao: ConexaoDeLeitura, arId: number): Promise<null | PedidoDoC2x> {
  const [linhas] = await conexao.query<LinhaDaParcela[]>(
    { sql: SQL_PARCELAS_DA_ENTRADA, timeout: TIMEOUT_DA_CONSULTA_NA_TELA_MS },
    [arId],
  );
  if (linhas.length === 0) return null;
  const parcelas: ParcelaDoC2x[] = [];
  for (const l of linhas) {
    const id = inteiro(l.parcela_id);
    const tipo = inteiro(l.tipo);
    if (id === null || tipo === null) continue;
    parcelas.push({
      apagada: Number(l.apagada ?? 0) !== 0,
      id,
      marcadoEm: instanteDeBrasilia(texto(l.marcado_em_brasilia)),
      pagoEm: texto(l.pago_em),
      parcelaDoSinal: inteiro(l.parcela_do_sinal),
      status: inteiro(l.status),
      tipo,
      totalDoSinal: inteiro(l.total_do_sinal),
      valor: reais(l.valor),
      vencimento: texto(l.vencimento),
    });
  }
  return { arId, estagio: inteiro(linhas[0]?.estagio), parcelas };
}
