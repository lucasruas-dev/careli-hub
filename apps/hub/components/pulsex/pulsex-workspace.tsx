"use client";

import { AthenaIcon } from "@/components/athena-icon";
import { listHubPresence } from "@/lib/hub-presence";
import {
  createHermesMessage,
  createHermesThreadReply,
  listChannelMessages,
  listHermesThreadReplies,
  listRecentChannelMessages,
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
  broadcastHermesMessage,
  getHermesMessagePostgresRealtimeTopic,
  getHermesMessageRealtimeTopic,
  parseHermesMessageBroadcastPayload,
} from "@/lib/pulsex/realtime";
import {
  createHermesDirectChannelId,
  getHermesDirectPeerUserId,
} from "@/lib/pulsex/direct-channel";
import {
  registerHermesNotificationPermissionIntent,
} from "@/lib/pulsex/notification-effects";
import {
  getMessageRecipientUserIds,
  mergeHermesChannelMessages,
  toggleHermesReactions,
  withChannelUnreadCounts,
  withMessageDeliveryData,
} from "@/lib/pulsex/workspace-messages";
import {
  getHermesThreadReadStorageKey,
  getHermesThreadUnreadCount,
  getLatestHermesThreadReplyCreatedAt,
  normalizeHermesThreadReadState,
  type HermesThreadReadReceipt,
} from "@/lib/pulsex/thread-notifications";
import { useOutsideDismiss } from "@/hooks/use-outside-dismiss";
import { Tooltip } from "@repo/uix";
import {
  getHubSupabaseClient,
  hasHubSupabaseConfig,
  logSupabaseDiagnostic,
} from "@/lib/supabase/client";
import { useAuth } from "@/providers/auth-provider";
import { useHermesCall } from "@/providers/pulsex-call-provider";
import { usePanteonNotifications } from "@/providers/pulsex-notification-provider";
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
  HermesReactionEmoji,
  HermesThreadReply,
} from "@/lib/pulsex";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
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

const HERMES_PRESENCE_REFRESH_MS = 60_000;
const HERMES_MESSAGE_REFRESH_MS = 8_000;
const HERMES_WORKSPACE_REFRESH_MS = 300_000;
const HERMES_CHANNEL_MESSAGE_CACHE_LIMIT = 50;
const HERMES_CHANNEL_MESSAGE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const HERMES_CHANNEL_MESSAGE_CACHE_FRESH_MS = 5 * 60 * 1_000;
const HERMES_PREFETCH_MESSAGE_LIMIT = 200;
const HERMES_CHANNEL_MESSAGE_CACHE_VERSION = 1;
const HERMES_CHANNEL_MESSAGE_CACHE_STORAGE_PREFIX =
  "careli:hermes:channel-message-cache";
const HERMES_COMPOSER_DRAFT_STORAGE_PREFIX = "careli:hermes:composer-draft";
const PULSEX_FAVORITE_CHANNELS_STORAGE_KEY = "careli:pulsex:favorite-channels";
type HubSupabaseClient = NonNullable<ReturnType<typeof getHubSupabaseClient>>;
type HubRealtimeChannel = ReturnType<HubSupabaseClient["channel"]>;
type HermesChannelMessageCache = {
  cachedAt: string;
  channelId: HermesChannel["id"];
  messages: HermesMessage[];
  version: typeof HERMES_CHANNEL_MESSAGE_CACHE_VERSION;
};

