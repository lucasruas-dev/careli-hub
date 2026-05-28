"use client";

import { AthenaIcon } from "@/components/athena-icon";
import { listHubPresence } from "@/lib/hub-presence";
import {
  createHermesMessage,
  createHermesThreadReply,
  listChannelMessages,
  listHermesThreadReplies,
  loadHermesOperationalData,
  mapHermesMessageRow,
  markHermesChannelRead,
  updateHermesMessageBody,
  updateHermesMessageReaction,
  updateHermesMessageTags,
  type HermesMessageRow,
} from "@/lib/pulsex/supabase-data";
import {
  getHermesShortcutChannels,
  type HermesShortcutFilter,
} from "@/lib/pulsex/shortcuts";
import {
  PULSEX_MESSAGE_BROADCAST_EVENT,
  getHermesMessageRealtimeTopic,
  parseHermesMessageBroadcastPayload,
} from "@/lib/pulsex/realtime";
import {
  createHermesDirectChannelId,
  getHermesDirectPeerUserId,
} from "@/lib/pulsex/direct-channel";
import { playHermesIncomingMessageSound } from "@/lib/pulsex/notification-effects";
import { useOutsideDismiss } from "@/hooks/use-outside-dismiss";
import { Tooltip } from "@repo/uix";
import {
  getHubSupabaseClient,
  hasHubSupabaseConfig,
  logSupabaseDiagnostic,
} from "@/lib/supabase/client";
import { useAuth } from "@/providers/auth-provider";
import { useHermesCall } from "@/providers/pulsex-call-provider";
import { Bell, Download, X } from "lucide-react";
import type {
  HermesCallHistoryEntry,
  HermesCallSession,
  HermesCallType,
  HermesChannel,
  HermesDepartment,
  HermesMessageAttachment,
  HermesMessageMention,
  HermesMessageFilter,
  HermesMessageTag,
  HermesMessage,
  HermesPresenceUser,
  HermesReaction,
  HermesReactionEmoji,
  HermesThreadReply,
} from "@/lib/pulsex";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AthenaAgentPanel } from "./athena-agent-panel";
import {
  ConversationHeader,
  type HermesThreadNotificationEntry,
} from "./conversation-header";
import { ConversationSidebar } from "./conversation-sidebar";
import { MessageComposer } from "./message-composer";
import { MessageList } from "./message-list";
import { ThreadPanel } from "./thread-panel";

type HermesToastNotification = {
  channelId: HermesChannel["id"];
  description: string;
  id: string;
  mentioned: boolean;
  title: string;
};

type HermesThreadReadReceipt = {
  lastReplyAt?: string;
  readAt: string;
  threadCount: number;
};

function toggleHermesReactions({
  currentUserId,
  emoji,
  reactions,
}: {
  currentUserId: HermesPresenceUser["id"];
  emoji: HermesReactionEmoji;
  reactions: readonly HermesReaction[];
}): HermesReaction[] {
  const nextReactions = [...reactions];
  const reactionIndex = nextReactions.findIndex(
    (reaction) => reaction.emoji === emoji,
  );

  if (reactionIndex < 0) {
    return [
      ...nextReactions,
      {
        count: 1,
        emoji,
        reactedByUserIds: [currentUserId],
      },
    ];
  }

  const reaction = nextReactions[reactionIndex];

  if (!reaction) {
    return nextReactions;
  }

  const hasReacted = reaction.reactedByUserIds.includes(currentUserId);
  const reactedByUserIds = hasReacted
    ? reaction.reactedByUserIds.filter((userId) => userId !== currentUserId)
    : [...reaction.reactedByUserIds, currentUserId];
  const count = hasReacted ? reaction.count - 1 : reaction.count + 1;

  if (count <= 0) {
    nextReactions.splice(reactionIndex, 1);
    return nextReactions;
  }

  nextReactions[reactionIndex] = {
    ...reaction,
    count,
    reactedByUserIds,
  };

  return nextReactions;
}

const PULSEX_PRESENCE_REFRESH_MS = 10_000;
const PULSEX_MESSAGE_REFRESH_MS = 15_000;
const PULSEX_FAVORITE_CHANNELS_STORAGE_KEY = "careli:pulsex:favorite-channels";
const HERMES_THREAD_READ_STORAGE_PREFIX = "careli:hermes:thread-read-state";

type HubSupabaseClient = NonNullable<ReturnType<typeof getHubSupabaseClient>>;
type HubRealtimeChannel = ReturnType<HubSupabaseClient["channel"]>;

