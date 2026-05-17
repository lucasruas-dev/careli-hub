/* eslint-disable */
// @ts-nocheck
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BotMessageSquare, Send, X } from "lucide-react";
import { askHubAi, mapHubAiMessages } from "@/lib/hub-ai/client";
import {
  buildHubAiUserContext,
  getHubAiThinkingMessage,
  getHubAiUserInstruction,
} from "@/lib/hub-ai/user-context";
import { getHubSupabaseClient } from "@/lib/supabase/client";
import { useAuth } from "@/providers/auth-provider";
import type { PortfolioUnit, QueueClient } from "@/modules/guardian/attendance/types";

const MAX_AI_INSTALLMENTS = 220;
const AI_AGENT_NAME = "Cacá";
const AI_AGENT_AVATAR = "/caca-profile.png";

type ChatMessage = {
  actions?: ChatMessageAction[];
  id: string;
  role: "ai" | "user";
  content: string;
};

type ChatMessageAction = {
  candidateId?: string;
  label: string;
  type: "cancel-boleto-resend" | "confirm-boleto-resend";
};

type BoletoCandidate = {
  atrasoDias: number;
  boletoUrl: string;
  id: string;
  number: string;
  reference: string;
  status: string;
  unitCode: string;
  unitLabel: string;
  value: string;
  vencimento: string;
};

type PendingBoletoAction = {
  candidate: BoletoCandidate;
  deliveryMode: "link";
};

type AiCopilotDrawerProps = {
  client: QueueClient;
  filteredQueueClients?: QueueClient[];
  queueClients?: QueueClient[];
  queueTotalCount?: number;
};

