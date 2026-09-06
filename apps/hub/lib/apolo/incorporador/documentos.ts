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
import { codigoDaVenda } from "@/lib/hercules/codigo-da-venda";

// ── TIPOS DO PAYLOAD ────────────────────────────────────────────────────────

/**
 * ⚠️ "venda" É A QUARTA FONTE, e ela existe porque o Lucas pediu que o documento trocado na tela de
 * Venda do Hércules *"também exista no Apolo"* (06/09/2026). Ele NÃO é copiado para
 * `apolo_documents`: os bytes já vivem no mesmo bucket, e copiar a linha traria três defeitos
 * medidos — `entity_id` é NOT NULL lá (e o documento nasce quando o cliente pode não ter entidade),
 * o DELETE daquela rota roda com autorização de LEITURA e apagaria arquivo e linha, e o
 * visualizador da esteira monta uma aba por documento sem filtrar tipo, pondo contrato e boleto no
 * meio do RG na tela em que se aprova a CAD. Uma linha só, dois leitores.
 */
export type FonteDoDocumento = "apolo" | "c2x" | "contrato" | "venda";

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

/** O que a leitura de `hercules_documentos` devolve para esta lista. */
export type DocumentoDaVendaNoApolo = {
  criado_em: string;
  id: string;
  nome: string;
  protocolo_numero: null | number;
  tipo: string;
};

/**
 * Fonte (d): o que foi trocado na tela de Venda, na aba Documentos do lote.
 *
 * ⚠️ O COD ENTRA NO NOME, e não some num campo à parte: no Apolo o eixo é a PESSOA, e a mesma
 * pessoa pode ter documento de duas vendas. Sem o protocolo escrito, dois "RG.pdf" na lista da
 * ficha ficam indistinguíveis — e é justamente o agrupamento que a aba do Hércules garante e esta
 * tela não tem.
 */
export function docsDaVenda(
  itens: DocumentoDaVendaNoApolo[],
  codigoDaVenda: (protocolo: null | number | undefined) => string,
): DocumentoDoPortal[] {
  return itens.map((item) => {
    const cod = codigoDaVenda(item.protocolo_numero);
    return {
      abrivel: true,
      criadoEm: item.criado_em || null,
      fonte: "venda" as const,
      id: item.id,
      nome: cod ? `${cod} · ${item.nome}` : item.nome,
      tipo: item.tipo || null,
    };
  });
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

  const [docsApolo, anexos, daVenda] = await Promise.all([
    admin
      ? listApoloDocuments(admin, "entidade", pessoa.entityId).catch(() => [])
      : Promise.resolve([]),
    lerAnexosDoC2x(c2xUserId),
    admin ? lerDocumentosDaVenda(admin, pessoa.entityId) : Promise.resolve([]),
  ]);

  return {
    documentos: [
      ...docsDoApolo(docsApolo),
      ...docsDaVenda(daVenda, codigoDaVenda),
      ...contratosAssinados(pessoa.unidadesDaPessoa),
      ...anexosDoC2x(anexos),
    ],
    ok: true,
  };
}

/**
 * Os documentos que a venda trocou, desta pessoa.
 *
 * ⚠️ DOIS CAMINHOS, E OS DOIS PRECISAM EXISTIR. O documento gravado depois da proposta traz
 * `cliente_entity_id`; o que chegou na fase de RESERVA só tem o CPF (a reserva guarda o titular em
 * jsonb, sem entidade). Ler só pela entidade esconderia da ficha justamente o RG que se pede para
 * abrir a CAD — e ninguém entenderia por que ele "sumiu".
 *
 * ⚠️ FALHA AQUI NÃO DERRUBA A ABA: as outras três fontes continuam. Uma lista a menos é ruim; a
 * ficha inteira em branco por causa de uma tabela nova é pior.
 */
async function lerDocumentosDaVenda(
  admin: NonNullable<ReturnType<typeof createApoloAdminClient>>,
  entityId: string,
): Promise<DocumentoDaVendaNoApolo[]> {
  try {
    const { data: pessoa } = await admin
      .from("apolo_entities")
      .select("document")
      .eq("id", entityId)
      .maybeSingle();

    const cpf = String((pessoa as null | { document: null | string })?.document ?? "").replace(
      /\D/g,
      "",
    );

    const filtro = cpf
      ? `cliente_entity_id.eq.${entityId},cliente_documento.eq.${cpf}`
      : `cliente_entity_id.eq.${entityId}`;

    const { data, error } = await admin
      .from("hercules_documentos")
      .select("id,nome,tipo,protocolo_numero,criado_em")
      .eq("workspace_id", "careli")
      .is("removido_em", null)
      .or(filtro)
      .order("criado_em", { ascending: false })
      .limit(200);

    if (error) throw new Error(error.message);
    return (data ?? []) as DocumentoDaVendaNoApolo[];
  } catch (erro) {
    console.error("[incorporador/documentos] falha ao ler os documentos da venda", erro);
    return [];
  }
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

  if (fonte === "venda") {
    const admin = createApoloAdminClient();
    if (!admin) return { ok: false, status: 503 };

    // ⚠️ A POSSE É REFEITA PELA PESSOA, e não pelo id sozinho — a MESMA regra do ramo `apolo` acima.
    // O documento da venda é achado por entidade OU por CPF (na fase de reserva não há entidade),
    // então as duas condições entram na consulta que já filtra pelo id: um id chutado de outra
    // venda não casa e vira 404, sem nunca gerar a URL para conferir depois.
    const { data: quem } = await admin
      .from("apolo_entities")
      .select("document")
      .eq("id", pessoa.entityId)
      .maybeSingle();

    const cpf = String((quem as null | { document: null | string })?.document ?? "").replace(
      /\D/g,
      "",
    );
    const filtro = cpf
      ? `cliente_entity_id.eq.${pessoa.entityId},cliente_documento.eq.${cpf}`
      : `cliente_entity_id.eq.${pessoa.entityId}`;

    const { data } = await admin
      .from("hercules_documentos")
      .select("id,caminho")
      .eq("workspace_id", "careli")
      .eq("id", alvo)
      .is("removido_em", null)
      .or(filtro)
      .limit(1)
      .returns<Array<{ caminho: string; id: string }>>();

    const linha = data?.[0];
    if (!linha?.caminho) return { ok: false, status: 404 };

    const assinada = await admin.storage
      .from("apolo-documents")
      .createSignedUrl(linha.caminho, URL_TTL_SEGUNDOS);

    if (assinada.error || !assinada.data?.signedUrl) return { ok: false, status: 502 };

    return { ok: true, tipo: "url", url: assinada.data.signedUrl };
  }

  // Fonte desconhecida ou "c2x" (sem credencial S3 não há o que servir): não existe.
  return { ok: false, status: 404 };
}
