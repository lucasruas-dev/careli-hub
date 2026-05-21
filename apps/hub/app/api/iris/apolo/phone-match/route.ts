import { createHash } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { authorizeIrisMetaRequest } from "@/lib/iris/meta-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PhoneMatchRequest = {
  phones?: unknown;
};

type ApoloIdentifierRow = {
  entity_id: string;
  value_hash: string;
  value_masked: string | null;
};

type ApoloEntityRow = {
  display_name: string;
  document_masked: string | null;
  entity_kind: string;
  id: string;
  status: string | null;
};

type ApoloProfileRow = {
  entity_id: string;
  profile: string;
  status: string | null;
};

type ApoloRelationshipRow = {
  entity_id: string;
  label: string | null;
  related_entity_id: string | null;
  relationship_type: string | null;
  status: string | null;
};

type PhoneMatchResult =
  | {
      documentMasked: string | null;
      entityId: string;
      entityKind: string;
      label: string;
      matchedPhone: string;
      profileLabel: string | null;
      profiles: string[];
      relationLabel: string | null;
      status: "registered";
    }
  | {
      status: "missing";
    };

type PhoneMatchResponse = {
  results: Record<string, PhoneMatchResult>;
};

const LOCAL_DEV_PHONE_MATCH_CACHE_TTL_MS = 30_000;
const localDevPhoneMatchCache = new Map<
  string,
  { expiresAt: number; payload: PhoneMatchResponse }
>();

const apoloProfileLabels: Record<string, string> = {
  acesso_incorporador: "Incorporador",
  colaborador: "Colaborador",
  corretor: "Corretor",
  fornecedor: "Fornecedor",
  imobiliaria: "Imobiliaria",
  incorporador: "Incorporador",
  parceiro: "Parceiro",
  pessoa_fisica: "Pessoa fisica",
  pessoa_juridica: "Pessoa juridica",
  usuario: "Usuario",
};

const apoloProfileOrder: string[] = [
  "usuario",
  "pessoa_fisica",
  "pessoa_juridica",
  "imobiliaria",
  "corretor",
  "incorporador",
  "acesso_incorporador",
  "colaborador",
  "fornecedor",
  "parceiro",
];

