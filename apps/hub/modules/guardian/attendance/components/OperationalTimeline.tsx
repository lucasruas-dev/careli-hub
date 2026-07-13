/* eslint-disable */
// @ts-nocheck
"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Bot,
  CalendarCheck,
  ClipboardList,
  Handshake,
  MessageCircle,
  Paperclip,
  PhoneCall,
  Plus,
  ReceiptText,
  Scale,
  Search,
  ShieldAlert,
  User,
  UserRoundPen,
  X,
} from "lucide-react";
import { Tooltip } from "@repo/uix";
import { DetailSection } from "@/modules/guardian/attendance/components/DetailSection";
import { useAuth } from "@/providers/auth-provider";
import type {
  TimelineEventStatus,
  TimelineEventType,
  QueueClient,
} from "@/modules/guardian/attendance/types";

type OperationalTimelineProps = {
  client?: QueueClient;
  defaultUnit?: QueueClient["carteira"]["unidades"][number];
  events: QueueClient["timeline"];
  onCreateEvent?: (event: QueueClient["timeline"][number]) => Promise<void>;
};

const actionItems = [
  { label: "WhatsApp", icon: MessageCircle },
  { label: "Ligação", icon: PhoneCall },
  { label: "Acordo", icon: Handshake },
  { label: "Boleto", icon: ReceiptText },
];

const MAX_EVENT_ATTACHMENTS = 3;
const MAX_EVENT_ATTACHMENT_BYTES = 8_000_000;
const ACCEPTED_EVENT_ATTACHMENTS =
  "image/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,application/pdf";

const eventVisuals: Record<
  TimelineEventType,
  {
    icon: typeof MessageCircle;
    className: string;
    dotClassName: string;
  }
> = {
  "Ligação realizada": {
    icon: PhoneCall,
    className: "bg-indigo-50 dark:bg-indigo-500/12 text-indigo-700 dark:text-indigo-300 ring-indigo-100 dark:ring-indigo-500/25",
    dotClassName: "bg-indigo-500",
  },
  "WhatsApp enviado": {
    icon: MessageCircle,
    className: "bg-emerald-50 dark:bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 ring-emerald-100 dark:ring-emerald-500/25",
    dotClassName: "bg-emerald-500",
  },
  "Promessa de pagamento": {
    icon: CalendarCheck,
    className: "bg-teal-50 dark:bg-teal-500/12 text-teal-700 dark:text-teal-300 ring-teal-100 dark:ring-teal-500/25",
    dotClassName: "bg-teal-500",
  },
  "Acordo gerado": {
    icon: Handshake,
    className: "bg-[#A07C3B]/8 text-[#7A5E2C] dark:text-[#d9b877] ring-[#A07C3B]/15",
    dotClassName: "bg-[#A07C3B]",
  },
  "Quebra de acordo": {
    icon: AlertTriangle,
    className: "bg-rose-50 dark:bg-rose-500/12 text-rose-700 dark:text-rose-300 ring-rose-100 dark:ring-rose-500/25",
    dotClassName: "bg-rose-500",
  },
  "Boleto C2X": {
    icon: ReceiptText,
    className: "bg-sky-50 dark:bg-sky-500/12 text-sky-700 dark:text-sky-300 ring-sky-100 dark:ring-sky-500/25",
    dotClassName: "bg-sky-500",
  },
  "Atualização cadastral": {
    icon: UserRoundPen,
    className: "bg-cyan-50 text-cyan-700 ring-cyan-100",
    dotClassName: "bg-cyan-500",
  },
  "Observação operacional": {
    icon: ClipboardList,
    className: "bg-subtle text-ink-soft ring-line",
    dotClassName: "bg-subtle",
  },
  "Alteração de risco": {
    icon: ShieldAlert,
    className: "bg-amber-50 dark:bg-amber-500/12 text-amber-700 dark:text-amber-300 ring-amber-100 dark:ring-amber-500/25",
    dotClassName: "bg-amber-500",
  },
  "Acionamento jurídico": {
    icon: Scale,
    className: "bg-zinc-100 text-zinc-700 ring-zinc-200",
    dotClassName: "bg-zinc-500",
  },
  "Interação da IA": {
    icon: Bot,
    className: "bg-violet-50 dark:bg-violet-500/12 text-violet-700 ring-violet-100 dark:ring-violet-500/25",
    dotClassName: "bg-violet-500",
  },
};

