"use client";

import type { ReactNode, RefObject } from "react";
import {
  Clock3,
  MessageCircle,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon,
} from "lucide-react";
import { Tooltip } from "@repo/uix";

import {
  type IrisBoardTicket,
  type IrisBoardTicketPriority,
} from "../board/iris-ticket-queue";
import { EmptyState } from "../shared/iris-ui";

export type IrisConversationMessage = {
  id: string;
};

export type IrisConversationCrm360Registration = {
  documentMasked?: string | null;
  status?: string | null;
};

export type IrisConversationTicket = IrisBoardTicket & {
  contactDocument?: string | null;
  contactEmail?: string | null;
  contactId?: string | null;
  contactPhone?: string | null;
  crm360Registration?: IrisConversationCrm360Registration | null;
  messages: IrisConversationMessage[];
};

export type IrisConversationContextNote = {
  text?: string | null;
  updatedAt?: string | null;
};

export type IrisConversationContextShortcut = {
  active?: boolean;
  disabled?: boolean;
  icon: LucideIcon;
  id?: string;
  label: string;
  onClick: () => void;
};

export type IrisConversationWaitState = {
  label: string;
  tone: "encerrado" | "espera" | "pendente";
};

export type IrisConversationReadOnlyHelpers = {
  conversationTime: (ticket: IrisConversationTicket) => string;
  conversationWaitAge: (ticket: IrisConversationTicket) => string;
  conversationWaitState: (
    ticket: IrisConversationTicket,
  ) => IrisConversationWaitState;
  crm360ContextLabel: (
    registration?: IrisConversationCrm360Registration | null,
  ) => string;
  formatDateTime: (value?: string | null) => string;
  formatIrisChannelLabel: (value: string) => string;
  priorityLabel: Record<IrisBoardTicketPriority, string>;
  slaLabel: (ticket: IrisConversationTicket) => string;
  ticketContactLabel: (ticket: IrisConversationTicket) => string;
};

export type IrisConversationReadOnlyRenderers = {
  renderContactAvatar: (
    ticket: IrisConversationTicket,
    size: "sm" | "md" | "lg",
  ) => ReactNode;
  renderMessageBubble: (input: {
    message: IrisConversationMessage;
    ticket: IrisConversationTicket;
  }) => ReactNode;
  renderTicketSeparator: (
    ticket: IrisConversationTicket,
    compact?: boolean,
  ) => ReactNode;
};

export function IrisConversationEmptyState() {
  return (
    <div className="flex h-full min-h-0 items-center justify-center rounded-2xl border border-[#dbe3ef] bg-white">
      <div className="text-center">
        <MessageCircle className="mx-auto h-8 w-8 text-[#A07C3B]" />
        <h3 className="mt-3 text-base font-semibold">Selecione um ticket</h3>
      </div>
    </div>
  );
}

