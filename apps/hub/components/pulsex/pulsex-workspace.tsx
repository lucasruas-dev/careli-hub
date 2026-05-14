"use client";

import { pulsexReactionOptions } from "@/lib/pulsex";
import {
  createPulseXMessage,
  createPulseXThreadReply,
  listChannelMessages,
  listPulseXThreadReplies,
  loadPulseXOperationalData,
  markPulseXChannelRead,
  updatePulseXMessageTags,
} from "@/lib/pulsex/supabase-data";
import { hasHubSupabaseConfig } from "@/lib/supabase/client";
import { useAuth } from "@/providers/auth-provider";
import { Bell, X } from "lucide-react";
import type {
  PulseXCallSession,
  PulseXCallType,
  PulseXChannel,
  PulseXDepartment,
  PulseXMessageAttachment,
  PulseXMessageMention,
  PulseXMessageFilter,
  PulseXMessageTag,
  PulseXMessage,
  PulseXPresenceUser,
  PulseXReactionEmoji,
  PulseXThreadReply,
} from "@/lib/pulsex";
import { CallPanel } from "./call-panel";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConversationHeader } from "./conversation-header";
import { ConversationSidebar } from "./conversation-sidebar";
import { IncomingCallBanner } from "./incoming-call-banner";
import { MessageComposer } from "./message-composer";
import { MessageList } from "./message-list";
import { ThreadPanel } from "./thread-panel";

type PulseXToastNotification = {
  channelId: PulseXChannel["id"];
  description: string;
  id: string;
  mentioned: boolean;
  title: string;
};