const statusStyles: Record<TimelineEventStatus, string> = {
  Realizado: "bg-indigo-50 dark:bg-indigo-500/12 text-indigo-700 dark:text-indigo-300 ring-indigo-100 dark:ring-indigo-500/25",
  Enviado: "bg-emerald-50 dark:bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 ring-emerald-100 dark:ring-emerald-500/25",
  Prometido: "bg-teal-50 dark:bg-teal-500/12 text-teal-700 dark:text-teal-300 ring-teal-100 dark:ring-teal-500/25",
  Gerado: "bg-[#A07C3B]/8 text-[#7A5E2C] dark:text-[#d9b877] ring-[#A07C3B]/15",
  Quebrado: "bg-rose-50 dark:bg-rose-500/12 text-rose-700 dark:text-rose-300 ring-rose-100 dark:ring-rose-500/25",
  Atualizado: "bg-cyan-50 text-cyan-700 ring-cyan-100",
  Registrado: "bg-subtle text-ink-soft ring-line",
  Elevado: "bg-amber-50 dark:bg-amber-500/12 text-amber-700 dark:text-amber-300 ring-amber-100 dark:ring-amber-500/25",
  "Jurídico": "bg-zinc-100 text-zinc-700 ring-zinc-200",
  IA: "bg-violet-50 dark:bg-violet-500/12 text-violet-700 ring-violet-100 dark:ring-violet-500/25",
};

const manualEventTypes: TimelineEventType[] = [
  "WhatsApp enviado",
  "Ligação realizada",
  "Promessa de pagamento",
  "Acordo gerado",
  "Boleto C2X",
  "Observação operacional",
  "Acionamento jurídico",
];

const eventStatusByType: Record<TimelineEventType, TimelineEventStatus> = {
  "Acordo gerado": "Gerado",
  "Acionamento jurídico": "Jurídico",
  "Alteração de risco": "Elevado",
  "Atualização cadastral": "Atualizado",
  "Boleto C2X": "Enviado",
  "Interação da IA": "IA",
  "Ligação realizada": "Realizado",
  "Observação operacional": "Registrado",
  "Promessa de pagamento": "Prometido",
  "Quebra de acordo": "Quebrado",
  "WhatsApp enviado": "Enviado",
};

