// Integração D4Sign compartilhada: baixa o PDF de um contrato assinado a partir do
// uuidDoc. O link salvo no C2X (link_pdf_signed_file) é um e-mail que EXPIRA, então
// aqui a gente pede um link fresco pela API do D4Sign a cada acesso e devolve o
// arquivo. Usado pelo Hades e pelo Apolo (carteira do empreendimento).
const D4SIGN_API_BASE_URL = "https://secure.d4sign.com.br/api/v1";

export type D4SignContractResult =
  | {
      body: ArrayBuffer;
      contentLength: string | null;
      contentType: string;
      ok: true;
    }
  | { error: string; ok: false; status: number };

export async function fetchD4SignContract(
  documentId: string,
): Promise<D4SignContractResult> {
  const id = documentId.trim();

  if (!id) {
    return { error: "Documento D4Sign nao informado.", ok: false, status: 400 };
  }

  const tokenAPI = process.env.D4SIGN_TOKEN_API;
  const cryptKey = process.env.D4SIGN_CRYPT_KEY;

  if (!tokenAPI || !cryptKey) {
    return {
      error: "Credenciais D4Sign nao configuradas no Hub.",
      ok: false,
      status: 503,
    };
  }

  const params = new URLSearchParams({ cryptKey, tokenAPI });
  const downloadUrl = `${D4SIGN_API_BASE_URL}/documents/${encodeURIComponent(
    id,
  )}/download?${params.toString()}`;

  try {
    const linkResponse = await fetch(downloadUrl, {
      body: JSON.stringify({ language: "pt", type: "PDF" }),
      cache: "no-store",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      method: "POST",
    });
    const payload = (await linkResponse.json().catch(() => null)) as {
      message?: string;
      url?: string;
    } | null;

    if (!linkResponse.ok || !payload?.url) {
      return {
        error: "Nao foi possivel gerar um novo link do contrato D4Sign.",
        ok: false,
        status: 502,
      };
    }

    const fileResponse = await fetch(payload.url, {
      cache: "no-store",
      redirect: "follow",
    });

    if (!fileResponse.ok) {
      return {
        error: "Nao foi possivel abrir o contrato D4Sign.",
        ok: false,
        status: 502,
      };
    }

    return {
      body: await fileResponse.arrayBuffer(),
      contentLength: fileResponse.headers.get("content-length"),
      contentType: fileResponse.headers.get("content-type") ?? "application/pdf",
      ok: true,
    };
  } catch {
    return {
      error: "Nao foi possivel conectar ao D4Sign agora.",
      ok: false,
      status: 502,
    };
  }
}

export function d4signPdfHeaders(
  documentId: string,
  contentType: string,
  contentLength?: string | null,
): Headers {
  const isPdf =
    contentType.includes("application/pdf") ||
    contentType.includes("application/octet-stream");
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Disposition": `inline; filename="contrato-${documentId}.pdf"`,
    "Content-Type": isPdf ? "application/pdf" : contentType,
    "X-Content-Type-Options": "nosniff",
  });

  if (contentLength) {
    headers.set("Content-Length", contentLength);
  }

  return headers;
}