export function IrisConversationInboxSidebar({
  collapsed,
  conversations,
  helpers,
  onCollapseChange,
  onSearchChange,
  onSelectTicket,
  renderers,
  search,
  selectedTicketId,
}: {
  cobrancaMode?: boolean;
  collapsed: boolean;
  conversations: IrisConversationTicket[];
  filter: string;
  helpers: IrisConversationReadOnlyHelpers;
  onCollapseChange: (collapsed: boolean) => void;
  onFilterChange: (filter: string) => void;
  onSearchChange: (search: string) => void;
  onSelectTicket: (ticketId: string) => void;
  renderers: IrisConversationReadOnlyRenderers;
  search: string;
  selectedTicketId: string;
}) {
  return (
    <aside
      className={[
        "hidden shrink-0 border-r border-slate-300/80 bg-white shadow-[4px_0_18px_rgba(15,23,42,0.05)] transition-all duration-300 lg:flex lg:flex-col",
        collapsed ? "w-14" : "w-72",
      ].join(" ")}
    >
      <div className={collapsed ? "p-2" : "border-b border-slate-100 p-3"}>
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => onCollapseChange(false)}
              className="flex size-9 items-center justify-center rounded-lg border border-slate-200/70 bg-white text-slate-500 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-[#7A5E2C]"
              aria-label="Expandir conversas"
              title="Expandir conversas"
            >
              <PanelLeftOpen className="size-4" aria-hidden="true" />
            </button>
            <div className="flex size-9 items-center justify-center rounded-lg bg-[#A07C3B]/5 text-[#A07C3B] ring-1 ring-[#A07C3B]/15">
              <MessageCircle className="size-4" aria-hidden="true" />
            </div>
            <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
              {conversations.length}
            </span>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-950">
                  Fila de atendimento
                </h2>
              </div>
              <button
                type="button"
                onClick={() => onCollapseChange(true)}
                className="flex size-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white hover:text-[#7A5E2C]"
                aria-label="Recolher conversas"
                title="Recolher conversas"
              >
                <PanelLeftClose className="size-4" aria-hidden="true" />
              </button>
            </div>
            <label className="mt-3 flex rounded-lg border border-slate-200/70 bg-white px-3 py-1.5">
              <span className="sr-only">Buscar conversa</span>
              <input
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="Buscar conversa..."
                className="h-7 w-full bg-transparent text-sm font-medium text-slate-700 outline-none placeholder:text-slate-400"
              />
            </label>
          </>
        )}
      </div>

      {!collapsed ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-2.5 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
          {conversations.length ? (
            conversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                onClick={() => onSelectTicket(conversation.id)}
                className={[
                  "mb-2 w-full rounded-lg border px-3 py-2.5 text-left transition-colors",
                  conversation.id === selectedTicketId
                    ? "border-[#A07C3B]/25 bg-[#A07C3B]/5"
                    : "border-slate-200/70 bg-white hover:bg-slate-50",
                ].join(" ")}
              >
                <div className="flex items-start gap-2.5">
                  {renderers.renderContactAvatar(conversation, "sm")}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 truncate text-sm font-semibold text-slate-950">
                        {helpers.ticketContactLabel(conversation)}
                      </p>
                      <span className="shrink-0 text-[11px] text-slate-400">
                        {helpers.conversationTime(conversation)}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-1 text-xs text-slate-500 [overflow-wrap:anywhere]">
                      {conversation.lastMessagePreview}
                    </p>
                    {(() => {
                      const waitState = helpers.conversationWaitState(conversation);
                      const waitAge = helpers.conversationWaitAge(conversation);
                      const toneClasses =
                        waitState.tone === "pendente"
                          ? "bg-[#A07C3B]/10 text-[#7A5E2C] ring-[#A07C3B]/25"
                          : waitState.tone === "espera"
                            ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                            : "bg-slate-100 text-slate-500 ring-slate-200";
                      const dotClass =
                        waitState.tone === "pendente"
                          ? "bg-[#A07C3B]"
                          : waitState.tone === "espera"
                            ? "bg-emerald-500"
                            : "bg-slate-400";

                      return (
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${toneClasses}`}
                          >
                            <span
                              className={`size-1.5 rounded-full ${dotClass}`}
                              aria-hidden="true"
                            />
                            {waitState.label}
                          </span>
                          {waitAge ? (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-slate-400">
                              <Clock3 className="size-3" aria-hidden="true" />
                              {waitAge}
                            </span>
                          ) : null}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </button>
            ))
          ) : (
            <div className="rounded-lg border border-slate-200/70 bg-white p-4 text-center text-xs font-semibold text-slate-400">
              Nenhuma conversa encontrada
            </div>
          )}
        </div>
      ) : null}
    </aside>
  );
}

export function IrisConversationMessagesTimeline({
  onTogglePreviousTickets,
  previousTickets,
  renderers,
  showPreviousTickets,
  ticket,
  viewportRef,
}: {
  onTogglePreviousTickets: () => void;
  previousTickets: IrisConversationTicket[];
  renderers: IrisConversationReadOnlyRenderers;
  showPreviousTickets: boolean;
  ticket: IrisConversationTicket;
  viewportRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={viewportRef}
      className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-slate-50/40 px-3 py-4 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin] sm:px-4"
    >
      <div className="w-full min-w-0 space-y-5">
        {previousTickets.length > 0 ? (
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={onTogglePreviousTickets}
              className="inline-flex h-9 items-center rounded-lg border border-slate-200/70 bg-white px-3 text-xs font-semibold text-slate-600 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-slate-950"
            >
              {showPreviousTickets
                ? "Ocultar tickets anteriores"
                : `Ver tickets anteriores (${previousTickets.length})`}
            </button>
          </div>
        ) : null}

        {showPreviousTickets ? (
          <div className="space-y-3">
            {previousTickets.slice(0, 5).map((previousTicket) => (
              <div key={previousTicket.id}>
                {renderers.renderTicketSeparator(previousTicket, true)}
              </div>
            ))}
          </div>
        ) : null}

        {renderers.renderTicketSeparator(ticket)}

        {ticket.messages.length > 0 ? (
          ticket.messages.map((message) => (
            <div key={message.id}>
              {renderers.renderMessageBubble({ message, ticket })}
            </div>
          ))
        ) : (
          <EmptyState
            icon={MessageCircle}
            title="Sem mensagens registradas"
            description="A conversa deste ticket ainda nao possui mensagens no Iris."
          />
        )}
      </div>
    </div>
  );
}

export function IrisConversationContextSidebar({
  contextShortcuts,
  customerServiceWindowContextLabel,
  helpers,
  previousTickets,
  renderers,
  ticket,
  ticketContextNote,
}: {
  contextShortcuts: IrisConversationContextShortcut[];
  customerServiceWindowContextLabel: string;
  helpers: IrisConversationReadOnlyHelpers;
  previousTickets: IrisConversationTicket[];
  renderers: IrisConversationReadOnlyRenderers;
  ticket: IrisConversationTicket;
  ticketContextNote?: IrisConversationContextNote | null;
}) {
  return (
    <aside className="hidden w-[330px] shrink-0 border-l border-slate-100 bg-white xl:block">
      <div className="border-b border-slate-100 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            {renderers.renderContactAvatar(ticket, "lg")}
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">
                Contexto
              </p>
              <h3 className="mt-1 truncate text-sm font-semibold text-slate-950">
                {helpers.ticketContactLabel(ticket)}
              </h3>
              <p className="mt-0.5 text-xs font-medium text-slate-500">
                {ticket.contactPhone ?? "Sem telefone"}
              </p>
            </div>
          </div>
          <MessageSquareText
            className="size-4 text-slate-300"
            aria-hidden="true"
          />
        </div>
        <div className="mt-3 grid grid-cols-4 gap-1 rounded-lg bg-slate-100/70 p-1">
          {contextShortcuts.map((shortcut) => (
            <Tooltip
              content={shortcut.label}
              key={shortcut.id ?? shortcut.label}
              placement="bottom"
            >
              <button
                type="button"
                onClick={shortcut.onClick}
                disabled={Boolean(shortcut.disabled)}
                className={[
                  "flex size-8 items-center justify-center rounded-md transition-colors",
                  shortcut.disabled
                    ? "cursor-not-allowed text-slate-300"
                    : shortcut.active
                      ? "bg-white text-[#7A5E2C]"
                      : "text-slate-500 hover:bg-white hover:text-[#7A5E2C]",
                ].join(" ")}
                aria-label={shortcut.label}
              >
                <shortcut.icon className="size-4" aria-hidden="true" />
              </button>
            </Tooltip>
          ))}
        </div>
      </div>

      <div className="min-h-0 space-y-2 overflow-y-auto p-3 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
        <div className="rounded-xl border border-slate-200/70 bg-slate-50/70 px-3 py-2.5">
          <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">
            Nota do operador
          </p>
          <p className="mt-1 text-sm font-medium text-slate-700 [overflow-wrap:anywhere]">
            {ticketContextNote?.text?.trim() ||
              "Sem nota registrada para este cliente."}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            {ticketContextNote?.updatedAt
              ? `Atualizada em ${helpers.formatDateTime(ticketContextNote.updatedAt)}`
              : "Use o primeiro icone para registrar observacoes do atendimento."}
          </p>
        </div>
        <ConversationContextItem
          label="Cliente"
          value={helpers.ticketContactLabel(ticket)}
        />
        <ConversationContextItem
          label="CRM 360"
          value={helpers.crm360ContextLabel(ticket.crm360Registration)}
        />
        <ConversationContextItem
          label="Telefone"
          value={ticket.contactPhone ?? "-"}
        />
        <ConversationContextItem
          label="Documento"
          value={
            ticket.crm360Registration?.status === "registered"
              ? (ticket.crm360Registration.documentMasked ??
                ticket.contactDocument ??
                "-")
              : (ticket.contactDocument ?? "-")
          }
        />
        <ConversationContextItem
          label="E-mail"
          value={ticket.contactEmail ?? "-"}
        />
        <ConversationContextItem label="Fila" value={ticket.queueLabel} />
        <ConversationContextItem
          label="Operador"
          value={ticket.assignedToLabel}
        />
        <ConversationContextItem label="Protocolo" value={ticket.protocol} />
        <ConversationContextItem label="Perfil" value={ticket.profileLabel} />
        <ConversationContextItem label="SLA" value={helpers.slaLabel(ticket)} />
        <ConversationContextItem
          label="Prioridade"
          value={helpers.priorityLabel[ticket.priority]}
        />
        <ConversationContextItem label="Origem" value={ticket.sourceLabel} />
        <ConversationContextItem
          label="Canal"
          value={helpers.formatIrisChannelLabel(ticket.channelLabel)}
        />
        <ConversationContextItem
          label="Janela WhatsApp"
          value={customerServiceWindowContextLabel}
        />

        <div className="rounded-xl border border-[#A07C3B]/15 bg-[#A07C3B]/5 p-3">
          <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">
            Historico Iris
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-950">
            {previousTickets.length} tickets anteriores
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            {ticket.messages.length} mensagens neste atendimento.
          </p>
        </div>
      </div>
    </aside>
  );
}

function ConversationContextItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200/70 bg-white px-3 py-2.5">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-slate-950 [overflow-wrap:anywhere]">
        {value}
      </p>
    </div>
  );
}
