// Logos dos empreendimentos, subidas pelo operador no Apolo. Vivem no bucket privado
// `apolo-documents` sob o prefixo `enterprise-logos/{enterpriseId}` (uma por empreendimento,
// upsert). SEM tabela nova: a existência e a URL saem do próprio storage (list + signed URL).
// O C2X guarda logos em ActiveStorage (difícil de extrair read-only), então o operador sobe
// aqui e o portal de credenciamento/cadastro reusa. Ver [[project_apolo_cadastro_imobiliaria]].
import { APOLO_DOCS_BUCKET } from "@/lib/apolo/documentos";
import type { createApoloAdminClient } from "@/lib/apolo/server";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

const LOGO_PREFIX = "enterprise-logos";
const SIGNED_URL_TTL = 60 * 60; // 1h — tempo de vida do link assinado da logo

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
}

function decodeBase64(value: string): Uint8Array | null {
  try {
    const raw =
      value.includes(",") && value.startsWith("data:")
        ? value.slice(value.indexOf(",") + 1)
        : value;
    return Uint8Array.from(Buffer.from(raw, "base64"));
  } catch {
    return null;
  }
}

// Sobe (ou substitui) a logo de um empreendimento. Path fixo por id → upsert troca a anterior.
export async function uploadEnterpriseLogo(input: {
  adminClient: AdminClient;
  contentType?: string | null;
  enterpriseId: string;
  fileBase64: string;
}): Promise<{ error?: string; ok: boolean; url?: string }> {
  const id = safeId(input.enterpriseId);
  if (!id) return { error: "Empreendimento invalido.", ok: false };
  const bytes = decodeBase64(input.fileBase64);
  if (!bytes) return { error: "Imagem invalida.", ok: false };

  const path = `${LOGO_PREFIX}/${id}`;
  const upload = await input.adminClient.storage
    .from(APOLO_DOCS_BUCKET)
    .upload(path, bytes, { contentType: input.contentType || "image/png", upsert: true });
  if (upload.error) {
    return { error: `Falha ao enviar a logo: ${upload.error.message}`, ok: false };
  }

  const signed = await input.adminClient.storage
    .from(APOLO_DOCS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL);
  return { ok: true, url: signed.data?.signedUrl };
}

// Mapa { enterpriseId -> signedUrl } de todas as logos já subidas (lê o prefixo do bucket).
export async function listEnterpriseLogos(
  adminClient: AdminClient,
): Promise<Record<string, string>> {
  const list = await adminClient.storage
    .from(APOLO_DOCS_BUCKET)
    .list(LOGO_PREFIX, { limit: 1000 });
  // id null = pseudo-pasta; fica de fora.
  const files = (list.data ?? []).filter((f) => f.name && f.id !== null);
  if (!files.length) return {};

  const paths = files.map((f) => `${LOGO_PREFIX}/${f.name}`);
  const signed = await adminClient.storage
    .from(APOLO_DOCS_BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL);

  const out: Record<string, string> = {};
  for (const item of signed.data ?? []) {
    if (item.signedUrl && item.path) {
      const id = item.path.slice(LOGO_PREFIX.length + 1);
      out[id] = item.signedUrl;
    }
  }
  return out;
}

export async function removeEnterpriseLogo(
  adminClient: AdminClient,
  enterpriseId: string,
): Promise<{ ok: boolean }> {
  const id = safeId(enterpriseId);
  if (!id) return { ok: false };
  await adminClient.storage.from(APOLO_DOCS_BUCKET).remove([`${LOGO_PREFIX}/${id}`]);
  return { ok: true };
}
