"use client";

import type {
  HermesChannel,
  HermesCallHistoryEntry,
  HermesCallType,
  HermesPresenceUser,
} from "@/lib/pulsex";
import { useOutsideDismiss } from "@/hooks/use-outside-dismiss";
import {
  History,
  MoreHorizontal,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Search,
  Star,
  Users,
  Video,
} from "lucide-react";
import { Tooltip } from "@repo/uix";
import type { ReactNode } from "react";
import { useRef, useState } from "react";
import Image from "next/image";
import { PanteonTopbarUser } from "@/components/panteon/panteon-topbar-user";

type ConversationHeaderProps = {
  callHistory: readonly HermesCallHistoryEntry[];
  channel: HermesChannel;
  isFavorite?: boolean;
  onMarkCallHistoryRead: (channelId?: string) => void;
  onReturnCall: (entry: HermesCallHistoryEntry) => void;
  onStartCall: (type: HermesCallType) => void;
  onToggleFavorite?: () => void;
  presenceUsers: readonly HermesPresenceUser[];
  unreadCallCount: number;
};

export function ConversationHeader({
  callHistory,
  channel,
  isFavorite = false,
  onMarkCallHistoryRead,
  onReturnCall,
  onStartCall,
  onToggleFavorite,
  presenceUsers,
  unreadCallCount,
}: ConversationHeaderProps) {
  const [isCallHistoryOpen, setIsCallHistoryOpen] = useState(false);
  const callHistoryMenuRef = useRef<HTMLDivElement>(null);
  const onlineCount = presenceUsers.filter(
    (user) => user.status === "online",
  ).length;
  const presenceLabelMap = {
    agenda: "Agenda",
    away: "Ausente",
    busy: "Agenda",
    lunch: "Almoco",
    offline: "Offline",
    online: "Online",
  } as const satisfies Record<NonNullable<HermesChannel["status"]>, string>;
  const presenceStatus = getChannelPresenceStatus(presenceUsers);
  const presenceLabel = presenceLabelMap[presenceStatus];
  const isDirectChannel = channel.kind === "direct";

  useOutsideDismiss({
    enabled: isCallHistoryOpen,
    onDismiss: () => setIsCallHistoryOpen(false),
    ref: callHistoryMenuRef,
  });

  return (
    <header className="grid h-16 grid-cols-[minmax(12rem,1fr)_auto_auto] items-center gap-4 border-b border-[#d9e0ea] bg-white px-4">
      <div className="flex min-w-0 items-center gap-3">
        <ChannelAvatar channel={channel} />
        <div className="min-w-0">
          <h1 className="m-0 truncate text-sm font-semibold text-[var(--uix-text-primary)]">
            {channel.name}
          </h1>
          <p className="m-0 mt-0.5 flex items-center gap-2 truncate text-xs text-[var(--uix-text-muted)]">
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full data-[status=agenda]:bg-sky-500 data-[status=away]:bg-red-500 data-[status=busy]:bg-sky-500 data-[status=lunch]:bg-yellow-400 data-[status=offline]:bg-zinc-400 data-[status=online]:bg-emerald-500"
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
      {isDirectChannel ? (
        <span aria-hidden="true" />
      ) : (
        <ParticipantStack users={presenceUsers} />
      )}
      <div className="flex items-center gap-1">
        <HeaderAction
          active={isFavorite}
          ariaLabel={isFavorite ? "Remover favorito" : "Favoritar"}
          icon={
            <Star
              aria-hidden="true"
              fill={isFavorite ? "currentColor" : "none"}
              size={17}
            />
          }
          onClick={onToggleFavorite}
        />
        <HeaderAction ariaLabel="Buscar" icon={<Search size={17} />} />
        <div className="relative" ref={callHistoryMenuRef}>
          <HeaderAction
            active={isCallHistoryOpen}
            ariaLabel="Historico de chamadas"
            badgeCount={unreadCallCount}
            icon={<History size={17} />}
            onClick={() => {
              const nextOpenState = !isCallHistoryOpen;

              setIsCallHistoryOpen(nextOpenState);

              if (nextOpenState) {
                onMarkCallHistoryRead();
              }
            }}
          />
          {isCallHistoryOpen ? (
            <CallHistoryMenu
              entries={callHistory}
              onReturnCall={(entry) => {
                onReturnCall(entry);
                setIsCallHistoryOpen(false);
              }}
            />
          ) : null}
        </div>
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
        <PanteonTopbarUser className="ml-2 border-l border-[#d9e0ea] pl-3" compact />
      </div>
    </header>
  );
}

