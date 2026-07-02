"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowLeft,
  ChevronUp,
  Loader2,
  MessagesSquare,
  Send,
} from "lucide-react";

import type {
  HermesMessage,
  HermesMessageMention,
  HermesMessageTag,
  HermesPresenceUser,
} from "@/lib/pulsex";
import {
  createHermesMessage,
  listChannelMessages,
  listDirectUsers,
  markHermesChannelRead,
  updateHermesMessageReaction,
  updateHermesMessageTags,
} from "@/lib/pulsex/supabase-data";
import { useAuth } from "@/providers/auth-provider";
import { usePanteonNotifications } from "@/providers/pulsex-notification-provider";
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
import { HermesThreadSheet } from "@/modules/mobile/components/hermes-thread-sheet";
import { MobileAvatar } from "@/modules/mobile/components/mobile-ui";
import {
  dayKey,
  formatClockTime,
  formatDayLabel,
} from "@/modules/mobile/lib/format";
import {
  hermesTagChipClass,
  hermesTagLabel,
} from "@/modules/mobile/lib/hermes-tags";

const INITIAL_LIMIT = 50;
// Janela CRUA por página. A lista principal filtra as respostas (thread), então
// pedimos bastante linha crua para "pular" blocos de respostas e ainda trazer
// mensagens top-level antigas de verdade.
const OLDER_LIMIT = 80;

function messageTime(message: HermesMessage): string {
  return message.createdAt ?? message.timestamp;
}

function mergeMessages(
  current: readonly HermesMessage[],
  incoming: readonly HermesMessage[],
): HermesMessage[] {
  const byId = new Map<string, HermesMessage>();

  current.forEach((message) => byId.set(message.id, message));
  incoming.forEach((message) => byId.set(message.id, message));

  return [...byId.values()].sort((a, b) => {
    const timeA = Date.parse(messageTime(a));
    const timeB = Date.parse(messageTime(b));

    return (Number.isNaN(timeA) ? 0 : timeA) - (Number.isNaN(timeB) ? 0 : timeB);
  });
}

