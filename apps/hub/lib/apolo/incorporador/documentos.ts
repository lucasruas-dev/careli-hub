// A ABA DOCUMENTOS DA FICHA DO PORTAL DO INCORPORADOR — as três fontes, nesta ordem:
//
//   a) documentos da CAD no Apolo (bucket privado `apolo-documents`, via `listApoloDocuments`);
//   b) contrato assinado via D4Sign (contract_signatures.uuidDoc do C2X — a carteira escopada já
//      traz o uuid por unidade em `contractDocumentId`); o PDF é PROXIADO pela rota, o token
//      D4Sign NUNCA chega ao navegador;
//   c) anexos legados que só existem no S3 privado do C2X (attachments → active_storage): SEM
//      credencial S3 não há como servir o binário — saem SÓ os metadados, com estado "guardado
//      no C2X" e botão desabilitado. NÃO inventar URL.
//
// Pedido do Lucas (18/08/2026): *"tudo que estiver no apolo tem que está aqui, os documentos"*.
//
// ⚠️ ESCOPO ANTES DE TUDO: toda leitura daqui roda DEPOIS de `pessoaNoEscopo` provar que a
// pessoa pertence à sessão, e a abertura reconfere que o documento pedido é DAQUELA pessoa antes
// de gerar URL ou baixar PDF.
import type { RowDataPacket } from "mysql2";

import type { ApoloCarteiraUnit } from "@/lib/apolo/carteira";
import { listApoloDocuments, type ApoloDocumentItem } from "@/lib/apolo/documentos";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { fetchD4SignContract } from "@/lib/guardian/d4sign";
import { getHadesDbPool } from "@/lib/guardian/db";

import { lerC2xUserId } from "./ficha-cadastro";
import { pessoaNoEscopo } from "./pessoa-no-escopo";
import type { TipoDaFicha } from "./crm";
import type { SessaoIncorporador } from "./sessao";

// ── TIPOS DO PAYLOAD ────────────────────────────────────────────────────────

export type FonteDoDocumento = "apolo" | "c2x" | "contrato";

export type DocumentoDoPortal = {
  /** false = só metadado (anexo preso no S3 do C2X); o botão fica desabilitado com tooltip. */
  abrivel: boolean;
  criadoEm: null | string;
  fonte: FonteDoDocumento;
  /** Chave para a rota de abertura (id do apolo_documents, uuidDoc do D4Sign, ou blob do C2X). */
  id: string;
  nome: string;
  tipo: null | string;
};

// ── REGRAS PURAS ────────────────────────────────────────────────────────────

/** Fonte (a): os documentos da CAD no Apolo, allowlist campo a campo. */
export function docsDoApolo(itens: ApoloDocumentItem[]): DocumentoDoPortal[] {
  return itens.map((item) => ({
    // Linha sem arquivo (registro órfão) aparece, mas não abre — igual ao painel interno.
    abrivel: item.hasFile,
    criadoEm: item.createdAt || null,
    fonte: "apolo",
    id: item.id,
    nome: item.label || item.fileName || "Documento",
    tipo: item.documentType || null,
  }));
}

/**
 * Fonte (b): os contratos assinados (D4Sign) das unidades DA PESSOA. As unidades chegam aqui já
 * provadas no escopo (vieram da carteira estreitada por code); dedupe por uuid porque a mesma
 * assinatura pode aparecer em mais de uma linha de contrato.
 */
export function contratosAssinados(unidadesDaPessoa: ApoloCarteiraUnit[]): DocumentoDoPortal[] {
  const vistos = new Set<string>();
  const contratos: DocumentoDoPortal[] = [];

  for (const unidade of unidadesDaPessoa) {
    const uuid = unidade.contractDocumentId?.trim();
    if (!uuid || vistos.has(uuid)) continue;
    vistos.add(uuid);

    contratos.push({
      abrivel: true,
      criadoEm: unidade.faturadoAt,
      fonte: "contrato",
      id: uuid,
      nome: `Contrato assinado · ${unidade.code}`,
      tipo: "Contrato (D4Sign)",
    });
  }

  return contratos;
}

export type LinhaAnexoC2x = {
  blob_id: number | string;
  content_type: null | string;
  created_at: null | string;
  dono: null | string;
  filename: null | string;
};

/**
 * Fonte (c): os anexos legados do C2X — SÓ METADADO. O arquivo vive num S3 privado do Rails e
 * não temos credencial para servi-lo; listar o que existe (nome, tipo, data) já responde "o
 * documento está guardado", e o botão desabilitado explica onde. `abrivel: false` SEMPRE.
 */
export function anexosDoC2x(linhas: LinhaAnexoC2x[]): DocumentoDoPortal[] {
  return linhas
    .filter((linha) => String(linha.filename ?? "").trim())
    .map((linha) => ({
      abrivel: false,
      criadoEm: linha.created_at,
      fonte: "c2x" as const,
      id: `c2x:${linha.blob_id}`,
      nome:
        linha.dono === "Spouse"
          ? `${String(linha.filename).trim()} (cônjuge)`
          : String(linha.filename).trim(),
      tipo: linha.content_type,
    }));
}

// ── LEITURAS ────────────────────────────────────────────────────────────────

type AnexoRow = RowDataPacket & LinhaAnexoC2x;

