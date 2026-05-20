"use client";

import { useEffect, useRef, type ReactNode } from "react";
import {
  playHermesIncomingMessageSound,
  registerHermesNotificationPermissionIntent,
  showBrowserHermesNotification,
} from "@/lib/pulsex/notification-effects";
import {
  PULSEX_MESSAGE_BROADCAST_EVENT,
  getHermesMessageRealtimeTopic,
  parseHermesMessageBroadcastPayload,
} from "@/lib/pulsex/realtime";
import { listHermesNotificationChannels } from "@/lib/pulsex/supabase-data";
import {
  getHubSupabaseClient,
  hasHubSupabaseConfig,
  logSupabaseDiagnostic,
  serializeDiagnosticError,
} from "@/lib/supabase/client";
import { useAuth } from "@/providers/auth-provider";

type HubSupabaseClient = NonNullable<ReturnType<typeof getHubSupabaseClient>>;
type HubRealtimeChannel = ReturnType<HubSupabaseClient["channel"]>;

export function HermesNotificationProvider({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const { hubUser, profileStatus } = useAuth();
  const currentUserId = hubUser?.id ?? "";
  const notifiedMessageIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => registerHermesNotificationPermissionIntent(), []);

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

    let isMounted = true;
    let realtimeChannels: HubRealtimeChannel[] = [];

    listHermesNotificationChannels({
      currentUserId,
      userRole: hubUser?.role,
    })
      .then((channels) => {
        if (!isMounted) {
          return;
        }

        realtimeChannels = channels.map((channel) => {
          const realtimeChannel = client.channel(
            getHermesMessageRealtimeTopic(channel.id),
            {
              config: {
                broadcast: {
                  ack: true,
                  self: false,
                },
              },
            },
          );

          realtimeChannel
            .on(
              "broadcast",
              {
                event: PULSEX_MESSAGE_BROADCAST_EVENT,
              },
              (payload: { payload?: unknown }) => {
                const message = parseHermesMessageBroadcastPayload(
                  payload.payload,
                );

                if (
                  !message ||
                  message.channelId !== channel.id ||
                  message.authorId === currentUserId ||
                  notifiedMessageIdsRef.current.has(message.id)
                ) {
                  return;
                }

                notifiedMessageIdsRef.current.add(message.id);
                const mentioned = message.mentionUserIds?.includes(currentUserId);

                playHermesIncomingMessageSound({
                  mentioned,
                  messageId: message.id,
                });
                showBrowserHermesNotification({
                  body: `${message.authorName ?? "Hermes"}: ${truncateNotificationBody(message.body)}`,
                  onClickPath: "/hermes",
                  tag: `pulsex-message-${message.id}`,
                  title: mentioned
                    ? "Voce foi mencionado no Hermes"
                    : `Nova mensagem em ${channel.name}`,
                });
              },
            )
            .subscribe((status) => {
              logSupabaseDiagnostic("pulsex", "global message realtime status", {
                channelId: channel.id,
                status,
              });
            });

          return realtimeChannel;
        });
      })
      .catch((error: unknown) => {
        logSupabaseDiagnostic("pulsex", "global notifications error", {
          error: serializeDiagnosticError(error),
        });
      });

    return () => {
      isMounted = false;
      realtimeChannels.forEach((realtimeChannel) => {
        void client.removeChannel(realtimeChannel);
      });
      realtimeChannels = [];
    };
  }, [currentUserId, hubUser?.role, profileStatus]);

  return children;
}

function truncateNotificationBody(body: string) {
  const normalizedBody = body.replace(/\s+/g, " ").trim();

  return normalizedBody.length > 140
    ? `${normalizedBody.slice(0, 137)}...`
    : normalizedBody;
}