export default function MobileHermesChatPage() {
  const params = useParams<{ channelId: string }>();
  const channelId = decodeURIComponent(params.channelId ?? "");
  const { hubUser } = useAuth();
  const currentUserId = hubUser?.id ?? "";
  const { broadcastHermesMessageEvent, hermesChannels } =
    usePanteonNotifications();

  const channel = useMemo(
    () => hermesChannels.find((item) => item.id === channelId) ?? null,
    [channelId, hermesChannels],
  );
  // Minha última leitura do canal — base pra marcar respostas "novas".
  const channelReadAt = channel?.memberReadAtByUserId?.[currentUserId] ?? null;

  const [messages, setMessages] = useState<HermesMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [actionMessage, setActionMessage] = useState<HermesMessage | null>(null);
  const [threadMessage, setThreadMessage] = useState<HermesMessage | null>(null);
  const [mentionUsers, setMentionUsers] = useState<HermesPresenceUser[]>([]);
  const [mentions, setMentions] = useState<HermesMessageMention[]>([]);
  const [activeMention, setActiveMention] = useState<ActiveMention | null>(null);
  const draftInputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Evita o auto-scroll pro fim quando estamos PREPENDANDO histórico antigo, e
  // guarda a altura anterior para manter a posição de leitura após prepender.
  const prependingRef = useRef(false);
  const prevHeightRef = useRef(0);

  useEffect(() => {
    if (!channelId) {
      return;
    }

    let mounted = true;

    setLoading(true);
    setError("");
    setHasMore(false);
    listChannelMessages(channelId, { limit: INITIAL_LIMIT })
      .then((channelMessages) => {
        if (!mounted) {
          return;
        }

        setMessages(channelMessages);
        // A lista já filtra respostas, então o tamanho do retorno NÃO reflete se
        // há mais antigas. Assumimos que pode haver e deixamos o loadOlder
        // corrigir (para false) quando não vier nada novo.
        setHasMore(channelMessages.length > 0);
        void markHermesChannelRead({ channelId }).catch(() => undefined);
      })
      .catch(() => {
        if (mounted) {
          setError("Nao foi possivel carregar a conversa.");
        }
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    window.dispatchEvent(
      new CustomEvent("careli:hermes:active-channel", {
        detail: { channelId },
      }),
    );

    return () => {
      mounted = false;
      window.dispatchEvent(
        new CustomEvent("careli:hermes:active-channel", {
          detail: { channelId: null },
        }),
      );
    };
  }, [channelId]);

  // Membros pra @menção (1 carga por sessão de chat).
  useEffect(() => {
    let mounted = true;

    listDirectUsers()
      .then((users) => {
        if (mounted) {
          setMentionUsers(users);
        }
      })
      .catch(() => undefined);

    return () => {
      mounted = false;
    };
  }, []);

  // Mensagens ao vivo: o provider global já assina o realtime e reemite cada
  // mensagem via "careli:hermes:message". Aqui só anexamos as do canal aberto —
  // sem criar assinatura/polling novo (consciência de custo).
  useEffect(() => {
    const handleIncoming = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: HermesMessage }>).detail;
      const message = detail?.message;

      if (!message || message.channelId !== channelId) {
        return;
      }

      setMessages((current) => mergeMessages(current, [message]));
    };

    window.addEventListener("careli:hermes:message", handleIncoming);

    return () => {
      window.removeEventListener("careli:hermes:message", handleIncoming);
    };
  }, [channelId]);

  useLayoutEffect(() => {
    const el = scrollRef.current;

    if (!el) {
      return;
    }

    if (prependingRef.current) {
      // Mantém a posição de leitura: o histórico entra ACIMA sem "pular".
      el.scrollTop = el.scrollHeight - prevHeightRef.current;
      prependingRef.current = false;
      return;
    }

    el.scrollTo({ behavior: "smooth", top: el.scrollHeight });
  }, [messages.length]);

  const loadOlder = useCallback(async () => {
    if (loadingOlder || messages.length === 0) {
      return;
    }

    const before = messageTime(messages[0]!);

    setLoadingOlder(true);
    try {
      const older = await listChannelMessages(channelId, {
        before,
        limit: OLDER_LIMIT,
      });

      if (older.length) {
        prevHeightRef.current = scrollRef.current?.scrollHeight ?? 0;
        prependingRef.current = true;
        setMessages((current) => mergeMessages(older, current));
      }

      // Só há mais quando esta página trouxe alguma top-level nova.
      setHasMore(older.length > 0);
    } catch {
      // Silencioso: mantém o que já tem.
    } finally {
      setLoadingOlder(false);
    }
  }, [channelId, loadingOlder, messages]);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const body = draft.replace(/\s+/g, " ").trim();

      if (!body || sending || !currentUserId) {
        return;
      }

      setSending(true);
      setError("");

      try {
        const validMentions = pruneMentions(body, mentions);
        const savedMessage = await createHermesMessage({
          authorUserId: currentUserId,
          body,
          channelId,
          clientMessageId: `mobile-${currentUserId}-${Date.now()}`,
          ...(validMentions.length
            ? {
                mentionUserIds: validMentions.map((mention) => mention.userId),
                mentions: validMentions,
              }
            : {}),
        });

        setMessages((current) => mergeMessages(current, [savedMessage]));
        broadcastHermesMessageEvent(savedMessage);
        setDraft("");
        setMentions([]);
        setActiveMention(null);
      } catch {
        setError("Nao foi possivel enviar a mensagem.");
      } finally {
        setSending(false);
      }
    },
    [broadcastHermesMessageEvent, channelId, currentUserId, draft, sending],
  );

  // Rolou perto do topo → carrega o histórico mais antigo (como no desktop).
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;

    if (el && el.scrollTop <= 120 && hasMore && !loadingOlder) {
      void loadOlder();
    }
  }, [hasMore, loadingOlder, loadOlder]);

  const applyUpdatedMessage = useCallback((updated: HermesMessage | null) => {
    if (updated) {
      setMessages((current) => mergeMessages(current, [updated]));
    }
  }, []);

  const handleReact = useCallback(
    async (emoji: string) => {
      const target = actionMessage;

      setActionMessage(null);

      if (!target) {
        return;
      }

      const updated = await updateHermesMessageReaction({
        emoji,
        messageId: target.id,
      }).catch(() => null);

      applyUpdatedMessage(updated);
    },
    [actionMessage, applyUpdatedMessage],
  );

  const handleToggleTag = useCallback(
    async (tag: HermesMessageTag) => {
      const target = actionMessage;

      if (!target) {
        return;
      }

      const currentTags = target.tags ?? [];
      const nextTags = currentTags.includes(tag)
        ? currentTags.filter((item) => item !== tag)
        : [...currentTags, tag];

      setActionMessage((current) =>
        current && current.id === target.id
          ? { ...current, tags: nextTags }
          : current,
      );

      const updated = await updateHermesMessageTags({
        messageId: target.id,
        tags: nextTags,
      }).catch(() => null);

      applyUpdatedMessage(updated);
    },
    [actionMessage, applyUpdatedMessage],
  );

  const handleReply = useCallback(() => {
    setThreadMessage(actionMessage);
    setActionMessage(null);
  }, [actionMessage]);

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

  return (
    <div className="relative flex h-full flex-col bg-[#e7e0d6]">
      <header className="flex items-center gap-2 border-b border-[#e4e9f0] bg-[#101820] px-2 pb-2.5 pt-[max(0.85rem,env(safe-area-inset-top))] text-white">
        <Link
          aria-label="Voltar"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[#dbe4ef] outline-none transition active:scale-90"
          href="/m/hermes"
        >
          <ArrowLeft aria-hidden="true" size={20} />
        </Link>
        <MobileAvatar
          label={channel?.name ?? "Hermes"}
          size={38}
          url={channel?.avatarUrl}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">
            {channel?.name ?? "Conversa"}
          </span>
          <span className="block truncate text-[0.7rem] text-[#cbd5e1]">
            Hermes
          </span>
        </span>
      </header>

      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3"
        onScroll={handleScroll}
        ref={scrollRef}
      >
        {loading ? (
          <div className="grid h-full place-items-center text-sm text-[#6b778c]">
            <Loader2 aria-hidden="true" className="animate-spin" size={22} />
          </div>
        ) : error ? (
          <div className="grid h-full place-items-center px-8 text-center text-sm text-[#c0392b]">
            {error}
          </div>
        ) : messages.length === 0 ? (
          <div className="grid h-full place-items-center text-sm text-[#6b778c]">
            Sem mensagens recentes.
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {loadingOlder ? (
              <div className="flex justify-center py-1">
                <Loader2
                  aria-hidden="true"
                  className="animate-spin text-[#6b778c]"
                  size={18}
                />
              </div>
            ) : hasMore ? (
              <button
                className="mx-auto mb-1 flex items-center gap-1.5 rounded-full bg-white/85 px-3 py-1.5 text-xs font-medium text-[#526078] outline-none transition active:scale-95"
                onClick={() => {
                  void loadOlder();
                }}
                type="button"
              >
                <ChevronUp aria-hidden="true" size={14} />
                Ver mensagens anteriores
              </button>
            ) : null}

            {messages.map((message, index) => {
              const own = message.authorId === currentUserId;
              const ts = messageTime(message);
              const hasNewReplies = Boolean(
                (message.threadCount ?? 0) > 0 &&
                  channelReadAt &&
                  message.lastThreadReplyAt &&
                  Date.parse(message.lastThreadReplyAt) >
                    Date.parse(channelReadAt),
              );
              const previous = index > 0 ? messages[index - 1] : null;
              const newDay =
                index === 0 || dayKey(ts) !== dayKey(previous ? messageTime(previous) : null);
              const groupStart =
                newDay || !previous || previous.authorId !== message.authorId;

              return (
                <Fragment key={message.id}>
                  {newDay ? (
                    <div className="my-2 flex justify-center">
                      <span className="rounded-full bg-white/85 px-3 py-1 text-[11px] font-medium text-[#6b778c] shadow-sm">
                        {formatDayLabel(ts)}
                      </span>
                    </div>
                  ) : null}

                  <div
                    className={`flex items-end gap-1.5 ${
                      own ? "flex-row-reverse" : ""
                    }`}
                  >
                    {groupStart ? (
                      <MobileAvatar
                        label={
                          own
                            ? (hubUser?.name ?? "Você")
                            : (message.authorName ?? "Hermes")
                        }
                        size={26}
                        url={own ? hubUser?.avatarUrl : message.authorAvatarUrl}
                      />
                    ) : (
                      <span aria-hidden="true" className="w-[26px] shrink-0" />
                    )}

                    <article
                      className={`grid min-w-0 max-w-[82%] cursor-pointer gap-0.5 rounded-2xl px-3 py-2 text-sm shadow-sm ${
                        own
                          ? "rounded-br-md bg-[#dcf8c6] text-[#123524]"
                          : "rounded-bl-md bg-white text-[#17202f]"
                      }`}
                      onClick={() => setActionMessage(message)}
                    >
                      {!own && groupStart ? (
                        <span className="text-[0.7rem] font-semibold text-[#A07C3B]">
                          {message.authorName ?? "Hermes"}
                        </span>
                      ) : null}
                      {message.tags?.length ? (
                        <span className="flex flex-wrap gap-1">
                          {message.tags.map((tag) => (
                            <span
                              className={`rounded px-1.5 py-0.5 text-[0.6rem] font-medium ${hermesTagChipClass(tag)}`}
                              key={tag}
                            >
                              {hermesTagLabel(tag)}
                            </span>
                          ))}
                        </span>
                      ) : null}
                      {message.attachment ? (
                        <HermesAttachment attachment={message.attachment} />
                      ) : null}
                      {message.body ? (
                        <p className="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
                          {message.body}
                        </p>
                      ) : null}
                      {message.reactions?.length ? (
                        <span className="flex flex-wrap gap-1">
                          {message.reactions.map((reaction) => (
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
                        {formatClockTime(ts)}
                      </span>
                      {(message.threadCount ?? 0) > 0 ? (
                        <button
                          className={`mt-0.5 flex items-center gap-1 rounded-md px-2 py-1 text-[0.68rem] font-medium outline-none ${
                            hasNewReplies
                              ? "bg-[#f6ecd7] text-[#8a6d1f]"
                              : "bg-black/5 text-[#3a4657]"
                          }`}
                          onClick={(event) => {
                            event.stopPropagation();
                            setThreadMessage(message);
                          }}
                          type="button"
                        >
                          <MessagesSquare aria-hidden="true" size={12} />
                          {message.threadCount}{" "}
                          {message.threadCount === 1 ? "resposta" : "respostas"}
                          {hasNewReplies ? (
                            <span className="ml-0.5 inline-flex items-center gap-1 font-semibold">
                              · novas
                              <span
                                aria-hidden="true"
                                className="h-1.5 w-1.5 rounded-full bg-[#c0392b]"
                              />
                            </span>
                          ) : null}
                        </button>
                      ) : null}
                    </article>
                  </div>
                </Fragment>
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
        className="flex items-end gap-2 border-t border-[#e4e9f0] bg-white p-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]"
        onSubmit={handleSubmit}
      >
        <textarea
          className="max-h-28 min-h-[2.75rem] flex-1 resize-none rounded-2xl border border-[#d9e0e7] px-3 py-2.5 text-sm text-[#17202f] outline-none transition placeholder:text-[#9aa6b5] focus:border-[#A07C3B]"
          onChange={(event) =>
            handleDraftChange(
              event.target.value,
              event.target.selectionStart ?? event.target.value.length,
            )
          }
          placeholder="Mensagem..."
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

      {actionMessage ? (
        <HermesMessageActions
          message={actionMessage}
          onClose={() => setActionMessage(null)}
          onReact={handleReact}
          onReply={handleReply}
          onToggleTag={handleToggleTag}
        />
      ) : null}

      {threadMessage ? (
        <HermesThreadSheet
          channelId={channelId}
          currentUserId={currentUserId}
          mentionUsers={mentionUsers}
          message={threadMessage}
          onClose={() => setThreadMessage(null)}
          onReplyCreated={() =>
            setMessages((current) =>
              current.map((item) =>
                item.id === threadMessage.id
                  ? { ...item, threadCount: (item.threadCount ?? 0) + 1 }
                  : item,
              ),
            )
          }
        />
      ) : null}
    </div>
  );
}
