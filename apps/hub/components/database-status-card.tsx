"use client";

import { useDatabase } from "@/providers/database-provider";
import {
  isDatabaseConnected,
  mapDatabaseStatusToPulseState,
} from "@repo/database";
import {
  RealtimePulse,
  StatusIndicator,
  Surface,
} from "@repo/uix";

export function DatabaseStatusCard() {
  const { databaseStatus } = useDatabase();
  const connected = isDatabaseConnected(databaseStatus);

  return (
    <Surface muted>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="m-0 text-sm font-semibold text-[var(--uix-text-primary)]">
            Database layer
          </p>
          <p className="m-0 mt-1 text-xs text-[var(--uix-text-muted)]">
            Contrato mockado preparado para Supabase, sem conexao real.
          </p>
        </div>
        <RealtimePulse
          label={databaseStatus.status}
          state={mapDatabaseStatusToPulseState(databaseStatus.status)}
        />
      </div>
      <div className="mt-4 grid grid-cols-4 gap-3">
        <div>
          <p className="m-0 text-xs text-[var(--uix-text-muted)]">Ambiente</p>
          <p className="m-0 mt-1 text-sm font-medium text-[var(--uix-text-primary)]">
            {databaseStatus.environment}
          </p>
        </div>
        <div>
          <p className="m-0 text-xs text-[var(--uix-text-muted)]">Latencia</p>
          <p className="m-0 mt-1 text-sm font-medium text-[var(--uix-text-primary)]">
            {databaseStatus.latencyMs ? `${databaseStatus.latencyMs}ms` : "-"}
          </p>
        </div>
        <div>
          <p className="m-0 text-xs text-[var(--uix-text-muted)]">Check</p>
          <p className="m-0 mt-1 text-sm font-medium text-[var(--uix-text-primary)]">
            {databaseStatus.checkedAt}
          </p>
        </div>
        <div>
          <p className="m-0 text-xs text-[var(--uix-text-muted)]">Status</p>
          <div className="mt-1">
            <StatusIndicator
              label={connected ? "conectado" : "pendente"}
              variant={connected ? "online" : "warning"}
            />
          </div>
        </div>
      </div>
    </Surface>
  );
}
