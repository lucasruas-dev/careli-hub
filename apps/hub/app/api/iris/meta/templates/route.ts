import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  MetaWhatsAppSendError,
  createMetaWhatsAppMessageTemplate,
  getMetaWhatsAppOutboundConfig,
  getMetaWhatsAppPhoneNumberLinkStatus,
  listMetaWhatsAppMessageTemplates,
  listMetaWhatsAppPhoneNumbers,
  type MetaWhatsAppPhoneNumberSummary,
  type MetaWhatsAppTemplateSummary,
} from "@/lib/iris/meta-whatsapp";
import { authorizeIrisMetaRequest } from "@/lib/iris/meta-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const IRIS_OPT_IN_TEMPLATE = {
  bodyText: "Olá {{1}}, estou testando a Iris, podemos conversar?",
  buttons: ["Sim", "Não"],
  category: "MARKETING" as const,
  displayName: "Opt-in Iris teste",
  exampleName: "Lucas",
  language: "pt_BR",
  name: "iris_opt_in_teste_v1",
  slug: "iris-opt-in-teste-v1",
  variables: [
    {
      example: "Lucas",
      key: "primeiro_nome",
      label: "Primeiro nome",
      placeholder: "{{1}}",
    },
  ],
};
type MetaTemplateCategory = "AUTHENTICATION" | "MARKETING" | "UTILITY";
type MetaTemplateHeaderFormat = "DOCUMENT" | "IMAGE" | "VIDEO";
type MetaTemplateSyncContext = {
  bodyText?: string | null;
  buttons?: string[] | null;
  displayName?: string | null;
  queueLabel?: string | null;
  subjectLabel?: string | null;
};
type MetaTemplateSyncResult = {
  error: string | null;
  id?: string | null;
  imported?: boolean;
  localStatus?: string | null;
  matched: boolean;
  metaStatus?: string | null;
  ok: boolean;
};

