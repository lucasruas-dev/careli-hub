import type {
  OperationalTimelineEvent,
  QueueClient,
} from "@/modules/guardian/attendance/types";

export type ManualHadesOperations = {
  commitments: QueueClient["commitments"];
  events: OperationalTimelineEvent[];
};

export function upsertById<T extends { id: string }>(
  nextRows: T[],
  currentRows: T[],
) {
  const nextIds = new Set(nextRows.map((row) => row.id));

  return [
    ...nextRows,
    ...currentRows.filter((row) => !nextIds.has(row.id)),
  ];
}

export function mergeCommitments(
  manualCommitments: QueueClient["commitments"],
  baseCommitments: QueueClient["commitments"],
) {
  return upsertById(manualCommitments, baseCommitments);
}

export function dedupeTimelineEvents(events: OperationalTimelineEvent[]) {
  return upsertById(events, []);
}
