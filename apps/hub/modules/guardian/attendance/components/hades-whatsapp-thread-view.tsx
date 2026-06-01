"use client";

import { Check, CheckCheck, FileText, Mic } from "lucide-react";
import { HadesWhatsAppDateSeparator } from "@/modules/guardian/attendance/components/hades-whatsapp-fields";
import type {
  MessageStatus,
  TicketCycle,
  WhatsAppMessage,
} from "@/modules/guardian/attendance/hades-whatsapp-thread";

export function HadesWhatsAppMessageBubble({
  message,
  showDate,
}: {
  message: WhatsAppMessage;
  showDate: boolean;
}) {
  const sent = message.author === "operator";

  return (
    <>
      {showDate ? <HadesWhatsAppDateSeparator label={message.date} /> : null}
      <div className={`flex ${sent ? "justify-end" : "justify-start"}`}>
        <div
          className={`max-w-[82%] rounded-2xl px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ring-1 ${
            sent ? "bg-[#A07C3B]/8 text-slate-900 ring-[#A07C3B]/15" : "bg-white text-slate-900 ring-slate-200/70"
          }`}
        >
          <HadesWhatsAppMessageContent message={message} />
          <div className="mt-2 flex items-center justify-end gap-1.5 text-[11px] text-slate-400">
            {message.operator ? <span>{message.operator}</span> : null}
            <span>{message.time}</span>
            {sent ? <HadesWhatsAppMessageStatusIcon status={message.status ?? "enviada"} /> : null}
          </div>
        </div>
      </div>
    </>
  );
}

export function HadesWhatsAppTicketSeparator({
  compact = false,
  cycle,
}: {
  compact?: boolean;
  cycle: TicketCycle;
}) {
  return (
    <div className={`relative ${compact ? "py-1" : "py-2"}`}>
      <div className="absolute left-0 right-0 top-1/2 h-px bg-slate-200/80" aria-hidden="true" />
      <div
        className={`relative mx-auto w-fit max-w-full border border-slate-200/70 bg-white text-center shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${
          compact ? "rounded-xl px-3 py-2" : "rounded-2xl px-4 py-3"
        }`}
      >
        <div className="flex flex-wrap items-center justify-center gap-2">
          <span className="rounded-full bg-[#A07C3B]/5 px-2.5 py-1 text-xs font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
            Ticket {cycle.protocol}
          </span>
          <span className="rounded-full bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
            {cycle.status}
          </span>
        </div>
        <p className={`${compact ? "mt-1 text-xs" : "mt-2 text-sm"} font-semibold text-slate-950`}>
          {cycle.profileName}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          {cycle.openedAt} · {cycle.operator}
          {cycle.unitCode ? ` · ${cycle.unitCode}` : ""}
        </p>
      </div>
    </div>
  );
}

function HadesWhatsAppMessageContent({ message }: { message: WhatsAppMessage }) {
  if (message.kind === "audio") {
    return (
      <div className="flex min-w-56 items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
          <Mic className="size-4" aria-hidden="true" />
        </div>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
          <div className="h-full w-2/3 rounded-full bg-[#A07C3B]" />
        </div>
        <span className="text-xs font-semibold text-slate-500">{message.duration}</span>
      </div>
    );
  }

  if (message.kind === "document") {
    return (
      <div className="flex min-w-64 items-center gap-3 rounded-xl border border-slate-200/70 bg-white/70 p-3">
        <FileText className="size-5 shrink-0 text-[#A07C3B]" aria-hidden="true" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-950">{message.fileName}</p>
          <p className="mt-0.5 text-xs text-slate-500">{message.body}</p>
        </div>
      </div>
    );
  }

  return <p className="text-sm leading-6">{message.body}</p>;
}

function HadesWhatsAppMessageStatusIcon({ status }: { status: MessageStatus }) {
  if (status === "lida") return <CheckCheck className="size-3.5 text-sky-500" aria-hidden="true" />;
  if (status === "entregue") return <CheckCheck className="size-3.5 text-slate-400" aria-hidden="true" />;
  return <Check className="size-3.5 text-slate-400" aria-hidden="true" />;
}
