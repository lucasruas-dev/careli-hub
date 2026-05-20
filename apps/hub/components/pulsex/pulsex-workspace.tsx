"use client";

import { AthenaIcon } from "@/components/athena-icon";
import { listHubPresence } from "@/lib/hub-presence";
import {
  createHermesMessage,
  createHermesThreadReply,
  listChannelMessages,
  listHermesThreadReplies,
  loadHermesOperationalData,
  markHermesChannelRead,
  updateHermesMessageBody,
  updateHermesMessageReaction,
  updateHermesMessageTags,
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
import { Bell, X } from "lucide-react";
import type {
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
  HermesReactionEmoji,
  HermesThreadReply,
} from "@/lib/pulsex";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AthenaAgentPanel } from "./athena-agent-panel";
import { ConversationHeader } from "./conversation-header";
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

const PULSEX_PRESENCE_REFRESH_MS = 5_000;
const PULSEX_MESSAGE_REFRESH_MS = 4_000;
const PULSEX_FAVORITE_CHANNELS_STORAGE_KEY = "careli:pulsex:favorite-channels";

type HubSupabaseClient = NonNullable<ReturnType<typeof getHubSupabaseClient>>;
type HubRealtimeChannel = ReturnType<HubSupabaseClient["channel"]>;

export function HermesWorkspace() {
  const { hubUser, profileStatus } = useAuth();
  const {
    callSoundId,
    callSoundOptions,
    previewCallSound,
    setCallSoundId,
    startCall,
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
  const knownMessageIdsRef = useRef<Set<string>>(new Set());
  const loadedChannelIdsRef = useRef<Set<string>>(new Set());
  const messageRealtimeChannelRef = useRef<HubRealtimeChannel | null>(null);
  const athenaAgentPanelRef = useRef<HTMLDivElement>(null);
  const threadPanelRef = useRef<HTMLDivElement>(null);
  const [notifications, setNotifications] = useState<HermesToastNotification[]>(
    [],
  );
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

  const loadOperationalData = useCallback(() => {
    if (profileStatus === "loading") {
      setDataStatus("loading");
      return;
    }

    let isMounted = true;

    setDataStatus("loading");
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
          currentUserId,
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

        setDataStatus("fallback");
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
        activeChannel.kind === "direct" ||
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
      activeChannel.kind === "direct" ||
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
  ]);

  useEffect(() => {
    if (
      !hasHubSupabaseConfig() ||
      activeChannel.kind === "direct" ||
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
    setIsAthenaAgentOpen(false);
    setAthenaFocusedMessageId(null);
    setActiveThreadMessageId(messageId);
    loadThreadReplies(messageId);
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

  function handleStartCall(type: HermesCallType) {
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
        (userId): userId is HermesPresenceUser["id"] =>
          Boolean(userId) && userId !== currentUserId,
      );

    startCall({ session, targetUserIds });
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

    if (!hasHubSupabaseConfig() || activeChannel.kind === "direct") {
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

  function handleToggleMessageTag(
    messageId: HermesMessage["id"],
    tag: HermesMessageTag,
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
          ? reaction.reactedByUserIds.filter(
              (userId) => userId !== currentUserId,
            )
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

    if (!hasHubSupabaseConfig() || messageId.startsWith("local-")) {
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
      })
      .catch((error: unknown) => {
        if (isLocalDevelopmentRuntime()) {
          console.warn("[hermes] update message reaction error", error);
        }
      });
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
              lastThreadReplyAt: timestamp,
              threadCount: (message.threadCount ?? 0) + 1,
            }
          : message,
      ),
    );
    setThreadComposerValue("");

    if (
      !hasHubSupabaseConfig() ||
      activeThreadMessage.id.startsWith("local-")
    ) {
      return;
    }

    createHermesThreadReply({
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
            callSoundOptions={callSoundOptions}
            channel={activeChannel}
            isFavorite={favoriteChannelIdsSet.has(activeChannel.id)}
            onChangeCallSound={setCallSoundId}
            onPreviewCallSound={previewCallSound}
            onStartCall={handleStartCall}
            onToggleFavorite={handleToggleFavoriteChannel}
            presenceUsers={channelPresenceUsers}
            selectedCallSoundId={callSoundId}
          />
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-[#f3f6fa] py-4">
            <MessageList
              currentUserId={currentUserId}
              filter={activeMessageFilter}
              messages={filteredChannelMessages}
              onAskAiReply={handleOpenAthenaAgentForMessage}
              onEditMessage={handleEditMessage}
              onOpenThread={handleOpenThread}
              onToggleReaction={handleToggleReaction}
              onToggleTag={handleToggleMessageTag}
              reactionOptions={hermesReactionOptions}
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
              className="absolute inset-y-0 right-0 z-10 w-[24rem] shadow-2xl"
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
                onSubmitReply={handleSubmitThreadReply}
                onToggleReaction={handleToggleReaction}
                reactionOptions={hermesReactionOptions}
                replies={activeThreadReplies}
                replyValue={threadComposerValue}
                users={presenceUsers}
              />
            </div>
          ) : null}
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
  const existingChannelIds = new Set(channels.map((channel) => channel.id));
  const directChannels = users
    .filter((user) => user.id !== currentUserId)
    .map((user) => ({
      avatar: user.initials,
      avatarUrl: user.avatarUrl,
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
    })) satisfies HermesChannel[];

  return [
    ...channels,
    ...directChannels.filter((channel) => !existingChannelIds.has(channel.id)),
  ];
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

function withUserChannelAccess(
  users: readonly HermesPresenceUser[],
  channels: readonly HermesChannel[],
  currentUserId: HermesPresenceUser["id"],
): HermesPresenceUser[] {
  return users.map((user) => {
    return {
      ...user,
      channelIds: channels
        .filter((channel) => {
          if (channel.kind === "direct") {
            return (
              user.id === currentUserId || channel.id === `direct-${user.id}`
            );
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
    startedAt: "agora",
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
