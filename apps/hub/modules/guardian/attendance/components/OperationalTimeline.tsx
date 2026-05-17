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
  PhoneCall,
  Plus,
  ReceiptText,
  Scale,
  ShieldAlert,
  UserRoundPen,
} from "lucide-react";
import { Tooltip } from "@repo/uix";
import { DetailSection } from "@/modules/guardian/attendance/components/DetailSection";
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
    className: "bg-indigo-50 text-indigo-700 ring-indigo-100",
    dotClassName: "bg-indigo-500",
  },
  "WhatsApp enviado": {
    icon: MessageCircle,
    className: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    dotClassName: "bg-emerald-500",
  },
  "Promessa de pagamento": {
    icon: CalendarCheck,
    className: "bg-teal-50 text-teal-700 ring-teal-100",
    dotClassName: "bg-teal-500",
  },
  "Acordo gerado": {
    icon: Handshake,
    className: "bg-[#A07C3B]/8 text-[#7A5E2C] ring-[#A07C3B]/15",
    dotClassName: "bg-[#A07C3B]",
  },
  "Quebra de acordo": {
    icon: AlertTriangle,
    className: "bg-rose-50 text-rose-700 ring-rose-100",
    dotClassName: "bg-rose-500",
  },
  "Boleto C2X": {
    icon: ReceiptText,
    className: "bg-sky-50 text-sky-700 ring-sky-100",
    dotClassName: "bg-sky-500",
  },
  "Atualização cadastral": {
    icon: UserRoundPen,
    className: "bg-cyan-50 text-cyan-700 ring-cyan-100",
    dotClassName: "bg-cyan-500",
  },
  "Observação operacional": {
    icon: ClipboardList,
    className: "bg-slate-50 text-slate-600 ring-slate-200",
    dotClassName: "bg-slate-400",
  },
  "Alteração de risco": {
    icon: ShieldAlert,
    className: "bg-amber-50 text-amber-700 ring-amber-100",
    dotClassName: "bg-amber-500",
  },
  "Acionamento jurídico": {
    icon: Scale,
    className: "bg-zinc-100 text-zinc-700 ring-zinc-200",
    dotClassName: "bg-zinc-500",
  },
  "Interação da IA": {
    icon: Bot,
    className: "bg-violet-50 text-violet-700 ring-violet-100",
    dotClassName: "bg-violet-500",
  },
};

