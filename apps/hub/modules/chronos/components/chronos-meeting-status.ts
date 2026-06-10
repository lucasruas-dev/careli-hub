import type { ChronosMeeting } from "@/lib/chronos/types";
import type { BadgeVariant } from "@repo/uix";

export const chronosMeetingStatusVariant = {
  cancelled: "neutral",
  closed: "success",
  live: "danger",
  lobby: "info",
  review: "warning",
  scheduled: "neutral",
} as const satisfies Record<ChronosMeeting["status"], BadgeVariant>;
