import { NextResponse } from "next/server";

import { loadApoloDashboard } from "@/lib/apolo/server";
import type { ApoloEntity, ApoloProfile } from "@/lib/apolo/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_LIMIT = 50;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = normalizeSearch(url.searchParams.get("q") ?? "");
  const profile = normalizeProfile(url.searchParams.get("profile"));
  const limit = parseLimit(url.searchParams.get("limit"));
  const dashboard = await loadApoloDashboard();
  const results = dashboard.entities
    .filter((entity) => matchesSearch(entity, query, profile))
    .slice(0, limit)
    .map((entity) => ({
      displayName: entity.displayName,
      documentMasked: entity.documentMasked,
      id: entity.id,
      kind: entity.kind,
      locationLabel: entity.locationLabel,
      profiles: entity.profiles,
      status: entity.status,
      updatedAt: entity.updatedAt,
    }));

  return NextResponse.json(
    {
      data: {
        meta: dashboard.meta,
        results,
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

function matchesSearch(
  entity: ApoloEntity,
  query: string,
  profile: ApoloProfile | null,
) {
  if (profile && !entity.profiles.includes(profile)) {
    return false;
  }

  if (!query) {
    return true;
  }

  return normalizeSearch(
    [
      entity.displayName,
      entity.documentMasked,
      entity.locationLabel,
      entity.profiles.join(" "),
      entity.relationships.map((relationship) => relationship.label).join(" "),
      entity.commercialLinks
        .map((link) => `${link.enterprise} ${link.unit} ${link.role}`)
        .join(" "),
    ].join(" "),
  ).includes(query);
}

function normalizeProfile(value: string | null): ApoloProfile | null {
  const allowed = new Set([
    "usuario",
    "prospect",
    "incorporador",
    "imobiliaria",
    "corretor",
    "fornecedor",
    "parceiro",
    "colaborador",
    "acesso_incorporador",
    "pessoa_fisica",
    "pessoa_juridica",
  ]);

  return value && allowed.has(value) ? (value as ApoloProfile) : null;
}

function parseLimit(value: string | null) {
  const parsed = Number(value ?? 20);

  if (!Number.isFinite(parsed)) {
    return 20;
  }

  return Math.min(Math.max(Math.trunc(parsed), 1), MAX_LIMIT);
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