export async function GET(request: NextRequest) {
  const authorization = await authorizeIrisMetaRequest(request, [
    "admin",
    "leader",
    "operator",
  ]);

  if (!authorization.ok) {
    return authorization.response;
  }

  const url = new URL(request.url);
  const name = normalizeTemplateName(url.searchParams.get("name")) ?? undefined;
  const language =
    normalizeLanguage(url.searchParams.get("language")) ?? undefined;
  const requestedPhoneNumberId = normalizeText(
    url.searchParams.get("phoneNumberId"),
  );
  const syncApprovedTemplates = readBooleanSearchParam(
    url.searchParams.get("syncApproved"),
  );

  try {
    const phoneNumbers = await enrichMetaPhoneNumbersFromWebhookEvents(
      authorization.client,
      await listMetaWhatsAppPhoneNumbers(),
    );
    const selectedPhoneNumber = selectMetaPhoneNumber(
      phoneNumbers,
      requestedPhoneNumberId,
    );
    const selectedPhoneNumberId =
      selectedPhoneNumber?.id ?? requestedPhoneNumberId ?? null;
    const phoneNumberLink =
      await getSafePhoneNumberLinkStatus(selectedPhoneNumberId);

    try {
      const templates = (
        await listMetaWhatsAppMessageTemplates({
          language,
          limit: 100,
          name,
          phoneNumberId: selectedPhoneNumberId,
        })
      ).filter((template) => {
        return (
          (!name || template.name === name) &&
          (!language || template.language === language)
        );
      });
      const syncContext = readTemplateSyncContextFromSearchParams(
        url.searchParams,
      );
      const localTemplateSyncResults: MetaTemplateSyncResult[] = [];
      const syncCandidates = selectLocalTemplateSyncCandidates({
        language,
        name,
        syncApprovedTemplates,
        templates,
      });

      for (const metaTemplate of syncCandidates) {
        localTemplateSyncResults.push(
          await syncLocalTemplateStatusFromMeta({
            client: authorization.client,
            createdByUserId: authorization.user.id,
            metaTemplate,
            phoneNumber: selectedPhoneNumber,
            syncContext,
          }),
        );
      }

      const localTemplateSync = localTemplateSyncResults[0] ?? null;

      return NextResponse.json(
        {
          ignoredTemplateCount: 0,
          localTemplateSync,
          localTemplateSyncSummary: summarizeLocalTemplateSync(
            localTemplateSyncResults,
          ),
          ok: true,
          phoneNumberLink,
          phoneNumbers,
          selectedPhoneNumberId,
          templates,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (templateError) {
      const diagnosis = describeMetaTemplateError(templateError);

      return NextResponse.json(
        {
          error: diagnosis.message,
          errorAction: diagnosis.action,
          errorCause: diagnosis.cause,
          errorTitle: diagnosis.title,
          metaCode: diagnosis.metaCode,
          metaDetail: diagnosis.metaDetail,
          ok: false,
          phoneNumberLink,
          phoneNumbers,
          providerMessage: diagnosis.providerMessage,
          selectedPhoneNumberId,
          templates: [],
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
  } catch (error) {
    return metaTemplateErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const authorization = await authorizeIrisMetaRequest(request, [
    "admin",
    "leader",
  ]);

  if (!authorization.ok) {
    return authorization.response;
  }

  const input = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  let template: ReturnType<typeof buildTemplateRequest>;

  try {
    template = buildTemplateRequest(input);
    const phoneNumbers = await enrichMetaPhoneNumbersFromWebhookEvents(
      authorization.client,
      await listMetaWhatsAppPhoneNumbers(),
    );
    const selectedPhoneNumber = selectMetaPhoneNumber(
      phoneNumbers,
      template.phoneNumberId,
    );
    const selectedPhoneNumberId = selectedPhoneNumber?.id ?? template.phoneNumberId;
    const phoneNumberLink =
      await getSafePhoneNumberLinkStatus(selectedPhoneNumberId);
    const existing = await listMetaWhatsAppMessageTemplates({
      language: template.language,
      limit: 100,
      name: template.name,
      phoneNumberId: selectedPhoneNumberId,
    });
    const matched = existing.find(
      (item) =>
        item.name === template.name && item.language === template.language,
    );

    if (matched) {
      await upsertLocalTemplate({
        client: authorization.client,
        createdByUserId: authorization.user.id,
        metaTemplate: matched,
        phoneNumber: selectedPhoneNumber,
        template,
      });

      return NextResponse.json(
        {
          created: false,
          ok: true,
          phoneNumberLink,
          phoneNumbers,
          selectedPhoneNumberId,
          template: matched,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const created = await createMetaWhatsAppMessageTemplate({
      category: template.category,
      components: template.components,
      language: template.language,
      name: template.name,
      phoneNumberId: selectedPhoneNumberId,
    });

    await upsertLocalTemplate({
      client: authorization.client,
      createdByUserId: authorization.user.id,
      metaTemplate: created,
      phoneNumber: selectedPhoneNumber,
      template,
    });

    return NextResponse.json(
      {
        created: true,
        ok: true,
        phoneNumberLink: await getSafePhoneNumberLinkStatus(selectedPhoneNumberId),
        phoneNumbers,
        selectedPhoneNumberId,
        template: {
          category: created.category,
          id: created.id,
          language: template.language,
          name: created.name ?? template.name,
          status: created.status,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logMetaTemplateFailure(error);
    return metaTemplateErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  const authorization = await authorizeIrisMetaRequest(request, [
    "admin",
    "leader",
  ]);

  if (!authorization.ok) {
    return authorization.response;
  }

  const input = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  const action = normalizeText(input?.action)?.toLowerCase();
  const templateId = normalizeUuid(input?.templateId);
  const removeReason =
    normalizeText(input?.removeReason) ??
    "Removido da biblioteca Iris pelo operador.";

  if (action !== "archive_local") {
    return NextResponse.json(
      { error: "Acao de template nao suportada pela Iris." },
      { status: 400 },
    );
  }

  if (!templateId) {
    return NextResponse.json(
      { error: "Informe o template que sera removido da biblioteca Iris." },
      { status: 400 },
    );
  }

  const { client } = authorization;

  try {
    const { data: template, error: templateError } = await client
      .from("caredesk_templates")
      .select("id,name,slug,status,metadata")
      .eq("id", templateId)
      .eq("channel_kind", "whatsapp")
      .maybeSingle<{
        id: string;
        metadata?: unknown;
        name: string | null;
        slug: string | null;
        status: string | null;
      }>();

    if (templateError || !template) {
      return NextResponse.json(
        { error: "Template nao encontrado na biblioteca Iris." },
        { status: 404 },
      );
    }

    const currentStatus = normalizeText(template.status)?.toLowerCase();

    if (currentStatus === "archived") {
      return NextResponse.json(
        {
          alreadyArchived: true,
          ok: true,
          template: {
            id: template.id,
            name: template.name,
            slug: template.slug,
            status: template.status ?? "archived",
          },
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const linkedTicketResult = await client
      .from("caredesk_tickets")
      .select("id,protocol,status")
      .contains("metadata", { initialTemplateId: templateId })
      .in("status", ["new", "open", "waiting_customer", "waiting_operator", "pending"])
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle<{
        id: string;
        protocol: string | null;
        status: string | null;
      }>();

    if (linkedTicketResult.error) {
      throw linkedTicketResult.error;
    }

    if (linkedTicketResult.data?.id) {
      return NextResponse.json(
        {
          error:
            "Template vinculado a ticket aberto. Encerre o atendimento relacionado antes de remover da biblioteca Iris.",
          linkedTicket: {
            id: linkedTicketResult.data.id,
            protocol: linkedTicketResult.data.protocol,
            status: linkedTicketResult.data.status,
          },
        },
        { status: 409 },
      );
    }

    const nowIso = new Date().toISOString();
    const metadata = normalizeObjectRecord(template.metadata);
    const nextMetadata = {
      ...metadata,
      deletedAt: nowIso,
      deletedByUserId: authorization.user.id,
      deletedReason: removeReason,
      deletedSource: "iris_setup_library",
    };
    const { data: archived, error: archiveError } = await client
      .from("caredesk_templates")
      .update({
        metadata: nextMetadata,
        status: "archived",
      })
      .eq("id", templateId)
      .select("id,name,slug,status,metadata")
      .single<{
        id: string;
        metadata?: unknown;
        name: string | null;
        slug: string | null;
        status: string | null;
      }>();

    if (archiveError || !archived) {
      throw archiveError ?? new Error("Template nao foi removido da biblioteca Iris.");
    }

    return NextResponse.json(
      {
        alreadyArchived: false,
        ok: true,
        template: {
          id: archived.id,
          metadata: normalizeObjectRecord(archived.metadata),
          name: archived.name,
          slug: archived.slug,
          status: archived.status ?? "archived",
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const safeErrorMessage = readTemplateArchiveErrorMessage(error);

    return NextResponse.json(
      {
        error:
          safeErrorMessage ?? "Nao foi possivel remover o template da biblioteca Iris.",
      },
      { status: 500 },
    );
  }
}

function selectMetaPhoneNumber(
  phoneNumbers: MetaWhatsAppPhoneNumberSummary[],
  requestedPhoneNumberId?: string | null,
) {
  return (
    (requestedPhoneNumberId
      ? phoneNumbers.find((phoneNumber) => phoneNumber.id === requestedPhoneNumberId)
      : null) ??
    phoneNumbers.find((phoneNumber) => phoneNumber.isDefault) ??
    phoneNumbers[0] ??
    null
  );
}

async function enrichMetaPhoneNumbersFromWebhookEvents(
  client: SupabaseClient,
  phoneNumbers: MetaWhatsAppPhoneNumberSummary[],
) {
  const missingDisplayIds = phoneNumbers
    .filter((phoneNumber) => !phoneNumber.displayPhoneNumber)
    .map((phoneNumber) => phoneNumber.id);

  if (!missingDisplayIds.length) {
    return phoneNumbers;
  }

  const { data, error } = await client
    .from("caredesk_meta_webhook_events")
    .select("display_phone_number,phone_number_id,received_at")
    .in("phone_number_id", missingDisplayIds)
    .not("display_phone_number", "is", null)
    .order("received_at", { ascending: false })
    .limit(100);

  if (error || !Array.isArray(data)) {
    return phoneNumbers;
  }

  const displayByPhoneNumberId = new Map<string, string>();

  for (const row of data as Array<Record<string, unknown>>) {
    const phoneNumberId = normalizeText(row.phone_number_id);
    const displayPhoneNumber = normalizeMetaDisplayPhoneNumber(
      normalizeText(row.display_phone_number),
    );

    if (phoneNumberId && displayPhoneNumber && !displayByPhoneNumberId.has(phoneNumberId)) {
      displayByPhoneNumberId.set(phoneNumberId, displayPhoneNumber);
    }
  }

  if (!displayByPhoneNumberId.size) {
    return phoneNumbers;
  }

  return phoneNumbers.map((phoneNumber) => {
    const displayPhoneNumber = displayByPhoneNumberId.get(phoneNumber.id);

    if (!displayPhoneNumber) {
      return phoneNumber;
    }

    return {
      ...phoneNumber,
      displayPhoneNumber,
      label: buildMetaPhoneNumberDisplayLabel({
        displayPhoneNumber,
        fallbackLabel: phoneNumber.label,
        verifiedName: phoneNumber.verifiedName,
      }),
    };
  });
}

function selectLocalTemplateSyncCandidates({
  language,
  name,
  syncApprovedTemplates,
  templates,
}: {
  language?: string | null;
  name?: string | null;
  syncApprovedTemplates: boolean;
  templates: MetaWhatsAppTemplateSummary[];
}) {
  if (name && language && templates[0]) {
    return [templates[0]];
  }

  if (!syncApprovedTemplates) {
    return [];
  }

  return templates.filter((template) => {
    return (
      isMetaTemplateApprovedStatus(template.status) &&
      (!language || template.language === language)
    );
  });
}

function summarizeLocalTemplateSync(results: MetaTemplateSyncResult[]) {
  if (!results.length) {
    return null;
  }

  return {
    failed: results.filter((result) => result.ok === false).length,
    imported: results.filter((result) => result.imported).length,
    matched: results.filter((result) => result.matched).length,
    total: results.length,
    updated: results.filter(
      (result) => result.ok && result.matched && result.localStatus === "active",
    ).length,
  };
}

function readBooleanSearchParam(value: string | null) {
  const normalized = normalizeText(value)?.toLowerCase();

  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function readTemplateSyncContextFromSearchParams(
  searchParams: URLSearchParams,
): MetaTemplateSyncContext {
  const rawButtons = searchParams
    .get("buttons")
    ?.split(",")
    .map((button) => button.trim())
    .filter(Boolean);

  return {
    bodyText: normalizeTemplateBody(searchParams.get("bodyText")),
    buttons: rawButtons?.length ? normalizeButtons(rawButtons) : null,
    displayName: normalizeText(searchParams.get("displayName")),
    queueLabel: normalizeText(searchParams.get("queueLabel")),
    subjectLabel: normalizeText(searchParams.get("subjectLabel")),
  };
}

async function getSafePhoneNumberLinkStatus(phoneNumberId?: string | null) {
  try {
    const config = phoneNumberId
      ? {
          ...getMetaWhatsAppOutboundConfig(),
          phoneNumberId,
        }
      : getMetaWhatsAppOutboundConfig();
    const status = await getMetaWhatsAppPhoneNumberLinkStatus({ config });

    return {
      checkStatus: status.configured ? "checked" : "missing_config",
      linked: status.linked,
      phoneBusinessAccountDetected: status.phoneBusinessAccountDetected,
      phoneCount: status.phoneCount,
      templateBusinessAccountSource: status.templateBusinessAccountSource,
    };
  } catch {
    return {
      checkStatus: "unavailable",
      linked: null,
      phoneBusinessAccountDetected: null,
      phoneCount: null,
      templateBusinessAccountSource: "unavailable",
    };
  }
}

function buildTemplateRequest(input: Record<string, unknown> | null) {
  if (!input) {
    throw new MetaWhatsAppSendError(
      "Formulario de template incompleto.",
      400,
      {
        code: "IRIS_TEMPLATE_FORM_INVALID",
        details: {
          hint: "Revise assunto, nome Meta, categoria, idioma e mensagem.",
        },
      },
    );
  }

  const name = normalizeTemplateName(input.name);
  const language = normalizeLanguage(input.language);
  const category = normalizeCategory(input.category);
  const bodyText = normalizeTemplateBody(input.bodyText);
  const displayName = normalizeText(input.displayName);
  const phoneNumberId = normalizeText(input.phoneNumberId);

  if (!name) {
    throw new MetaWhatsAppSendError(
      "Nome Meta invalido.",
      400,
      {
        code: "IRIS_TEMPLATE_NAME_INVALID",
        details: {
          hint: "Use apenas letras minusculas, numeros e underline. Exemplo: retorno_atendimento_v1.",
        },
      },
    );
  }

  if (!language) {
    throw new MetaWhatsAppSendError(
      "Idioma do template invalido.",
      400,
      {
        code: "IRIS_TEMPLATE_LANGUAGE_INVALID",
        details: {
          hint: "Use o padrao da Meta com idioma e pais, como pt_BR.",
        },
      },
    );
  }

  if (!category) {
    throw new MetaWhatsAppSendError(
      "Categoria Meta invalida.",
      400,
      {
        code: "IRIS_TEMPLATE_CATEGORY_INVALID",
        details: {
          hint: "Escolha Marketing, Utility ou Authentication.",
        },
      },
    );
  }

  if (!bodyText) {
    throw new MetaWhatsAppSendError(
      "Mensagem do template invalida.",
      400,
      {
        code: "IRIS_TEMPLATE_BODY_INVALID",
        details: {
          hint: "A mensagem precisa ter entre 5 e 1024 caracteres.",
        },
      },
    );
  }

  if (!displayName) {
    throw new MetaWhatsAppSendError(
      "Nome interno do template invalido.",
      400,
      {
        code: "IRIS_TEMPLATE_DISPLAY_NAME_INVALID",
        details: {
          hint: "Informe um nome curto para o operador identificar o template na Iris.",
        },
      },
    );
  }

  if (!phoneNumberId) {
    throw new MetaWhatsAppSendError(
      "Telefone de envio obrigatorio.",
      400,
      {
        code: "IRIS_TEMPLATE_PHONE_MISSING",
        details: {
          hint: "Escolha o telefone de envio. A Iris criara o template na WABA vinculada a esse telefone.",
        },
      },
    );
  }

  validateBodyPlaceholders(bodyText);

  const exampleName =
    normalizeText(input?.exampleName) ?? IRIS_OPT_IN_TEMPLATE.exampleName;
  const queueLabel = normalizeText(input?.queueLabel) ?? "Atendimento";
  const subjectLabel = normalizeText(input?.subjectLabel) ?? "Opt-in ativo";
  const buttons =
    normalizeButtons(input?.buttons) ?? IRIS_OPT_IN_TEMPLATE.buttons;
  const variables = normalizeTemplateVariables(
    input?.variables,
    bodyText,
    exampleName,
  );
  const mediaHeader = normalizeTemplateMediaHeader(input);
  const bodyComponent: Record<string, unknown> = {
    text: bodyText,
    type: "BODY",
  };
  const headerComponent = mediaHeader
    ? {
        example: {
          header_handle: [mediaHeader.handle],
        },
        format: mediaHeader.format,
        type: "HEADER",
      }
    : null;

  if (variables.length) {
    bodyComponent.example = {
      body_text: [variables.map((variable) => variable.example)],
    };
  }

  return {
    bodyText,
    buttons,
    category,
    components: [
      ...(headerComponent ? [headerComponent] : []),
      bodyComponent,
      ...(buttons.length
        ? [
            {
              buttons: buttons.map((text) => ({
                text,
                type: "QUICK_REPLY",
              })),
              type: "BUTTONS",
            },
          ]
        : []),
    ],
    displayName,
    language,
    mediaHeader,
    name,
    phoneNumberId,
    queueLabel,
    slug: slugifyTemplateName(name),
    subjectLabel,
    variables,
  };
}

async function upsertLocalTemplate({
  client,
  createdByUserId,
  metaTemplate,
  phoneNumber,
  template,
}: {
  client: SupabaseClient;
  createdByUserId: string;
  metaTemplate: {
    category?: string | null;
    id?: string | null;
    name?: string | null;
    status?: string | null;
  };
  phoneNumber?: MetaWhatsAppPhoneNumberSummary | null;
  template: ReturnType<typeof buildTemplateRequest>;
}) {
  const metaStatus = metaTemplate.status ?? "PENDING";
  const status = localTemplateStatusFromMetaStatus(metaStatus);

  const result = await client.from("caredesk_templates").upsert(
    {
      body: template.bodyText,
      category: "Atendimento",
      channel_kind: "whatsapp",
      created_by_user_id: createdByUserId,
      metadata: {
        buttons: template.buttons,
        bodyExamples: template.variables.map((variable) => variable.example),
        metaCategory: metaTemplate.category ?? template.category,
        metaLanguage: template.language,
        metaPhoneDisplayNumber: phoneNumber?.displayPhoneNumber ?? null,
        metaPhoneLabel: phoneNumber?.label ?? null,
        metaPhoneNumberId: template.phoneNumberId,
        metaStatus,
        metaTemplateId: metaTemplate.id ?? null,
        metaTemplateName: metaTemplate.name ?? template.name,
        metaWhatsappBusinessAccountId:
          phoneNumber?.whatsappBusinessAccountId ?? null,
        mediaHeaderFileName: template.mediaHeader?.fileName ?? null,
        mediaHeaderFormat: template.mediaHeader?.format ?? null,
        mediaHeaderHandle: template.mediaHeader?.handle ?? null,
        mediaHeaderMediaId: template.mediaHeader?.mediaId ?? null,
        mediaHeaderMimeType: template.mediaHeader?.mimeType ?? null,
        mediaHeaderSendLink: template.mediaHeader?.sendLink ?? null,
        provider: "meta",
        queueLabel: template.queueLabel,
        source: "iris",
        subjectLabel: template.subjectLabel,
        templatePurpose: "active_contact_opt_in",
        variables: template.variables,
      },
      name: template.displayName,
      slug: template.slug,
      status,
      variables: template.variables.map((variable) => variable.key),
    },
    { onConflict: "slug" },
  );

  if (result.error) {
    throw result.error;
  }
}

async function syncLocalTemplateStatusFromMeta({
  client,
  createdByUserId,
  metaTemplate,
  phoneNumber,
  syncContext,
}: {
  client: SupabaseClient;
  createdByUserId: string;
  metaTemplate: MetaWhatsAppTemplateSummary;
  phoneNumber?: MetaWhatsAppPhoneNumberSummary | null;
  syncContext?: MetaTemplateSyncContext;
}) {
  const metaName = normalizeTemplateComparableName(metaTemplate.name);
  const language = normalizeLanguage(metaTemplate.language);

  if (!metaName || !language) {
    return {
      error: "IRIS_LOCAL_TEMPLATE_META_INVALID",
      matched: false,
      ok: false,
    };
  }

  const result = await client
    .from("caredesk_templates")
    .select("id, metadata, name, slug, status")
    .eq("channel_kind", "whatsapp")
    .limit(200);

  if (result.error) {
    return {
      error: "IRIS_LOCAL_TEMPLATE_LOOKUP_FAILED",
      matched: false,
      ok: false,
    };
  }

  const matched = (result.data ?? []).find((template) => {
    const metadata = normalizeObjectRecord(template.metadata);
    const storedName =
      normalizeTemplateComparableName(metadata.metaTemplateName) ??
      normalizeTemplateComparableName(template.slug) ??
      normalizeTemplateComparableName(template.name);
    const storedLanguage = normalizeLanguage(metadata.metaLanguage);

    return (
      storedName === metaName &&
      (!storedLanguage || storedLanguage === language)
    );
  });

  if (!matched) {
    if (!syncContext?.queueLabel || !syncContext.subjectLabel) {
      return {
        error: null,
        matched: false,
        metaStatus: metaTemplate.status ?? "PENDING",
        ok: true,
      };
    }

    return importLocalTemplateFromMeta({
      client,
      createdByUserId,
      language,
      metaName,
      metaTemplate,
      phoneNumber,
      syncContext,
    });
  }

  const currentMetadata = normalizeObjectRecord(matched.metadata);
  const metaStatus = metaTemplate.status ?? "PENDING";
  const localStatus = localTemplateStatusFromMetaStatus(metaStatus);
  const update = await client
    .from("caredesk_templates")
    .update({
      metadata: {
        ...currentMetadata,
        metaCategory: metaTemplate.category ?? currentMetadata.metaCategory ?? null,
        metaLanguage: language,
        metaPhoneDisplayNumber:
          phoneNumber?.displayPhoneNumber ??
          currentMetadata.metaPhoneDisplayNumber ??
          null,
        metaPhoneLabel: phoneNumber?.label ?? currentMetadata.metaPhoneLabel ?? null,
        metaPhoneNumberId:
          phoneNumber?.id ?? currentMetadata.metaPhoneNumberId ?? null,
        metaStatus,
        metaTemplateId: metaTemplate.id ?? currentMetadata.metaTemplateId ?? null,
        metaTemplateName: metaTemplate.name ?? metaName,
        metaWhatsappBusinessAccountId:
          phoneNumber?.whatsappBusinessAccountId ??
          currentMetadata.metaWhatsappBusinessAccountId ??
          null,
        provider: "meta",
        source: "iris",
      },
      status: localStatus,
    })
    .eq("id", matched.id);

  if (update.error) {
    return {
      error: "IRIS_LOCAL_TEMPLATE_UPDATE_FAILED",
      id: matched.id,
      matched: true,
      metaStatus,
      ok: false,
    };
  }

  return {
    error: null,
    id: matched.id,
    localStatus,
    matched: true,
    metaStatus,
    ok: true,
  };
}

async function importLocalTemplateFromMeta({
  client,
  createdByUserId,
  language,
  metaName,
  metaTemplate,
  phoneNumber,
  syncContext,
}: {
  client: SupabaseClient;
  createdByUserId: string;
  language: string;
  metaName: string;
  metaTemplate: MetaWhatsAppTemplateSummary;
  phoneNumber?: MetaWhatsAppPhoneNumberSummary | null;
  syncContext?: MetaTemplateSyncContext;
}) {
  const metaStatus = metaTemplate.status ?? "PENDING";
  const localStatus = localTemplateStatusFromMetaStatus(metaStatus);
  const bodyText =
    readMetaTemplateBodyText(metaTemplate.components) ??
    syncContext?.bodyText ??
    IRIS_OPT_IN_TEMPLATE.bodyText;
  const buttons =
    readMetaTemplateButtons(metaTemplate.components) ??
    syncContext?.buttons ??
    [];
  const variables = normalizeTemplateVariables(null, bodyText, "cliente");
  const displayName =
    syncContext?.displayName ??
    normalizeTemplateDisplayName(metaTemplate.name) ??
    metaName;
  const queueLabel = syncContext?.queueLabel ?? "Atendimento";
  const subjectLabel = syncContext?.subjectLabel ?? "Opt-in ativo";
  const slug = slugifyTemplateName(metaName);
  const { data, error } = await client
    .from("caredesk_templates")
    .upsert(
      {
        body: bodyText,
        category: "Atendimento",
        channel_kind: "whatsapp",
        created_by_user_id: createdByUserId,
        metadata: {
          buttons,
          bodyExamples: variables.map((variable) => variable.example),
          importedAt: new Date().toISOString(),
          importedReason: "meta_template_lookup",
          metaCategory: metaTemplate.category ?? null,
          metaLanguage: language,
          metaPhoneDisplayNumber: phoneNumber?.displayPhoneNumber ?? null,
          metaPhoneLabel: phoneNumber?.label ?? null,
          metaPhoneNumberId: phoneNumber?.id ?? null,
          metaStatus,
          metaTemplateId: metaTemplate.id ?? null,
          metaTemplateName: metaTemplate.name ?? metaName,
          metaWhatsappBusinessAccountId:
            phoneNumber?.whatsappBusinessAccountId ?? null,
          provider: "meta",
          queueLabel,
          source: "iris",
          subjectLabel,
          templatePurpose: "active_contact_opt_in",
          variables,
        },
        name: displayName,
        slug,
        status: localStatus,
        variables: variables.map((variable) => variable.key),
      },
      { onConflict: "slug" },
    )
    .select("id,status")
    .single<{ id: string; status: string | null }>();

  if (error || !data) {
    return {
      error: "IRIS_LOCAL_TEMPLATE_IMPORT_FAILED",
      matched: false,
      metaStatus,
      ok: false,
    };
  }

  return {
    error: null,
    id: data.id,
    imported: true,
    localStatus: data.status ?? localStatus,
    matched: false,
    metaStatus,
    ok: true,
  };
}

function readMetaTemplateBodyText(components: unknown) {
  const bodyComponent = readMetaTemplateComponents(components).find(
    (component) => normalizeText(component.type)?.toUpperCase() === "BODY",
  );

  return normalizeTemplateBody(bodyComponent?.text);
}

function readMetaTemplateButtons(components: unknown) {
  const buttonsComponent = readMetaTemplateComponents(components).find(
    (component) => normalizeText(component.type)?.toUpperCase() === "BUTTONS",
  );
  const rawButtons = Array.isArray(buttonsComponent?.buttons)
    ? buttonsComponent.buttons
    : null;

  if (!rawButtons) {
    return null;
  }

  return normalizeButtons(
    rawButtons
      .map((button) =>
        button && typeof button === "object" && !Array.isArray(button)
          ? normalizeText((button as Record<string, unknown>).text)
          : null,
      )
      .filter((button): button is string => Boolean(button)),
  );
}

function readMetaTemplateComponents(components: unknown) {
  if (!Array.isArray(components)) {
    return [];
  }

  return components.filter(
    (component): component is Record<string, unknown> =>
      Boolean(component && typeof component === "object" && !Array.isArray(component)),
  );
}

function normalizeTemplateDisplayName(value: unknown) {
  const text = normalizeText(value);

  if (!text) {
    return null;
  }

  return text
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

function localTemplateStatusFromMetaStatus(metaStatus: string | null) {
  const normalized = normalizeMetaTemplateStatusKey(metaStatus);

  if (isMetaTemplateApprovedStatus(metaStatus)) {
    return "active";
  }

  if (
    normalized === "DISABLED" ||
    normalized === "INACTIVE" ||
    normalized === "PAUSED" ||
    normalized === "REJECTED"
  ) {
    return "paused";
  }

  return "planned";
}

function isMetaTemplateApprovedStatus(metaStatus: string | null) {
  const normalized = normalizeMetaTemplateStatusKey(metaStatus);

  return (
    normalized === "APPROVED" ||
    normalized === "ACTIVE" ||
    Boolean(normalized?.startsWith("APPROVED_")) ||
    Boolean(normalized?.startsWith("ACTIVE_"))
  );
}

function normalizeMetaTemplateStatusKey(metaStatus: string | null) {
  return metaStatus?.trim().toUpperCase().replace(/[\s-]+/g, "_") ?? null;
}

function metaTemplateErrorResponse(error: unknown) {
  const status = error instanceof MetaWhatsAppSendError ? error.status : 502;
  const diagnosis = describeMetaTemplateError(error);

  return NextResponse.json(
    {
      error: diagnosis.message,
      errorAction: diagnosis.action,
      errorCause: diagnosis.cause,
      errorTitle: diagnosis.title,
      metaCode: diagnosis.metaCode,
      metaDetail: diagnosis.metaDetail,
      providerMessage: diagnosis.providerMessage,
    },
    { status },
  );
}

function logMetaTemplateFailure(error: unknown) {
  const diagnosis = describeMetaTemplateError(error);

  console.warn("[iris/meta/templates] operation failed", {
    metaCode: diagnosis.metaCode,
    status: error instanceof MetaWhatsAppSendError ? error.status : 502,
    title: diagnosis.title,
  });
}

function describeMetaTemplateError(error: unknown) {
  const fallbackMessage =
    error instanceof Error
      ? error.message
      : "Nao foi possivel operar o template Meta.";
  const metaCode =
    error instanceof MetaWhatsAppSendError
      ? normalizeErrorDisplayCode(error.code)
      : null;
  const providerMessage = sanitizeMetaProviderMessage(fallbackMessage);
  const metaDetail = readMetaErrorDetail(error);
  const searchable = [
    fallbackMessage,
    metaDetail,
    error instanceof MetaWhatsAppSendError ? readMetaErrorType(error) : null,
    metaCode,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (metaCode?.startsWith("IRIS_TEMPLATE_")) {
    return {
      action: readLocalTemplateHint(error) ?? "Revise os campos marcados e tente enviar novamente.",
      cause: "A Iris bloqueou o envio antes da Meta porque faltou uma informacao obrigatoria ou algum campo esta fora do formato aceito.",
      message: fallbackMessage,
      metaCode,
      metaDetail,
      providerMessage: null,
      title: "Template incompleto",
    };
  }

  if (
    searchable.includes("unsupported post request") ||
    searchable.includes("unsupported get request") ||
    searchable.includes("object with id") ||
    searchable.includes("missing permissions")
  ) {
    return {
      action:
        "Confirme no Meta Manager se o telefone de envio pertence a WABA usada pela Iris e se o app/token tem acesso a esse ativo.",
      cause:
        "O telefone selecionado para templates nao esta acessivel pelo app/token atual ou nao pertence a WABA do telefone de envio.",
      message:
        "A Meta recusou a operacao no telefone selecionado para templates.",
      metaCode,
      metaDetail,
      providerMessage,
      title: "WABA ou telefone nao acessivel",
    };
  }

  if (
    searchable.includes("invalid parameter") ||
    searchable.includes("parameter") ||
    searchable.includes("components") ||
    searchable.includes("header") ||
    searchable.includes("body") ||
    searchable.includes("buttons")
  ) {
    return {
      action:
        "Revise nome Meta, idioma, categoria, mensagem, variaveis, botoes e midia do header. Para midia, envie a amostra e use URL publica HTTPS no envio ativo.",
      cause:
        "A Meta nao aceitou algum parametro do template. Normalmente isso acontece por formato de campo, variavel sem exemplo, categoria inadequada, botao invalido ou midia/header incompleto.",
      message:
        "A Meta recusou o template por parametro invalido.",
      metaCode,
      metaDetail,
      providerMessage,
      title: "Parametro rejeitado pela Meta",
    };
  }

  if (
    metaCode === "190" ||
    searchable.includes("access token") ||
    searchable.includes("oauth")
  ) {
    return {
      action:
        "Valide a configuracao Meta da Iris com Lucas/Zeus sem expor o token. Pode exigir token novo, permissao do app ou ativo correto.",
      cause:
        "A Meta indicou problema de autenticacao do app/token usado pela Iris.",
      message:
        "A Meta nao autorizou a operacao com a credencial atual.",
      metaCode,
      metaDetail,
      providerMessage,
      title: "Credencial Meta recusada",
    };
  }

  if (
    metaCode === "10" ||
    metaCode === "200" ||
    searchable.includes("permission")
  ) {
    return {
      action:
        "Confirme se o app tem permissoes de WhatsApp Business Management e acesso ao telefone/WABA no Business Manager.",
      cause:
        "A Meta aceitou a chamada, mas negou permissao para gerenciar templates nesse ativo.",
      message:
        "A Meta negou permissao para operar templates.",
      metaCode,
      metaDetail,
      providerMessage,
      title: "Permissao Meta insuficiente",
    };
  }

  return {
    action:
      "Tente consultar novamente. Se repetir, valide no Meta Manager se o template existe no idioma pt_BR e na WABA do telefone de envio.",
    cause:
      "A Meta retornou uma falha nao classificada pela Iris para o fluxo de templates.",
    message: providerMessage ?? fallbackMessage,
    metaCode,
    metaDetail,
    providerMessage,
    title: "Falha na operacao Meta",
  };
}

function readLocalTemplateHint(error: unknown) {
  if (!(error instanceof MetaWhatsAppSendError)) {
    return null;
  }

  const details = error.details;

  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return null;
  }

  return normalizeText((details as Record<string, unknown>).hint);
}

function readMetaErrorType(error: MetaWhatsAppSendError) {
  const details = error.details;

  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return null;
  }

  return normalizeText((details as Record<string, unknown>).type);
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

function normalizeErrorDisplayCode(value: number | string | null) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();

  return normalized || null;
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

function readTemplateArchiveErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return sanitizeMetaProviderMessage(error.message) ?? null;
  }

  if (!error || typeof error !== "object" || Array.isArray(error)) {
    return null;
  }

  const record = error as Record<string, unknown>;
  const message =
    normalizeText(record.message) ??
    normalizeText(record.error) ??
    normalizeText(record.details) ??
    null;

  return sanitizeMetaProviderMessage(message);
}

function normalizeTemplateName(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  return /^[a-z0-9_]{3,512}$/.test(normalized) ? normalized : null;
}

function normalizeTemplateComparableName(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/-/g, "_");

  return /^[a-z0-9_]{3,512}$/.test(normalized) ? normalized : null;
}

function normalizeLanguage(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  return /^[a-z]{2}_[A-Z]{2}$/.test(normalized) ? normalized : null;
}

function normalizeCategory(value: unknown): MetaTemplateCategory | null {
  return value === "AUTHENTICATION" ||
    value === "MARKETING" ||
    value === "UTILITY"
    ? value
    : null;
}

function normalizeTemplateBody(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();

  return normalized.length >= 5 && normalized.length <= 1024
    ? normalized
    : null;
}

function normalizeButtons(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }

  const buttons = value
    .map(normalizeText)
    .filter((item): item is string => Boolean(item))
    .slice(0, 10);

  return buttons.length ? buttons : null;
}

function normalizeTemplateMediaHeader(input: Record<string, unknown> | null) {
  const format = normalizeHeaderFormat(input?.headerFormat);

  if (!format) {
    return null;
  }

  const handle = normalizeText(input?.headerHandle);

  if (!handle) {
    throw new MetaWhatsAppSendError(
      "Envie a midia de exemplo para a Meta antes de criar o template.",
      400,
      {
        code: "IRIS_TEMPLATE_MEDIA_MISSING",
        details: {
          hint: "Clique em Enviar exemplo na midia do header e aguarde a Iris receber o identificador da Meta.",
        },
      },
    );
  }

  const rawSendLink = normalizeText(input?.headerSendLink);
  const sendLink = normalizePublicMediaLink(rawSendLink);

  if (rawSendLink && !sendLink) {
    throw new MetaWhatsAppSendError(
      "Use uma URL publica HTTPS para a midia enviada no atendimento ativo.",
      400,
      {
        code: "IRIS_TEMPLATE_MEDIA_LINK_INVALID",
        details: {
          hint: "Informe uma URL publica iniciada por https:// para a Iris enviar a midia quando o atendimento ativo for iniciado.",
        },
      },
    );
  }

  return {
    fileName: normalizeText(input?.headerFileName),
    format,
    handle,
    mediaId: normalizeText(input?.headerMediaId),
    mimeType: normalizeText(input?.headerMimeType),
    sendLink,
  };
}

function normalizeHeaderFormat(value: unknown): MetaTemplateHeaderFormat | null {
  return value === "DOCUMENT" || value === "IMAGE" || value === "VIDEO"
    ? value
    : null;
}

function normalizePublicMediaLink(value: unknown) {
  const text = normalizeText(value);

  if (!text) {
    return null;
  }

  try {
    const url = new URL(text);

    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeMetaDisplayPhoneNumber(value?: string | null) {
  const normalized = normalizeText(value);

  if (!normalized) {
    return null;
  }

  const digits = normalized.replace(/\D/g, "");

  if (!digits) {
    return null;
  }

  if (normalized.startsWith("+")) {
    return normalized;
  }

  if (digits.length === 12 && digits.startsWith("55")) {
    return `+${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }

  if (digits.length === 13 && digits.startsWith("55")) {
    return `+${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }

  return `+${digits}`;
}

function buildMetaPhoneNumberDisplayLabel({
  displayPhoneNumber,
  fallbackLabel,
  verifiedName,
}: {
  displayPhoneNumber: string;
  fallbackLabel: string;
  verifiedName?: string | null;
}) {
  return (
    [displayPhoneNumber, normalizeText(verifiedName)].filter(Boolean).join(" - ") ||
    fallbackLabel
  );
}

function normalizeUuid(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    normalized,
  )
    ? normalized
    : null;
}

function normalizeObjectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeTemplateVariables(
  value: unknown,
  bodyText: string,
  fallbackExample: string,
) {
  const count = countBodyPlaceholders(bodyText);
  const rawVariables = Array.isArray(value)
    ? value
    : IRIS_OPT_IN_TEMPLATE.variables;

  return Array.from({ length: count }).map((_, index) => {
    const raw = rawVariables[index];
    const variable =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
    const placeholder = `{{${index + 1}}}`;
    const key = normalizeVariableKey(variable.key) ?? `variavel_${index + 1}`;
    const label = normalizeText(variable.label) ?? `Variavel ${index + 1}`;
    const example =
      normalizeText(variable.example) ??
      (index === 0 ? fallbackExample : label);

    return {
      example,
      key,
      label,
      placeholder,
    };
  });
}

function validateBodyPlaceholders(bodyText: string) {
  const indexes = Array.from(bodyText.matchAll(/{{\s*(\d+)\s*}}/g))
    .map((match) => Number(match[1]))
    .filter((index) => Number.isInteger(index) && index > 0);

  if (!indexes.length) {
    return;
  }

  const maxIndex = Math.max(...indexes);
  const uniqueIndexes = new Set(indexes);

  for (let index = 1; index <= maxIndex; index += 1) {
    if (!uniqueIndexes.has(index)) {
      throw new MetaWhatsAppSendError(
        "Variaveis do template fora de ordem.",
        400,
        {
          code: "IRIS_TEMPLATE_VARIABLES_INVALID",
          details: {
            hint: "Use variaveis sequenciais no texto, como {{1}}, {{2}}, {{3}}.",
          },
        },
      );
    }
  }
}

function countBodyPlaceholders(bodyText: string) {
  const indexes = Array.from(bodyText.matchAll(/{{\s*(\d+)\s*}}/g))
    .map((match) => Number(match[1]))
    .filter((index) => Number.isInteger(index) && index > 0);

  return indexes.length ? Math.max(...indexes) : 0;
}

function normalizeVariableKey(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || null;
}

function slugifyTemplateName(value: string) {
  return value.replace(/_/g, "-");
}
