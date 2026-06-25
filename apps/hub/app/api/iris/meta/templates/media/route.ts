import { Buffer } from "node:buffer";

import { NextResponse, type NextRequest } from "next/server";

import {
  MetaWhatsAppSendError,
  uploadMetaWhatsAppTemplateHeaderMedia,
} from "@/lib/iris/meta-whatsapp";
import { authorizeIrisMetaRequest } from "@/lib/iris/meta-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TemplateHeaderFormat = "DOCUMENT" | "IMAGE" | "VIDEO";

const TEMPLATE_MEDIA_RULES: Record<
  TemplateHeaderFormat,
  {
    maxBytes: number;
    mimes: string[];
  }
> = {
  DOCUMENT: {
    maxBytes: 100 * 1024 * 1024,
    mimes: ["application/pdf"],
  },
  IMAGE: {
    maxBytes: 5 * 1024 * 1024,
    mimes: ["image/jpeg", "image/jpg", "image/png"],
  },
  VIDEO: {
    maxBytes: 16 * 1024 * 1024,
    mimes: ["video/mp4", "video/3gpp"],
  },
};

export async function POST(request: NextRequest) {
  const authorization = await authorizeIrisMetaRequest(request, [
    "admin",
    "leader",
  ]);

  if (!authorization.ok) {
    return authorization.response;
  }

  try {
    const formData = await request.formData();
    const format = normalizeHeaderFormat(formData.get("format"));
    const fileValue = formData.get("file");

    if (!format) {
      return NextResponse.json(
        createTemplateMediaErrorPayload({
          action: "Escolha Imagem, Video ou Documento antes de enviar o arquivo.",
          cause: "A Iris nao recebeu o tipo de header que deve ser aprovado pela Meta.",
          message: "Selecione o tipo de midia do header.",
          title: "Tipo de midia pendente",
        }),
        { status: 400 },
      );
    }

    if (!isUploadedFile(fileValue)) {
      return NextResponse.json(
        createTemplateMediaErrorPayload({
          action: "Selecione um arquivo local para a Meta usar como amostra do template.",
          cause: "Templates com header de midia precisam de uma amostra enviada antes da aprovacao.",
          message: "Envie uma midia de exemplo para a Meta.",
          title: "Arquivo de exemplo pendente",
        }),
        { status: 400 },
      );
    }

    const fileName = normalizeText(fileValue.name) ?? "iris-template-media";
    const mimeType = normalizeText(fileValue.type) ?? inferMimeType(fileName);
    const size = Number(fileValue.size ?? 0);
    const rules = TEMPLATE_MEDIA_RULES[format];

    if (!mimeType || !rules.mimes.includes(mimeType.toLowerCase())) {
      return NextResponse.json(
        createTemplateMediaErrorPayload({
          action:
            "Use JPG/PNG para imagem, MP4/3GPP para video ou PDF para documento.",
          cause:
            "O tipo do arquivo nao combina com o header escolhido para o template.",
          message: "Formato de midia invalido para este header.",
          title: "Formato de midia invalido",
        }),
        { status: 400 },
      );
    }

    if (!Number.isFinite(size) || size <= 0 || size > rules.maxBytes) {
      return NextResponse.json(
        createTemplateMediaErrorPayload({
          action: "Reduza o arquivo ou selecione uma midia dentro do limite aceito pela Meta.",
          cause:
            "A Meta limita o tamanho da amostra: imagem ate 5 MB, video ate 16 MB e PDF ate 100 MB.",
          message: `Midia acima do limite permitido para ${format.toLowerCase()}.`,
          title: "Arquivo grande demais",
        }),
        { status: 400 },
      );
    }

    const fileBuffer = Buffer.from(await fileValue.arrayBuffer());
    const upload = await uploadMetaWhatsAppTemplateHeaderMedia({
      fileBuffer,
      fileLength: fileBuffer.byteLength,
      fileName,
      mimeType,
    });

    if (!upload.handle) {
      return NextResponse.json(
        createTemplateMediaErrorPayload({
          action: "Tente enviar a amostra novamente. Se repetir, valide a permissao de upload da conta Meta.",
          cause:
            "A Meta recebeu a chamada, mas nao devolveu o handle necessario para criar o template.",
          message: "A Meta nao retornou o identificador da midia de exemplo.",
          title: "Identificador da midia ausente",
        }),
        { status: 502 },
      );
    }

    return NextResponse.json(
      {
        media: {
          fileName,
          format,
          handle: upload.handle,
          mimeType,
          size,
        },
        ok: true,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status = error instanceof MetaWhatsAppSendError ? error.status : 502;

    return NextResponse.json(
      describeTemplateMediaError(error),
      { status },
    );
  }
}

function createTemplateMediaErrorPayload({
  action,
  cause,
  message,
  title,
}: {
  action: string;
  cause: string;
  message: string;
  title: string;
}) {
  return {
    error: message,
    errorAction: action,
    errorCause: cause,
    errorTitle: title,
  };
}

function describeTemplateMediaError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : "Nao foi possivel enviar a midia de exemplo para a Meta.";
  const metaCode =
    error instanceof MetaWhatsAppSendError && error.code !== null
      ? String(error.code)
      : null;
  const detail = readMetaErrorDetail(error);
  const searchable = [message, detail, metaCode]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    searchable.includes("invalid parameter") ||
    searchable.includes("upload") ||
    searchable.includes("session")
  ) {
    return {
      error: "A Meta recusou a midia de exemplo.",
      errorAction:
        "Confira formato, tamanho e tente enviar novamente. Se repetir, valide se o app/token tem permissao para upload no Business Manager.",
      errorCause:
        "O upload de amostra nao passou pela validacao da Meta ou a sessao de upload nao foi aceita.",
      errorTitle: "Midia recusada pela Meta",
      metaCode,
      metaDetail: detail,
      providerMessage: sanitizeMetaProviderMessage(message),
    };
  }

  return {
    error: message,
    errorAction:
      "Tente novamente. Se repetir, valide permissao do app/token e a WABA usada pela Iris.",
    errorCause:
      "A Meta retornou uma falha nao classificada no upload da amostra.",
    errorTitle: "Falha no upload da midia",
    metaCode,
    metaDetail: detail,
    providerMessage: sanitizeMetaProviderMessage(message),
  };
}

