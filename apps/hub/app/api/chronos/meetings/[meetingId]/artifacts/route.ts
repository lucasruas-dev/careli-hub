import { type NextRequest } from "next/server";

import {
  authorizeChronosRequest,
  getChronosMeetingArtifacts,
} from "@/lib/chronos/server";

// Artefatos pesados de UMA reuniao (timeline + transcricao + chat), carregados
// sob demanda quando o usuario abre a reuniao. Sairam do snapshot geral do
// Chronos por peso (13MB+ por carregamento derrubavam a funcao por memoria).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> },
) {
  const authorization = await authorizeChronosRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const { meetingId } = await params;

  if (!meetingId) {
    return Response.json({ error: "Reuniao invalida." }, { status: 400 });
  }

  try {
    const artifacts = await getChronosMeetingArtifacts(authorization, meetingId);

    if (!artifacts) {
      return Response.json(
        { error: "Reuniao nao encontrada ou sem acesso." },
        { status: 404 },
      );
    }

    return Response.json(artifacts, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { error: "Nao foi possivel carregar os detalhes da reuniao." },
      { status: 503 },
    );
  }
}
