// Integração D4Sign compartilhada: baixa o PDF de um contrato assinado a partir do
// uuidDoc. O link salvo no C2X (link_pdf_signed_file) é um e-mail que EXPIRA, então
// aqui a gente pede um link fresco pela API do D4Sign a cada acesso e devolve o
// arquivo. Usado pelo Hades e pelo Apolo (carteira do empreendimento).
const D4SIGN_API_BASE_URL = "https://secure.d4sign.com.br/api/v1";

/**
 * ⚠️ TIMEOUT EM TODA CHAMADA — sem `AbortSignal` o `fetch` do Node espera o socket, e o padrão
 * dele é praticamente eterno. Numa rota de Next isso vira função pendurada até o `maxDuration`
 * do runtime, com o usuário olhando um spinner e a conexão ocupada; a mesma armadilha que o
 * `d4sign-consulta` já resolve com `AbortSignal.timeout` (lá, 6 s, medido).
 *
 * São DOIS orçamentos porque são dois pedidos de natureza diferente:
 *   • gerar o link é uma chamada de API que devolve um JSON de duas linhas — mesma faixa de
 *     latência das outras (mediana 1,4 s, pior caso medido 2,7 s), logo 8 s é folga larga;
 *   • baixar o PDF é transferência de arquivo (contrato real do Vista Alegre: 27 páginas), e a
 *     conta que importa é a banda de quem está com a tela aberta. 30 s cobre o arquivo grande
 *     numa conexão ruim sem deixar a rota presa para sempre.
 *
 * O `signal` vale também para a LEITURA DO CORPO: se o servidor abrir a resposta e travar no
 * meio, o `arrayBuffer()` é abortado junto — que é exatamente o caso que um timeout só de
 * cabeçalho deixaria passar.
 */
const TIMEOUT_LINK_MS = 8000;
const TIMEOUT_ARQUIVO_MS = 30_000;

/** O `AbortSignal.timeout` estourou (e não um erro de rede qualquer). */
function ehTimeout(erro: unknown): boolean {
  return erro instanceof Error && (erro.name === "TimeoutError" || erro.name === "AbortError");
}

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
      signal: AbortSignal.timeout(TIMEOUT_LINK_MS),
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
      signal: AbortSignal.timeout(TIMEOUT_ARQUIVO_MS),
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
  } catch (erro) {
    // ⚠️ O erro do fetch NÃO é repassado: a URL que ele carrega tem a credencial na query string.
    // O que sai é só a DIFERENÇA que muda o que a tela deve dizer — demorou demais (504) ou não
    // conectou (502).
    if (ehTimeout(erro)) {
      return {
        error: "O D4Sign demorou demais para responder.",
        ok: false,
        status: 504,
      };
    }

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
