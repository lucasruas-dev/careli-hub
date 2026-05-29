"use client";

import type {
  ClipboardEvent,
  ChangeEvent,
  FormEvent,
  KeyboardEvent,
  ReactNode,
} from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FileText,
  Image as ImageIcon,
  Mic,
  Paperclip,
  Plus,
  Send,
  Smile,
  Square,
  Sticker,
  Tag,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { useOutsideDismiss } from "@/hooks/use-outside-dismiss";
import type {
  HermesMessageAttachment,
  HermesMessageMention,
  HermesMessageTag,
  HermesPresenceUser,
} from "@/lib/pulsex";
import {
  getHermesMessageTagClassName,
  hermesMessageTagOptions,
} from "@/lib/pulsex/message-tags";

type MessageComposerProps = {
  channelName: string;
  currentUserId?: HermesPresenceUser["id"];
  mentions: readonly HermesMessageMention[];
  onChange: (
    value: string,
    mentions: readonly HermesMessageMention[],
  ) => void;
  onSubmit: (input?: { attachment?: HermesMessageAttachment }) => void;
  onToggleTag?: (tag: HermesMessageTag) => void;
  selectedTags?: readonly HermesMessageTag[];
  users: readonly HermesPresenceUser[];
  value: string;
};

export function MessageComposer({
  channelName,
  currentUserId,
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
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const stickerPickerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [activeMention, setActiveMention] = useState<{
    end: number;
    query: string;
    start: number;
    trigger: string;
  } | null>(null);
  const [activeOptionIndex, setActiveOptionIndex] = useState(0);
  const [attachment, setAttachment] = useState<HermesMessageAttachment | null>(
    null,
  );
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [isStickerPickerOpen, setIsStickerPickerOpen] = useState(false);
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

  useOutsideDismiss({
    enabled: isEmojiPickerOpen,
    onDismiss: () => setIsEmojiPickerOpen(false),
    ref: emojiPickerRef,
  });
  useOutsideDismiss({
    enabled: isStickerPickerOpen,
    onDismiss: () => setIsStickerPickerOpen(false),
    ref: stickerPickerRef,
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isRecordingAudio) {
      return;
    }

    onSubmit(attachment ? { attachment } : undefined);
    setAttachment(null);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      if (isMentionOpen || isEmojiPickerOpen || isStickerPickerOpen) {
        event.preventDefault();
        closeMentionMenu();
        setIsEmojiPickerOpen(false);
        setIsStickerPickerOpen(false);
      }
      return;
    }

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

  function selectMention(user: HermesPresenceUser | undefined) {
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
    } satisfies HermesMessageMention;
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

  function removeMention(userId: HermesPresenceUser["id"]) {
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

  function insertTextAtCaret(insertedText: string) {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? value.length;
    const nextValue = `${value.slice(0, start)}${insertedText}${value.slice(end)}`;
    const nextCaretIndex = start + insertedText.length;
    const nextMentions = mentions.filter((mention) =>
      nextValue.includes(mention.displayName),
    );

    onChange(nextValue, nextMentions);
    updateActiveMention(nextValue, nextCaretIndex);
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCaretIndex, nextCaretIndex);
    });
  }

  function handleSelectEmoji(emoji: string) {
    insertTextAtCaret(emoji);
    setIsEmojiPickerOpen(false);
  }

  function handleSelectSticker(sticker: ComposerStickerOption) {
    onSubmit({
      attachment: {
        emoji: sticker.emoji,
        label: sticker.label,
        mimeType: sticker.mimeType,
        sizeBytes: sticker.sizeBytes,
        stickerId: sticker.id,
        type: "sticker",
        url: sticker.url,
      },
    });
    setAttachment(null);
    setIsStickerPickerOpen(false);
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

  async function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const imageFile = getClipboardImageFile(event.clipboardData);

    if (!imageFile) {
      return;
    }

    event.preventDefault();

    if (imageFile.size > MAX_ATTACHMENT_BYTES) {
      setMediaError("Imagem acima de 8 MB.");
      return;
    }

    const nextAttachment = await createAttachmentFromBlob(imageFile, {
      label: `Print ${formatAttachmentTime(new Date())}.${getImageExtension(imageFile.type)}`,
      mimeType: imageFile.type,
      sizeBytes: imageFile.size,
      type: "image",
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
      <div className="relative" ref={emojiPickerRef}>
        <ComposerAction
          active={isEmojiPickerOpen}
          ariaLabel="Abrir emojis"
          icon={<Smile size={18} />}
          onClick={() => {
            setIsEmojiPickerOpen((currentValue) => !currentValue);
            setIsStickerPickerOpen(false);
          }}
        />
        {isEmojiPickerOpen ? (
          <EmojiPicker onSelect={handleSelectEmoji} />
        ) : null}
      </div>
      <div className="relative" ref={stickerPickerRef}>
        <ComposerAction
          active={isStickerPickerOpen}
          ariaLabel="Abrir figurinhas"
          icon={<Sticker size={18} />}
          onClick={() => {
            setIsStickerPickerOpen((currentValue) => !currentValue);
            setIsEmojiPickerOpen(false);
          }}
        />
        {isStickerPickerOpen ? (
          <StickerPicker
            currentUserId={currentUserId}
            onSelect={handleSelectSticker}
          />
        ) : null}
      </div>
      <ComposerAction
        ariaLabel="Anexar arquivo"
        icon={<Paperclip size={18} />}
        onClick={() => fileInputRef.current?.click()}
      />
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
          {hermesMessageTagOptions.map((tag) => {
            const selected = selectedTags.includes(tag.id);

            return (
              <button
                aria-pressed={selected}
                className={`inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[0.68rem] font-semibold outline-none transition hover:brightness-95 focus-visible:ring-2 focus-visible:ring-[var(--uix-focus-ring)] ${
                  selected
                    ? getHermesMessageTagClassName(tag.id)
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
          onPaste={handlePaste}
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

function EmojiPicker({
  onSelect,
}: {
  onSelect: (emoji: string) => void;
}) {
  return (
    <div className="absolute bottom-full left-0 z-40 mb-2 max-h-80 w-80 overflow-auto rounded-md border border-[#d9e0ea] bg-white p-2 shadow-xl">
      <div className="grid grid-cols-8 gap-1">
        {composerEmojiOptions.map((emoji) => (
          <button
            aria-label={`Inserir ${emoji}`}
            className="grid h-9 w-9 place-items-center rounded-md text-[1.35rem] outline-none transition hover:bg-[#f4f6f8] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
            key={emoji}
            onClick={() => onSelect(emoji)}
            type="button"
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}

function StickerPicker({
  currentUserId,
  onSelect,
}: {
  currentUserId?: HermesPresenceUser["id"];
  onSelect: (sticker: ComposerStickerOption) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const storageKey = getStickerStorageKey(currentUserId);
  const [activeTab, setActiveTab] = useState<"default" | "saved">("saved");
  const [savedStickers, setSavedStickers] = useState<ComposerStickerOption[]>([]);
  const [stickerError, setStickerError] = useState<string | null>(null);

  useEffect(() => {
    setSavedStickers(loadSavedStickers(storageKey));
    setStickerError(null);
  }, [storageKey]);

  async function handleStickerInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    event.target.value = "";

    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      setStickerError("Selecione uma imagem.");
      return;
    }

    if (file.size > MAX_STICKER_BYTES) {
      setStickerError("Figurinha acima de 512 KB.");
      return;
    }

    try {
      const nextSticker = {
        id: `saved-${Date.now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,
        label: getStickerLabel(file.name),
        mimeType: file.type,
        sizeBytes: file.size,
        url: await readBlobAsDataUrl(file),
      } satisfies ComposerStickerOption;
      const nextStickers = [nextSticker, ...savedStickers]
        .filter(
          (sticker, index, allStickers) =>
            allStickers.findIndex((item) => item.url === sticker.url) === index,
        )
        .slice(0, MAX_SAVED_STICKERS);

      if (!saveStickers(storageKey, nextStickers)) {
        setStickerError("Espaco local insuficiente para salvar.");
        return;
      }

      setSavedStickers(nextStickers);
      setActiveTab("saved");
      setStickerError(null);
    } catch {
      setStickerError("Nao foi possivel salvar a figurinha.");
    }
  }

  function handleDeleteSticker(stickerId: string) {
    const nextStickers = savedStickers.filter((sticker) => sticker.id !== stickerId);

    setSavedStickers(nextStickers);
    saveStickers(storageKey, nextStickers);
  }

  const stickers =
    activeTab === "saved" ? savedStickers : [...composerStickerOptions];

  return (
    <div className="absolute bottom-full left-0 z-40 mb-2 w-[22rem] rounded-xl border border-[#d9e0ea] bg-white p-2 shadow-xl">
      <input
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={handleStickerInputChange}
        ref={fileInputRef}
        type="file"
      />
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-xs font-semibold uppercase text-[#667085]">
          Figurinhas
        </span>
        <button
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#d9e0ea] bg-[#f8fafc] px-2 text-xs font-semibold text-[#344054] outline-none transition hover:border-[#A07C3B] hover:text-[#7b5f2d] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
          onClick={() => fileInputRef.current?.click()}
          type="button"
        >
          <Plus aria-hidden="true" size={14} />
          Salvar
        </button>
      </div>
      <div className="mb-2 grid grid-cols-2 rounded-lg bg-[#f3f6fa] p-1">
        <button
          aria-pressed={activeTab === "saved"}
          className="h-8 rounded-md text-xs font-semibold text-[#667085] outline-none transition hover:text-[#101820] focus-visible:ring-2 focus-visible:ring-[#A07C3B] aria-pressed:bg-white aria-pressed:text-[#101820] aria-pressed:shadow-sm"
          onClick={() => setActiveTab("saved")}
          type="button"
        >
          Minhas
        </button>
        <button
          aria-pressed={activeTab === "default"}
          className="h-8 rounded-md text-xs font-semibold text-[#667085] outline-none transition hover:text-[#101820] focus-visible:ring-2 focus-visible:ring-[#A07C3B] aria-pressed:bg-white aria-pressed:text-[#101820] aria-pressed:shadow-sm"
          onClick={() => setActiveTab("default")}
          type="button"
        >
          Padrao
        </button>
      </div>
      {stickerError ? (
        <p className="m-0 mb-2 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs font-medium text-red-700">
          {stickerError}
        </p>
      ) : null}
      {stickers.length > 0 ? (
        <div className="grid max-h-80 grid-cols-3 gap-2 overflow-y-auto pr-1">
          {stickers.map((sticker) => (
            <div className="relative" key={sticker.id}>
              <button
                aria-label={`Enviar figurinha ${sticker.label}`}
                className="grid min-h-24 w-full justify-items-center gap-1 rounded-xl border border-[#d9e0ea] bg-[#f8fafc] px-2 py-3 text-center outline-none transition hover:-translate-y-0.5 hover:border-[#A07C3B]/60 hover:bg-[#fffaf0] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                onClick={() => onSelect(sticker)}
                type="button"
              >
                <StickerArtwork sticker={sticker} />
                <span className="max-w-full truncate text-[0.68rem] font-semibold text-[#344054]">
                  {sticker.label}
                </span>
              </button>
              {activeTab === "saved" ? (
                <button
                  aria-label={`Remover figurinha ${sticker.label}`}
                  className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full border border-[#d9e0ea] bg-white text-[#667085] shadow-sm outline-none transition hover:border-red-200 hover:text-red-600 focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                  onClick={() => handleDeleteSticker(sticker.id)}
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={12} />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="grid min-h-36 place-items-center rounded-xl border border-dashed border-[#cfd8e3] bg-[#f8fafc] px-4 text-center">
          <div>
            <p className="m-0 text-sm font-semibold text-[#344054]">
              Nenhuma figurinha salva
            </p>
            <p className="m-0 mt-1 text-xs leading-5 text-[#667085]">
              Salve imagens pequenas para enviar como figurinha.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function StickerArtwork({ sticker }: { sticker: ComposerStickerOption }) {
  if (sticker.url) {
    return (
      <span
        aria-hidden="true"
        className="block h-14 w-14 bg-contain bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${sticker.url})` }}
      />
    );
  }

  return (
    <span className="text-4xl leading-none" aria-hidden="true">
      {sticker.emoji}
    </span>
  );
}

function MentionAutocomplete({
  activeIndex,
  onSelect,
  users,
}: {
  activeIndex: number;
  onSelect: (user: HermesPresenceUser) => void;
  users: readonly HermesPresenceUser[];
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
  attachment: HermesMessageAttachment;
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

function matchesMentionQuery(user: HermesPresenceUser, query: string) {
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

function getPresenceLabel(status: HermesPresenceUser["status"]) {
  const labels = {
    agenda: "agenda",
    away: "ausente",
    busy: "agenda",
    lunch: "almoco",
    offline: "offline",
    online: "online",
  } as const satisfies Record<HermesPresenceUser["status"], string>;

  return labels[status];
}

function getPresenceDotClassName(status: HermesPresenceUser["status"]) {
  const classNames = {
    agenda: "bg-sky-500",
    away: "bg-red-500",
    busy: "bg-sky-500",
    lunch: "bg-yellow-400",
    offline: "bg-slate-300",
    online: "bg-emerald-500",
  } as const satisfies Record<HermesPresenceUser["status"], string>;

  return classNames[status];
}

type ComposerStickerOption = {
  emoji?: string;
  id: string;
  label: string;
  mimeType?: string;
  sizeBytes?: number;
  url?: string;
};

const composerStickerOptions = [
  {
    emoji: "\u2705",
    id: "fechado",
    label: "Fechado",
  },
  {
    emoji: "\u{1F44D}",
    id: "top",
    label: "Top",
  },
  {
    emoji: "\u{1F64F}",
    id: "obrigado",
    label: "Obrigado",
  },
  {
    emoji: "\u{1F440}",
    id: "analisando",
    label: "Analisando",
  },
  {
    emoji: "\u{1F6A8}",
    id: "urgente",
    label: "Urgente",
  },
  {
    emoji: "\u2600\uFE0F",
    id: "sol",
    label: "Sol",
  },
] as const satisfies readonly ComposerStickerOption[];

const HERMES_STICKER_STORAGE_KEY_PREFIX = "panteon:hermes:stickers";
const MAX_SAVED_STICKERS = 24;
const MAX_STICKER_BYTES = 512 * 1024;

const composerEmojiOptions = [
  "😀",
  "😃",
  "😄",
  "😁",
  "😆",
  "😅",
  "😂",
  "🤣",
  "😊",
  "😇",
  "🙂",
  "🙃",
  "😉",
  "😍",
  "🥰",
  "😘",
  "😗",
  "😙",
  "😚",
  "😋",
  "😛",
  "😝",
  "😜",
  "🤪",
  "🤨",
  "🧐",
  "🤓",
  "😎",
  "🥳",
  "😏",
  "😒",
  "😞",
  "😔",
  "😟",
  "😕",
  "🙁",
  "☹️",
  "😣",
  "😖",
  "😫",
  "😩",
  "🥺",
  "😢",
  "😭",
  "😤",
  "😠",
  "😡",
  "🤯",
  "😳",
  "🥵",
  "🥶",
  "😱",
  "😨",
  "😰",
  "😥",
  "😓",
  "🤗",
  "🤔",
  "🤭",
  "🤫",
  "🤥",
  "😶",
  "😐",
  "😑",
  "😬",
  "🙄",
  "😯",
  "😦",
  "😧",
  "😮",
  "😲",
  "🥱",
  "😴",
  "🤤",
  "😪",
  "🤐",
  "🥴",
  "🤢",
  "🤮",
  "🤧",
  "😷",
  "🤒",
  "🤕",
  "🤝",
  "👏",
  "🙌",
  "🫶",
  "👍",
  "👎",
  "🙏",
  "💪",
  "👌",
  "✌️",
  "🤞",
  "👀",
  "✅",
  "⚠️",
  "🚨",
  "🔥",
  "🚀",
  "📌",
  "📝",
  "📎",
  "📅",
  "⏰",
  "💬",
  "💡",
  "🎯",
  "🏁",
  "⭐",
  "☀️",
  "🌞",
  "❤️",
  "💙",
  "🟢",
  "🟡",
  "🔴",
  "⚫",
] as const;

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

function getStickerStorageKey(currentUserId?: HermesPresenceUser["id"]) {
  return `${HERMES_STICKER_STORAGE_KEY_PREFIX}:${currentUserId ?? "anonimo"}`;
}

function getStickerStorage() {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function loadSavedStickers(storageKey: string): ComposerStickerOption[] {
  try {
    const storage = getStickerStorage();
    const storedValue = storage?.getItem(storageKey);
    const parsedValue = storedValue ? JSON.parse(storedValue) : [];

    if (!Array.isArray(parsedValue)) {
      return [];
    }

    return parsedValue
      .map((item) => normalizeSavedSticker(item))
      .filter((item): item is ComposerStickerOption => Boolean(item))
      .slice(0, MAX_SAVED_STICKERS);
  } catch {
    return [];
  }
}

function saveStickers(
  storageKey: string,
  stickers: readonly ComposerStickerOption[],
) {
  try {
    const storage = getStickerStorage();

    if (!storage) {
      return false;
    }

    storage.setItem(
      storageKey,
      JSON.stringify(stickers.slice(0, MAX_SAVED_STICKERS)),
    );
    return true;
  } catch {
    return false;
  }
}

function normalizeSavedSticker(value: unknown): ComposerStickerOption | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const input = value as Partial<ComposerStickerOption>;
  const id = typeof input.id === "string" ? input.id : "";
  const label = typeof input.label === "string" ? input.label : "";
  const url = typeof input.url === "string" ? input.url : "";

  if (!id || !label || !url.startsWith("data:image/")) {
    return null;
  }

  return {
    id,
    label,
    mimeType: typeof input.mimeType === "string" ? input.mimeType : undefined,
    sizeBytes:
      typeof input.sizeBytes === "number" && Number.isFinite(input.sizeBytes)
        ? input.sizeBytes
        : undefined,
    url,
  };
}

function getStickerLabel(fileName: string) {
  const fallbackLabel = "Figurinha";
  const [name] = fileName.split(".");
  const label = (name || fallbackLabel)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return label ? label.slice(0, 28) : fallbackLabel;
}

async function createAttachmentFromBlob(
  blob: Blob,
  options: {
    durationSeconds?: number;
    label: string;
    mimeType?: string;
    sizeBytes?: number;
    type?: HermesMessageAttachment["type"];
  },
): Promise<HermesMessageAttachment> {
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

function getAttachmentType(mimeType: string): HermesMessageAttachment["type"] {
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

function getAttachmentIcon(type: HermesMessageAttachment["type"]) {
  if (type === "audio") {
    return Mic;
  }

  if (type === "image") {
    return ImageIcon;
  }

  if (type === "sticker") {
    return Sticker;
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

function getClipboardImageFile(clipboardData: DataTransfer) {
  const fileFromFiles = Array.from(clipboardData.files).find((file) =>
    file.type.startsWith("image/"),
  );

  if (fileFromFiles) {
    return fileFromFiles;
  }

  const imageItem = Array.from(clipboardData.items).find((item) =>
    item.type.startsWith("image/"),
  );

  return imageItem?.getAsFile() ?? null;
}

function getImageExtension(mimeType: string) {
  const normalizedType = mimeType.toLowerCase();

  if (normalizedType.includes("jpeg") || normalizedType.includes("jpg")) {
    return "jpg";
  }

  if (normalizedType.includes("webp")) {
    return "webp";
  }

  if (normalizedType.includes("gif")) {
    return "gif";
  }

  return "png";
}
