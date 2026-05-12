import type { PulseXChannel } from "@/lib/pulsex";
import {
  Bot,
  Cpu,
  Hash,
  HeartHandshake,
  Users,
} from "lucide-react";

const channelIconMap = {
  direct: Users,
  operations: Hash,
  relation: HeartHandshake,
  system: Bot,
  technology: Cpu,
} as const;

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
  const ChannelIcon = channelIconMap[channel.kind];
  const isDirect = channel.kind === "direct";

  return (
    <button
      aria-current={active ? "page" : undefined}
      className="grid w-full grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-3 border-l-2 border-transparent px-4 py-2.5 text-left outline-none transition hover:bg-white/[0.055] focus-visible:ring-2 focus-visible:ring-[#d7b66f] data-[active=true]:border-[#A07C3B] data-[active=true]:bg-[#1b1e26]"
      data-active={active}
      onClick={() => onSelect?.(channel.id)}
      type="button"
    >
      <span
        className={`relative grid h-10 w-10 place-items-center border border-white/[0.08] bg-white/[0.055] text-[#e8edf5] ${
          isDirect ? "rounded-full text-xs font-semibold" : "rounded-md"
        }`}
      >
        {isDirect ? (
          channel.avatar
        ) : (
          <ChannelIcon aria-hidden="true" size={17} />
        )}
        {channel.status ? (
          <span
            aria-hidden="true"
            className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#101217] data-[status=away]:bg-amber-400 data-[status=busy]:bg-[#b42318] data-[status=offline]:bg-zinc-500 data-[status=online]:bg-emerald-500"
            data-status={channel.status}
          />
        ) : null}
      </span>
      <span className="min-w-0 border-b border-white/[0.06] pb-2.5">
        <span className="flex items-center justify-between gap-3">
          <span className="truncate text-sm font-semibold text-white">
            {channel.name}
          </span>
          <span className="text-[0.68rem] text-[#8d95a3]">
            {channel.lastMessageAt}
          </span>
        </span>
        <span className="mt-1 flex items-center justify-between gap-3">
          <span className="truncate text-xs text-[#aeb7c5]">
            {channel.preview}
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
