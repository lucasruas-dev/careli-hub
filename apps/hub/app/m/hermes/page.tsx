"use client";

import Link from "next/link";
import { useMemo } from "react";
import { MessageSquareDashed } from "lucide-react";

import { usePanteonNotifications } from "@/providers/pulsex-notification-provider";
import { MobileListScreen } from "@/modules/mobile/components/mobile-list-screen";
import {
  MobileAvatar,
  MobileEmptyState,
  UnreadBadge,
} from "@/modules/mobile/components/mobile-ui";
import { formatRelativeTime } from "@/modules/mobile/lib/format";

export default function MobileHermesListPage() {
  const { hermesChannels } = usePanteonNotifications();

  const channels = useMemo(
    () =>
      [...hermesChannels].sort(
        (a, b) =>
          (Date.parse(b.lastMessageAt) || 0) -
          (Date.parse(a.lastMessageAt) || 0),
      ),
    [hermesChannels],
  );

  const totalUnread = channels.reduce(
    (total, channel) => total + (channel.unreadCount ?? 0),
    0,
  );

  return (
    <MobileListScreen
      subheader={
        <div className="border-b border-[#e4e9f0] bg-white px-4 py-2.5">
          <p className="m-0 text-[13px] font-semibold text-[#101820]">
            Canais do time
          </p>
          <p className="m-0 text-[11px] text-[#9aa6b5]">
            {totalUnread > 0 ? `${totalUnread} não lidas` : "Comunicação interna"}
          </p>
        </div>
      }
    >
      {channels.length === 0 ? (
        <MobileEmptyState
          description="As conversas dos seus canais aparecem aqui."
          icon={<MessageSquareDashed aria-hidden="true" size={22} />}
          title="Nenhuma conversa"
        />
      ) : (
        <ul className="m-0 list-none p-0">
          {channels.map((channel) => {
            const unread = channel.unreadCount ?? 0;

            return (
              <li key={channel.id}>
                <Link
                  className="flex items-center gap-3 border-b border-[#eef1f5] bg-white px-3 py-3 outline-none transition active:scale-[0.99]"
                  href={`/m/hermes/${encodeURIComponent(channel.id)}`}
                >
                  <MobileAvatar label={channel.name} url={channel.avatarUrl} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span
                        className={`min-w-0 flex-1 truncate text-sm ${
                          unread > 0
                            ? "font-semibold text-[#101820]"
                            : "font-medium text-[#26313f]"
                        }`}
                      >
                        {channel.name}
                      </span>
                      <span className="shrink-0 text-[0.7rem] text-[#9aa6b5]">
                        {formatRelativeTime(channel.lastMessageAt)}
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-2">
                      <span
                        className={`min-w-0 flex-1 truncate text-xs ${
                          unread > 0 ? "text-[#3a4657]" : "text-[#6b778c]"
                        }`}
                      >
                        {channel.preview || "Sem mensagens recentes."}
                      </span>
                      <UnreadBadge count={unread} />
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </MobileListScreen>
  );
}
