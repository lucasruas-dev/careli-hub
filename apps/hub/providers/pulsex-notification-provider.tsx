"use client";

import Link from "next/link";
import {
  ExternalLink,
  MessageSquareText,
  Send,
  X,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import type {
  HermesChannel,
  HermesMessage,
} from "@/lib/pulsex";
import {
  playHermesIncomingMessageSound,
  registerHermesNotificationPermissionIntent,
} from "@/lib/pulsex/notification-effects";
import {
  PULSEX_MESSAGE_BROADCAST_EVENT,
  broadcastHermesMessage,
  getHermesMessageGlobalPostgresRealtimeTopic,
  getHermesMessageGlobalRealtimeTopic,
  parseHermesMessageBroadcastPayload,
  type HermesMessageRealtimeChannel,
} from "@/lib/pulsex/realtime";
import {
  createHermesMessage,
  listChannelMessages,
  listHermesNotificationChannels,
  listRecentChannelMessages,
  markHermesChannelRead,
  mapHermesRealtimeMessageRow,
} from "@/lib/pulsex/supabase-data";
import { registerHermesPushSubscription } from "@/lib/pulsex/push-client";
import { withChannelUnreadCounts } from "@/lib/pulsex/workspace-messages";
import {
  PANTEON_ACTIVITY_NOTIFICATION_PREFIX,
  isPanteonNotificationFromToday,
  listPanteonActivityNotifications,
  type PanteonNotificationInput,
  type PanteonNotificationItem,
} from "@/lib/panteon-notifications";
import {
  getHubSupabaseClient,
  hasHubSupabaseConfig,
  logSupabaseDiagnostic,
  serializeDiagnosticError,
} from "@/lib/supabase/client";
import { useAuth } from "@/providers/auth-provider";

type HubSupabaseClient = NonNullable<ReturnType<typeof getHubSupabaseClient>>;
type HubRealtimeChannel = ReturnType<HubSupabaseClient["channel"]>;

type PanteonNotificationsContextValue = {
  activeHermesChannelId: HermesChannel["id"] | null;
  broadcastHermesMessageEvent: (message: HermesMessage) => void;
  hermesChannels: readonly HermesChannel[];
  items: readonly PanteonNotificationItem[];
  publishNotification: (notification: PanteonNotificationInput) => void;
  markAllRead: () => void;
  openHermesChannel: (channelId: HermesChannel["id"]) => void;
  unreadCount: number;
};

const PanteonNotificationsContext =
  createContext<PanteonNotificationsContextValue | null>(null);

const HERMES_MODULE_ID = "hermes";
const HERMES_MODULE_LABEL = "Hermes";
const HERMES_SNAPSHOT_INTERVAL_MS = 120_000;
const PANTEON_ACTIVITY_SNAPSHOT_INTERVAL_MS = 90_000;
const FLOATING_NOTIFICATION_TTL_MS = 9_000;
// Cap do array de notificacoes. Maior que antes (80) para o historico diario por
// mensagem caber num dia movimentado sem perder mensagens antigas do dia.
const MAX_PANTEON_NOTIFICATION_ITEMS = 150;

export function HermesNotificationProvider({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const { hubUser, profileStatus } = useAuth();
  const currentUserId = hubUser?.id ?? "";
  const [items, setItems] = useState<PanteonNotificationItem[]>([]);
  const [floatingItems, setFloatingItems] = useState<PanteonNotificationItem[]>(
    [],
  );
  const [hermesChannels, setHermesChannels] = useState<HermesChannel[]>([]);
  const [activeHermesChannelId, setActiveHermesChannelId] = useState<
    HermesChannel["id"] | null
  >(null);
  const [latestHermesPopupMessage, setLatestHermesPopupMessage] =
    useState<HermesMessage | null>(null);
  const notifiedMessageIdsRef = useRef<Set<string>>(new Set());
  const activeHermesChannelIdRef = useRef<HermesChannel["id"] | null>(null);
  // Canal que o usuario esta vendo no workspace do Hermes (/hermes). O workspace
  // emite "careli:hermes:active-channel"; usamos para NAO alertar (som/toast) a
  // conversa que ele ja esta olhando.
  const activeWorkspaceChannelIdRef = useRef<HermesChannel["id"] | null>(null);
  const globalRealtimeChannelRef = useRef<HubRealtimeChannel | null>(null);
  const globalRealtimeReadyRef = useRef(false);
  const hermesChannelsByIdRef = useRef<Map<string, HermesChannel>>(new Map());
  const pendingGlobalBroadcastMessagesRef = useRef<HermesMessage[]>([]);
  const pendingGlobalIncomingMessagesRef = useRef<HermesMessage[]>([]);
  const floatingTimeoutsRef = useRef<Map<string, number>>(new Map());
  const didHydrateNotificationsRef = useRef(false);

  const unreadCount = useMemo(
    () => items.filter((item) => !item.read).length,
    [items],
  );

  const publishNotification = useCallback(
    (notification: PanteonNotificationInput) => {
      const nextNotification = normalizePanteonNotification(notification);

      setItems((currentItems) =>
        upsertNotification(currentItems, nextNotification).slice(0, MAX_PANTEON_NOTIFICATION_ITEMS),
      );
    },
    [],
  );

  const markAllRead = useCallback(() => {
    setItems((currentItems) =>
      currentItems.map((item) => ({
        ...item,
        read: true,
      })),
    );
    setHermesChannels((currentChannels) =>
      currentChannels.map((channel) => ({
        ...channel,
        unreadCount: 0,
      })),
    );

    hermesChannels
      .filter((channel) => (channel.unreadCount ?? 0) > 0)
      .forEach((channel) => {
        markHermesChannelRead({ channelId: channel.id }).catch(
          (error: unknown) => {
            logSupabaseDiagnostic("pulsex", "global mark all read error", {
              channelId: channel.id,
              error: serializeDiagnosticError(error),
            });
          },
        );
      });
  }, [hermesChannels]);

  const markChannelNotificationsRead = useCallback(
    (channelId: HermesChannel["id"]) => {
      const notificationId = getHermesChannelNotificationId(channelId);

      setItems((currentItems) =>
        currentItems.map((item) =>
          item.id === notificationId ||
          item.context?.hermesChannelId === channelId
            ? {
                ...item,
                read: true,
              }
            : item,
        ),
      );
      setHermesChannels((currentChannels) =>
        currentChannels.map((channel) =>
          channel.id === channelId
            ? {
                ...channel,
                unreadCount: 0,
              }
            : channel,
        ),
      );
    },
    [],
  );

  const openHermesChannel = useCallback(
    (channelId: HermesChannel["id"]) => {
      if (isHermesWorkspaceRoute()) {
        window.dispatchEvent(
          new CustomEvent("careli:hermes:open-channel", {
            detail: { channelId },
          }),
        );
        setActiveHermesChannelId(null);
        markChannelNotificationsRead(channelId);

        markHermesChannelRead({ channelId }).catch((error: unknown) => {
          logSupabaseDiagnostic("pulsex", "global mark read error", {
            channelId,
            error: serializeDiagnosticError(error),
          });
        });
        return;
      }

      setActiveHermesChannelId(channelId);
      markChannelNotificationsRead(channelId);

      markHermesChannelRead({ channelId }).catch((error: unknown) => {
        logSupabaseDiagnostic("pulsex", "global mark read error", {
          channelId,
          error: serializeDiagnosticError(error),
        });
      });
    },
    [markChannelNotificationsRead],
  );

  const pushFloatingNotification = useCallback(
    (notification: PanteonNotificationItem) => {
      setFloatingItems((currentItems) =>
        [notification, ...currentItems.filter((item) => item.id !== notification.id)].slice(
          0,
          3,
        ),
      );

      const existingTimeout = floatingTimeoutsRef.current.get(notification.id);

      if (existingTimeout) {
        window.clearTimeout(existingTimeout);
      }

      const timeoutId = window.setTimeout(() => {
        setFloatingItems((currentItems) =>
          currentItems.filter((item) => item.id !== notification.id),
        );
        floatingTimeoutsRef.current.delete(notification.id);
      }, FLOATING_NOTIFICATION_TTL_MS);

      floatingTimeoutsRef.current.set(notification.id, timeoutId);
    },
    [],
  );

  const refreshHermesSnapshot = useCallback(async () => {
    if (!currentUserId || profileStatus !== "ready") {
      setHermesChannels([]);
      return;
    }

    const channels = await listHermesNotificationChannels({
      currentUserId,
      userRole: hubUser?.role,
    });

    const messages = await listRecentChannelMessages({
      after: getOldestHermesReadCursor(channels, currentUserId),
      channelIds: channels.map((channel) => channel.id),
      limit: 200,
    }).catch((error: unknown) => {
      logSupabaseDiagnostic("pulsex", "global recent messages error", {
        error: serializeDiagnosticError(error),
      });

      return [];
    });
    const messagesByChannel = groupHermesMessagesByChannel(messages);
    const channelsWithUnread = withChannelUnreadCounts({
      channels,
      currentUserId,
      messages,
    });
    const hermesNotifications = channelsWithUnread
      .map((channel) =>
        createHermesChannelNotification({
          channel,
          currentUserId,
          messages: messagesByChannel.get(channel.id) ?? [],
        }),
      )
      .filter(
        (notification): notification is PanteonNotificationItem =>
          notification !== null,
      );
    const hermesNotificationIds = new Set(
      hermesNotifications.map((notification) => notification.id),
    );

    // #2: log diario por mensagem — inclui as recebidas com o app fechado (o snapshot
    // recarrega o historico ao reabrir). Cada msg de HOJE (de outros) vira uma linha.
    const channelById = new Map(
      channelsWithUnread.map((channel) => [channel.id, channel] as const),
    );
    const messageLogItems = messages
      .filter(
        (message) =>
          message.authorId !== currentUserId &&
          !message.deletedAt &&
          !message.threadParentMessageId &&
          isPanteonNotificationFromToday(
            message.createdAt ?? message.timestamp,
          ),
      )
      .map((message) => {
        const channel = channelById.get(message.channelId);

        if (!channel) {
          return null;
        }

        return createHermesMessageLogItem({
          channel,
          mentioned: message.mentionUserIds?.includes(currentUserId) ?? false,
          message,
        });
      })
      .filter((item): item is PanteonNotificationItem => item !== null);
    const messageLogIds = new Set(messageLogItems.map((item) => item.id));

    setHermesChannels(channelsWithUnread);
    setItems((currentItems) => {
      const retainedItems = currentItems.filter(
        (item) =>
          item.moduleId !== HERMES_MODULE_ID ||
          !item.context?.hermesChannelId ||
          hermesNotificationIds.has(item.id) ||
          messageLogIds.has(item.id) ||
          // #5 + renovacao diaria: mantem como historico apenas as LIDAS de HOJE
          // (vira o dia, o snapshot expurga as lidas antigas).
          (item.read && isPanteonNotificationFromToday(item.createdAt)),
      );

      return mergeNotifications(retainedItems, [
        ...hermesNotifications,
        ...messageLogItems,
      ]).slice(0, MAX_PANTEON_NOTIFICATION_ITEMS);
    });
  }, [currentUserId, hubUser?.role, profileStatus]);

  const refreshPanteonActivityNotifications = useCallback(async () => {
    if (!currentUserId || profileStatus !== "ready") {
      return;
    }

    const activityNotifications = (
      await listPanteonActivityNotifications()
    ).map(normalizePanteonNotification);

    setItems((currentItems) =>
      mergeNotifications(
        currentItems.filter(
          (item) => !item.id.startsWith(PANTEON_ACTIVITY_NOTIFICATION_PREFIX),
        ),
        activityNotifications,
      ).slice(0, MAX_PANTEON_NOTIFICATION_ITEMS),
    );
  }, [currentUserId, profileStatus]);

  const handleHermesMessage = useCallback(
    (channel: HermesChannel, message: HermesMessage) => {
      if (
        message.channelId !== channel.id ||
        message.authorId === currentUserId ||
        notifiedMessageIdsRef.current.has(message.id)
      ) {
        return;
      }

      notifiedMessageIdsRef.current.add(message.id);
      setLatestHermesPopupMessage(message);

      // B: ponte do broadcast GLOBAL (confiavel) -> conversa ativa. Entrega a mensagem
      // na hora no workspace, sem depender do broadcast por-canal/poll de 8s.
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("careli:hermes:message", { detail: { message } }),
        );
      }

      const mentioned = message.mentionUserIds?.includes(currentUserId) ?? false;

      // #2: log diario por mensagem (entra como LIDA = historico). Registrado SEMPRE,
      // inclusive para o canal que o usuario esta vendo, para o historico ficar completo.
      setItems((currentItems) =>
        upsertNotification(
          currentItems,
          createHermesMessageLogItem({ channel, mentioned, message }),
        ).slice(0, MAX_PANTEON_NOTIFICATION_ITEMS),
      );

      const isVisible =
        typeof document === "undefined" ||
        document.visibilityState === "visible";
      // Conversa que o usuario esta olhando agora (popup flutuante OU workspace /hermes).
      const isViewingChannel =
        isVisible &&
        (activeHermesChannelIdRef.current === channel.id ||
          activeWorkspaceChannelIdRef.current === channel.id);

      if (isViewingChannel) {
        // Esta vendo a conversa: marca lida, sem badge nem alerta.
        markChannelNotificationsRead(channel.id);
        markHermesChannelRead({ channelId: channel.id }).catch(
          (error: unknown) => {
            logSupabaseDiagnostic("pulsex", "global active mark read error", {
              channelId: channel.id,
              error: serializeDiagnosticError(error),
            });
          },
        );
        return;
      }

      // Central: 1 notificacao por canal (badge "novas").
      const notification = normalizePanteonNotification({
        actionLabel: "Abrir conversa",
        context: {
          hermesChannelId: channel.id,
          entityId: message.id,
          entityType: "message",
        },
        createdAt: message.createdAt ?? new Date().toISOString(),
        description: `${message.authorName ?? HERMES_MODULE_LABEL}: ${truncateNotificationBody(message.body)}`,
        href: getHermesChannelPath(channel.id),
        id: getHermesChannelNotificationId(channel.id),
        kind: "mensagem",
        moduleId: HERMES_MODULE_ID,
        moduleLabel: HERMES_MODULE_LABEL,
        severity: mentioned ? "warning" : "info",
        title: mentioned
          ? `Voce foi mencionado em ${channel.name}`
          : `Nova mensagem em ${channel.name}`,
      });

      setItems((currentItems) =>
        upsertNotification(currentItems, notification).slice(0, MAX_PANTEON_NOTIFICATION_ITEMS),
      );
      setHermesChannels((currentChannels) =>
        currentChannels.map((currentChannel) =>
          currentChannel.id === channel.id
            ? {
                ...currentChannel,
                lastMessageAt: message.createdAt ?? message.timestamp,
                preview: truncateNotificationBody(message.body),
                unreadCount: (currentChannel.unreadCount ?? 0) + 1,
              }
            : currentChannel,
        ),
      );

      // Alerta IN-APP (som + toast) so com a aba VISIVEL. Em segundo plano/fechado
      // quem alerta e o Web Push (SW) — com avatar e sem duplicar. A notificacao de
      // SO saiu daqui de proposito: era generica (o payload do realtime nao traz o
      // avatar), entao deixamos o Web Push como unica notificacao do sistema.
      if (isVisible) {
        pushFloatingNotification(notification);
        playHermesIncomingMessageSound({
          mentioned,
          messageId: message.id,
        });
      }
    },
    [currentUserId, markChannelNotificationsRead, pushFloatingNotification],
  );

  const broadcastHermesMessageEvent = useCallback((message: HermesMessage) => {
    const realtimeChannel = globalRealtimeChannelRef.current;

    if (!realtimeChannel || !globalRealtimeReadyRef.current) {
      pendingGlobalBroadcastMessagesRef.current = [
        ...pendingGlobalBroadcastMessagesRef.current,
        message,
      ].slice(-20);
      return;
    }

    void broadcastHermesMessage({
      message,
      onError: (error: unknown, failedMessage: HermesMessage) => {
        logSupabaseDiagnostic("pulsex", "global broadcast error", {
          error: serializeDiagnosticError(error),
          messageId: failedMessage.id,
        });
      },
      realtimeChannel: realtimeChannel as HermesMessageRealtimeChannel,
    });
  }, []);

  const flushPendingGlobalBroadcastMessages = useCallback(() => {
    if (
      !globalRealtimeChannelRef.current ||
      !globalRealtimeReadyRef.current ||
      pendingGlobalBroadcastMessagesRef.current.length === 0
    ) {
      return;
    }

    const pendingMessages = [...pendingGlobalBroadcastMessagesRef.current];

    pendingGlobalBroadcastMessagesRef.current = [];
    pendingMessages.forEach((message) => broadcastHermesMessageEvent(message));
  }, [broadcastHermesMessageEvent]);

  const flushPendingGlobalIncomingMessages = useCallback(() => {
    if (pendingGlobalIncomingMessagesRef.current.length === 0) {
      return;
    }

    const remainingMessages: HermesMessage[] = [];

    pendingGlobalIncomingMessagesRef.current.forEach((message) => {
      const currentChannel = hermesChannelsByIdRef.current.get(
        message.channelId,
      );

      if (!currentChannel) {
        remainingMessages.push(message);
        return;
      }

      handleHermesMessage(currentChannel, message);
    });

    pendingGlobalIncomingMessagesRef.current = remainingMessages.slice(-50);
  }, [handleHermesMessage]);

  const sendHermesPopupMessage = useCallback(
    async (channelId: HermesChannel["id"], body: string) => {
      if (!currentUserId) {
        throw new Error("Sessao Hermes indisponivel.");
      }

      const savedMessage = await createHermesMessage({
        authorUserId: currentUserId,
        body,
        channelId,
        clientMessageId: `global-${currentUserId}-${Date.now()}`,
      });

      notifiedMessageIdsRef.current.add(savedMessage.id);
      broadcastHermesMessageEvent(savedMessage);
      markChannelNotificationsRead(channelId);

      return savedMessage;
    },
    [broadcastHermesMessageEvent, currentUserId, markChannelNotificationsRead],
  );

  useEffect(() => registerHermesNotificationPermissionIntent(), []);

  // Web Push: registra a subscription do usuario (best-effort) quando logado e com
  // permissao concedida. Reatenta no foco (cobre permissao concedida depois) com
  // throttle de 60s. Qualquer falha aqui e silenciada e nao afeta o resto do Hermes.
  useEffect(() => {
    if (
      !currentUserId ||
      profileStatus !== "ready" ||
      !hasHubSupabaseConfig()
    ) {
      return;
    }

    const client = getHubSupabaseClient();

    if (!client) {
      return;
    }

    let cancelled = false;
    let lastAttemptAt = 0;

    const subscribePush = async () => {
      const now = Date.now();

      if (now - lastAttemptAt < 60_000) {
        return;
      }

      lastAttemptAt = now;
      const { data } = await client.auth.getSession();
      const accessToken = data.session?.access_token;

      if (!cancelled && accessToken) {
        await registerHermesPushSubscription(accessToken);
      }
    };

    void subscribePush();
    const handleFocus = () => {
      void subscribePush();
    };

    window.addEventListener("focus", handleFocus);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", handleFocus);
    };
  }, [currentUserId, profileStatus]);

  useEffect(() => {
    activeHermesChannelIdRef.current = activeHermesChannelId;
  }, [activeHermesChannelId]);

  // O workspace (/hermes) avisa qual conversa esta aberta para nao alertarmos o
  // canal que o usuario ja esta vendo (som/toast). Some ao sair do /hermes.
  useEffect(() => {
    const handleActiveWorkspaceChannel = (event: Event) => {
      const detail = (
        event as CustomEvent<{ channelId: HermesChannel["id"] | null }>
      ).detail;

      activeWorkspaceChannelIdRef.current = detail?.channelId ?? null;
    };

    window.addEventListener(
      "careli:hermes:active-channel",
      handleActiveWorkspaceChannel,
    );

    return () => {
      window.removeEventListener(
        "careli:hermes:active-channel",
        handleActiveWorkspaceChannel,
      );
    };
  }, []);

  useEffect(() => {
    hermesChannelsByIdRef.current = new Map(
      hermesChannels.map((channel) => [channel.id, channel] as const),
    );
    flushPendingGlobalIncomingMessages();
  }, [flushPendingGlobalIncomingMessages, hermesChannels]);

  useEffect(() => {
    const floatingTimeouts = floatingTimeoutsRef.current;

    return () => {
      floatingTimeouts.forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
      floatingTimeouts.clear();
    };
  }, []);

  // #5: hidrata o historico de notificacoes persistido (localStorage) uma vez,
  // tratando-as como LIDAS — o snapshot live re-marca as que ainda estao pendentes.
  useEffect(() => {
    if (!currentUserId || didHydrateNotificationsRef.current) {
      return;
    }

    didHydrateNotificationsRef.current = true;

    const storedItems = readStoredPanteonNotifications(currentUserId)
      .filter((item) => isPanteonNotificationFromToday(item.createdAt))
      .map((item) => ({ ...item, read: true }));

    if (storedItems.length === 0) {
      return;
    }

    setItems((currentItems) =>
      mergeNotifications(storedItems, currentItems).slice(0, MAX_PANTEON_NOTIFICATION_ITEMS),
    );
  }, [currentUserId]);

  // #5: persiste o historico a cada mudanca para sobreviver a reloads.
  useEffect(() => {
    if (!currentUserId) {
      return;
    }

    writeStoredPanteonNotifications(currentUserId, items);
  }, [currentUserId, items]);

  useEffect(() => {
    if (
      !currentUserId ||
      profileStatus !== "ready" ||
      !hasHubSupabaseConfig()
    ) {
      return;
    }

    void refreshHermesSnapshot().catch((error: unknown) => {
      logSupabaseDiagnostic("pulsex", "global snapshot error", {
        error: serializeDiagnosticError(error),
      });
    });

    const intervalId = window.setInterval(() => {
      void refreshHermesSnapshot().catch((error: unknown) => {
        logSupabaseDiagnostic("pulsex", "global snapshot interval error", {
          error: serializeDiagnosticError(error),
        });
      });
    }, HERMES_SNAPSHOT_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [currentUserId, profileStatus, refreshHermesSnapshot]);

  // Catch-up ao focar: atualiza nao-lidas/notificacoes assim que o app volta do
  // background (minimizado congela os intervalos), sem esperar os 120s. Throttle de 5s
  // evita refetch repetido em alt-tab rapido (consciencia de custo).
  useEffect(() => {
    if (
      !currentUserId ||
      profileStatus !== "ready" ||
      !hasHubSupabaseConfig()
    ) {
      return;
    }

    let lastFocusRefreshAt = 0;

    const handleFocusCatchUp = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      const now = Date.now();

      if (now - lastFocusRefreshAt < 5_000) {
        return;
      }

      lastFocusRefreshAt = now;
      void refreshHermesSnapshot().catch((error: unknown) => {
        logSupabaseDiagnostic("pulsex", "global focus snapshot error", {
          error: serializeDiagnosticError(error),
        });
      });
    };

    document.addEventListener("visibilitychange", handleFocusCatchUp);
    window.addEventListener("focus", handleFocusCatchUp);

    return () => {
      document.removeEventListener("visibilitychange", handleFocusCatchUp);
      window.removeEventListener("focus", handleFocusCatchUp);
    };
  }, [currentUserId, profileStatus, refreshHermesSnapshot]);

  useEffect(() => {
    if (
      !currentUserId ||
      profileStatus !== "ready" ||
      !hasHubSupabaseConfig()
    ) {
      return;
    }

    void refreshPanteonActivityNotifications().catch((error: unknown) => {
      logSupabaseDiagnostic("pulsex", "panteon activity snapshot error", {
        error: serializeDiagnosticError(error),
      });
    });

    const intervalId = window.setInterval(() => {
      void refreshPanteonActivityNotifications().catch((error: unknown) => {
        logSupabaseDiagnostic(
          "pulsex",
          "panteon activity snapshot interval error",
          {
            error: serializeDiagnosticError(error),
          },
        );
      });
    }, PANTEON_ACTIVITY_SNAPSHOT_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [currentUserId, profileStatus, refreshPanteonActivityNotifications]);

  useEffect(() => {
    if (
      !currentUserId ||
      profileStatus !== "ready" ||
      !hasHubSupabaseConfig()
    ) {
      globalRealtimeChannelRef.current = null;
      globalRealtimeReadyRef.current = false;
      return;
    }

    const client = getHubSupabaseClient();

    if (!client) {
      return;
    }

    const globalRealtimeChannel = client.channel(
      getHermesMessageGlobalRealtimeTopic(),
      {
        config: {
          broadcast: {
            ack: true,
            self: false,
          },
        },
      },
    );
    const globalPostgresRealtimeChannel = client.channel(
      getHermesMessageGlobalPostgresRealtimeTopic("notifications"),
    );

    globalRealtimeChannelRef.current = globalRealtimeChannel;
    globalRealtimeReadyRef.current = false;

    globalRealtimeChannel
      .on(
        "broadcast",
        {
          event: PULSEX_MESSAGE_BROADCAST_EVENT,
        },
        (payload: { payload?: unknown }) => {
          const message = parseHermesMessageBroadcastPayload(payload.payload);
          const currentChannel = message
            ? hermesChannelsByIdRef.current.get(message.channelId)
            : null;

          if (!message) {
            return;
          }

          if (!currentChannel) {
            pendingGlobalIncomingMessagesRef.current = [
              ...pendingGlobalIncomingMessagesRef.current,
              message,
            ].slice(-50);
            void refreshHermesSnapshot().catch((error: unknown) => {
              logSupabaseDiagnostic(
                "pulsex",
                "global message channel refresh error",
                {
                  channelId: message.channelId,
                  error: serializeDiagnosticError(error),
                },
              );
            });
            return;
          }

          handleHermesMessage(currentChannel, message);
        },
      )
      .subscribe((status) => {
        globalRealtimeReadyRef.current = status === "SUBSCRIBED";
        logSupabaseDiagnostic("pulsex", "global message bus status", {
          status,
        });

        if (status === "SUBSCRIBED") {
          flushPendingGlobalBroadcastMessages();
        }
      });

    globalPostgresRealtimeChannel
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "pulsex_messages",
        },
        (payload) => {
          const message = mapHermesRealtimeMessageRow(payload.new);
          const currentChannel = message
            ? hermesChannelsByIdRef.current.get(message.channelId)
            : null;

          if (!message) {
            return;
          }

          if (!currentChannel) {
            pendingGlobalIncomingMessagesRef.current = [
              ...pendingGlobalIncomingMessagesRef.current,
              message,
            ].slice(-50);
            void refreshHermesSnapshot().catch((error: unknown) => {
              logSupabaseDiagnostic(
                "pulsex",
                "global postgres channel refresh error",
                {
                  channelId: message.channelId,
                  error: serializeDiagnosticError(error),
                },
              );
            });
            return;
          }

          handleHermesMessage(currentChannel, message);
        },
      )
      .subscribe((status) => {
        logSupabaseDiagnostic("pulsex", "global postgres message status", {
          status,
        });
      });

    return () => {
      if (globalRealtimeChannelRef.current === globalRealtimeChannel) {
        globalRealtimeChannelRef.current = null;
      }
      globalRealtimeReadyRef.current = false;
      void client.removeChannel(globalRealtimeChannel);
      void client.removeChannel(globalPostgresRealtimeChannel);
    };
  }, [
    currentUserId,
    flushPendingGlobalBroadcastMessages,
    handleHermesMessage,
    profileStatus,
    refreshHermesSnapshot,
  ]);

  const contextValue = useMemo<PanteonNotificationsContextValue>(
    () => ({
      activeHermesChannelId,
      broadcastHermesMessageEvent,
      hermesChannels,
      items,
      markAllRead,
      openHermesChannel,
      publishNotification,
      unreadCount,
    }),
    [
      activeHermesChannelId,
      broadcastHermesMessageEvent,
      hermesChannels,
      items,
      markAllRead,
      openHermesChannel,
      publishNotification,
      unreadCount,
    ],
  );
  const activeHermesChannel =
    activeHermesChannelId === null
      ? null
      : (hermesChannels.find((channel) => channel.id === activeHermesChannelId) ??
        null);

  return (
    <PanteonNotificationsContext.Provider value={contextValue}>
      {children}
      <PanteonFloatingNotificationLayer
        items={floatingItems}
        onDismiss={(notificationId) =>
          setFloatingItems((currentItems) =>
            currentItems.filter((item) => item.id !== notificationId),
          )
        }
        onOpen={(notification) => {
          if (notification.context?.hermesChannelId) {
            openHermesChannel(notification.context.hermesChannelId);
          }
        }}
      />
      {activeHermesChannel ? (
        <HermesFloatingChannelPopup
          channel={activeHermesChannel}
          currentUserId={currentUserId}
          incomingMessage={latestHermesPopupMessage}
          onClose={() => setActiveHermesChannelId(null)}
          onMessageCreated={sendHermesPopupMessage}
        />
      ) : null}
    </PanteonNotificationsContext.Provider>
  );
}