export function HermesWorkspace() {
  const { hubUser, profileStatus } = useAuth();
  const { broadcastHermesMessageEvent, hermesChannels: notificationChannels } =
    usePanteonNotifications();
  const { callHistory, markCallHistoryRead, startCall, unreadCallCount } =
    useHermesCall();
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
  const [
    isAthenaTicketRecordingMinimized,
    setIsAthenaTicketRecordingMinimized,
  ] = useState(false);
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
  const [threadComposerMentions, setThreadComposerMentions] = useState<
    readonly HermesMessageMention[]
  >([]);
  const [dataStatus, setDataStatus] = useState<
    "fallback" | "loading" | "ready"
  >("loading");
  const [loadingMessageChannelIds, setLoadingMessageChannelIds] = useState<
    HermesChannel["id"][]
  >([]);
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
  const messageCursorByChannelIdRef = useRef<Map<string, string>>(new Map());
  const messageLoadInFlightByChannelIdRef = useRef<Set<string>>(new Set());
  const staleMessageCacheChannelIdsRef = useRef<Set<string>>(new Set());
  const messagesPrefetchedRef = useRef(false);
  const olderMessagesInFlightByChannelIdRef = useRef<Set<string>>(new Set());
  const hasMoreOlderMessagesByChannelIdRef = useRef<Map<string, boolean>>(
    new Map(),
  );
  const messageScrollContainerRef = useRef<HTMLDivElement>(null);
  const pendingOlderScrollRestoreRef = useRef<{
    prevScrollHeight: number;
    prevScrollTop: number;
  } | null>(null);
  const composerValueRef = useRef("");
  const composerDraftChannelIdRef = useRef<HermesChannel["id"] | null>(null);
  const isComposerDraftHydratingRef = useRef(false);
  const messageRealtimeChannelRef = useRef<HubRealtimeChannel | null>(null);
  const messagePostgresRealtimeChannelRef = useRef<HubRealtimeChannel | null>(
    null,
  );
  const queryChannelAppliedRef = useRef(false);
  const athenaAgentPanelRef = useRef<HTMLDivElement>(null);
  const threadPanelRef = useRef<HTMLDivElement>(null);
  const [notifications, setNotifications] = useState<HermesToastNotification[]>(
    [],
  );
  const [attachmentPreview, setAttachmentPreview] = useState<NonNullable<
    HermesMessage["attachment"]
  > | null>(null);
  const activeChannel =
    channels.find((channel) => channel.id === activeChannelId) ??
    channels[0] ??
    emptyHermesChannel;

  useEffect(() => {
    composerValueRef.current = composerValue;
  }, [composerValue]);

  useEffect(() => {
    if (activeChannel.id === emptyHermesChannel.id) {
      return;
    }

    const previousChannelId = composerDraftChannelIdRef.current;

    if (previousChannelId && previousChannelId !== activeChannel.id) {
      writeHermesComposerDraft(previousChannelId, composerValueRef.current);
    }

    composerDraftChannelIdRef.current = activeChannel.id;
    const nextDraft = readHermesComposerDraft(activeChannel.id);
    isComposerDraftHydratingRef.current = true;
    composerValueRef.current = nextDraft;
    setComposerValue(nextDraft);
    setComposerMentions([]);

    const timeoutId = window.setTimeout(() => {
      isComposerDraftHydratingRef.current = false;
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [activeChannel.id]);

  useEffect(() => {
    if (
      activeChannel.id === emptyHermesChannel.id ||
      isComposerDraftHydratingRef.current
    ) {
      return;
    }

    writeHermesComposerDraft(activeChannel.id, composerValue);
  }, [activeChannel.id, composerValue]);

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
      setThreadComposerMentions([]);
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
  const isActiveChannelMessageLoading =
    loadingMessageChannelIds.includes(activeChannel.id) ||
    (hasHubSupabaseConfig() &&
      dataStatus === "ready" &&
      activeChannel.id !== emptyHermesChannel.id &&
      channelMessages.length === 0 &&
      !loadedChannelIdsRef.current.has(activeChannel.id));
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
      const unreadCount = getHermesThreadUnreadCount(
        message,
        threadReadState[message.id],
      );

      if (unreadCount > 0) {
        unreadCountByMessageId.set(message.id, unreadCount);
      }
    }

    return unreadCountByMessageId;
  }, [messages, threadReadState]);
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
        );

        const nextMessages = withMessageDeliveryData(
          payload.messages,
          nextChannels,
        );
        writeHermesChannelMessageCaches({
          messages: nextMessages,
          userId: currentUserId,
        });
        const nextChannelsWithUnread = withChannelUnreadCounts({
          channels: nextChannels,
          currentUserId,
          messages: nextMessages,
        });

        nextMessages.forEach((message) =>
          knownMessageIdsRef.current.add(message.id),
        );
        rememberHermesMessageCursors(
          messageCursorByChannelIdRef.current,
          nextMessages,
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

  useEffect(() => registerHermesNotificationPermissionIntent(), []);

  useEffect(() => {
    if (notificationChannels.length === 0) {
      return;
    }

    const notificationChannelsById = new Map(
      notificationChannels.map((channel) => [channel.id, channel] as const),
    );

    setChannels((currentChannels) =>
      preserveHermesArrayReference(
        currentChannels,
        currentChannels.map((channel) => {
          if (channel.id === activeChannel.id) {
            return channel;
          }

          const notificationChannel = notificationChannelsById.get(channel.id);

          if (!notificationChannel) {
            return channel;
          }

          return {
            ...channel,
            lastMessageAt: notificationChannel.lastMessageAt,
            preview: notificationChannel.preview,
            unreadCount: notificationChannel.unreadCount,
          };
        }),
        getHermesChannelRenderSignature,
      ),
    );
  }, [activeChannel.id, notificationChannels]);

  useEffect(() => {
    if (
      messagesPrefetchedRef.current ||
      dataStatus !== "ready" ||
      !hasHubSupabaseConfig() ||
      !currentUserId ||
      channels.length === 0
    ) {
      return;
    }

    const channelIds = channels
      .map((channel) => channel.id)
      .filter((channelId) => channelId !== emptyHermesChannel.id);

    if (channelIds.length === 0) {
      return;
    }

    let isMounted = true;

    messagesPrefetchedRef.current = true;
    listRecentChannelMessages({
      channelIds,
      limit: HERMES_PREFETCH_MESSAGE_LIMIT,
    })
      .then((recentMessages) => {
        if (!isMounted || recentMessages.length === 0) {
          return;
        }

        writeHermesChannelMessageCaches({
          messages: withMessageDeliveryData(recentMessages, channels),
          userId: currentUserId,
        });
      })
      .catch((error: unknown) => {
        logSupabaseDiagnostic("pulsex", "message cache prefetch error", {
          error,
        });
      });

    return () => {
      isMounted = false;
    };
  }, [channels, currentUserId, dataStatus]);

  useEffect(() => {
    if (queryChannelAppliedRef.current || channels.length === 0) {
      return;
    }

    const channelId = new URLSearchParams(window.location.search).get(
      "channel",
    );

    if (!channelId || !channels.some((channel) => channel.id === channelId)) {
      queryChannelAppliedRef.current = true;
      return;
    }

    queryChannelAppliedRef.current = true;
    setActiveChannelId(channelId);
  }, [channels]);

  useLayoutEffect(() => {
    if (
      activeChannel.id === emptyHermesChannel.id ||
      channels.length === 0 ||
      channelMessages.length > 0
    ) {
      return;
    }

    const cachedChannelMessages = readHermesChannelMessageCache({
      channelId: activeChannel.id,
      userId: currentUserId,
    });

    if (!cachedChannelMessages || cachedChannelMessages.messages.length === 0) {
      return;
    }

    const nextMessages = withMessageDeliveryData(
      cachedChannelMessages.messages,
      channels,
    );

    if (nextMessages.length === 0) {
      return;
    }

    nextMessages.forEach((message) =>
      knownMessageIdsRef.current.add(message.id),
    );

    if (isHermesChannelMessageCacheFresh(cachedChannelMessages)) {
      rememberHermesMessageCursors(
        messageCursorByChannelIdRef.current,
        nextMessages,
      );
      loadedChannelIdsRef.current.add(activeChannel.id);
    } else {
      staleMessageCacheChannelIdsRef.current.add(activeChannel.id);
    }

    setMessages((currentMessages) => {
      if (
        currentMessages.some(
          (message) => message.channelId === activeChannel.id,
        )
      ) {
        return currentMessages;
      }

      return preserveHermesArrayReference(
        currentMessages,
        mergeHermesChannelMessages({
          channelId: activeChannel.id,
          currentMessages,
          nextMessages,
          replaceChannel: true,
        }),
        getHermesMessageRenderSignature,
      );
    });
  }, [activeChannel.id, channelMessages.length, channels, currentUserId]);

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

      setThreadReadState(normalizeHermesThreadReadState(parsedValue));
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

  useEffect(() => {
    if (activeChannel.id === emptyHermesChannel.id || messages.length === 0) {
      return;
    }

    if (staleMessageCacheChannelIdsRef.current.has(activeChannel.id)) {
      return;
    }

    const messagesForActiveChannel = messages.filter(
      (message) => message.channelId === activeChannel.id,
    );

    writeHermesChannelMessageCache({
      channelId: activeChannel.id,
      messages: messagesForActiveChannel,
      userId: currentUserId,
    });
  }, [activeChannel.id, currentUserId, messages]);

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
    }, HERMES_PRESENCE_REFRESH_MS);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [dataStatus, refreshPresenceStatuses]);

  // Notificacao do Hermes foi CENTRALIZADA no HermesNotificationProvider (som +
  // toast + Central + log por mensagem) e no Web Push (notificacao do SO, sempre com
  // avatar). O workspace nao alerta mais — isso elimina o duplo-disparo, o re-disparo
  // ao reabrir (catch-up/poll) e a notificacao de SO generica do time. Mantido como
  // no-op para nao mexer nos call sites (carga inicial / realtime).
  const notifyIncomingMessages = useCallback(
    (_newMessages: readonly HermesMessage[]) => {},
    [],
  );

  // Avisa o provider global qual conversa esta aberta para ele NAO alertar
  // (som/toast) o canal que o usuario ja esta vendo. Limpa ao trocar/sair.
  useEffect(() => {
    const channelId =
      activeChannel.id === emptyHermesChannel.id ? null : activeChannel.id;

    window.dispatchEvent(
      new CustomEvent("careli:hermes:active-channel", {
        detail: { channelId },
      }),
    );

    return () => {
      window.dispatchEvent(
        new CustomEvent("careli:hermes:active-channel", {
          detail: { channelId: null },
        }),
      );
    };
  }, [activeChannel.id]);

  const loadActiveChannelMessages = useCallback(
    (shouldApply: () => boolean = () => true) => {
      if (
        !hasHubSupabaseConfig() ||
        activeChannel.id === emptyHermesChannel.id
      ) {
        return;
      }

      const channelId = activeChannel.id;
      const cursor = messageCursorByChannelIdRef.current.get(channelId);

      if (messageLoadInFlightByChannelIdRef.current.has(channelId)) {
        return;
      }

      messageLoadInFlightByChannelIdRef.current.add(channelId);
      setLoadingMessageChannelIds((currentChannelIds) =>
        currentChannelIds.includes(channelId)
          ? currentChannelIds
          : [...currentChannelIds, channelId],
      );
      listChannelMessages(channelId, cursor ? { after: cursor } : undefined)
        .then((nextMessages) => {
          if (!shouldApply()) {
            return;
          }

          const nextDeliveredMessages = withMessageDeliveryData(
            nextMessages,
            channels,
          );
          const isFirstChannelLoad =
            !loadedChannelIdsRef.current.has(channelId);
          const newMessages = nextDeliveredMessages.filter(
            (message) => !knownMessageIdsRef.current.has(message.id),
          );

          rememberHermesMessageCursors(
            messageCursorByChannelIdRef.current,
            nextDeliveredMessages,
          );
          nextDeliveredMessages.forEach((message) =>
            knownMessageIdsRef.current.add(message.id),
          );
          loadedChannelIdsRef.current.add(channelId);
          staleMessageCacheChannelIdsRef.current.delete(channelId);

          if (!isFirstChannelLoad) {
            notifyIncomingMessages(
              newMessages.filter(
                (message) => message.authorId !== currentUserId,
              ),
            );
          }

          if (nextDeliveredMessages.length === 0) {
            if (!cursor) {
              setMessages((currentMessages) =>
                currentMessages.some((message) => message.channelId === channelId)
                  ? currentMessages
                  : preserveHermesArrayReference(
                      currentMessages,
                      mergeHermesChannelMessages({
                        channelId,
                        currentMessages,
                        nextMessages: [],
                        replaceChannel: true,
                      }),
                      getHermesMessageRenderSignature,
                    ),
              );
            }
            return;
          }

          setMessages((currentMessages) =>
            preserveHermesArrayReference(
              currentMessages,
              mergeHermesChannelMessages({
                channelId,
                currentMessages,
                nextMessages: nextDeliveredMessages,
                replaceChannel: !cursor,
              }),
              getHermesMessageRenderSignature,
            ),
          );
        })
        .catch((error: unknown) => {
          if (isLocalDevelopmentRuntime()) {
            console.warn("[pulsex] list channel messages error", error);
          }
        })
        .finally(() => {
          messageLoadInFlightByChannelIdRef.current.delete(channelId);
          setLoadingMessageChannelIds((currentChannelIds) =>
            currentChannelIds.filter(
              (currentChannelId) => currentChannelId !== channelId,
            ),
          );
        });
    },
    [activeChannel.id, channels, currentUserId, notifyIncomingMessages],
  );

  const loadOlderActiveChannelMessages = useCallback(() => {
    if (!hasHubSupabaseConfig() || activeChannel.id === emptyHermesChannel.id) {
      return;
    }

    const channelId = activeChannel.id;

    if (
      olderMessagesInFlightByChannelIdRef.current.has(channelId) ||
      hasMoreOlderMessagesByChannelIdRef.current.get(channelId) === false
    ) {
      return;
    }

    let oldestCreatedAt: string | undefined;

    for (const message of messages) {
      if (message.channelId !== channelId || !message.createdAt) {
        continue;
      }

      if (
        !oldestCreatedAt ||
        Date.parse(message.createdAt) < Date.parse(oldestCreatedAt)
      ) {
        oldestCreatedAt = message.createdAt;
      }
    }

    if (!oldestCreatedAt) {
      return;
    }

    const scrollContainer = messageScrollContainerRef.current;

    if (scrollContainer) {
      pendingOlderScrollRestoreRef.current = {
        prevScrollHeight: scrollContainer.scrollHeight,
        prevScrollTop: scrollContainer.scrollTop,
      };
    }

    olderMessagesInFlightByChannelIdRef.current.add(channelId);

    listChannelMessages(channelId, { before: oldestCreatedAt, limit: 50 })
      .then((olderMessages) => {
        if (olderMessages.length === 0) {
          hasMoreOlderMessagesByChannelIdRef.current.set(channelId, false);
          pendingOlderScrollRestoreRef.current = null;
          return;
        }

        const deliveredOlderMessages = withMessageDeliveryData(
          olderMessages,
          channels,
        );
        deliveredOlderMessages.forEach((message) =>
          knownMessageIdsRef.current.add(message.id),
        );

        setMessages((currentMessages) =>
          preserveHermesArrayReference(
            currentMessages,
            mergeHermesChannelMessages({
              channelId,
              currentMessages,
              nextMessages: deliveredOlderMessages,
              replaceChannel: false,
            }),
            getHermesMessageRenderSignature,
          ),
        );
      })
      .catch((error: unknown) => {
        pendingOlderScrollRestoreRef.current = null;

        if (isLocalDevelopmentRuntime()) {
          console.warn("[pulsex] load older channel messages error", error);
        }
      })
      .finally(() => {
        olderMessagesInFlightByChannelIdRef.current.delete(channelId);
      });
  }, [activeChannel.id, channels, messages]);

  const handleMessageScroll = useCallback(() => {
    const scrollContainer = messageScrollContainerRef.current;

    if (scrollContainer && scrollContainer.scrollTop <= 64) {
      loadOlderActiveChannelMessages();
    }
  }, [loadOlderActiveChannelMessages]);

  useLayoutEffect(() => {
    const restore = pendingOlderScrollRestoreRef.current;
    const scrollContainer = messageScrollContainerRef.current;

    if (!restore || !scrollContainer) {
      return;
    }

    pendingOlderScrollRestoreRef.current = null;
    const addedHeight = scrollContainer.scrollHeight - restore.prevScrollHeight;

    if (addedHeight > 0) {
      scrollContainer.scrollTop = restore.prevScrollTop + addedHeight;
    }
  }, [messages]);

  const refreshWorkspaceSnapshot = useCallback(
    (shouldApply: () => boolean = () => true) => {
      if (!hasHubSupabaseConfig() || dataStatus !== "ready") {
        return;
      }

      loadHermesOperationalData({
        currentUserId,
        userRole: hubUser?.role,
      })
        .then((payload) => {
          if (!shouldApply()) {
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
          setChannels((currentChannels) =>
            preserveHermesArrayReference(
              currentChannels,
              preserveHermesChannelRuntimeState(currentChannels, nextChannels),
              getHermesChannelRenderSignature,
            ),
          );
          setDepartments(payload.departments);
          setPresenceUsers((currentUsers) =>
            preserveHermesArrayReference(
              currentUsers,
              nextPresenceUsers,
              getHermesPresenceUserRenderSignature,
            ),
          );
        })
        .catch((error: unknown) => {
          if (isLocalDevelopmentRuntime()) {
            console.warn("[pulsex] refresh workspace error", error);
          }
        });
    },
    [currentUserId, dataStatus, hubUser?.role],
  );

  useEffect(() => {
    if (!hasHubSupabaseConfig() || activeChannel.id === emptyHermesChannel.id) {
      return;
    }

    let isMounted = true;

    loadActiveChannelMessages(() => isMounted);
    const intervalId = window.setInterval(() => {
      loadActiveChannelMessages(() => isMounted);
    }, HERMES_MESSAGE_REFRESH_MS);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [activeChannel.id, activeChannel.kind, loadActiveChannelMessages]);

  // Catch-up ao focar/restaurar: o navegador congela a PWA minimizada (websocket
  // realtime suspenso, poll parado). Ao voltar o foco, refetch imediato do canal ativo
  // para nao esperar o proximo ciclo de poll — era o "demorou a aparecer" ao reabrir.
  useEffect(() => {
    if (!hasHubSupabaseConfig() || activeChannel.id === emptyHermesChannel.id) {
      return;
    }

    const handleFocusCatchUp = () => {
      if (document.visibilityState === "visible") {
        loadActiveChannelMessages();
      }
    };

    document.addEventListener("visibilitychange", handleFocusCatchUp);
    window.addEventListener("focus", handleFocusCatchUp);

    return () => {
      document.removeEventListener("visibilitychange", handleFocusCatchUp);
      window.removeEventListener("focus", handleFocusCatchUp);
    };
  }, [activeChannel.id, loadActiveChannelMessages]);

  useEffect(() => {
    if (!hasHubSupabaseConfig() || dataStatus !== "ready") {
      return;
    }

    let isMounted = true;
    const intervalId = window.setInterval(() => {
      refreshWorkspaceSnapshot(() => isMounted);
    }, HERMES_WORKSPACE_REFRESH_MS);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [dataStatus, refreshWorkspaceSnapshot]);

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

    const broadcastRealtimeChannel = client.channel(
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
    const postgresRealtimeChannel = client.channel(
      getHermesMessagePostgresRealtimeTopic(activeChannel.id, "workspace"),
    );

    messageRealtimeChannelRef.current = broadcastRealtimeChannel;
    messagePostgresRealtimeChannelRef.current = postgresRealtimeChannel;
    broadcastRealtimeChannel
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

          rememberHermesMessageCursors(messageCursorByChannelIdRef.current, [
            nextDeliveredMessage,
          ]);
          knownMessageIdsRef.current.add(nextDeliveredMessage.id);
          loadedChannelIdsRef.current.add(nextDeliveredMessage.channelId);
          setMessages((currentMessages) =>
            preserveHermesArrayReference(
              currentMessages,
              mergeHermesChannelMessages({
                channelId: activeChannel.id,
                currentMessages,
                nextMessages: [nextDeliveredMessage],
                replaceChannel: false,
              }),
              getHermesMessageRenderSignature,
            ),
          );

          if (nextDeliveredMessage.authorId !== currentUserId) {
            notifyIncomingMessages([nextDeliveredMessage]);
          }
        },
      )
      .subscribe((status) => {
        logSupabaseDiagnostic("pulsex", "message broadcast status", {
          channelId: activeChannel.id,
          status,
        });
      });

    postgresRealtimeChannel
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          filter: `channel_id=eq.${activeChannel.id}`,
          schema: "public",
          table: "pulsex_messages",
        },
        () => {
          loadActiveChannelMessages();
        },
      )
      .subscribe((status) => {
        logSupabaseDiagnostic("pulsex", "message postgres realtime status", {
          channelId: activeChannel.id,
          status,
        });
      });

    return () => {
      if (messageRealtimeChannelRef.current === broadcastRealtimeChannel) {
        messageRealtimeChannelRef.current = null;
      }
      if (
        messagePostgresRealtimeChannelRef.current === postgresRealtimeChannel
      ) {
        messagePostgresRealtimeChannelRef.current = null;
      }

      void client.removeChannel(broadcastRealtimeChannel);
      void client.removeChannel(postgresRealtimeChannel);
    };
  }, [
    activeChannel.id,
    activeChannel.kind,
    channels,
    currentUserId,
    dataStatus,
    loadActiveChannelMessages,
    notifyIncomingMessages,
  ]);

  // B: ponte do broadcast global (confiavel) -> conversa ativa. Funde a mensagem na
  // hora quando o provider a recebe, sem depender do broadcast por-canal/poll. NAO
  // re-notifica aqui (som/central ja sao tratados pelo provider).
  useEffect(() => {
    function handleGlobalHermesMessage(event: Event) {
      const message = (event as CustomEvent<{ message?: HermesMessage }>).detail
        ?.message;

      if (
        !message ||
        message.channelId !== activeChannel.id ||
        message.threadParentMessageId
      ) {
        return;
      }

      const [nextDeliveredMessage] = withMessageDeliveryData(
        [message],
        channels,
      );

      if (!nextDeliveredMessage) {
        return;
      }

      rememberHermesMessageCursors(messageCursorByChannelIdRef.current, [
        nextDeliveredMessage,
      ]);
      knownMessageIdsRef.current.add(nextDeliveredMessage.id);
      loadedChannelIdsRef.current.add(nextDeliveredMessage.channelId);
      setMessages((currentMessages) =>
        preserveHermesArrayReference(
          currentMessages,
          mergeHermesChannelMessages({
            channelId: activeChannel.id,
            currentMessages,
            nextMessages: [nextDeliveredMessage],
            replaceChannel: false,
          }),
          getHermesMessageRenderSignature,
        ),
      );
    }

    window.addEventListener("careli:hermes:message", handleGlobalHermesMessage);

    return () =>
      window.removeEventListener(
        "careli:hermes:message",
        handleGlobalHermesMessage,
      );
  }, [activeChannel.id, channels]);

  useEffect(() => {
    if (!hasHubSupabaseConfig() || activeChannel.id === emptyHermesChannel.id) {
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
        setNotifications((currentNotifications) =>
          currentNotifications.filter(
            (notification) => notification.channelId !== receipt.channelId,
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
        const latestReplyAt = getLatestHermesThreadReplyCreatedAt(nextReplies);

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
    replaceHermesChannelUrl(channelId);
    setIsAthenaAgentOpen(false);
    setAthenaFocusedMessageId(null);
    setActiveThreadMessageId(null);
    setThreadComposerValue("");
    setThreadComposerMentions([]);
    setChannels((currentChannels) =>
      currentChannels.map((channel) =>
        channel.id === channelId ? { ...channel, unreadCount: 0 } : channel,
      ),
    );
    setNotifications((currentNotifications) =>
      currentNotifications.filter(
        (notification) => notification.channelId !== channelId,
      ),
    );
  }

  useEffect(() => {
    function handleOpenChannel(event: Event) {
      const channelId = (event as CustomEvent<{ channelId?: string }>).detail
        ?.channelId;

      if (!channelId || !channels.some((channel) => channel.id === channelId)) {
        return;
      }

      handleSelectChannel(channelId);
    }

    window.addEventListener("careli:hermes:open-channel", handleOpenChannel);

    return () => {
      window.removeEventListener(
        "careli:hermes:open-channel",
        handleOpenChannel,
      );
    };
  });

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
    setThreadComposerMentions([]);
    loadThreadReplies(messageId);

    if (threadMessage) {
      markThreadRepliesRead(threadMessage);
    }
  }

  function handleOpenAthenaAgent() {
    setActiveThreadMessageId(null);
    setThreadComposerValue("");
    setThreadComposerMentions([]);
    setAthenaFocusedMessageId(null);
    setIsAthenaTicketRecordingMinimized(false);
    setIsAthenaAgentOpen(true);
  }

  function handleOpenAthenaAgentForMessage(messageId: HermesMessage["id"]) {
    setActiveThreadMessageId(null);
    setThreadComposerValue("");
    setThreadComposerMentions([]);
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
      deliveryStatus: "pending",
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
    flushSync(() => {
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
    });

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
        deliveryStatus: "delivered" as const,
        deliveredTo,
        readBy: [],
      };

      rememberHermesMessageCursors(messageCursorByChannelIdRef.current, [
        savedDeliveredMessage,
      ]);
      setMessages((currentMessages) =>
        mergeHermesChannelMessages({
          channelId: activeChannel.id,
          currentMessages: currentMessages.filter(
            (message) => message.id !== localMessage.id,
          ),
          nextMessages: [savedDeliveredMessage],
          replaceChannel: false,
        }),
      );
      void broadcastHermesMessage({
        message: savedDeliveredMessage,
        onError: (error, message) =>
          logSupabaseDiagnostic("pulsex", "message broadcast error", {
            error,
            messageId: message.id,
          }),
        realtimeChannel: messageRealtimeChannelRef.current,
      });
      broadcastHermesMessageEvent(savedDeliveredMessage);
    } catch (error) {
      if (isLocalDevelopmentRuntime()) {
        console.warn("[pulsex] send message error", error);
      }
      setMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.id === localMessage.id
            ? {
                ...message,
                deliveryStatus: "failed" as const,
                status: "danger" as const,
              }
            : message,
        ),
      );
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

    if (!nextBody) {
      return;
    }

    const previousMessage = messages.find(
      (message) => message.id === messageId,
    );

    if (!previousMessage) {
      // Nao esta na lista principal: e uma resposta dentro de uma thread.
      await editThreadReplyMessage(messageId, nextBody);
      return;
    }

    if (previousMessage.body === nextBody) {
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

  // Edita uma resposta de thread (vive em `threadReplies`, nao na lista principal).
  async function editThreadReplyMessage(
    messageId: HermesThreadReply["id"],
    nextBody: string,
  ) {
    const previousReply = Object.values(threadReplies)
      .flat()
      .find((reply) => reply.id === messageId);

    if (!previousReply || previousReply.body === nextBody) {
      return;
    }

    const editedAt = new Date().toISOString();

    updateThreadReplyState(messageId, (reply) => ({
      ...reply,
      body: nextBody,
      editedAt,
    }));

    if (!hasHubSupabaseConfig() || messageId.startsWith("local-")) {
      return;
    }

    try {
      const savedMessage = await updateHermesMessageBody({
        body: nextBody,
        messageId,
      });

      if (!savedMessage) {
        throw new Error("Resposta nao atualizada.");
      }

      applySavedThreadReplyMessage(savedMessage);
    } catch (error: unknown) {
      updateThreadReplyState(messageId, () => previousReply);

      if (isLocalDevelopmentRuntime()) {
        console.warn("[pulsex] edit thread reply error", error);
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
      editedAt: savedMessage.editedAt,
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
    mentions?: readonly HermesMessageMention[];
  }) {
    const attachment = input?.attachment;
    const body = threadComposerValue.trim();
    const replyBody = body || attachment?.label || "Anexo";
    const mentions = (input?.mentions ?? threadComposerMentions).filter(
      (mention) => replyBody.includes(mention.displayName),
    );

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
      mentionUserIds: mentions.map((mention) => mention.userId),
      mentions,
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
    setThreadComposerMentions([]);

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
      mentionUserIds: mentions.map((mention) => mention.userId),
      mentions,
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
        // #2: faz broadcast da resposta como mensagem (com threadParentMessageId) para
        // o provider global de notificacoes avisar os outros membros — resposta passa a
        // ser tratada igual a uma mensagem normal (som + central + toast).
        broadcastHermesMessageEvent({
          ...savedReply,
          status: "neutral",
          threadParentMessageId: activeThreadMessage.id,
        });
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
        setThreadComposerMentions(mentions);
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
            channel={activeChannel}
            isFavorite={favoriteChannelIdsSet.has(activeChannel.id)}
            onMarkCallHistoryRead={markCallHistoryRead}
            onReturnCall={handleReturnCallFromHistory}
            onStartCall={handleStartCall}
            onToggleFavorite={handleToggleFavoriteChannel}
            presenceUsers={channelPresenceUsers}
            unreadCallCount={unreadCallCount}
          />
          <div
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-[#f3f6fa] py-4"
            onScroll={handleMessageScroll}
            ref={messageScrollContainerRef}
          >
            <MessageList
              callEvents={activeChannelCallEvents}
              channelId={activeChannel.id}
              currentUserId={currentUserId}
              filter={activeMessageFilter}
              isLoading={isActiveChannelMessageLoading}
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
                  <AthenaIcon
                    className="size-full object-cover"
                    aria-hidden="true"
                  />
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
                onChangeReply={(value, mentions) => {
                  setThreadComposerValue(value);
                  setThreadComposerMentions(mentions);
                }}
                onClose={() => {
                  setActiveThreadMessageId(null);
                  setThreadComposerValue("");
                  setThreadComposerMentions([]);
                }}
                onEditMessage={handleEditMessage}
                onPreviewAttachment={handlePreviewAttachment}
                onSubmitReply={handleSubmitThreadReply}
                onToggleReaction={handleToggleReaction}
                onToggleTag={handleToggleMessageTag}
                reactionOptions={hermesReactionOptions}
                replies={activeThreadReplies}
                replyMentions={threadComposerMentions}
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
  const channelsById = new Map(
    channels.map((channel) => [channel.id, channel]),
  );
  const nonDirectChannels = channels.filter(
    (channel) => channel.kind !== "direct",
  );
  const directChannels = users
    .filter((user) => user.id !== currentUserId)
    .map((user) => {
      const directChannelId = createHermesDirectChannelId(
        currentUserId,
        user.id,
      );
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
        memberUserIds: existingChannel?.memberUserIds ?? [
          currentUserId,
          user.id,
        ],
        name: user.label,
        preview: existingChannel?.preview ?? user.email ?? "Usuario do Hub",
        status: user.status,
        unreadCount: existingChannel?.unreadCount,
      };
    })
    .filter((channel) => Boolean(channel.id)) satisfies HermesChannel[];

  return [...nonDirectChannels, ...directChannels];
}

function preserveHermesChannelRuntimeState(
  currentChannels: readonly HermesChannel[],
  nextChannels: readonly HermesChannel[],
) {
  const currentChannelsById = new Map(
    currentChannels.map((channel) => [channel.id, channel] as const),
  );

  return nextChannels.map((channel) => {
    const currentChannel = currentChannelsById.get(channel.id);

    if (!currentChannel) {
      return channel;
    }

    return {
      ...channel,
      lastMessageAt: currentChannel.lastMessageAt,
      memberReadAtByUserId: {
        ...(channel.memberReadAtByUserId ?? {}),
        ...(currentChannel.memberReadAtByUserId ?? {}),
      },
      preview: currentChannel.preview,
      unreadCount: currentChannel.unreadCount,
    };
  });
}

function readHermesChannelMessageCache({
  channelId,
  userId,
}: {
  channelId: HermesChannel["id"];
  userId: HermesPresenceUser["id"];
}): HermesChannelMessageCache | null {
  try {
    const storageKey = getHermesChannelMessageCacheStorageKey({
      channelId,
      userId,
    });
    const storedValue = window.localStorage.getItem(storageKey);

    if (!storedValue) {
      return null;
    }

    const parsedValue = JSON.parse(
      storedValue,
    ) as Partial<HermesChannelMessageCache>;
    const cachedAtTime = parsedValue.cachedAt
      ? Date.parse(parsedValue.cachedAt)
      : Number.NaN;

    if (
      parsedValue.version !== HERMES_CHANNEL_MESSAGE_CACHE_VERSION ||
      parsedValue.channelId !== channelId ||
      typeof parsedValue.cachedAt !== "string" ||
      !Number.isFinite(cachedAtTime) ||
      Date.now() - cachedAtTime > HERMES_CHANNEL_MESSAGE_CACHE_TTL_MS ||
      !Array.isArray(parsedValue.messages)
    ) {
      window.localStorage.removeItem(storageKey);
      return null;
    }

    return {
      cachedAt: parsedValue.cachedAt,
      channelId,
      messages: takeLastHermesChannelMessages(
        parsedValue.messages.filter(isCacheableHermesMessage),
      ),
      version: HERMES_CHANNEL_MESSAGE_CACHE_VERSION,
    };
  } catch {
    return null;
  }
}

function writeHermesChannelMessageCaches({
  messages,
  userId,
}: {
  messages: readonly HermesMessage[];
  userId: HermesPresenceUser["id"];
}) {
  const messagesByChannelId = new Map<HermesChannel["id"], HermesMessage[]>();

  for (const message of messages) {
    const channelMessages = messagesByChannelId.get(message.channelId) ?? [];

    channelMessages.push(message);
    messagesByChannelId.set(message.channelId, channelMessages);
  }

  messagesByChannelId.forEach((channelMessages, channelId) => {
    writeHermesChannelMessageCache({
      channelId,
      messages: channelMessages,
      userId,
    });
  });
}

function writeHermesChannelMessageCache({
  channelId,
  messages,
  userId,
}: {
  channelId: HermesChannel["id"];
  messages: readonly HermesMessage[];
  userId: HermesPresenceUser["id"];
}) {
  try {
    const storageKey = getHermesChannelMessageCacheStorageKey({
      channelId,
      userId,
    });
    const cacheableMessages = takeLastHermesChannelMessages(
      messages.filter(isCacheableHermesMessage),
    );

    if (cacheableMessages.length === 0) {
      window.localStorage.removeItem(storageKey);
      return;
    }

    const payload = {
      cachedAt: new Date().toISOString(),
      channelId,
      messages: cacheableMessages,
      version: HERMES_CHANNEL_MESSAGE_CACHE_VERSION,
    } satisfies HermesChannelMessageCache;

    window.localStorage.setItem(storageKey, JSON.stringify(payload));
  } catch {
    // localStorage can be unavailable or full; Hermes keeps the server flow.
  }
}

function isHermesChannelMessageCacheFresh(cache: HermesChannelMessageCache) {
  const cachedAtTime = Date.parse(cache.cachedAt);

  return (
    Number.isFinite(cachedAtTime) &&
    Date.now() - cachedAtTime <= HERMES_CHANNEL_MESSAGE_CACHE_FRESH_MS
  );
}

function getHermesChannelMessageCacheStorageKey({
  channelId,
  userId,
}: {
  channelId: HermesChannel["id"];
  userId: HermesPresenceUser["id"];
}) {
  return `${HERMES_CHANNEL_MESSAGE_CACHE_STORAGE_PREFIX}:${userId}:${channelId}`;
}

function takeLastHermesChannelMessages(messages: readonly HermesMessage[]) {
  return [...messages]
    .sort((firstMessage, secondMessage) => {
      const firstTime = getHermesCacheMessageSortTime(firstMessage);
      const secondTime = getHermesCacheMessageSortTime(secondMessage);

      if (firstTime !== secondTime) {
        return firstTime - secondTime;
      }

      return firstMessage.id.localeCompare(secondMessage.id);
    })
    .slice(-HERMES_CHANNEL_MESSAGE_CACHE_LIMIT);
}

function getHermesCacheMessageSortTime(message: HermesMessage) {
  const sortTime = message.createdAt
    ? Date.parse(message.createdAt)
    : Number.NaN;

  return Number.isFinite(sortTime) ? sortTime : 0;
}

function isCacheableHermesMessage(message: unknown): message is HermesMessage {
  if (!message || typeof message !== "object") {
    return false;
  }

  const candidate = message as Partial<HermesMessage>;

  return (
    typeof candidate.id === "string" &&
    !candidate.id.startsWith("local-") &&
    typeof candidate.channelId === "string" &&
    typeof candidate.authorId === "string" &&
    typeof candidate.body === "string" &&
    typeof candidate.createdAt === "string" &&
    !candidate.threadParentMessageId
  );
}

function rememberHermesMessageCursors(
  cursorByChannelId: Map<HermesChannel["id"], string>,
  messages: readonly HermesMessage[],
) {
  for (const message of messages) {
    if (!message.createdAt) {
      continue;
    }

    const currentCursor = cursorByChannelId.get(message.channelId);

    if (
      !currentCursor ||
      Date.parse(message.createdAt) > Date.parse(currentCursor)
    ) {
      cursorByChannelId.set(message.channelId, message.createdAt);
    }
  }
}

function preserveHermesArrayReference<TItem>(
  currentItems: TItem[],
  nextItems: TItem[],
  getSignature: (item: TItem) => string,
) {
  if (currentItems.length !== nextItems.length) {
    return nextItems;
  }

  for (let index = 0; index < currentItems.length; index += 1) {
    const currentItem = currentItems[index];
    const nextItem = nextItems[index];

    if (!currentItem || !nextItem) {
      return nextItems;
    }

    if (getSignature(currentItem) !== getSignature(nextItem)) {
      return nextItems;
    }
  }

  return currentItems;
}

function getHermesMessageRenderSignature(message: HermesMessage) {
  return [
    message.id,
    message.channelId,
    message.authorId,
    message.authorName ?? "",
    message.authorAvatarUrl ?? "",
    message.body,
    message.clientMessageId ?? "",
    message.createdAt ?? "",
    message.deletedAt ?? "",
    message.deliveryStatus ?? "",
    message.editedAt ?? "",
    message.lastThreadReplyAt ?? "",
    message.status,
    message.threadCount ?? 0,
    message.threadParentMessageId ?? "",
    message.timestamp,
    stableHermesSignature(message.attachment ?? null),
    stableHermesSignature(message.deliveredTo ?? []),
    stableHermesSignature(message.mentionUserIds ?? []),
    stableHermesSignature(message.mentions ?? []),
    stableHermesSignature(message.reactions ?? []),
    stableHermesSignature(message.readBy ?? []),
    stableHermesSignature(message.tags ?? []),
  ].join("\u001f");
}

function getHermesChannelRenderSignature(channel: HermesChannel) {
  return [
    channel.id,
    channel.name,
    channel.kind,
    channel.status,
    channel.preview,
    channel.lastMessageAt,
    channel.unreadCount ?? 0,
    stableHermesSignature(channel.memberReadAtByUserId ?? {}),
    stableHermesSignature(channel.memberUserIds ?? []),
  ].join("\u001f");
}

function getHermesPresenceUserRenderSignature(user: HermesPresenceUser) {
  return [
    user.id,
    user.label,
    user.status,
    user.avatarUrl ?? "",
    user.departmentId ?? "",
    user.sectorId ?? "",
    stableHermesSignature(user.channelIds ?? []),
  ].join("\u001f");
}

function stableHermesSignature(value: unknown) {
  return JSON.stringify(value) ?? "";
}

function replaceHermesChannelUrl(channelId: HermesChannel["id"]) {
  if (typeof window === "undefined") {
    return;
  }

  const nextUrl = new URL(window.location.href);

  nextUrl.searchParams.set("channel", channelId);
  window.history.replaceState(null, "", nextUrl);
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
      channel.memberUserIds?.find(
        (memberUserId) => memberUserId !== currentUserId,
      );

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

function getHermesComposerDraftStorageKey(channelId: HermesChannel["id"]) {
  return `${HERMES_COMPOSER_DRAFT_STORAGE_PREFIX}:${channelId}`;
}

function readHermesComposerDraft(channelId: HermesChannel["id"]) {
  try {
    return (
      window.localStorage.getItem(
        getHermesComposerDraftStorageKey(channelId),
      ) ?? ""
    );
  } catch {
    return "";
  }
}

function writeHermesComposerDraft(
  channelId: HermesChannel["id"],
  value: string,
) {
  try {
    const key = getHermesComposerDraftStorageKey(channelId);

    if (value.trim()) {
      window.localStorage.setItem(key, value);
      return;
    }

    window.localStorage.removeItem(key);
  } catch {
    // localStorage can be unavailable in restricted browser contexts.
  }
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
