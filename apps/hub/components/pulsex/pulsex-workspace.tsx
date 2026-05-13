"use client";

import { pulsexReactionOptions } from "@/lib/pulsex";
import {
  createPulseXMessage,
  listChannelMessages,
  loadPulseXOperationalData,
} from "@/lib/pulsex/supabase-data";
import { hasHubSupabaseConfig } from "@/lib/supabase/client";
import { useAuth } from "@/providers/auth-provider";
import type {
  PulseXCallSession,
  PulseXCallType,
  PulseXChannel,
  PulseXDepartment,
  PulseXMessageMention,
  PulseXMessageFilter,
  PulseXMessage,
  PulseXPresenceUser,
  PulseXReactionEmoji,
  PulseXSector,
  PulseXThreadReply,
} from "@/lib/pulsex";
import { CallPanel } from "./call-panel";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ConversationHeader } from "./conversation-header";
import { ConversationSidebar } from "./conversation-sidebar";
import { IncomingCallBanner } from "./incoming-call-banner";
import { MessageComposer } from "./message-composer";
import { MessageList } from "./message-list";
import { ThreadPanel } from "./thread-panel";

export function PulseXWorkspace() {
  const { hubUser, profileStatus } = useAuth();
  const currentUserId = hubUser?.id ?? "ana";
  const [activeChannelId, setActiveChannelId] =
    useState<PulseXChannel["id"]>(emptyPulseXChannel.id);
  const [channels, setChannels] = useState<PulseXChannel[]>([]);
  const [departments, setDepartments] = useState<PulseXDepartment[]>([]);
  const [sectors, setSectors] = useState<PulseXSector[]>([]);
  const [messages, setMessages] = useState<PulseXMessage[]>([]);
  const [presenceUsers, setPresenceUsers] = useState<PulseXPresenceUser[]>([]);
  const [threadReplies, setThreadReplies] = useState<
    Record<string, PulseXThreadReply[]>
  >({});
  const [activeThreadMessageId, setActiveThreadMessageId] = useState<
    PulseXMessage["id"] | null
  >(null);
  const [activeMessageFilter, setActiveMessageFilter] =
    useState<PulseXMessageFilter>("all");
  const [activeCall, setActiveCall] = useState<PulseXCallSession | null>(null);
  const [incomingCall, setIncomingCall] = useState<PulseXCallSession | null>(null);
  const [composerValue, setComposerValue] = useState("");
  const [composerMentions, setComposerMentions] = useState<
    readonly PulseXMessageMention[]
  >([]);
  const [threadComposerValue, setThreadComposerValue] = useState("");
  const [dataStatus, setDataStatus] = useState<"fallback" | "loading" | "ready">(
    "loading",
  );
  const activeChannel =
    channels.find((channel) => channel.id === activeChannelId) ??
    channels[0] ??
    emptyPulseXChannel;
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
      presenceUsers.filter((user) =>
        (user.channelIds as readonly string[]).includes(activeChannel.id),
      ),
    [activeChannel.id, presenceUsers],
  );

  const loadOperationalData = useCallback(() => {
    if (profileStatus === "loading") {
      setDataStatus("loading");
      return;
    }

    let isMounted = true;

    setDataStatus("loading");
    loadPulseXOperationalData({
      currentUserId,
      userRole: hubUser?.role,
    })
      .then((payload) => {
        if (!isMounted) {
          return;
        }

        const nextChannels = withDirectUserChannels(
          payload.channels,
          payload.users,
          currentUserId,
        );
        const nextPresenceUsers = withUserChannelAccess(
          payload.users,
          nextChannels,
          currentUserId,
        );

        setChannels(nextChannels);
        setDepartments(payload.departments);
        setMessages(payload.messages);
        setPresenceUsers(nextPresenceUsers);
        setSectors(payload.sectors);
        setActiveChannelId((currentId) =>
          nextChannels.some((channel) => channel.id === currentId)
            ? currentId
            : nextChannels[0]?.id ?? emptyPulseXChannel.id,
        );
        setDataStatus(hasHubSupabaseConfig() ? "ready" : "fallback");
      })
      .catch((error: unknown) => {
        if (isLocalDevelopmentRuntime()) {
          console.warn("[pulsex] load workspace error", error);
        }

        if (!isMounted) {
          return;
        }

        setDataStatus("fallback");
      });

    return () => {
      isMounted = false;
    };
  }, [currentUserId, hubUser?.role, profileStatus]);

  useEffect(() => loadOperationalData(), [loadOperationalData]);

  useEffect(() => {
    if (dataStatus !== "ready" || activeChannel.kind === "direct") {
      return;
    }

    let isMounted = true;

    listChannelMessages(activeChannel.id)
      .then((nextMessages) => {
        if (isMounted) {
          setMessages(nextMessages);
        }
      })
      .catch(() => {
        if (isMounted) {
          setDataStatus("fallback");
        }
      });

    return () => {
      isMounted = false;
    };
  }, [activeChannel.id, activeChannel.kind, dataStatus]);

  function handleSelectChannel(channelId: PulseXChannel["id"]) {
    setActiveChannelId(channelId);
    setActiveThreadMessageId(null);
    setThreadComposerValue("");
    if (dataStatus === "ready") {
      setMessages([]);
    }
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
        currentUserId,
        fallbackUsers: presenceUsers,
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

  async function handleSendMessage() {
    const body = composerValue.trim();
    const mentions = composerMentions.filter((mention) =>
      body.includes(mention.displayName),
    );

    if (!body) {
      return;
    }

    const timestamp = new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date());

    const localMessage = {
        authorId: currentUserId,
        body,
        channelId: activeChannel.id,
        id: `local-${activeChannel.id}-${Date.now()}`,
        mentionUserIds: mentions.map((mention) => mention.userId),
        mentions,
        reactions: [],
        status: "neutral",
        tags: [],
        threadCount: 0,
        timestamp,
      } satisfies PulseXMessage;

    setMessages((currentMessages) => [...currentMessages, localMessage]);
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
    setComposerMentions([]);

    if (!hasHubSupabaseConfig() || activeChannel.kind === "direct") {
      return;
    }

    try {
      const savedMessage = await createPulseXMessage({
        authorUserId: hubUser?.id,
        body,
        channelId: activeChannel.id,
      });

      setMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.id === localMessage.id ? savedMessage : message,
        ),
      );
    } catch {
      setDataStatus("fallback");
    }
  }

  function handleComposerChange(
    value: string,
    mentions: readonly PulseXMessageMention[],
  ) {
    setComposerValue(value);
    setComposerMentions(mentions);
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
        dataStatus={dataStatus}
        departments={departments}
        users={presenceUsers}
        messages={messages}
        onSelectMessageFilter={setActiveMessageFilter}
        onSelectChannel={handleSelectChannel}
        onRefresh={() => {
          loadOperationalData();
        }}
        sectors={sectors}
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
            users={presenceUsers}
          />
        </div>
        <MessageComposer
          channelName={activeChannel.name}
          mentions={composerMentions}
          onChange={handleComposerChange}
          onSubmit={handleSendMessage}
          users={presenceUsers}
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
              users={presenceUsers}
            />
          </div>
        ) : null}
      </main>
    </div>
  );
}