export function PulseXWorkspace() {
  const { hubUser, profileStatus } = useAuth();
  const currentUserId = hubUser?.id ?? "ana";
  const [activeChannelId, setActiveChannelId] =
    useState<PulseXChannel["id"]>(emptyPulseXChannel.id);
  const [channels, setChannels] = useState<PulseXChannel[]>([]);
  const [departments, setDepartments] = useState<PulseXDepartment[]>([]);
  const [messages, setMessages] = useState<PulseXMessage[]>([]);
  const [presenceUsers, setPresenceUsers] = useState<PulseXPresenceUser[]>([]);
  const [threadReplies, setThreadReplies] = useState<
    Record<string, PulseXThreadReply[]>
  >({});
  const [activeThreadMessageId, setActiveThreadMessageId] = useState<
    PulseXMessage["id"] | null
  >(null);
  const [activeMessageFilter, setActiveMessageFilter] =
    useState<PulseXMessageFilter>("all");
  const [activeCall, setActiveCall] = useState<PulseXCallSession | null>(null);
  const [incomingCall, setIncomingCall] = useState<PulseXCallSession | null>(null);
  const [composerValue, setComposerValue] = useState("");
  const [composerMentions, setComposerMentions] = useState<
    readonly PulseXMessageMention[]
  >([]);
  const [composerTags, setComposerTags] = useState<readonly PulseXMessageTag[]>([]);
  const [threadComposerValue, setThreadComposerValue] = useState("");
  const [dataStatus, setDataStatus] = useState<"fallback" | "loading" | "ready">(
    "loading",
  );
  const knownMessageIdsRef = useRef<Set<string>>(new Set());
  const loadedChannelIdsRef = useRef<Set<string>>(new Set());
  const [notifications, setNotifications] = useState<PulseXToastNotification[]>(
    [],
  );
  const activeChannel =
    channels.find((channel) => channel.id === activeChannelId) ??
    channels[0] ??
    emptyPulseXChannel;
  const activeThreadMessage = activeThreadMessageId
    ? messages.find((message) => message.id === activeThreadMessageId)
    : undefined;
  const activeThreadReplies = activeThreadMessageId
    ? (threadReplies[activeThreadMessageId] ?? [])
    : [];
  const channelMessages = messages.filter(
    (message) => message.channelId === activeChannel.id,
  );
  const filteredChannelMessages =
    activeMessageFilter === "all"
      ? channelMessages
      : activeMessageFilter === "mentions"
        ? channelMessages.filter((message) =>
            isMessageMentioningUser(message, currentUserId),
          )
        : channelMessages.filter((message) =>
            message.tags?.includes(activeMessageFilter),
          );
  const channelPresenceUsers = useMemo(
    () => {
      const channelUsers = presenceUsers.filter((user) =>
        (user.channelIds as readonly string[]).includes(activeChannel.id),
      );
      const knownUserIds = new Set(channelUsers.map((user) => user.id));
      const messageAuthorUsers: PulseXPresenceUser[] = [];

      for (const message of channelMessages) {
        if (knownUserIds.has(message.authorId)) {
          continue;
        }

        knownUserIds.add(message.authorId);
        messageAuthorUsers.push(
          createPresenceUserFromMessage(message, activeChannel.id),
        );
      }

      return [...channelUsers, ...messageAuthorUsers];
    },
    [activeChannel.id, channelMessages, presenceUsers],
  );

  const loadOperationalData = useCallback(() => {
    if (profileStatus === "loading") {
      setDataStatus("loading");
      return;
    }

    let isMounted = true;

    setDataStatus("loading");
    loadPulseXOperationalData({
      currentUserId,
      userRole: hubUser?.role,
    })
      .then((payload) => {
        if (!isMounted) {
          return;
        }

        const nextChannels = withDirectUserChannels(
          payload.channels,
          payload.users,
          currentUserId,
        );
        const nextPresenceUsers = withUserChannelAccess(
          payload.users,
          nextChannels,
          currentUserId,
        );

        const nextMessages = withMessageDeliveryData(
          payload.messages,
          nextChannels,
        );

        nextMessages.forEach((message) =>
          knownMessageIdsRef.current.add(message.id),
        );
        nextMessages.forEach((message) =>
          loadedChannelIdsRef.current.add(message.channelId),
        );

        setChannels(nextChannels);
        setDepartments(payload.departments);
        setMessages(nextMessages);
        setPresenceUsers(nextPresenceUsers);
        setActiveChannelId((currentId) =>
          nextChannels.some((channel) => channel.id === currentId)
            ? currentId
            : nextChannels[0]?.id ?? emptyPulseXChannel.id,
        );
        setDataStatus(hasHubSupabaseConfig() ? "ready" : "fallback");
      })
      .catch((error: unknown) => {
        if (isLocalDevelopmentRuntime()) {
          console.warn("[pulsex] load workspace error", error);
        }

        if (!isMounted) {
          return;
        }

        setDataStatus("fallback");
      });

    return () => {
      isMounted = false;
    };
  }, [currentUserId, hubUser?.role, profileStatus]);

  useEffect(() => loadOperationalData(), [loadOperationalData]);

  const notifyIncomingMessages = useCallback(
    (newMessages: readonly PulseXMessage[]) => {
      if (newMessages.length === 0) {
        return;
      }

      playPulseXNotificationSound();

      newMessages.forEach((message) => {
        const mentioned = isMessageMentioningUser(message, currentUserId);
        const title = mentioned
          ? "Voce foi mencionado no PulseX"
          : `Nova mensagem em ${activeChannel.name}`;
        const description = `${message.authorName ?? "PulseX"}: ${message.body}`;
        const notification = {
          channelId: message.channelId,
          description,
          id: `notification-${message.id}-${Date.now()}`,
          mentioned,
          title,
        } satisfies PulseXToastNotification;

        setNotifications((currentNotifications) =>
          [notification, ...currentNotifications].slice(0, 4),
        );
        window.setTimeout(() => {
          setNotifications((currentNotifications) =>
            currentNotifications.filter((item) => item.id !== notification.id),
          );
        }, 6_000);
        showBrowserPulseXNotification({
          body: description,
          title,
        });
      });
    },
    [activeChannel.name, currentUserId],
  );

  const loadActiveChannelMessages = useCallback(
    (shouldApply: () => boolean = () => true) => {
      if (
        !hasHubSupabaseConfig() ||
        activeChannel.kind === "direct" ||
        activeChannel.id === emptyPulseXChannel.id
      ) {
        return;
      }

      listChannelMessages(activeChannel.id)
        .then((nextMessages) => {
          if (!shouldApply()) {
            return;
          }

          const nextDeliveredMessages = withMessageDeliveryData(
            nextMessages,
            channels,
          );
          const isFirstChannelLoad = !loadedChannelIdsRef.current.has(
            activeChannel.id,
          );
          const newMessages = nextDeliveredMessages.filter(
            (message) => !knownMessageIdsRef.current.has(message.id),
          );

          nextDeliveredMessages.forEach((message) =>
            knownMessageIdsRef.current.add(message.id),
          );
          loadedChannelIdsRef.current.add(activeChannel.id);

          if (!isFirstChannelLoad) {
            notifyIncomingMessages(
              newMessages.filter((message) => message.authorId !== currentUserId),
            );
          }

          setMessages((currentMessages) => [
            ...currentMessages.filter(
              (message) => message.channelId !== activeChannel.id,
            ),
            ...nextDeliveredMessages,
          ]);
        })
        .catch((error: unknown) => {
          if (isLocalDevelopmentRuntime()) {
            console.warn("[pulsex] list channel messages error", error);
        }
      });
    },
    [
      activeChannel.id,
      activeChannel.kind,
      channels,
      currentUserId,
      notifyIncomingMessages,
    ],
  );

  useEffect(() => {
    if (
      !hasHubSupabaseConfig() ||
      activeChannel.kind === "direct" ||
      activeChannel.id === emptyPulseXChannel.id
    ) {
      return;
    }

    let isMounted = true;

    loadActiveChannelMessages(() => isMounted);
    const intervalId = window.setInterval(() => {
      loadActiveChannelMessages(() => isMounted);
    }, 8_000);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [activeChannel.id, activeChannel.kind, loadActiveChannelMessages]);

  useEffect(() => {
    if (
      !hasHubSupabaseConfig() ||
      activeChannel.kind === "direct" ||
      activeChannel.id === emptyPulseXChannel.id
    ) {
      return;
    }

    let isMounted = true;

    markPulseXChannelRead({ channelId: activeChannel.id })
      .then((receipt) => {
        if (!isMounted || !receipt) {
          return;
        }

        setChannels((currentChannels) =>
          currentChannels.map((channel) =>
            channel.id === receipt.channelId
              ? {
                  ...channel,
                  memberReadAtByUserId: {
                    ...(channel.memberReadAtByUserId ?? {}),
                    [receipt.userId]: receipt.lastReadAt,
                  },
                }
              : channel,
          ),
        );
        setMessages((currentMessages) =>
          currentMessages.map((message) =>
            message.channelId === receipt.channelId
              ? {
                  ...message,
                  readBy: [
                    ...new Set([...(message.readBy ?? []), receipt.userId]),
                  ],
                }
              : message,
          ),
        );
      })
      .catch((error: unknown) => {
        if (isLocalDevelopmentRuntime()) {
          console.warn("[pulsex] mark channel read error", error);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [activeChannel.id, activeChannel.kind]);

  const loadThreadReplies = useCallback((messageId: PulseXMessage["id"]) => {
    if (!hasHubSupabaseConfig() || messageId.startsWith("local-")) {
      return;
    }

    listPulseXThreadReplies({ messageId })
      .then((nextReplies) => {
        setThreadReplies((currentReplies) => ({
          ...currentReplies,
          [messageId]: nextReplies,
        }));
        setMessages((currentMessages) =>
          currentMessages.map((message) =>
            message.id === messageId
              ? {
                  ...message,
                  threadCount: nextReplies.length,
                }
              : message,
          ),
        );
      })
      .catch((error: unknown) => {
        if (isLocalDevelopmentRuntime()) {
          console.warn("[pulsex] list thread replies error", error);
        }
      });
  }, []);

  useEffect(() => {
    if (!activeThreadMessageId) {
      return;
    }

    loadThreadReplies(activeThreadMessageId);
    const intervalId = window.setInterval(() => {
      loadThreadReplies(activeThreadMessageId);
    }, 8_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeThreadMessageId, loadThreadReplies]);

  function handleSelectChannel(channelId: PulseXChannel["id"]) {
    setActiveChannelId(channelId);
    setActiveThreadMessageId(null);
    setThreadComposerValue("");
    if (hasHubSupabaseConfig()) {
      setMessages([]);
    }
    setChannels((currentChannels) =>
      currentChannels.map((channel) =>
        channel.id === channelId ? { ...channel, unreadCount: 0 } : channel,
      ),
    );
  }

  function handleOpenThread(messageId: PulseXMessage["id"]) {
    setActiveThreadMessageId(messageId);
    loadThreadReplies(messageId);
  }

  function handleStartCall(type: PulseXCallType) {
    setActiveCall(
      createLocalCallSession({
        channel: activeChannel,
        currentUserId,
        fallbackUsers: presenceUsers,
        participants: channelPresenceUsers,
        type,
      }),
    );
    setIncomingCall(null);
  }

  function handleAcceptIncomingCall() {
    if (!incomingCall) {
      return;
    }

    setActiveCall({
      ...incomingCall,
      durationLabel: "00:03",
      status: "active",
    });
    setIncomingCall(null);
  }

  async function handleSendMessage(input?: {
    attachment?: PulseXMessageAttachment;
  }) {
    const body = composerValue.trim();
    const attachment = input?.attachment;
    const mentions = composerMentions.filter((mention) =>
      body.includes(mention.displayName),
    );
    const tags = [...composerTags];
    const currentPresenceUser = presenceUsers.find(
      (user) => user.id === currentUserId,
    );

    if (!body && !attachment) {
      return;
    }

    const timestamp = new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date());
    const createdAt = new Date().toISOString();
    const deliveredTo = getMessageRecipientUserIds({
      channel: activeChannel,
      messageAuthorId: currentUserId,
    });

    const localMessage = {
      authorAvatarUrl: currentPresenceUser?.avatarUrl,
      authorId: currentUserId,
      authorName: currentPresenceUser?.label ?? hubUser?.name,
      attachment,
      body: body || attachment?.label || "Anexo",
      channelId: activeChannel.id,
      createdAt,
      deliveredTo,
      id: `local-${activeChannel.id}-${Date.now()}`,
      mentionUserIds: mentions.map((mention) => mention.userId),
      mentions,
      readBy: [],
      reactions: [],
      status: "neutral",
      tags,
      threadCount: 0,
      timestamp,
    } satisfies PulseXMessage;

    knownMessageIdsRef.current.add(localMessage.id);
    setMessages((currentMessages) => [...currentMessages, localMessage]);
    setChannels((currentChannels) =>
      currentChannels.map((channel) =>
        channel.id === activeChannel.id
          ? {
              ...channel,
              lastMessageAt: timestamp,
              preview: body || attachment?.label || "Anexo",
              unreadCount: 0,
            }
          : channel,
      ),
    );
    setComposerValue("");
    setComposerMentions([]);
    setComposerTags([]);

    if (!hasHubSupabaseConfig() || activeChannel.kind === "direct") {
      return;
    }

    try {
      const savedMessage = await createPulseXMessage({
        authorUserId: hubUser?.id,
        attachment,
        body: body || attachment?.label || "Anexo",
        channelId: activeChannel.id,
        mentionUserIds: mentions.map((mention) => mention.userId),
        mentions,
        tags,
      });

      knownMessageIdsRef.current.add(savedMessage.id);
      setMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.id === localMessage.id
            ? {
                ...savedMessage,
                deliveredTo,
                readBy: [],
              }
            : message,
        ),
      );
    } catch (error) {
      if (isLocalDevelopmentRuntime()) {
        console.warn("[pulsex] send message error", error);
      }
      setMessages((currentMessages) =>
        currentMessages.filter((message) => message.id !== localMessage.id),
      );
      setComposerValue(body);
      setComposerMentions(mentions);
      setComposerTags(tags);
      setDataStatus("fallback");
    }
  }

  function handleComposerChange(
    value: string,
    mentions: readonly PulseXMessageMention[],
  ) {
    setComposerValue(value);
    setComposerMentions(mentions);
  }

  function handleToggleComposerTag(tag: PulseXMessageTag) {
    setComposerTags((currentTags) =>
      currentTags.includes(tag)
        ? currentTags.filter((currentTag) => currentTag !== tag)
        : [...currentTags, tag],
    );
  }

  function handleToggleMessageTag(
    messageId: PulseXMessage["id"],
    tag: PulseXMessageTag,
  ) {
    const currentMessage = messages.find((message) => message.id === messageId);
    const currentTags = currentMessage?.tags ?? [];
    const nextTags = currentTags.includes(tag)
      ? currentTags.filter((currentTag) => currentTag !== tag)
      : [...currentTags, tag];

    setMessages((currentMessages) =>
      currentMessages.map((message) =>
        message.id === messageId ? { ...message, tags: nextTags } : message,
      ),
    );

    if (!hasHubSupabaseConfig() || messageId.startsWith("local-")) {
      return;
    }

    updatePulseXMessageTags({
      messageId,
      tags: nextTags,
    })
      .then((savedMessage) => {
        if (!savedMessage) {
          return;
        }

        setMessages((currentMessages) =>
          currentMessages.map((message) =>
            message.id === messageId ? savedMessage : message,
          ),
        );
      })
      .catch((error: unknown) => {
        if (isLocalDevelopmentRuntime()) {
          console.warn("[pulsex] update message tags error", error);
        }
      });
  }

  function handleToggleReaction(
    messageId: PulseXMessage["id"],
    emoji: PulseXReactionEmoji,
  ) {
    setMessages((currentMessages) =>
      currentMessages.map((message) => {
        if (message.id !== messageId) {
          return message;
        }

        const reactions = [...(message.reactions ?? [])];
        const reactionIndex = reactions.findIndex(
          (reaction) => reaction.emoji === emoji,
        );

        if (reactionIndex < 0) {
          return {
            ...message,
            reactions: [
              ...reactions,
              {
                count: 1,
                emoji,
                reactedByUserIds: [currentUserId],
              },
            ],
          };
        }

        const reaction = reactions[reactionIndex];

        if (!reaction) {
          return message;
        }

        const hasReacted = reaction.reactedByUserIds.includes(currentUserId);
        const reactedByUserIds = hasReacted
          ? reaction.reactedByUserIds.filter((userId) => userId !== currentUserId)
          : [...reaction.reactedByUserIds, currentUserId];
        const count = hasReacted ? reaction.count - 1 : reaction.count + 1;

        if (count <= 0) {
          reactions.splice(reactionIndex, 1);
        } else {
          reactions[reactionIndex] = {
            ...reaction,
            count,
            reactedByUserIds,
          };
        }

        return {
          ...message,
          reactions,
        };
      }),
    );
  }

  function handleSubmitThreadReply() {
    const body = threadComposerValue.trim();

    if (!body || !activeThreadMessage) {
      return;
    }

    const timestamp = new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date());
    const currentPresenceUser = presenceUsers.find(
      (user) => user.id === currentUserId,
    );
    const localReply = {
      authorAvatarUrl: currentPresenceUser?.avatarUrl,
      authorId: currentUserId,
      authorName: currentPresenceUser?.label ?? hubUser?.name,
      body,
      createdAt: new Date().toISOString(),
      id: `reply-${activeThreadMessage.id}-${Date.now()}`,
      messageId: activeThreadMessage.id,
      timestamp,
    } satisfies PulseXThreadReply;

    setThreadReplies((currentReplies) => {
      const messageReplies = currentReplies[activeThreadMessage.id] ?? [];

      return {
        ...currentReplies,
        [activeThreadMessage.id]: [
          ...messageReplies,
          localReply,
        ],
      };
    });
    setMessages((currentMessages) =>
      currentMessages.map((message) =>
        message.id === activeThreadMessage.id
          ? {
              ...message,
              lastThreadReplyAt: timestamp,
              threadCount: (message.threadCount ?? 0) + 1,
            }
          : message,
      ),
    );
    setThreadComposerValue("");

    if (!hasHubSupabaseConfig() || activeThreadMessage.id.startsWith("local-")) {
      return;
    }

    createPulseXThreadReply({
      authorUserId: hubUser?.id,
      body,
      channelId: activeThreadMessage.channelId,
      messageId: activeThreadMessage.id,
    })
      .then((savedReply) => {
        setThreadReplies((currentReplies) => ({
          ...currentReplies,
          [activeThreadMessage.id]: (
            currentReplies[activeThreadMessage.id] ?? []
          ).map((reply) => (reply.id === localReply.id ? savedReply : reply)),
        }));
        loadThreadReplies(activeThreadMessage.id);
      })
      .catch((error: unknown) => {
        if (isLocalDevelopmentRuntime()) {
          console.warn("[pulsex] create thread reply error", error);
        }
        setThreadReplies((currentReplies) => ({
          ...currentReplies,
          [activeThreadMessage.id]: (
            currentReplies[activeThreadMessage.id] ?? []
          ).filter((reply) => reply.id !== localReply.id),
        }));
        setThreadComposerValue(body);
      });
  }

  return (
    <div className="grid h-full min-h-0 overflow-hidden bg-[#f3f6fa] [grid-template-columns:21.5rem_minmax(40rem,1fr)]">
      <ConversationSidebar
        activeChannelId={activeChannel.id}
        activeMessageFilter={activeMessageFilter}
        channels={channels}
        currentUserId={currentUserId}
        dataStatus={dataStatus}
        departments={departments}
        users={presenceUsers}
        messages={messages}
        onSelectMessageFilter={setActiveMessageFilter}
        onSelectChannel={handleSelectChannel}
        onRefresh={() => {
          loadOperationalData();
        }}
      />
      <main className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[#f3f6fa]">
        <ConversationHeader
          channel={activeChannel}
          onStartCall={handleStartCall}
          presenceUsers={channelPresenceUsers}
        />
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-[#f3f6fa] py-4">
          {incomingCall?.channelId === activeChannel.id ? (
            <IncomingCallBanner
              onAccept={handleAcceptIncomingCall}
              onDecline={() => setIncomingCall(null)}
              session={incomingCall}
            />
          ) : null}
          <MessageList
            currentUserId={currentUserId}
            filter={activeMessageFilter}
            messages={filteredChannelMessages}
            onOpenThread={handleOpenThread}
            onToggleTag={handleToggleMessageTag}
            users={presenceUsers}
          />
        </div>
        <MessageComposer
          channelName={activeChannel.name}
          mentions={composerMentions}
          onChange={handleComposerChange}
          onSubmit={handleSendMessage}
          onToggleTag={handleToggleComposerTag}
          selectedTags={composerTags}
          users={presenceUsers}
          value={composerValue}
        />
        {activeCall ? (
          <CallPanel
            onClose={() => setActiveCall(null)}
            onEnd={() => setActiveCall(null)}
            session={activeCall}
          />
        ) : null}
        <PulseXNotificationStack
          notifications={notifications}
          onDismiss={(notificationId) =>
            setNotifications((currentNotifications) =>
              currentNotifications.filter(
                (notification) => notification.id !== notificationId,
              ),
            )
          }
          onSelect={(channelId) => handleSelectChannel(channelId)}
        />
        {activeThreadMessage ? (
          <div className="absolute inset-y-0 right-0 z-10 w-[23rem] shadow-2xl">
            <ThreadPanel
              currentUserId={currentUserId}
              message={activeThreadMessage}
              onChangeReply={setThreadComposerValue}
              onClose={() => {
                setActiveThreadMessageId(null);
                setThreadComposerValue("");
              }}
              onSubmitReply={handleSubmitThreadReply}
              onToggleReaction={handleToggleReaction}
              reactionOptions={pulsexReactionOptions}
              replies={activeThreadReplies}
              replyValue={threadComposerValue}
              users={presenceUsers}
            />
          </div>
        ) : null}
      </main>
    </div>
  );
}

function withDirectUserChannels(
  channels: readonly PulseXChannel[],
  users: readonly PulseXPresenceUser[],
  currentUserId: PulseXPresenceUser["id"],
): PulseXChannel[] {
  const existingChannelIds = new Set(channels.map((channel) => channel.id));
  const directChannels = users
    .filter((user) => user.id !== currentUserId)
    .map((user) => ({
      avatar: user.initials,
      context: {
        filesCount: 0,
        owner: user.label,
        status: "Direta",
        unit: user.role,
      },
      description: `Conversa direta com ${user.label}.`,
      id: `direct-${user.id}`,
      kind: "direct",
      lastMessageAt: "-",
      name: user.label,
      preview: user.email ?? "Usuario do Hub",
      status: user.status,
    })) satisfies PulseXChannel[];

  return [
    ...channels,
    ...directChannels.filter((channel) => !existingChannelIds.has(channel.id)),
  ];
}

function PulseXNotificationStack({
  notifications,
  onDismiss,
  onSelect,
}: {
  notifications: readonly PulseXToastNotification[];
  onDismiss: (notificationId: PulseXToastNotification["id"]) => void;
  onSelect: (channelId: PulseXChannel["id"]) => void;
}) {
  if (notifications.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute right-4 top-20 z-30 grid w-80 gap-2">
      {notifications.map((notification) => (
        <article
          className={`pointer-events-auto rounded-md border bg-white p-3 shadow-xl ${
            notification.mentioned
              ? "border-[#A07C3B]/45"
              : "border-[#d9e0ea]"
          }`}
          key={notification.id}
        >
          <div className="flex items-start gap-3">
            <span
              className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md text-white ${
                notification.mentioned ? "bg-[#A07C3B]" : "bg-[#101820]"
              }`}
            >
              <Bell aria-hidden="true" size={15} />
            </span>
            <button
              className="min-w-0 flex-1 text-left outline-none"
              onClick={() => onSelect(notification.channelId)}
              type="button"
            >
              <p className="m-0 truncate text-sm font-semibold text-[#101820]">
                {notification.title}
              </p>
              <p className="m-0 mt-1 line-clamp-2 text-xs leading-5 text-[#667085]">
                {notification.description}
              </p>
            </button>
            <button
              aria-label="Fechar notificacao"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[#667085] transition hover:bg-[#eef2f7] hover:text-[#101820]"
              onClick={() => onDismiss(notification.id)}
              type="button"
            >
              <X aria-hidden="true" size={14} />
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function isLocalDevelopmentRuntime() {
  return ["localhost", "127.0.0.1"].includes(window.location.hostname);
}

function withMessageDeliveryData(
  messages: readonly PulseXMessage[],
  channels: readonly PulseXChannel[],
) {
  const channelsById = new Map(
    channels.map((channel) => [channel.id, channel] as const),
  );

  return messages.map((message) => {
    const channel = channelsById.get(message.channelId);

    if (!channel) {
      return message;
    }

    return {
      ...message,
      deliveredTo: getMessageRecipientUserIds({
        channel,
        messageAuthorId: message.authorId,
      }),
      readBy: getMessageReadUserIds(message, channel),
    };
  });
}

function getMessageRecipientUserIds({
  channel,
  messageAuthorId,
}: {
  channel: PulseXChannel;
  messageAuthorId: PulseXPresenceUser["id"];
}) {
  return (channel.memberUserIds ?? []).filter((userId) => userId !== messageAuthorId);
}

function getMessageReadUserIds(
  message: PulseXMessage,
  channel: PulseXChannel,
) {
  if (!message.createdAt) {
    return message.readBy ?? [];
  }

  const messageCreatedAt = Date.parse(message.createdAt);

  if (Number.isNaN(messageCreatedAt)) {
    return message.readBy ?? [];
  }

  return Object.entries(channel.memberReadAtByUserId ?? {})
    .filter(([userId]) => userId !== message.authorId)
    .filter(([, lastReadAt]) => {
      const lastReadTime = Date.parse(lastReadAt);

      return !Number.isNaN(lastReadTime) && lastReadTime >= messageCreatedAt;
    })
    .map(([userId]) => userId);
}

function createPresenceUserFromMessage(
  message: PulseXMessage,
  channelId: PulseXChannel["id"],
): PulseXPresenceUser {
  const label = message.authorName ?? "Usuario";

  return {
    avatarUrl: message.authorAvatarUrl,
    channelIds: [channelId],
    email: undefined,
    id: message.authorId,
    initials: getInitials(label),
    label,
    role: "Participante",
    status: "offline",
    username: label,
  };
}

function withUserChannelAccess(
  users: readonly PulseXPresenceUser[],
  channels: readonly PulseXChannel[],
  currentUserId: PulseXPresenceUser["id"],
): PulseXPresenceUser[] {
  return users.map((user) => {
    const memberDepartmentIds = getDepartmentIdsFromChannelMembership({
      channels,
      userId: user.id,
    });

    return {
      ...user,
      channelIds: channels
        .filter((channel) => {
          if (channel.kind === "direct") {
            return user.id === currentUserId || channel.id === `direct-${user.id}`;
          }

          return (
            channel.memberUserIds?.includes(user.id) ||
            Boolean(
              channel.accessType === "department_channel" &&
                channel.departmentId &&
                memberDepartmentIds.has(channel.departmentId),
            )
          );
        })
        .map((channel) => channel.id),
    };
  });
}

function getDepartmentIdsFromChannelMembership({
  channels,
  userId,
}: {
  channels: readonly PulseXChannel[];
  userId: PulseXPresenceUser["id"];
}) {
  const departmentIds = new Set<string>();

  for (const channel of channels) {
    if (
      channel.departmentId &&
      channel.accessType !== "department_channel" &&
      channel.memberUserIds?.includes(userId)
    ) {
      departmentIds.add(channel.departmentId);
    }
  }

  return departmentIds;
}

function getInitials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function isMessageMentioningUser(
  message: PulseXMessage,
  userId: PulseXPresenceUser["id"],
) {
  return (
    message.authorId !== userId &&
    Boolean(message.mentionUserIds?.includes(userId))
  );
}

function playPulseXNotificationSound() {
  try {
    const AudioContextConstructor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;

    if (!AudioContextConstructor) {
      return;
    }

    const audioContext = new AudioContextConstructor();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(740, audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(
      520,
      audioContext.currentTime + 0.16,
    );
    gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.09, audioContext.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      audioContext.currentTime + 0.2,
    );
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.22);
  } catch {
    // Browser can block audio before the user interacts with the page.
  }
}

function showBrowserPulseXNotification({
  body,
  title,
}: {
  body: string;
  title: string;
}) {
  if (!("Notification" in window)) {
    return;
  }

  if (Notification.permission === "granted") {
    new Notification(title, { body });
    return;
  }

  if (Notification.permission === "default") {
    Notification.requestPermission().then((permission) => {
      if (permission === "granted") {
        new Notification(title, { body });
      }
    });
  }
}

const emptyPulseXChannel = {
  avatar: "--",
  context: {
    filesCount: 0,
    owner: "PulseX",
    status: "Aguardando setup",
    unit: "Hub",
  },
  description: "Nenhum canal operacional configurado.",
  id: "empty-pulsex",
  accessType: "private_group",
  kind: "system",
  lastMessageAt: "-",
  memberReadAtByUserId: {},
  memberUserIds: [],
  name: "Sem canal",
  preview: "Configure canais no Setup Central.",
  status: "offline",
} satisfies PulseXChannel;

function createLocalCallSession({
  channel,
  currentUserId,
  fallbackUsers,
  participants,
  type,
}: {
  channel: PulseXChannel;
  currentUserId: PulseXPresenceUser["id"];
  fallbackUsers: readonly PulseXPresenceUser[];
  participants: readonly PulseXPresenceUser[];
  type: PulseXCallType;
}): PulseXCallSession {
  const fallbackCurrentUser = fallbackUsers.find(
    (user) => user.id === currentUserId,
  );
  const callUsers =
    fallbackCurrentUser && !participants.some((user) => user.id === currentUserId)
      ? [fallbackCurrentUser, ...participants]
      : participants.length > 0
        ? participants
        : fallbackCurrentUser
          ? [fallbackCurrentUser]
          : [];

  return {
    channelId: channel.id,
    durationLabel: "00:00",
    id: `local-call-${channel.id}-${Date.now()}`,
    initiatedByUserId: currentUserId,
    participants: callUsers.map((user) => ({
      id: `local-call-participant-${user.id}`,
      initials: user.initials,
      isCameraOn: type === "video" && user.id === currentUserId,
      isMuted: false,
      label: user.label,
      presenceStatus: user.status,
      role: user.role,
      status: user.id === currentUserId ? "joined" : "invited",
      userId: user.id,
    })),
    startedAt: "agora",
    status: "active",
    title: channel.name,
    type,
  };
}
