/* eslint-disable */
// @ts-nocheck
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
import { DetailSection } from "@/modules/guardian/attendance/components/DetailSection";
import type {
  TimelineEventStatus,
  TimelineEventType,
  QueueClient,
} from "@/modules/guardian/attendance/types";

type OperationalTimelineProps = {
  events: QueueClient["timeline"];
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

export function OperationalTimeline({ events }: OperationalTimelineProps) {
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

            return (
              <button
                key={action.label}
                type="button"
                className="inline-flex h-8 shrink-0 items-center gap-2 rounded-lg border border-slate-200/70 bg-white px-2.5 text-xs font-semibold text-slate-700 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-slate-950"
              >
                <Icon className="size-3.5 text-[#A07C3B]" aria-hidden="true" />
                {action.label}
              </button>
            );
          })}
        </div>
      </div>

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

                <div title={event.description} className="rounded-xl border border-slate-200/70 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-slate-300">
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

                      <p className="mt-1 line-clamp-1 text-xs leading-5 text-slate-500">{event.description}</p>
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
        className="mt-3 inline-flex h-8 items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-3 text-xs font-semibold text-slate-600 transition-colors hover:border-[#A07C3B]/30 hover:bg-[#A07C3B]/5 hover:text-slate-950"
      >
        <Plus className="size-4 text-[#A07C3B]" aria-hidden="true" />
        Adicionar evento operacional
      </button>
    </DetailSection>
  );
}