export function usePanteonNotifications() {
  const context = useContext(PanteonNotificationsContext);

  if (!context) {
    throw new Error(
      "usePanteonNotifications deve ser usado dentro de HermesNotificationProvider.",
    );
  }

  return context;
}

function PanteonFloatingNotificationLayer({
  items,
  onDismiss,
  onOpen,
}: {
  items: readonly PanteonNotificationItem[];
  onDismiss: (notificationId: PanteonNotificationItem["id"]) => void;
  onOpen: (notification: PanteonNotificationItem) => void;
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="fixed bottom-5 right-5 z-[var(--uix-z-toast)] grid w-[min(23rem,calc(100vw-2rem))] gap-2">
      {items.map((item) => (
        <div
          className="rounded-lg border border-[#d9e0e7] bg-white p-3 shadow-2xl"
          key={item.id}
        >
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#101820] text-white">
              <MessageSquareText aria-hidden="true" size={17} />
            </span>
            <button
              className="min-w-0 flex-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
              onClick={() => onOpen(item)}
              type="button"
            >
              <span className="block truncate text-sm font-semibold text-[#101820]">
                {item.title}
              </span>
              {item.description ? (
                <span className="mt-0.5 block truncate text-xs text-[#526078]">
                  {item.description}
                </span>
              ) : null}
            </button>
            <button
              aria-label="Fechar notificacao"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[#526078] outline-none transition hover:bg-[#f3f6fa] hover:text-[#101820] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
              onClick={() => onDismiss(item.id)}
              type="button"
            >
              <X aria-hidden="true" size={15} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function HermesFloatingChannelPopup({
  channel,
  currentUserId,
  incomingMessage,
  onClose,
  onMessageCreated,
}: {
  channel: HermesChannel;
  currentUserId: string;
  incomingMessage: HermesMessage | null;
  onClose: () => void;
  onMessageCreated: (
    channelId: HermesChannel["id"],
    body: string,
  ) => Promise<HermesMessage>;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<HermesMessage[]>([]);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;

    setLoading(true);
    setError("");
    listChannelMessages(channel.id)
      .then((channelMessages) => {
        if (!mounted) {
          return;
        }

        setMessages(channelMessages.slice(-50));
        markHermesChannelRead({ channelId: channel.id }).catch(
          (readError: unknown) => {
            logSupabaseDiagnostic("pulsex", "floating mark read error", {
              channelId: channel.id,
              error: serializeDiagnosticError(readError),
            });
          },
        );
      })
      .catch((loadError: unknown) => {
        if (!mounted) {
          return;
        }

        setError(getReadableError(loadError));
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [channel.id]);

  useEffect(() => {
    if (!incomingMessage || incomingMessage.channelId !== channel.id) {
      return;
    }

    setMessages((currentMessages) =>
      mergePopupMessages(currentMessages, [incomingMessage]).slice(-50),
    );
  }, [channel.id, incomingMessage]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      behavior: "smooth",
      top: scrollRef.current.scrollHeight,
    });
  }, [messages.length]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const body = draft.replace(/\s+/g, " ").trim();

    if (!body || sending) {
      return;
    }

    setSending(true);
    setError("");

    try {
      const savedMessage = await onMessageCreated(channel.id, body);

      setMessages((currentMessages) =>
        mergePopupMessages(currentMessages, [savedMessage]).slice(-50),
      );
      setDraft("");
    } catch (sendError) {
      setError(getReadableError(sendError));
    } finally {
      setSending(false);
    }
  }

  return (
    <section
      aria-label={`Conversa Hermes ${channel.name}`}
      className="fixed bottom-5 right-5 z-[var(--uix-z-modal)] grid h-[min(34rem,calc(100dvh-3rem))] w-[min(27rem,calc(100vw-2rem))] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-lg border border-[#d9e0e7] bg-white shadow-2xl"
    >
      <header className="flex h-14 items-center gap-3 border-b border-[#d9e0e7] bg-[#101820] px-3 text-white">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-[#101820] text-xs font-bold">
          {channel.avatar}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">
            {channel.name}
          </span>
          <span className="block truncate text-xs text-[#cbd5e1]">
            Hermes
          </span>
        </span>
        <Link
          aria-label="Abrir canal no Hermes"
          className="grid h-8 w-8 place-items-center rounded-md text-[#dbe4ef] outline-none transition hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-[#D6B56F]"
          href={getHermesChannelPath(channel.id)}
        >
          <ExternalLink aria-hidden="true" size={16} />
        </Link>
        <button
          aria-label="Fechar conversa"
          className="grid h-8 w-8 place-items-center rounded-md text-[#dbe4ef] outline-none transition hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-[#D6B56F]"
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" size={17} />
        </button>
      </header>
      <div className="min-h-0 overflow-y-auto bg-[#f6f8fb] p-3" ref={scrollRef}>
        {loading ? (
          <div className="grid h-full min-h-48 place-items-center text-sm text-[#6b778c]">
            Carregando conversa...
          </div>
        ) : messages.length > 0 ? (
          <div className="grid gap-2">
            {messages.map((message) => {
              const ownMessage = message.authorId === currentUserId;

              return (
                <article
                  className={`grid max-w-[86%] gap-1 rounded-lg border px-3 py-2 text-sm shadow-sm ${
                    ownMessage
                      ? "ml-auto border-[#bfe9d5] bg-[#eafaf2]"
                      : "mr-auto border-[#d9e0e7] bg-white"
                  }`}
                  key={message.id}
                >
                  <div className="flex items-center justify-between gap-3 text-[0.7rem] font-semibold text-[#6b778c]">
                    <span className="truncate">
                      {ownMessage
                        ? "Voce"
                        : (message.authorName ?? HERMES_MODULE_LABEL)}
                    </span>
                    <span>{message.timestamp}</span>
                  </div>
                  <p className="m-0 whitespace-pre-wrap break-words text-[#17202f]">
                    {message.body}
                  </p>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="grid h-full min-h-48 place-items-center text-sm text-[#6b778c]">
            Sem mensagens recentes.
          </div>
        )}
      </div>
      <form
        className="grid gap-2 border-t border-[#d9e0e7] bg-white p-3"
        onSubmit={handleSubmit}
      >
        {error ? (
          <p className="m-0 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700">
            {error}
          </p>
        ) : null}
        <div className="grid grid-cols-[minmax(0,1fr)_2.5rem] gap-2">
          <input
            className="h-10 rounded-md border border-[#d9e0e7] px-3 text-sm text-[#17202f] outline-none transition placeholder:text-[#9aa6b5] focus:border-[#A07C3B] focus:ring-2 focus:ring-[#A07C3B]/20"
            onChange={(event) => setDraft(event.target.value)}
            placeholder={`Mensagem ${channel.name}...`}
            value={draft}
          />
          <button
            aria-label="Enviar mensagem"
            className="grid h-10 w-10 place-items-center rounded-md bg-[#101820] text-white outline-none transition hover:bg-[#1d2734] focus-visible:ring-2 focus-visible:ring-[#A07C3B] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!draft.trim() || sending}
            type="submit"
          >
            <Send aria-hidden="true" size={16} />
          </button>
        </div>
      </form>
    </section>
  );
}

function normalizePanteonNotification(
  notification: PanteonNotificationInput,
): PanteonNotificationItem {
  const createdAt = notification.createdAt ?? new Date().toISOString();

  return {
    ...notification,
    createdAt,
    id:
      notification.id ??
      `${notification.moduleId}:${notification.kind}:${createdAt}:${notification.title}`,
    read: notification.read ?? false,
    severity: notification.severity ?? "neutral",
  };
}

const PANTEON_NOTIFICATIONS_STORAGE_PREFIX = "careli:panteon:notifications:";

function getPanteonNotificationsStorageKey(userId: string) {
  return `${PANTEON_NOTIFICATIONS_STORAGE_PREFIX}${userId}`;
}

function readStoredPanteonNotifications(
  userId: string,
): PanteonNotificationItem[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(
      getPanteonNotificationsStorageKey(userId),
    );

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);

    return Array.isArray(parsed) ? (parsed as PanteonNotificationItem[]) : [];
  } catch {
    return [];
  }
}

function writeStoredPanteonNotifications(
  userId: string,
  items: readonly PanteonNotificationItem[],
) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      getPanteonNotificationsStorageKey(userId),
      JSON.stringify(
        items
          .filter((item) => isPanteonNotificationFromToday(item.createdAt))
          .slice(0, MAX_PANTEON_NOTIFICATION_ITEMS),
      ),
    );
  } catch {
    // localStorage indisponivel/cheio — historico persistido e best-effort.
  }
}

function groupHermesMessagesByChannel(messages: readonly HermesMessage[]) {
  const messagesByChannel = new Map<HermesChannel["id"], HermesMessage[]>();

  for (const message of messages) {
    const channelMessages = messagesByChannel.get(message.channelId) ?? [];

    channelMessages.push(message);
    messagesByChannel.set(message.channelId, channelMessages);
  }

  return messagesByChannel;
}

function getOldestHermesReadCursor(
  channels: readonly HermesChannel[],
  currentUserId: string,
) {
  let oldestReadAt: string | undefined;

  for (const channel of channels) {
    const readAt = channel.memberReadAtByUserId?.[currentUserId];

    if (!readAt) {
      return undefined;
    }

    if (!oldestReadAt || Date.parse(readAt) < Date.parse(oldestReadAt)) {
      oldestReadAt = readAt;
    }
  }

  return oldestReadAt;
}

function createHermesChannelNotification({
  channel,
  currentUserId,
  messages,
}: {
  channel: HermesChannel;
  currentUserId: string;
  messages: readonly HermesMessage[];
}) {
  const unreadMessages = getUnreadMessages({
    channel,
    currentUserId,
    messages,
  });

  if (unreadMessages.length === 0) {
    return null;
  }

  const latestMessage = unreadMessages[unreadMessages.length - 1];
  const mentioned = unreadMessages.some((message) =>
    message.mentionUserIds?.includes(currentUserId),
  );

  if (!latestMessage) {
    return null;
  }

  return normalizePanteonNotification({
    actionLabel: "Abrir conversa",
    context: {
      hermesChannelId: channel.id,
      entityId: latestMessage.id,
      entityType: "message",
    },
    createdAt: latestMessage.createdAt ?? new Date().toISOString(),
    description: `${latestMessage.authorName ?? HERMES_MODULE_LABEL}: ${truncateNotificationBody(latestMessage.body)}`,
    href: getHermesChannelPath(channel.id),
    id: getHermesChannelNotificationId(channel.id),
    kind: "mensagem",
    moduleId: HERMES_MODULE_ID,
    moduleLabel: HERMES_MODULE_LABEL,
    severity: mentioned ? "warning" : "info",
    title:
      unreadMessages.length > 1
        ? `${unreadMessages.length} mensagens em ${channel.name}`
        : `Nova mensagem em ${channel.name}`,
  });
}

function getUnreadMessages({
  channel,
  currentUserId,
  messages,
}: {
  channel: HermesChannel;
  currentUserId: string;
  messages: readonly HermesMessage[];
}) {
  const lastReadAt = channel.memberReadAtByUserId?.[currentUserId];
  const lastReadTime = lastReadAt ? Date.parse(lastReadAt) : Number.NaN;

  return messages.filter((message) => {
    if (
      message.authorId === currentUserId ||
      message.deletedAt ||
      message.threadParentMessageId
    ) {
      return false;
    }

    const createdAt = message.createdAt ?? message.timestamp;
    const messageTime = Date.parse(createdAt);

    if (Number.isNaN(messageTime)) {
      return false;
    }

    if (Number.isNaN(lastReadTime)) {
      return true;
    }

    return messageTime > lastReadTime;
  });
}

function getHermesChannelNotificationId(channelId: HermesChannel["id"]) {
  return `${HERMES_MODULE_ID}:channel:${channelId}`;
}

function getHermesMessageLogId(messageId: HermesMessage["id"]) {
  return `${HERMES_MODULE_ID}:msg:${messageId}`;
}

// #2: item do historico diario por mensagem. Diferente da notificacao por-canal
// (que colapsa e vira o badge "novas"), cada mensagem recebida vira UMA linha no
// historico, com horario. Ja entra como LIDA (read) para ser puro historico.
function createHermesMessageLogItem({
  channel,
  mentioned,
  message,
}: {
  channel: HermesChannel;
  mentioned: boolean;
  message: HermesMessage;
}): PanteonNotificationItem {
  return normalizePanteonNotification({
    actionLabel: "Abrir conversa",
    context: {
      hermesChannelId: channel.id,
      entityId: message.id,
      entityType: "message",
    },
    createdAt: message.createdAt ?? new Date().toISOString(),
    description: `${message.authorName ?? HERMES_MODULE_LABEL}: ${truncateNotificationBody(message.body)}`,
    href: getHermesChannelPath(channel.id),
    id: getHermesMessageLogId(message.id),
    kind: "mensagem",
    moduleId: HERMES_MODULE_ID,
    moduleLabel: HERMES_MODULE_LABEL,
    read: true,
    severity: mentioned ? "warning" : "info",
    title: `Mensagem em ${channel.name}`,
  });
}

function getHermesChannelPath(channelId: HermesChannel["id"]) {
  return `/hermes?channel=${encodeURIComponent(channelId)}`;
}

function upsertNotification(
  currentItems: readonly PanteonNotificationItem[],
  notification: PanteonNotificationItem,
) {
  return mergeNotifications(currentItems, [notification]);
}

function mergeNotifications(
  currentItems: readonly PanteonNotificationItem[],
  nextItems: readonly PanteonNotificationItem[],
) {
  const itemsById = new Map<string, PanteonNotificationItem>();

  currentItems.forEach((item) => itemsById.set(item.id, item));
  nextItems.forEach((item) => {
    const currentItem = itemsById.get(item.id);

    itemsById.set(item.id, {
      ...currentItem,
      ...item,
      read: item.read ?? currentItem?.read ?? false,
    });
  });

  return [...itemsById.values()].sort(
    (firstItem, secondItem) =>
      getNotificationSortTime(secondItem) - getNotificationSortTime(firstItem),
  );
}

function mergePopupMessages(
  currentMessages: readonly HermesMessage[],
  nextMessages: readonly HermesMessage[],
) {
  const messagesById = new Map<string, HermesMessage>();

  currentMessages.forEach((message) => messagesById.set(message.id, message));
  nextMessages.forEach((message) => messagesById.set(message.id, message));

  return [...messagesById.values()].sort(
    (firstMessage, secondMessage) =>
      getHermesMessageTime(firstMessage) - getHermesMessageTime(secondMessage),
  );
}

function getHermesMessageTime(message: HermesMessage) {
  const value = message.createdAt ?? message.timestamp;
  const time = Date.parse(value);

  return Number.isNaN(time) ? 0 : time;
}

function getNotificationSortTime(notification: PanteonNotificationItem) {
  const time = Date.parse(notification.createdAt);

  return Number.isNaN(time) ? 0 : time;
}

function truncateNotificationBody(body: string) {
  const normalizedBody = body.replace(/\s+/g, " ").trim();

  return normalizedBody.length > 140
    ? `${normalizedBody.slice(0, 137)}...`
    : normalizedBody;
}

function getReadableError(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return "Nao foi possivel concluir a acao.";
}

function isHermesWorkspaceRoute() {
  if (typeof window === "undefined") {
    return false;
  }

  const pathname = window.location.pathname.toLowerCase();

  return pathname === "/hermes" || pathname.startsWith("/hermes/");
}