export function OperationalTimeline({
  client,
  defaultUnit,
  events,
  onCreateEvent,
}: OperationalTimelineProps) {
  const { hubUser } = useAuth();
  const [drawerType, setDrawerType] = useState<TimelineEventType | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [filterSearch, setFilterSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterDate, setFilterDate] = useState("");
  const currentOperator = operatorFromLogin(hubUser?.name, client?.responsavel);
  const availableTypes = [
    ...new Set((events ?? []).map((event) => event?.type).filter(Boolean)),
  ];
  const filteredEvents = filterTimelineEvents(events, {
    date: filterDate,
    search: filterSearch,
    type: filterType,
  });
  const groupedEvents = groupTimelineByDay(filteredEvents);
  const hasFilter = Boolean(filterSearch || filterType !== "all" || filterDate);

  async function handleCreate(input: {
    attachments?: QueueClient["timeline"][number]["attachments"];
    description: string;
    occurredAt: string;
    operator: string;
    title: string;
    type: TimelineEventType;
    unitId: string;
  }) {
    const unit =
      client?.carteira.unidades.find((item) => item.id === input.unitId) ??
      defaultUnit ??
      client?.carteira.unidades[0];
    const event = {
      actionType: "Registro manual",
      description: input.description,
      id: `${client?.id ?? "guardian"}-manual-${Date.now()}`,
      occurredAt: input.occurredAt || nowForInputDisplay(),
      operator: currentOperator,
      status: eventStatusByType[input.type],
      title: input.title,
      type: input.type,
      attachments: input.attachments ?? [],
      unitCode: unit?.matricula,
      unitLabel: unit?.unidadeLote,
    };

    if (!onCreateEvent) {
      return;
    }

    setFeedback(null);
    setSaving(true);

    try {
      await onCreateEvent(event);
      setDrawerType(null);
      setFeedback("Evento registrado na timeline operacional.");
    } catch (error) {
      console.error("[guardian-timeline] manual event save failed", error);
      setFeedback("Nao foi possivel salvar o evento agora.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <DetailSection title="Timeline operacional do cliente" icon={ClipboardList} accent>
      <div className="mb-3 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold tracking-normal text-ink-muted">
            {filteredEvents.length === events.length
              ? `${events.length} eventos`
              : `${filteredEvents.length} de ${events.length} eventos`}
          </p>
          <button
            type="button"
            onClick={() => setDrawerType("Observação operacional")}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-[#A07C3B] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#8E6F35]"
          >
            <Plus className="size-4" aria-hidden="true" />
            Adicionar
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[160px] flex-1">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-muted"
              aria-hidden="true"
            />
            <input
              value={filterSearch}
              onChange={(event) => setFilterSearch(event.target.value)}
              placeholder="Buscar protocolo, texto…"
              className="h-8 w-full rounded-lg border border-line bg-surface pl-8 pr-2.5 text-xs text-ink outline-none focus:border-[#A07C3B]/40 focus:ring-2 focus:ring-[#A07C3B]/10"
            />
          </div>
          <select
            value={filterType}
            onChange={(event) => setFilterType(event.target.value)}
            className="h-8 rounded-lg border border-line bg-surface px-2.5 text-xs font-semibold text-ink outline-none focus:border-[#A07C3B]/40"
          >
            <option value="all">Todas as atividades</option>
            {availableTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={filterDate}
            onChange={(event) => setFilterDate(event.target.value)}
            className="h-8 rounded-lg border border-line bg-surface px-2.5 text-xs text-ink outline-none focus:border-[#A07C3B]/40"
          />
          {hasFilter ? (
            <button
              type="button"
              onClick={() => {
                setFilterSearch("");
                setFilterType("all");
                setFilterDate("");
              }}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-line bg-surface px-2.5 text-xs font-semibold text-ink-muted transition-colors hover:bg-subtle"
            >
              <X className="size-3.5" aria-hidden="true" />
              Limpar
            </button>
          ) : null}
        </div>
      </div>

      {feedback ? (
        <div className="mb-3 rounded-lg border border-[#A07C3B]/15 bg-[#A07C3B]/5 px-3 py-2 text-xs font-semibold text-[#7A5E2C] dark:text-[#d9b877]">
          {feedback}
        </div>
      ) : null}

      <div className="max-h-[640px] overflow-y-auto pr-2 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-subtle [&::-webkit-scrollbar-track]:bg-transparent">
        <div className="space-y-4">
          {groupedEvents.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line bg-subtle/60 px-3 py-6 text-center text-xs text-ink-muted">
              {hasFilter
                ? "Nenhum evento para esse filtro."
                : "Sem eventos na timeline."}
            </p>
          ) : null}
          {groupedEvents.map((group) => (
            <div key={group.key}>
              <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-normal text-ink-muted">
                {group.label}
                <span className="h-px flex-1 bg-subtle" />
              </p>
              <div className="relative space-y-2 before:absolute before:left-[16px] before:top-2 before:bottom-2 before:w-px before:bg-subtle">
                {group.events.map((event) => {
                  const visual =
                    eventVisuals[event.type] ?? eventVisuals["Observação operacional"];
                  const Icon = visual.icon;
                  const origin = originForEvent(event);

                  return (
                    <article key={event.id} className="relative flex gap-3">
                      <span
                        className={`relative z-10 mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg ring-1 ${visual.className}`}
                      >
                        <Icon className="size-4" aria-hidden="true" />
                      </span>

                      <div className="min-w-0 flex-1 rounded-xl border border-line/70 bg-surface p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-[0_4px_16px_rgba(0,0,0,0.45)] transition-colors hover:border-line">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-semibold text-ink">{event.title}</p>
                              <span className="rounded-full bg-subtle px-2 py-0.5 text-[11px] font-semibold text-ink-muted ring-1 ring-line">
                                {event.type}
                              </span>
                            </div>

                            {event.description ? (
                              <p className="mt-1 text-xs leading-5 text-ink-muted [overflow-wrap:anywhere]">
                                {event.description}
                              </p>
                            ) : null}
                            {event.protocol || event.unitCode ? (
                              <div className="mt-2 flex flex-wrap gap-2">
                                {event.protocol ? (
                                  <span className="rounded-full bg-[#A07C3B]/5 px-2 py-0.5 text-[11px] font-semibold text-[#7A5E2C] dark:text-[#d9b877] ring-1 ring-[#A07C3B]/15">
                                    {event.protocol}
                                  </span>
                                ) : null}
                                {event.unitCode ? (
                                  <span className="rounded-full bg-subtle px-2 py-0.5 text-[11px] font-semibold text-ink-muted ring-1 ring-line">
                                    Unidade {event.unitCode}
                                  </span>
                                ) : null}
                              </div>
                            ) : null}
                            {event.attachments?.length ? (
                              <EventAttachments attachments={event.attachments} />
                            ) : null}
                          </div>

                          <span
                            className={`w-fit shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${
                              statusStyles[event.status]
                            }`}
                          >
                            {event.status}
                          </span>
                        </div>

                        <div className="mt-2 flex flex-col gap-1 border-t border-line pt-2 text-xs text-ink-muted sm:flex-row sm:items-center sm:justify-between">
                          <span className="inline-flex flex-wrap items-center gap-1.5">
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                                origin === "auto"
                                  ? "bg-[#A07C3B]/10 text-[#7A5E2C] dark:text-[#d9b877]"
                                  : "bg-subtle text-ink-soft"
                              }`}
                            >
                              {origin === "auto" ? (
                                <Bot className="size-3" aria-hidden="true" />
                              ) : (
                                <User className="size-3" aria-hidden="true" />
                              )}
                              {origin === "auto" ? "Auto · Hades" : "Manual · operador"}
                            </span>
                            <span className="font-medium text-ink-soft">{event.operator}</span>
                          </span>
                          <time dateTime={event.occurredAt}>{event.occurredAt}</time>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {drawerType ? (
        <ManualTimelineDrawer
          client={client}
          defaultType={drawerType}
          defaultUnit={defaultUnit}
          operator={currentOperator}
          onClose={() => setDrawerType(null)}
          onSave={handleCreate}
          saving={saving}
        />
      ) : null}
    </DetailSection>
  );
}

function ManualTimelineDrawer({
  client,
  defaultType,
  defaultUnit,
  operator,
  onClose,
  onSave,
  saving,
}: {
  client?: QueueClient;
  defaultType: TimelineEventType;
  defaultUnit?: QueueClient["carteira"]["unidades"][number];
  operator: string;
  onClose: () => void;
  onSave: (input: {
    attachments?: QueueClient["timeline"][number]["attachments"];
    description: string;
    occurredAt: string;
    operator: string;
    title: string;
    type: TimelineEventType;
    unitId: string;
  }) => void;
  saving: boolean;
}) {
  const units = client?.carteira.unidades ?? [];
  const [draft, setDraft] = useState({
    attachments: [],
    description: "",
    occurredAt: nowForInputDisplay(),
    operator,
    title: titleForType(defaultType),
    type: defaultType,
    unitId: defaultUnit?.id ?? units[0]?.id ?? "",
  });
  const [attachmentFeedback, setAttachmentFeedback] = useState<string | null>(null);

  async function handleAttachmentSelection(fileList: FileList | null) {
    const files = Array.from(fileList ?? []);

    if (!files.length) {
      return;
    }

    const remainingSlots = MAX_EVENT_ATTACHMENTS - draft.attachments.length;

    if (remainingSlots <= 0) {
      setAttachmentFeedback(`Limite de ${MAX_EVENT_ATTACHMENTS} anexos por evento.`);
      return;
    }

    const selected = files.slice(0, remainingSlots);
    const accepted = selected.filter((file) => file.size <= MAX_EVENT_ATTACHMENT_BYTES);
    const skippedBySize = selected.length - accepted.length;

    try {
      const attachments = await Promise.all(
        accepted.map((file) => fileToTimelineAttachment(file)),
      );

      setDraft((current) => ({
        ...current,
        attachments: [...current.attachments, ...attachments].slice(
          0,
          MAX_EVENT_ATTACHMENTS,
        ),
      }));

      if (files.length > remainingSlots) {
        setAttachmentFeedback(`Apenas ${remainingSlots} anexo(s) foram adicionados neste evento.`);
      } else if (skippedBySize > 0) {
        setAttachmentFeedback("Arquivo acima de 8 MB nao foi anexado.");
      } else {
        setAttachmentFeedback(null);
      }
    } catch (error) {
      console.error("[guardian-timeline] attachment read failed", error);
      setAttachmentFeedback("Nao foi possivel ler o anexo selecionado.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Fechar registro operacional"
        onClick={onClose}
        className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
      />
      <div className="relative z-10 flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_24px_80px_rgba(15,23,42,0.28)]">
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-lg bg-[#A07C3B]/10 text-[#7A5E2C] dark:text-[#d9b877]">
              <ClipboardList className="size-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-ink">
                Registrar atividade
              </h2>
              <p className="text-xs text-ink-muted">
                {client?.nome ?? "Cliente selecionado"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex size-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-subtle hover:text-ink"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-ink-muted">Tipo</span>
            <select
              value={draft.type}
              onChange={(event) => {
                const type = event.target.value as TimelineEventType;
                setDraft((current) => ({
                  ...current,
                  title: titleForType(type),
                  type,
                }));
              }}
              className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm font-semibold text-ink outline-none focus:border-[#A07C3B]/40 focus:ring-2 focus:ring-[#A07C3B]/10"
            >
              {manualEventTypes.map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-ink-muted">Unidade</span>
            <select
              value={draft.unitId}
              onChange={(event) => setDraft((current) => ({ ...current, unitId: event.target.value }))}
              className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm font-semibold text-ink outline-none focus:border-[#A07C3B]/40 focus:ring-2 focus:ring-[#A07C3B]/10"
            >
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.matricula} · {unit.empreendimento}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-ink-muted">Titulo</span>
            <input
              value={draft.title}
              onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
              className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm font-semibold text-ink outline-none focus:border-[#A07C3B]/40 focus:ring-2 focus:ring-[#A07C3B]/10"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-ink-muted">Data e hora</span>
            <input
              value={draft.occurredAt}
              onChange={(event) => setDraft((current) => ({ ...current, occurredAt: event.target.value }))}
              className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm font-semibold text-ink outline-none focus:border-[#A07C3B]/40 focus:ring-2 focus:ring-[#A07C3B]/10"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-ink-muted">Operador</span>
            <input
              value={draft.operator}
              readOnly
              className="h-10 w-full rounded-lg border border-line bg-subtle px-3 text-sm font-semibold text-ink outline-none"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-ink-muted">Registro</span>
            <textarea
              value={draft.description}
              onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
              placeholder="Descreva o contato, cobrança, retorno, observação ou encaminhamento."
              className="min-h-32 w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm leading-6 text-ink outline-none focus:border-[#A07C3B]/40 focus:ring-2 focus:ring-[#A07C3B]/10"
            />
          </label>

          <div className="rounded-xl border border-line bg-subtle/60 p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-semibold text-ink">Anexos do evento</p>
                <p className="mt-0.5 text-[11px] text-ink-muted">
                  Print, arquivo ou audio de ate 8 MB.
                </p>
              </div>
              <label className="inline-flex h-8 cursor-pointer items-center justify-center gap-2 rounded-lg border border-line bg-surface px-3 text-xs font-semibold text-ink transition-colors hover:border-[#A07C3B]/30 hover:bg-[#A07C3B]/5">
                <Paperclip className="size-3.5 text-[#A07C3B]" aria-hidden="true" />
                Anexar
                <input
                  type="file"
                  multiple
                  accept={ACCEPTED_EVENT_ATTACHMENTS}
                  className="sr-only"
                  onChange={(event) => {
                    void handleAttachmentSelection(event.target.files);
                    event.target.value = "";
                  }}
                />
              </label>
            </div>

            {attachmentFeedback ? (
              <p className="mt-2 text-xs font-semibold text-amber-700 dark:text-amber-300">
                {attachmentFeedback}
              </p>
            ) : null}

            {draft.attachments.length ? (
              <ul className="mt-3 space-y-2">
                {draft.attachments.map((attachment) => (
                  <li
                    key={attachment.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-ink">
                        {attachment.fileName}
                      </p>
                      <p className="text-[11px] text-ink-muted">
                        {attachment.type === "audio" ? "Audio" : attachment.type === "image" ? "Imagem" : "Arquivo"} · {formatBytes(attachment.sizeBytes)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          attachments: current.attachments.filter(
                            (item) => item.id !== attachment.id,
                          ),
                        }))
                      }
                      aria-label={`Remover anexo ${attachment.fileName}`}
                      className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-rose-50 dark:bg-rose-500/12 hover:text-rose-700 dark:text-rose-300"
                    >
                      <X className="size-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <button
            type="button"
            disabled={saving || !draft.title.trim() || !draft.description.trim()}
            onClick={() => onSave(draft)}
            className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-[#A07C3B] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#8E6F35] disabled:cursor-not-allowed disabled:bg-subtle"
          >
            {saving ? "Salvando..." : "Salvar registro"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EventAttachments({
  attachments,
}: {
  attachments: QueueClient["timeline"][number]["attachments"];
}) {
  if (!attachments?.length) {
    return null;
  }

  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className="min-w-0 overflow-hidden rounded-lg border border-line bg-subtle/80 p-2"
        >
          <div className="mb-2 flex items-center gap-2">
            <Paperclip className="size-3.5 shrink-0 text-[#A07C3B]" aria-hidden="true" />
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-ink">
                {attachment.fileName}
              </p>
              <p className="text-[11px] text-ink-muted">
                {formatBytes(attachment.sizeBytes)}
              </p>
            </div>
          </div>

          {attachment.type === "image" && attachment.dataUrl ? (
            <a
              href={attachment.dataUrl}
              download={attachment.fileName}
              className="block overflow-hidden rounded-md border border-line bg-surface"
            >
              <img
                src={attachment.dataUrl}
                alt={attachment.fileName}
                className="h-24 w-full object-cover"
              />
            </a>
          ) : null}

          {attachment.type === "audio" && attachment.dataUrl ? (
            <audio
              controls
              preload="none"
              src={attachment.dataUrl}
              className="h-9 w-full"
            />
          ) : null}

          {attachment.type === "file" && attachment.dataUrl ? (
            <a
              href={attachment.dataUrl}
              download={attachment.fileName}
              className="inline-flex h-8 w-full items-center justify-center rounded-md border border-line bg-surface px-2 text-xs font-semibold text-ink transition-colors hover:border-[#A07C3B]/30 hover:bg-[#A07C3B]/5"
            >
              Abrir arquivo
            </a>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function fileToTimelineAttachment(file: File) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      resolve({
        capturedAt: new Date().toISOString(),
        dataUrl: typeof reader.result === "string" ? reader.result : "",
        fileName: file.name,
        id: `guardian-attachment-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        type: attachmentTypeFor(file),
      });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function attachmentTypeFor(file: File) {
  if (file.type.startsWith("image/")) {
    return "image";
  }

  if (file.type.startsWith("audio/")) {
    return "audio";
  }

  return "file";
}

function operatorFromLogin(loginName: string | null | undefined, fallback?: string) {
  return formatOperatorDisplayName(
    firstFilled(loginName, fallback, "Operador Hades"),
  );
}

function firstFilled(...values: Array<string | null | undefined>) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim() ?? "";
}

function formatOperatorDisplayName(value: string) {
  const normalized = value.trim();

  if (!normalized || normalized.includes(" ")) {
    return normalized;
  }

  const localPart = normalized.includes("@")
    ? normalized.split("@")[0] ?? normalized
    : normalized;

  if (!/[._-]/.test(localPart)) {
    return normalized;
  }

  return localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function formatBytes(value: number | null | undefined) {
  const bytes = Number(value);

  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 KB";
  }

  if (bytes >= 1_000_000) {
    return `${(bytes / 1_000_000).toLocaleString("pt-BR", {
      maximumFractionDigits: 1,
    })} MB`;
  }

  return `${Math.ceil(bytes / 1_000).toLocaleString("pt-BR")} KB`;
}

function manualTypeForAction(label: string): TimelineEventType {
  if (label === "WhatsApp") return "WhatsApp enviado";
  if (label === "Ligação") return "Ligação realizada";
  if (label === "Acordo") return "Acordo gerado";
  if (label === "Boleto") return "Boleto C2X";

  return "Observação operacional";
}

function titleForType(type: TimelineEventType) {
  const titles: Record<TimelineEventType, string> = {
    "Acordo gerado": "Acordo registrado",
    "Acionamento jurídico": "Acionamento jurídico registrado",
    "Alteração de risco": "Risco operacional atualizado",
    "Atualização cadastral": "Cadastro atualizado",
    "Boleto C2X": "Boleto registrado",
    "Interação da IA": "Interação da Athena registrada",
    "Ligação realizada": "Ligação realizada",
    "Observação operacional": "Observação operacional",
    "Promessa de pagamento": "Promessa de pagamento registrada",
    "Quebra de acordo": "Quebra de acordo registrada",
    "WhatsApp enviado": "Contato por WhatsApp registrado",
  };

  return titles[type] ?? "Registro operacional";
}

function nowForInputDisplay() {
  return new Date().toLocaleString("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// occurredAt pode vir ISO ou no formato display "DD/MM/AAAA, HH:MM" — parse os dois.
function parseTimelineDate(value) {
  if (!value) {
    return Number.NaN;
  }
  const iso = Date.parse(value);
  if (!Number.isNaN(iso)) {
    return iso;
  }
  const match = String(value).match(
    /(\d{2})\/(\d{2})\/(\d{4})(?:[,\s]+(\d{2}):(\d{2}))?/,
  );
  if (match) {
    const [, dd, mm, yyyy, hh = "00", min = "00"] = match;
    return new Date(
      Number(yyyy),
      Number(mm) - 1,
      Number(dd),
      Number(hh),
      Number(min),
    ).getTime();
  }
  return Number.NaN;
}

function timelineDayLabel(time) {
  const day = new Date(time);
  day.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (diff === 0) {
    return "Hoje";
  }
  if (diff === 1) {
    return "Ontem";
  }
  return new Date(time).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

const AUTO_TIMELINE_TYPES = new Set([
  "Interação da IA",
  "Quebra de acordo",
  "Alteração de risco",
]);

function originForEvent(event) {
  const operator = String(event?.operator ?? "").toLowerCase();
  const auto =
    AUTO_TIMELINE_TYPES.has(event?.type) ||
    !event?.operator ||
    /hades|sistema|cron|autom|athena|cac[áa]|r[ée]gua/.test(operator);
  return auto ? "auto" : "manual";
}

function groupTimelineByDay(events) {
  const sorted = [...(events ?? [])].sort((first, second) => {
    const firstTime = parseTimelineDate(first?.occurredAt);
    const secondTime = parseTimelineDate(second?.occurredAt);
    if (Number.isNaN(firstTime) && Number.isNaN(secondTime)) {
      return 0;
    }
    if (Number.isNaN(firstTime)) {
      return 1;
    }
    if (Number.isNaN(secondTime)) {
      return -1;
    }
    return secondTime - firstTime;
  });

  const groups = [];
  for (const event of sorted) {
    const time = parseTimelineDate(event?.occurredAt);
    const hasTime = !Number.isNaN(time);
    const key = hasTime
      ? String(new Date(time).setHours(0, 0, 0, 0))
      : "sem-data";
    const label = hasTime ? timelineDayLabel(time) : "Sem data";
    let group = groups.find((item) => item.key === key);
    if (!group) {
      group = { events: [], key, label };
      groups.push(group);
    }
    group.events.push(event);
  }
  return groups;
}

// Filtro macro: texto (titulo/descricao/protocolo/tipo) + atividade (tipo) + dia.
function filterTimelineEvents(events, filters) {
  const search = String(filters?.search ?? "").trim().toLowerCase();
  const type = filters?.type ?? "all";
  const date = filters?.date ?? "";
  return [...(events ?? [])].filter((event) => {
    if (type !== "all" && event?.type !== type) {
      return false;
    }
    if (search) {
      const haystack = `${event?.title ?? ""} ${event?.description ?? ""} ${
        event?.protocol ?? ""
      } ${event?.type ?? ""}`.toLowerCase();
      if (!haystack.includes(search)) {
        return false;
      }
    }
    if (date) {
      const time = parseTimelineDate(event?.occurredAt);
      if (Number.isNaN(time)) {
        return false;
      }
      const day = new Date(time);
      const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(
        2,
        "0",
      )}-${String(day.getDate()).padStart(2, "0")}`;
      if (key !== date) {
        return false;
      }
    }
    return true;
  });
}




