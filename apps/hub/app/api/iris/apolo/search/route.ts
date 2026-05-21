import { createHash } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { authorizeIrisMetaRequest } from "@/lib/iris/meta-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ApoloSearchEntryRow = {
  entity_id: string;
};

type ApoloIdentifierRow = {
  entity_id: string;
};

type ApoloEntityRow = {
  display_name: string;
  document_masked: string | null;
  entity_kind: string;
  id: string;
  legal_name: string | null;
  primary_city: string | null;
  primary_state: string | null;
  trade_name: string | null;
};

type ApoloProfileRow = {
  entity_id: string;
  profile: string;
  status: string | null;
};

type ApoloContactRow = {
  contact_type: string;
  entity_id: string;
  is_primary: boolean | null;
  label: string | null;
  status: string | null;
  value: string;
};

type EntityIdLookupResult = {
  error?: unknown;
  ids: string[];
};

type IrisApoloSearchResult = {
  contacts: Array<ReturnType<typeof mapApoloContact>>;
  displayName: string;
  documentMasked: string | null;
  id: string;
  kind: string;
  locationLabel: string;
  phone: string;
  profiles: string[];
};

const MAX_LIMIT = 30;

export async function GET(request: NextRequest) {
  const authorization = await authorizeIrisMetaRequest(request, [
    "admin",
    "leader",
    "operator",
    "viewer",
  ]);

  if (!authorization.ok) {
    return authorization.response;
  }

  const url = new URL(request.url);
  const rawQuery = url.searchParams.get("q") ?? "";
  const query = normalizeSearchText(rawQuery);
  const digits = onlyDigits(rawQuery);
  const limit = parseLimit(url.searchParams.get("limit"));

  if (query.length < 2 && digits.length < 2) {
    return jsonResults([]);
  }

  const [searchEntityIds, phoneEntityIds] = await Promise.all([
    fetchEntityIdsBySearch(authorization.client, query, limit),
    fetchEntityIdsByPhone(authorization.client, digits),
  ]);

  if (searchEntityIds.error || phoneEntityIds.error) {
    return NextResponse.json(
      { error: "Nao foi possivel consultar a base CRM 360 do Apolo." },
      { status: 500 },
    );
  }

  const entityIds = unique([
    ...phoneEntityIds.ids,
    ...searchEntityIds.ids,
  ]).slice(0, limit * 3);

  if (!entityIds.length) {
    return jsonResults([]);
  }

  const [entitiesResult, profilesResult, contactsResult] = await Promise.all([
    authorization.client
      .from("apolo_entities")
      .select(
        "id,display_name,legal_name,trade_name,document_masked,entity_kind,primary_city,primary_state",
      )
      .in("id", entityIds)
      .neq("status", "archived")
      .returns<ApoloEntityRow[]>(),
    authorization.client
      .from("apolo_entity_profiles")
      .select("entity_id,profile,status")
      .in("entity_id", entityIds)
      .returns<ApoloProfileRow[]>(),
    authorization.client
      .from("apolo_contacts")
      .select("entity_id,contact_type,label,value,status,is_primary")
      .in("entity_id", entityIds)
      .in("contact_type", ["whatsapp", "phone"])
      .returns<ApoloContactRow[]>(),
  ]);

  if (
    entitiesResult.error ||
    profilesResult.error ||
    contactsResult.error
  ) {
    return NextResponse.json(
      { error: "Nao foi possivel montar o resultado CRM 360 do Apolo." },
      { status: 500 },
    );
  }

  const order = new Map(entityIds.map((entityId, index) => [entityId, index]));
  const profilesByEntity = groupRowsBy(
    (profilesResult.data ?? []).filter((row) => row.status !== "archived"),
    "entity_id",
  );
  const contactsByEntity = groupRowsBy(contactsResult.data ?? [], "entity_id");
  const results = (entitiesResult.data ?? [])
    .map((entity): IrisApoloSearchResult | null => {
      const contacts = (contactsByEntity.get(entity.id) ?? [])
        .map(mapApoloContact)
        .sort(sortApoloContacts);
      const phone = pickPreferredPhone(contacts);

      if (!phone) {
        return null;
      }

      return {
        contacts,
        displayName:
          entity.display_name ?? entity.trade_name ?? entity.legal_name ?? "Cliente",
        documentMasked: entity.document_masked,
        id: entity.id,
        kind: entity.entity_kind,
        locationLabel: [entity.primary_city, entity.primary_state]
          .filter(Boolean)
          .join(" / "),
        phone,
        profiles: unique(
          (profilesByEntity.get(entity.id) ?? [])
            .map((profile) => profile.profile)
            .filter(Boolean),
        ),
      };
    })
    .filter((result): result is IrisApoloSearchResult => Boolean(result))
    .sort((first, second) => {
      return (
        (order.get(first.id) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(second.id) ?? Number.MAX_SAFE_INTEGER)
      );
    })
    .slice(0, limit);

  return jsonResults(results);
}