function readMetaErrorDetail(error: unknown) {
  if (!(error instanceof MetaWhatsAppSendError)) {
    return null;
  }

  const details = error.details;

  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return null;
  }

  const record = details as Record<string, unknown>;
  const errorData =
    record.error_data && typeof record.error_data === "object"
      ? (record.error_data as Record<string, unknown>)
      : null;
  const detail =
    normalizeText(errorData?.details) ??
    normalizeText(record.details) ??
    normalizeText(record.error_user_msg);

  return detail ? sanitizeMetaProviderMessage(detail) : null;
}

function sanitizeMetaProviderMessage(value: string | null) {
  if (!value) {
    return null;
  }

  return value
    .replace(/Object with ID\s+'?\d+'?/gi, "Objeto Meta configurado")
    .replace(/\b\d{8,}\b/g, "[id-meta]")
    .slice(0, 260);
}

function isUploadedFile(value: FormDataEntryValue | null): value is File {
  if (!value || typeof value !== "object") {
    return false;
  }

  return (
    "arrayBuffer" in value &&
    typeof value.arrayBuffer === "function" &&
    "name" in value &&
    typeof value.name === "string"
  );
}

function inferMimeType(fileName: string) {
  const lowerName = fileName.toLowerCase();

  if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) {
    return "image/jpeg";
  }

  if (lowerName.endsWith(".png")) {
    return "image/png";
  }

  if (lowerName.endsWith(".mp4")) {
    return "video/mp4";
  }

  if (lowerName.endsWith(".3gp")) {
    return "video/3gpp";
  }

  if (lowerName.endsWith(".pdf")) {
    return "application/pdf";
  }

  return null;
}

function normalizeHeaderFormat(value: unknown): TemplateHeaderFormat | null {
  return value === "DOCUMENT" || value === "IMAGE" || value === "VIDEO"
    ? value
    : null;
}

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