function withDirectUserChannels(
  channels: readonly PulseXChannel[],
  users: readonly PulseXPresenceUser[],
  currentUserId: PulseXPresenceUser["id"],
): PulseXChannel[] {
  const existingChannelIds = new Set(channels.map((channel) => channel.id));
  const directChannels = users
    .filter((user) => user.id !== currentUserId)
    .map((user) => ({
      avatar: user.initials,
      context: {
        filesCount: 0,
        owner: user.label,
        status: "Direta",
        unit: user.role,
      },
      description: `Conversa direta com ${user.label}.`,
      id: `direct-${user.id}`,
      kind: "direct",
      lastMessageAt: "-",
      name: user.label,
      preview: user.email ?? "Usuario do Hub",
      status: user.status,
    })) satisfies PulseXChannel[];

  return [
    ...channels,
    ...directChannels.filter((channel) => !existingChannelIds.has(channel.id)),
  ];
}

function isLocalDevelopmentRuntime() {
  return ["localhost", "127.0.0.1"].includes(window.location.hostname);
}

function withUserChannelAccess(
  users: readonly PulseXPresenceUser[],
  channels: readonly PulseXChannel[],
  currentUserId: PulseXPresenceUser["id"],
): PulseXPresenceUser[] {
  return users.map((user) => ({
    ...user,
    channelIds: channels
      .filter((channel) => {
        if (channel.kind === "direct") {
          return user.id === currentUserId || channel.id === `direct-${user.id}`;
        }

        return (
          channel.memberUserIds?.includes(user.id) ||
          Boolean(
            channel.accessType === "sector_channel" &&
              channel.sectorId &&
              channel.sectorId === user.sectorId,
          ) ||
          Boolean(
            channel.accessType === "department_channel" &&
              channel.departmentId &&
              channel.departmentId === user.departmentId,
          )
        );
      })
      .map((channel) => channel.id),
  }));
}

const emptyPulseXChannel = {
  avatar: "--",
  context: {
    filesCount: 0,
    owner: "PulseX",
    status: "Aguardando setup",
    unit: "Hub",
  },
  description: "Nenhum canal operacional configurado.",
  id: "empty-pulsex",
  accessType: "private_group",
  kind: "system",
  lastMessageAt: "-",
  name: "Sem canal",
  preview: "Configure canais no Setup Central.",
  status: "offline",
} satisfies PulseXChannel;

function createLocalCallSession({
  channel,
  currentUserId,
  fallbackUsers,
  participants,
  type,
}: {
  channel: PulseXChannel;
  currentUserId: PulseXPresenceUser["id"];
  fallbackUsers: readonly PulseXPresenceUser[];
  participants: readonly PulseXPresenceUser[];
  type: PulseXCallType;
}): PulseXCallSession {
  const fallbackCurrentUser = fallbackUsers.find(
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
