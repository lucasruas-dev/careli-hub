import { type NextRequest } from "next/server";

import {
  authorizeHubItTicketRequest,
  createHubItTicketAttachmentUploadUrl,
} from "@/lib/hub-it-tickets/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Esta rota NAO recebe o arquivo: ela devolve uma signed upload URL e o cliente
// envia os bytes DIRETO pro Supabase Storage. Sem isso batemos no limite de
// ~4.5MB de body das functions da Vercel, que era justamente o que forcava a
// gravacao de tela a 450 kbps e o print a JPEG 82%.
export async function POST(request: NextRequest) {
  const authorization = await authorizeHubItTicketRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  try {
    const body = (await request.json().catch(() => null)) as {
      fileName?: unknown;
    } | null;
    const upload = await createHubItTicketAttachmentUploadUrl({
      fileName: typeof body?.fileName === "string" ? body.fileName : "",
      userId: authorization.user.id,
    });

    return Response.json(upload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel preparar o envio do anexo.",
      },
      { status: 500 },
    );
  }
}
