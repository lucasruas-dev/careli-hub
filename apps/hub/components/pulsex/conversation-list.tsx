import type { HermesChannel } from "@/lib/pulsex";
import { ConversationItem } from "./conversation-item";

type ConversationListProps = {
  activeChannelId: string;
  channels: readonly HermesChannel[];
  collapsed?: boolean;
  onSelectChannel?: (channelId: HermesChannel["id"]) => void;
};

export function ConversationList({
  activeChannelId,
  channels,
  collapsed = false,
  onSelectChannel,
}: ConversationListProps) {
  return (
    <nav
      aria-label="Conversas Hermes"
      className={collapsed ? "grid justify-items-center gap-1" : "grid gap-0.5"}
    >
      {channels.map((channel) => (
        <ConversationItem
          active={channel.id === activeChannelId}
          channel={channel}
          collapsed={collapsed}
          key={channel.id}
          onSelect={onSelectChannel}
        />
      ))}
    </nav>
  );
}
