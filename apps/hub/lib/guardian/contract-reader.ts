import { Buffer } from "node:buffer";

// Leitura de contrato assinado (D4Sign) para a Athena/CACA: baixa o PDF e
// devolve como data URL base64, que a OpenAI le nativamente (input_file). O PDF
// e cacheado por documento (contrato assinado nao muda) pra reduzir custo.

const D4SIGN_API_BASE_URL = "https://secure.d4sign.com.br/api/v1";
const MAX_CONTRACT_BYTES = 20_000_000;
const CONTRACT_CACHE_TTL_MS = 30 * 60 * 1000;

const contractPdfCache = new Map<string, { at: number; dataUrl: string }>();

export async function fetchContractPdfDataUrl(
  documentId: string,
): Promise<string | null> {
  const id = documentId.trim();
  if (!id) {
    return null;
  }

  const cached = contractPdfCache.get(id);
  if (cached && Date.now() - cached.at < CONTRACT_CACHE_TTL_MS) {
    return cached.dataUrl;
  }

  const tokenAPI = process.env.D4SIGN_TOKEN_API;
  const cryptKey = process.env.D4SIGN_CRYPT_KEY;
  if (!tokenAPI || !cryptKey) {
    return null;
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
    const linkPayload = (await linkResponse.json().catch(() => null)) as {
      url?: string;
    } | null;
    if (!linkResponse.ok || !linkPayload?.url) {
      return null;
    }

    const fileResponse = await fetch(linkPayload.url, {
      cache: "no-store",
      redirect: "follow",
    });
    if (!fileResponse.ok) {
      return null;
    }
    const buffer = Buffer.from(await fileResponse.arrayBuffer());
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_CONTRACT_BYTES) {
      return null;
    }

    const dataUrl = `data:application/pdf;base64,${buffer.toString("base64")}`;
    contractPdfCache.set(id, { at: Date.now(), dataUrl });
    return dataUrl;
  } catch {
    return null;
  }
}

// Detecta intencao de duvida sobre contrato no pedido do operador.
export function hasContractIntent(text: string): boolean {
  return /(contrato|cl[aá]usula|rescis|distrato|reajuste|[ií]ndice|corre[cç][aã]o|multa|car[eê]ncia|quita[cç][aã]o do contrato|prazo do contrato|vencimento do contrato|foro|garantia|aditivo)/i.test(
    text,
  );
}
