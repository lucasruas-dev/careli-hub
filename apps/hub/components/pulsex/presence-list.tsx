import type { PulseXPresenceUser } from "@/lib/pulsex";
import type { StatusIndicatorVariant } from "@repo/uix";
import { PresenceStack, StatusIndicator, Surface } from "@repo/uix";

type PresenceListProps = {
  users: readonly PulseXPresenceUser[];
};

export function PresenceList({ users }: PresenceListProps) {
  const statusVariantMap: Record<
    PulseXPresenceUser["status"],
    StatusIndicatorVariant
  > = {
    away: "warning",
    busy: "processing",
    offline: "offline",
    online: "online",
  };

  return (
    <Surface muted>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="m-0 text-sm font-semibold text-[var(--uix-text-primary)]">
            Presenca
          </p>
          <p className="m-0 mt-1 text-xs text-[var(--uix-text-muted)]">
            Usuarios online simulados.
          </p>
        </div>
        <PresenceStack limit={3} users={users} />
      </div>
      <div className="grid gap-3">
        {users.map((user) => (
          <div
            className="flex items-center justify-between gap-3"
            key={user.id}
          >
            <div>
              <p className="m-0 text-sm font-medium text-[var(--uix-text-primary)]">
                {user.label}
              </p>
              <p className="m-0 mt-0.5 text-xs text-[var(--uix-text-muted)]">
                {user.role}
              </p>
            </div>
            <StatusIndicator
              label={user.status}
              variant={statusVariantMap[user.status]}
            />
          </div>
        ))}
      </div>
    </Surface>
  );
}
