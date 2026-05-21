import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  MetaWhatsAppSendError,
  createMetaWhatsAppMessageTemplate,
  listMetaWhatsAppMessageTemplates,
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

  try {
    const templates = await listMetaWhatsAppMessageTemplates({
      limit: 50,
      name,
    });

    return NextResponse.json(
      {
        ok: true,
        templates,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
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
  const template = buildTemplateRequest(input);

  try {
    const existing = await listMetaWhatsAppMessageTemplates({
      limit: 10,
      name: template.name,
    });
    const matched = existing.find((item) => item.name === template.name);

    if (matched) {
      await upsertLocalTemplate({
        client: authorization.client,
        createdByUserId: authorization.user.id,
        metaTemplate: matched,
        template,
      });

      return NextResponse.json(
        {
          created: false,
          ok: true,
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
    });

    await upsertLocalTemplate({
      client: authorization.client,
      createdByUserId: authorization.user.id,
      metaTemplate: created,
      template,
    });

    return NextResponse.json(
      {
        created: true,
        ok: true,
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
    return metaTemplateErrorResponse(error);
  }
}

function buildTemplateRequest(input: Record<string, unknown> | null) {
  const name =
    normalizeTemplateName(input?.name) ?? IRIS_OPT_IN_TEMPLATE.name;
  const language =
    normalizeLanguage(input?.language) ?? IRIS_OPT_IN_TEMPLATE.language;
  const category =
    normalizeCategory(input?.category) ?? IRIS_OPT_IN_TEMPLATE.category;
  const bodyText =
    normalizeTemplateBody(input?.bodyText) ?? IRIS_OPT_IN_TEMPLATE.bodyText;
  const displayName =
    normalizeText(input?.displayName) ?? IRIS_OPT_IN_TEMPLATE.displayName;
  const exampleName =
    normalizeText(input?.exampleName) ?? IRIS_OPT_IN_TEMPLATE.exampleName;
  const buttons =
    normalizeButtons(input?.buttons) ?? IRIS_OPT_IN_TEMPLATE.buttons;
  const variables = normalizeTemplateVariables(
    input?.variables,
    bodyText,
    exampleName,
  );
  const bodyComponent: Record<string, unknown> = {
    text: bodyText,
    type: "BODY",
  };

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
    name,
    slug: slugifyTemplateName(name),
    variables,
  };
}

async function upsertLocalTemplate({
  client,
  createdByUserId,
  metaTemplate,
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
  template: ReturnType<typeof buildTemplateRequest>;
}) {
  const metaStatus = metaTemplate.status ?? "PENDING";
  const status =
    metaStatus === "APPROVED"
      ? "active"
      : metaStatus === "REJECTED"
        ? "paused"
        : "planned";

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
        metaStatus,
        metaTemplateId: metaTemplate.id ?? null,
        metaTemplateName: metaTemplate.name ?? template.name,
        provider: "meta",
        source: "iris",
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

function metaTemplateErrorResponse(error: unknown) {
  const status = error instanceof MetaWhatsAppSendError ? error.status : 502;

  return NextResponse.json(
    {
      error:
        error instanceof Error
          ? error.message
          : "Nao foi possivel operar o template Meta.",
    },
    { status },
  );
}

function normalizeTemplateName(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();

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

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
