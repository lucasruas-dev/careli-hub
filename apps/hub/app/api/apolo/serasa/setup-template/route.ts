import { Buffer } from "node:buffer";

import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { authorizeApoloWrite } from "@/lib/apolo/auth";
import { createApoloAdminClient } from "@/lib/apolo/server";
import {
  MetaWhatsAppSendError,
  createMetaWhatsAppMessageTemplate,
  getMetaWhatsAppOutboundConfig,
  uploadMetaWhatsAppTemplateHeaderMedia,
} from "@/lib/iris/meta-whatsapp";

// SETUP (uma vez) dos templates Meta da reprovacao de credito, na WABA do 4143.
//
// Cria DOIS templates:
//  1) coordenador (`reprovacao_de_credito`): header de DOCUMENTO (a CAD vai
//     anexada no disparo) + corpo com 3 variaveis (cliente, imobiliaria, corretor).
//  2) corretor (`credito_indeferido_corretor`): header de DOCUMENTO (a MESMA CAD, com status e
//     sem valores) + 1 variavel (cliente). Se ele ja existir como texto, delete no Business
//     Manager antes de recriar com o anexo.
//
// Depois de aprovados, o Apolo apenas DISPARA estes templates — este endpoint so
// os CRIA. A Meta exige uma amostra do documento na CRIACAO do template com header
// de midia (nao no disparo): subimos um PDF minimo aqui so pra obter o handle, e
// so o template do coordenador precisa dele.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Numero 4143 (atendimento). O config base vem das env; so trocamos o phoneNumberId
// pra criar os templates na WABA vinculada a esse numero.
const PHONE_NUMBER_ID_4143 = "1167201739813897";

// --- Template do coordenador (com header de documento) --------------------
const COORDENADOR_NAME = "reprovacao_de_credito";
const COORDENADOR_SLUG = "reprovacao-de-credito";
// {{1}} cliente · {{2}} imobiliaria · {{3}} corretor.
const COORDENADOR_BODY_TEXT =
  "Prezado(a) coordenador(a), o cliente {{1}}, da imobiliária {{2}}, indicado pelo corretor {{3}}, teve a análise de crédito reprovada e foi encaminhado para revisão. Segue a CAD do cliente em anexo.";
const COORDENADOR_BODY_EXAMPLES = [
  "MARCUS FLAVIO MORAIS ENOQUE",
  "Imobiliaria Vale do Ouro",
  "Joao Silva",
] as const;

// --- Template do corretor (so texto, 1 variavel) --------------------------
const CORRETOR_NAME = "reprovacao_de_credito_corretor";
const CORRETOR_SLUG = "reprovacao-de-credito-corretor";
// {{1}} cliente.
const CORRETOR_BODY_TEXT =
  "Prezado(a) corretor(a), a análise de crédito do cliente {{1}} foi indeferida, não seguindo para a próxima etapa do processo de cadastro.";
const CORRETOR_BODY_EXAMPLES = ["MARCUS FLAVIO MORAIS ENOQUE"] as const;

type ResultadoTemplate = {
  error?: string;
  handle?: string | null;
  httpStatus?: number;
  id: string | null;
  jaExistia: boolean;
  name: string;
  ok: boolean;
  status: string | null;
};

