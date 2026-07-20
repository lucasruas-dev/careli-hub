// Helpers comuns das rotas de /api/publico/*.
//
// Existem para que TODA resposta pública saia com a mesma forma: no-store, erro genérico e
// uniforme, e nenhum id interno vazando. Três mensagens de erro diferentes ("CNPJ inválido" x
// "não credenciado" x "suspensa") são três bits de informação para quem está enumerando.
import { NextResponse } from "next/server";

import { createApoloAdminClient } from "@/lib/apolo/server";
import { comPisoDeLatencia, consumir, chaveDoRequest, type Balde } from "@/lib/publico/cad/rate-limit";

export const NO_STORE = { "Cache-Control": "no-store" } as const;

// A única mensagem de falha que o público vê. Diz o que fazer, não o que quebrou.
export const ERRO_GENERICO =
  "Não conseguimos concluir agora. Tente novamente em alguns instantes ou fale com a nossa central.";

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { headers: NO_STORE, status });
}

export function erro(mensagem = ERRO_GENERICO, status = 400): NextResponse {
  return json({ error: mensagem }, status);
}

export type PreparoResultado =
  | { ok: false; response: NextResponse }
  | { adminClient: NonNullable<ReturnType<typeof createApoloAdminClient>>; inicio: number; ok: true };

// Abre a rota: aplica o teto de uso e devolve o client. Toda rota pública começa por aqui.
export async function prepararRota(
  request: Request,
  balde: Balde,
): Promise<PreparoResultado> {
  const inicio = Date.now();
  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    return { ok: false, response: erro(ERRO_GENERICO, 503) };
  }

  const veredito = await consumir(adminClient, balde, chaveDoRequest(request));
  if (!veredito.permitido) {
    return {
      ok: false,
      response: json(
        {
          error:
            "Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo, ou fale com a nossa central.",
        },
        429,
      ),
    };
  }
  if (veredito.esperaMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, veredito.esperaMs));
  }

  return { adminClient, inicio, ok: true };
}

// Achata a latência antes de responder (ver PISO_LATENCIA_MS).
export async function responder(inicio: number, response: NextResponse): Promise<NextResponse> {
  return comPisoDeLatencia(inicio, response);
}

export async function lerCorpo<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