export function HermesWorkspace() {
  const { hubUser, profileStatus } = useAuth();
  const {
    callHistory,
    callSoundId,
    callSoundOptions,
    markCallHistoryRead,
    previewCallSound,
    setCallSoundId,
    startCall,
    unreadCallCount,
  } = useHermesCall();
  const currentUserId = hubUser?.id ?? "ana";
  const [activeChannelId, setActiveChannelId] = useState<HermesChannel["id"]>(
    emptyHermesChannel.id,
  );
  const [channels, setChannels] = useState<HermesChannel[]>([]);
  const [departments, setDepartments] = useState<HermesDepartment[]>([]);
  const [messages, setMessages] = useState<HermesMessage[]>([]);
  const [presenceUsers, setPresenceUsers] = useState<HermesPresenceUser[]>([]);
  const [threadReplies, setThreadReplies] = useState<
    Record<string, HermesThreadReply[]>
  >({});
  const [activeThreadMessageId, setActiveThreadMessageId] = useState<
    HermesMessage["id"] | null
  >(null);
  const [isAthenaAgentOpen, setIsAthenaAgentOpen] = useState(false);
  const [isAthenaTicketRecordingActive, setIsAthenaTicketRecordingActive] =
    useState(false);
  const [isAthenaTicketRecordingMinimized, setIsAthenaTicketRecordingMinimized] =
    useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [athenaFocusedMessageId, setAthenaFocusedMessageId] = useState<
    HermesMessage["id"] | null
  >(null);
  const [activeMessageFilter, setActiveMessageFilter] =
    useState<HermesMessageFilter>("all");
  const [activeShortcutFilter, setActiveShortcutFilter] =
    useState<HermesShortcutFilter | null>(null);
  const [composerValue, setComposerValue] = useState("");
  const [composerMentions, setComposerMentions] = useState<
    readonly HermesMessageMention[]
  >([]);
  const [composerTags, setComposerTags] = useState<readonly HermesMessageTag[]>(
    [],
  );
  const [threadComposerValue, setThreadComposerValue] = useState("");
  const [dataStatus, setDataStatus] = useState<
    "fallback" | "loading" | "ready"
  >("loading");
  const [favoriteChannelIds, setFavoriteChannelIds] = useState<
    HermesChannel["id"][]
  >([]);
  const [isFavoriteStorageReady, setIsFavoriteStorageReady] = useState(false);
  const [threadReadState, setThreadReadState] = useState<
    Record<string, HermesThreadReadReceipt>
  >({});
  const [isThreadReadStorageReady, setIsThreadReadStorageReady] =
    useState(false);
  const knownMessageIdsRef = useRef<Set<string>>(new Set());
  const loadedChannelIdsRef = useRef<Set<string>>(new Set());
  const messageRealtimeChannelRef = useRef<HubRealtimeChannel | null>(null);
  const athenaAgentPanelRef = useRef<HTMLDivElement>(null);
  const threadPanelRef = useRef<HTMLDivElement>(null);
  const [notifications, setNotifications] = useState<HermesToastNotification[]>(
    [],
  );
  const [attachmentPreview, setAttachmentPreview] = useState<
    NonNullable<HermesMessage["attachment"]> | null
  >(null);
  const activeChannel =
    channels.find((channel) => channel.id === activeChannelId) ??
    channels[0] ??
    emptyHermesChannel;

  useOutsideDismiss({
    enabled: isAthenaAgentOpen && !isAthenaTicketRecordingMinimized,
    onDismiss: handleCloseAthenaAgent,
    ref: athenaAgentPanelRef,
  });
  useOutsideDismiss({
    enabled: Boolean(activeThreadMessageId),
    onDismiss: () => {
      setActiveThreadMessageId(null);
      setThreadComposerValue("");
    },
    ref: threadPanelRef,
  });
  const favoriteChannelIdsSet = useMemo(
    () => new Set(favoriteChannelIds),
    [favoriteChannelIds],
  );
  const activeThreadMessage = activeThreadMessageId
    ? messages.find((message) => message.id === activeThreadMessageId)
    : undefined;
  const activeThreadReplies = activeThreadMessageId
    ? (threadReplies[activeThreadMessageId] ?? [])
    : [];
  const channelMessages = messages.filter(
    (message) => message.channelId === activeChannel.id,
  );
  const athenaFocusedMessage = athenaFocusedMessageId
    ? channelMessages.find((message) => message.id === athenaFocusedMessageId)
    : null;
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
  const channelPresenceUsers = useMemo(() => {
    const channelUsers = presenceUsers.filter((user) =>
      (user.channelIds as readonly string[]).includes(activeChannel.id),
    );
    const knownUserIds = new Set(channelUsers.map((user) => user.id));
    const messageAuthorUsers: HermesPresenceUser[] = [];

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
  }, [activeChannel.id, channelMessages, presenceUsers]);
  const activeChannelCallEvents = useMemo(
    () => callHistory.filter((entry) => entry.channelId === activeChannel.id),
    [activeChannel.id, callHistory],
  );
  const channelsById = useMemo(
    () => new Map(channels.map((channel) => [channel.id, channel] as const)),
    [channels],
  );
  const threadUnreadCountByMessageId = useMemo(() => {
    const unreadCountByMessageId = new Map<HermesMessage["id"], number>();

    for (const message of messages) {
      const unreadCount = getThreadUnreadCountForMessage(
        message,
        threadReadState[message.id],
      );

      if (unreadCount > 0) {
        unreadCountByMessageId.set(message.id, unreadCount);
      }
    }

    return unreadCountByMessageId;
  }, [messages, threadReadState]);
  const unreadThreadReplyCount = useMemo(
    () =>
      Array.from(threadUnreadCountByMessageId.values()).reduce(
        (total, count) => total + count,
        0,
      ),
    [threadUnreadCountByMessageId],
  );
  const threadNotifications = useMemo<HermesThreadNotificationEntry[]>(
    () => {
      const entries: HermesThreadNotificationEntry[] = [];

      for (const message of messages) {
        const unreadCount = threadUnreadCountByMessageId.get(message.id) ?? 0;

        if (unreadCount <= 0) {
          continue;
        }

        const channel = channelsById.get(message.channelId);

        entries.push({
          channelName: channel?.name ?? activeChannel.name,
          id: `thread-notification-${message.id}`,
          lastReplyLabel: formatThreadNotificationTime(
            message.lastThreadReplyAt ?? message.createdAt,
          ),
          messageId: message.id,
          parentPreview: getThreadParentPreview(message),
          replyCount: message.threadCount ?? 0,
          unreadCount,
          ...(message.authorName
            ? { parentAuthorName: message.authorName }
            : {}),
        });
      }

      return entries.sort(
        (firstEntry, secondEntry) =>
          getThreadNotificationSortTime(secondEntry, messages) -
          getThreadNotificationSortTime(firstEntry, messages),
      );
    },
    [activeChannel.name, channelsById, messages, threadUnreadCountByMessageId],
  );
  const markThreadRepliesRead = useCallback(
    (message: HermesMessage, replyCountOverride?: number) => {
      if (!isThreadReadStorageReady) {
        return;
      }

      const threadCount = Math.max(
        message.threadCount ?? 0,
        replyCountOverride ?? 0,
      );
      const lastReplyAt = message.lastThreadReplyAt;
      const readAt = new Date().toISOString();

      setThreadReadState((currentState) => {
        const currentReceipt = currentState[message.id];

        if (
          currentReceipt?.threadCount === threadCount &&
          currentReceipt.lastReplyAt === lastReplyAt
        ) {
          return currentState;
        }

        return {
          ...currentState,
          [message.id]: {
            lastReplyAt,
            readAt,
            threadCount,
          },
        };
      });
    },
    [isThreadReadStorageReady],
  );

  function handleCloseAthenaAgent() {
    if (isAthenaTicketRecordingActive) {
      setIsAthenaTicketRecordingMinimized(true);
      setIsAthenaAgentOpen(true);
      setAthenaFocusedMessageId(null);
      return;
    }

    setIsAthenaTicketRecordingMinimized(false);
    setIsAthenaAgentOpen(false);
    setAthenaFocusedMessageId(null);
  }

  function handleRestoreAthenaTicketPanel() {
    setIsAthenaTicketRecordingMinimized(false);
    setIsAthenaAgentOpen(true);
  }

  function handlePreviewAttachment(
    attachment: NonNullable<HermesMessage["attachment"]>,
  ) {
    if (attachment.type !== "image" || !attachment.url) {
      return;
    }

    setAttachmentPreview(attachment);
  }

  const loadOperationalData = useCallback(() => {
    if (profileStatus === "loading") {
      setDataStatus((currentStatus) =>
        currentStatus === "ready" ? currentStatus : "loading",
      );
      return;
    }

    let isMounted = true;

    setDataStatus((currentStatus) =>
      currentStatus === "ready" ? currentStatus : "loading",
    );
    loadHermesOperationalData({
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
        );

        const nextMessages = withMessageDeliveryData(
          payload.messages,
          nextChannels,
        );
        const nextChannelsWithUnread = withChannelUnreadCounts({
          channels: nextChannels,
          currentUserId,
          messages: nextMessages,
        });

        nextMessages.forEach((message) =>
          knownMessageIdsRef.current.add(message.id),
        );
        nextMessages.forEach((message) =>
          loadedChannelIdsRef.current.add(message.channelId),
        );

        setChannels(nextChannelsWithUnread);
        setDepartments(payload.departments);
        setMessages(nextMessages);
        setPresenceUsers(nextPresenceUsers);
        setActiveChannelId((currentId) =>
          nextChannelsWithUnread.some((channel) => channel.id === currentId)
            ? currentId
            : (nextChannelsWithUnread[0]?.id ?? emptyHermesChannel.id),
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

        setDataStatus((currentStatus) =>
          currentStatus === "ready" ? currentStatus : "fallback",
        );
      });

    return () => {
      isMounted = false;
    };
  }, [currentUserId, hubUser?.role, profileStatus]);

  useEffect(() => loadOperationalData(), [loadOperationalData]);

  useEffect(() => {
    try {
      const storedValue = window.localStorage.getItem(
        PULSEX_FAVORITE_CHANNELS_STORAGE_KEY,
      );
      const parsedValue = storedValue ? JSON.parse(storedValue) : [];

      setFavoriteChannelIds(
        Array.isArray(parsedValue)
          ? parsedValue.filter(
              (item): item is string => typeof item === "string",
            )
          : [],
      );
    } catch {
      setFavoriteChannelIds([]);
    } finally {
      setIsFavoriteStorageReady(true);
    }
  }, []);

  useEffect(() => {
    if (!isFavoriteStorageReady) {
      return;
    }

    window.localStorage.setItem(
      PULSEX_FAVORITE_CHANNELS_STORAGE_KEY,
      JSON.stringify(favoriteChannelIds),
    );
  }, [favoriteChannelIds, isFavoriteStorageReady]);

  useEffect(() => {
    setIsThreadReadStorageReady(false);

    try {
      const storedValue = window.localStorage.getItem(
        getHermesThreadReadStorageKey(currentUserId),
      );
      const parsedValue = storedValue ? JSON.parse(storedValue) : {};

      setThreadReadState(normalizeThreadReadState(parsedValue));
    } catch {
      setThreadReadState({});
    } finally {
      setIsThreadReadStorageReady(true);
    }
  }, [currentUserId]);

  useEffect(() => {
    if (!isThreadReadStorageReady) {
      return;
    }

    window.localStorage.setItem(
      getHermesThreadReadStorageKey(currentUserId),
      JSON.stringify(threadReadState),
    );
  }, [currentUserId, isThreadReadStorageReady, threadReadState]);

  useEffect(() => {
    if (!isThreadReadStorageReady || messages.length === 0) {
      return;
    }

    const now = new Date().toISOString();

    setThreadReadState((currentState) => {
      let changed = false;
      const nextState = { ...currentState };

      for (const message of messages) {
        if (message.deletedAt || message.threadParentMessageId) {
          continue;
        }

        if (nextState[message.id]) {
          continue;
        }

        nextState[message.id] = {
          lastReplyAt: message.lastThreadReplyAt,
          readAt: now,
          threadCount: message.threadCount ?? 0,
        };
        changed = true;
      }

      return changed ? nextState : currentState;
    });
  }, [isThreadReadStorageReady, messages]);

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
              currentUserId,
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
    [currentUserId],
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
    (newMessages: readonly HermesMessage[]) => {
      if (newMessages.length === 0) {
        return;
      }

      newMessages.forEach((message) => {
        const mentioned = isMessageMentioningUser(message, currentUserId);
        const title = mentioned
          ? "Voce foi mencionado no Hermes"
          : `Nova mensagem em ${activeChannel.name}`;
        const description = `${message.authorName ?? "Hermes"}: ${message.body}`;
        const notification = {
          channelId: message.channelId,
          description,
          id: `notification-${message.id}-${Date.now()}`,
          mentioned,
          title,
        } satisfies HermesToastNotification;

        playHermesIncomingMessageSound({
          mentioned,
          messageId: message.id,
        });
        setNotifications((currentNotifications) =>
          [notification, ...currentNotifications].slice(0, 4),
        );
        window.setTimeout(() => {
          setNotifications((currentNotifications) =>
            currentNotifications.filter((item) => item.id !== notification.id),
          );
        }, 6_000);
      });
    },
    [activeChannel.name, currentUserId],
  );

  const loadActiveChannelMessages = useCallback(
    (shouldApply: () => boolean = () => true) => {
      if (
        !hasHubSupabaseConfig() ||
        activeChannel.id === emptyHermesChannel.id
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
              newMessages.filter(
                (message) => message.authorId !== currentUserId,
              ),
            );
          }

          setMessages((currentMessages) =>
            mergeHermesChannelMessages({
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
      channels,
      currentUserId,
      notifyIncomingMessages,
    ],
  );

  useEffect(() => {
    if (
      !hasHubSupabaseConfig() ||
      activeChannel.id === emptyHermesChannel.id
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
      activeChannel.id === emptyHermesChannel.id
    ) {
      return;
    }

    const client = getHubSupabaseClient();

    if (!client) {
      return;
    }

    const realtimeChannel = client.channel(
      getHermesMessageRealtimeTopic(activeChannel.id),
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
        "postgres_changes",
        {
          event: "*",
          filter: `channel_id=eq.${activeChannel.id}`,
          schema: "public",
          table: "pulsex_messages",
        },
        (payload: { eventType?: string; new?: unknown }) => {
          const message = normalizeHermesRealtimeMessage(
            payload.new,
            presenceUsers,
          );

          if (!message || message.channelId !== activeChannel.id) {
            return;
          }

          if (message.deletedAt) {
            setMessages((currentMessages) =>
              currentMessages.filter(
                (currentMessage) => currentMessage.id !== message.id,
              ),
            );
            return;
          }

          if (message.threadParentMessageId) {
            setMessages((currentMessages) =>
              currentMessages.map((currentMessage) =>
                currentMessage.id === message.threadParentMessageId
                  ? {
                      ...currentMessage,
                      lastThreadReplyAt: getLatestHermesDateValue(
                        currentMessage.lastThreadReplyAt,
                        message.createdAt,
                      ),
                      threadCount: (currentMessage.threadCount ?? 0) + 1,
                    }
                  : currentMessage,
              ),
            );
            return;
          }

          const alreadyKnown = knownMessageIdsRef.current.has(message.id);
          const [nextDeliveredMessage] = withMessageDeliveryData(
            [message],
            channels,
          );

          if (!nextDeliveredMessage) {
            return;
          }

          knownMessageIdsRef.current.add(nextDeliveredMessage.id);
          loadedChannelIdsRef.current.add(nextDeliveredMessage.channelId);
          setMessages((currentMessages) =>
            mergeHermesChannelMessages({
              channelId: activeChannel.id,
              currentMessages,
              nextMessages: [nextDeliveredMessage],
              replaceChannel: false,
            }),
          );

          if (
            payload.eventType === "INSERT" &&
            !alreadyKnown &&
            nextDeliveredMessage.authorId !== currentUserId
          ) {
            notifyIncomingMessages([nextDeliveredMessage]);
          }
        },
      )
      .on(
        "broadcast",
        {
          event: PULSEX_MESSAGE_BROADCAST_EVENT,
        },
        (payload: { payload?: unknown }) => {
          const broadcastMessage = parseHermesMessageBroadcastPayload(
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
            mergeHermesChannelMessages({
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
    presenceUsers,
  ]);

  useEffect(() => {
    if (
      !hasHubSupabaseConfig() ||
      activeChannel.id === emptyHermesChannel.id
    ) {
      return;
    }

    let isMounted = true;

    markHermesChannelRead({ channelId: activeChannel.id })
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
                  unreadCount: 0,
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

  const loadThreadReplies = useCallback((messageId: HermesMessage["id"]) => {
    if (!hasHubSupabaseConfig() || messageId.startsWith("local-")) {
      return;
    }

    listHermesThreadReplies({ messageId })
      .then((nextReplies) => {
        const latestReplyAt = getLatestThreadReplyCreatedAt(nextReplies);

        setThreadReplies((currentReplies) => ({
          ...currentReplies,
          [messageId]: nextReplies,
        }));
        setMessages((currentMessages) =>
          currentMessages.map((message) =>
            message.id === messageId
              ? {
                  ...message,
                  lastThreadReplyAt: latestReplyAt ?? message.lastThreadReplyAt,
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

  useEffect(() => {
    if (!activeThreadMessageId || !activeThreadMessage) {
      return;
    }

    markThreadRepliesRead(activeThreadMessage, activeThreadReplies.length);
  }, [
    activeThreadMessageId,
    activeThreadMessage,
    activeThreadReplies.length,
    markThreadRepliesRead,
  ]);

  function handleSelectChannel(channelId: HermesChannel["id"]) {
    setActiveChannelId(channelId);
    setIsAthenaAgentOpen(false);
    setAthenaFocusedMessageId(null);
    setActiveThreadMessageId(null);
    setThreadComposerValue("");
    setChannels((currentChannels) =>
      currentChannels.map((channel) =>
        channel.id === channelId ? { ...channel, unreadCount: 0 } : channel,
      ),
    );
  }

  function handleSelectMessageFilter(filter: HermesMessageFilter) {
    setActiveShortcutFilter(null);
    setActiveMessageFilter(filter);
  }

  function handleSelectShortcut(shortcut: HermesShortcutFilter) {
    const nextShortcut = activeShortcutFilter === shortcut ? null : shortcut;

    setActiveShortcutFilter(nextShortcut);
    setActiveMessageFilter(nextShortcut === "mentions" ? "mentions" : "all");

    if (!nextShortcut) {
      return;
    }

    const shortcutChannels = getHermesShortcutChannels({
      channels,
      currentUserId,
      favoriteChannelIds,
      messages,
      shortcut: nextShortcut,
    });

    const firstShortcutChannel = shortcutChannels[0];

    if (
      firstShortcutChannel &&
      !shortcutChannels.some((channel) => channel.id === activeChannel.id)
    ) {
      handleSelectChannel(firstShortcutChannel.id);
    }
  }

  function handleToggleFavoriteChannel() {
    if (activeChannel.id === emptyHermesChannel.id) {
      return;
    }

    setFavoriteChannelIds((currentIds) =>
      currentIds.includes(activeChannel.id)
        ? currentIds.filter((channelId) => channelId !== activeChannel.id)
        : [...currentIds, activeChannel.id],
    );
  }

  function handleOpenThread(messageId: HermesMessage["id"]) {
    const threadMessage = messages.find((message) => message.id === messageId);

    setIsAthenaAgentOpen(false);
    setAthenaFocusedMessageId(null);
    setActiveThreadMessageId(messageId);
    loadThreadReplies(messageId);

    if (threadMessage) {
      markThreadRepliesRead(threadMessage);
    }
  }

  function handleOpenAthenaAgent() {
    setActiveThreadMessageId(null);
    setThreadComposerValue("");
    setAthenaFocusedMessageId(null);
    setIsAthenaTicketRecordingMinimized(false);
    setIsAthenaAgentOpen(true);
  }

  function handleOpenAthenaAgentForMessage(messageId: HermesMessage["id"]) {
    setActiveThreadMessageId(null);
    setThreadComposerValue("");
    setAthenaFocusedMessageId(messageId);
    setIsAthenaTicketRecordingMinimized(false);
    setIsAthenaAgentOpen(true);
  }

  function handleUseAthenaDraft(content: string) {
    const nextContent = content.trim();

    if (!nextContent) {
      return;
    }

    if (athenaFocusedMessage) {
      setThreadComposerValue((currentValue) =>
        currentValue.trim()
          ? `${currentValue.trimEnd()}\n\n${nextContent}`
          : nextContent,
      );
      setActiveThreadMessageId(athenaFocusedMessage.id);
      loadThreadReplies(athenaFocusedMessage.id);
      markThreadRepliesRead(athenaFocusedMessage);
      setIsAthenaAgentOpen(false);
      setAthenaFocusedMessageId(null);
      return;
    }

    setComposerValue((currentValue) => {
      return currentValue.trim()
        ? `${currentValue.trimEnd()}\n\n${nextContent}`
        : nextContent;
    });
    setIsAthenaAgentOpen(false);
    setAthenaFocusedMessageId(null);
  }

  function startHermesCallForChannel(
    channel: HermesChannel,
    type: HermesCallType,
  ) {
    if (channel.id === emptyHermesChannel.id) {
      return;
    }

    const participants = getPresenceUsersForChannel(channel, presenceUsers);
    const session = createLocalCallSession({
      channel,
      currentUserId,
      fallbackUsers: presenceUsers,
      participants,
      type,
    });
    const targetUserIds = session.participants
      .map((participant) => participant.userId)
      .filter(
        (userId): userId is HermesPresenceUser["id"] =>
          Boolean(userId) && userId !== currentUserId,
      );

    startCall({ session, targetUserIds });
  }

  function handleStartCall(type: HermesCallType) {
    startHermesCallForChannel(activeChannel, type);
  }

  function handleReturnCallFromHistory(entry: HermesCallHistoryEntry) {
    const targetChannel =
      channels.find((channel) => channel.id === entry.channelId) ??
      activeChannel;

    if (targetChannel.id !== activeChannel.id) {
      handleSelectChannel(targetChannel.id);
    }

    markCallHistoryRead(entry.channelId);
    startHermesCallForChannel(targetChannel, entry.type);
  }

  async function handleSendMessage(input?: {
    attachment?: HermesMessageAttachment;
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

    const createdAt = new Date().toISOString();
    const timestamp = new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(createdAt));
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
    } satisfies HermesMessage;

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

    if (!hasHubSupabaseConfig()) {
      return;
    }

    try {
      const savedMessage = await createHermesMessage({
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
        mergeHermesChannelMessages({
          channelId: activeChannel.id,
          currentMessages,
          nextMessages: [savedDeliveredMessage],
          replaceChannel: false,
        }),
      );
      void broadcastHermesMessage(
        savedDeliveredMessage,
        messageRealtimeChannelRef.current,
      );
    } catch (error) {
      if (isLocalDevelopmentRuntime()) {
        console.warn("[pulsex] send message error", error);
      }
      setMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.id === localMessage.id
            ? {
                ...message,
                status: "danger",
              }
            : message,
        ),
      );
      setComposerValue(body);
      setComposerMentions(mentions);
      setComposerTags(tags);
    }
  }

  function handleComposerChange(
    value: string,
    mentions: readonly HermesMessageMention[],
  ) {
    setComposerValue(value);
    setComposerMentions(mentions);
  }

  function handleToggleComposerTag(tag: HermesMessageTag) {
    setComposerTags((currentTags) =>
      currentTags.includes(tag)
        ? currentTags.filter((currentTag) => currentTag !== tag)
        : [...currentTags, tag],
    );
  }

  async function handleEditMessage(
    messageId: HermesMessage["id"],
    body: string,
  ) {
    const nextBody = body.trim();
    const previousMessage = messages.find(
      (message) => message.id === messageId,
    );

    if (!previousMessage || !nextBody || previousMessage.body === nextBody) {
      return;
    }

    const editedAt = new Date().toISOString();
    const optimisticMessage = {
      ...previousMessage,
      body: nextBody,
      editedAt,
    } satisfies HermesMessage;

    setMessages((currentMessages) =>
      currentMessages.map((message) =>
        message.id === messageId ? optimisticMessage : message,
      ),
    );

    if (!hasHubSupabaseConfig() || messageId.startsWith("local-")) {
      return;
    }

    try {
      const savedMessage = await updateHermesMessageBody({
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

  function updateThreadReplyState(
    replyId: HermesThreadReply["id"],
    updater: (reply: HermesThreadReply) => HermesThreadReply,
  ) {
    setThreadReplies((currentReplies) => {
      let changed = false;
      const nextReplies = Object.fromEntries(
        Object.entries(currentReplies).map(([messageId, replies]) => [
          messageId,
          replies.map((reply) => {
            if (reply.id !== replyId) {
              return reply;
            }

            changed = true;
            return updater(reply);
          }),
        ]),
      );

      return changed ? nextReplies : currentReplies;
    });
  }

  function applySavedThreadReplyMessage(savedMessage: HermesMessage) {
    updateThreadReplyState(savedMessage.id, (reply) => ({
      ...reply,
      attachment: savedMessage.attachment,
      authorAvatarUrl: savedMessage.authorAvatarUrl,
      authorId: savedMessage.authorId,
      authorName: savedMessage.authorName,
      body: savedMessage.body,
      channelId: savedMessage.channelId,
      createdAt: savedMessage.createdAt,
      reactions: savedMessage.reactions,
      tags: savedMessage.tags,
      timestamp: savedMessage.timestamp,
    }));
  }

  function handleToggleMessageTag(
    messageId: HermesMessage["id"],
    tag: HermesMessageTag,
  ) {
    const currentMessage = messages.find((message) => message.id === messageId);
    const currentReply = Object.values(threadReplies)
      .flat()
      .find((reply) => reply.id === messageId);
    const currentTags = currentMessage?.tags ?? currentReply?.tags ?? [];
    const nextTags = currentTags.includes(tag)
      ? currentTags.filter((currentTag) => currentTag !== tag)
      : [...currentTags, tag];

    setMessages((currentMessages) =>
      currentMessages.map((message) =>
        message.id === messageId ? { ...message, tags: nextTags } : message,
      ),
    );
    updateThreadReplyState(messageId, (reply) => ({
      ...reply,
      tags: nextTags,
    }));

    if (
      !hasHubSupabaseConfig() ||
      messageId.startsWith("local-") ||
      messageId.startsWith("reply-")
    ) {
      return;
    }

    updateHermesMessageTags({
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
        applySavedThreadReplyMessage(savedMessage);
      })
      .catch((error: unknown) => {
        if (isLocalDevelopmentRuntime()) {
          console.warn("[pulsex] update message tags error", error);
        }
      });
  }

  function handleToggleReaction(
    messageId: HermesMessage["id"],
    emoji: HermesReactionEmoji,
  ) {
    setMessages((currentMessages) =>
      currentMessages.map((message) =>
        message.id === messageId
          ? {
              ...message,
              reactions: toggleHermesReactions({
                currentUserId,
                emoji,
                reactions: message.reactions ?? [],
              }),
            }
          : message,
      ),
    );
    updateThreadReplyState(messageId, (reply) => ({
      ...reply,
      reactions: toggleHermesReactions({
        currentUserId,
        emoji,
        reactions: reply.reactions ?? [],
      }),
    }));

    if (
      !hasHubSupabaseConfig() ||
      messageId.startsWith("local-") ||
      messageId.startsWith("reply-")
    ) {
      return;
    }

    updateHermesMessageReaction({
      emoji,
      messageId,
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
        applySavedThreadReplyMessage(savedMessage);
      })
      .catch((error: unknown) => {
        if (isLocalDevelopmentRuntime()) {
          console.warn("[hermes] update message reaction error", error);
        }
      });
  }

  function handleSubmitThreadReply(input?: {
    attachment?: HermesMessageAttachment;
  }) {
    const attachment = input?.attachment;
    const body = threadComposerValue.trim();
    const replyBody = body || attachment?.label || "Anexo";

    if ((!body && !attachment) || !activeThreadMessage) {
      return false;
    }

    const createdAt = new Date().toISOString();
    const timestamp = new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(createdAt));
    const currentPresenceUser = presenceUsers.find(
      (user) => user.id === currentUserId,
    );
    const localReply = {
      authorAvatarUrl: currentPresenceUser?.avatarUrl,
      authorId: currentUserId,
      authorName: currentPresenceUser?.label ?? hubUser?.name,
      attachment,
      body: replyBody,
      channelId: activeThreadMessage.channelId,
      createdAt,
      id: `reply-${activeThreadMessage.id}-${Date.now()}`,
      messageId: activeThreadMessage.id,
      timestamp,
    } satisfies HermesThreadReply;

    setThreadReplies((currentReplies) => {
      const messageReplies = currentReplies[activeThreadMessage.id] ?? [];

      return {
        ...currentReplies,
        [activeThreadMessage.id]: [...messageReplies, localReply],
      };
    });
    setMessages((currentMessages) =>
      currentMessages.map((message) =>
        message.id === activeThreadMessage.id
          ? {
              ...message,
              lastThreadReplyAt: createdAt,
              threadCount: (message.threadCount ?? 0) + 1,
            }
          : message,
      ),
    );
    markThreadRepliesRead(
      {
        ...activeThreadMessage,
        lastThreadReplyAt: createdAt,
        threadCount: (activeThreadMessage.threadCount ?? 0) + 1,
      },
      (activeThreadMessage.threadCount ?? 0) + 1,
    );
    setThreadComposerValue("");

    if (
      !hasHubSupabaseConfig() ||
      activeThreadMessage.id.startsWith("local-")
    ) {
      return true;
    }

    createHermesThreadReply({
      attachment,
      authorUserId: hubUser?.id,
      body: replyBody,
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

    return true;
  }

  return (
    <div
      className={`grid h-full min-h-0 overflow-hidden bg-[#f3f6fa] transition-[grid-template-columns] duration-200 ease-out ${
        isSidebarCollapsed
          ? "[grid-template-columns:5rem_minmax(0,1fr)]"
          : "[grid-template-columns:21.5rem_minmax(0,1fr)]"
      }`}
    >
      <ConversationSidebar
        activeChannelId={activeChannel.id}
        activeMessageFilter={activeMessageFilter}
        activeShortcutFilter={activeShortcutFilter}
        channels={channels}
        currentUserId={currentUserId}
        dataStatus={dataStatus}
        departments={departments}
        favoriteChannelIds={favoriteChannelIds}
        isCollapsed={isSidebarCollapsed}
        users={presenceUsers}
        messages={messages}
        onToggleCollapsed={() =>
          setIsSidebarCollapsed((currentValue) => !currentValue)
        }
        onSelectMessageFilter={handleSelectMessageFilter}
        onSelectShortcut={handleSelectShortcut}
        onSelectChannel={handleSelectChannel}
        onRefresh={() => {
          loadOperationalData();
        }}
      />
      <div className="min-h-0 min-w-0 p-3 pl-0">
        <main className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[1.35rem] border border-[#d9e0ea] bg-[#f3f6fa] shadow-[0_14px_36px_rgba(16,24,32,0.08)]">
          <ConversationHeader
            callHistory={callHistory}
            callSoundOptions={callSoundOptions}
            channel={activeChannel}
            isFavorite={favoriteChannelIdsSet.has(activeChannel.id)}
            onChangeCallSound={setCallSoundId}
            onMarkCallHistoryRead={markCallHistoryRead}
            onPreviewCallSound={previewCallSound}
            onReturnCall={handleReturnCallFromHistory}
            onStartCall={handleStartCall}
            onOpenThreadNotification={handleOpenThread}
            onToggleFavorite={handleToggleFavoriteChannel}
            presenceUsers={channelPresenceUsers}
            selectedCallSoundId={callSoundId}
            threadNotifications={threadNotifications}
            unreadCallCount={unreadCallCount}
            unreadThreadReplyCount={unreadThreadReplyCount}
          />
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-[#f3f6fa] py-4">
            <MessageList
              callEvents={activeChannelCallEvents}
              currentUserId={currentUserId}
              filter={activeMessageFilter}
              messages={filteredChannelMessages}
              onAskAiReply={handleOpenAthenaAgentForMessage}
              onEditMessage={handleEditMessage}
              onOpenThread={handleOpenThread}
              onPreviewAttachment={handlePreviewAttachment}
              onReturnCall={handleReturnCallFromHistory}
              onToggleReaction={handleToggleReaction}
              onToggleTag={handleToggleMessageTag}
              getThreadUnreadCount={(messageId) =>
                threadUnreadCountByMessageId.get(messageId) ?? 0
              }
              reactionOptions={hermesReactionOptions}
              users={presenceUsers}
            />
          </div>
          <MessageComposer
            channelName={activeChannel.name}
            currentUserId={currentUserId}
            mentions={composerMentions}
            onChange={handleComposerChange}
            onSubmit={handleSendMessage}
            onToggleTag={handleToggleComposerTag}
            selectedTags={composerTags}
            users={presenceUsers}
            value={composerValue}
          />
          <HermesNotificationStack
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
          {!isAthenaAgentOpen && !activeThreadMessage ? (
            <div
              className="absolute z-30"
              style={{ bottom: "6rem", right: "1.5rem" }}
            >
              <Tooltip content="Abrir Athena" placement="left">
                <button
                  aria-label="Abrir Athena"
                  className="grid size-14 place-items-center overflow-hidden rounded-full border border-[#A07C3B]/35 bg-[#101820] text-[#A07C3B] shadow-[0_18px_50px_rgba(15,23,42,0.20)] outline-none transition hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                  onClick={handleOpenAthenaAgent}
                  type="button"
                >
                  <AthenaIcon className="size-full object-cover" aria-hidden="true" />
                  <span className="absolute right-1 top-1 size-3 rounded-full bg-emerald-500 ring-2 ring-white" />
                </button>
              </Tooltip>
            </div>
          ) : null}
          {isAthenaAgentOpen ? (
            <div
              className={
                isAthenaTicketRecordingMinimized
                  ? "absolute bottom-6 right-6 z-30 w-[min(24rem,calc(100%-2rem))]"
                  : "absolute inset-y-0 right-0 z-30 shadow-2xl"
              }
              ref={athenaAgentPanelRef}
              style={
                isAthenaTicketRecordingMinimized
                  ? undefined
                  : { maxWidth: "calc(100% - 1rem)", width: "24rem" }
              }
            >
              <AthenaAgentPanel
                channel={activeChannel}
                compactTicketMode={isAthenaTicketRecordingMinimized}
                currentUserId={currentUserId}
                draftValue={composerValue}
                focusedMessage={athenaFocusedMessage}
                messages={channelMessages}
                onClose={handleCloseAthenaAgent}
                onRestoreTicketPanel={handleRestoreAthenaTicketPanel}
                onTicketRecordingStateChange={setIsAthenaTicketRecordingActive}
                onUseAsDraft={handleUseAthenaDraft}
                users={presenceUsers}
              />
            </div>
          ) : activeThreadMessage ? (
            <div
              className="absolute inset-y-0 right-0 z-40 w-[min(31rem,calc(100%-0.75rem))] shadow-2xl"
              ref={threadPanelRef}
            >
              <ThreadPanel
                currentUserId={currentUserId}
                message={activeThreadMessage}
                onChangeReply={setThreadComposerValue}
                onClose={() => {
                  setActiveThreadMessageId(null);
                  setThreadComposerValue("");
                }}
                onEditMessage={handleEditMessage}
                onPreviewAttachment={handlePreviewAttachment}
                onSubmitReply={handleSubmitThreadReply}
                onToggleReaction={handleToggleReaction}
                onToggleTag={handleToggleMessageTag}
                reactionOptions={hermesReactionOptions}
                replies={activeThreadReplies}
                replyValue={threadComposerValue}
                users={presenceUsers}
              />
            </div>
          ) : null}
          <HermesAttachmentLightbox
            attachment={attachmentPreview}
            onClose={() => setAttachmentPreview(null)}
          />
        </main>
      </div>
    </div>
  );
}

function withDirectUserChannels(
  channels: readonly HermesChannel[],
  users: readonly HermesPresenceUser[],
  currentUserId: HermesPresenceUser["id"],
): HermesChannel[] {
  const channelsById = new Map(channels.map((channel) => [channel.id, channel]));
  const nonDirectChannels = channels.filter((channel) => channel.kind !== "direct");
  const directChannels = users
    .filter((user) => user.id !== currentUserId)
    .map((user) => {
      const directChannelId = createHermesDirectChannelId(currentUserId, user.id);
      const existingChannel = channelsById.get(directChannelId);

      return {
        ...existingChannel,
        avatar: user.initials,
        avatarUrl: user.avatarUrl,
        context: {
          ...(existingChannel?.context ?? {
            filesCount: 0,
            owner: user.label,
            status: "Direta",
            unit: user.role,
          }),
          owner: user.label,
          status: "Direta",
          unit: user.role,
        },
        description:
          existingChannel?.description ?? `Conversa direta com ${user.label}.`,
        id: directChannelId,
        kind: "direct" as const,
        lastMessageAt: existingChannel?.lastMessageAt ?? "-",
        memberReadAtByUserId: existingChannel?.memberReadAtByUserId ?? {},
        memberUserIds: existingChannel?.memberUserIds ?? [currentUserId, user.id],
        name: user.label,
        preview: existingChannel?.preview ?? user.email ?? "Usuario do Hub",
        status: user.status,
        unreadCount: existingChannel?.unreadCount,
      };
    })
    .filter((channel) => Boolean(channel.id)) satisfies HermesChannel[];

  return [...nonDirectChannels, ...directChannels];
}

function HermesNotificationStack({
  notifications,
  onDismiss,
  onSelect,
}: {
  notifications: readonly HermesToastNotification[];
  onDismiss: (notificationId: HermesToastNotification["id"]) => void;
  onSelect: (channelId: HermesChannel["id"]) => void;
}) {
  if (notifications.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute right-4 top-20 z-30 grid w-80 gap-2">
      {notifications.map((notification) => (
        <article
          className={`pointer-events-auto rounded-md border bg-white p-3 shadow-xl ${
            notification.mentioned ? "border-[#A07C3B]/45" : "border-[#d9e0ea]"
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

function HermesAttachmentLightbox({
  attachment,
  onClose,
}: {
  attachment: NonNullable<HermesMessage["attachment"]> | null;
  onClose: () => void;
}) {
  const imageUrl =
    attachment?.type === "image" && attachment.url ? attachment.url : null;

  useEffect(() => {
    if (!imageUrl) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [imageUrl, onClose]);

  if (!attachment || !imageUrl) {
    return null;
  }

  return (
    <div
      aria-label={`Visualizacao de ${attachment.label}`}
      aria-modal="true"
      className="fixed inset-0 z-[300] grid bg-[#101820] p-4 text-white sm:p-6"
      role="dialog"
    >
      <button
        aria-label="Fechar visualizacao de imagem"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        type="button"
      />
      <section className="relative z-10 grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-2xl border border-[#2c3947] bg-[#101820] shadow-[0_28px_80px_rgba(0,0,0,0.45)]">
        <header className="flex min-h-16 items-center justify-between gap-3 border-b border-[#2c3947] bg-[#101820] px-4 py-3">
          <div className="min-w-0">
            <p className="m-0 truncate text-sm font-semibold text-white">
              {attachment.label}
            </p>
            {attachment.sizeBytes ? (
              <p className="m-0 mt-0.5 text-xs text-[#b8c2ce]">
                {formatPreviewFileSize(attachment.sizeBytes)}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <a
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#3a4857] bg-[#182431] px-3 text-xs font-semibold text-white no-underline outline-none transition hover:border-[#A07C3B] hover:text-[#f5dca8] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
              download={attachment.label}
              href={imageUrl}
            >
              <Download aria-hidden="true" size={15} />
              Baixar
            </a>
            <button
              aria-label="Fechar visualizacao"
              className="grid h-9 w-9 place-items-center rounded-lg border border-[#3a4857] bg-[#182431] text-white outline-none transition hover:border-[#A07C3B] hover:text-[#f5dca8] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
              onClick={onClose}
              type="button"
            >
              <X aria-hidden="true" size={17} />
            </button>
          </div>
        </header>
        <div className="min-h-0 bg-black p-3 sm:p-4">
          <div
            aria-label={attachment.label}
            className="h-full max-h-full w-full bg-contain bg-center bg-no-repeat"
            role="img"
            style={{ backgroundImage: `url(${imageUrl})` }}
          />
        </div>
      </section>
    </div>
  );
}

function formatPreviewFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function normalizeHermesRealtimeMessage(
  row: unknown,
  users: readonly HermesPresenceUser[],
) {
  if (!row || typeof row !== "object") {
    return null;
  }

  try {
    const message = mapHermesMessageRow(row as HermesMessageRow);
    const author = users.find((user) => user.id === message.authorId);

    if (!author) {
      return message;
    }

    return {
      ...message,
      authorAvatarUrl: message.authorAvatarUrl ?? author.avatarUrl,
      authorName: message.authorName ?? author.label,
    } satisfies HermesMessage;
  } catch {
    return null;
  }
}

function getLatestHermesDateValue(
  firstDate?: string,
  secondDate?: string,
) {
  if (!firstDate) {
    return secondDate;
  }

  if (!secondDate) {
    return firstDate;
  }

  const firstTime = Date.parse(firstDate);
  const secondTime = Date.parse(secondDate);

  if (Number.isNaN(firstTime)) {
    return secondDate;
  }

  if (Number.isNaN(secondTime)) {
    return firstDate;
  }

  return secondTime > firstTime ? secondDate : firstDate;
}

async function broadcastHermesMessage(
  message: HermesMessage,
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

function mergeHermesChannelMessages({
  channelId,
  currentMessages,
  nextMessages,
  replaceChannel,
}: {
  channelId: HermesChannel["id"];
  currentMessages: readonly HermesMessage[];
  nextMessages: readonly HermesMessage[];
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

    return replaceChannel ? isLocalPendingHermesMessage(message) : true;
  });

  return [...retainedMessages, ...nextMessages].sort(compareHermesMessages);
}

function isLocalPendingHermesMessage(message: HermesMessage) {
  return message.id.startsWith("local-");
}

function compareHermesMessages(
  firstMessage: HermesMessage,
  secondMessage: HermesMessage,
) {
  const firstTime = getHermesMessageSortTime(firstMessage);
  const secondTime = getHermesMessageSortTime(secondMessage);

  if (firstTime !== secondTime) {
    return firstTime - secondTime;
  }

  return firstMessage.id.localeCompare(secondMessage.id);
}

function getHermesMessageSortTime(message: HermesMessage) {
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
  users: HermesPresenceUser[],
  presenceByUserId: Record<
    HermesPresenceUser["id"],
    HermesPresenceUser["status"]
  >,
): HermesPresenceUser[] {
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
  channels: HermesChannel[],
  currentUserId: HermesPresenceUser["id"],
  presenceByUserId: Record<
    HermesPresenceUser["id"],
    HermesPresenceUser["status"]
  >,
): HermesChannel[] {
  let hasChanges = false;
  const nextChannels = channels.map((channel) => {
    if (channel.kind !== "direct") {
      return channel;
    }

    const userId =
      getHermesDirectPeerUserId(channel.id, currentUserId) ??
      channel.memberUserIds?.find((memberUserId) => memberUserId !== currentUserId);

    if (!userId) {
      return channel;
    }

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
  messages: readonly HermesMessage[],
  channels: readonly HermesChannel[],
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

function withChannelUnreadCounts({
  channels,
  currentUserId,
  messages,
}: {
  channels: readonly HermesChannel[];
  currentUserId: HermesPresenceUser["id"];
  messages: readonly HermesMessage[];
}) {
  const messagesByChannelId = new Map<HermesChannel["id"], HermesMessage[]>();

  for (const message of messages) {
    if (message.deletedAt || message.threadParentMessageId) {
      continue;
    }

    const channelMessages = messagesByChannelId.get(message.channelId) ?? [];

    channelMessages.push(message);
    messagesByChannelId.set(message.channelId, channelMessages);
  }

  return channels.map((channel) => {
    const lastReadAt = channel.memberReadAtByUserId?.[currentUserId];
    const lastReadTime = lastReadAt ? Date.parse(lastReadAt) : Number.NaN;
    const unreadCount = (messagesByChannelId.get(channel.id) ?? []).filter(
      (message) =>
        message.authorId !== currentUserId &&
        isMessageNewerThanLastRead(message, lastReadTime),
    ).length;

    return {
      ...channel,
      unreadCount,
    };
  });
}

function isMessageNewerThanLastRead(
  message: HermesMessage,
  lastReadTime: number,
) {
  const createdAt = message.createdAt ?? message.timestamp;
  const messageTime = Date.parse(createdAt);

  if (Number.isNaN(messageTime)) {
    return false;
  }

  if (Number.isNaN(lastReadTime)) {
    return true;
  }

  return messageTime > lastReadTime;
}

function getMessageRecipientUserIds({
  channel,
  messageAuthorId,
}: {
  channel: HermesChannel;
  messageAuthorId: HermesPresenceUser["id"];
}) {
  return (channel.memberUserIds ?? []).filter(
    (userId) => userId !== messageAuthorId,
  );
}

function getMessageReadUserIds(message: HermesMessage, channel: HermesChannel) {
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
  message: HermesMessage,
  channelId: HermesChannel["id"],
): HermesPresenceUser {
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

function getPresenceUsersForChannel(
  channel: HermesChannel,
  users: readonly HermesPresenceUser[],
) {
  return users.filter(
    (user) =>
      (user.channelIds as readonly string[]).includes(channel.id) ||
      Boolean(channel.memberUserIds?.includes(user.id)),
  );
}

function withUserChannelAccess(
  users: readonly HermesPresenceUser[],
  channels: readonly HermesChannel[],
): HermesPresenceUser[] {
  return users.map((user) => {
    return {
      ...user,
      channelIds: channels
        .filter((channel) => {
          if (channel.kind === "direct") {
            return Boolean(channel.memberUserIds?.includes(user.id));
          }

          return channel.memberUserIds?.includes(user.id);
        })
        .map((channel) => channel.id),
    };
  });
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
  message: HermesMessage,
  userId: HermesPresenceUser["id"],
) {
  return (
    message.authorId !== userId &&
    Boolean(message.mentionUserIds?.includes(userId))
  );
}

function getHermesThreadReadStorageKey(userId: HermesPresenceUser["id"]) {
  return `${HERMES_THREAD_READ_STORAGE_PREFIX}:${userId}`;
}

function normalizeThreadReadState(
  input: unknown,
): Record<string, HermesThreadReadReceipt> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  const nextState: Record<string, HermesThreadReadReceipt> = {};

  for (const [messageId, value] of Object.entries(input)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }

    const record = value as Record<string, unknown>;
    const threadCount =
      typeof record.threadCount === "number" &&
      Number.isFinite(record.threadCount)
        ? Math.max(0, Math.floor(record.threadCount))
        : 0;

    nextState[messageId] = {
      lastReplyAt:
        typeof record.lastReplyAt === "string"
          ? record.lastReplyAt
          : undefined,
      readAt:
        typeof record.readAt === "string"
          ? record.readAt
          : new Date().toISOString(),
      threadCount,
    };
  }

  return nextState;
}

function getThreadUnreadCountForMessage(
  message: HermesMessage,
  receipt: HermesThreadReadReceipt | undefined,
) {
  if (message.deletedAt || message.threadParentMessageId) {
    return 0;
  }

  const threadCount = message.threadCount ?? 0;

  if (threadCount <= 0 || !receipt) {
    return 0;
  }

  return Math.max(0, threadCount - receipt.threadCount);
}

function getThreadParentPreview(message: HermesMessage) {
  const value =
    message.body.trim() ||
    message.attachment?.label ||
    "Mensagem com resposta";

  return value.length > 92 ? `${value.slice(0, 89)}...` : value;
}

function formatThreadNotificationTime(value: string | undefined) {
  if (!value) {
    return "--:--";
  }

  const time = Date.parse(value);

  if (Number.isNaN(time)) {
    return value;
  }

  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(time));
}

function getLatestThreadReplyCreatedAt(
  replies: readonly HermesThreadReply[],
) {
  return replies.reduce<string | undefined>((latestValue, reply) => {
    if (!reply.createdAt) {
      return latestValue;
    }

    if (!latestValue) {
      return reply.createdAt;
    }

    const latestTime = Date.parse(latestValue);
    const replyTime = Date.parse(reply.createdAt);

    if (Number.isNaN(latestTime)) {
      return reply.createdAt;
    }

    if (Number.isNaN(replyTime)) {
      return latestValue;
    }

    return replyTime > latestTime ? reply.createdAt : latestValue;
  }, undefined);
}

function getThreadNotificationSortTime(
  notification: HermesThreadNotificationEntry,
  messages: readonly HermesMessage[],
) {
  const message = messages.find(
    (currentMessage) => currentMessage.id === notification.messageId,
  );
  const time = Date.parse(
    message?.lastThreadReplyAt ?? message?.createdAt ?? "",
  );

  return Number.isNaN(time) ? 0 : time;
}

const emptyHermesChannel = {
  avatar: "--",
  context: {
    filesCount: 0,
    owner: "Hermes",
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
} satisfies HermesChannel;

function createLocalCallSession({
  channel,
  currentUserId,
  fallbackUsers,
  participants,
  type,
}: {
  channel: HermesChannel;
  currentUserId: HermesPresenceUser["id"];
  fallbackUsers: readonly HermesPresenceUser[];
  participants: readonly HermesPresenceUser[];
  type: HermesCallType;
}): HermesCallSession {
  const fallbackCurrentUser = fallbackUsers.find(
    (user) => user.id === currentUserId,
  );
  const callUsers =
    fallbackCurrentUser &&
    !participants.some((user) => user.id === currentUserId)
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
    startedAt: new Date().toISOString(),
    status: "active",
    title: channel.name,
    type,
  };
}

const hermesReactionOptions = [
  "\u{1F44D}",
  "\u2764\uFE0F",
  "\u{1F602}",
  "\u{1F62E}",
  "\u{1F622}",
  "\u{1F64F}",
] as const satisfies readonly HermesReactionEmoji[];
