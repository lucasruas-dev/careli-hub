import { NextResponse } from "next/server";

import {
  createApoloAdminClient,
  createApoloUserClient,
} from "@/lib/apolo/server";

type HubUserRole = "admin" | "leader" | "operator" | "viewer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Criação de relacionamento no Apolo (escrita própria — não vem do C2X).
// Trabalho = edge pra outra entidade Apolo (related_entity_id). Contato = pessoa leve
// (nome/telefone/email/cpf) que fica SÓ no Apolo. Tudo marcado com source=apolo, que é a
// "fila implícita" de backfill pro C2X quando a integração ficar pronta.
type CreateRelationshipPayload = {
  entityId?: unknown;
  kind?: unknown;
  relationshipType?: unknown;
  label?: unknown;
  cargo?: unknown;
  relatedEntityId?: unknown;
  email?: unknown;
  phone?: unknown;
  cpf?: unknown;
};

export async function POST(request: Request) {
  const accessToken = getBearerToken(request);

  if (!accessToken) {
    return NextResponse.json({ error: "Sessao do Apolo ausente." }, { status: 401 });
  }

  const adminClient = createApoloAdminClient();
  const userClient = createApoloUserClient(accessToken);
  const authClient = adminClient ?? userClient;

  if (!authClient) {
    return NextResponse.json(
      { error: "Configure o Supabase server-side para o Apolo." },
      { status: 503 },
    );
  }

  const authorization = await authorizeApoloWriteRequest(accessToken, authClient);

  if (!authorization.ok) {
    return authorization.response;
  }

  // Escrita precisa do service role (RLS só libera SELECT pro usuario).
  if (!adminClient) {
    return NextResponse.json(
      { error: "Escrita no Apolo indisponivel (service role ausente)." },
      { status: 503 },
    );
  }

  let payload: CreateRelationshipPayload;
  try {
    payload = (await request.json()) as CreateRelationshipPayload;
  } catch {
    return NextResponse.json({ error: "Corpo invalido." }, { status: 400 });
  }

  const entityId = asText(payload.entityId);
  const kind = payload.kind === "trabalho" || payload.kind === "contato" ? payload.kind : null;
  const relationshipType = asText(payload.relationshipType);
  const label = asText(payload.label);
  const cargo = asText(payload.cargo);

  if (!entityId || !kind || !relationshipType || !label) {
    return NextResponse.json(
      { error: "Informe entidade, tipo (trabalho/contato), nivel e nome." },
      { status: 400 },
    );
  }

  if (kind === "trabalho") {
    const relatedEntityId = asText(payload.relatedEntityId);
    if (!relatedEntityId) {
      return NextResponse.json(
        { error: "Selecione a entidade do relacionamento de trabalho." },
        { status: 400 },
      );
    }

    const inserted = await insertRelationship(adminClient, {
      entityId,
      relatedEntityId,
      relationshipType,
      label,
      status: "verified",
      metadata: { ...baseMetadata(kind, authorization.userId), ...(cargo ? { cargo } : {}) },
    });

    return inserted;
  }

  // contato: nome/telefone/email obrigatorios; cpf opcional.
  const email = asText(payload.email);
  const phone = asText(payload.phone);
  const cpf = asText(payload.cpf);

  if (!email || !phone) {
    return NextResponse.json(
      { error: "Contato precisa de nome, telefone e e-mail (CPF e opcional)." },
      { status: 400 },
    );
  }

  const inserted = await insertRelationship(adminClient, {
    entityId,
    relatedEntityId: null,
    relationshipType,
    label,
    status: "verified",
    metadata: {
      ...baseMetadata(kind, authorization.userId),
      email,
      phone,
      cpf,
      ...(cargo ? { cargo } : {}),
    },
  });

  return inserted;
}

async function insertRelationship(
  adminClient: NonNullable<ReturnType<typeof createApoloAdminClient>>,
  row: {
    entityId: string;
    relatedEntityId: string | null;
    relationshipType: string;
    label: string;
    status: string;
    metadata: Record<string, unknown>;
  },
) {
  const { data, error } = await adminClient
    .from("apolo_relationships")
    .insert({
      entity_id: row.entityId,
      related_entity_id: row.relatedEntityId,
      relationship_type: row.relationshipType,
      label: row.label,
      status: row.status,
      metadata: row.metadata,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    return NextResponse.json(
      { error: "Nao foi possivel salvar o relacionamento." },
      { status: 500 },
    );
  }

  return NextResponse.json({ id: data.id, ok: true });
}

function baseMetadata(kind: "trabalho" | "contato", userId: string) {
  return {
    source: "apolo" as const,
    kind,
    createdBy: userId,
    createdAt: new Date().toISOString(),
    c2xSynced: false,
  };
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function authorizeApoloWriteRequest(
  accessToken: string,
  client: NonNullable<
    ReturnType<typeof createApoloAdminClient> | ReturnType<typeof createApoloUserClient>
  >,
) {
  const { data: authData, error: authError } = await client.auth.getUser(accessToken);

  if (authError || !authData.user) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Sessao do Apolo invalida." }, { status: 401 }),
    };
  }

  const { data: user, error: userError } = await client
    .from("hub_users")
    .select("id,role,status")
    .eq("id", authData.user.id)
    .maybeSingle<{ id: string; role: HubUserRole; status: string }>();

  // Viewer nao escreve.
  if (userError || !user || user.status !== "active" || user.role === "viewer") {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Usuario sem permissao para escrever no Apolo." },
        { status: 403 },
      ),
    };
  }

  return { ok: true as const, userId: user.id };
}

function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim() || null;
}
