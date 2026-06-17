"use client";

import { PanelTitle } from "@/modules/squadops/blocks/shared/operations-ui";
import { Surface } from "@repo/uix";
import {
  Bot,
  CalendarDays,
  ClipboardCheck,
  Copy,
  Database,
  Loader2,
  MessageSquareText,
  Rocket,
  Send,
  ServerCog,
  WandSparkles,
  X,
} from "lucide-react";
import { useState } from "react";

type CopilotAnswerSection = {
  id: string;
  items: string[];
  title: string;
  type: "module" | "prompt" | "risk" | "summary";
};

export type PoAiChatMessage = {
  content: string;
  createdAt: string;
  id: string;
  role: "assistant" | "user";
};

export type PromptTemplate<TTarget extends string = string> = {
  body: string;
  description: string;
  id: string;
  label: string;
  target: TTarget;
  type: "deploy" | "daily" | "weekly" | "monthly" | "monitoring";
};

const poAiFieldClassName =
  "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-[#A07C3B]/40 focus:ring-2 focus:ring-[#A07C3B]/10";

export function createPoAiMessage(
  role: PoAiChatMessage["role"],
  content: string,
): PoAiChatMessage {
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `po-ai-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return {
    content,
    createdAt: new Date().toISOString(),
    id,
    role,
  };
}

export function FloatingPoAiButton({
  isHidden,
  onClick,
}: {
  isHidden: boolean;
  onClick: () => void;
}) {
  if (isHidden) {
    return null;
  }

  return (
    <button
      aria-label="Abrir PO AI"
      className="fixed bottom-6 right-40 z-40 inline-flex h-12 items-center gap-3 rounded-2xl border border-[#A07C3B]/25 bg-white px-4 text-sm font-semibold text-[#7A5E2C] shadow-[0_18px_50px_rgba(15,23,42,0.18)] transition-all hover:-translate-y-0.5 hover:bg-[#A07C3B]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
      onClick={onClick}
      type="button"
    >
      <span className="relative grid size-8 place-items-center rounded-xl bg-[#A07C3B]/10 text-[#A07C3B]">
        <Bot className="size-4" aria-hidden="true" />
        <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />
      </span>
      PO AI
    </button>
  );
}

function PoAiChannelPanel<TTarget extends string>({
  error,
  formatDateTime,
  isLoading,
  messages,
  onAsk,
  onGeneratePrompt,
  onQuestionChange,
  onTargetChange,
  promptTargets,
  question,
  target,
}: {
  error: string | null;
  formatDateTime: (value: string) => string;
  isLoading: boolean;
  messages: PoAiChatMessage[];
  onAsk: (question: string) => void;
  onGeneratePrompt: () => void;
  onQuestionChange: (question: string) => void;
  onTargetChange: (target: TTarget) => void;
  promptTargets: readonly TTarget[];
  question: string;
  target: TTarget;
}) {
  return (
    <Surface
      bordered
      className="flex min-h-0 flex-1 flex-col overflow-hidden border-slate-200/70 bg-white p-0 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
      <div className="border-b border-slate-100 p-5">
        <PanelTitle
          eyebrow="Cérebro do Panteon"
          icon={<Bot size={18} />}
          title="PO AI"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100">
            monitoramento real
          </span>
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-100">
            diário = histórico
          </span>
          <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700 ring-1 ring-sky-100">
            código do Panteon
          </span>
          <span className="rounded-full bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200/70">
            sem execução automática
          </span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50/70 p-4">
          {messages.map((message) => (
            <PoAiMessageBubble
              formatDateTime={formatDateTime}
              key={message.id}
              message={message}
            />
          ))}
          {isLoading ? (
            <div className="flex justify-start">
              <div className="rounded-2xl border border-slate-200/70 bg-white px-3 py-2 text-sm font-semibold text-slate-500 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin text-[#A07C3B]" />
                  PO AI consultando monitoramento real, histórico e código do
                  Panteon
                </span>
              </div>
            </div>
          ) : null}
        </div>

        <div className="border-t border-slate-100 bg-white p-4">
          {error ? (
            <p className="m-0 mb-3 rounded-lg bg-red-50 p-3 text-xs font-semibold text-red-700 ring-1 ring-red-100">
              {error}
            </p>
          ) : null}
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-slate-500">
              Conversar com o PO AI
            </span>
            <textarea
              className={`${poAiFieldClassName} h-20 resize-none py-2`}
              onChange={(event) => onQuestionChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  onAsk(question);
                }
              }}
              placeholder="Pergunte sobre banco, APIs, monitoramento real, risco, decisão, deploy ou próximo passo..."
              value={question}
            />
          </label>

          <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <select
              className={poAiFieldClassName}
              onChange={(event) => onTargetChange(event.target.value as TTarget)}
              value={target}
            >
              {promptTargets.map((promptTarget) => (
                <option key={promptTarget} value={promptTarget}>
                  {promptTarget}
                </option>
              ))}
            </select>
            <button
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#A07C3B]/20 bg-white px-3 text-xs font-semibold text-[#7A5E2C] transition-colors hover:bg-[#A07C3B]/5 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isLoading}
              onClick={onGeneratePrompt}
              type="button"
            >
              <WandSparkles className="size-4" />
              Prompt
            </button>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200/70 bg-white px-3 text-xs font-semibold text-slate-600 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-slate-950"
              onClick={() => onQuestionChange("O que foi feito hoje?")}
              type="button"
            >
              <MessageSquareText className="size-4 text-[#A07C3B]" />
              Hoje
            </button>
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200/70 bg-white px-3 text-xs font-semibold text-slate-600 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-slate-950"
              onClick={() =>
                onQuestionChange(
                  "Como está o banco de dados no monitoramento real agora? Use o diário apenas como histórico.",
                )
              }
              type="button"
            >
              <Database className="size-4 text-[#A07C3B]" />
              Banco
            </button>
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200/70 bg-white px-3 text-xs font-semibold text-slate-600 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-slate-950"
              onClick={() =>
                onQuestionChange("O que precisa ir para Hefesto?")
              }
              type="button"
            >
              <Rocket className="size-4 text-[#A07C3B]" />
              Hefesto
            </button>
          </div>

          <button
            className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#101820] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#1b2533] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isLoading}
            onClick={() => onAsk(question)}
            type="button"
          >
            {isLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            Enviar
          </button>
        </div>
      </div>
    </Surface>
  );
}

export function PoAiDrawer<TTarget extends string>({
  error,
  formatDateTime,
  isLoading,
  isOpen,
  messages,
  onAsk,
  onClose,
  onGeneratePrompt,
  onQuestionChange,
  onTargetChange,
  promptTargets,
  question,
  target,
}: {
  error: string | null;
  formatDateTime: (value: string) => string;
  isLoading: boolean;
  isOpen: boolean;
  messages: PoAiChatMessage[];
  onAsk: (question: string) => void;
  onClose: () => void;
  onGeneratePrompt: () => void;
  onQuestionChange: (question: string) => void;
  onTargetChange: (target: TTarget) => void;
  promptTargets: readonly TTarget[];
  question: string;
  target: TTarget;
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/20 backdrop-blur-[1px]">
      <button
        aria-label="Fechar PO AI"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        type="button"
      />
      <aside className="absolute inset-y-0 right-0 z-10 flex w-full max-w-2xl flex-col border-l border-slate-200 bg-slate-50 p-4 shadow-2xl">
        <button
          className="absolute right-7 top-7 z-10 grid size-9 place-items-center rounded-lg border border-slate-200/70 bg-white text-slate-500 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:bg-slate-50 hover:text-slate-950"
          onClick={onClose}
          type="button"
        >
          <X className="size-4" />
        </button>
        <PoAiChannelPanel
          error={error}
          formatDateTime={formatDateTime}
          isLoading={isLoading}
          messages={messages}
          onAsk={onAsk}
          onGeneratePrompt={onGeneratePrompt}
          onQuestionChange={onQuestionChange}
          onTargetChange={onTargetChange}
          promptTargets={promptTargets}
          question={question}
          target={target}
        />
      </aside>
    </div>
  );
}

export function PromptLibraryModal<TTarget extends string>({
  isOpen,
  onClose,
  onSelectTemplate,
  selectedTemplate,
  templates,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSelectTemplate: (templateId: string) => void;
  selectedTemplate: PromptTemplate<TTarget>;
  templates: PromptTemplate<TTarget>[];
}) {
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null);

  if (!isOpen) {
    return null;
  }

  async function copyPrompt(template: PromptTemplate<TTarget>) {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }

    try {
      await navigator.clipboard.writeText(template.body);
      setCopiedPromptId(template.id);
      window.setTimeout(() => setCopiedPromptId(null), 1400);
    } catch {
      setCopiedPromptId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] bg-slate-950/35 p-4 backdrop-blur-[2px]">
      <button
        aria-label="Fechar biblioteca de prompts"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        type="button"
      />
      <div
        aria-label="Biblioteca de prompts do PO AI"
        aria-modal="true"
        className="relative z-10 mx-auto flex h-full max-h-[48rem] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
        role="dialog"
      >
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 p-5">
          <PanelTitle
            eyebrow="modelos prontos"
            icon={<WandSparkles size={18} />}
            title="Biblioteca de prompts"
          />
          <button
            className="grid size-9 place-items-center rounded-lg border border-slate-200/70 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-950"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[21rem_minmax(0,1fr)]">
          <aside className="min-h-0 overflow-y-auto border-b border-slate-100 bg-slate-50/70 p-4 lg:border-b-0 lg:border-r">
            <div className="grid gap-2">
              {templates.map((template) => {
                const isSelected = template.id === selectedTemplate.id;

                return (
                  <button
                    aria-pressed={isSelected}
                    className={`rounded-lg border p-3 text-left transition-colors ${
                      isSelected
                        ? "border-[#A07C3B]/35 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.06)]"
                        : "border-slate-200/70 bg-white/70 hover:border-[#A07C3B]/25 hover:bg-white"
                    }`}
                    key={template.id}
                    onClick={() => onSelectTemplate(template.id)}
                    type="button"
                  >
                    <div className="flex items-start gap-3">
                      <span className="flex size-9 items-center justify-center rounded-lg bg-slate-50 text-[#A07C3B] ring-1 ring-slate-200/70">
                        {promptTemplateIcon(template)}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-slate-950">
                          {template.label}
                        </span>
                        <span className="mt-1 block text-xs leading-5 text-slate-500">
                          {template.description}
                        </span>
                        <span className="mt-2 inline-flex rounded-full bg-white px-2.5 py-1 text-[0.68rem] font-semibold uppercase text-slate-500 ring-1 ring-slate-200/70">
                          {promptTemplateTypeLabel(template.type)}
                        </span>
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="flex min-h-0 flex-col p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="m-0 text-xs font-semibold uppercase text-[#7A5E2C]">
                  {selectedTemplate.target}
                </p>
                <h3 className="m-0 mt-1 text-lg font-semibold text-slate-950">
                  {selectedTemplate.label}
                </h3>
                <p className="m-0 mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                  Texto pronto para copiar e enviar ao dev responsavel.
                </p>
              </div>
              <span className="inline-flex items-center gap-2 rounded-full bg-[#A07C3B]/10 px-3 py-1.5 text-xs font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
                {promptTemplateIcon(selectedTemplate)}
                {promptTemplateTypeLabel(selectedTemplate.type)}
              </span>
            </div>

            <textarea
              aria-label="Prompt selecionado"
              className="mt-4 min-h-0 flex-1 resize-none rounded-lg border border-slate-200 bg-slate-50/80 p-4 font-mono text-xs leading-5 text-slate-800 outline-none focus:border-[#A07C3B]/35 focus:ring-2 focus:ring-[#A07C3B]/10"
              readOnly
              spellCheck={false}
              value={selectedTemplate.body}
            />

            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#101820] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#1b2533]"
                onClick={() => void copyPrompt(selectedTemplate)}
                type="button"
              >
                <Copy className="size-4" />
                {copiedPromptId === selectedTemplate.id
                  ? "Texto copiado"
                  : "Copiar para enviar ao dev"}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function promptTemplateIcon<TTarget extends string>(
  template: PromptTemplate<TTarget>,
) {
  if (template.type === "deploy") {
    return <Rocket className="size-4" />;
  }

  if (template.type === "daily") {
    return <MessageSquareText className="size-4" />;
  }

  if (template.type === "weekly") {
    return <ClipboardCheck className="size-4" />;
  }

  if (template.type === "monitoring") {
    return <ServerCog className="size-4" />;
  }

  return <CalendarDays className="size-4" />;
}

function promptTemplateTypeLabel(type: PromptTemplate["type"]) {
  if (type === "deploy") {
    return "deploy";
  }

  if (type === "daily") {
    return "diario";
  }

  if (type === "weekly") {
    return "semanal";
  }

  if (type === "monitoring") {
    return "monitoramento";
  }

  return "mensal";
}

function PoAiMessageBubble({
  formatDateTime,
  message,
}: {
  formatDateTime: (value: string) => string;
  message: PoAiChatMessage;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[86%] rounded-2xl bg-[#101820] px-4 py-3 text-sm leading-6 text-white shadow-[0_1px_2px_rgba(15,23,42,0.08)]">
          <p className="m-0 whitespace-pre-wrap">{message.content}</p>
          <p className="m-0 mt-2 text-right text-[0.68rem] font-semibold text-white/55">
            {formatDateTime(message.createdAt)}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[94%]">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-500">
          <span className="flex size-7 items-center justify-center rounded-lg bg-white text-[#A07C3B] ring-1 ring-slate-200/70">
            <Bot className="size-4" />
          </span>
          <span>PO AI</span>
          <span>/</span>
          <span>{formatDateTime(message.createdAt)}</span>
        </div>
        <CopilotAnswerBubbles answer={message.content} compact />
      </div>
    </div>
  );
}

function CopilotAnswerBubbles({
  answer,
  compact = false,
}: {
  answer: string;
  compact?: boolean;
}) {
  const sections = parseCopilotAnswer(answer);

  return (
    <div
      className={
        compact
          ? "grid gap-3"
          : "mt-4 rounded-xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
      }
    >
      {!compact ? (
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-slate-50 text-[#A07C3B] ring-1 ring-slate-200/70">
            <Bot className="size-4" />
          </span>
          <div>
            <p className="m-0 text-xs font-semibold uppercase text-[#7A5E2C]">
              Resposta do PO AI
            </p>
            <p className="m-0 mt-0.5 text-xs text-slate-500">
              Organizado por frente para leitura rápida
            </p>
          </div>
        </div>
      ) : null}

      <div className={compact ? "grid gap-3" : "mt-4 grid gap-3"}>
        {sections.map((section) => (
          <article
            className="rounded-xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
            key={section.id}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="m-0 text-[0.95rem] font-semibold text-slate-950">
                {section.title}
              </h3>
              <span
                className={`rounded-full px-2.5 py-1 text-[0.68rem] font-semibold uppercase ${copilotSectionBadgeClass(section.type)}`}
              >
                {copilotSectionLabel(section.type)}
              </span>
            </div>
            <ul className="m-0 mt-3 grid list-none gap-2 p-0">
              {section.items.map((item, index) =>
                isCopilotSubheading(item) ? (
                  <li
                    className="pt-2 text-xs font-semibold uppercase text-[#7A5E2C]"
                    key={`${section.id}-${index}`}
                  >
                    {item.replace(/:$/, "")}
                  </li>
                ) : (
                  <li
                    className="grid grid-cols-[0.45rem_minmax(0,1fr)] gap-3 text-sm leading-6 text-slate-700"
                    key={`${section.id}-${index}`}
                  >
                    <span className="mt-[0.62rem] size-1.5 rounded-full bg-[#A07C3B]" />
                    <span className="min-w-0">{item}</span>
                  </li>
                ),
              )}
            </ul>
          </article>
        ))}
      </div>
    </div>
  );
}

function parseCopilotAnswer(answer: string): CopilotAnswerSection[] {
  const sections: CopilotAnswerSection[] = [];
  let current: CopilotAnswerSection | null = null;

  function ensureSection(title = "Resumo executivo") {
    if (!current) {
      current = {
        id: `copilot-section-${sections.length + 1}`,
        items: [],
        title,
        type: inferCopilotSectionType(title),
      };
      sections.push(current);
    }

    return current;
  }

  function getOrCreateModuleSection(title: string) {
    const normalizedTitle = normalizeSearchText(title);
    const existingSection = sections.find(
      (section) => normalizeSearchText(section.title) === normalizedTitle,
    );

    if (existingSection) {
      return existingSection;
    }

    const section: CopilotAnswerSection = {
      id: `copilot-section-${sections.length + 1}`,
      items: [],
      title,
      type: "module",
    };

    sections.push(section);
    return section;
  }

  answer
    .split(/\r?\n/)
    .map(cleanCopilotLine)
    .filter(Boolean)
    .forEach((line) => {
      const title = extractCopilotTitle(line);

      if (title) {
        current = {
          id: `copilot-section-${sections.length + 1}`,
          items: [],
          title,
          type: inferCopilotSectionType(title),
        };
        sections.push(current);
        return;
      }

      const item = cleanCopilotItem(line);

      if (!item || item === "---") {
        return;
      }

      const moduleTitle = detectCopilotModuleTitle(item);

      if (moduleTitle && current?.type !== "module") {
        getOrCreateModuleSection(moduleTitle).items.push(item);
        return;
      }

      ensureSection().items.push(item);
    });

  return sections
    .map((section) => ({
      ...section,
      items: section.items.length > 0 ? section.items : ["Não informado."],
    }))
    .filter((section) => section.items.length > 0);
}

function detectCopilotModuleTitle(text: string) {
  const normalizedText = normalizeSearchText(text);

  if (
    normalizedText.includes("releaseops") ||
    normalizedText.includes("engineering operations") ||
    normalizedText.includes("producao") ||
    normalizedText.includes("deploy")
  ) {
    return "Hefesto / Engineering Operations";
  }

  if (
    normalizedText.includes("hubops") ||
    normalizedText.includes("squadops")
  ) {
    return "Zeus";
  }

  if (normalizedText.includes("supportops")) {
    return "Zeus";
  }

  if (normalizedText.includes("guardian")) {
    return "Hades";
  }

  if (normalizedText.includes("pulsex")) {
    return "Hermes";
  }

  if (normalizedText.includes("caredesk")) {
    return "Iris";
  }

  if (normalizedText.includes("setup")) {
    return "Setup";
  }

  return null;
}

function extractCopilotTitle(line: string) {
  const front = line.match(/^Frente:\s+(.+)$/i);

  if (front?.[1]) {
    return cleanCopilotItem(front[1]);
  }

  const heading = line.match(/^#{2,6}\s+(.+)$/);

  if (heading?.[1]) {
    return cleanCopilotItem(heading[1]);
  }

  const numberedModule = line.match(
    /^(?:\d+\.\s+)?((?:Hades|Iris|Hermes|Zeus|Hefesto|ReleaseOps|SupportOps|Setup|Engineering Operations)[\w\s/.-]*)$/i,
  );

  if (numberedModule?.[1]) {
    return cleanCopilotItem(numberedModule[1]);
  }

  return null;
}

function cleanCopilotLine(line: string) {
  return line.trim();
}

function cleanCopilotItem(line: string) {
  return line
    .replace(/^[-*]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function isCopilotSubheading(item: string) {
  return item.endsWith(":") && item.length <= 80;
}

function inferCopilotSectionType(title: string): CopilotAnswerSection["type"] {
  const normalizedTitle = normalizeSearchText(title);

  if (
    normalizedTitle.includes("risco") ||
    normalizedTitle.includes("pendencia") ||
    normalizedTitle.includes("atencao")
  ) {
    return "risk";
  }

  if (normalizedTitle.includes("prompt")) {
    return "prompt";
  }

  if (
    normalizedTitle.includes("guardian") ||
    normalizedTitle.includes("caredesk") ||
    normalizedTitle.includes("pulsex") ||
    normalizedTitle.includes("hubops") ||
    normalizedTitle.includes("squadops") ||
    normalizedTitle.includes("releaseops") ||
    normalizedTitle.includes("supportops") ||
    normalizedTitle.includes("setup") ||
    normalizedTitle.includes("engineering operations")
  ) {
    return "module";
  }

  return "summary";
}

function copilotSectionLabel(type: CopilotAnswerSection["type"]) {
  if (type === "module") {
    return "módulo";
  }

  if (type === "prompt") {
    return "prompt";
  }

  if (type === "risk") {
    return "atenção";
  }

  return "resumo";
}

function copilotSectionBadgeClass(type: CopilotAnswerSection["type"]) {
  if (type === "module") {
    return "bg-sky-50 text-sky-700 ring-1 ring-sky-100";
  }

  if (type === "prompt") {
    return "bg-violet-50 text-violet-700 ring-1 ring-violet-100";
  }

  if (type === "risk") {
    return "bg-amber-50 text-amber-800 ring-1 ring-amber-100";
  }

  return "bg-[#A07C3B]/10 text-[#7A5E2C] ring-1 ring-[#A07C3B]/15";
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
