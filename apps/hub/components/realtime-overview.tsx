"use client";

import { useRealtime } from "@/providers/realtime-provider";
import {
  mapConnectionStatusToPulseState,
} from "@repo/realtime";
import {
  ActivityFeed,
  PresenceStack,
  RealtimePulse,
  Surface,
} from "@repo/uix";

export function RealtimeOverview() {
  const { realtimeState } = useRealtime();

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_20rem] gap-6">
      <Surface>
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <p className="m-0 text-sm font-semibold text-[var(--uix-text-primary)]">
              Atividade viva
            </p>
            <p className="m-0 mt-1 text-xs text-[var(--uix-text-muted)]">
              Eventos mockados vindos do RealtimeProvider.
            </p>
          </div>
          <RealtimePulse
            label={realtimeState.connectionStatus}
            state={mapConnectionStatusToPulseState(
              realtimeState.connectionStatus,
            )}
          />
        </div>
        <ActivityFeed
          events={realtimeState.events.map((event) => ({
            description: event.description,
            id: event.id,
            status: event.severity,
            timestamp: event.timestamp,
            title: event.title,
            type: event.type,
          }))}
        />
      </Surface>
      <Surface muted>
        <div className="grid gap-4">
          <div>
            <p className="m-0 text-sm font-semibold text-[var(--uix-text-primary)]">
              Presenca
            </p>
            <p className="m-0 mt-1 text-xs text-[var(--uix-text-muted)]">
              Usuarios mockados do estado realtime.
            </p>
          </div>
          <PresenceStack users={realtimeState.presence} />
        </div>
      </Surface>
    </div>
  );
}
