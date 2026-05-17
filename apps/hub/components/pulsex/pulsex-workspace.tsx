"use client";

import { listHubPresence } from "@/lib/hub-presence";
import { pulsexReactionOptions } from "@/lib/pulsex";
import {
  createPulseXMessage,
  createPulseXThreadReply,
  listChannelMessages,
  listPulseXThreadReplies,
  loadPulseXOperationalData,
  markPulseXChannelRead,
  updatePulseXMessageBody,
  updatePulseXMessageTags,
} from "@/lib/pulsex/supabase-data";
import {
  getHubSupabaseClient,
  hasHubSupabaseConfig,
  logSupabaseDiagnostic,
} from "@/lib/supabase/client";
import { useAuth } from "@/providers/auth-provider";
import { usePulseXCall } from "@/providers/pulsex-call-provider";
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConversationHeader } from "./conversation-header";
import { ConversationSidebar } from "./conversation-sidebar";
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

const PULSEX_PRESENCE_REFRESH_MS = 5_000;
const PULSEX_MESSAGE_REFRESH_MS = 4_000;
const PULSEX_MESSAGE_BROADCAST_EVENT = "message-created";

type HubSupabaseClient = NonNullable<ReturnType<typeof getHubSupabaseClient>>;
type HubRealtimeChannel = ReturnType<HubSupabaseClient["channel"]>;

