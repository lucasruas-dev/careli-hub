"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Clock, Inbox, Loader2, RefreshCw } from "lucide-react";

import type { IrisTicket } from "@/modules/caredesk/types/iris-types";
import { MobileListScreen } from "@/modules/mobile/components/mobile-list-screen";
import {
  IrisProfileChip,
  MobileAvatar,
  MobileEmptyState,
  UnreadBadge,
} from "@/modules/mobile/components/mobile-ui";
import { useIrisMobile } from "@/modules/mobile/components/iris-mobile-provider";
import { readIrisProfileChip } from "@/modules/mobile/lib/iris-profile";
import {
  getIrisWaitingSince,
  groupIrisTicketsBySection,
} from "@/modules/mobile/lib/iris-sections";
import {
  formatRelativeTime,
  formatWaitingDuration,
} from "@/modules/mobile/lib/format";

export default function MobileIrisListPage() {
  const { error, refresh, status, tickets } = useIrisMobile();

  const sections = useMemo(
    () => groupIrisTicketsBySection(tickets),
    [tickets],
  );

  return (
    <MobileListScreen
      subheader={
        <div className="flex items-center gap-2 border-b border-[#e4e9f0] bg-white px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="m-0 text-[13px] font-semibold text-[#101820]">
              Fila de atendimento
            </p>
            <p className="m-0 text-[11px] text-[#9aa6b5]">
              {tickets.length} conversas
            </p>
          </div>
          <button
            aria-label="Atualizar"
            className="grid h-8 w-8 place-items-center rounded-full border border-[#e4e9f0] text-[#526078] outline-none transition active:scale-90"
            onClick={refresh}
            type="button"
          >
            <RefreshCw
              aria-hidden="true"
              className={status === "loading" ? "animate-spin" : undefined}
              size={15}
            />
          </button>
        </div>
      }
    >
      {status === "loading" && tickets.length === 0 ? (
        <div className="grid place-items-center py-16 text-[#6b778c]">
          <Loader2 aria-hidden="true" className="animate-spin" size={24} />
        </div>
      ) : status === "error" ? (
        <div className="grid place-items-center gap-3 px-8 py-16 text-center">
          <p className="m-0 text-sm text-[#c0392b]">{error}</p>
          <button
            className="rounded-full border border-[#e4e9f0] px-4 py-2 text-xs font-semibold text-[#526078]"
            onClick={refresh}
            type="button"
          >
            Tentar de novo
          </button>
        </div>
      ) : sections.length === 0 ? (
        <MobileEmptyState
          description="Novos atendimentos do WhatsApp aparecem aqui."
          icon={<Inbox aria-hidden="true" size={22} />}
          title="Nenhum atendimento aberto"
        />
      ) : (
        sections.map((section) => (
          <section key={section.key}>
            <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-[#e0e5ec] bg-[#eceff3] px-3 py-2 text-xs font-medium text-[#3a4657]">
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: section.accent }}
              />
              {section.label}
              <span className="ml-auto font-normal text-[#9aa6b5]">
                {section.tickets.length}
              </span>
            </div>
            {section.tickets.map((ticket) => (
              <IrisTicketRow key={ticket.id} ticket={ticket} />
            ))}
          </section>
        ))
      )}
    </MobileListScreen>
  );
}

function IrisTicketRow({ ticket }: { ticket: IrisTicket }) {
  const profile = readIrisProfileChip(ticket.crm360Registration);
  const waitingSince = getIrisWaitingSince(ticket);

  return (
    <Link
      className="flex items-center gap-3 border-b border-[#eef1f5] bg-white px-3 py-3 outline-none transition active:scale-[0.99]"
      href={`/m/iris/${encodeURIComponent(ticket.id)}`}
    >
      <MobileAvatar label={ticket.contactLabel} url={ticket.contactAvatarUrl} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span
            className={`min-w-0 flex-1 truncate text-sm ${
              ticket.unread
                ? "font-semibold text-[#101820]"
                : "font-medium text-[#26313f]"
            }`}
          >
            {ticket.contactLabel}
          </span>
          <span className="shrink-0 text-[0.7rem] text-[#9aa6b5]">
            {formatRelativeTime(ticket.lastMessageAt ?? ticket.openedAt)}
          </span>
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span
            className={`min-w-0 flex-1 truncate text-xs ${
              ticket.unread ? "text-[#3a4657]" : "text-[#6b778c]"
            }`}
          >
            {ticket.lastMessagePreview || ticket.subject}
          </span>
          <UnreadBadge count={ticket.unreadCount ?? 0} />
        </span>
        <span className="mt-1.5 flex flex-wrap gap-1.5">
          {waitingSince ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#f6ecd7] px-2 py-0.5 text-[0.64rem] font-semibold text-[#8a6d1f]">
              <Clock aria-hidden="true" size={11} />
              {formatWaitingDuration(waitingSince)} sem resposta
            </span>
          ) : null}
          <span className="inline-flex items-center rounded-full bg-[#eef1f5] px-2 py-0.5 text-[0.64rem] font-medium text-[#526078]">
            {ticket.queueLabel}
          </span>
          <IrisProfileChip crm={profile} />
        </span>
      </span>
    </Link>
  );
}
