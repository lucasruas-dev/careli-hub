"use client";

import type {
  FormEvent,
  KeyboardEvent,
  ChangeEvent,
  ReactNode,
} from "react";
import { useMemo, useRef, useState } from "react";
import {
  Bot,
  Mic,
  Paperclip,
  Send,
  Smile,
} from "lucide-react";
import type {
  PulseXMessageMention,
  PulseXPresenceUser,
} from "@/lib/pulsex";

type MessageComposerProps = {
  channelName: string;
  mentions: readonly PulseXMessageMention[];
  onChange: (
    value: string,
    mentions: readonly PulseXMessageMention[],
  ) => void;
  onSubmit: () => void;
  users: readonly PulseXPresenceUser[];
  value: string;
};

export function MessageComposer({
  channelName,
  mentions,
  onChange,
  onSubmit,
  users,
  value,
}: MessageComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [activeMention, setActiveMention] = useState<{
    end: number;
    query: string;
    start: number;
    trigger: string;
  } | null>(null);
  const [activeOptionIndex, setActiveOptionIndex] = useState(0);
  const mentionOptions = useMemo(() => {
    if (!activeMention) {
      return [];
    }

    return users
      .filter((user) => matchesMentionQuery(user, activeMention.query))
      .slice(0, 6);
  }, [activeMention, users]);
  const isMentionOpen = Boolean(activeMention && mentionOptions.length > 0);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (isMentionOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveOptionIndex((currentIndex) =>
          currentIndex >= mentionOptions.length - 1 ? 0 : currentIndex + 1,
        );
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveOptionIndex((currentIndex) =>
          currentIndex <= 0 ? mentionOptions.length - 1 : currentIndex - 1,
        );
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        selectMention(mentionOptions[activeOptionIndex]);
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        closeMentionMenu();
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSubmit();
    }
  }

  function handleValueChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const nextValue = event.target.value;
    const nextCaretIndex = event.target.selectionStart;
    const nextMentions = mentions.filter((mention) =>
      nextValue.includes(mention.displayName),
    );

    onChange(nextValue, nextMentions);
    updateActiveMention(nextValue, nextCaretIndex);
  }

  function selectMention(user: PulseXPresenceUser | undefined) {
    if (!user || !activeMention) {
      return;
    }

    const insertedText = `${user.label} `;
    const nextValue = `${value.slice(0, activeMention.start)}${insertedText}${value.slice(activeMention.end)}`;
    const nextCaretIndex = activeMention.start + insertedText.length;
    const nextMention = {
      displayName: user.label,
      trigger: activeMention.trigger,
      userId: user.id,
    } satisfies PulseXMessageMention;
    const nextMentions = [
      ...mentions.filter((mention) => mention.userId !== user.id),
      nextMention,
    ];

    onChange(nextValue, nextMentions);
    closeMentionMenu();
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCaretIndex, nextCaretIndex);
    });
  }

  function removeMention(userId: PulseXPresenceUser["id"]) {
    const mention = mentions.find((currentMention) => currentMention.userId === userId);

    if (!mention) {
      return;
    }

    onChange(
      value.replace(mention.displayName, "").replace(/\s{2,}/g, " ").trimStart(),
      mentions.filter((currentMention) => currentMention.userId !== userId),
    );
  }

  function updateActiveMention(nextValue: string, caretIndex: number) {
    const mentionMatch = getActiveMentionQuery(nextValue, caretIndex);

    setActiveMention(mentionMatch);
    setActiveOptionIndex(0);
  }

  function closeMentionMenu() {
    setActiveMention(null);
    setActiveOptionIndex(0);
  }

  const isEmpty = value.trim().length === 0;

  return (
    <form
      className="relative flex min-h-16 items-end gap-1.5 border-t border-[#d9e0ea] bg-white px-3 py-2"
      onSubmit={handleSubmit}
    >
      <ComposerAction ariaLabel="Abrir emojis" icon={<Smile size={18} />} />
      <ComposerAction ariaLabel="Anexar arquivo" icon={<Paperclip size={18} />} />
      <ComposerAction ariaLabel="Acionar IA" icon={<Bot size={18} />} />
      <div className="relative flex-1">
        {isMentionOpen ? (
          <MentionAutocomplete
            activeIndex={activeOptionIndex}
            onSelect={selectMention}
            users={mentionOptions}
          />
        ) : null}
        {mentions.length > 0 ? (
          <div className="mb-1 flex flex-wrap gap-1.5">
            {mentions.map((mention) => (
              <button
                className="rounded px-1.5 py-0.5 text-xs font-semibold text-[#7b5f2d] outline-none transition hover:bg-[#A07C3B]/10 focus-visible:ring-2 focus-visible:ring-[var(--uix-focus-ring)]"
                key={`${mention.userId}-${mention.displayName}`}
                onClick={() => removeMention(mention.userId)}
                type="button"
              >
                {mention.displayName}
              </button>
            ))}
          </div>
        ) : null}
        <textarea
          aria-autocomplete="list"
          aria-controls={isMentionOpen ? "pulsex-mention-listbox" : undefined}
          aria-expanded={isMentionOpen}
          aria-label={`Mensagem para ${channelName}`}
          className="max-h-28 min-h-10 w-full resize-none rounded-md border border-[#d9e0ea] bg-[#f8fafc] px-3 py-2.5 text-sm leading-5 text-[var(--uix-text-primary)] outline-none transition placeholder:text-[var(--uix-text-muted)] focus:border-[#A07C3B] focus:bg-white"
          onBlur={() => window.setTimeout(closeMentionMenu, 120)}
          onChange={handleValueChange}
          onKeyDown={handleKeyDown}
          onSelect={(event) =>
            updateActiveMention(
              event.currentTarget.value,
              event.currentTarget.selectionStart,
            )
          }
          placeholder={`Mensagem para ${channelName}`}
          ref={textareaRef}
          rows={mentions.length > 0 ? 2 : 1}
          value={value}
        />
      </div>
      <ComposerAction ariaLabel="Gravar audio" icon={<Mic size={18} />} />
      <button
        aria-label="Enviar mensagem"
        className="mb-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-md bg-[#A07C3B] text-white outline-none transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[var(--uix-focus-ring)] disabled:cursor-not-allowed disabled:bg-[#e6ebf2] disabled:text-[#8b98aa]"
        disabled={isEmpty}
        type="submit"
      >
        <Send aria-hidden="true" size={18} />
      </button>
    </form>
  );
}

