import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import {
  MostqiError,
  authenticateMostqi,
  enrichPerson,
  extractDocument,
  getMostqiStatus,
  isMostqiConfigured,
  probeEnrichment,
} from "@/lib/apolo/mostqi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// O enrichment do MOST roda datasets on-demand em tempo real (pode passar de
// 100s); damos folga no timeout da funcao.
export const maxDuration = 300;

// Base64 de uma imagem de 20MB ~ 27MB de texto; travamos um teto defensivo.
const MAX_BASE64_LENGTH = 28_000_000;

const noStore = { "Cache-Control": "no-store" } as const;

// GET: status seguro da conexao (sem chave, sem token).
export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  return NextResponse.json({ data: getMostqiStatus() }, { headers: noStore });
}

// POST: acoes do sandbox de teste (authenticate | extract).
export async function POST(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as {
    action?: string;
    cpf?: string;
    datasets?: string[];
    documento?: string;
    fileBase64?: string;
    fileName?: string;
    query?: string;
    tags?: string[];
  } | null;

  if (!body?.action) {
    return NextResponse.json(
      { error: "Informe a acao (authenticate ou extract)." },
      { headers: noStore, status: 400 },
    );
  }

  if (body.action === "authenticate") {
    if (!isMostqiConfigured()) {
      return NextResponse.json(
        {
          data: {
            configured: false,
            message:
              "Modo simulado: sem MOSTQI_CLIENT_KEY, nenhum token e emitido. Preencha a env para o handshake real.",
            ok: false,
          },
        },
        { headers: noStore },
      );
    }

    const startedAt = Date.now();
    try {
      // Nao devolvemos o token; so confirmamos que o handshake funcionou.
      await authenticateMostqi();
      return NextResponse.json(
        {
          data: {
            configured: true,
            message: "Handshake OK: token temporario emitido e validado.",
            ok: true,
            tookMs: Date.now() - startedAt,
          },
        },
        { headers: noStore },
      );
    } catch (error) {
      return respondMostqiError(error);
    }
  }

  if (body.action === "extract") {
    if (isMostqiConfigured() && !body.fileBase64) {
      return NextResponse.json(
        { error: "Envie o documento (fileBase64) para extrair." },
        { headers: noStore, status: 400 },
      );
    }

    if (body.fileBase64 && body.fileBase64.length > MAX_BASE64_LENGTH) {
      return NextResponse.json(
        { error: "Arquivo acima do limite de 20MB." },
        { headers: noStore, status: 413 },
      );
    }

    try {
      const extraction = await extractDocument({
        fileBase64: stripDataUrl(body.fileBase64),
        fileName: body.fileName,
        includeRaw: true,
        tags: body.tags,
      });
      return NextResponse.json({ data: extraction }, { headers: noStore });
    } catch (error) {
      return respondMostqiError(error);
    }
  }

  // Laboratorio de enriquecimento: devolve os datasets crus de UMA query
  // nomeada, para o operador ver o dado antes de decidir o que entra no CAD.
  // Uma chamada = uma consulta cobrada no plano do MOST.
  if (body.action === "probe") {
    try {
      const probe = await probeEnrichment(String(body.documento ?? body.cpf ?? ""), {
        datasets: Array.isArray(body.datasets) ? body.datasets : undefined,
        includeRaw: true,
        query: typeof body.query === "string" ? body.query : undefined,
      });
      return NextResponse.json({ data: probe }, { headers: noStore });
    } catch (error) {
      return respondMostqiError(error);
    }
  }

  if (body.action === "enrich") {
    try {
      const enr = await enrichPerson(String(body.cpf ?? ""), {
        datasets: Array.isArray(body.datasets) ? body.datasets : undefined,
        includeRaw: true,
        query: typeof body.query === "string" ? body.query : undefined,
      });
      return NextResponse.json({ data: enr }, { headers: noStore });
    } catch (error) {
      return respondMostqiError(error);
    }
  }

  return NextResponse.json(
    { error: `Acao desconhecida: ${body.action}` },
    { headers: noStore, status: 400 },
  );
}

// Aceita tanto "data:image/png;base64,XXXX" quanto o base64 puro.
function stripDataUrl(value?: string): string | undefined {
  if (!value) return undefined;
  const comma = value.indexOf(",");
  return value.startsWith("data:") && comma >= 0
    ? value.slice(comma + 1)
    : value;
}

function respondMostqiError(error: unknown) {
  if (error instanceof MostqiError) {
    return NextResponse.json(
      { error: error.message },
      { headers: noStore, status: error.status ?? 502 },
    );
  }
  return NextResponse.json(
    { error: `Falha inesperada ao falar com o MOSTQI: ${(error as Error).message}` },
    { headers: noStore, status: 500 },
  );
}