/** Os anexos legados (User + Spouse) do C2X para um users.id. Falha vira lista vazia. */
async function lerAnexosDoC2x(c2xUserId: null | number): Promise<LinhaAnexoC2x[]> {
  if (!c2xUserId) return [];

  const pool = getHadesDbPool();
  if (!pool.ok) return [];

  try {
    const [linhas] = await pool.pool.query<AnexoRow[]>(
      `select b.id as blob_id, b.filename, b.content_type,
              date_format(b.created_at, '%Y-%m-%dT%H:%i:%sZ') as created_at,
              a.ownertable_type as dono
         from attachments a
         join active_storage_attachments asa
           on asa.record_type = 'Attachment' and asa.record_id = a.id
         join active_storage_blobs b on b.id = asa.blob_id
        where (a.ownertable_type = 'User' and a.ownertable_id = ?)
           or (a.ownertable_type = 'Spouse' and a.ownertable_id in (
                 select s.id from spouses s
                  where s.ownertable_type = 'User' and s.ownertable_id = ?))
        order by b.created_at desc
        limit 200`,
      [c2xUserId, c2xUserId],
    );

    return linhas;
  } catch {
    return [];
  }
}

export type ResultadoDosDocumentos =
  | { documentos: DocumentoDoPortal[]; ok: true }
  | { ok: false; status: 404 | 503 };

/** A lista da aba Documentos: prova o escopo e junta as três fontes. */
export async function montarDocumentos({
  id,
  sessao,
  tipo,
}: {
  id: string;
  sessao: SessaoIncorporador;
  tipo: TipoDaFicha;
}): Promise<ResultadoDosDocumentos> {
  const pessoa = await pessoaNoEscopo({ id, sessao, tipo });
  if (!pessoa.ok) return pessoa;

  const admin = createApoloAdminClient();
  const c2xUserId = admin ? await lerC2xUserId(admin, pessoa.entityId) : null;

  const [docsApolo, anexos] = await Promise.all([
    admin
      ? listApoloDocuments(admin, "entidade", pessoa.entityId).catch(() => [])
      : Promise.resolve([]),
    lerAnexosDoC2x(c2xUserId),
  ]);

  return {
    documentos: [
      ...docsDoApolo(docsApolo),
      ...contratosAssinados(pessoa.unidadesDaPessoa),
      ...anexosDoC2x(anexos),
    ],
    ok: true,
  };
}

// ── ABERTURA (um documento por vez, com a posse reconferida) ────────────────

export type ResultadoDaAbertura =
  | { ok: true; tipo: "pdf"; body: ArrayBuffer; contentLength: null | string; contentType: string }
  | { ok: true; tipo: "url"; url: string }
  | { ok: false; status: 404 | 502 | 503 };

const URL_TTL_SEGUNDOS = 60 * 10;

/**
 * Abre UM documento: refaz a prova de escopo e confere que o documento pedido pertence ÀQUELA
 * pessoa ANTES de gerar URL assinada (Apolo) ou baixar o PDF (D4Sign). Anexo do C2X nunca abre
 * por aqui (`abrivel: false` na lista) — pedir mesmo assim é 404.
 */
export async function abrirDocumento({
  doc,
  fonte,
  id,
  sessao,
  tipo,
}: {
  doc: string;
  fonte: string;
  id: string;
  sessao: SessaoIncorporador;
  tipo: TipoDaFicha;
}): Promise<ResultadoDaAbertura> {
  const alvo = String(doc ?? "").trim();
  if (!alvo) return { ok: false, status: 404 };

  const pessoa = await pessoaNoEscopo({ id, sessao, tipo });
  if (!pessoa.ok) return pessoa;

  if (fonte === "contrato") {
    // O uuid pedido tem que ser de um contrato DA PESSOA (a lista de unidades veio da consulta
    // escopada). Uuid de outro contrato — mesmo válido no D4Sign — não existe para esta sessão.
    const permitidos = new Set(
      contratosAssinados(pessoa.unidadesDaPessoa).map((contrato) => contrato.id),
    );
    if (!permitidos.has(alvo)) return { ok: false, status: 404 };

    const contrato = await fetchD4SignContract(alvo);
    // ⚠️ O PDF vem para cá e a rota o repassa: o token D4Sign fica no servidor.
    if (!contrato.ok) return { ok: false, status: 502 };

    return {
      body: contrato.body,
      contentLength: contrato.contentLength,
      contentType: contrato.contentType,
      ok: true,
      tipo: "pdf",
    };
  }

  if (fonte === "apolo") {
    const admin = createApoloAdminClient();
    if (!admin) return { ok: false, status: 503 };

    // A linha é lida COM o entity_id: documento de outra pessoa (id chutado) não casa e vira
    // 404 — nunca gerar a URL para depois conferir.
    const { data } = await admin
      .from("apolo_documents")
      .select("id, entity_id, storage_bucket, storage_path")
      .eq("id", alvo)
      .eq("entity_id", pessoa.entityId)
      .limit(1)
      .returns<Array<{ id: string; storage_bucket: null | string; storage_path: null | string }>>();

    const linha = data?.[0];
    if (!linha?.storage_path) return { ok: false, status: 404 };

    const assinada = await admin.storage
      .from(linha.storage_bucket ?? "apolo-documents")
      .createSignedUrl(linha.storage_path, URL_TTL_SEGUNDOS);

    if (assinada.error || !assinada.data?.signedUrl) return { ok: false, status: 502 };

    return { ok: true, tipo: "url", url: assinada.data.signedUrl };
  }

  // Fonte desconhecida ou "c2x" (sem credencial S3 não há o que servir): não existe.
  return { ok: false, status: 404 };
}
