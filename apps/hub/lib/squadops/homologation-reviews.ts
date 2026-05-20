import { createClient } from "@supabase/supabase-js";

import { getServerSupabaseConfig } from "@/lib/supabase/server-config";

export const homologationReviewStatuses = [
  "aguardando_teste",
  "em_teste",
  "aprovado",
  "reprovado",
  "bloqueado",
] as const;

export type HomologationReviewStatus =
  (typeof homologationReviewStatuses)[number];

export type HomologationReviewItemKind =
  | "alerta"
  | "atividade"
  | "deploy"
  | "ticket";

export type ZeusHomologationReview = {
  itemKind: HomologationReviewItemKind;
  itemProtocol: string;
  itemTitle: string;
  itemType: string;
  module: string;
  note: string;
  releaseProtocol: string;
  reviewedAt: string | null;
  status: HomologationReviewStatus;
  updatedAt: string;
};

export type ZeusHomologationReviewState = Record<
  string,
  Record<
    string,
    {
      note: string;
      status: HomologationReviewStatus;
      updatedAt: string;
    }
  >
>;

type HomologationReviewRow = {
  id: string;
  item_kind: HomologationReviewItemKind;
  item_protocol: string;
  item_title: string;
  item_type: string;
  module: string;
  note: string;
  release_protocol: string;
  reviewed_at: string | null;
  reviewed_by_user_id: string | null;
  status: HomologationReviewStatus;
  updated_at: string;
};

type HomologationReviewUpsert = {
  item_kind: HomologationReviewItemKind;
  item_protocol: string;
  item_title: string;
  item_type: string;
  metadata: Record<string, unknown>;
  module: string;
  note: string;
  release_protocol: string;
  reviewed_at: string;
  reviewed_by_user_id: string | null;
  source: string;
  status: HomologationReviewStatus;
};

type ZeusHomologationReviewDatabase = {
  public: {
    CompositeTypes: Record<string, never>;
    Enums: {
      hub_squadops_homologation_status: HomologationReviewStatus;
    };
    Functions: Record<string, never>;
    Tables: {
      hub_squadops_homologation_reviews: {
        Insert: HomologationReviewUpsert;
        Relationships: [];
        Row: HomologationReviewRow;
        Update: Partial<HomologationReviewUpsert>;
      };
    };
    Views: Record<string, never>;
  };
};

type ZeusHomologationReviewClient = ReturnType<
  typeof createClient<ZeusHomologationReviewDatabase>
>;

export async function loadZeusHomologationReviews(): Promise<
  ZeusHomologationReview[]
> {
  const adminClient = createHomologationReviewClient();

  if (!adminClient) {
    throw new Error("Supabase server-side nao configurado para homologacao Zeus.");
  }

  const { data, error } = await adminClient
    .from("hub_squadops_homologation_reviews")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1000);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map(mapHomologationReviewRow);
}

export async function upsertZeusHomologationReview({
  input,
  userId,
}: {
  input: {
    itemKind: HomologationReviewItemKind;
    itemProtocol: string;
    itemTitle: string;
    itemType: string;
    module: string;
    note: string;
    releaseProtocol: string;
    status: HomologationReviewStatus;
  };
  userId: string | null;
}) {
  const adminClient = createHomologationReviewClient();

  if (!adminClient) {
    throw new Error("Supabase server-side nao configurado para homologacao Zeus.");
  }

  const now = new Date().toISOString();
  const payload: HomologationReviewUpsert = {
    item_kind: input.itemKind,
    item_protocol: input.itemProtocol.trim(),
    item_title: input.itemTitle.trim() || "nao informado",
    item_type: input.itemType.trim() || "nao informado",
    metadata: {
      source: "squadops-center-ui",
    },
    module: input.module.trim() || "nao informado",
    note: input.note.trim(),
    release_protocol: input.releaseProtocol.trim(),
    reviewed_at: now,
    reviewed_by_user_id: userId,
    source: "squadops-center",
    status: input.status,
  };

  const { data, error } = await adminClient
    .from("hub_squadops_homologation_reviews")
    .upsert(payload, {
      onConflict: "release_protocol,item_protocol",
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return mapHomologationReviewRow(data);
}

export function buildHomologationReviewState(
  reviews: ZeusHomologationReview[],
): ZeusHomologationReviewState {
  return reviews.reduce<ZeusHomologationReviewState>((state, review) => {
    const releaseReviews = state[review.releaseProtocol] ?? {};

    return {
      ...state,
      [review.releaseProtocol]: {
        ...releaseReviews,
        [review.itemProtocol]: {
          note: review.note,
          status: review.status,
          updatedAt: review.updatedAt,
        },
      },
    };
  }, {});
}

export function isHomologationReviewStatus(
  value: unknown,
): value is HomologationReviewStatus {
  return (
    typeof value === "string" &&
    homologationReviewStatuses.includes(value as HomologationReviewStatus)
  );
}

export function isHomologationSchemaMissingError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  const normalizedMessage = message
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  return (
    normalizedMessage.includes("hub_squadops_homologation_reviews") &&
    (normalizedMessage.includes("schema cache") ||
      normalizedMessage.includes("could not find the table") ||
      normalizedMessage.includes("tabela"))
  );
}

function createHomologationReviewClient(): ZeusHomologationReviewClient | null {
  const { serviceRoleKey, url } = getServerSupabaseConfig();

  if (!url || !serviceRoleKey) {
    return null;
  }

  return createClient<ZeusHomologationReviewDatabase>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function mapHomologationReviewRow(
  row: HomologationReviewRow,
): ZeusHomologationReview {
  return {
    itemKind: row.item_kind,
    itemProtocol: row.item_protocol,
    itemTitle: row.item_title,
    itemType: row.item_type,
    module: row.module,
    note: row.note,
    releaseProtocol: row.release_protocol,
    reviewedAt: row.reviewed_at,
    status: row.status,
    updatedAt: row.updated_at,
  };
}
