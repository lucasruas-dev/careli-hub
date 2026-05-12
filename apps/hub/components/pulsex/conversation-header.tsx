import type {
  PulseXChannel,
  PulseXCallType,
  PulseXPresenceUser,
} from "@/lib/pulsex";
import {
  MoreHorizontal,
  Phone,
  Search,
  Star,
  Users,
  Video,
} from "lucide-react";
import { Tooltip } from "@repo/uix";
import type { ReactNode } from "react";

type ConversationHeaderProps = {
  channel: PulseXChannel;
  onStartCall: (type: PulseXCallType) => void;
  presenceUsers: readonly PulseXPresenceUser[];
};

export function ConversationHeader({
  channel,
  onStartCall,
  presenceUsers,
}: ConversationHeaderProps) {
  const onlineCount = presenceUsers.filter(
    (user) => user.status === "online",
  ).length;
  const presenceLabelMap = {
    away: "Ausente",
    busy: "Em reuniao",
    offline: "Offline",
    online: "Online",
  } as const satisfies Record<NonNullable<PulseXChannel["status"]>, string>;
  const presenceStatus = channel.status ?? "offline";
  const presenceLabel = presenceLabelMap[presenceStatus];

  return (
    <header className="grid h-16 grid-cols-[minmax(14rem,1fr)_auto_auto] items-center gap-4 border-b border-[#d9e0ea] bg-white px-4">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-[#A07C3B] text-sm font-semibold text-white">
          {channel.avatar}
        </span>
        <div className="min-w-0">
          <h1 className="m-0 truncate text-sm font-semibold text-[var(--uix-text-primary)]">
            {channel.name}
          </h1>
          <p className="m-0 mt-0.5 flex items-center gap-2 truncate text-xs text-[var(--uix-text-muted)]">
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full data-[status=away]:bg-amber-400 data-[status=busy]:bg-[#A07C3B] data-[status=offline]:bg-zinc-400 data-[status=online]:bg-emerald-500"
              data-status={presenceStatus}
            />
            {presenceLabel}
            <span className="text-[#c8d0dc]">/</span>
            {channel.context.unit}
            {onlineCount > 0 ? (
              <>
                <span className="text-[#c8d0dc]">/</span>
                <span className="inline-flex items-center gap-1">
                  <Users aria-hidden="true" size={13} />
                  {onlineCount} online
                </span>
              </>
            ) : null}
          </p>
        </div>
      </div>
      <ParticipantStack users={presenceUsers} />
      <div className="flex items-center gap-1">
        <HeaderAction ariaLabel="Favoritar" icon={<Star size={17} />} />
        <HeaderAction ariaLabel="Buscar" icon={<Search size={17} />} />
        <HeaderAction
          ariaLabel="Chamada de audio"
          icon={<Phone size={17} />}
          onClick={() => onStartCall("audio")}
        />
        <HeaderAction
          ariaLabel="Chamada de video"
          icon={<Video size={17} />}
          onClick={() => onStartCall("video")}
        />
        <HeaderAction
          ariaLabel="Mais opcoes"
          icon={<MoreHorizontal size={18} />}
        />
      </div>
    </header>
  );
}

function ParticipantStack({
  users,
}: {
  users: readonly PulseXPresenceUser[];
}) {
  const visibleUsers = users.slice(0, 5);
  const hiddenCount = Math.max(users.length - visibleUsers.length, 0);

  return (
    <div
      aria-label="Participantes da conversa"
      className="flex min-w-0 items-center justify-end"
    >
      <div className="flex items-center">
        {visibleUsers.map((user) => (
          <Tooltip content={`${user.label} / ${getPresenceLabel(user.status)}`} key={user.id}>
            <span className="-ml-2 first:ml-0">
              <span className="relative grid h-8 w-8 place-items-center rounded-full border-2 border-white bg-[#eef2f7] text-[0.68rem] font-semibold text-[#344054] shadow-sm">
                {user.initials}
                <span
                  aria-hidden="true"
                  className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white data-[status=away]:bg-amber-400 data-[status=busy]:bg-indigo-500 data-[status=offline]:bg-zinc-400 data-[status=online]:bg-emerald-500"
                  data-status={user.status}
                />
              </span>
            </span>
          </Tooltip>
        ))}
        {hiddenCount > 0 ? (
          <span className="-ml-2 grid h-8 min-w-8 place-items-center rounded-full border-2 border-white bg-[#f8fafc] px-2 text-[0.68rem] font-semibold text-[#667085] shadow-sm">
            +{hiddenCount}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function getPresenceLabel(status: PulseXPresenceUser["status"]) {
  const labels = {
    away: "Ausente",
    busy: "Em reuniao",
    offline: "Offline",
    online: "Online",
  } as const satisfies Record<PulseXPresenceUser["status"], string>;

  return labels[status];
}

function HeaderAction({
  ariaLabel,
  icon,
  onClick,
}: {
  ariaLabel: string;
  icon: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      aria-label={ariaLabel}
      className="grid h-8 w-8 place-items-center rounded-md text-[var(--uix-text-muted)] outline-none transition hover:bg-[var(--uix-surface-muted)] hover:text-[var(--uix-text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--uix-focus-ring)]"
      onClick={onClick}
      type="button"
    >
      {icon}
    </button>
  );
}
