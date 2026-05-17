"use client";

import { useEffect, useRef, type ReactNode } from "react";
import {
  playPulseXMessageSound,
  registerPulseXNotificationPermissionIntent,
  showBrowserPulseXNotification,
} from "@/lib/pulsex/notification-effects";
import {
  PULSEX_MESSAGE_BROADCAST_EVENT,
  getPulseXMessageRealtimeTopic,
  parsePulseXMessageBroadcastPayload,
} from "@/lib/pulsex/realtime";
import { listPulseXNotificationChannels } from "@/lib/pulsex/supabase-data";
import {
  getHubSupabaseClient,
  hasHubSupabaseConfig,
  logSupabaseDiagnostic,
  serializeDiagnosticError,
} from "@/lib/supabase/client";
import { useAuth } from "@/providers/auth-provider";

type HubSupabaseClient = NonNullable<ReturnType<typeof getHubSupabaseClient>>;
type HubRealtimeChannel = ReturnType<HubSupabaseClient["channel"]>;

export function PulseXNotificationProvider({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const { hubUser, profileStatus } = useAuth();
  const currentUserId = hubUser?.id ?? "";
  const notifiedMessageIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => registerPulseXNotificationPermissionIntent(), []);

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

    listPulseXNotificationChannels({
      currentUserId,
      userRole: hubUser?.role,
    })
      .then((channels) => {
        if (!isMounted) {
          return;
        }

        realtimeChannels = channels.map((channel) => {
          const realtimeChannel = client.channel(
            getPulseXMessageRealtimeTopic(channel.id),
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
                const message = parsePulseXMessageBroadcastPayload(
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
                playPulseXMessageSound();
                showBrowserPulseXNotification({
                  body: `${message.authorName ?? "PulseX"}: ${truncateNotificationBody(message.body)}`,
                  onClickPath: "/pulsex",
                  tag: `pulsex-message-${message.id}`,
                  title: message.mentionUserIds?.includes(currentUserId)
                    ? "Voce foi mencionado no PulseX"
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