function MentionAutocomplete({
  activeIndex,
  onSelect,
  users,
}: {
  activeIndex: number;
  onSelect: (user: PulseXPresenceUser) => void;
  users: readonly PulseXPresenceUser[];
}) {
  return (
    <div
      className="absolute bottom-full left-0 z-30 mb-2 w-80 overflow-hidden rounded-md border border-[#d9e0ea] bg-white shadow-xl"
      id="pulsex-mention-listbox"
      role="listbox"
    >
      {users.map((user, index) => (
        <button
          aria-selected={index === activeIndex}
          className="grid w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 text-left outline-none transition hover:bg-[#f3f6fa] data-[active=true]:bg-[#f7f3eb]"
          data-active={index === activeIndex}
          key={user.id}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSelect(user)}
          role="option"
          type="button"
        >
          <span className="grid h-8 w-8 place-items-center rounded-md bg-[#101820] text-xs font-semibold text-white">
            {user.initials}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-[#121722]">
              {user.label}
            </span>
            <span className="block truncate text-xs text-[#667085]">
              {user.role} · {getPresenceLabel(user.status)}
            </span>
          </span>
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-full ${getPresenceDotClassName(user.status)}`}
          />
        </button>
      ))}
    </div>
  );
}

function ComposerAction({
  ariaLabel,
  icon,
}: {
  ariaLabel: string;
  icon: ReactNode;
}) {
  return (
    <button
      aria-label={ariaLabel}
      className="mb-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-md text-[var(--uix-text-muted)] outline-none transition hover:bg-[#eef2f7] hover:text-[var(--uix-text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--uix-focus-ring)]"
      type="button"
    >
      {icon}
    </button>
  );
}

function getActiveMentionQuery(value: string, caretIndex: number) {
  const beforeCaret = value.slice(0, caretIndex);
  const match = beforeCaret.match(/(^|\s)@([^\s@]*)$/);

  if (!match || typeof match.index !== "number") {
    return null;
  }

  const prefix = match[1] ?? "";
  const query = match[2] ?? "";
  const triggerStart = match.index + prefix.length;

  return {
    end: caretIndex,
    query,
    start: triggerStart,
    trigger: `@${query}`,
  };
}

function matchesMentionQuery(user: PulseXPresenceUser, query: string) {
  const normalizedQuery = normalizeSearchValue(query);
  const searchValues = [
    user.label,
    ...user.label.split(" "),
    user.email,
    user.username,
  ];

  if (!normalizedQuery) {
    return true;
  }

  return searchValues.some((value) =>
    normalizeSearchValue(value ?? "").includes(normalizedQuery),
  );
}

function normalizeSearchValue(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function getPresenceLabel(status: PulseXPresenceUser["status"]) {
  const labels = {
    away: "ausente",
    busy: "ocupado",
    offline: "offline",
    online: "online",
  } as const satisfies Record<PulseXPresenceUser["status"], string>;

  return labels[status];
}

function getPresenceDotClassName(status: PulseXPresenceUser["status"]) {
  const classNames = {
    away: "bg-amber-400",
    busy: "bg-rose-500",
    offline: "bg-slate-300",
    online: "bg-emerald-500",
  } as const satisfies Record<PulseXPresenceUser["status"], string>;

  return classNames[status];
}