export function PulseXWorkspace() {
  const { hubUser, profileStatus } = useAuth();
  const {
    callSoundId,
    callSoundOptions,
    previewCallSound,
    setCallSoundId,
    startCall,
  } = usePulseXCall();
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
  const messageRealtimeChannelRef = useRef<HubRealtimeChannel | null>(null);
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

  const refreshPresenceStatuses = useCallback(
    (shouldApply: () => boolean = () => true) => {
      if (!hasHubSupabaseConfig()) {
        return;
      }

      listHubPresence()
        .then((presenceByUserId) => {
          if (!shouldApply()) {
            return;
          }

          setPresenceUsers((currentUsers) =>
            applyPresenceStatusesToUsers(currentUsers, presenceByUserId),
          );
          setChannels((currentChannels) =>
            applyPresenceStatusesToDirectChannels(
              currentChannels,
              presenceByUserId,
            ),
          );
        })
        .catch((error: unknown) => {
          if (isLocalDevelopmentRuntime()) {
            console.warn("[pulsex] refresh presence error", error);
          }
        });
    },
    [],
  );

  useEffect(() => {
    if (!hasHubSupabaseConfig() || dataStatus !== "ready") {
      return;
    }

    let isMounted = true;

    refreshPresenceStatuses(() => isMounted);
    const intervalId = window.setInterval(() => {
      refreshPresenceStatuses(() => isMounted);
    }, PULSEX_PRESENCE_REFRESH_MS);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [dataStatus, refreshPresenceStatuses]);

  const notifyIncomingMessages = useCallback(
    (newMessages: readonly PulseXMessage[]) => {
      if (newMessages.length === 0) {
        return;
      }

      playPulseXMessageSound();

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

          setMessages((currentMessages) =>
            mergePulseXChannelMessages({
              channelId: activeChannel.id,
              currentMessages,
              nextMessages: nextDeliveredMessages,
              replaceChannel: true,
            }),
          );
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
    }, PULSEX_MESSAGE_REFRESH_MS);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [activeChannel.id, activeChannel.kind, loadActiveChannelMessages]);

  useEffect(() => {
    if (
      !hasHubSupabaseConfig() ||
      dataStatus !== "ready" ||
      activeChannel.kind === "direct" ||
      activeChannel.id === emptyPulseXChannel.id
    ) {
      return;
    }

    const client = getHubSupabaseClient();

    if (!client) {
      return;
    }

    const realtimeChannel = client.channel(
      getPulseXMessageRealtimeTopic(activeChannel.id),
      {
        config: {
          broadcast: {
            ack: true,
            self: false,
          },
        },
      },
    );

    messageRealtimeChannelRef.current = realtimeChannel;
    realtimeChannel
      .on(
        "broadcast",
        {
          event: PULSEX_MESSAGE_BROADCAST_EVENT,
        },
        (payload: { payload?: unknown }) => {
          const broadcastMessage = parsePulseXMessageBroadcastPayload(
            payload.payload,
          );

          if (
            !broadcastMessage ||
            broadcastMessage.channelId !== activeChannel.id
          ) {
            return;
          }

          const [nextDeliveredMessage] = withMessageDeliveryData(
            [broadcastMessage],
            channels,
          );

          if (!nextDeliveredMessage) {
            return;
          }

          knownMessageIdsRef.current.add(nextDeliveredMessage.id);
          loadedChannelIdsRef.current.add(nextDeliveredMessage.channelId);
          setMessages((currentMessages) =>
            mergePulseXChannelMessages({
              channelId: activeChannel.id,
              currentMessages,
              nextMessages: [nextDeliveredMessage],
              replaceChannel: false,
            }),
          );

          if (nextDeliveredMessage.authorId !== currentUserId) {
            notifyIncomingMessages([nextDeliveredMessage]);
          }
        },
      )
      .subscribe((status) => {
        logSupabaseDiagnostic("pulsex", "message realtime status", {
          channelId: activeChannel.id,
          status,
        });
      });

    return () => {
      if (messageRealtimeChannelRef.current === realtimeChannel) {
        messageRealtimeChannelRef.current = null;
      }

      void client.removeChannel(realtimeChannel);
    };
  }, [
    activeChannel.id,
    activeChannel.kind,
    channels,
    currentUserId,
    dataStatus,
    notifyIncomingMessages,
  ]);

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
    const session = createLocalCallSession({
      channel: activeChannel,
      currentUserId,
      fallbackUsers: presenceUsers,
      participants: channelPresenceUsers,
      type,
    });
    const targetUserIds = session.participants
      .map((participant) => participant.userId)
      .filter(
        (userId): userId is PulseXPresenceUser["id"] =>
          Boolean(userId) && userId !== currentUserId,
      );

    startCall({ session, targetUserIds });
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
    const clientMessageId = `client-${activeChannel.id}-${Date.now().toString(
      36,
    )}-${Math.random().toString(36).slice(2, 8)}`;
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
      clientMessageId,
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
        clientMessageId,
        mentionUserIds: mentions.map((mention) => mention.userId),
        mentions,
        tags,
      });

      knownMessageIdsRef.current.add(savedMessage.id);
      const savedDeliveredMessage = {
        ...savedMessage,
        deliveredTo,
        readBy: [],
      };

      setMessages((currentMessages) =>
        mergePulseXChannelMessages({
          channelId: activeChannel.id,
          currentMessages,
          nextMessages: [savedDeliveredMessage],
          replaceChannel: false,
        }),
      );
      void broadcastPulseXMessage(
        savedDeliveredMessage,
        messageRealtimeChannelRef.current,
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

  async function handleEditMessage(
    messageId: PulseXMessage["id"],
    body: string,
  ) {
    const nextBody = body.trim();
    const previousMessage = messages.find((message) => message.id === messageId);

    if (!previousMessage || !nextBody || previousMessage.body === nextBody) {
      return;
    }

    const editedAt = new Date().toISOString();
    const optimisticMessage = {
      ...previousMessage,
      body: nextBody,
      editedAt,
    } satisfies PulseXMessage;

    setMessages((currentMessages) =>
      currentMessages.map((message) =>
        message.id === messageId ? optimisticMessage : message,
      ),
    );

    if (!hasHubSupabaseConfig() || messageId.startsWith("local-")) {
      return;
    }

    try {
      const savedMessage = await updatePulseXMessageBody({
        body: nextBody,
        messageId,
      });

      if (!savedMessage) {
        throw new Error("Mensagem nao atualizada.");
      }

      setMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.id === messageId
            ? {
                ...savedMessage,
                deliveredTo: message.deliveredTo,
                readBy: message.readBy,
              }
            : message,
        ),
      );
    } catch (error: unknown) {
      setMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.id === messageId ? previousMessage : message,
        ),
      );

      if (isLocalDevelopmentRuntime()) {
        console.warn("[pulsex] edit message error", error);
      }

      throw error;
    }
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
          callSoundOptions={callSoundOptions}
          channel={activeChannel}
          onChangeCallSound={setCallSoundId}
          onPreviewCallSound={previewCallSound}
          onStartCall={handleStartCall}
          presenceUsers={channelPresenceUsers}
          selectedCallSoundId={callSoundId}
        />
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-[#f3f6fa] py-4">
          <MessageList
            currentUserId={currentUserId}
            filter={activeMessageFilter}
            messages={filteredChannelMessages}
            onEditMessage={handleEditMessage}
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
              onEditMessage={handleEditMessage}
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

function getPulseXMessageRealtimeTopic(channelId: PulseXChannel["id"]) {
  return `pulsex:messages:${channelId}`;
}

async function broadcastPulseXMessage(
  message: PulseXMessage,
  realtimeChannel: HubRealtimeChannel | null,
) {
  if (!realtimeChannel) {
    return;
  }

  try {
    await realtimeChannel.send({
      event: PULSEX_MESSAGE_BROADCAST_EVENT,
      payload: { message },
      type: "broadcast",
    });
  } catch (error: unknown) {
    logSupabaseDiagnostic("pulsex", "message broadcast error", {
      error,
      messageId: message.id,
    });
  }
}

function parsePulseXMessageBroadcastPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const message = (payload as { message?: unknown }).message;

  if (!message || typeof message !== "object") {
    return null;
  }

  const maybeMessage = message as Partial<PulseXMessage>;

  if (
    !maybeMessage.id ||
    !maybeMessage.authorId ||
    !maybeMessage.body ||
    !maybeMessage.channelId ||
    !maybeMessage.timestamp
  ) {
    return null;
  }

  return {
    ...maybeMessage,
    authorId: maybeMessage.authorId,
    body: maybeMessage.body,
    channelId: maybeMessage.channelId,
    id: maybeMessage.id,
    reactions: maybeMessage.reactions ?? [],
    status: maybeMessage.status ?? "neutral",
    tags: maybeMessage.tags ?? [],
    timestamp: maybeMessage.timestamp,
  } satisfies PulseXMessage;
}

