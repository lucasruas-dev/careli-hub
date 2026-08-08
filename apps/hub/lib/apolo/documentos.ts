// Documentos do Apolo (entidade e empreendimento). Arquivos vivem no bucket PRIVADO
// `apolo-documents`; a linha guarda so o caminho + metadados (+ o que o iOCR extraiu, quando
// vem do cadastro MOST). Todo acesso passa por aqui (service role) e a leitura usa URL
// assinada. Ver [[project_apolo_cadastro_prospect]].
import type { createApoloAdminClient } from "@/lib/apolo/server";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

export const APOLO_DOCS_BUCKET = "apolo-documents";
const SIGNED_URL_TTL = 60 * 10; // 10 min

// Teto por DOCUMENTO no upload direto (bytes reais do arquivo, não do base64). É o número que o
// Lucas pediu ("deixa o padrão 20MB para documentos") e o mesmo que a tela mostra quando estoura.
export const APOLO_DOC_MAX_BYTES = 20 * 1024 * 1024;
export const APOLO_DOC_MAX_LABEL = "20MB";
export const MENSAGEM_DOCUMENTO_GRANDE = `Cada documento pode ter até ${APOLO_DOC_MAX_LABEL}. Envie um arquivo menor e tente de novo.`;

// Área de STAGING do upload direto. O arquivo chega ANTES de a entidade existir (a entidade só
// nasce no /salvar), então não há `ownerId` para compor o caminho definitivo ainda. Depois de
// criada a entidade, `uploadApoloDocument` MOVE o objeto para `entidade/<entityId>/...` — mover é
// operação de metadado no Storage, os bytes não passam pela function.
const STAGING_PREFIX = "entidade/_pendente";

export type ApoloDocScope = "empreendimento" | "entidade";

export type ApoloDocumentItem = {
  createdAt: string;
  documentType: string;
  fileName: string | null;
  hasFile: boolean;
  id: string;
  label: string;
  sizeBytes: number | null;
  status: string;
  uploadedBy: string | null;
};

// Cada escopo tem sua tabela e sua coluna-dono.
const TABLE: Record<ApoloDocScope, { name: string; ownerColumn: string }> = {
  empreendimento: { name: "apolo_enterprise_documents", ownerColumn: "enterprise_code" },
  entidade: { name: "apolo_documents", ownerColumn: "entity_id" },
};

type DocRow = {
  created_at: string;
  document_type: string;
  id: string;
  label: string;
  metadata: { fileName?: string; sizeBytes?: number; uploadedByName?: string } | null;
  status: string;
  storage_path: string | null;
};

function mapDoc(row: DocRow): ApoloDocumentItem {
  const meta = row.metadata ?? {};
  return {
    createdAt: row.created_at,
    documentType: row.document_type,
    fileName: meta.fileName ?? null,
    hasFile: Boolean(row.storage_path),
    id: row.id,
    label: row.label,
    sizeBytes: meta.sizeBytes ?? null,
    status: row.status,
    uploadedBy: meta.uploadedByName ?? null,
  };
}

export async function listApoloDocuments(
  adminClient: AdminClient,
  scope: ApoloDocScope,
  ownerId: string,
): Promise<ApoloDocumentItem[]> {
  const { name, ownerColumn } = TABLE[scope];
  const { data } = await adminClient
    .from(name)
    .select("id, document_type, label, status, storage_path, metadata, created_at")
    .eq(ownerColumn, ownerId)
    .order("created_at", { ascending: false })
    .limit(500);

  return (data ?? []).map((row) => mapDoc(row as DocRow));
}

// ---- upload DIRETO do browser (arquivo grande) ---------------------------------------------
//
// POR QUE EXISTE: o wizard manda os documentos em base64 DENTRO do JSON e a Vercel corta o corpo
// da requisição em ~4,5MB antes da rota rodar. Documento pequeno continua indo assim (fluxo de
// hoje, intacto, inclusive o agrupamento de frente+verso num PDF só); documento GRANDE sobe
// direto para o Storage por uma URL assinada e no JSON viaja só o caminho. Mesmo padrão que já
// roda em produção na PA do Prometeu (lib/prometeu/pa.ts) e no anexo do Hub IT.
//
// QUEM AUTORIZA é o TOKEN assinado pelo service role, não o JWT do usuário — por isso o portal
// público anônimo também consegue subir sem policy nova em storage.objects.

// Chave do DONO da área de staging. O caminho é escolhido pelo SERVIDOR e amarrado a quem pediu:
// na hora de salvar, a rota exige que o caminho comece por este prefixo. Sem isso, um corpo
// forjado apontaria uma linha de documento para o arquivo de outra pessoa.
export function prefixoUploadDireto(dono: string): string {
  return `${STAGING_PREFIX}/${sanitize(dono)}/`;
}

// Dono do staging no cadastro INTERNO (operador logado). O público tem os seus em
// lib/publico/cad/sessao.ts (donoUploadSessao / donoUploadPreImob).
export function donoUploadOperador(userId: string): string {
  return `u-${userId}`;
}

