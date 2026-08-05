import { createApoloAdminClient } from "@/lib/apolo/server";
import { lerPa, PROMETEU_PA_BUCKET } from "@/lib/prometeu/pa";

// A PA VIRA DOCUMENTO DO CADASTRO (pedido do Lucas, 03/08: "a PA que foi registrada no bip da
// secretária tem que estar dentro dos documentos no cadastro do cliente").
//
// A foto tirada no bip nasce no bucket do evento (`prometeu-pa`) e vive dentro do metadata do
// credenciado — ótimo para o dia, invisível depois. Aqui ela ganha uma linha em `apolo_documents`
// e passa a aparecer na ficha do cliente, junto de RG, comprovante e CAD.
//
// ⚠️ NÃO COPIA ARQUIVO: a linha aponta para o MESMO objeto no bucket do evento (storage_bucket
// = "prometeu-pa"). Sem duplicar bytes e sem risco de as duas cópias divergirem.
//
// A PA FICA SÓ NO APOLO (decisão do Lucas): não entra no envio de documentos ao C2X.
export const PA_DOCUMENT_TYPE = "pa";

// Nome no padrão da casa, igual ao da CAD: "PA - Nome Do Cliente - 03/08/2026 14:20".
function nomeDoArquivo(nomeCliente: string, registradaEm: string): string {
  const quando = registradaEm ? new Date(registradaEm) : new Date();
  const data = quando.toLocaleString("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const nome = nomeCliente
    .trim()
    .toLocaleLowerCase("pt-BR")
    .replace(/(^|\s|')\p{L}/gu, (m) => m.toLocaleUpperCase("pt-BR"));
  return `PA - ${nome} - ${data}`;
}

export type ResultadoPaNoApolo =
  | { criado: false; motivo: string; ok: true }
  | { criado: true; ok: true }
  | { error: string; ok: false };

// Liga a PA de UM credenciado à ficha dele no Apolo. Idempotente: se a mesma foto já virou
// documento, não cria de novo (o backfill e o gancho podem rodar juntos sem duplicar).
export async function registrarPaNoApolo(input: {
  entityId: string | null;
  metadata: unknown;
  nomeCliente: string;
}): Promise<ResultadoPaNoApolo> {
  const pa = lerPa(input.metadata);
  if (!pa) return { criado: false, motivo: "sem PA registrada", ok: true };
  if (!input.entityId) return { criado: false, motivo: "credenciado sem ficha no Apolo", ok: true };

  const client = createApoloAdminClient();
  if (!client) return { error: "Supabase indisponível.", ok: false };

  const { data: jaExiste } = await client
    .from("apolo_documents")
    .select("id")
    .eq("entity_id", input.entityId)
    .eq("storage_path", pa.path)
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (jaExiste) return { criado: false, motivo: "já estava no cadastro", ok: true };

  const fileName = `${nomeDoArquivo(input.nomeCliente, pa.registradaEm)}.jpg`;
  const { error } = await client.from("apolo_documents").insert({
    document_type: PA_DOCUMENT_TYPE,
    entity_id: input.entityId,
    label: "PA (Proposta de Aquisição)",
    metadata: {
      fileName,
      origem: "prometeu-bip-secretaria",
      registradaEm: pa.registradaEm,
      source: "prometeu",
      uploadedByName: pa.registradaPor || "Secretaria do lançamento",
    },
    status: "ready",
    storage_bucket: PROMETEU_PA_BUCKET,
    storage_path: pa.path,
  });

  if (error) return { error: error.message, ok: false };
  return { criado: true, ok: true };
}
