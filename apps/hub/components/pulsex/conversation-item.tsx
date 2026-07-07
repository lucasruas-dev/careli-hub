import type { HermesChannel } from "@/lib/pulsex";
import type { ReactNode } from "react";
import Image from "next/image";
import { Bot, Hash, Megaphone, Users } from "lucide-react";
import { Tooltip } from "@repo/uix";

type ConversationItemProps = {
  active?: boolean;
  channel: HermesChannel;
  collapsed?: boolean;
  onSelect?: (channelId: HermesChannel["id"]) => void;
};

export function ConversationItem({
  active = false,
  channel,
  collapsed = false,
  onSelect,
}: ConversationItemProps) {
  const ChannelIcon = getChannelIcon(channel);
  const collapsedLabel = getCollapsedChannelLabel(channel);

  if (collapsed) {
    return (
      <Tooltip content={channel.name} placement="right">
        <button
          aria-current={active ? "page" : undefined}
          aria-label={channel.name}
          className="relative grid h-11 w-11 place-items-center rounded-xl text-left outline-none transition hover:bg-[#2A2B32]/80 focus-visible:ring-2 focus-visible:ring-[#d0ad69] data-[active=true]:bg-[#2A2B32]"
          data-active={active}
          onClick={() => onSelect?.(channel.id)}
          type="button"
        >
          {active ? (
            <span className="absolute left-0 top-2 h-7 w-0.5 rounded-full bg-[#A07C3B]" />
          ) : null}
          <ChannelAvatar
            active={active}
            channel={channel}
            collapsed={collapsed}
            icon={<ChannelIcon aria-hidden="true" size={17} />}
            label={collapsedLabel}
            showUnread
          />
        </button>
      </Tooltip>
    );
  }

  return (
    <button
      aria-current={active ? "page" : undefined}
      className="relative grid w-full grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-3 rounded-lg px-4 py-2 text-left outline-none transition hover:bg-[#2A2B32]/80 focus-visible:ring-2 focus-visible:ring-[#d0ad69] data-[active=true]:bg-[#2A2B32]"
      data-active={active}
      onClick={() => onSelect?.(channel.id)}
      type="button"
    >
      {active ? (
        <span className="absolute left-0 top-2 h-7 w-0.5 rounded-full bg-[#A07C3B]" />
      ) : null}
      <ChannelAvatar
        active={active}
        channel={channel}
        collapsed={collapsed}
        icon={<ChannelIcon aria-hidden="true" size={17} />}
        label={channel.avatar}
      />
      <span className="min-w-0 py-1.5">
        <span className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-1.5">
            {/* Marcacao NA FRENTE do canal (pedido Lucas 7/jul): bolinha fixa
                enquanto houver mensagem nao lida — ambar p/ mencao, dourada
                p/ mensagem comum. So some quando o canal e aberto de fato. */}
            {channel.unreadMentionCount ? (
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full bg-amber-400"
              />
            ) : channel.unreadCount ? (
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full bg-[#D5B46F]"
              />
            ) : null}
            <span
              className={`truncate text-sm ${
                channel.unreadCount || channel.unreadMentionCount
                  ? "font-bold text-white"
                  : "font-semibold text-[#f7f8fa]"
              }`}
            >
              {channel.name}
            </span>
          </span>
          {channel.unreadMentionCount ? (
            <span
              aria-label={`${channel.unreadMentionCount} mencoes novas`}
              className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-amber-400 px-1.5 text-[0.68rem] font-bold text-[#1d1e24]"
            >
              @{formatUnreadCount(channel.unreadMentionCount)}
            </span>
          ) : channel.unreadCount ? (
            <span
              aria-label={`${channel.unreadCount} mensagens novas`}
              className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-[#A07C3B] px-1.5 text-[0.68rem] font-semibold text-white"
            >
              {formatUnreadCount(channel.unreadCount)}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

function getCollapsedChannelLabel(channel: HermesChannel) {
  if (channel.kind === "direct") {
    return channel.avatar;
  }

  const words = channel.name.trim().split(/\s+/).filter(Boolean);

  if (words.length > 1) {
    return words
      .map((word) => word.charAt(0))
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }

  const compactName = channel.name.replace(/[^a-z0-9]/gi, "");

  return compactName.slice(0, 2).toUpperCase() || "#";
}

function ChannelAvatar({
  active,
  channel,
  collapsed = false,
  icon,
  label,
  showUnread = false,
}: {
  active: boolean;
  channel: HermesChannel;
  collapsed?: boolean;
  icon?: ReactNode;
  label: string;
  showUnread?: boolean;
}) {
  const isDirect = channel.kind === "direct";
  const avatarSizeClass = isDirect && !collapsed ? "h-10 w-10" : "h-9 w-9";

  return (
    <span
      className={`relative grid ${avatarSizeClass} place-items-center overflow-visible border bg-white/[0.06] ${
        active ? "text-[#D5B46F]" : "text-[#f7f8fa]"
      } ${
        isDirect
          ? "rounded-full border-white/20 text-xs font-semibold shadow-[0_0_0_1px_rgba(255,255,255,0.08)]"
          : "rounded-md border-white/[0.085]"
      }`}
    >
      {isDirect && channel.avatarUrl ? (
        <span
          aria-hidden="true"
          className="absolute inset-0 overflow-hidden rounded-full"
        >
          <Image
            alt=""
            className="object-cover"
            draggable={false}
            fill
            sizes={isDirect && !collapsed ? "40px" : "36px"}
            src={channel.avatarUrl}
            unoptimized
          />
        </span>
      ) : (
        <span className="relative z-10 grid place-items-center text-[0.68rem] font-semibold leading-none">
          {isDirect ? label : collapsed ? label : (icon ?? label)}
        </span>
      )}
      {showUnread && channel.unreadMentionCount ? (
        <span
          aria-label={`${channel.unreadMentionCount} mencoes novas`}
          className="absolute -right-1 -top-1 z-20 grid h-4 min-w-4 place-items-center rounded-full bg-amber-400 px-1 text-[0.58rem] font-bold text-[#1d1e24]"
        >
          @
        </span>
      ) : showUnread && channel.unreadCount ? (
        <span
          aria-label={`${channel.unreadCount} mensagens novas`}
          className="absolute -right-1 -top-1 z-20 grid h-4 min-w-4 place-items-center rounded-full bg-[#A07C3B] px-1 text-[0.58rem] font-semibold text-white"
        >
          {formatUnreadCount(channel.unreadCount)}
        </span>
      ) : null}
      {isDirect && channel.status ? (
        <span
          aria-hidden="true"
          className="absolute -bottom-0.5 -right-0.5 z-20 h-3 w-3 rounded-full border-2 border-[#343541] data-[status=agenda]:bg-sky-500 data-[status=away]:bg-red-500 data-[status=busy]:bg-sky-500 data-[status=lunch]:bg-yellow-400 data-[status=offline]:bg-zinc-500 data-[status=online]:bg-emerald-500"
          data-status={channel.status}
        />
      ) : null}
    </span>
  );
}

function formatUnreadCount(count: number) {
  return count > 99 ? "99+" : count.toString();
}

function getChannelIcon(channel: HermesChannel) {
  if (channel.kind === "direct") {
    return Users;
  }

  if (channel.kind === "system") {
    return Bot;
  }

  if (isAnnouncementChannel(channel)) {
    return Megaphone;
  }

  return Hash;
}

function isAnnouncementChannel(channel: HermesChannel) {
  const normalizedName = channel.name.trim().toLowerCase();

  return (
    normalizedName === "comunicados" ||
    channel.id.toLowerCase().endsWith("-comunicados")
  );
}
