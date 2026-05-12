import type { PulseXChannel } from "@/lib/pulsex";
import { ConversationItem } from "./conversation-item";

type ConversationListProps = {
  activeChannelId: string;
  channels: readonly PulseXChannel[];
  onSelectChannel?: (channelId: PulseXChannel["id"]) => void;
};

export function ConversationList({
  activeChannelId,
  channels,
  onSelectChannel,
}: ConversationListProps) {
  return (
    <nav aria-label="Conversas PulseX">
      {channels.map((channel) => (
        <ConversationItem
          active={channel.id === activeChannelId}
          channel={channel}
          key={channel.id}
          onSelect={onSelectChannel}
        />
      ))}
    </nav>
  );
}
