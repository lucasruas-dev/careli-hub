import type { ChronosMinutesStatus } from "@/lib/chronos/types";
import type { BadgeVariant } from "@repo/uix";

export const chronosMinutesStatusVariant = {
  approved: "success",
  draft: "neutral",
  in_review: "warning",
  not_started: "neutral",
  rejected: "danger",
} as const satisfies Record<ChronosMinutesStatus, BadgeVariant>;