function ChannelAvatar({ channel }: { channel: HermesChannel }) {
  const isDirectChannel = channel.kind === "direct";

  return (
    <span
      aria-label={channel.name}
      className={`relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden bg-[#A07C3B] text-sm font-semibold text-white ${
        isDirectChannel ? "rounded-full" : "rounded-md"
      }`}
      role="img"
    >
      {isDirectChannel && channel.avatarUrl ? (
        <Image
          alt=""
          className="object-cover"
          draggable={false}
          fill
          sizes="40px"
          src={channel.avatarUrl}
          unoptimized
        />
      ) : (
        channel.avatar
      )}
    </span>
  );
}

function CallHistoryMenu({
  entries,
  onReturnCall,
}: {
  entries: readonly HermesCallHistoryEntry[];
  onReturnCall: (entry: HermesCallHistoryEntry) => void;
}) {
  const visibleEntries = entries.slice(0, 10);

  return (
    <div className="absolute right-0 top-10 z-[90] w-[23rem] overflow-hidden rounded-xl border border-[#d9e0ea] bg-white text-[#101820] shadow-[0_22px_60px_rgba(16,24,32,0.22)]">
      <div className="border-b border-[#edf1f6] px-4 py-3">
        <p className="m-0 text-sm font-semibold">Chamadas</p>
        <p className="m-0 mt-0.5 text-xs text-[#667085]">
          {entries.length > 0
            ? `${entries.length} registro${entries.length === 1 ? "" : "s"} recentes`
            : "Nenhuma chamada registrada"}
        </p>
      </div>
      {visibleEntries.length > 0 ? (
        <div className="max-h-[24rem] overflow-y-auto p-2">
          {visibleEntries.map((entry) => (
            <CallHistoryMenuItem
              entry={entry}
              key={entry.id}
              onReturnCall={onReturnCall}
            />
          ))}
        </div>
      ) : (
        <div className="px-4 py-8 text-center">
          <p className="m-0 text-sm font-semibold text-[#344054]">
            Sem chamadas ainda
          </p>
          <p className="m-0 mt-1 text-xs leading-5 text-[#667085]">
            Chamadas recebidas, perdidas e realizadas aparecerao aqui.
          </p>
        </div>
      )}
    </div>
  );
}