async function fetchEntityIdsBySearch(
  client: SupabaseClient,
  query: string,
  limit: number,
): Promise<EntityIdLookupResult> {
  if (query.length < 2) {
    return { ids: [] as string[] };
  }

  const { data, error } = await client
    .from("apolo_search_entries")
    .select("entity_id")
    .ilike("normalized_text", `%${query}%`)
    .limit(limit * 4)
    .returns<ApoloSearchEntryRow[]>();

  return {
    error,
    ids: unique((data ?? []).map((row) => row.entity_id)),
  };
}

async function fetchEntityIdsByPhone(
  client: SupabaseClient,
  digits: string,
): Promise<EntityIdLookupResult> {
  if (digits.length < 8) {
    return { ids: [] as string[] };
  }

  const hashes = buildBrazilPhoneVariants(digits).map((variant) =>
    hashIdentifier("phone", variant),
  );

  if (!hashes.length) {
    return { ids: [] as string[] };
  }

  const { data, error } = await client
    .from("apolo_entity_identifiers")
    .select("entity_id")
    .eq("identifier_type", "phone")
    .in("value_hash", hashes)
    .limit(30)
    .returns<ApoloIdentifierRow[]>();

  return {
    error,
    ids: unique((data ?? []).map((row) => row.entity_id)),
  };
}

function mapApoloContact(row: ApoloContactRow) {
  return {
    label: row.label,
    primary: Boolean(row.is_primary),
    status: row.status,
    type: row.contact_type,
    value: row.value,
  };
}

function sortApoloContacts(first: ReturnType<typeof mapApoloContact>, second: ReturnType<typeof mapApoloContact>) {
  if (first.type !== second.type) {
    return first.type === "whatsapp" ? -1 : 1;
  }

  if (first.primary !== second.primary) {
    return first.primary ? -1 : 1;
  }

  return 0;
}

function pickPreferredPhone(
  contacts: Array<ReturnType<typeof mapApoloContact>>,
) {
  const contact =
    contacts.find((item) => item.type === "whatsapp") ?? contacts[0];
  const digits = onlyDigits(contact?.value ?? "");

  if (digits.length >= 12 && digits.length <= 15) {
    return digits;
  }

  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }

  return null;
}

function jsonResults(results: unknown[]) {
  return NextResponse.json(
    {
      data: {
        results,
        source: "apolo",
        total: results.length,
      },
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

function parseLimit(value: string | null) {
  const parsed = Number(value ?? 12);

  if (!Number.isFinite(parsed)) {
    return 12;
  }

  return Math.min(Math.max(Math.trunc(parsed), 1), MAX_LIMIT);
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[%_]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function onlyDigits(value: string | null | undefined) {
  return value?.replace(/\D/g, "") ?? "";
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

function hashIdentifier(type: string, value: string) {
  return createHash("sha256")
    .update(`apolo-identifier:${type}:${value.trim().toLowerCase()}`)
    .digest("hex");
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

    grouped.set(value, [...(grouped.get(value) ?? []), row]);
  });

  return grouped;
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}