function mergePulseXChannelMessages({
  channelId,
  currentMessages,
  nextMessages,
  replaceChannel,
}: {
  channelId: PulseXChannel["id"];
  currentMessages: readonly PulseXMessage[];
  nextMessages: readonly PulseXMessage[];
  replaceChannel: boolean;
}) {
  const nextIds = new Set(nextMessages.map((message) => message.id));
  const nextClientMessageIds = new Set(
    nextMessages
      .map((message) => message.clientMessageId)
      .filter((id): id is string => Boolean(id)),
  );
  const retainedMessages = currentMessages.filter((message) => {
    if (message.channelId !== channelId) {
      return true;
    }

    if (nextIds.has(message.id)) {
      return false;
    }

    if (
      message.clientMessageId &&
      nextClientMessageIds.has(message.clientMessageId)
    ) {
      return false;
    }

    return replaceChannel ? isLocalPendingPulseXMessage(message) : true;
  });

  return [...retainedMessages, ...nextMessages].sort(comparePulseXMessages);
}

function isLocalPendingPulseXMessage(message: PulseXMessage) {
  return message.id.startsWith("local-");
}

function comparePulseXMessages(
  firstMessage: PulseXMessage,
  secondMessage: PulseXMessage,
) {
  const firstTime = getPulseXMessageSortTime(firstMessage);
  const secondTime = getPulseXMessageSortTime(secondMessage);

  if (firstTime !== secondTime) {
    return firstTime - secondTime;
  }

  return firstMessage.id.localeCompare(secondMessage.id);
}

