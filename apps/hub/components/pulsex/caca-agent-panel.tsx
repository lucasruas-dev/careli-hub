"use client";

import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { HubTicketOpenForm } from "@/components/hub-support/hub-ticket-open-form";
import {
  Brain,
  BotMessageSquare,
  Bug,
  ClipboardList,
  Leaf,
  ListChecks,
  PenLine,
  Send,
  ShieldCheck,
  Smile,
  Sparkles,
  X,
} from "lucide-react";
import type {
  PulseXChannel,
  PulseXMessage,
  PulseXPresenceUser,
} from "@/lib/pulsex";
import { Tooltip } from "@repo/uix";
import { askHubAi, mapHubAiMessages } from "@/lib/hub-ai/client";
import {
  buildHubAiUserContext,
  getHubAiThinkingMessage,
  getHubAiUserInstruction,
} from "@/lib/hub-ai/user-context";
import { useAuth } from "@/providers/auth-provider";

const AI_AGENT_NAME = "Cacá";
const AI_AGENT_AVATAR = "/caca-profile.png";
const MAX_CONTEXT_MESSAGES = 45;
const DEFAULT_CACA_TONE_ID = "inteligente";

const cacaToneOptions = [
  {
    icon: Sparkles,
    id: "elegante",
    instruction:
      "Use um tom elegante, refinado e profissional, com frases bem acabadas e sem exagero.",
    label: "Elegante",
  },
  {
    icon: Smile,
    id: "otimista",
    instruction:
      "Use um tom otimista, positivo e construtivo, mantendo objetividade operacional.",
    label: "Otimista",
  },
  {
    icon: ShieldCheck,
    id: "confiante",
    instruction:
      "Use um tom confiante, firme e seguro, sem soar arrogante ou impositivo.",
    label: "Confiante",
  },
  {
    icon: Brain,
    id: "inteligente",
    instruction:
      "Use um tom inteligente, claro e bem estruturado, com raciocinio objetivo.",
    label: "Inteligente",
  },
  {
    icon: PenLine,
    id: "corrigir",
    instruction:
      "Corrija ortografia, gramatica, clareza e fluidez, preservando a intencao original.",
    label: "Corrigir",
  },
  {
    icon: Leaf,
    id: "calmo",
    instruction:
      "Use um tom calmo, sereno e conciliador, reduzindo tensao sem perder clareza.",
    label: "Calmo",
  },
] as const;

type CacaChatMessage = {
  actionable?: boolean;
  content: string;
  draftContent?: string;
  id: string;
  role: "ai" | "user";
};

type CacaToneId = (typeof cacaToneOptions)[number]["id"];
type CacaAgentTab = "agent" | "ticket";

type CacaAgentPanelProps = {
  channel: PulseXChannel;
  currentUserId: PulseXPresenceUser["id"];
  draftValue: string;
  focusedMessage?: PulseXMessage | null;
  messages: readonly PulseXMessage[];
  onClose: () => void;
  onUseAsDraft: (content: string) => void;
  users: readonly PulseXPresenceUser[];
};