function CallHistoryMenuItem({
  entry,
  onReturnCall,
}: {
  entry: HermesCallHistoryEntry;
  onReturnCall: (entry: HermesCallHistoryEntry) => void;
}) {
  const copy = getCallHistoryCopy(entry);

  return (
    <button
      className="grid w-full grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-2 text-left outline-none transition hover:bg-[#f4f6f8] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
      onClick={() => onReturnCall(entry)}
      type="button"
    >
      <span
        aria-hidden="true"
        className={`relative grid h-10 w-10 place-items-center overflow-hidden rounded-full ${copy.avatarClass}`}
        style={
          entry.callerAvatarUrl
            ? {
                backgroundImage: `url(${entry.callerAvatarUrl})`,
                backgroundPosition: "center",
                backgroundSize: "cover",
              }
            : undefined
        }
      >
        {entry.callerAvatarUrl ? null : copy.icon}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-[#101820]">
          {entry.callerName}
        </span>
        <span className={`mt-0.5 block truncate text-xs ${copy.textClass}`}>
          {copy.title}
        </span>
        <span className="mt-0.5 block truncate text-[0.68rem] text-[#667085]">
          {entry.channelName}
        </span>
      </span>
      <span className="text-right">
        <span className="block text-xs font-bold text-[#101820]">
          {formatCallHistoryTime(entry.startedAt)}
        </span>
        <span className="mt-1 inline-flex rounded-full border border-[#d9e0ea] px-2 py-0.5 text-[0.62rem] font-semibold text-[#667085]">
          Retornar
        </span>
      </span>
    </button>
  );
}

function getCallHistoryCopy(entry: HermesCallHistoryEntry) {
  const kindLabel = entry.type === "video" ? "video" : "voz";

  if (entry.status === "missed") {
    return {
      avatarClass: "bg-[#fff1f2] text-rose-600",
      icon: <PhoneMissed aria-hidden="true" size={17} />,
      textClass: "font-semibold text-rose-600",
      title: `Ligacao de ${kindLabel} perdida`,
    };
  }

  if (entry.status === "declined") {
    return {
      avatarClass: "bg-[#fff7ed] text-orange-600",
      icon: <PhoneMissed aria-hidden="true" size={17} />,
      textClass: "font-semibold text-orange-600",
      title: `Ligacao de ${kindLabel} nao atendida`,
    };
  }

  if (entry.direction === "outgoing") {
    return {
      avatarClass: "bg-[#f2f4f7] text-[#344054]",
      icon: <PhoneOutgoing aria-hidden="true" size={17} />,
      textClass: "text-[#667085]",
      title: `Ligacao de ${kindLabel} realizada`,
    };
  }

  return {
    avatarClass: "bg-[#ecfdf3] text-emerald-700",
    icon: <PhoneIncoming aria-hidden="true" size={17} />,
    textClass: "text-[#667085]",
    title: `Ligacao de ${kindLabel} recebida`,
  };
}

function formatCallHistoryTime(value: string) {
  const time = Date.parse(value);

  if (Number.isNaN(time)) {
    return "--:--";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(time));
}

function getChannelPresenceStatus(
  users: readonly HermesPresenceUser[],
): NonNullable<HermesChannel["status"]> {
  if (users.some((user) => user.status === "online")) {
    return "online";
  }

  if (users.some((user) => user.status === "agenda" || user.status === "busy")) {
    return "agenda";
  }

  if (users.some((user) => user.status === "lunch")) {
    return "lunch";
  }

  if (users.some((user) => user.status === "away")) {
    return "away";
  }

  return "offline";
}

function ParticipantStack({
  users,
}: {
  users: readonly HermesPresenceUser[];
}) {
  const visibleUsers = users.slice(0, 5);
  const hiddenCount = Math.max(users.length - visibleUsers.length, 0);

  return (
    <div
      aria-label="Participantes da conversa"
      className="flex min-w-0 items-center justify-end gap-2"
    >
      <div className="flex items-center">
        {visibleUsers.map((user) => (
          <Tooltip content={`${user.label} / ${getPresenceLabel(user.status)}`} key={user.id}>
            <span className="-ml-2 first:ml-0">
              <span
                aria-label={`${user.label} - ${getPresenceLabel(user.status)}`}
                className="relative grid h-8 w-8 place-items-center overflow-hidden rounded-full border-2 border-white bg-[#101820] text-[0.68rem] font-semibold text-white shadow-sm"
                role="img"
                style={
                  user.avatarUrl
                    ? {
                        backgroundImage: `url(${user.avatarUrl})`,
                        backgroundPosition: "center",
                        backgroundSize: "cover",
                      }
                    : undefined
                }
              >
                {user.avatarUrl ? null : user.initials}
                <span
                  aria-hidden="true"
                  className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white data-[status=agenda]:bg-sky-500 data-[status=away]:bg-red-500 data-[status=busy]:bg-sky-500 data-[status=lunch]:bg-yellow-400 data-[status=offline]:bg-zinc-400 data-[status=online]:bg-emerald-500"
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

function getPresenceLabel(status: HermesPresenceUser["status"]) {
  const labels = {
    agenda: "Agenda",
    away: "Ausente",
    busy: "Agenda",
    lunch: "Almoco",
    offline: "Offline",
    online: "Online",
  } as const satisfies Record<HermesPresenceUser["status"], string>;

  return labels[status];
}

function HeaderAction({
  active = false,
  ariaLabel,
  attention = false,
  badgeCount = 0,
  icon,
  onClick,
}: {
  active?: boolean;
  ariaLabel: string;
  attention?: boolean;
  badgeCount?: number;
  icon: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      aria-label={ariaLabel}
      aria-pressed={active || undefined}
      className={`relative grid h-8 w-8 place-items-center rounded-md outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--uix-focus-ring)] aria-pressed:bg-[#f7f3eb] aria-pressed:text-[#A07C3B] ${
        attention
          ? "bg-[#e8f7f4] text-[#0f766e] shadow-sm shadow-[#0f766e]/10 hover:bg-[#d7f0eb] hover:text-[#0b5f58]"
          : "text-[var(--uix-text-muted)] hover:bg-[var(--uix-surface-muted)] hover:text-[var(--uix-text-primary)]"
      }`}
      onClick={onClick}
      type="button"
    >
      {icon}
      {badgeCount > 0 ? (
        <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-rose-600 px-1 text-[0.6rem] font-bold leading-none text-white">
          {badgeCount > 9 ? "9+" : badgeCount}
        </span>
      ) : null}
    </button>
  );
}
