"use client";

import type { ReactNode, RefObject } from "react";
import {
  Mail,
  MessageCircle,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Tooltip } from "@repo/uix";

import { PhoneFlag } from "../../components/phone-flag";
import {
  BoardProfileChip,
  type IrisBoardTicket,
  type IrisBoardTicketPriority,
  readBoardTicketCrm,
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
    <div className="flex h-full min-h-0 items-center justify-center rounded-2xl border border-line bg-surface">
      <div className="text-center">
        <MessageCircle className="mx-auto h-8 w-8 text-[#A07C3B]" />
        <h3 className="mt-3 text-base font-semibold">Selecione um ticket</h3>
      </div>
    </div>
  );
}

export type IrisInboxChannelFilter = "all" | "whatsapp" | "group" | "email";

const IRIS_INBOX_CHANNEL_FILTERS: {
  key: IrisInboxChannelFilter;
  label: string;
}[] = [
  { key: "all", label: "Tudo" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "group", label: "Grupo" },
  { key: "email", label: "E-mail" },
];

export function IrisConversationInboxSidebar({
  channelFilter,
  collapsed,
  conversations,
  helpers,
  onChannelFilterChange,
  onCollapseChange,
  onSearchChange,
  onSelectTicket,
  renderers,
  search,
  selectedTicketId,
}: {
  channelFilter: IrisInboxChannelFilter;
  cobrancaMode?: boolean;
  collapsed: boolean;
  conversations: IrisConversationTicket[];
  filter: string;
  helpers: IrisConversationReadOnlyHelpers;
  onChannelFilterChange: (filter: IrisInboxChannelFilter) => void;
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
        "hidden shrink-0 border-r border-line/80 bg-surface shadow-[4px_0_18px_rgba(15,23,42,0.05)] transition-all duration-300 lg:flex lg:flex-col",
        collapsed ? "w-14" : "w-80",
      ].join(" ")}
    >
      <div className={collapsed ? "p-2" : "border-b border-line p-3"}>
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => onCollapseChange(false)}
              className="flex size-9 items-center justify-center rounded-lg border border-line/70 bg-surface text-ink-muted transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-[#7A5E2C]"
              aria-label="Expandir conversas"
              title="Expandir conversas"
            >
              <PanelLeftOpen className="size-4" aria-hidden="true" />
            </button>
            <div className="flex size-9 items-center justify-center rounded-lg bg-[#A07C3B]/5 text-[#A07C3B] ring-1 ring-[#A07C3B]/15">
              <MessageCircle className="size-4" aria-hidden="true" />
            </div>
            <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
              {conversations.length}
            </span>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-ink">
                  Fila de atendimento
                </h2>
              </div>
              <button
                type="button"
                onClick={() => onCollapseChange(true)}
                className="flex size-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface hover:text-[#7A5E2C]"
                aria-label="Recolher conversas"
                title="Recolher conversas"
              >
                <PanelLeftClose className="size-4" aria-hidden="true" />
              </button>
            </div>
            <label className="mt-3 flex rounded-lg border border-line/70 bg-surface px-3 py-1.5">
              <span className="sr-only">Buscar conversa</span>
              <input
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="Buscar conversa..."
                className="h-7 w-full bg-transparent text-sm font-medium text-ink outline-none placeholder:text-ink-muted"
              />
            </label>
            <div className="mt-2 flex flex-wrap gap-1">
              {IRIS_INBOX_CHANNEL_FILTERS.map((option) => {
                const active = channelFilter === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => onChannelFilterChange(option.key)}
                    className={[
                      "rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 transition-colors",
                      active
                        ? "bg-[#A07C3B]/12 text-[#7A5E2C] ring-[#A07C3B]/25 dark:text-[#d9b877]"
                        : "bg-surface text-ink-muted ring-line/70 hover:text-ink",
                    ].join(" ")}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {!collapsed ? (
        <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
          {conversations.length ? (
            conversations.map((conversation) => {
              const active = conversation.id === selectedTicketId;
              const waitState = helpers.conversationWaitState(conversation);
              const waitAge = helpers.conversationWaitAge(conversation);
              const unreadCount = conversation.unreadCount ?? 0;
              const crm = readBoardTicketCrm(conversation.crm360Registration);
              const dotClass =
                waitState.tone === "pendente"
                  ? "bg-[#A07C3B]"
                  : waitState.tone === "espera"
                    ? "bg-emerald-500"
                    : "bg-subtle";
              const waitTextClass =
                waitState.tone === "pendente"
                  ? "text-[#7A5E2C]"
                  : waitState.tone === "espera"
                    ? "text-emerald-600"
                    : "text-ink-muted";

              return (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => onSelectTicket(conversation.id)}
                  className={[
                    "flex w-full items-center gap-2 border-b border-line px-2.5 py-2 text-left transition-colors",
                    active
                      ? "bg-[#A07C3B]/5 shadow-[inset_3px_0_0_#A07C3B]"
                      : "hover:bg-subtle/70",
                  ].join(" ")}
                >
                  <span
                    className={`size-2 shrink-0 rounded-full ${dotClass}`}
                    aria-hidden="true"
                    title={waitState.label}
                  />
                  <span className="shrink-0">
                    {renderers.renderContactAvatar(conversation, "sm")}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1.5">
                      {conversation.channelKind === "email" ? (
                        <span
                          className="flex size-4 shrink-0 items-center justify-center rounded-md bg-indigo-500 text-white dark:bg-indigo-500/90"
                          title="E-mail"
                          aria-label="E-mail"
                        >
                          <Mail className="size-2.5" aria-hidden="true" />
                        </span>
                      ) : conversation.isGroup ? (
                        <span
                          className="flex size-4 shrink-0 items-center justify-center rounded-md bg-emerald-600 text-white dark:bg-emerald-600/90"
                          title="Grupo de WhatsApp"
                          aria-label="Grupo de WhatsApp"
                        >
                          <Users className="size-2.5" aria-hidden="true" />
                        </span>
                      ) : null}
                      <span
                        className={`min-w-0 truncate text-sm text-ink ${
                          conversation.unread ? "font-bold" : "font-medium"
                        }`}
                      >
                        {helpers.ticketContactLabel(conversation)}
                      </span>
                      <BoardProfileChip crm={crm} />
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-ink-muted [overflow-wrap:anywhere]">
                      {conversation.lastMessagePreview}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-0.5">
                    <span className="text-[10px] tabular-nums text-ink-muted">
                      {helpers.conversationTime(conversation)}
                    </span>
                    {unreadCount > 0 ? (
                      <span
                        className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white"
                        title={`${unreadCount} mensagem(ns) do cliente sem resposta`}
                      >
                        {unreadCount > 99 ? "99+" : unreadCount}
                      </span>
                    ) : (
                      <span className={`text-[10px] font-semibold ${waitTextClass}`}>
                        {waitAge || waitState.label}
                      </span>
                    )}
                  </span>
                </button>
              );
            })
          ) : (
            <div className="m-2.5 rounded-lg border border-line/70 bg-surface p-4 text-center text-xs font-semibold text-ink-muted">
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
      className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-subtle/40 px-3 py-4 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin] sm:px-4"
    >
      <div className="w-full min-w-0 space-y-5">
        {previousTickets.length > 0 ? (
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={onTogglePreviousTickets}
              className="inline-flex h-9 items-center rounded-lg border border-line/70 bg-surface px-3 text-xs font-semibold text-ink-soft shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-ink"
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
    <aside className="hidden w-[330px] shrink-0 border-l border-line bg-surface xl:block">
      <div className="border-b border-line p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            {renderers.renderContactAvatar(ticket, "lg")}
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">
                Contexto
              </p>
              <h3 className="mt-1 truncate text-sm font-semibold text-ink">
                {helpers.ticketContactLabel(ticket)}
              </h3>
              <p className="mt-0.5 text-xs font-medium text-ink-muted">
                {ticket.contactPhone ?? "Sem telefone"}
              </p>
            </div>
          </div>
          <MessageSquareText
            className="size-4 text-ink-muted"
            aria-hidden="true"
          />
        </div>
        <div className="mt-3 grid grid-cols-4 gap-1 rounded-lg bg-subtle/70 p-1">
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
                    ? "cursor-not-allowed text-ink-muted"
                    : shortcut.active
                      ? "bg-surface text-[#7A5E2C]"
                      : "text-ink-muted hover:bg-surface hover:text-[#7A5E2C]",
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
        <div className="rounded-xl border border-line/70 bg-subtle/70 px-3 py-2.5">
          <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">
            Nota do operador
          </p>
          <p className="mt-1 text-sm font-medium text-ink [overflow-wrap:anywhere]">
            {ticketContextNote?.text?.trim() ||
              "Sem nota registrada para este cliente."}
          </p>
          <p className="mt-1 text-[11px] text-ink-muted">
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
          label="Apolo"
          value={helpers.crm360ContextLabel(ticket.crm360Registration)}
        />
        <ConversationContextItem
          label="Telefone"
          value={
            ticket.contactPhone ? (
              <span className="inline-flex items-center gap-1.5">
                <PhoneFlag phone={ticket.contactPhone} />
                {ticket.contactPhone}
              </span>
            ) : (
              "-"
            )
          }
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
          <p className="mt-1 text-sm font-semibold text-ink">
            {previousTickets.length} tickets anteriores
          </p>
          <p className="mt-1 text-xs leading-5 text-ink-soft">
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
  value: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line/70 bg-surface px-3 py-2.5">
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-ink [overflow-wrap:anywhere]">
        {value}
      </p>
    </div>
  );
}
