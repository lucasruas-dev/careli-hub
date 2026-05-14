"use client";

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
  Volume2,
} from "lucide-react";
import { Tooltip } from "@repo/uix";
import type { ReactNode } from "react";
import { useState } from "react";

export type PulseXCallSoundOption = {
  id: string;
  label: string;
};

type ConversationHeaderProps = {
  callSoundOptions: readonly PulseXCallSoundOption[];
  channel: PulseXChannel;
  onChangeCallSound: (soundId: string) => void;
  onPreviewCallSound: (soundId: string) => void;
  onStartCall: (type: PulseXCallType) => void;
  presenceUsers: readonly PulseXPresenceUser[];
  selectedCallSoundId: string;
};

export function ConversationHeader({
  callSoundOptions,
  channel,
  onChangeCallSound,
  onPreviewCallSound,
  onStartCall,
  presenceUsers,
  selectedCallSoundId,
}: ConversationHeaderProps) {
  const [isSoundMenuOpen, setIsSoundMenuOpen] = useState(false);
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
  } as const satisfies Record<NonNullable<PulseXChannel["status"]>, string>;
  const presenceStatus = getChannelPresenceStatus(presenceUsers);
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
      <ParticipantStack users={presenceUsers} />
      <div className="flex items-center gap-1">
        <HeaderAction ariaLabel="Favoritar" icon={<Star size={17} />} />
        <HeaderAction ariaLabel="Buscar" icon={<Search size={17} />} />
        <div className="relative">
          <HeaderAction
            ariaLabel="Som de chamada"
            icon={<Volume2 size={17} />}
            onClick={() => setIsSoundMenuOpen((current) => !current)}
          />
          {isSoundMenuOpen ? (
            <CallSoundMenu
              onChange={(soundId) => {
                onChangeCallSound(soundId);
                onPreviewCallSound(soundId);
              }}
              onPreview={onPreviewCallSound}
              options={callSoundOptions}
              selectedSoundId={selectedCallSoundId}
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
      </div>
    </header>
  );
}

function CallSoundMenu({
  onChange,
  onPreview,
  options,
  selectedSoundId,
}: {
  onChange: (soundId: string) => void;
  onPreview: (soundId: string) => void;
  options: readonly PulseXCallSoundOption[];
  selectedSoundId: string;
}) {
  return (
    <div className="absolute right-0 top-10 z-40 w-64 rounded-lg border border-[#d9e0ea] bg-white p-2 text-xs shadow-xl">
      <div className="px-2 py-1.5">
        <p className="m-0 text-[0.68rem] font-semibold uppercase tracking-wide text-[#667085]">
          Sons da chamada
        </p>
      </div>
      <div className="grid gap-1">
        {options.map((option) => (
          <div
            className="grid grid-cols-[1fr_auto] items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[#f3f6fa]"
            key={option.id}
          >
            <button
              className="min-w-0 text-left font-semibold text-[#101820] outline-none focus-visible:ring-2 focus-visible:ring-[var(--uix-focus-ring)]"
              onClick={() => onChange(option.id)}
              type="button"
            >
              <span className="block truncate">{option.label}</span>
              <span className="mt-0.5 block text-[0.68rem] font-normal text-[#667085]">
                {selectedSoundId === option.id ? "Selecionado" : "Disponivel"}
              </span>
            </button>
            <button
              className="h-7 rounded-md border border-[#cfd8e3] px-2 font-semibold text-[#344054] outline-none transition hover:border-[#A07C3B] hover:text-[#7b5f2d] focus-visible:ring-2 focus-visible:ring-[var(--uix-focus-ring)]"
              onClick={() => onPreview(option.id)}
              type="button"
            >
              Testar
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function getChannelPresenceStatus(
  users: readonly PulseXPresenceUser[],
): NonNullable<PulseXChannel["status"]> {
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
  users: readonly PulseXPresenceUser[];
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

function getPresenceLabel(status: PulseXPresenceUser["status"]) {
  const labels = {
    agenda: "Agenda",
    away: "Ausente",
    busy: "Agenda",
    lunch: "Almoco",
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
