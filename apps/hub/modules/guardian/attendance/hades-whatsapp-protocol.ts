import { normalizeAttendanceProtocol } from "@/modules/guardian/attendance/attendance-routing";
import type { QueueClient } from "@/modules/guardian/attendance/types";

export function findLatestAttendanceProtocol(client: QueueClient) {
  return (
    client.timeline
      ?.map((event) => normalizeAttendanceProtocol(event.protocol))
      .filter(Boolean)
      .at(-1) ?? null
  );
}