function getPulseXMessageSortTime(message: PulseXMessage) {
  if (!message.createdAt) {
    return 0;
  }

  const time = Date.parse(message.createdAt);

  return Number.isNaN(time) ? 0 : time;
}

function isLocalDevelopmentRuntime() {
  return ["localhost", "127.0.0.1"].includes(window.location.hostname);
}

function applyPresenceStatusesToUsers(
  users: PulseXPresenceUser[],
  presenceByUserId: Record<PulseXPresenceUser["id"], PulseXPresenceUser["status"]>,
): PulseXPresenceUser[] {
  let hasChanges = false;
  const nextUsers = users.map((user) => {
    const nextStatus = presenceByUserId[user.id] ?? "offline";

    if (user.status === nextStatus) {
      return user;
    }

    hasChanges = true;

    return {
      ...user,
      status: nextStatus,
    };
  });

  return hasChanges ? nextUsers : users;
}

function applyPresenceStatusesToDirectChannels(
  channels: PulseXChannel[],
  presenceByUserId: Record<PulseXPresenceUser["id"], PulseXPresenceUser["status"]>,
): PulseXChannel[] {
  let hasChanges = false;
  const nextChannels = channels.map((channel) => {
    if (channel.kind !== "direct") {
      return channel;
    }

    const userId = channel.id.replace(/^direct-/, "");
    const nextStatus = presenceByUserId[userId] ?? "offline";

    if (channel.status === nextStatus) {
      return channel;
    }

    hasChanges = true;

    return {
      ...channel,
      status: nextStatus,
    };
  });

  return hasChanges ? nextChannels : channels;
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

function playPulseXMessageSound() {
  playToneSequence([
    {
      duration: 0.11,
      frequency: 660,
      gain: 0.035,
      start: 0,
      type: "sine",
    },
    {
      duration: 0.14,
      frequency: 880,
      gain: 0.028,
      start: 0.11,
      type: "triangle",
    },
  ]);
}

type ToneSpec = {
  duration: number;
  frequency: number | readonly number[];
  gain: number;
  start: number;
  type: OscillatorType;
};

function playToneSequence(notes: readonly ToneSpec[]) {
  try {
    const AudioContextConstructor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;

    if (!AudioContextConstructor) {
      return;
    }

    const audioContext = new AudioContextConstructor();
    const masterGain = audioContext.createGain();
    const longestNoteEnd = notes.reduce(
      (maxEnd, note) => Math.max(maxEnd, note.start + note.duration),
      0,
    );

    masterGain.gain.setValueAtTime(0.9, audioContext.currentTime);
    masterGain.connect(audioContext.destination);

    notes.forEach((note) => {
      const noteGain = audioContext.createGain();
      const startAt = audioContext.currentTime + note.start;
      const endAt = startAt + note.duration;
      const frequencies = Array.isArray(note.frequency)
        ? note.frequency
        : [note.frequency];

      noteGain.gain.setValueAtTime(0.0001, startAt);
      noteGain.gain.exponentialRampToValueAtTime(note.gain, startAt + 0.025);
      noteGain.gain.exponentialRampToValueAtTime(0.0001, endAt);
      noteGain.connect(masterGain);

      frequencies.forEach((frequency) => {
        const chordOscillator = audioContext.createOscillator();

        chordOscillator.type = note.type;
        chordOscillator.frequency.setValueAtTime(frequency, startAt);
        chordOscillator.connect(noteGain);
        chordOscillator.start(startAt);
        chordOscillator.stop(endAt + 0.02);
      });
    });

    window.setTimeout(() => {
      void audioContext.close();
    }, Math.ceil((longestNoteEnd + 0.2) * 1_000));
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
    id: `pulsex-call-${channel.id}-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`,
    initiatedByUserId: currentUserId,
    participants: callUsers.map((user) => ({
      avatarUrl: user.avatarUrl,
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
