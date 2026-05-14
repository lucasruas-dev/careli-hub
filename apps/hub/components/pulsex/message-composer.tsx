"use client";

import type {
  FormEvent,
  KeyboardEvent,
  ChangeEvent,
  ReactNode,
} from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  FileText,
  Image as ImageIcon,
  Mic,
  Paperclip,
  Send,
  Smile,
  Square,
  Tag,
  Video,
  X,
} from "lucide-react";
import type {
  PulseXMessageAttachment,
  PulseXMessageMention,
  PulseXMessageTag,
  PulseXPresenceUser,
} from "@/lib/pulsex";
import {
  getPulseXMessageTagClassName,
  pulseXMessageTagOptions,
} from "@/lib/pulsex/message-tags";

type MessageComposerProps = {
  channelName: string;
  mentions: readonly PulseXMessageMention[];
  onChange: (
    value: string,
    mentions: readonly PulseXMessageMention[],
  ) => void;
  onSubmit: (input?: { attachment?: PulseXMessageAttachment }) => void;
  onToggleTag?: (tag: PulseXMessageTag) => void;
  selectedTags?: readonly PulseXMessageTag[];
  users: readonly PulseXPresenceUser[];
  value: string;
};

export function MessageComposer({
  channelName,
  mentions,
  onChange,
  onSubmit,
  onToggleTag,
  selectedTags = [],
  users,
  value,
}: MessageComposerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioStartedAtRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [activeMention, setActiveMention] = useState<{
    end: number;
    query: string;
    start: number;
    trigger: string;
  } | null>(null);
  const [activeOptionIndex, setActiveOptionIndex] = useState(0);
  const [attachment, setAttachment] = useState<PulseXMessageAttachment | null>(
    null,
  );
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const mentionOptions = useMemo(() => {
    if (!activeMention) {
      return [];
    }

    return users
      .filter((user) => matchesMentionQuery(user, activeMention.query))
      .slice(0, 6);
  }, [activeMention, users]);
  const isMentionOpen = Boolean(activeMention && mentionOptions.length > 0);

  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stop();
      stopAudioStream();
    };
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isRecordingAudio) {
      return;
    }

    onSubmit(attachment ? { attachment } : undefined);
    setAttachment(null);
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
      if (!isRecordingAudio) {
        onSubmit(attachment ? { attachment } : undefined);
        setAttachment(null);
      }
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

  async function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    event.target.value = "";

    if (!file) {
      return;
    }

    if (file.size > MAX_ATTACHMENT_BYTES) {
      setMediaError("Arquivo acima de 8 MB.");
      return;
    }

    const nextAttachment = await createAttachmentFromBlob(file, {
      label: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    });

    setAttachment(nextAttachment);
    setMediaError(null);
  }

  async function handleToggleAudioRecording() {
    if (isRecordingAudio) {
      mediaRecorderRef.current?.stop();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setMediaError("Gravacao de audio indisponivel neste navegador.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(stream);

      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      audioStartedAtRef.current = Date.now();
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      });
      recorder.addEventListener("stop", () => {
        const durationSeconds = audioStartedAtRef.current
          ? Math.max(1, Math.round((Date.now() - audioStartedAtRef.current) / 1000))
          : undefined;
        const blob = new Blob(chunks, {
          type: recorder.mimeType || "audio/webm",
        });

        stopAudioStream();
        setIsRecordingAudio(false);
        createAttachmentFromBlob(blob, {
          durationSeconds,
          label: `Audio ${formatAttachmentTime(new Date())}`,
          mimeType: blob.type,
          sizeBytes: blob.size,
          type: "audio",
        })
          .then((nextAttachment) => {
            setAttachment(nextAttachment);
            setMediaError(null);
          })
          .catch(() => setMediaError("Nao foi possivel preparar o audio."));
      });
      recorder.start();
      setIsRecordingAudio(true);
      setMediaError(null);
    } catch {
      stopAudioStream();
      setIsRecordingAudio(false);
      setMediaError("Permita o microfone para gravar audio.");
    }
  }

  function stopAudioStream() {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    mediaRecorderRef.current = null;
    audioStartedAtRef.current = null;
  }

  const isEmpty =
    value.trim().length === 0 && !attachment && !isRecordingAudio;

  return (
    <form
      className="relative flex min-h-16 shrink-0 items-end gap-1.5 border-t border-[#d9e0ea] bg-white px-3 py-2"
      onSubmit={handleSubmit}
    >
      <input
        accept="audio/*,image/*,video/*,.doc,.docx,.pdf,.ppt,.pptx,.xls,.xlsx,.txt"
        className="hidden"
        onChange={handleFileInputChange}
        ref={fileInputRef}
        type="file"
      />
      <ComposerAction ariaLabel="Abrir emojis" icon={<Smile size={18} />} />
      <ComposerAction
        ariaLabel="Anexar arquivo"
        icon={<Paperclip size={18} />}
        onClick={() => fileInputRef.current?.click()}
      />
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
        {attachment || mediaError || isRecordingAudio ? (
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            {attachment ? (
              <AttachmentChip
                attachment={attachment}
                onRemove={() => setAttachment(null)}
              />
            ) : null}
            {isRecordingAudio ? (
              <span className="inline-flex h-7 items-center gap-2 rounded-full border border-red-200 bg-red-50 px-2.5 text-xs font-semibold text-red-700">
                <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
                Gravando audio
              </span>
            ) : null}
            {mediaError ? (
              <span className="text-xs font-medium text-red-600">
                {mediaError}
              </span>
            ) : null}
          </div>
        ) : null}
        <div className="mb-1 flex flex-wrap gap-1.5">
          {pulseXMessageTagOptions.map((tag) => {
            const selected = selectedTags.includes(tag.id);

            return (
              <button
                aria-pressed={selected}
                className={`inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[0.68rem] font-semibold outline-none transition hover:brightness-95 focus-visible:ring-2 focus-visible:ring-[var(--uix-focus-ring)] ${
                  selected
                    ? getPulseXMessageTagClassName(tag.id)
                    : "border-[#d9e0ea] bg-white text-[#667085]"
                }`}
                key={tag.id}
                onClick={() => onToggleTag?.(tag.id)}
                type="button"
              >
                <Tag aria-hidden="true" size={11} />
                {tag.label}
              </button>
            );
          })}
        </div>
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
          rows={mentions.length > 0 || selectedTags.length > 0 ? 2 : 1}
          value={value}
        />
      </div>
      <ComposerAction
        ariaLabel={isRecordingAudio ? "Parar gravacao" : "Gravar audio"}
        active={isRecordingAudio}
        icon={isRecordingAudio ? <Square size={17} /> : <Mic size={18} />}
        onClick={() => {
          void handleToggleAudioRecording();
        }}
      />
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
  active = false,
  ariaLabel,
  icon,
  onClick,
}: {
  active?: boolean;
  ariaLabel: string;
  icon: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      aria-label={ariaLabel}
      aria-pressed={active || undefined}
      className="mb-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-md text-[var(--uix-text-muted)] outline-none transition hover:bg-[#eef2f7] hover:text-[var(--uix-text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--uix-focus-ring)] aria-pressed:bg-red-50 aria-pressed:text-red-600"
      onClick={onClick}
      type="button"
    >
      {icon}
    </button>
  );
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: PulseXMessageAttachment;
  onRemove: () => void;
}) {
  const Icon = getAttachmentIcon(attachment.type);

  return (
    <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-[#d9e0ea] bg-[#f8fafc] px-2.5 py-1 text-xs text-[#485466]">
      <Icon aria-hidden="true" size={14} />
      <span className="truncate font-semibold">{attachment.label}</span>
      {attachment.durationSeconds ? (
        <span className="text-[#667085]">
          {formatAttachmentDuration(attachment.durationSeconds)}
        </span>
      ) : null}
      <button
        aria-label="Remover anexo"
        className="grid h-5 w-5 place-items-center rounded-full text-[#667085] transition hover:bg-[#e6ebf2] hover:text-[#101820]"
        onClick={onRemove}
        type="button"
      >
        <X aria-hidden="true" size={13} />
      </button>
    </span>
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
    agenda: "agenda",
    away: "ausente",
    busy: "agenda",
    lunch: "almoco",
    offline: "offline",
    online: "online",
  } as const satisfies Record<PulseXPresenceUser["status"], string>;

  return labels[status];
}

function getPresenceDotClassName(status: PulseXPresenceUser["status"]) {
  const classNames = {
    agenda: "bg-sky-500",
    away: "bg-red-500",
    busy: "bg-sky-500",
    lunch: "bg-yellow-400",
    offline: "bg-slate-300",
    online: "bg-emerald-500",
  } as const satisfies Record<PulseXPresenceUser["status"], string>;

  return classNames[status];
}

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

async function createAttachmentFromBlob(
  blob: Blob,
  options: {
    durationSeconds?: number;
    label: string;
    mimeType?: string;
    sizeBytes?: number;
    type?: PulseXMessageAttachment["type"];
  },
): Promise<PulseXMessageAttachment> {
  const mimeType = options.mimeType || blob.type || "application/octet-stream";
  const url = await readBlobAsDataUrl(blob);

  return {
    durationSeconds: options.durationSeconds,
    label: options.label,
    mimeType,
    sizeBytes: options.sizeBytes ?? blob.size,
    type: options.type ?? getAttachmentType(mimeType),
    url,
  };
}

function readBlobAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener("load", () => {
      resolve(typeof reader.result === "string" ? reader.result : "");
    });
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(blob);
  });
}

function getAttachmentType(mimeType: string): PulseXMessageAttachment["type"] {
  if (mimeType.startsWith("audio/")) {
    return "audio";
  }

  if (mimeType.startsWith("image/")) {
    return "image";
  }

  if (mimeType.startsWith("video/")) {
    return "video";
  }

  return "file";
}

function getAttachmentIcon(type: PulseXMessageAttachment["type"]) {
  if (type === "audio") {
    return Mic;
  }

  if (type === "image") {
    return ImageIcon;
  }

  if (type === "video") {
    return Video;
  }

  return FileText;
}

function formatAttachmentDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;

  return `${minutes}:${restSeconds.toString().padStart(2, "0")}`;
}

function formatAttachmentTime(value: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(value);
}
