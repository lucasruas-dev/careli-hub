// Gera a CAD da ficha e salva nos DOCUMENTOS do cliente (apolo_documents, tipo 'cad'). Usado tanto
// pelo gatilho automatico (na consulta de credito) quanto pelo botao de baixar do Board.
//
// Idempotente: substitui a CAD anterior de ORIGEM AUTOMATICA (nao acumula ao reconsultar), sem
// tocar CADs enviadas por outros caminhos (cadastro/portal). Best-effort: nunca lanca.

import { montarCadDeEntidade } from "@/lib/apolo/cad-de-entidade";
import { uploadApoloDocument } from "@/lib/apolo/documentos";
import type { createApoloAdminClient } from "@/lib/apolo/server";
import { montarCadPdf } from "@/modules/apolo/blocks/cadastro/cad-pdf";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

export const CAD_DOC_TYPE = "cad";
const CAD_ORIGEM_AUTO = "automatico";

// Limita uma promise best-effort a um teto de tempo, devolvendo null se estourar. A geração da CAD
// toca o C2X (MySQL legado, query sem timeout próprio); sob contenção poderia travar a resposta do
// operador além do maxDuration da função (504). Aqui a resposta sempre volta — a CAD que não deu
// tempo é regenerada na próxima transição.
export async function comLimiteDeTempo<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([promise, limite]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function gerarESalvarCad(
  client: AdminClient,
  entityId: string,
  // `enterpriseId` diz de qual CAD é o PDF (0080: uma CAD por empreendimento). Sem ele, a mais
  // recente — que é a que o Board mostra hoje.
  opts: { enterpriseId?: null | number | string; uploadedByName?: string | null } = {},
): Promise<{ documentId?: string; error?: string; ok: boolean }> {
  try {
    const cad = await montarCadDeEntidade(client, entityId, { enterpriseId: opts.enterpriseId });
    if (!cad) return { error: "Nao foi possivel montar a CAD desta ficha.", ok: false };

    const bytes = await montarCadPdf(cad);

    // Sobe a CAD NOVA primeiro: se o upload falhar, a CAD anterior é preservada (nunca fica sem
    // nenhuma). Só depois de gravada a nova é que se removem as anteriores.
    const salvo = await uploadApoloDocument({
      adminClient: client,
      documentType: CAD_DOC_TYPE,
      fileBase64: Buffer.from(bytes).toString("base64"),
      fileName: `${cad.arquivo}.pdf`,
      label: "CAD",
      metadataExtra: { origem: CAD_ORIGEM_AUTO },
      mimeType: "application/pdf",
      ownerId: entityId,
      scope: "entidade",
      uploadedByName: opts.uploadedByName ?? null,
    });
    if (!salvo.ok || !salvo.id) return { error: salvo.error, ok: false };

    // Remove as CADs automáticas ANTERIORES (não a recém-criada). Não acumula ao reconsultar; não
    // toca CADs de outras origens (cadastro/portal).
    const { data: antigos } = await client
      .from("apolo_documents")
      .select("id, storage_bucket, storage_path")
      .eq("entity_id", entityId)
      .eq("document_type", CAD_DOC_TYPE)
      .contains("metadata", { origem: CAD_ORIGEM_AUTO })
      .neq("id", salvo.id);
    for (const a of (antigos ?? []) as {
      id: string;
      storage_bucket: string | null;
      storage_path: string | null;
    }[]) {
      if (a.storage_path) {
        await client.storage.from(a.storage_bucket ?? "apolo-documents").remove([a.storage_path]);
      }
      await client.from("apolo_documents").delete().eq("id", a.id);
    }

    return { documentId: salvo.id, ok: true };
  } catch (e) {
    return { error: (e as Error).message, ok: false };
  }
}
