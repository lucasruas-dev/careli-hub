import type {
  PulseXChannel,
  PulseXPresenceUser,
} from "@/lib/pulsex";

type ConversationContextProps = {
  channel: PulseXChannel;
  users: readonly PulseXPresenceUser[];
};

export function ConversationContext({
  channel,
  users,
}: ConversationContextProps) {
  return (
    <aside className="h-full border-l border-[var(--uix-border-subtle)] bg-[var(--uix-surface)] px-5 py-5">
      <div className="flex flex-col items-center text-center">
        <span className="grid h-20 w-20 place-items-center rounded-full bg-[var(--uix-brand-primary)] text-xl font-semibold text-white">
          {channel.avatar}
        </span>
        <h2 className="m-0 mt-4 text-lg font-semibold text-[var(--uix-text-primary)]">
          {channel.name}
        </h2>
        <p className="m-0 mt-1 text-sm text-[var(--uix-text-muted)]">
          {channel.context.unit}
        </p>
      </div>

      <dl className="mt-8 grid gap-4 text-sm">
        <div>
          <dt className="text-xs text-[var(--uix-text-muted)]">Status</dt>
          <dd className="m-0 mt-1 text-[var(--uix-text-primary)]">
            {channel.context.status}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--uix-text-muted)]">Responsavel</dt>
          <dd className="m-0 mt-1 text-[var(--uix-text-primary)]">
            {channel.context.owner}
          </dd>
        </div>
        {channel.context.priority ? (
          <div>
            <dt className="text-xs text-[var(--uix-text-muted)]">Prioridade</dt>
            <dd className="m-0 mt-1 text-[var(--uix-text-primary)]">
              {channel.context.priority}
            </dd>
          </div>
        ) : null}
        <div>
          <dt className="text-xs text-[var(--uix-text-muted)]">Arquivos</dt>
          <dd className="m-0 mt-1 text-[var(--uix-text-primary)]">
            {channel.context.filesCount}
          </dd>
        </div>
      </dl>

      <div className="mt-8">
        <p className="m-0 text-xs font-medium uppercase text-[var(--uix-text-muted)]">
          Participantes
        </p>
        <div className="mt-3 grid gap-3">
          {users.map((user) => (
            <div className="flex items-center gap-3" key={user.id}>
              <span className="grid h-9 w-9 place-items-center rounded-full bg-[var(--uix-surface-muted)] text-xs font-semibold text-[var(--uix-text-primary)]">
                {user.initials}
              </span>
              <div className="min-w-0">
                <p className="m-0 truncate text-sm font-medium text-[var(--uix-text-primary)]">
                  {user.label}
                </p>
                <p className="m-0 truncate text-xs text-[var(--uix-text-muted)]">
                  {user.status}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
