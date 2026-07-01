import { NextResponse, type NextRequest } from "next/server";

import {
  authorTemplate,
  type TemplateAuthorVariable,
} from "@/lib/iris/athena/template-author";
import { authorizeIrisMetaRequest } from "@/lib/iris/meta-server";

// POST /api/iris/athena/templates — a Athena (copiloto interno) redige um
// template de WhatsApp a partir da descricao do operador. So Setup (admin).
export async function POST(request: NextRequest) {
  const authorization = await authorizeIrisMetaRequest(request, ["admin"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "Payload invalido para a Athena." },
      { status: 400 },
    );
  }

  const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
  const variables: TemplateAuthorVariable[] = Array.isArray(payload.variables)
    ? (payload.variables as unknown[]).flatMap((item) => {
        const entry = (item ?? {}) as Record<string, unknown>;
        const key = typeof entry.key === "string" ? entry.key : "";
        if (!key) return [];
        return [
          {
            example: typeof entry.example === "string" ? entry.example : null,
            key,
            label: typeof entry.label === "string" ? entry.label : null,
            readiness:
              typeof entry.readiness === "string" ? entry.readiness : null,
          },
        ];
      })
    : [];
  const existingNames = Array.isArray(payload.existingNames)
    ? (payload.existingNames as unknown[]).filter(
        (name): name is string => typeof name === "string",
      )
    : [];
  const contextHint =
    typeof payload.contextHint === "string" ? payload.contextHint : null;

  const result = await authorTemplate({
    contextHint,
    existingNames,
    prompt,
    variables,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ draft: result.draft, model: result.model });
}