const statusStyles: Record<TimelineEventStatus, string> = {
  Realizado: "bg-indigo-50 text-indigo-700 ring-indigo-100",
  Enviado: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  Prometido: "bg-teal-50 text-teal-700 ring-teal-100",
  Gerado: "bg-[#A07C3B]/8 text-[#7A5E2C] ring-[#A07C3B]/15",
  Quebrado: "bg-rose-50 text-rose-700 ring-rose-100",
  Atualizado: "bg-cyan-50 text-cyan-700 ring-cyan-100",
  Registrado: "bg-slate-50 text-slate-600 ring-slate-200",
  Elevado: "bg-amber-50 text-amber-700 ring-amber-100",
  "Jurídico": "bg-zinc-100 text-zinc-700 ring-zinc-200",
  IA: "bg-violet-50 text-violet-700 ring-violet-100",
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
  const [drawerType, setDrawerType] = useState<TimelineEventType | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleCreate(input: {
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
      operator: input.operator || client?.responsavel || "Operador Guardian",
      status: eventStatusByType[input.type],
      title: input.title,
      type: input.type,
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
      <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="hidden text-sm font-medium text-slate-700">
            Histórico cronológico completo
          </p>
          <p className="text-xs font-semibold uppercase tracking-normal text-slate-400">
            {events.length} eventos
          </p>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 lg:pb-0">
          {actionItems.map((action) => {
            const Icon = action.icon;
            const type = manualTypeForAction(action.label);

            return (
              <button
                key={action.label}
                type="button"
                onClick={() => setDrawerType(type)}
                className="inline-flex h-8 shrink-0 items-center gap-2 rounded-lg border border-slate-200/70 bg-white px-2.5 text-xs font-semibold text-slate-700 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-slate-950"
              >
                <Icon className="size-3.5 text-[#A07C3B]" aria-hidden="true" />
                {action.label}
              </button>
            );
          })}
        </div>
      </div>

      {feedback ? (
        <div className="mb-3 rounded-lg border border-[#A07C3B]/15 bg-[#A07C3B]/5 px-3 py-2 text-xs font-semibold text-[#7A5E2C]">
          {feedback}
        </div>
      ) : null}

      <div className="max-h-[640px] overflow-y-auto pr-2 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-track]:bg-transparent">
        <div className="relative space-y-3 before:absolute before:left-[18px] before:top-2 before:h-[calc(100%-1rem)] before:w-px before:bg-slate-200">
          {events.map((event) => {
            const visual = eventVisuals[event.type];
            const Icon = visual.icon;

            return (
              <article key={event.id} className="relative grid grid-cols-[38px_minmax(0,1fr)] gap-3">
                <div className="relative z-10 flex justify-center pt-3">
                  <div className="flex size-8 items-center justify-center rounded-lg bg-white ring-1 ring-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.06)]">
                    <span className={`size-2 rounded-full ${visual.dotClassName}`} />
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200/70 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-slate-300">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex size-7 items-center justify-center rounded-lg ring-1 ${visual.className}`}
                        >
                          <Icon className="size-3.5" aria-hidden="true" />
                        </span>
                        <p className="text-sm font-semibold text-slate-950">{event.title}</p>
                        <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-500 ring-1 ring-slate-200">
                          {event.type}
                        </span>
                      </div>

                      <Tooltip content={event.description} placement="bottom">
                        <span className="mt-1 line-clamp-1 text-xs leading-5 text-slate-500">{event.description}</span>
                      </Tooltip>
                      {event.protocol || event.unitCode ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {event.protocol ? (
                            <span className="rounded-full bg-[#A07C3B]/5 px-2 py-0.5 text-[11px] font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
                              {event.protocol}
                            </span>
                          ) : null}
                          {event.unitCode ? (
                            <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-500 ring-1 ring-slate-200">
                              Unidade {event.unitCode}
                            </span>
                          ) : null}
                          {event.actionType ? (
                            <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-500 ring-1 ring-slate-200">
                              {event.actionType}
                            </span>
                          ) : null}
                        </div>
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

                  <div className="mt-2 flex flex-col gap-1 border-t border-slate-100 pt-2 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
                    <span className="font-medium text-slate-600">{event.operator}</span>
                    <time dateTime={event.occurredAt}>{event.occurredAt}</time>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        onClick={() => setDrawerType("Observação operacional")}
        className="mt-3 inline-flex h-8 items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-3 text-xs font-semibold text-slate-600 transition-colors hover:border-[#A07C3B]/30 hover:bg-[#A07C3B]/5 hover:text-slate-950"
      >
        <Plus className="size-4 text-[#A07C3B]" aria-hidden="true" />
        Adicionar evento operacional
      </button>

      {drawerType ? (
        <ManualTimelineDrawer
          client={client}
          defaultType={drawerType}
          defaultUnit={defaultUnit}
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
  onClose,
  onSave,
  saving,
}: {
  client?: QueueClient;
  defaultType: TimelineEventType;
  defaultUnit?: QueueClient["carteira"]["unidades"][number];
  onClose: () => void;
  onSave: (input: {
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
    description: "",
    occurredAt: nowForInputDisplay(),
    operator: client?.responsavel ?? "Operador Guardian",
    title: titleForType(defaultType),
    type: defaultType,
    unitId: defaultUnit?.id ?? units[0]?.id ?? "",
  });

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Fechar registro operacional"
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/25 backdrop-blur-[2px]"
      />
      <aside className="relative z-10 flex h-full w-full max-w-lg flex-col border-l border-slate-200/70 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)]">
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">
              Guardian manual
            </p>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">
              Registrar atividade
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {client?.nome ?? "Cliente selecionado"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar drawer"
            className="flex size-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
          >
            x
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-500">Tipo</span>
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
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none focus:border-[#A07C3B]/40 focus:ring-2 focus:ring-[#A07C3B]/10"
            >
              {manualEventTypes.map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-500">Unidade</span>
            <select
              value={draft.unitId}
              onChange={(event) => setDraft((current) => ({ ...current, unitId: event.target.value }))}
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none focus:border-[#A07C3B]/40 focus:ring-2 focus:ring-[#A07C3B]/10"
            >
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.matricula} · {unit.empreendimento}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-500">Titulo</span>
            <input
              value={draft.title}
              onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-[#A07C3B]/40 focus:ring-2 focus:ring-[#A07C3B]/10"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-500">Data e hora</span>
            <input
              value={draft.occurredAt}
              onChange={(event) => setDraft((current) => ({ ...current, occurredAt: event.target.value }))}
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-[#A07C3B]/40 focus:ring-2 focus:ring-[#A07C3B]/10"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-500">Operador</span>
            <input
              value={draft.operator}
              onChange={(event) => setDraft((current) => ({ ...current, operator: event.target.value }))}
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-[#A07C3B]/40 focus:ring-2 focus:ring-[#A07C3B]/10"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-500">Registro</span>
            <textarea
              value={draft.description}
              onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
              placeholder="Descreva o contato, cobrança, retorno, observação ou encaminhamento."
              className="min-h-32 w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-800 outline-none focus:border-[#A07C3B]/40 focus:ring-2 focus:ring-[#A07C3B]/10"
            />
          </label>

          <button
            type="button"
            disabled={saving || !draft.title.trim() || !draft.description.trim()}
            onClick={() => onSave(draft)}
            className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-[#A07C3B] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#8E6F35] disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {saving ? "Salvando..." : "Salvar registro"}
          </button>
        </div>
      </aside>
    </div>
  );
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
    "Interação da IA": "Interação da Cacá registrada",
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