export function CacaAgentPanel({
  channel,
  currentUserId,
  draftValue,
  focusedMessage,
  messages,
  onClose,
  onUseAsDraft,
  users,
}: CacaAgentPanelProps) {
  const { hubUser } = useAuth();
  const aiUserContext = useMemo(
    () => buildHubAiUserContext(hubUser),
    [hubUser],
  );
  const focusedMessageAuthorName = focusedMessage
    ? (focusedMessage.authorName ??
      getUserLabel(users, focusedMessage.authorId))
    : "";
  const hasFocusedMessage = Boolean(focusedMessage);
  const [inputValue, setInputValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [activeAgentTab, setActiveAgentTab] = useState<CacaAgentTab>("agent");
  const [selectedToneId, setSelectedToneId] =
    useState<CacaToneId>(DEFAULT_CACA_TONE_ID);
  const [chatMessages, setChatMessages] = useState<CacaChatMessage[]>(() => [
    createInitialMessage({
      channelName: channel.name,
      firstName: aiUserContext?.firstName,
      focusedMessageAuthorName,
      hasFocusedMessage,
    }),
  ]);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const panelQuickActions = useMemo(
    () => getQuickActions(hasFocusedMessage),
    [hasFocusedMessage],
  );
  const selectedTone = useMemo(
    () =>
      cacaToneOptions.find((tone) => tone.id === selectedToneId) ??
      cacaToneOptions.find((tone) => tone.id === DEFAULT_CACA_TONE_ID) ??
      cacaToneOptions[0],
    [selectedToneId],
  );

  useEffect(() => {
    setChatMessages([
      createInitialMessage({
        channelName: channel.name,
        firstName: aiUserContext?.firstName,
        focusedMessageAuthorName,
        hasFocusedMessage,
      }),
    ]);
    setInputValue("");
  }, [
    aiUserContext?.firstName,
    channel.id,
    channel.name,
    focusedMessage?.id,
    focusedMessageAuthorName,
    hasFocusedMessage,
  ]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [chatMessages]);

  async function sendAiQuestion(questionFromAction?: string) {
    const question = (questionFromAction ?? inputValue).trim();

    if (!question || isSending) {
      return;
    }

    const userMessage = {
      content: question,
      id: `${Date.now()}-user`,
      role: "user",
    } satisfies CacaChatMessage;
    const pendingMessageId = `${Date.now()}-ai`;
    const history = chatMessages;

    setChatMessages((currentMessages) => [
      ...currentMessages,
      userMessage,
      {
        content: getHubAiThinkingMessage(aiUserContext),
        id: pendingMessageId,
        role: "ai",
      },
    ]);
    setInputValue("");
    setIsSending(true);

    try {
      const response = await askHubAi({
        context: buildPulseXAgentContext({
          aiUserContext,
          channel,
          currentUserId,
          draftValue,
          focusedMessage,
          messages,
          selectedTone,
          users,
        }),
        feature: "PulseX / comunicacao interna / canal operacional",
        messages: mapHubAiMessages(history),
        module: "pulsex",
        prompt: question,
      });

      setChatMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.id === pendingMessageId
            ? {
                ...message,
                actionable: true,
                content: response.text,
                draftContent: extractDraftContent(response.text),
              }
            : message,
        ),
      );
    } catch (error) {
      setChatMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.id === pendingMessageId
            ? {
                ...message,
                content:
                  error instanceof Error
                    ? error.message
                    : "Nao foi possivel consultar a Cacá agora.",
              }
            : message,
        ),
      );
    } finally {
      setIsSending(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendAiQuestion();
  }

  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-[#d9e0ea] bg-white text-[#101820]">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-[#e6ebf2] px-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-[#101820] text-white">
            <Image
              alt={AI_AGENT_NAME}
              className="h-full w-full object-cover"
              height={40}
              src={AI_AGENT_AVATAR}
              width={40}
            />
            <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">
              {AI_AGENT_NAME}
            </span>
            <span className="block truncate text-xs text-[#667085]">
              Agente PulseX
            </span>
          </span>
        </div>
        <button
          aria-label="Fechar Cacá"
          className="grid h-8 w-8 place-items-center rounded-md text-[#667085] outline-none transition hover:bg-[#eef2f7] hover:text-[#101820] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" size={16} />
        </button>
      </header>

      <nav className="grid shrink-0 grid-cols-2 gap-1 border-b border-[#eef2f7] bg-white p-2">
        <AgentTabButton
          active={activeAgentTab === "agent"}
          icon={<Sparkles size={14} />}
          label="Agente"
          onClick={() => setActiveAgentTab("agent")}
        />
        <AgentTabButton
          active={activeAgentTab === "ticket"}
          icon={<Bug size={14} />}
          label="Ticket TI"
          onClick={() => setActiveAgentTab("ticket")}
        />
      </nav>

      {activeAgentTab === "ticket" ? (
        <div className="min-h-0 flex-1 overflow-y-auto bg-[#f3f6fa] p-4">
          <HubTicketOpenForm defaultModule="PulseX" />
        </div>
      ) : (
        <>
          <div className="shrink-0 border-b border-[#eef2f7] px-4 py-3">
            {focusedMessage ? (
              <FocusedMessageCard
                focusedMessage={focusedMessage}
                users={users}
              />
            ) : null}
            <ToneSelector
              disabled={isSending}
              onSelectTone={setSelectedToneId}
              selectedToneId={selectedToneId}
            />
            <div className="grid grid-cols-2 gap-2">
              {panelQuickActions.map((action) => (
                <button
                  className="grid min-h-16 grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-2 rounded-md border border-[#d9e0ea] bg-[#f8fafc] px-2.5 py-2 text-left text-xs font-semibold text-[#344054] outline-none transition hover:border-[#A07C3B]/50 hover:bg-[#f7f3eb] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                  disabled={isSending}
                  key={action.label}
                  onClick={() => void sendAiQuestion(action.prompt)}
                  type="button"
                >
                  <span className="grid h-7 w-7 place-items-center rounded-md bg-white text-[#A07C3B]">
                    <action.icon aria-hidden="true" size={15} />
                  </span>
                  <span className="min-w-0 leading-4">{action.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto bg-[#f3f6fa] px-3 py-4">
            <div className="grid gap-3">
              {chatMessages.map((message) => (
                <CacaBubble
                  key={message.id}
                  message={message}
                  onUseAsDraft={onUseAsDraft}
                  useAsDraftLabel={
                    focusedMessage ? "Usar como resposta" : "Usar no campo"
                  }
                />
              ))}
              <div ref={chatEndRef} />
            </div>
          </div>

          <form
            className="grid shrink-0 grid-cols-[minmax(0,1fr)_2.5rem] gap-2 border-t border-[#d9e0ea] bg-white p-3"
            onSubmit={handleSubmit}
          >
            <textarea
              aria-label="Perguntar para Cacá"
              className="max-h-24 min-h-10 resize-none rounded-md border border-[#d9e0ea] bg-[#f8fafc] px-3 py-2 text-sm leading-5 outline-none transition placeholder:text-[#8b98aa] focus:border-[#A07C3B] focus:bg-white"
              disabled={isSending}
              onChange={(event) => setInputValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendAiQuestion();
                }
              }}
              placeholder="Pergunte para a Cacá"
              rows={1}
              value={inputValue}
            />
            <button
              aria-label="Enviar para Cacá"
              className="grid h-10 w-10 place-items-center rounded-md bg-[#A07C3B] text-white outline-none transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[#A07C3B] disabled:cursor-not-allowed disabled:bg-[#d9e0ea] disabled:text-[#8b98aa]"
              disabled={isSending || !inputValue.trim()}
              type="submit"
            >
              <Send aria-hidden="true" size={17} />
            </button>
          </form>
        </>
      )}
    </aside>
  );
}

function CacaBubble({
  message,
  onUseAsDraft,
  useAsDraftLabel,
}: {
  message: CacaChatMessage;
  onUseAsDraft: (content: string) => void;
  useAsDraftLabel: string;
}) {
  const isUser = message.role === "user";

  return (
    <article
      className={`flex gap-2 ${isUser ? "justify-end" : "justify-start"}`}
    >
      {!isUser ? (
        <span className="mt-1 grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-full bg-[#101820]">
          <Image
            alt={AI_AGENT_NAME}
            className="h-full w-full object-cover"
            height={28}
            src={AI_AGENT_AVATAR}
            width={28}
          />
        </span>
      ) : null}
      <div
        className={`max-w-[86%] rounded-2xl border px-3 py-2 text-sm leading-6 shadow-sm ${
          isUser
            ? "rounded-br-md border-[#A07C3B]/35 bg-[#f7f3eb] text-[#101820]"
            : "rounded-bl-md border-[#d9e0ea] bg-white text-[#17202f]"
        }`}
      >
        <div className="m-0">{renderCacaMessageContent(message.content)}</div>
        {message.actionable && !isUser ? (
          <Tooltip content={useAsDraftLabel} placement="top">
            <button
              aria-label={useAsDraftLabel}
              className="mt-2 grid h-8 w-8 place-items-center rounded-md border border-[#cfd8e3] bg-[#f8fafc] text-[#344054] outline-none transition hover:border-[#A07C3B] hover:text-[#7b5f2d] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
              onClick={() =>
                onUseAsDraft(
                  message.draftContent ?? extractDraftContent(message.content),
                )
              }
              type="button"
            >
              <PenLine aria-hidden="true" size={13} />
            </button>
          </Tooltip>
        ) : null}
      </div>
    </article>
  );
}

function AgentTabButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={`inline-flex h-9 items-center justify-center gap-2 rounded-md text-xs font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-[#A07C3B] ${
        active
          ? "bg-[#101820] text-white"
          : "bg-[#f8fafc] text-[#667085] hover:bg-[#eef2f7] hover:text-[#101820]"
      }`}
      onClick={onClick}
      type="button"
    >
      {icon}
      {label}
    </button>
  );
}

function FocusedMessageCard({
  focusedMessage,
  users,
}: {
  focusedMessage: PulseXMessage;
  users: readonly PulseXPresenceUser[];
}) {
  const authorName =
    focusedMessage.authorName ?? getUserLabel(users, focusedMessage.authorId);

  return (
    <div className="mb-3 rounded-md border border-[#cfd8e3] bg-[#f8fafc] p-3 text-left">
      <p className="m-0 text-[0.68rem] font-semibold uppercase text-[#667085]">
        Mensagem em foco
      </p>
      <p className="m-0 mt-1 text-xs font-semibold text-[#101820]">
        {authorName}
        <span className="ml-2 font-medium text-[#667085]">
          {focusedMessage.timestamp}
        </span>
      </p>
      <p className="m-0 mt-1 line-clamp-3 text-xs leading-5 text-[#344054]">
        {focusedMessage.body}
      </p>
    </div>
  );
}

function ToneSelector({
  disabled,
  onSelectTone,
  selectedToneId,
}: {
  disabled: boolean;
  onSelectTone: (toneId: CacaToneId) => void;
  selectedToneId: CacaToneId;
}) {
  return (
    <div className="mb-3">
      <p className="m-0 mb-2 text-[0.68rem] font-semibold uppercase text-[#667085]">
        Tom da resposta
      </p>
      <div
        aria-label="Tom da resposta da Caca"
        className="grid grid-cols-3 gap-1.5"
        role="group"
      >
        {cacaToneOptions.map((tone) => {
          const isSelected = tone.id === selectedToneId;

          return (
            <button
              aria-pressed={isSelected}
              className={`inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md border px-2 text-[0.68rem] font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-[#A07C3B] disabled:cursor-not-allowed disabled:opacity-60 ${
                isSelected
                  ? "border-[#A07C3B] bg-[#f7f3eb] text-[#7b5f2d] shadow-sm"
                  : "border-[#d9e0ea] bg-white text-[#344054] hover:border-[#A07C3B]/50 hover:bg-[#f8fafc]"
              }`}
              disabled={disabled}
              key={tone.id}
              onClick={() => onSelectTone(tone.id)}
              type="button"
            >
              <tone.icon aria-hidden="true" size={13} />
              <span className="truncate">{tone.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function createInitialMessage({
  channelName,
  firstName,
  focusedMessageAuthorName,
  hasFocusedMessage,
}: {
  channelName: string;
  firstName?: string;
  focusedMessageAuthorName?: string;
  hasFocusedMessage?: boolean;
}) {
  const greeting = firstName ? `${firstName},` : "Lucas,";
  const focusText = hasFocusedMessage
    ? ` Estou com a mensagem de ${focusedMessageAuthorName || "um participante"} em foco para formular uma resposta.`
    : "";

  return {
    content: `${greeting} estou conectada ao canal ${channelName}.${focusText} Posso resumir a conversa, separar decisoes ou preparar uma resposta para voce enviar.`,
    id: `initial-${channelName}-${Date.now()}`,
    role: "ai",
  } satisfies CacaChatMessage;
}

function extractDraftContent(content: string) {
  const normalizedContent = content.trim();
  const quotedContent = getQuotedDraftContent(normalizedContent);

  if (quotedContent) {
    return normalizeDraftBulletMarkers(quotedContent);
  }

  return normalizeDraftBulletMarkers(
    normalizedContent
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => {
        const normalizedLine = normalizeDraftLine(line);

        if (!normalizedLine) {
          return true;
        }

        return !draftHeaderPatterns.some((pattern) =>
          pattern.test(normalizedLine),
        );
      })
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

function normalizeDraftBulletMarkers(content: string) {
  return content.replace(/^(\s*)[-*]\s*/gm, "$1• ");
}

function renderCacaMessageContent(content: string) {
  return content.split(/\r?\n/).map((line, index) => {
    const bulletParts = getBulletLineParts(line);

    if (!line.trim()) {
      return <div className="h-2" key={`caca-line-${index}`} />;
    }

    if (bulletParts) {
      return (
        <div
          className="grid grid-cols-[0.85rem_minmax(0,1fr)] gap-1.5 py-0.5"
          key={`caca-line-${index}`}
        >
          <span className="pt-px text-center text-base font-black leading-5 text-[#101820]">
            •
          </span>
          <span className="min-w-0 whitespace-pre-wrap">
            {bulletParts.content}
          </span>
        </div>
      );
    }

    return (
      <div className="whitespace-pre-wrap" key={`caca-line-${index}`}>
        {line}
      </div>
    );
  });
}

function getBulletLineParts(line: string) {
  const match = line.match(/^(\s*)(?:[-*•])\s*(.+)$/);

  if (!match?.[2]) {
    return null;
  }

  return {
    content: match[2],
  };
}

function getQuotedDraftContent(content: string) {
  const quoteMatch = content.match(/[“"]([\s\S]+?)[”"]/);

  return quoteMatch?.[1]?.trim() ?? "";
}

function normalizeDraftLine(line: string) {
  return line
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

const draftHeaderPatterns = [
  /^lucas,?\s*(mensagem|segue|texto|resposta|rascunho)/,
  /^mensagem\s+(pronta|sugerida|para enviar)/,
  /^segue\s+(a\s+)?(mensagem|resposta|texto|rascunho)/,
  /^sugestao\s+para\s+validacao/,
  /^validacao\s+humana/,
  /^texto\s+para\s+(enviar|o canal|uso)/,
  /^resposta\s+para\s+(enviar|o canal|uso)/,
  /^canal:/,
] as const;

function buildPulseXAgentContext({
  aiUserContext,
  channel,
  currentUserId,
  draftValue,
  focusedMessage,
  messages,
  selectedTone,
  users,
}: {
  aiUserContext: ReturnType<typeof buildHubAiUserContext>;
  channel: PulseXChannel;
  currentUserId: PulseXPresenceUser["id"];
  draftValue: string;
  focusedMessage?: PulseXMessage | null;
  messages: readonly PulseXMessage[];
  selectedTone: (typeof cacaToneOptions)[number];
  users: readonly PulseXPresenceUser[];
}) {
  const messageAuthorIds = new Set(messages.map((message) => message.authorId));
  const channelUsers = users
    .filter(
      (user) =>
        user.id === currentUserId ||
        user.channelIds.includes(channel.id) ||
        messageAuthorIds.has(user.id),
    )
    .slice(0, 35);

  return {
    canalAtual: {
      descricao: channel.description,
      id: channel.id,
      nome: channel.name,
      status: channel.status ?? "offline",
      tipo: channel.kind,
      unidade: channel.context.unit,
    },
    conversaRecente: messages.slice(-MAX_CONTEXT_MESSAGES).map((message) => ({
      anexos: message.attachment
        ? {
            label: message.attachment.label,
            tipo: message.attachment.type,
          }
        : null,
      autor: message.authorName ?? getUserLabel(users, message.authorId),
      body: message.body.slice(0, 1_200),
      data: message.createdAt,
      tags: message.tags ?? [],
      horario: message.timestamp,
      mencionaUsuarioAtual: Boolean(
        message.mentionUserIds?.includes(currentUserId),
      ),
    })),
    instrucaoUsuarioLogado: getHubAiUserInstruction(aiUserContext),
    tomSelecionado: {
      id: selectedTone.id,
      instrucao: selectedTone.instruction,
      nome: selectedTone.label,
    },
    mensagemEmFoco: focusedMessage
      ? {
          anexos: focusedMessage.attachment
            ? {
                label: focusedMessage.attachment.label,
                tipo: focusedMessage.attachment.type,
              }
            : null,
          autor:
            focusedMessage.authorName ??
            getUserLabel(users, focusedMessage.authorId),
          body: focusedMessage.body.slice(0, 1_200),
          data: focusedMessage.createdAt,
          horario: focusedMessage.timestamp,
          id: focusedMessage.id,
          tags: focusedMessage.tags ?? [],
        }
      : null,
    modulo: "PulseX",
    participantes: channelUsers.map((user) => ({
      id: user.id,
      nome: user.label,
      papel: user.role,
      status: user.status,
    })),
    rascunhoAtual: draftValue.trim() || null,
    regrasDoAgente: [
      "Atue como Caca do PulseX, focada em comunicacao interna operacional.",
      "Resuma, organize decisoes, destaque riscos, sugira proximos passos e prepare mensagens curtas.",
      "Nao afirme que enviou mensagem, criou tarefa ou acionou alguem. A execucao depende do operador.",
      "Nao invente contexto alem das mensagens, participantes e rascunho recebidos.",
      "Se houver mensagemEmFoco, use essa mensagem como referencia principal para formular resposta.",
      "Aplique tomSelecionado em respostas preparadas para envio, sem adicionar cabecalho explicativo.",
      "Se a pergunta do operador for um texto ou rascunho sem comando claro, trate como pedido para melhorar aquele texto aplicando tomSelecionado.",
      "Quando listar pontos, use marcadores de bolinha `•` em vez de hifen.",
    ],
    usuarioLogado: aiUserContext,
  };
}

function getUserLabel(
  users: readonly PulseXPresenceUser[],
  userId: PulseXPresenceUser["id"],
) {
  return users.find((user) => user.id === userId)?.label ?? "Sistema";
}

function getQuickActions(hasFocusedMessage: boolean) {
  return [
    {
      icon: hasFocusedMessage ? BotMessageSquare : Sparkles,
      label: hasFocusedMessage ? "Responder mensagem" : "Resumo do canal",
      prompt: hasFocusedMessage
        ? "leia a mensagem em foco, entenda o contexto recente do canal e formule uma resposta objetiva para eu enviar."
        : "resuma a conversa recente deste canal em pontos operacionais.",
    },
    {
      icon: ClipboardList,
      label: "Decisoes e riscos",
      prompt: "liste decisoes tomadas, riscos e pendencias desta conversa.",
    },
    {
      icon: ListChecks,
      label: "Proximos passos",
      prompt:
        "transforme a conversa recente em proximos passos com responsavel sugerido e prioridade.",
    },
    {
      icon: BotMessageSquare,
      label: "Preparar resposta",
      prompt: hasFocusedMessage
        ? "prepare uma resposta para a mensagem em foco, mantendo o tom interno da Careli."
        : "prepare uma resposta objetiva para enviar neste canal considerando o contexto recente.",
    },
  ] as const;
}
