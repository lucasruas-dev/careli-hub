import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { listEnterpriseLogos, uploadEnterpriseLogo } from "@/lib/apolo/enterprise-logos";
import { createApoloAdminClient } from "@/lib/apolo/server";

// Logos dos empreendimentos: GET lista { id -> url } (pra tela de empreendimentos e o portal de
// credenciamento); POST sobe/substitui a logo de um empreendimento. Bucket privado, URL assinada.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ~3MB de imagem viram ~4.1MB em base64; deixo folga.
const MAX_BASE64_LENGTH = 4_500_000;

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const logos = await listEnterpriseLogos(adminClient);
  return NextResponse.json(
    { data: { logos } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  let body: { contentType?: string; enterpriseId?: string; fileBase64?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Corpo invalido." }, { status: 400 });
  }

  if (!body.enterpriseId || !body.fileBase64) {
    return NextResponse.json(
      { error: "Informe o empreendimento e a imagem." },
      { status: 400 },
    );
  }
  if (body.fileBase64.length > MAX_BASE64_LENGTH) {
    return NextResponse.json({ error: "Imagem muito grande (max 3MB)." }, { status: 413 });
  }

  const result = await uploadEnterpriseLogo({
    adminClient,
    contentType: body.contentType,
    enterpriseId: body.enterpriseId,
    fileBase64: body.fileBase64,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ data: { url: result.url } });
}