// PDF minimo de amostra (1 pagina). Nao e a CAD real: e so o exemplo que a Meta
// exige pra aprovar um header de documento.
async function gerarPdfAmostra(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  // A4 retrato.
  const page = doc.addPage([595.28, 841.89]);
  const font = await doc.embedFont(StandardFonts.Helvetica);

  page.drawText("Amostra - CAD do cliente", {
    color: rgb(0.051, 0.078, 0.11),
    font,
    size: 20,
    x: 42,
    y: 780,
  });
  page.drawText(
    "Documento de exemplo enviado a Meta para aprovacao do template.",
    {
      color: rgb(0.3, 0.34, 0.4),
      font,
      size: 11,
      x: 42,
      y: 752,
    },
  );

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

// A Meta rejeita a criacao de um template cujo nome+idioma ja existe. Nesse caso
// o objetivo do setup ja esta cumprido: tratamos como sucesso idempotente.
function ehTemplateDuplicado(error: MetaWhatsAppSendError): boolean {
  const message = error.message?.toLowerCase() ?? "";
  if (
    message.includes("already exists") ||
    message.includes("already been") ||
    message.includes("duplicate") ||
    message.includes("ja existe")
  ) {
    return true;
  }

  const details = error.details;
  if (details && typeof details === "object" && !Array.isArray(details)) {
    const record = details as Record<string, unknown>;
    const subcode = Number(record.error_subcode);
    // 2388023 = "template name already exists" no Graph.
    if (subcode === 2388023) {
      return true;
    }
  }

  return false;
}

// Cria um template na Meta tratando a duplicidade como sucesso idempotente.
// Nunca lanca: devolve sempre um ResultadoTemplate (ok:false com httpStatus em
// falhas duras) pra que o setup consiga reportar o status dos dois templates.
async function criarTemplate({
  components,
  config,
  name,
}: {
  components: unknown[];
  config: ReturnType<typeof getMetaWhatsAppOutboundConfig>;
  name: string;
}): Promise<ResultadoTemplate> {
  try {
    const template = await createMetaWhatsAppMessageTemplate({
      category: "UTILITY",
      components,
      config,
      language: "pt_BR",
      name,
      phoneNumberId: PHONE_NUMBER_ID_4143,
    });

    return {
      id: template.id,
      jaExistia: false,
      name: template.name ?? name,
      ok: true,
      status: template.status,
    };
  } catch (error) {
    if (error instanceof MetaWhatsAppSendError && ehTemplateDuplicado(error)) {
      return { id: null, jaExistia: true, name, ok: true, status: null };
    }

    const httpStatus =
      error instanceof MetaWhatsAppSendError ? error.status : 502;
    const message =
      error instanceof Error
        ? error.message
        : "Nao foi possivel criar o template na Meta.";

    return {
      error: message,
      httpStatus,
      id: null,
      jaExistia: false,
      name,
      ok: false,
      status: null,
    };
  }
}

// Registro minimo na biblioteca da Iris (nao-critico: se falhar, o template ja
// esta criado na Meta, que e o essencial).
async function registrarNaBiblioteca({
  body,
  bodyExamples,
  hasHeader,
  metaStatus,
  metaTemplateName,
  name,
  slug,
  variables,
}: {
  body: string;
  bodyExamples: string[];
  hasHeader: boolean;
  metaStatus: string | null;
  metaTemplateName: string;
  name: string;
  slug: string;
  variables: string[];
}): Promise<void> {
  const client = createApoloAdminClient();
  if (!client) {
    return;
  }

  try {
    await client.from("caredesk_templates").upsert(
      {
        body,
        category: "Atendimento",
        channel_kind: "whatsapp",
        metadata: {
          bodyExamples,
          mediaHeaderFormat: hasHeader ? "DOCUMENT" : null,
          metaCategory: "UTILITY",
          metaLanguage: "pt_BR",
          metaPhoneNumberId: PHONE_NUMBER_ID_4143,
          metaStatus: metaStatus ?? "PENDING",
          metaTemplateName,
          provider: "meta",
          source: "apolo",
          templatePurpose: "credit_rejection_notice",
        },
        name,
        slug,
        variables,
      },
      { onConflict: "slug" },
    );
  } catch {
    // Nao-critico: biblioteca da Iris e conveniencia; o template na Meta ja existe.
  }
}

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) {
    return auth.response;
  }

  const config = {
    ...getMetaWhatsAppOutboundConfig(),
    phoneNumberId: PHONE_NUMBER_ID_4143,
  };

  // --- Template 1: coordenador (header de documento) ----------------------
  let coordenador: ResultadoTemplate;
  let handle: string | null = null;

  try {
    // Sobe a amostra do documento pra obter o header_handle exigido na criacao.
    const pdf = await gerarPdfAmostra();
    const upload = await uploadMetaWhatsAppTemplateHeaderMedia({
      config,
      fileBuffer: pdf,
      fileLength: pdf.byteLength,
      fileName: "amostra-cad.pdf",
      mimeType: "application/pdf",
    });
    handle = upload.handle;

    if (!handle) {
      coordenador = {
        error: "A Meta nao retornou o identificador da amostra do documento.",
        httpStatus: 502,
        id: null,
        jaExistia: false,
        name: COORDENADOR_NAME,
        ok: false,
        status: null,
      };
    } else {
      coordenador = await criarTemplate({
        components: [
          {
            example: { header_handle: [handle] },
            format: "DOCUMENT",
            type: "HEADER",
          },
          {
            example: { body_text: [[...COORDENADOR_BODY_EXAMPLES]] },
            text: COORDENADOR_BODY_TEXT,
            type: "BODY",
          },
        ],
        config,
        name: COORDENADOR_NAME,
      });
      coordenador.handle = handle;
    }
  } catch (error) {
    const httpStatus =
      error instanceof MetaWhatsAppSendError ? error.status : 502;
    const message =
      error instanceof Error
        ? error.message
        : "Falha ao preparar a amostra do documento para a Meta.";
    coordenador = {
      error: message,
      httpStatus,
      id: null,
      jaExistia: false,
      name: COORDENADOR_NAME,
      ok: false,
      status: null,
    };
  }

  if (coordenador.ok) {
    await registrarNaBiblioteca({
      body: COORDENADOR_BODY_TEXT,
      bodyExamples: [...COORDENADOR_BODY_EXAMPLES],
      hasHeader: true,
      metaStatus: coordenador.status,
      metaTemplateName: COORDENADOR_NAME,
      name: "Reprovacao de credito (coordenador)",
      slug: COORDENADOR_SLUG,
      variables: ["cliente", "imobiliaria", "corretor"],
    });
  }

  // --- Template 2: corretor (AGORA também com header de DOCUMENTO: a mesma CAD do coordenador,
  // com status e SEM valores, vai anexada). Reusa o `handle` da amostra gerada acima. ---------
  const componentesCorretor: unknown[] = [];
  if (handle) {
    componentesCorretor.push({
      example: { header_handle: [handle] },
      format: "DOCUMENT",
      type: "HEADER",
    });
  }
  componentesCorretor.push({
    example: { body_text: [[...CORRETOR_BODY_EXAMPLES]] },
    text: CORRETOR_BODY_TEXT,
    type: "BODY",
  });
  const corretor = await criarTemplate({
    components: componentesCorretor,
    config,
    name: CORRETOR_NAME,
  });

  if (corretor.ok) {
    await registrarNaBiblioteca({
      body: CORRETOR_BODY_TEXT,
      bodyExamples: [...CORRETOR_BODY_EXAMPLES],
      hasHeader: Boolean(handle),
      metaStatus: corretor.status,
      metaTemplateName: CORRETOR_NAME,
      name: "Credito indeferido (corretor)",
      slug: CORRETOR_SLUG,
      variables: ["cliente"],
    });
  }

  // HTTP status: 200 se ambos ok (criados ou ja existentes); senao o pior erro.
  const httpStatus = coordenador.ok
    ? corretor.ok
      ? 200
      : corretor.httpStatus ?? 502
    : coordenador.httpStatus ?? 502;

  return NextResponse.json(
    { data: { coordenador, corretor } },
    { headers: { "Cache-Control": "no-store" }, status: httpStatus },
  );
}
