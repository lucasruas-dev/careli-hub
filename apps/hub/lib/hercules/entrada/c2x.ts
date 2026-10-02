import type { RowDataPacket } from "mysql2/promise";

import { type ConexaoDeLeitura, instanteDeBrasilia, LOTE_DO_IN_NO_C2X } from "@/lib/assinatura/espelho-d4sign/c2x";
import { emBrasilia } from "@/lib/assinatura/instante";

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
// ⚠️ O DOCUMENTO DO COMPRADOR (consultas 2 e 4) VIVE SÓ EM MEMÓRIA: devolvido em `PedidoDoTerreno`
// para o elo comparar e descartar; nunca gravado, logado nem devolvido à rota.
//
// ⚠️ AS DATAS SAEM COMO TEXTO (`date_format`): `due_date` e `payment_date` são DATE, e o pool fala UTC;
// um `new Date` do driver poderia mudar o dia. O `updated_at` e o `created_at` (DATETIME, Brasília
// sem fuso) saem como texto e viram ISO com `-03:00` por `instanteDeBrasilia`.

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
 *
 * ⚠️ E O `created_at`, COMO TEXTO (revisão de 02/10/2026): o pedido que nasceu ANTES da venda não
 * casa sozinho (o 5032 do VOR Q14 L01 era de uma proposta cancelada; `elo.ts`).
 */
export const SQL_PEDIDOS_DAS_UNIDADES = `select ar.id as ar_id,
       ar.acquisition_request_stage_id as estagio,
       date_format(ar.created_at, '%Y-%m-%d %H:%i:%s') as criado_em_brasilia,
       client.cpf as documento
  from acquisition_requests ar
  left join users client on client.id = ar.client_id
 where ar.enterprise_unity_id in (?)
   and ar.acquisition_request_stage_id in (2, 3, 4, 5, 6, 9)`;

/**
 * (3) O estágio do pedido, as parcelas de Ato, Sinal e Avulso (todas: quem filtra é a regra) e
 * quantas parcelas o pedido tem ao todo.
 *
 * ⚠️ `total_de_parcelas` CONTA TODOS OS TIPOS (a mensal também), fora as marcadas para apagar, que a
 * regra já trata como inexistentes (revisão de 02/10/2026). Zero = o financeiro do pedido não foi
 * lançado no C2X, e a tela diz isso em vez de "não tem Ato nem Sinal com valor".
 */
export const SQL_PARCELAS_DA_ENTRADA = `select ar.id as ar_id,
       ar.acquisition_request_stage_id as estagio,
       (select count(*)
          from payments todas
         where todas.acquisition_request_id = ar.id
           and coalesce(todas.payment_to_delete, 0) = 0) as total_de_parcelas,
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

/**
 * (4) Os pedidos CANCELADOS OU DISTRATADOS das unidades do terreno, nascidos a partir da venda, com o
 * documento do comprador (EM MEMÓRIA).
 *
 * ⚠️ SÓ É LIDA QUANDO NÃO SOBROU CANDIDATO VIVO DO COMPRADOR (`olhaOsDesfeitos`), e o corte pela data
 * da venda é NO SQL (revisão de 02/10/2026): o documento de terceiros de pedidos desfeitos antigos nem
 * sai do C2X. Os estágios são os de `ESTAGIOS_DESFEITOS_NO_C2X` (o teste confere). O parâmetro da data
 * é a hora de parede de Brasília (`paredeDeBrasilia`), porque o `created_at` é Brasília sem fuso.
 */
export const SQL_PEDIDOS_DESFEITOS_DAS_UNIDADES = `select ar.id as ar_id,
       ar.acquisition_request_stage_id as estagio,
       date_format(ar.created_at, '%Y-%m-%d %H:%i:%s') as criado_em_brasilia,
       client.cpf as documento
  from acquisition_requests ar
  left join users client on client.id = ar.client_id
 where ar.enterprise_unity_id in (?)
   and ar.acquisition_request_stage_id in (7, 8, 10, 11)
   and ar.created_at >= ?`;

type LinhaDoEnvio = RowDataPacket & { ar_id: number | string };
type LinhaDoPedidoDaUnidade = RowDataPacket & {
  ar_id: number | string;
  criado_em_brasilia: null | string;
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
  total_de_parcelas: null | number | string;
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

/**
 * O instante (ISO, qualquer fuso) como a HORA DE PAREDE DE BRASÍLIA (`AAAA-MM-DD HH:MM:SS`), que é
 * como o C2X grava o `created_at`. `null` quando não dá para ler.
 *
 * ⚠️ TEXTO, E NÃO `Date`, NO PARÂMETRO: o pool fala UTC (`timezone: "Z"`), e um `Date` viraria a hora
 * de Greenwich, três horas adiante do que o C2X compara.
 */
export function paredeDeBrasilia(iso: null | string | undefined): null | string {
  const comFuso = emBrasilia(iso);
  return comFuso ? `${comFuso.slice(0, 10)} ${comFuso.slice(11, 19)}` : null;
}

/** (1) O pedido do envio, ou `null` quando o C2X não o tem. */
export async function pedidoDoEnvio(conexao: ConexaoDeLeitura, csId: number): Promise<null | number> {
  const [linhas] = await conexao.query<LinhaDoEnvio[]>(
    { sql: SQL_PEDIDO_DO_ENVIO, timeout: TIMEOUT_DA_CONSULTA_NA_TELA_MS },
    [csId],
  );
  return inteiro(linhas[0]?.ar_id);
}

/** As linhas de pedido do terreno (consultas 2 e 4), com os dígitos do documento EM MEMÓRIA. */
function paraPedidosDoTerreno(linhas: readonly LinhaDoPedidoDaUnidade[], pedidos: PedidoDoTerreno[]): void {
  for (const l of linhas) {
    const ar = inteiro(l.ar_id);
    if (ar === null) continue;
    pedidos.push({
      arId: ar,
      criadoEm: instanteDeBrasilia(texto(l.criado_em_brasilia)),
      documentoDoComprador: String(l.documento ?? "").replace(/\D/g, ""),
      estagio: inteiro(l.estagio),
    });
  }
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
    paraPedidosDoTerreno(linhas, pedidos);
  }
  return pedidos;
}

/**
 * (4) Os pedidos cancelados ou distratados das unidades do C2X nascidos a partir de `desdeBrasilia`
 * (a hora de parede de Brasília da venda, `paredeDeBrasilia`), com os dígitos do documento EM MEMÓRIA.
 */
export async function pedidosDesfeitosDasUnidades(
  conexao: ConexaoDeLeitura,
  unidadesC2x: readonly number[],
  desdeBrasilia: string,
): Promise<PedidoDoTerreno[]> {
  const unicas = [...new Set(unidadesC2x)];
  const pedidos: PedidoDoTerreno[] = [];
  for (let i = 0; i < unicas.length; i += LOTE_DO_IN_NO_C2X) {
    const [linhas] = await conexao.query<LinhaDoPedidoDaUnidade[]>(
      { sql: SQL_PEDIDOS_DESFEITOS_DAS_UNIDADES, timeout: TIMEOUT_DA_CONSULTA_NA_TELA_MS },
      [unicas.slice(i, i + LOTE_DO_IN_NO_C2X), desdeBrasilia],
    );
    paraPedidosDoTerreno(linhas, pedidos);
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
  return {
    arId,
    estagio: inteiro(linhas[0]?.estagio),
    parcelas,
    totalDeParcelas: inteiro(linhas[0]?.total_de_parcelas),
  };
}
