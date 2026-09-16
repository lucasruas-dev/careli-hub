// Gera a CAD da ficha e salva nos DOCUMENTOS do cliente (apolo_documents, tipo 'cad'). Usado tanto
// pelo gatilho automatico (na consulta de credito) quanto pelo botao de baixar do Board.
//
// Idempotente: substitui a CAD anterior de ORIGEM AUTOMATICA do MESMO empreendimento (nao acumula ao
// reconsultar), sem tocar CADs enviadas por outros caminhos (cadastro/portal) nem a CAD da pessoa em
// outro produto (16/09/2026, ver lib/apolo/cad-automatica-anterior.ts). Best-effort: nunca lanca.

import { type CadAutomaticaAnterior, cadsAutomaticasParaApagar } from "@/lib/apolo/cad-automatica-anterior";
import { montarCadDeEntidade } from "@/lib/apolo/cad-de-entidade";
import { uploadApoloDocument } from "@/lib/apolo/documentos";
import { lerCadDaEsteira, normalizarEnterpriseId } from "@/lib/apolo/esteira-cad";
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

    // (16/09/2026) DE QUAL CAD É ESTE PDF, e quais CADs a pessoa tem. O empreendimento vem do pedido
    // ou, sem ele, da mesma "CAD mais recente" que `montarCadDeEntidade` usou. As duas leituras
    // alimentam a marca do documento novo e a limpeza das anteriores (cad-automatica-anterior.ts):
    // sem elas, mover a CAD de um produto apagava o PDF da CAD da pessoa em outro.
    const [cadDaEsteira, esteiraDaPessoa] = await Promise.all([
      normalizarEnterpriseId(opts.enterpriseId)
        ? Promise.resolve(null)
        : lerCadDaEsteira<{ enterprise_id: null | string }>(client, entityId, "enterprise_id"),
      client.from("apolo_esteira").select("enterprise_id").eq("entity_id", entityId).limit(200),
    ]);
    const alvo =
      normalizarEnterpriseId(opts.enterpriseId) ?? normalizarEnterpriseId(cadDaEsteira?.enterprise_id);

    // Sobe a CAD NOVA primeiro: se o upload falhar, a CAD anterior é preservada (nunca fica sem
    // nenhuma). Só depois de gravada a nova é que se removem as anteriores.
    const salvo = await uploadApoloDocument({
      adminClient: client,
      documentType: CAD_DOC_TYPE,
      fileBase64: Buffer.from(bytes).toString("base64"),
      fileName: `${cad.arquivo}.pdf`,
      label: "CAD",
      // (16/09/2026) Com a marca do empreendimento: é o que o portal lê para saber de qual produto
      // é o PDF (lib/apolo/incorporador/documentos-do-portal.ts).
      metadataExtra: { origem: CAD_ORIGEM_AUTO, ...(alvo ? { enterpriseId: alvo } : {}) },
      mimeType: "application/pdf",
      ownerId: entityId,
      scope: "entidade",
      uploadedByName: opts.uploadedByName ?? null,
    });
    if (!salvo.ok || !salvo.id) return { error: salvo.error, ok: false };

    // Sem saber as CADs da pessoa, não apaga nada: sobra um PDF antigo, nunca some o do vizinho.
    if (esteiraDaPessoa.error) return { documentId: salvo.id, ok: true };

    // Remove as CADs automáticas ANTERIORES (não a recém-criada). Não acumula ao reconsultar; não
    // toca CADs de outras origens (cadastro/portal).
    //
    // (16/09/2026) ⚠️ E SÓ AS DO MESMO EMPREENDIMENTO (`cadsAutomaticasParaApagar`). Antes eram
    // todas as automáticas da pessoa, de qualquer produto.
    const { data: antigos } = await client
      .from("apolo_documents")
      .select("id, storage_bucket, storage_path, enterpriseId:metadata->>enterpriseId")
      .eq("entity_id", entityId)
      .eq("document_type", CAD_DOC_TYPE)
      .contains("metadata", { origem: CAD_ORIGEM_AUTO })
      .neq("id", salvo.id);
    const apagaveis = cadsAutomaticasParaApagar(
      (antigos ?? []) as unknown as CadAutomaticaAnterior[],
      {
        alvo,
        esteiraDaPessoa: ((esteiraDaPessoa.data ?? []) as Array<{ enterprise_id: null | string }>)
          .map((linha) => linha.enterprise_id ?? "")
          .filter(Boolean),
      },
    );
    for (const a of apagaveis) {
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
