"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { ArrowLeft, Loader2, Send } from "lucide-react";

import type {
  HermesMessage,
  HermesMessageMention,
  HermesMessageTag,
  HermesPresenceUser,
  HermesThreadReply,
} from "@/lib/pulsex";
import {
  createHermesThreadReply,
  listHermesThreadReplies,
  updateHermesMessageReaction,
  updateHermesMessageTags,
} from "@/lib/pulsex/supabase-data";
import { HermesAttachment } from "@/modules/mobile/components/hermes-attachment";
import {
  applyMentionToDraft,
  filterMentionOptions,
  getActiveMentionQuery,
  MentionSuggestions,
  pruneMentions,
  type ActiveMention,
} from "@/modules/mobile/components/hermes-mention";
import { HermesMessageActions } from "@/modules/mobile/components/hermes-message-actions";
import { MobileAvatar } from "@/modules/mobile/components/mobile-ui";
import { formatClockTime } from "@/modules/mobile/lib/format";
import {
  hermesTagChipClass,
  hermesTagLabel,
} from "@/modules/mobile/lib/hermes-tags";

// Tela de RESPOSTAS (thread) de uma mensagem — as respostas ficam agrupadas sob
// a mensagem original, com compositor próprio, igual ao painel do desktop.
export function HermesThreadSheet({
  channelId,
  currentUserId,
  mentionUsers = [],
  message,
  onClose,
  onReplyCreated,
}: {
  channelId: string;
  currentUserId: string;
  mentionUsers?: readonly HermesPresenceUser[];
  message: HermesMessage;
  onClose: () => void;
  onReplyCreated: () => void;
}) {
  const [replies, setReplies] = useState<HermesThreadReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [actionReply, setActionReply] = useState<HermesThreadReply | null>(null);
  const [mentions, setMentions] = useState<HermesMessageMention[]>([]);
  const [activeMention, setActiveMention] = useState<ActiveMention | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const draftInputRef = useRef<HTMLTextAreaElement>(null);

  const handleDraftChange = useCallback(
    (value: string, caretIndex: number) => {
      setDraft(value);
      setMentions((current) => pruneMentions(value, current));
      setActiveMention(getActiveMentionQuery(value, caretIndex));
    },
    [],
  );

  const handleSelectMention = useCallback(
    (user: HermesPresenceUser) => {
      if (!activeMention) {
        return;
      }

      const result = applyMentionToDraft({
        active: activeMention,
        draft,
        mentions,
        user,
      });

      setDraft(result.draft);
      setMentions(result.mentions);
      setActiveMention(null);
      window.requestAnimationFrame(() => {
        draftInputRef.current?.focus();
        draftInputRef.current?.setSelectionRange(result.caret, result.caret);
      });
    },
    [activeMention, draft, mentions],
  );

  const mentionOptions = activeMention
    ? filterMentionOptions(mentionUsers, activeMention.query)
    : [];

  const applyReplyUpdate = useCallback(
    (replyId: string, updated: HermesMessage | null) => {
      if (!updated) {
        return;
      }

      setReplies((current) =>
        current.map((item) =>
          item.id === replyId
            ? { ...item, reactions: updated.reactions, tags: updated.tags }
            : item,
        ),
      );
    },
    [],
  );

  const handleReplyReact = useCallback(
    async (emoji: string) => {
      const target = actionReply;

      setActionReply(null);

      if (!target) {
        return;
      }

      const updated = await updateHermesMessageReaction({
        emoji,
        messageId: target.id,
      }).catch(() => null);

      applyReplyUpdate(target.id, updated);
    },
    [actionReply, applyReplyUpdate],
  );

  const handleReplyToggleTag = useCallback(
    async (tag: HermesMessageTag) => {
      const target = actionReply;

      if (!target) {
        return;
      }

      const currentTags = target.tags ?? [];
      const nextTags = currentTags.includes(tag)
        ? currentTags.filter((item) => item !== tag)
        : [...currentTags, tag];

      setActionReply((current) =>
        current && current.id === target.id
          ? { ...current, tags: nextTags }
          : current,
      );

      const updated = await updateHermesMessageTags({
        messageId: target.id,
        tags: nextTags,
      }).catch(() => null);

      applyReplyUpdate(target.id, updated);
    },
    [actionReply, applyReplyUpdate],
  );

  useEffect(() => {
    let mounted = true;

    setLoading(true);
    listHermesThreadReplies({ messageId: message.id })
      .then((result) => {
        if (mounted) {
          setReplies(result);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [message.id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      behavior: "smooth",
      top: scrollRef.current.scrollHeight,
    });
  }, [replies.length]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const body = draft.replace(/\s+/g, " ").trim();

    if (!body || sending || !currentUserId) {
      return;
    }

    setSending(true);
    try {
      const validMentions = pruneMentions(body, mentions);
      const reply = await createHermesThreadReply({
        authorUserId: currentUserId,
        body,
        channelId,
        messageId: message.id,
        ...(validMentions.length
          ? {
              mentionUserIds: validMentions.map((mention) => mention.userId),
              mentions: validMentions,
            }
          : {}),
      });

      setReplies((current) => [...current, reply]);
      setDraft("");
      setMentions([]);
      setActiveMention(null);
      onReplyCreated();
    } catch {
      // Silencioso: mantém o rascunho.
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-[#e7e0d6]">
      <header className="flex items-center gap-2 bg-[#101820] px-2 pb-2.5 pt-[max(0.85rem,env(safe-area-inset-top))] text-white">
        <button
          aria-label="Voltar"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[#dbe4ef] outline-none transition active:scale-90"
          onClick={onClose}
          type="button"
        >
          <ArrowLeft aria-hidden="true" size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="m-0 text-sm font-semibold">Respostas</p>
          <p className="m-0 text-[11px] text-[#9fb0c2]">
            {replies.length} {replies.length === 1 ? "resposta" : "respostas"}
          </p>
        </div>
      </header>

      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3"
        ref={scrollRef}
      >
        <article className="mb-1 grid gap-0.5 rounded-2xl rounded-bl-md bg-white px-3 py-2 text-sm shadow-sm">
          <span className="text-[0.7rem] font-semibold text-[#A07C3B]">
            {message.authorName ?? "Hermes"}
          </span>
          <p className="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
            {message.body}
          </p>
          <span className="justify-self-end text-[0.62rem] text-[#8894a5]">
            {formatClockTime(message.createdAt ?? message.timestamp)}
          </span>
        </article>

        <div className="my-3 flex items-center gap-2 text-[11px] text-[#6b778c]">
          <span className="h-px flex-1 bg-[#d9d2c6]" />
          {replies.length} {replies.length === 1 ? "resposta" : "respostas"}
          <span className="h-px flex-1 bg-[#d9d2c6]" />
        </div>

        {loading ? (
          <div className="grid place-items-center py-6">
            <Loader2
              aria-hidden="true"
              className="animate-spin text-[#6b778c]"
              size={20}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {replies.map((reply) => {
              const own = reply.authorId === currentUserId;

              return (
                <div
                  className={`flex items-end gap-1.5 ${
                    own ? "flex-row-reverse" : ""
                  }`}
                  key={reply.id}
                >
                  {!own ? (
                    <MobileAvatar
                      label={reply.authorName ?? "Hermes"}
                      size={24}
                      url={reply.authorAvatarUrl}
                    />
                  ) : (
                    <span aria-hidden="true" className="w-[24px] shrink-0" />
                  )}
                  <article
                    className={`grid min-w-0 max-w-[82%] cursor-pointer gap-0.5 rounded-2xl px-3 py-2 text-sm shadow-sm ${
                      own
                        ? "rounded-br-md bg-[#dcf8c6] text-[#123524]"
                        : "rounded-bl-md bg-white text-[#17202f]"
                    }`}
                    onClick={() => setActionReply(reply)}
                  >
                    {!own ? (
                      <span className="text-[0.7rem] font-semibold text-[#A07C3B]">
                        {reply.authorName ?? "Hermes"}
                      </span>
                    ) : null}
                    {reply.tags?.length ? (
                      <span className="flex flex-wrap gap-1">
                        {reply.tags.map((tag) => (
                          <span
                            className={`rounded px-1.5 py-0.5 text-[0.6rem] font-medium ${hermesTagChipClass(tag)}`}
                            key={tag}
                          >
                            {hermesTagLabel(tag)}
                          </span>
                        ))}
                      </span>
                    ) : null}
                    {reply.attachment ? (
                      <HermesAttachment attachment={reply.attachment} />
                    ) : null}
                    {reply.body ? (
                      <p className="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
                        {reply.body}
                      </p>
                    ) : null}
                    {reply.reactions?.length ? (
                      <span className="flex flex-wrap gap-1">
                        {reply.reactions.map((reaction) => (
                          <span
                            className="inline-flex items-center gap-0.5 rounded-full bg-black/5 px-1.5 py-0.5 text-[0.68rem]"
                            key={reaction.emoji}
                          >
                            {reaction.emoji} {reaction.count}
                          </span>
                        ))}
                      </span>
                    ) : null}
                    <span className="justify-self-end text-[0.62rem] text-[#8894a5]">
                      {formatClockTime(reply.createdAt ?? reply.timestamp)}
                    </span>
                  </article>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {activeMention ? (
        <MentionSuggestions
          onSelect={handleSelectMention}
          options={mentionOptions}
        />
      ) : null}

      <form
        className="flex items-end gap-2 border-t border-[#d9d2c6] bg-[#f0f2f5] p-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]"
        onSubmit={handleSubmit}
      >
        <textarea
          className="max-h-28 min-h-[2.75rem] flex-1 resize-none rounded-2xl border border-[#d9e0e7] bg-white px-3 py-2.5 text-sm text-[#17202f] outline-none transition placeholder:text-[#9aa6b5] focus:border-[#A07C3B]"
          onChange={(event) =>
            handleDraftChange(
              event.target.value,
              event.target.selectionStart ?? event.target.value.length,
            )
          }
          placeholder="Responder..."
          ref={draftInputRef}
          rows={1}
          value={draft}
        />
        <button
          aria-label="Enviar"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#101820] text-white outline-none transition active:scale-90 disabled:opacity-50"
          disabled={!draft.trim() || sending}
          type="submit"
        >
          {sending ? (
            <Loader2 aria-hidden="true" className="animate-spin" size={18} />
          ) : (
            <Send aria-hidden="true" size={18} />
          )}
        </button>
      </form>

      {actionReply ? (
        <HermesMessageActions
          message={actionReply}
          onClose={() => setActionReply(null)}
          onReact={handleReplyReact}
          onReply={() => setActionReply(null)}
          onToggleTag={handleReplyToggleTag}
          showReply={false}
        />
      ) : null}
    </div>
  );
}