// O caminho que o cliente devolveu é mesmo um caminho que ESTE dono recebeu para gravar?
export function caminhoUploadDiretoValido(
  storagePath: string | null | undefined,
  dono: string,
): boolean {
  const caminho = (storagePath ?? "").trim();
  if (!caminho || caminho.includes("..")) return false;
  return caminho.startsWith(prefixoUploadDireto(dono));
}

// Um documento do payload tem ARQUIVO? Vale para as DUAS formas: base64 no corpo (fluxo de hoje)
// e caminho de arquivo já gravado no bucket (upload direto). Regra única, um lugar só.
export function documentoTemArquivo(
  doc: { fileBase64?: string | null; storagePath?: string | null } | null | undefined,
): boolean {
  return Boolean(doc?.fileBase64?.trim() || doc?.storagePath?.trim());
}

// Assina a permissão de gravar UM arquivo. Não recebe bytes: a requisição é pequena.
export async function criarUrlDeUploadApoloDocument(input: {
  adminClient: AdminClient;
  dono: string;
  fileName: string;
}): Promise<{ bucket: string; path: string; token: string }> {
  const caminho = `${prefixoUploadDireto(input.dono)}${crypto.randomUUID()}-${sanitize(input.fileName)}`;
  const assinada = await input.adminClient.storage
    .from(APOLO_DOCS_BUCKET)
    .createSignedUploadUrl(caminho);

  if (assinada.error || !assinada.data) {
    throw new Error(assinada.error?.message ?? "Nao foi possivel preparar o envio do documento.");
  }

  return { bucket: APOLO_DOCS_BUCKET, path: assinada.data.path, token: assinada.data.token };
}

