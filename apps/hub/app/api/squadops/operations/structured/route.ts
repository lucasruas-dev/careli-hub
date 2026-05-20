import { type NextRequest } from "next/server";

import { authorizeZeusAdminRequest } from "@/lib/squadops/admin-access";
import { loadEngineeringOperationsFromFile } from "@/lib/squadops/engineering-operations-source";
import { parseEngineeringOperationsMarkdown } from "@/lib/squadops/engineering-operations-parser";
import {
  createStructuredEngineeringOperation,
  loadStructuredEngineeringOperations,
  type CreateStructuredEngineeringOperationInput,
  syncEngineeringOperationsToStore,
} from "@/lib/squadops/engineering-operations-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const defaultOperationsSourcePath = "docs/operations/engineering-operations.md";
const maxMarkdownContentLength = 2_500_000;

export async function GET(request: NextRequest) {
  const authorization = await authorizeZeusAdminRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const limitParam = new URL(request.url).searchParams.get("limit");
  const limit = Math.min(
    Math.max(Number.parseInt(limitParam ?? "120", 10) || 120, 1),
    500,
  );
  const result = await loadStructuredEngineeringOperations(limit);

  if (!result.ok) {
    return Response.json(
      {
        error: result.error,
        storage: {
          records: [],
          status: result.status,
          syncRuns: [],
        },
      },
      { status: 503 },
    );
  }

  return Response.json(
    {
      storage: {
        records: result.records,
        status: result.status,
        syncRuns: result.syncRuns,
      },
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

export async function POST(request: NextRequest) {
  const authorization = await authorizeZeusAdminRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const body = await readJsonBody(request);

  if (body?.action === "create-record") {
    const recordInput = normalizeCreateRecordInput(body.record);

    if (!recordInput.ok) {
      return Response.json({ error: recordInput.error }, { status: 400 });
    }

    const result = await createStructuredEngineeringOperation({
      input: recordInput.input,
      userId: authorization.userId,
    });

    if (!result.ok) {
      return Response.json(
        {
          error: result.error,
          storage: result,
        },
        { status: 503 },
      );
    }

    return Response.json(
      {
        storage: {
          record: result.record,
          status: result.status,
        },
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  if (body?.action === "sync-markdown-content") {
    const content = typeof body.content === "string" ? body.content : "";

    if (!content.trim()) {
      return Response.json(
        { error: "Informe o conteudo do Engineering Operations." },
        { status: 400 },
      );
    }

    if (content.length > maxMarkdownContentLength) {
      return Response.json(
        { error: "Arquivo do Engineering Operations excede o limite seguro." },
        { status: 413 },
      );
    }

    if (!content.includes("Registro de diario:")) {
      return Response.json(
        { error: "Arquivo informado nao contem registros de diario." },
        { status: 400 },
      );
    }

    const operations = parseEngineeringOperationsMarkdown(content, {
      sourcePath: normalizeMarkdownSourcePath(body.sourcePath),
    });
    const result = await syncEngineeringOperationsToStore({
      operations,
      userId: authorization.userId,
    });

    if (!result.ok) {
      return Response.json(
        {
          error: result.error,
          storage: result,
        },
        { status: 503 },
      );
    }

    return Response.json(
      {
        storage: result,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  const operations = await loadEngineeringOperationsFromFile();

  if (!operations.data) {
    return Response.json(
      {
        error:
          operations.error ?? "Nao foi possivel ler o Engineering Operations.",
      },
      { status: operations.error?.includes("nao encontrado") ? 404 : 500 },
    );
  }

  const result = await syncEngineeringOperationsToStore({
    operations: operations.data,
    userId: authorization.userId,
  });

  if (!result.ok) {
    return Response.json(
      {
        error: result.error,
        storage: result,
      },
      { status: 503 },
    );
  }

  return Response.json(
    {
      storage: result,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

type StructuredOperationsPostBody = {
  action?: "create-record" | "sync-markdown" | "sync-markdown-content";
  content?: unknown;
  record?: Record<string, unknown>;
  sourcePath?: unknown;
};

async function readJsonBody(request: NextRequest) {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return null;
  }

  return (await request.json().catch(() => null)) as
    | StructuredOperationsPostBody
    | null;
}

function normalizeCreateRecordInput(record: unknown):
  | {
      input: CreateStructuredEngineeringOperationInput;
      ok: true;
    }
  | {
      error: string;
      ok: false;
    } {
  if (!record || typeof record !== "object") {
    return {
      error: "Informe os dados do registro operacional.",
      ok: false,
    };
  }

  const rawRecord = record as Record<string, unknown>;
  const subject = getRequiredText(rawRecord.subject);

  if (!subject) {
    return {
      error: "Informe o titulo do registro operacional.",
      ok: false,
    };
  }

  return {
    input: {
      affectedFiles: getOptionalText(rawRecord.affectedFiles),
      changeCategory: getOptionalText(rawRecord.changeCategory),
      commit: getOptionalText(rawRecord.commit),
      deploy: getOptionalText(rawRecord.deploy),
      healthchecks: getOptionalText(rawRecord.healthchecks),
      how: getOptionalText(rawRecord.how),
      logic: getOptionalText(rawRecord.logic),
      macroSummary: getOptionalText(rawRecord.macroSummary),
      module: getOptionalText(rawRecord.module),
      needsDeploy: rawRecord.needsDeploy === true,
      nextSquad: getOptionalText(rawRecord.nextSquad),
      reason: getOptionalText(rawRecord.reason),
      risks: getOptionalText(rawRecord.risks),
      screen: getOptionalText(rawRecord.screen),
      squad: getOptionalText(rawRecord.squad),
      status: getOptionalText(rawRecord.status),
      subject,
      type: getOptionalText(rawRecord.type),
      validation: getOptionalText(rawRecord.validation),
    },
    ok: true,
  };
}

function getRequiredText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getOptionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeMarkdownSourcePath(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return defaultOperationsSourcePath;
  }

  return value.trim().replace(/\\/g, "/").slice(0, 180);
}
