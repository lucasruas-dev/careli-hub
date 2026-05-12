"use client";

import {
  pulsexCallSessions,
  pulsexChannels,
  pulsexMessages,
  pulsexPresenceUsers,
  pulsexReactionOptions,
  pulsexThreadReplies,
} from "@/lib/pulsex";
import type {
  PulseXCallSession,
  PulseXCallType,
  PulseXChannel,
  PulseXMessageFilter,
  PulseXMessage,
  PulseXPresenceUser,
  PulseXReactionEmoji,
  PulseXThreadReply,
} from "@/lib/pulsex";
import { CallPanel } from "./call-panel";
import { useMemo, useState } from "react";
import { ConversationHeader } from "./conversation-header";
import { ConversationSidebar } from "./conversation-sidebar";
import { IncomingCallBanner } from "./incoming-call-banner";
import { MessageComposer } from "./message-composer";
import { MessageList } from "./message-list";
import { ThreadPanel } from "./thread-panel";

const currentUserId = "ana";

export function PulseXWorkspace() {
  const [activeChannelId, setActiveChannelId] =
    useState<PulseXChannel["id"]>("cobranca");
  const [channels, setChannels] = useState<PulseXChannel[]>(() =>
    pulsexChannels.map((channel) => ({ ...channel })),
  );
  const [messages, setMessages] = useState<PulseXMessage[]>(() =>
    pulsexMessages.map((message) => ({ ...message })),
  );
  const [threadReplies, setThreadReplies] = useState<
    Record<string, PulseXThreadReply[]>
  >(() =>
    Object.fromEntries(
      Object.entries(pulsexThreadReplies).map(([messageId, replies]) => [
        messageId,
        replies.map((reply) => ({ ...reply })),
      ]),
    ),
  );
  const [activeThreadMessageId, setActiveThreadMessageId] = useState<
    PulseXMessage["id"] | null
  >(null);
  const [activeMessageFilter, setActiveMessageFilter] =
    useState<PulseXMessageFilter>("all");
  const [activeCall, setActiveCall] = useState<PulseXCallSession | null>(null);
  const [incomingCall, setIncomingCall] = useState<PulseXCallSession | null>(
    () =>
      pulsexCallSessions.find((session) => session.status === "ringing") ??
      null,
  );
  const [composerValue, setComposerValue] = useState("");
  const [threadComposerValue, setThreadComposerValue] = useState("");
  const activeChannel =
    channels.find((channel) => channel.id === activeChannelId) ??
    pulsexChannels[0];
  const activeThreadMessage = activeThreadMessageId
    ? messages.find((message) => message.id === activeThreadMessageId)
    : undefined;
  const activeThreadReplies = activeThreadMessageId
    ? (threadReplies[activeThreadMessageId] ?? [])
    : [];
  const channelMessages = messages.filter(
    (message) => message.channelId === activeChannel.id,
  );
  const filteredChannelMessages =
    activeMessageFilter === "all"
      ? channelMessages
      : channelMessages.filter((message) =>
          message.tags?.includes(activeMessageFilter),
        );
  const channelPresenceUsers = useMemo(
    () =>
      pulsexPresenceUsers.filter((user) =>
        (user.channelIds as readonly string[]).includes(activeChannel.id),
      ),
    [activeChannel.id],
  );

  function handleSelectChannel(channelId: PulseXChannel["id"]) {
    setActiveChannelId(channelId);
    setActiveThreadMessageId(null);
    setThreadComposerValue("");
    setChannels((currentChannels) =>
      currentChannels.map((channel) =>
        channel.id === channelId ? { ...channel, unreadCount: 0 } : channel,
      ),
    );
  }

  function handleStartCall(type: PulseXCallType) {
    setActiveCall(
      createLocalCallSession({
        channel: activeChannel,
        participants: channelPresenceUsers,
        type,
      }),
    );
    setIncomingCall(null);
  }

  function handleAcceptIncomingCall() {
    if (!incomingCall) {
      return;
    }

    setActiveCall({
      ...incomingCall,
      durationLabel: "00:03",
      status: "active",
    });
    setIncomingCall(null);
  }

  function handleSendMessage() {
    const body = composerValue.trim();

    if (!body) {
      return;
    }

    const timestamp = new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date());

    setMessages((currentMessages) => [
      ...currentMessages,
      {
        authorId: currentUserId,
        body,
        channelId: activeChannel.id,
        id: `local-${activeChannel.id}-${Date.now()}`,
        reactions: [],
        status: "neutral",
        tags: [],
        threadCount: 0,
        timestamp,
      },
    ]);
    setChannels((currentChannels) =>
      currentChannels.map((channel) =>
        channel.id === activeChannel.id
          ? {
              ...channel,
              lastMessageAt: timestamp,
              preview: body,
              unreadCount: 0,
            }
          : channel,
      ),
    );
    setComposerValue("");
  }

  function handleToggleReaction(
    messageId: PulseXMessage["id"],
    emoji: PulseXReactionEmoji,
  ) {
    setMessages((currentMessages) =>
      currentMessages.map((message) => {
        if (message.id !== messageId) {
          return message;
        }

        const reactions = [...(message.reactions ?? [])];
        const reactionIndex = reactions.findIndex(
          (reaction) => reaction.emoji === emoji,
        );

        if (reactionIndex < 0) {
          return {
            ...message,
            reactions: [
              ...reactions,
              {
                count: 1,
                emoji,
                reactedByUserIds: [currentUserId],
              },
            ],
          };
        }

        const reaction = reactions[reactionIndex];

        if (!reaction) {
          return message;
        }

        const hasReacted = reaction.reactedByUserIds.includes(currentUserId);
        const reactedByUserIds = hasReacted
          ? reaction.reactedByUserIds.filter((userId) => userId !== currentUserId)
          : [...reaction.reactedByUserIds, currentUserId];
        const count = hasReacted ? reaction.count - 1 : reaction.count + 1;

        if (count <= 0) {
          reactions.splice(reactionIndex, 1);
        } else {
          reactions[reactionIndex] = {
            ...reaction,
            count,
            reactedByUserIds,
          };
        }

        return {
          ...message,
          reactions,
        };
      }),
    );
  }

  function handleSubmitThreadReply() {
    const body = threadComposerValue.trim();

    if (!body || !activeThreadMessage) {
      return;
    }

    const timestamp = new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date());

    setThreadReplies((currentReplies) => {
      const messageReplies = currentReplies[activeThreadMessage.id] ?? [];

      return {
        ...currentReplies,
        [activeThreadMessage.id]: [
          ...messageReplies,
          {
            authorId: currentUserId,
            body,
            id: `reply-${activeThreadMessage.id}-${Date.now()}`,
            messageId: activeThreadMessage.id,
            timestamp,
          },
        ],
      };
    });
    setMessages((currentMessages) =>
      currentMessages.map((message) =>
        message.id === activeThreadMessage.id
          ? {
              ...message,
              lastThreadReplyAt: timestamp,
              threadCount: (message.threadCount ?? 0) + 1,
            }
          : message,
      ),
    );
    setThreadComposerValue("");
  }

  return (
    <div className="grid h-screen min-h-0 overflow-hidden bg-[#f3f6fa] [grid-template-columns:21.5rem_minmax(40rem,1fr)]">
      <ConversationSidebar
        activeChannelId={activeChannel.id}
        activeMessageFilter={activeMessageFilter}
        channels={channels}
        messages={messages}
        onSelectMessageFilter={setActiveMessageFilter}
        onSelectChannel={handleSelectChannel}
      />
      <main className="relative grid min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] bg-[#f3f6fa]">
        <ConversationHeader
          channel={activeChannel}
          onStartCall={handleStartCall}
          presenceUsers={channelPresenceUsers}
        />
        <div className="min-h-0 overflow-auto bg-[#f3f6fa] py-4">
          {incomingCall?.channelId === activeChannel.id ? (
            <IncomingCallBanner
              onAccept={handleAcceptIncomingCall}
              onDecline={() => setIncomingCall(null)}
              session={incomingCall}
            />
          ) : null}
          <MessageList
            currentUserId={currentUserId}
            filter={activeMessageFilter}
            messages={filteredChannelMessages}
            onOpenThread={setActiveThreadMessageId}
            onToggleReaction={handleToggleReaction}
            reactionOptions={pulsexReactionOptions}
            users={pulsexPresenceUsers}
          />
        </div>
        <MessageComposer
          channelName={activeChannel.name}
          onChange={setComposerValue}
          onSubmit={handleSendMessage}
          value={composerValue}
        />
        {activeCall ? (
          <CallPanel
            onClose={() => setActiveCall(null)}
            onEnd={() => setActiveCall(null)}
            session={activeCall}
          />
        ) : null}
        {activeThreadMessage ? (
          <div className="absolute inset-y-0 right-0 z-10 w-[23rem] shadow-2xl">
            <ThreadPanel
              currentUserId={currentUserId}
              message={activeThreadMessage}
              onChangeReply={setThreadComposerValue}
              onClose={() => {
                setActiveThreadMessageId(null);
                setThreadComposerValue("");
              }}
              onSubmitReply={handleSubmitThreadReply}
              onToggleReaction={handleToggleReaction}
              reactionOptions={pulsexReactionOptions}
              replies={activeThreadReplies}
              replyValue={threadComposerValue}
              users={pulsexPresenceUsers}
            />
          </div>
        ) : null}
      </main>
    </div>
  );
}

function createLocalCallSession({
  channel,
  participants,
  type,
}: {
  channel: PulseXChannel;
  participants: readonly PulseXPresenceUser[];
  type: PulseXCallType;
}): PulseXCallSession {
  const fallbackCurrentUser = pulsexPresenceUsers.find(
    (user) => user.id === currentUserId,
  );
  const callUsers =
    participants.length > 0
      ? participants
      : fallbackCurrentUser
        ? [fallbackCurrentUser]
        : [];

  return {
    channelId: channel.id,
    durationLabel: "00:00",
    id: `local-call-${channel.id}-${Date.now()}`,
    initiatedByUserId: currentUserId,
    participants: callUsers.map((user) => ({
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
    startedAt: "agora",
    status: "active",
    title: channel.name,
    type,
  };
}
