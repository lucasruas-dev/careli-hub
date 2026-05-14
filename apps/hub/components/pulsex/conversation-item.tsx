import type { PulseXChannel } from "@/lib/pulsex";
import {
  Bot,
  Hash,
  Megaphone,
  Users,
} from "lucide-react";

type ConversationItemProps = {
  active?: boolean;
  channel: PulseXChannel;
  onSelect?: (channelId: PulseXChannel["id"]) => void;
};

export function ConversationItem({
  active = false,
  channel,
  onSelect,
}: ConversationItemProps) {
  const ChannelIcon = getChannelIcon(channel);
  const isDirect = channel.kind === "direct";

  return (
    <button
      aria-current={active ? "page" : undefined}
      className="grid w-full grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-3 border-l-2 border-transparent px-4 py-2 text-left outline-none transition hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-[#d0ad69] data-[active=true]:border-[#A07C3B] data-[active=true]:bg-[#A07C3B]/[0.18]"
      data-active={active}
      onClick={() => onSelect?.(channel.id)}
      type="button"
    >
      <span
        className={`relative grid h-9 w-9 place-items-center border border-white/[0.085] bg-white/[0.06] text-[#f7f8fa] ${
          isDirect ? "rounded-full text-xs font-semibold" : "rounded-md"
        }`}
      >
        {isDirect ? (
          channel.avatar
        ) : (
          <ChannelIcon aria-hidden="true" size={17} />
        )}
        {isDirect && channel.status ? (
          <span
            aria-hidden="true"
            className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#101820] data-[status=agenda]:bg-sky-500 data-[status=away]:bg-red-500 data-[status=busy]:bg-sky-500 data-[status=lunch]:bg-yellow-400 data-[status=offline]:bg-zinc-500 data-[status=online]:bg-emerald-500"
            data-status={channel.status}
          />
        ) : null}
      </span>
      <span className="min-w-0 border-b border-white/[0.065] py-1.5">
        <span className="flex items-center justify-between gap-3">
          <span className="truncate text-sm font-semibold text-[#f7f8fa]">
            {channel.name}
          </span>
          {channel.unreadCount ? (
            <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-[#A07C3B] px-1.5 text-[0.68rem] font-semibold text-white">
              {channel.unreadCount}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

function getChannelIcon(channel: PulseXChannel) {
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

function isAnnouncementChannel(channel: PulseXChannel) {
  const normalizedName = channel.name.trim().toLowerCase();

  return (
    normalizedName === "comunicados" ||
    channel.id.toLowerCase().endsWith("-comunicados")
  );
}
