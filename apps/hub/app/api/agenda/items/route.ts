import { NextResponse, type NextRequest } from "next/server";

import {
  createAgendaItem,
  deleteAgendaItem,
  listAgendaItemsByProtocol,
  listAgendaItemsForUser,
  updateAgendaItem,
  type AgendaItemChannel,
  type AgendaItemKind,
  type AgendaItemPriority,
  type AgendaItemStatus,
  type AgendaModule,
} from "@/lib/agenda/agenda";
import { authorizeAgendaRequest } from "@/lib/agenda/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const KINDS = new Set<AgendaItemKind>(["tarefa", "retorno"]);
const STATUSES = new Set<AgendaItemStatus>([
  "aberto",
  "em_andamento",
  "concluido",
  "cancelado",
]);
const PRIORITIES = new Set<AgendaItemPriority>([
  "baixa",
  "media",
  "alta",
  "urgente",
]);
const CHANNELS = new Set<AgendaItemChannel>([
  "whatsapp",
  "ligacao",
  "email",
  "presencial",
  "outro",
]);
const MODULES = new Set<AgendaModule>(["hades", "iris", "hub"]);

export async function GET(request: NextRequest) {
  const auth = await authorizeAgendaRequest(request);

  if (!auth.ok) {
    return auth.response;
  }

  const protocol = request.nextUrl.searchParams.get("protocol")?.trim();

  // Link de entrada: itens de um atendimento especifico (board/atendimento).
  if (protocol) {
    const items = await listAgendaItemsByProtocol(auth.client, protocol);
    return NextResponse.json({ items });
  }

  const includeDone =
    request.nextUrl.searchParams.get("includeDone") === "1";
  const items = await listAgendaItemsForUser(auth.client, auth.user.id, {
    includeDone,
  });

  return NextResponse.json({ items });
}

export async function POST(request: NextRequest) {
  const auth = await authorizeAgendaRequest(request);

  if (!auth.ok) {
    return auth.response;
  }

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;

  if (!body) {
    return NextResponse.json({ error: "Payload ausente." }, { status: 400 });
  }

  const kind = readString(body.kind);
  const title = readString(body.title);

  if (!kind || !KINDS.has(kind as AgendaItemKind)) {
    return NextResponse.json(
      { error: "Tipo invalido (tarefa ou retorno)." },
      { status: 400 },
    );
  }

  if (!title) {
    return NextResponse.json(
      { error: "Informe um titulo." },
      { status: 400 },
    );
  }

  const priority = readString(body.priority);
  const channel = readString(body.channel);
  const moduleValue = readString(body.module);

  const item = await createAgendaItem(
    auth.client,
    {
      attendanceProtocol: readString(body.attendanceProtocol) ?? null,
      channel:
        channel && CHANNELS.has(channel as AgendaItemChannel)
          ? (channel as AgendaItemChannel)
          : null,
      clientC2xId: readPositiveInt(body.clientC2xId),
      clientName: readString(body.clientName) ?? null,
      description: readString(body.description) ?? null,
      dueAt: readIsoDate(body.dueAt),
      kind: kind as AgendaItemKind,
      module:
        moduleValue && MODULES.has(moduleValue as AgendaModule)
          ? (moduleValue as AgendaModule)
          : "hub",
      priority:
        priority && PRIORITIES.has(priority as AgendaItemPriority)
          ? (priority as AgendaItemPriority)
          : null,
      remindAt: readIsoDate(body.remindAt),
      title,
    },
    auth.user.id,
  );

  if (!item) {
    return NextResponse.json(
      { error: "Nao foi possivel criar o item." },
      { status: 500 },
    );
  }

  return NextResponse.json({ item }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const auth = await authorizeAgendaRequest(request);

  if (!auth.ok) {
    return auth.response;
  }

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const id = readString(body?.id);

  if (!id) {
    return NextResponse.json({ error: "Item nao informado." }, { status: 400 });
  }

  const patch: Parameters<typeof updateAgendaItem>[2] = {};
  const status = readString(body?.status);
  const priority = readString(body?.priority);
  const channel = readString(body?.channel);

  if (status) {
    if (!STATUSES.has(status as AgendaItemStatus)) {
      return NextResponse.json({ error: "Status invalido." }, { status: 400 });
    }
    patch.status = status as AgendaItemStatus;
  }
  if (body && "title" in body) {
    patch.title = readString(body.title) ?? "";
  }
  if (body && "description" in body) {
    patch.description = readString(body.description) ?? null;
  }
  if (body && "priority" in body) {
    patch.priority =
      priority && PRIORITIES.has(priority as AgendaItemPriority)
        ? (priority as AgendaItemPriority)
        : null;
  }
  if (body && "channel" in body) {
    patch.channel =
      channel && CHANNELS.has(channel as AgendaItemChannel)
        ? (channel as AgendaItemChannel)
        : null;
  }
  if (body && "dueAt" in body) {
    patch.dueAt = readIsoDate(body.dueAt);
  }
  if (body && "remindAt" in body) {
    patch.remindAt = readIsoDate(body.remindAt);
  }

  const item = await updateAgendaItem(auth.client, id, patch, auth.user.id);

  if (!item) {
    return NextResponse.json(
      { error: "Nao foi possivel atualizar o item." },
      { status: 500 },
    );
  }

  return NextResponse.json({ item });
}

export async function DELETE(request: NextRequest) {
  const auth = await authorizeAgendaRequest(request);

  if (!auth.ok) {
    return auth.response;
  }

  const id = request.nextUrl.searchParams.get("id")?.trim();

  if (!id) {
    return NextResponse.json({ error: "Item nao informado." }, { status: 400 });
  }

  const ok = await deleteAgendaItem(auth.client, id);

  if (!ok) {
    return NextResponse.json(
      { error: "Nao foi possivel remover o item." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readPositiveInt(value: unknown): number | null {
  const parsed =
    typeof value === "number" ? value : Number(readString(value) ?? "");
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function readIsoDate(value: unknown): string | null {
  const text = readString(value);
  if (!text) {
    return null;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