// Baixa um documento que já está no bucket. Usado SÓ quando a categoria tem mais de um arquivo e
// eles precisam virar um PDF único (RG frente+verso, contrato social de N páginas): aí o servidor
// precisa dos bytes de verdade. Categoria de um arquivo só nem baixa nem re-sobe.
export async function lerDocumentoDoStorage(
  adminClient: AdminClient,
  storagePath: string,
): Promise<Buffer | null> {
  const { data, error } = await adminClient.storage.from(APOLO_DOCS_BUCKET).download(storagePath);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

export async function removerDocumentoDoStorage(
  adminClient: AdminClient,
  storagePath: string,
): Promise<void> {
  await adminClient.storage.from(APOLO_DOCS_BUCKET).remove([storagePath]);
}

export async function uploadApoloDocument(input: {
  adminClient: AdminClient;
  documentType: string;
  extractedPayload?: unknown;
  // Fluxo de HOJE: o arquivo veio em base64 dentro do JSON.
  fileBase64?: string | null;
  fileName: string;
  label: string;
  // Campos extras no metadata do documento. Usado pela importação do Asana para guardar o
  // gid do anexo, que é a chave de dedup: sem isso, reimportar subiria o arquivo de novo.
  metadataExtra?: Record<string, unknown>;
  mimeType?: string | null;
  ownerId: string;
  scope: ApoloDocScope;
  // Tamanho declarado pelo cliente no upload direto. Só é usado se o Storage não souber informar
  // o tamanho real; a conferência de verdade é a do `.info()` abaixo.
  sizeBytes?: number | null;
  // Upload DIRETO: o arquivo JÁ está no bucket, neste caminho. Quando vem preenchido, nenhum byte
  // passa pela function — a linha é criada apontando para o arquivo que o browser gravou.
  storagePath?: string | null;
  uploadedByName: string | null;
}): Promise<{ error?: string; id?: string; ok: boolean }> {
  const { name, ownerColumn } = TABLE[input.scope];
  const safeName = sanitize(input.fileName);
  const contentType = input.mimeType || guessMime(safeName);
  const destino = `${input.scope}/${input.ownerId}/${crypto.randomUUID()}-${safeName}`;
  const jaNoBucket = (input.storagePath ?? "").trim();

  let storagePath: string;
  let tamanho: number;

  if (jaNoBucket) {
    // Confere o arquivo que o browser gravou. O teto de 20MB é cobrado AQUI, no servidor, com o
    // tamanho real do objeto: a trava do cliente pode ser burlada.
    const info = await input.adminClient.storage.from(APOLO_DOCS_BUCKET).info(jaNoBucket);
    const real = !info.error && typeof info.data?.size === "number" ? info.data.size : null;
    // `.info()` pode não estar disponível em algum ambiente; nesse caso vale o tamanho declarado,
    // e sem tamanho nenhum o arquivo é recusado (melhor recusar que registrar às cegas).
    tamanho = real ?? (typeof input.sizeBytes === "number" ? input.sizeBytes : -1);
    if (tamanho < 0) {
      return { error: "Arquivo enviado nao foi encontrado no armazenamento.", ok: false };
    }
    if (tamanho > APOLO_DOC_MAX_BYTES) {
      await removerDocumentoDoStorage(input.adminClient, jaNoBucket);
      return { error: MENSAGEM_DOCUMENTO_GRANDE, ok: false };
    }

    // Tira do staging e põe na pasta da entidade, para o drive ficar com o MESMO layout de sempre.
    const movido = await input.adminClient.storage
      .from(APOLO_DOCS_BUCKET)
      .move(jaNoBucket, destino);
    // O move também é a PROVA de que o arquivo existe: ele falha quando a origem não está lá. Se
    // nem o `.info()` respondeu nem o move funcionou, não há arquivo nenhum e registrar a linha
    // deixaria um documento que abre em link quebrado — a mesma armadilha dos anexos órfãos.
    if (movido.error && real === null) {
      return { error: "Arquivo enviado nao foi encontrado no armazenamento.", ok: false };
    }
    // Move que falha com o arquivo existindo (permissão, corrida): a linha aponta para o caminho
    // de staging. O arquivo continua acessível — a leitura é sempre pelo `storage_path` da linha.
    storagePath = movido.error ? jaNoBucket : destino;
  } else {
    const bytes = decodeBase64(input.fileBase64 ?? "");
    if (!bytes) {
      return { error: "Arquivo invalido.", ok: false };
    }

    const upload = await input.adminClient.storage
      .from(APOLO_DOCS_BUCKET)
      .upload(destino, bytes, { contentType, upsert: false });

    if (upload.error) {
      return { error: `Falha ao enviar o arquivo: ${upload.error.message}`, ok: false };
    }
    storagePath = destino;
    tamanho = bytes.byteLength;
  }

  const row: Record<string, unknown> = {
    [ownerColumn]: input.ownerId,
    document_type: input.documentType,
    label: input.label,
    status: "ready",
    storage_bucket: APOLO_DOCS_BUCKET,
    storage_path: storagePath,
    metadata: {
      fileName: input.fileName,
      sizeBytes: tamanho,
      source: "apolo",
      uploadedByName: input.uploadedByName,
      ...(input.metadataExtra ?? {}),
    },
  };
  // extracted_payload só existe na tabela de entidade (o iOCR do cadastro).
  if (input.scope === "entidade" && input.extractedPayload !== undefined) {
    row.extracted_payload = input.extractedPayload;
  }

  const { data, error } = await input.adminClient
    .from(name)
    .insert(row)
    .select("id")
    .single();

  if (error) {
    // Best-effort: remove o arquivo orfao se o registro falhou.
    await input.adminClient.storage.from(APOLO_DOCS_BUCKET).remove([storagePath]);
    return { error: `Falha ao registrar o documento: ${error.message}`, ok: false };
  }

  return { id: (data as { id: string }).id, ok: true };
}

export async function getApoloDocumentSignedUrl(
  adminClient: AdminClient,
  scope: ApoloDocScope,
  documentId: string,
): Promise<{ error?: string; url?: string }> {
  const { name } = TABLE[scope];
  const { data: doc } = await adminClient
    .from(name)
    .select("storage_bucket, storage_path")
    .eq("id", documentId)
    .maybeSingle<{ storage_bucket: string | null; storage_path: string | null }>();

  if (!doc?.storage_path) {
    return { error: "Documento sem arquivo." };
  }

  const signed = await adminClient.storage
    .from(doc.storage_bucket ?? APOLO_DOCS_BUCKET)
    .createSignedUrl(doc.storage_path, SIGNED_URL_TTL);

  if (signed.error || !signed.data?.signedUrl) {
    return { error: "Nao foi possivel gerar o link do arquivo." };
  }

  return { url: signed.data.signedUrl };
}

export async function deleteApoloDocument(
  adminClient: AdminClient,
  scope: ApoloDocScope,
  documentId: string,
): Promise<{ error?: string; ok: boolean }> {
  const { name } = TABLE[scope];
  const { data: doc } = await adminClient
    .from(name)
    .select("storage_bucket, storage_path")
    .eq("id", documentId)
    .maybeSingle<{ storage_bucket: string | null; storage_path: string | null }>();

  if (doc?.storage_path) {
    await adminClient.storage
      .from(doc.storage_bucket ?? APOLO_DOCS_BUCKET)
      .remove([doc.storage_path]);
  }

  const { error } = await adminClient.from(name).delete().eq("id", documentId);
  if (error) {
    return { error: "Nao foi possivel remover o documento.", ok: false };
  }
  return { ok: true };
}

// ---- helpers -------------------------------------------------------------------------------

function decodeBase64(value: string): Uint8Array | null {
  try {
    const raw = value.includes(",") && value.startsWith("data:")
      ? value.slice(value.indexOf(",") + 1)
      : value;
    return Uint8Array.from(Buffer.from(raw, "base64"));
  } catch {
    return null;
  }
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "documento";
}

// Exportado porque o envio do contrato social ao C2X (c2x-write-server.ts) precisa do
// content-type da parte de arquivo do multipart, e a linha do documento nem sempre guarda o mime.
// Uma regra só para os dois: duas cópias divergiriam.
export function guessMime(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    pdf: "application/pdf",
    png: "image/png",
    webp: "image/webp",
  };
  return (ext && map[ext]) || "application/octet-stream";
}