export function AiCopilotDrawer({
  client,
  filteredQueueClients,
  queueClients,
  queueTotalCount,
}: AiCopilotDrawerProps) {
  const { hubUser } = useAuth();
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [pendingBoletoAction, setPendingBoletoAction] =
    useState<PendingBoletoAction | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const aiUserContext = useMemo(
    () => buildHubAiUserContext(hubUser),
    [hubUser],
  );
  const intelligence = useMemo(() => buildClientIntelligence(client), [client]);
  const visibleSummaryCards = useMemo(
    () =>
      intelligence.summaryCards.filter(([label]) =>
        ["Risco", "Parcelas vencidas", "Saldo em atraso", "Próxima ação"].includes(label),
      ),
    [intelligence.summaryCards],
  );
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: `initial-${client.id}`,
      role: "ai",
      content: addressAiResponse(intelligence.initialMessage, aiUserContext),
    },
  ]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setMessages([
        {
          id: `initial-${client.id}`,
          role: "ai",
          content: addressAiResponse(intelligence.initialMessage, aiUserContext),
        },
      ]);
      setInputValue("");
      setPendingBoletoAction(null);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [aiUserContext?.firstName, client.id, intelligence.initialMessage]);

  useEffect(() => {
    if (!open) {
      return;
    }

    chatEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [messages, open]);

  async function sendAiQuestion(questionFromAction?: string) {
    const question = (questionFromAction ?? inputValue).trim();

    if (!question || isSending) {
      return;
    }

    if (pendingBoletoAction && isBoletoConfirmation(question)) {
      await confirmBoletoResend(question, pendingBoletoAction);
      return;
    }

    if (pendingBoletoAction && isBoletoCancellation(question)) {
      setPendingBoletoAction(null);
      appendLocalAiExchange(
        question,
        "Combinado, Lucas. Nao reenviei o boleto. Quando quiser, me peça para reenviar o link de novo.",
      );
      setInputValue("");
      return;
    }

    if (looksLikeBoletoResendRequest(question)) {
      startBoletoResendFlow(question);
      return;
    }

    if (looksLikeOpenBoletoQuestion(question)) {
      showOpenBoletoBubbles(question);
      return;
    }

    const userMessage: ChatMessage = {
      id: `${Date.now()}-user`,
      role: "user",
      content: question,
    };
    const pendingMessageId = `${Date.now()}-ai`;
    const history = messages;

    setMessages((current) => [
      ...current,
      userMessage,
      {
        id: pendingMessageId,
        role: "ai",
        content: getHubAiThinkingMessage(aiUserContext),
      },
    ]);
    setInputValue("");
    setIsSending(true);

    try {
      const response = await askHubAi({
        context: {
          ...buildGuardianClientAiContext(client),
          escopoDaResposta:
            "O cliente aberto e o foco principal da tela. Se o operador perguntar sobre carteira, fila, total de clientes, risco geral, empreendimentos ou visao geral, use filaOperacional/contextoGeral antes de dizer que falta informacao.",
          filaOperacional: buildGuardianQueueAiContext({
            clients: queueClients ?? [client],
            filteredClients: filteredQueueClients,
            selectedClient: client,
            totalCount: queueTotalCount,
          }),
          instrucaoUsuarioLogado: getHubAiUserInstruction(aiUserContext),
          usuarioLogado: aiUserContext,
        },
        feature: "Guardian / cobranca / detalhe do cliente e fila operacional",
        messages: mapHubAiMessages(history),
        module: "guardian",
        prompt: question,
      });

      setMessages((current) =>
        current.map((message) =>
          message.id === pendingMessageId
            ? { ...message, content: addressAiResponse(response.text, aiUserContext) }
            : message,
        ),
      );
    } catch (error) {
      setMessages((current) =>
        current.map((message) =>
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

  function appendLocalAiExchange(
    question: string,
    answer: string,
    actions?: ChatMessageAction[],
  ) {
    setMessages((current) => [
      ...current,
      {
        id: `${Date.now()}-user`,
        role: "user",
        content: question,
      },
      {
        id: `${Date.now()}-ai`,
        role: "ai",
        content: addressAiResponse(answer, aiUserContext),
        actions,
      },
    ]);
  }

  function showOpenBoletoBubbles(question: string) {
    const candidates = getOpenBoletoCandidates(client);
    const timestamp = Date.now();

    setInputValue("");

    if (!candidates.length) {
      appendLocalAiExchange(
        question,
        `Lucas, nao encontrei boletos abertos com link disponivel para ${client.nome}.`,
      );
      return;
    }

    const resendCandidate = candidates[0];
    setPendingBoletoAction({
      candidate: resendCandidate,
      deliveryMode: "link",
    });

    setMessages((current) => [
      ...current,
      {
        id: `${timestamp}-user`,
        role: "user",
        content: question,
      },
      {
        id: `${timestamp}-intro`,
        role: "ai",
        content: `Lucas, encontrei ${candidates.length} boleto${candidates.length > 1 ? "s" : ""} em aberto com link disponivel.`,
      },
      ...candidates.map((candidate, index) => ({
        id: `${timestamp}-boleto-${candidate.id}-${index}`,
        role: "ai" as const,
        content: buildBoletoBubbleMessage(candidate),
      })),
      {
        id: `${timestamp}-resend-question`,
        role: "ai",
        content: [
          candidates.length > 1
            ? `Lucas, posso reenviar a fatura mais urgente para o cliente? Vou considerar a ref. ${resendCandidate.reference}, parcela ${resendCandidate.number}.`
            : "Lucas, posso reenviar essa fatura para o cliente?",
        ].join("\n"),
        actions: [
          {
            label: "Sim",
            type: "confirm-boleto-resend",
          },
          {
            label: "Não",
            type: "cancel-boleto-resend",
          },
        ],
      },
    ]);
  }

  function startBoletoResendFlow(question: string) {
    const candidates = getOpenBoletoCandidates(client);

    setInputValue("");

    if (!candidates.length) {
      appendLocalAiExchange(
        question,
        `Lucas, nao encontrei boleto aberto com link disponivel para ${client.nome}. Posso analisar as parcelas e apontar quais estao sem link.`,
      );
      return;
    }

    const candidate = candidates[0];
    setPendingBoletoAction({
      candidate,
      deliveryMode: "link",
    });
    appendLocalAiExchange(
      question,
      [
        `Lucas, encontrei ${candidates.length} boleto${candidates.length > 1 ? "s" : ""} aberto${candidates.length > 1 ? "s" : ""} com link.`,
        `Vou considerar o mais urgente: ref. ${candidate.reference}, parcela ${candidate.number}, ${candidate.status.toLowerCase()}, vencimento ${candidate.vencimento}, valor ${candidate.value}.`,
        "Posso reenviar a fatura para o cliente?",
      ].join("\n"),
      [
        {
          label: "Sim",
          type: "confirm-boleto-resend",
        },
        {
          label: "Não",
          type: "cancel-boleto-resend",
        },
      ],
    );
  }

  async function confirmBoletoResend(question: string, action: PendingBoletoAction) {
    const pendingMessageId = `${Date.now()}-ai`;

    setMessages((current) => [
      ...current,
      {
        id: `${Date.now()}-user`,
        role: "user",
        content: question,
      },
      {
        id: pendingMessageId,
        role: "ai",
        content: getHubAiThinkingMessage(aiUserContext),
      },
    ]);
    setInputValue("");
    setIsSending(true);

    try {
      const result = await requestBoletoResend(action.candidate.id);
      const boletoUrl = result.action?.boletoUrl ?? action.candidate.boletoUrl;
      const deliveryMessage = buildBoletoDeliveryMessage(client);

      setPendingBoletoAction(null);
      setMessages((current) =>
        current.map((message) =>
          message.id === pendingMessageId
            ? {
                ...message,
                content: [
                  deliveryMessage,
                  `Contrato: ${action.candidate.unitCode} · ${action.candidate.unitLabel}`,
                  `Parcela: ${action.candidate.number} | Ref. ${action.candidate.reference}`,
                  `Valor: ${action.candidate.value} | Vencimento: ${action.candidate.vencimento}`,
                  `Boleto: ${boletoUrl}`,
                ]
                  .filter(Boolean)
                  .join("\n"),
              }
            : message,
        ),
      );
    } catch (error) {
      setMessages((current) =>
        current.map((message) =>
          message.id === pendingMessageId
            ? {
                ...message,
                content:
                  error instanceof Error
                    ? error.message
                    : "Nao consegui preparar o reenvio do boleto agora.",
              }
            : message,
        ),
      );
    } finally {
      setIsSending(false);
    }
  }

  function handleMessageAction(action: ChatMessageAction) {
    if (isSending) {
      return;
    }

    if (action.type === "cancel-boleto-resend") {
      setPendingBoletoAction(null);
      appendLocalAiExchange(
        action.label,
        "Combinado, Lucas. Nao reenviei o boleto.",
      );
      return;
    }

    const candidate = action.candidateId
      ? getOpenBoletoCandidates(client).find((item) => item.id === action.candidateId)
      : pendingBoletoAction?.candidate;

    if (!candidate) {
      appendLocalAiExchange(
        action.label,
        "Lucas, nao consegui localizar esse boleto no contexto atual. Atualize o detalhe do cliente e tente de novo.",
      );
      return;
    }

    const nextAction: PendingBoletoAction = {
      candidate,
      deliveryMode: "link",
    };

    setPendingBoletoAction(nextAction);
    void confirmBoletoResend(action.label, nextAction);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir assistente de cobrança"
        className="fixed right-5 top-1/2 z-50 flex size-12 -translate-y-1/2 items-center justify-center rounded-2xl border border-[#A07C3B] bg-[#A07C3B] text-white shadow-[0_18px_50px_rgba(160,124,59,0.34)] transition-all hover:-translate-y-[calc(50%+2px)] hover:bg-[#8F6F35]"
      >
        <BotMessageSquare className="size-5" aria-hidden="true" />
      </button>

      {open ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Fechar assistente de cobrança"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-slate-950/20 backdrop-blur-[2px]"
          />

          <aside className="absolute right-0 top-0 flex h-full w-full max-w-[560px] flex-col border-l border-slate-200/70 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)]">
            <header className="shrink-0 border-b border-slate-100 bg-white px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="size-12 overflow-hidden rounded-2xl border border-[#A07C3B]/30 bg-slate-950 shadow-[0_10px_26px_rgba(160,124,59,0.24)]">
                    <img src={AI_AGENT_AVATAR} alt={AI_AGENT_NAME} className="size-full object-cover" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-slate-950">{AI_AGENT_NAME}</h2>
                    <p className="mt-1 text-sm text-slate-500">Assistente Virtual da Careli</p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Fechar painel"
                  className="flex size-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/55 px-5 py-5">
              <div className="grid gap-2 sm:grid-cols-2">
                {visibleSummaryCards.map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-xl border border-slate-200/70 bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
                  >
                    <p className="text-xs font-medium text-slate-500">{label}</p>
                    <p className="mt-1 line-clamp-2 text-sm font-semibold leading-5 text-slate-950">{value}</p>
                  </div>
                ))}
              </div>

              <div className="mt-5 space-y-4">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex items-end gap-3 ${
                      message.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    {message.role === "ai" ? (
                      <div className="mb-1 size-9 shrink-0 overflow-hidden rounded-full border border-[#A07C3B]/35 bg-slate-950 shadow-[0_8px_18px_rgba(160,124,59,0.22)]">
                        <img src={AI_AGENT_AVATAR} alt={AI_AGENT_NAME} className="size-full object-cover" />
                      </div>
                    ) : null}

                    <div
                      className={`max-w-[82%] rounded-2xl px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:max-w-[430px] ${
                        message.role === "user"
                          ? "rounded-br-md bg-[#A07C3B] text-white"
                          : "rounded-bl-md border border-slate-200/70 bg-white text-slate-700"
                      }`}
                    >
                      <MessageContent content={message.content} isUser={message.role === "user"} />
                      {message.actions?.length ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {message.actions.map((action) => (
                            <button
                              key={`${message.id}-${action.type}-${action.candidateId ?? "pending"}`}
                              type="button"
                              disabled={isSending}
                              onClick={() => handleMessageAction(action)}
                              className="rounded-xl bg-[#A07C3B] px-3 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-[#8f6e33] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {action.label}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
            </div>

            <div className="shrink-0 border-t border-slate-100 bg-white p-4">
              <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
                {intelligence.quickSuggestions.map((suggestion) => (
                  <button
                    key={suggestion.label}
                    type="button"
                    disabled={isSending}
                    onClick={() => sendAiQuestion(suggestion.prompt)}
                    className="shrink-0 rounded-full border border-slate-200/70 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-slate-950 disabled:cursor-wait disabled:opacity-60"
                  >
                    {suggestion.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 rounded-2xl border border-slate-200/70 bg-slate-50/80 px-3 py-2">
                <input
                  type="text"
                  value={inputValue}
                  onChange={(event) => setInputValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      sendAiQuestion();
                    }
                  }}
                  placeholder="Pergunte ao assistente de cobrança"
                  className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                />
                <button
                  type="button"
                  aria-label="Enviar pergunta"
                  disabled={isSending}
                  onClick={() => sendAiQuestion()}
                  className="flex size-9 items-center justify-center rounded-xl bg-[#A07C3B] text-white transition-colors hover:bg-[#8f6e33] disabled:cursor-wait disabled:opacity-60"
                >
                  <Send className="size-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}

function MessageContent({
  content,
  isUser,
}: {
  content: string;
  isUser: boolean;
}) {
  const installmentTable = parseInstallmentPipeTable(content);

  if (!isUser && installmentTable) {
    return (
      <div className="space-y-3 text-sm leading-6 text-slate-700">
        <PlainMessageContent content={installmentTable.intro} isUser={isUser} />
        <div className="space-y-2 rounded-2xl border border-slate-200/70 bg-slate-50/70 p-2">
          {installmentTable.rows.map((row, index) => (
            <article
              key={`${row.reference}-${row.number}-${index}`}
              className="rounded-xl border border-slate-200/70 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-slate-500">Ref. {row.reference}</p>
                  <p className="mt-0.5 text-sm font-semibold text-slate-950">Parcela {row.number}</p>
                </div>
                <span className="rounded-full bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700 ring-1 ring-rose-100">
                  {row.status}
                </span>
              </div>
              <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                <InstallmentAiField label="Original" value={row.originalDueDate} />
                <InstallmentAiField label="Atual" value={row.currentDueDate} />
                <InstallmentAiField label="Pagamento" value={row.paymentDate} />
                <InstallmentAiField label="Valor" value={row.value} strong />
                <InstallmentAiField label="Atraso" value={row.overdue} strong />
              </div>
            </article>
          ))}
        </div>
      </div>
    );
  }

  return <PlainMessageContent content={content} isUser={isUser} />;
}

function PlainMessageContent({
  content,
  isUser,
}: {
  content: string;
  isUser: boolean;
}) {
  const paragraphs = content
    .replace(/\r/g, "")
    .split(/\n{2,}|\n(?=-\s)/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!paragraphs.length) {
    return null;
  }

  return (
    <div className={`space-y-2 text-sm leading-6 ${isUser ? "text-white" : "text-slate-700"}`}>
      {paragraphs.map((paragraph, index) => {
        const isBullet = paragraph.startsWith("- ");
        const text = isBullet ? paragraph.slice(2) : paragraph;

        return (
          <p key={`${paragraph}-${index}`} className={`${isBullet ? "pl-3" : ""} whitespace-pre-line`}>
            {isBullet ? <span className="mr-2 text-[#A07C3B]">•</span> : null}
            {renderInlineText(text)}
          </p>
        );
      })}
    </div>
  );
}

function InstallmentAiField({
  label,
  strong = false,
  value,
}: {
  label: string;
  strong?: boolean;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200/70 bg-slate-50/80 px-2.5 py-2">
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <p className={`mt-0.5 ${strong ? "font-semibold text-slate-950" : "font-medium text-slate-700"}`}>{value}</p>
    </div>
  );
}

function parseInstallmentPipeTable(content: string) {
  if (!content.includes("|") || !/Ref\.|Refer[eê]ncia/i.test(content) || !/Venc/i.test(content)) {
    return null;
  }

  const normalized = content.replace(/\r/g, " ").replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  const rowPattern =
    /(\d{2}\/\d{4})\s*\|\s*([^|]+?)\s*\|\s*(\d{2}\/\d{2}\/\d{4}|-)\s*\|\s*(\d{2}\/\d{2}\/\d{4}|-)\s*\|\s*([^|]+?)\s*\|\s*(R\$\s*[\d.,]+)\s*\|\s*([^|]+?)\s*\|\s*([^-|]*?\d+\s+dias|-)/g;
  const rows = [...normalized.matchAll(rowPattern)].map((match) => ({
    currentDueDate: match[4].trim(),
    number: match[2].trim(),
    originalDueDate: match[3].trim(),
    overdue: match[8].trim(),
    paymentDate: match[5].trim(),
    reference: match[1].trim(),
    status: match[7].trim(),
    value: match[6].trim(),
  }));

  if (rows.length < 2) {
    return null;
  }

  const intro = normalized
    .split(/Ref\.\s*\||Refer[eê]ncia\s*\|/i)[0]
    .replace(/\s*$/g, "")
    .trim();

  return {
    intro,
    rows,
  };
}

function renderInlineText(text: string) {
  return text.split(/(\*\*[^*]+\*\*|https?:\/\/[^\s]+|www\.[^\s]+)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={`${part}-${index}`} className="font-semibold text-inherit">
          {part.slice(2, -2)}
        </strong>
      );
    }

    if (/^(https?:\/\/|www\.)/.test(part)) {
      const href = part.startsWith("http") ? part : `https://${part}`;

      return (
        <a
          key={`${part}-${index}`}
          href={href}
          target="_blank"
          rel="noreferrer"
          className="break-all font-semibold text-[#A07C3B] underline decoration-[#A07C3B]/35 underline-offset-4 hover:text-[#7A5E2C]"
        >
          {part}
        </a>
      );
    }

    return part;
  });
}

function addressAiResponse(content: string, user: { firstName?: string } | null) {
  const firstName = user?.firstName?.trim();

  if (!firstName) {
    return content;
  }

  const trimmed = content.trimStart();

  if (!trimmed) {
    return content;
  }

  const escapedName = firstName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const alreadyAddressed = new RegExp(`^(ola|olá|oi)?[,!\\s-]*${escapedName}\\b`, "i").test(trimmed);

  if (alreadyAddressed) {
    return content;
  }

  const leadingSpace = content.slice(0, content.length - trimmed.length);
  const greetingReplacements: Array<[RegExp, string]> = [
    [/^bom dia[.!]?/i, `Bom dia, ${firstName}.`],
    [/^boa tarde[.!]?/i, `Boa tarde, ${firstName}.`],
    [/^boa noite[.!]?/i, `Boa noite, ${firstName}.`],
    [/^ol[aá][.!]?/i, `Olá, ${firstName}.`],
    [/^oi[.!]?/i, `Oi, ${firstName}.`],
  ];

  for (const [pattern, replacement] of greetingReplacements) {
    if (pattern.test(trimmed)) {
      return `${leadingSpace}${trimmed.replace(pattern, replacement)}`;
    }
  }

  return `${leadingSpace}${firstName}, ${trimmed}`;
}

function buildClientIntelligence(client: QueueClient) {
  const risk = getRiskDescriptor(client.prioridade);
  const unitsCount = client.carteira.unidades.length;
  const mainEnterprise = client.carteira.unidades[0]?.empreendimento ?? client.carteira.empreendimento;
  const nextAction = getNextAction(client.prioridade);
  const approach = getRecommendedApproach(client.prioridade);
  const agreement = client.agreement;

  return {
    initialMessage: `Analisei ${client.nome} e identifiquei risco ${risk.label} por ${client.parcelas.vencidas} parcelas vencidas, atraso médio de ${client.atrasoDias} dias e saldo em atraso de ${client.saldoDevedor}. O acordo está ${agreement.status.toLowerCase()}, com ${agreement.aiSuggestion.breakChance}% de chance de quebra; recomendo ${approach.toLowerCase()}.`,
    summaryCards: [
      ["Risco", risk.card],
      ["Score de risco", `${client.scoreRisco}/100`],
      ["Parcelas vencidas", `${client.parcelas.vencidas}`],
      ["Atraso médio", `${client.atrasoDias} dias`],
      ["Saldo em atraso", client.saldoDevedor],
      ["Workflow", client.workflow.stage],
      ["Acordo", agreement.status],
      ["Chance de quebra", `${agreement.aiSuggestion.breakChance}%`],
      ["Próxima ação", nextAction],
    ],
    quickSuggestions: [
      {
        label: "Resumir cliente",
        prompt: "Resuma este cliente para uma acao de cobranca hoje.",
        response: `Resumo do cliente: ${client.nome} é ${client.dados360.tipoPessoa}, ${client.dados360.profissao}, ${client.dados360.idade}, residente em ${client.dados360.cidade}. Possui ${unitsCount} contrato${unitsCount > 1 ? "s" : ""} vinculado${unitsCount > 1 ? "s" : ""}, ${client.parcelas.vencidas} parcelas vencidas e saldo em atraso de ${client.saldoDevedor}.`,
      },
      {
        label: "Boletos em aberto",
        prompt:
          "Liste os boletos em aberto deste cliente com referencia, numero da parcela, vencimento atual, valor, status, atraso e link do boleto. Traga somente parcelas vencidas ou a vencer que tenham boleto disponivel.",
        response: "Boletos em aberto consultados no C2X.",
      },
      {
        label: "Sugerir próxima ação",
        prompt: "Qual deve ser a proxima acao operacional para este cliente?",
        response: `Próxima ação sugerida: ${client.workflow.nextAction.toLowerCase()}, alinhada à etapa ${client.workflow.stage} e reforçando a possibilidade de regularização sem escalonamento jurídico imediato.`,
      },
      {
        label: "Reenviar boleto",
        prompt: "Quero reenviar o link do boleto para o cliente.",
        response: "Preparar reenvio de boleto pelo CareDesk.",
      },
      {
        label: "Criar mensagem CareDesk",
        prompt:
          "Crie uma mensagem curta para enviar pelo CareDesk para este cliente. Escreva sempre como equipe Careli, nunca como equipe do empreendimento.",
        response: `Mensagem sugerida: Olá, ${getFirstName(client.nome)}. Tudo bem? Aqui é da equipe Careli. Identificamos pendências vinculadas ao seu lote no empreendimento ${mainEnterprise} e queremos te ajudar a regularizar da melhor forma possível. Podemos avaliar uma condição de pagamento mais adequada para este momento?`,
      },
      {
        label: "Propor acordo",
        prompt: "Sugira uma composicao de acordo para regularizar este cliente.",
        response: `Proposta sugerida: ${agreement.aiSuggestion.composition} Chance prevista de quebra: ${agreement.aiSuggestion.breakChance}%. Próxima ação: ${agreement.aiSuggestion.nextAction}.`,
      },
      {
        label: "Risco do acordo",
        prompt: "Explique o risco deste acordo e o que devo observar antes de negociar.",
        response: `Risco operacional do acordo: ${agreement.aiSuggestion.operationalRisk}. Status atual: ${agreement.status}. Valor negociado: ${agreement.negotiatedValue}, entrada: ${agreement.entry}, recuperação atual: ${agreement.recoveredValue}.`,
      },
    ],
  };
}

function buildGuardianClientAiContext(client: QueueClient) {
  const installmentContext = buildDetailedInstallmentContext(client);

  return {
    acordo: {
      chanceQuebra: client.agreement.aiSuggestion.breakChance,
      entrada: client.agreement.entry,
      proximaAcao: client.agreement.aiSuggestion.nextAction,
      riscoOperacional: client.agreement.aiSuggestion.operationalRisk,
      status: client.agreement.status,
      valorNegociado: client.agreement.negotiatedValue,
      valorRecuperado: client.agreement.recoveredValue,
    },
    carteira: {
      contratos: client.carteira.unidades.slice(0, 8).map((unit) => ({
        area: unit.area,
        codigo: unit.matricula,
        empreendimento: unit.empreendimento,
        lote: unit.lote,
        quadra: unit.quadra,
        statusContrato: unit.signedContractStatus ?? unit.statusVenda,
        valor: unit.valorTabela,
      })),
      empreendimentoPrincipal: client.carteira.empreendimento,
      regraContratos: "No Guardian, cada unidade vinculada representa um contrato operacional.",
      unidades: client.carteira.unidades.slice(0, 8).map((unit) => ({
        area: unit.area,
        codigo: unit.matricula,
        empreendimento: unit.empreendimento,
        lote: unit.lote,
        quadra: unit.quadra,
        statusContrato: unit.signedContractStatus ?? unit.statusVenda,
        valor: unit.valorTabela,
      })),
    },
    cliente: {
      atrasoDias: client.atrasoDias,
      bairro: client.dados360.bairro,
      cep: client.dados360.cep,
      cidade: client.dados360.cidade,
      conjuge: client.dados360.conjuge,
      conjugeDados: client.dados360.conjugeDados,
      documentoIdentidade: client.dados360.documentoIdentidade,
      email: client.dados360.email,
      endereco: client.dados360.endereco,
      escolaridade: client.dados360.escolaridade,
      estadoCivil: client.dados360.estadoCivil,
      faixaSalarial: client.dados360.faixaSalarial,
      idade: client.dados360.idade,
      nacionalidade: client.dados360.nacionalidade,
      naturalidade: client.dados360.naturalidade,
      id: client.id,
      nome: client.nome,
      nomeFantasia: client.dados360.nomeFantasia,
      nomeMae: client.dados360.nomeMae,
      prioridade: client.prioridade,
      profissao: client.dados360.profissao,
      razaoSocial: client.dados360.razaoSocial,
      regimeBens: client.dados360.regimeBens,
      responsavel: client.responsavel,
      rg: client.dados360.rg,
      scoreRisco: client.scoreRisco,
      segmento: client.segmento,
      sexo: client.dados360.sexo,
      telefone: client.dados360.telefone,
      tipoPessoa: client.dados360.tipoPessoa,
    },
    parcelas: {
      abertas: client.parcelas.abertas,
      carregadasDoC2x: client.c2xInstallmentsLoaded !== false,
      detalhadas: installmentContext,
      proximaAcao: client.parcelas.proximaAcao,
      ultimaParcela: client.parcelas.ultimaParcela,
      vencidas: client.parcelas.vencidas,
    },
    saldoDevedor: client.saldoDevedor,
    workflow: {
      etapa: client.workflow.stage,
      proximaAcao: client.workflow.nextAction,
    },
  };
}

function buildGuardianQueueAiContext({
  clients,
  filteredClients,
  selectedClient,
  totalCount,
}: {
  clients: QueueClient[];
  filteredClients?: QueueClient[];
  selectedClient: QueueClient;
  totalCount?: number;
}) {
  const uniqueClients = dedupeAiClientsById(clients);
  const uniqueFilteredClients = filteredClients
    ? dedupeAiClientsById(filteredClients)
    : uniqueClients;
  const overdueClients = uniqueClients.filter((client) => client.parcelas.vencidas > 0);
  const overdueInstallments = overdueClients.reduce(
    (total, client) => total + Number(client.parcelas.vencidas ?? 0),
    0,
  );
  const overdueAmount = overdueClients.reduce(
    (total, client) => total + parseAiCurrency(client.saldoDevedor),
    0,
  );

  return {
    aviso:
      "Este snapshot e o contexto geral da fila/carteira carregada no Guardian. Use para perguntas gerais sem abandonar o cliente aberto como foco principal.",
    clienteAberto: {
      atrasoDias: selectedClient.atrasoDias,
      id: selectedClient.id,
      nome: selectedClient.nome,
      parcelasVencidas: selectedClient.parcelas.vencidas,
      prioridade: selectedClient.prioridade,
      saldoVencido: selectedClient.saldoDevedor,
    },
    filtrosAtuais: {
      clientesNoFiltroAtual: uniqueFilteredClients.length,
      topClientesNoFiltro: summarizeAiClients(uniqueFilteredClients, 8),
    },
    porEmpreendimento: summarizeAiByEnterprise(uniqueClients),
    porRisco: summarizeAiByPriority(uniqueClients),
    topClientesPorRisco: summarizeAiClients(
      [...uniqueClients].sort(compareAiQueueRisk),
      12,
    ),
    totais: {
      clientesCarregadosNoContexto: uniqueClients.length,
      clientesEmAtraso: overdueClients.length,
      clientesNaFila: totalCount ?? uniqueClients.length,
      parcelasVencidas: overdueInstallments,
      saldoEmAtraso: formatAiCurrency(overdueAmount),
    },
  };
}

function dedupeAiClientsById(clients: QueueClient[]) {
  const clientsById = new Map<string, QueueClient>();

  clients.forEach((client) => {
    clientsById.set(client.id, client);
  });

  return [...clientsById.values()];
}

function summarizeAiByPriority(clients: QueueClient[]) {
  return ["Crítica", "Alta", "Média", "Baixa"].map((priority) => {
    const priorityClients = clients.filter((client) => client.prioridade === priority);

    return {
      clientes: priorityClients.length,
      parcelasVencidas: priorityClients.reduce(
        (total, client) => total + Number(client.parcelas.vencidas ?? 0),
        0,
      ),
      risco: priority,
      saldoEmAtraso: formatAiCurrency(
        priorityClients.reduce(
          (total, client) => total + parseAiCurrency(client.saldoDevedor),
          0,
        ),
      ),
    };
  });
}

function summarizeAiByEnterprise(clients: QueueClient[]) {
  const enterprises = new Map<string, QueueClient[]>();

  clients.forEach((client) => {
    const name = client.carteira.empreendimento || "Sem empreendimento";
    enterprises.set(name, [...(enterprises.get(name) ?? []), client]);
  });

  return [...enterprises.entries()]
    .map(([enterprise, enterpriseClients]) => ({
      clientes: enterpriseClients.length,
      empreendimento: enterprise,
      parcelasVencidas: enterpriseClients.reduce(
        (total, client) => total + Number(client.parcelas.vencidas ?? 0),
        0,
      ),
      saldoEmAtraso: formatAiCurrency(
        enterpriseClients.reduce(
          (total, client) => total + parseAiCurrency(client.saldoDevedor),
          0,
        ),
      ),
    }))
    .sort((first, second) => second.parcelasVencidas - first.parcelasVencidas)
    .slice(0, 12);
}

function summarizeAiClients(clients: QueueClient[], limit: number) {
  return clients.slice(0, limit).map((client) => ({
    atrasoDias: client.atrasoDias,
    empreendimento: client.carteira.empreendimento,
    id: client.id,
    nome: client.nome,
    parcelasVencidas: client.parcelas.vencidas,
    prioridade: client.prioridade,
    saldoVencido: client.saldoDevedor,
    unidadePrincipal: client.carteira.unidades[0]?.unidadeLote ?? "-",
  }));
}

function compareAiQueueRisk(first: QueueClient, second: QueueClient) {
  return (
    Number(second.parcelas.vencidas ?? 0) - Number(first.parcelas.vencidas ?? 0) ||
    Number(second.atrasoDias ?? 0) - Number(first.atrasoDias ?? 0) ||
    parseAiCurrency(second.saldoDevedor) - parseAiCurrency(first.saldoDevedor)
  );
}

function parseAiCurrency(value: string) {
  const normalized = value
    .replace(/\s/g, "")
    .replace(/[^\d,.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : 0;
}

function buildDetailedInstallmentContext(client: QueueClient) {
  const installments = [...(client.c2xInstallments ?? [])].sort((first, second) => {
    const unitCompare = String(first.unitId).localeCompare(String(second.unitId), "pt-BR");

    if (unitCompare !== 0) {
      return unitCompare;
    }

    return Number(first.referenceValue ?? 0) - Number(second.referenceValue ?? 0);
  });
  const unitsById = new Map(client.carteira.unidades.map((unit) => [unit.id, unit]));
  const included = installments.slice(0, MAX_AI_INSTALLMENTS);
  const overdue = installments.filter((installment) => installment.status === "Vencida");
  const liquidated = installments.filter((installment) => installment.status === "Liquidada");
  const upcoming = installments.filter((installment) => installment.status === "A vencer");

  return {
    aviso:
      client.c2xInstallmentsLoaded === false
        ? "As parcelas detalhadas ainda estao carregando no detalhe do cliente."
        : installments.length
          ? "Use esta lista para responder perguntas parcela a parcela. Nao diga que possui apenas resumo quando esta lista estiver presente."
          : "Nenhuma parcela detalhada foi carregada para este cliente.",
    incluiAte: MAX_AI_INSTALLMENTS,
    liquidadas: liquidated.length,
    parcelasIncluidasNoContexto: included.length,
    parcelasTotalCarregadas: installments.length,
    proximasAVencer: upcoming.length,
    truncado: installments.length > included.length,
    vencidas: overdue.length,
    valorVencidoCarregado: formatAiCurrency(sumInstallmentValues(overdue)),
    boletosEmAberto: included
      .filter(
        (installment) =>
          installment.status !== "Liquidada" &&
          Boolean(installment.paymentUrl),
      )
      .map((installment) => {
        const unit = resolveAiInstallmentUnit(installment, unitsById);

        return {
          asaasPaymentId: installment.asaasPaymentId ?? null,
          atrasoDias: installment.overdueDays,
          boletoUrl: installment.paymentUrl,
          codigoUnidade: unit.code,
          numero: installment.number,
          referencia: installment.reference,
          status: installment.status,
          unidade: unit.label,
          valor: installment.value,
          vencimentoAtual: installment.dueDate,
          vencimentoOriginal: installment.dueDateOriginal ?? installment.dueDate,
        };
      }),
    porUnidade: client.carteira.unidades.map((unit) => {
      const unitInstallments = installments.filter((installment) => installment.unitId === unit.id);

      return {
        codigo: unit.matricula,
        empreendimento: unit.empreendimento,
        id: unit.id,
        lote: unit.lote,
        parcelasCarregadas: unitInstallments.length,
        parcelasVencidas: unitInstallments.filter((installment) => installment.status === "Vencida").length,
        quadra: unit.quadra,
        saldoVencido: formatAiCurrency(
          sumInstallmentValues(unitInstallments.filter((installment) => installment.status === "Vencida")),
        ),
      };
    }),
    lista: included.map((installment) => {
      const unit = resolveAiInstallmentUnit(installment, unitsById);

      return {
        asaasPaymentId: installment.asaasPaymentId ?? null,
        atrasoDias: installment.overdueDays,
        boletoDisponivel: Boolean(installment.paymentUrl),
        boletoUrl: installment.paymentUrl ?? null,
        codigoUnidade: unit.code,
        dataPagamento: installment.paymentDate ?? "-",
        id: installment.id,
        numero: installment.number,
        referencia: installment.reference,
        status: installment.status,
        unidade: unit.label,
        valor: installment.value,
        vencimentoAtual: installment.dueDate,
        vencimentoFoiAlterado: Boolean(installment.dueDateChanged),
        vencimentoOriginal: installment.dueDateOriginal ?? installment.dueDate,
      };
    }),
  };
}

function sumInstallmentValues(installments: NonNullable<QueueClient["c2xInstallments"]>) {
  return installments.reduce((total, installment) => total + Number(installment.valueNumber ?? 0), 0);
}

function resolveAiInstallmentUnit(
  installment: NonNullable<QueueClient["c2xInstallments"]>[number],
  unitsById: Map<string, PortfolioUnit>,
) {
  const unit = unitsById.get(installment.unitId);

  if (unit) {
    return {
      code: unit.matricula,
      label: formatAiUnitLabel(unit),
    };
  }

  return {
    code: installment.unitCode ?? installment.unitId,
    label: installment.unitLabel ?? installment.unitCode ?? installment.unitId,
  };
}

function formatAiUnitLabel(unit: PortfolioUnit) {
  return `${unit.empreendimento} Q${formatAiBlock(unit.quadra)} L${formatAiLot(unit.lote)}`;
}

function formatAiCurrency(value: number) {
  return value.toLocaleString("pt-BR", {
    currency: "BRL",
    style: "currency",
  });
}

function formatAiBlock(block: string) {
  return block.replace(/^Q/i, "");
}

function formatAiLot(lot: string) {
  return lot.replace(/^L/i, "");
}

function buildBoletoBubbleMessage(candidate: BoletoCandidate) {
  return [
    `Boleto da parcela ${candidate.number} — referência ${candidate.reference}`,
    `Contrato: ${candidate.unitCode} · ${candidate.unitLabel}`,
    `Vencimento: ${candidate.vencimento} | Valor: ${candidate.value}`,
    `Status: ${candidate.status} | Atraso: ${candidate.atrasoDias > 0 ? `${candidate.atrasoDias} dias` : "-"}`,
    `Boleto: ${candidate.boletoUrl}`,
  ].join("\n");
}

function buildBoletoDeliveryMessage(client: QueueClient) {
  const email = cleanContactValue(client.dados360.email);
  const phone = cleanContactValue(client.dados360.telefone);
  const missing = [
    email ? null : "e-mail",
    phone ? null : "telefone",
  ].filter(Boolean);

  if (email && phone) {
    return `Boleto enviado para o e-mail ${email} e para o telefone ${phone}.`;
  }

  return `Boleto separado para reenvio pelo CareDesk, mas falta ${missing.join(" e ")} no cadastro do cliente para confirmar o envio.`;
}

function cleanContactValue(value?: string) {
  const normalized = value?.trim();

  if (
    !normalized ||
    /^(sem|nao informado|não informado|undefined|null|-)/i.test(normalized)
  ) {
    return "";
  }

  return normalized;
}

function getOpenBoletoCandidates(client: QueueClient): BoletoCandidate[] {
  const unitsById = new Map(client.carteira.unidades.map((unit) => [unit.id, unit]));

  return [...(client.c2xInstallments ?? [])]
    .filter(
      (installment) =>
        installment.status !== "Liquidada" &&
        Boolean(installment.paymentUrl),
    )
    .map((installment) => {
      const unit = resolveAiInstallmentUnit(installment, unitsById);

      return {
        atrasoDias: installment.overdueDays,
        boletoUrl: installment.paymentUrl ?? "",
        id: installment.id,
        number: installment.number,
        reference: installment.reference,
        status: installment.status,
        unitCode: unit.code,
        unitLabel: unit.label,
        value: installment.value,
        vencimento: installment.dueDate,
      };
    })
    .sort((first, second) => {
      if (second.atrasoDias !== first.atrasoDias) {
        return second.atrasoDias - first.atrasoDias;
      }

      return Number(first.reference.replace(/\D/g, "")) - Number(second.reference.replace(/\D/g, ""));
    });
}

function looksLikeBoletoResendRequest(question: string) {
  const normalized = normalizeQuestion(question);

  return (
    /(reenviar|enviar|mandar|manda|envia|disparar|reenvia)/.test(normalized) &&
    /(boleto|fatura|cobranca|cobranca|link)/.test(normalized)
  );
}

function looksLikeOpenBoletoQuestion(question: string) {
  const normalized = normalizeQuestion(question);

  return (
    /(boleto|boletos|fatura|faturas|cobranca|cobrancas|link|links)/.test(normalized) &&
    /(aberto|abertos|aberta|abertas|em aberto|quais|listar|lista|tem|traz|mostrar|mostra)/.test(normalized)
  );
}

function isBoletoConfirmation(question: string) {
  const normalized = normalizeQuestion(question);

  return (
    /^(sim|pode|confirmo|manda|envia|reenvia|reenviar|ok|isso)\b/.test(normalized) ||
    /(pode reenviar|pode enviar|manda o link|envia o link|confirmado)/.test(normalized)
  );
}

function isBoletoCancellation(question: string) {
  return /^(nao|cancela|cancelar|deixa|agora nao)\b/i.test(normalizeQuestion(question));
}

function normalizeQuestion(question: string) {
  return question
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

async function requestBoletoResend(paymentId: string) {
  const accessToken = await getGuardianActionAccessToken();
  const response = await fetch("/api/guardian/asaas/boleto-resend", {
    body: JSON.stringify({
      deliveryMode: "link",
      paymentId,
    }),
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload = (await response.json().catch(() => null)) as
    | {
        action?: {
          boletoUrl?: string;
          faturaUrl?: string;
        };
        error?: unknown;
      }
    | null;

  if (!response.ok) {
    throw new Error(
      typeof payload?.error === "string"
        ? payload.error
        : "Nao foi possivel preparar o reenvio do boleto.",
    );
  }

  return payload ?? {};
}

async function getGuardianActionAccessToken() {
  const client = getHubSupabaseClient();

  if (!client) {
    return "local-hub-user";
  }

  const sessionResult = await client.auth.getSession();
  const accessToken = sessionResult.data.session?.access_token;

  if (sessionResult.error || !accessToken) {
    throw new Error("Sessao ausente para executar a acao do Guardian.");
  }

  return accessToken;
}

function getRiskDescriptor(priority: QueueClient["prioridade"]) {
  const map = {
    Crítica: { label: "crítico", card: "Crítico", entryPercent: 20 },
    Alta: { label: "alto", card: "Alto", entryPercent: 20 },
    Média: { label: "moderado", card: "Moderado", entryPercent: 25 },
    Baixa: { label: "baixo", card: "Baixo", entryPercent: 30 },
  };

  return map[priority];
}

function getNextAction(priority: QueueClient["prioridade"]) {
  const map = {
    Crítica: "Contato executivo pelo CareDesk e ligação no mesmo dia",
    Alta: "CareDesk consultivo com proposta de entrada reduzida",
    Média: "CareDesk consultivo e lembrete de regularização",
    Baixa: "Lembrete preventivo pelo CareDesk",
  };

  return map[priority];
}

function getRecommendedApproach(priority: QueueClient["prioridade"]) {
  const map = {
    Crítica: "contato humanizado com urgência operacional e alternativa flexível de acordo",
    Alta: "contato humanizado e proposta de regularização com entrada reduzida",
    Média: "abordagem consultiva com reforço de regularização amigável",
    Baixa: "abordagem preventiva, objetiva e sem tom de escalonamento",
  };

  return map[priority];
}

function getFirstName(name: string) {
  return name.split(" ")[0] ?? name;
}




