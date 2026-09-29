import type { SupabaseClient } from "@supabase/supabase-js";
import type { RowDataPacket } from "mysql2";

import { getHadesDbPool } from "@/lib/guardian/db";

// O CONTRATO ASSINADO DE UMA UNIDADE, para a rota /api/incorporador/contrato.
//
// Pedido do Lucas (18/08/2026): *"temos que trazer o contrato e nas parcelas dentro de carteira o
// link do boleto do asaas"*. Esta é a primeira metade: a coluna Contrato da Carteira do portal.
//
// ⚠️ O uuidDoc SAI DO C2X, NUNCA DA URL. A rota recebe só o `unitId` (já provado no escopo da
// sessão por `unidadeNoEscopo`) e É AQUI que o documento correspondente é resolvido. Aceitar o
// uuid do navegador transformaria o proxy do D4Sign num "baixe qualquer contrato da base": o
// uuid de outra unidade — de outro loteador — abriria o PDF de um contrato alheio.
//
// A consulta é a MESMA da coluna `contract_doc` de `loadApoloEnterpriseCarteira`
// (lib/apolo/carteira.ts), de propósito: o ícone que a tela mostra e o PDF que a rota abre têm
// que apontar para o mesmo documento, senão o cliente clica num contrato e recebe outro.

type ContratoRow = RowDataPacket & {
  block: null | string;
  enterprise_code: null | string;
  lot: null | string;
  uuid_doc: null | string;
};

export type ContratoDaUnidade = {
  /** Rótulo da unidade (VALB02…), para o nome do arquivo baixado. */
  unidade: string;
  /** uuidDoc do D4Sign da assinatura mais recente com uuid preenchido. */
  uuidDoc: string;
};

/**
 * Busca o uuidDoc do contrato assinado DESTA unidade no C2X (read-only).
 *
 * Devolve `null` quando a unidade não existe ou não tem assinatura com uuid — a rota trata os
 * dois como 404, igual a unidade fora do escopo: para quem pergunta, o contrato não existe.
 */
export async function contratoDaUnidade(
  unitId: number,
): Promise<ContratoDaUnidade | null> {
  if (!Number.isInteger(unitId) || unitId <= 0) return null;

  const poolResult = getHadesDbPool();
  if (!poolResult.ok) return null;

  try {
    const [rows] = await poolResult.pool.query<ContratoRow[]>(
      `select
         e.code as enterprise_code, eu.block, eu.lot,
         (select nullif(trim(cs.uuidDoc), '')
            from contract_signatures cs
            join acquisition_request_contracts arc on arc.id = cs.acquisition_request_contract_id
            join acquisition_requests ar on ar.id = arc.acquisition_request_id
           where ar.enterprise_unity_id = eu.id
             and trim(coalesce(cs.uuidDoc, '')) <> ''
           order by cs.updated_at desc, cs.id desc limit 1) as uuid_doc
       from enterprise_unities eu
       join enterprises e on e.id = eu.enterprise_id
       where eu.id = ?
       limit 1`,
      [unitId],
    );

    const row = rows[0];
    if (!row) return null;

    const uuidDoc = typeof row.uuid_doc === "string" ? row.uuid_doc.trim() : "";
    if (!uuidDoc) return null;

    return { unidade: rotuloDaUnidade(row), uuidDoc };
  } catch {
    // Falha de leitura vira "sem contrato": fail-closed, nunca um uuid de fallback.
    return null;
  }
}

// Mesmo padrão de `buildUnitCode` (carteira.ts): <3 letras do code><quadra><lote sem o L>.
function rotuloDaUnidade(row: ContratoRow): string {
  const prefix = String(row.enterprise_code ?? "")
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase()
    .slice(0, 3)
    .padEnd(3, "X");
  const block = String(row.block ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();
  const lot = String(row.lot ?? "")
    .replace(/[^a-z0-9]/gi, "")
    .replace(/^L/i, "")
    .toUpperCase();

  return `${prefix}${block}${lot}`;
}

/** O documento de um ENVELOPE do Panteon, para o botão de PDF da leitura única. */
export type ContratoDoEnvelope = {
  /** Código da unidade no Panteon ("VOC0306"), para o nome do arquivo baixado. */
  unidade: string;
  /** `hercules_unidades.id`: é por ele que a rota confere o escopo ANTES de baixar. */
  unidadeId: string;
  /** O documento na D4Sign (`provedor_documento_id`). Nunca sai da rota. */
  uuidDoc: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * O documento do ENVELOPE `contratoId` da leitura única (F4 da fonte única).
 *
 * ⚠️ SEM C2X: o envelope da D4Sign que o espelho gravou já tem o documento (`provedor_documento_id`) e
 * a unidade. A rota confere o escopo pela UNIDADE do envelope (`unidadeNoEscopo`) antes de baixar, e
 * baixa exatamente aquele documento; o navegador só manda o id do envelope, nunca o do documento.
 *
 * ⚠️ SÓ D4SIGN, E SÓ CONTRATO (a view `temis_envelopes_de_contrato`). O PDF da Clicksign não é
 * guardado (plano, "Fora"); envelope sem documento ou sem unidade devolve `null` (a rota responde o
 * mesmo 404 de "não existe").
 */
export async function contratoDoEnvelope(
  admin: SupabaseClient,
  contratoId: string,
): Promise<ContratoDoEnvelope | null> {
  const id = String(contratoId ?? "").trim();
  if (!UUID.test(id)) return null;

  try {
    const { data, error } = await admin
      .from("temis_envelopes_de_contrato")
      .select("id,provedor,provedor_documento_id,unidade_id")
      .eq("id", id)
      .eq("provedor", "d4sign")
      .maybeSingle();
    if (error || !data) return null;
    const linha = data as { provedor_documento_id: null | string; unidade_id: null | string };
    const uuidDoc = String(linha.provedor_documento_id ?? "").trim();
    const unidadeId = String(linha.unidade_id ?? "").trim();
    if (!uuidDoc || !unidadeId) return null;

    const unidade = await admin
      .from("hercules_unidades")
      .select("codigo")
      .eq("id", unidadeId)
      .eq("workspace_id", "careli")
      .maybeSingle();
    const codigo = String((unidade.data as null | { codigo: null | string })?.codigo ?? "").trim();
    return { unidade: codigo || "contrato", unidadeId, uuidDoc };
  } catch {
    // Falha de leitura vira "sem contrato": fail-closed.
    return null;
  }
}