export async function POST(request: NextRequest) {
  const authorization = await authorizeIrisMetaRequest(request, [
    "admin",
    "leader",
    "operator",
    "viewer",
  ]);

  if (!authorization.ok) {
    return authorization.response;
  }

  const input = (await request.json().catch(() => null)) as
    | PhoneMatchRequest
    | null;
  const phones = normalizePhoneInput(input?.phones);

  if (!phones.length) {
    return NextResponse.json({ results: {} });
  }

  const cacheKey = localDevPhoneMatchCacheKey(phones);
  const cachedPayload = readLocalDevPhoneMatchCache(cacheKey);

  if (cachedPayload) {
    return createPhoneMatchResponse(cachedPayload, "hit");
  }

  const variantsByPhone = new Map(
    phones.map((phone) => [phone, buildBrazilPhoneVariants(phone)]),
  );
  const hashesByPhone = new Map(
    phones.map((phone) => [
      phone,
      variantsByPhone.get(phone)?.map((variant) => hashIdentifier("phone", variant)) ??
        [],
    ]),
  );
  const lookupHashes = unique(
    Array.from(hashesByPhone.values()).flat(),
  );

  if (!lookupHashes.length) {
    const payload = {
      results: Object.fromEntries(
        phones.map((phone) => [phone, { status: "missing" }]),
      ),
    } as PhoneMatchResponse;

    writeLocalDevPhoneMatchCache(cacheKey, payload);

    return createPhoneMatchResponse(payload, cacheKey ? "miss" : null);
  }

  const { data: identifiers, error: identifierError } = await authorization.client
    .from("apolo_entity_identifiers")
    .select("entity_id,value_hash,value_masked")
    .eq("identifier_type", "phone")
    .in("value_hash", lookupHashes)
    .limit(100);

  if (identifierError) {
    return NextResponse.json(
      {
        error: "Nao foi possivel consultar o CRM 360 do Apolo.",
      },
      { status: 500 },
    );
  }

  const identifierRows = (identifiers ?? []) as ApoloIdentifierRow[];
  const entityIds = unique(identifierRows.map((row) => row.entity_id));
  const [
    entitiesResult,
    directRelationshipsResult,
    relatedRelationshipsResult,
  ] = await Promise.all([
    entityIds.length
      ? authorization.client
          .from("apolo_entities")
          .select("id,display_name,document_masked,entity_kind,status")
          .in("id", entityIds)
      : Promise.resolve({ data: [], error: null }),
    entityIds.length
      ? authorization.client
          .from("apolo_relationships")
          .select("entity_id,related_entity_id,relationship_type,label,status")
          .in("entity_id", entityIds)
      : Promise.resolve({ data: [], error: null }),
    entityIds.length
      ? authorization.client
          .from("apolo_relationships")
          .select("entity_id,related_entity_id,relationship_type,label,status")
          .in("related_entity_id", entityIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (
    entitiesResult.error ||
    directRelationshipsResult.error ||
    relatedRelationshipsResult.error
  ) {
    return NextResponse.json(
      {
        error: "Nao foi possivel montar o vinculo CRM 360 do Apolo.",
      },
      { status: 500 },
    );
  }

  const relationshipRows = uniqueRowsById([
    ...((directRelationshipsResult.data ?? []) as ApoloRelationshipRow[]),
    ...((relatedRelationshipsResult.data ?? []) as ApoloRelationshipRow[]),
  ]);
  const entityIdsWithRelations = unique([
    ...entityIds,
    ...relationshipRows
      .flatMap((row) => [row.entity_id, row.related_entity_id])
      .filter((id): id is string => Boolean(id)),
  ]);
  const extraEntityIds = entityIdsWithRelations.filter(
    (id) => !entityIds.includes(id),
  );
  const [extraEntitiesResult, profilesResult] = await Promise.all([
    extraEntityIds.length
      ? authorization.client
          .from("apolo_entities")
          .select("id,display_name,document_masked,entity_kind,status")
          .in("id", extraEntityIds)
      : Promise.resolve({ data: [], error: null }),
    entityIdsWithRelations.length
      ? authorization.client
          .from("apolo_entity_profiles")
          .select("entity_id,profile,status")
          .in("entity_id", entityIdsWithRelations)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (extraEntitiesResult.error || profilesResult.error) {
    return NextResponse.json(
      {
        error: "Nao foi possivel montar o perfil CRM 360 do Apolo.",
      },
      { status: 500 },
    );
  }

  const entitiesById = new Map(
    [
      ...((entitiesResult.data ?? []) as ApoloEntityRow[]),
      ...((extraEntitiesResult.data ?? []) as ApoloEntityRow[]),
    ].map((entity) => [entity.id, entity]),
  );
  const relationshipsByEntity = groupRowsBy(relationshipRows, "entity_id");
  const relationshipsByRelatedEntity = groupRowsBy(
    relationshipRows.filter((row) => row.related_entity_id),
    "related_entity_id",
  );
  const profilesByEntity = groupRowsBy(
    (profilesResult.data ?? []) as ApoloProfileRow[],
    "entity_id",
  );
  const identifiersByHash = groupRowsBy(identifierRows, "value_hash");
  const results = Object.fromEntries(
    phones.map((phone) => {
      const hashes = hashesByPhone.get(phone) ?? [];
      const match = hashes
        .flatMap((hash) => identifiersByHash.get(hash) ?? [])
        .map((identifier) => ({
          entity: entitiesById.get(identifier.entity_id),
          identifier,
        }))
        .find((item) => item.entity);

      if (!match?.entity) {
        return [phone, { status: "missing" } satisfies PhoneMatchResult];
      }

      const spouseRelationship = preferredSpouseRelationship(
        relationshipsByRelatedEntity.get(match.entity.id) ?? [],
      );
      const resolvedEntity =
        spouseRelationship?.entity_id &&
        entitiesById.get(spouseRelationship.entity_id)
          ? entitiesById.get(spouseRelationship.entity_id)
          : match.entity;
      const relationship = spouseRelationship
        ? spouseContextLabel(spouseRelationship, match.entity)
        : preferredRelationship(relationshipsByEntity.get(match.entity.id) ?? []);
      const profiles = profileLabels(
        profilesByEntity.get(resolvedEntity?.id ?? match.entity.id) ?? [],
      );

      return [
        phone,
        {
          documentMasked: resolvedEntity?.document_masked ?? match.entity.document_masked,
          entityId: resolvedEntity?.id ?? match.entity.id,
          entityKind: resolvedEntity?.entity_kind ?? match.entity.entity_kind,
          label: resolvedEntity?.display_name ?? match.entity.display_name,
          matchedPhone: match.identifier.value_masked ?? "Telefone cadastrado",
          profileLabel: profiles[0] ?? null,
          profiles,
          relationLabel: relationship,
          status: "registered",
        } satisfies PhoneMatchResult,
      ];
    }),
  ) as Record<string, PhoneMatchResult>;

  const payload = { results };

  writeLocalDevPhoneMatchCache(cacheKey, payload);

  return createPhoneMatchResponse(payload, cacheKey ? "miss" : null);
}

function normalizePhoneInput(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return unique(
    value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean),
  ).slice(0, 100);
}

function buildBrazilPhoneVariants(value: string) {
  const digits = onlyDigits(value);
  const variants = new Set<string>();

  if (digits.length >= 8) {
    variants.add(digits);
  }

  const national = digits.startsWith("55") ? digits.slice(2) : digits;

  if (national.length >= 8) {
    variants.add(national);
    variants.add(`55${national}`);
  }

  if (national.length === 11 && national[2] === "9") {
    const withoutNinthDigit = `${national.slice(0, 2)}${national.slice(3)}`;
    variants.add(withoutNinthDigit);
    variants.add(`55${withoutNinthDigit}`);
  }

  if (national.length === 10) {
    const withNinthDigit = `${national.slice(0, 2)}9${national.slice(2)}`;
    variants.add(withNinthDigit);
    variants.add(`55${withNinthDigit}`);
  }

  return Array.from(variants).filter((variant) => variant.length >= 8);
}

function preferredRelationship(relationships: ApoloRelationshipRow[]) {
  const spouseRelationship = relationships.find(isSpouseRelationship);
  const relationship = spouseRelationship ?? relationships[0];

  if (!relationship) {
    return null;
  }

  return relationship.label || relationship.relationship_type || null;
}

function preferredSpouseRelationship(relationships: ApoloRelationshipRow[]) {
  return relationships.find(isSpouseRelationship) ?? null;
}

function isSpouseRelationship(relationship: ApoloRelationshipRow) {
  return normalizeText(
    `${relationship.relationship_type ?? ""} ${relationship.label ?? ""}`,
  ).includes("conjuge");
}

function spouseContextLabel(
  relationship: ApoloRelationshipRow,
  matchedEntity: ApoloEntityRow,
) {
  const relation = relationship.label || relationship.relationship_type || "Conjuge";

  return `Telefone do conjuge - ${matchedEntity.display_name} (${relation})`;
}

function profileLabels(rows: ApoloProfileRow[]) {
  return unique(
    rows
      .filter((row) => row.status !== "archived")
      .sort(
        (first, second) =>
          profileOrderIndex(first.profile) - profileOrderIndex(second.profile),
      )
      .map((row) => apoloProfileLabels[row.profile] ?? row.profile)
      .filter(Boolean),
  );
}

function profileOrderIndex(profile: string) {
  const index = apoloProfileOrder.indexOf(profile);

  return index === -1 ? 999 : index;
}

function uniqueRowsById(rows: ApoloRelationshipRow[]) {
  const seen = new Set<string>();

  return rows.filter((row) => {
    const key = [
      row.entity_id,
      row.related_entity_id ?? "",
      row.relationship_type ?? "",
      row.label ?? "",
    ].join(":");

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function onlyDigits(value: string | null | undefined) {
  return value?.replace(/\D/g, "") ?? "";
}

function hashIdentifier(type: string, value: string) {
  return createHash("sha256")
    .update(`apolo-identifier:${type}:${value.trim().toLowerCase()}`)
    .digest("hex");
}

function createPhoneMatchResponse(
  payload: PhoneMatchResponse,
  localCacheState: "hit" | "miss" | null,
) {
  return NextResponse.json(payload, {
    headers: localCacheState
      ? { "X-Panteon-Local-Cache": localCacheState }
      : undefined,
  });
}

function localDevPhoneMatchCacheKey(phones: string[]) {
  if (process.env.NODE_ENV !== "development") {
    return null;
  }

  return unique(phones).sort().join("|");
}

function readLocalDevPhoneMatchCache(cacheKey: string | null) {
  if (!cacheKey) {
    return null;
  }

  const cached = localDevPhoneMatchCache.get(cacheKey);

  if (!cached || cached.expiresAt < Date.now()) {
    localDevPhoneMatchCache.delete(cacheKey);
    return null;
  }

  return cached.payload;
}

function writeLocalDevPhoneMatchCache(
  cacheKey: string | null,
  payload: PhoneMatchResponse,
) {
  if (!cacheKey) {
    return;
  }

  localDevPhoneMatchCache.set(cacheKey, {
    expiresAt: Date.now() + LOCAL_DEV_PHONE_MATCH_CACHE_TTL_MS,
    payload,
  });
}

function groupRowsBy<T extends Record<string, unknown>>(
  rows: T[],
  key: keyof T,
) {
  const grouped = new Map<string, T[]>();

  rows.forEach((row) => {
    const value = row[key];

    if (typeof value !== "string") {
      return;
    }

    const current = grouped.get(value) ?? [];
    current.push(row);
    grouped.set(value, current);
  });

  return grouped;
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}
