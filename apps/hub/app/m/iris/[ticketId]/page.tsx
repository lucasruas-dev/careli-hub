"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowLeft,
  Building2,
  ChevronRight,
  Clock,
  Loader2,
  Send,
  User,
  Wallet,
} from "lucide-react";

import {
  ensureOperatorIdentity,
  mapMessageRow,
} from "@/modules/caredesk/data/iris-data-client";
import type { IrisMessage } from "@/modules/caredesk/types/iris-types";
import { useAuth } from "@/providers/auth-provider";
import {
  IrisProfileChip,
  MobileAvatar,
} from "@/modules/mobile/components/mobile-ui";
import { useIrisMobile } from "@/modules/mobile/components/iris-mobile-provider";
import { getIrisWaitingSince } from "@/modules/mobile/lib/iris-sections";
import { readIrisProfileChip } from "@/modules/mobile/lib/iris-profile";
import {
  IrisCockpitSheet,
  type CockpitTab,
} from "@/modules/mobile/components/iris-cockpit-sheet";
import { getMobileAccessToken } from "@/modules/mobile/lib/access-token";
import {
  formatClockTime,
  formatWaitingDuration,
} from "@/modules/mobile/lib/format";

const DOCK = [
  { icon: User, label: "Cliente", tab: "cliente" },
  { icon: Building2, label: "Carteira", tab: "carteira" },
  { icon: Wallet, label: "Financeiro", tab: "financeiro" },
  { icon: Clock, label: "Timeline", tab: "timeline" },
] as const;

export default function MobileIrisConversationPage() {
  const params = useParams<{ ticketId: string }>();
  const ticketId = decodeURIComponent(params.ticketId ?? "");
  const { hubUser } = useAuth();
  const { appendMessage, hydrateTicketMessages, status, tickets } =
    useIrisMobile();

  // Histórico completo do ticket ao abrir (sem o teto do snapshot em massa).
  useEffect(() => {
    if (ticketId) {
      hydrateTicketMessages(ticketId);
    }
  }, [hydrateTicketMessages, ticketId]);

  const ticket = useMemo(
    () => tickets.find((item) => item.id === ticketId) ?? null,
    [ticketId, tickets],
  );

  const orderedMessages = useMemo(() => {
    if (!ticket) {
      return [];
    }

    return [...ticket.messages].sort(
      (a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0),
    );
  }, [ticket]);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [cockpitOpen, setCockpitOpen] = useState(false);
  const [cockpitTab, setCockpitTab] = useState<CockpitTab>("cliente");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      behavior: "smooth",
      top: scrollRef.current.scrollHeight,
    });
  }, [orderedMessages.length]);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const body = draft.trim();

      if (!body || sending || !ticket) {
        return;
      }

      setSending(true);
      setError("");

      const operatorLabel = hubUser?.name ?? "Operador";
      const operatorAvatarUrl = hubUser?.avatarUrl ?? null;

      try {
        const accessToken = await getMobileAccessToken();
        const response = await fetch("/api/iris/meta/messages", {
          body: JSON.stringify({
            body,
            channelId: ticket.channelId ?? null,
            contactId: ticket.contactId ?? null,
            replyToMessageId: null,
            ticketId: ticket.id,
            to: ticket.contactPhone ?? "",
          }),
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          method: "POST",
        });

        const payload = (await response.json().catch(() => null)) as {
          error?: string;
          message?: Record<string, unknown> | null;
        } | null;

        if (payload?.message) {
          appendMessage(
            ticket.id,
            ensureOperatorIdentity(
              mapMessageRow(payload.message),
              operatorLabel,
              operatorAvatarUrl,
            ),
          );
        }

        if (!response.ok) {
          throw new Error(
            payload?.error ?? "Nao foi possivel enviar pelo WhatsApp.",
          );
        }

        if (!payload?.message) {
          const now = new Date().toISOString();
          const optimistic: IrisMessage = {
            body,
            createdAt: now,
            deliveryStatus: "queued",
            direction: "outbound",
            id: `local-${now}`,
            messageType: "text",
            operatorAvatarUrl,
            senderLabel: operatorLabel,
            senderType: "operator",
          };

          appendMessage(ticket.id, optimistic);
        }

        setDraft("");
      } catch (submitError) {
        setError(
          submitError instanceof Error
            ? submitError.message
            : "Nao foi possivel enviar a mensagem.",
        );
      } finally {
        setSending(false);
      }
    },
    [appendMessage, draft, hubUser?.avatarUrl, hubUser?.name, sending, ticket],
  );

  if (!ticket) {
    return (
      <div className="flex h-full flex-col bg-[#e7e0d6]">
        <IrisChatHeader subtitle="Iris" title="Atendimento" />
        <div className="grid flex-1 place-items-center px-8 text-center text-sm text-[#6b778c]">
          {status === "loading" ? (
            <Loader2 aria-hidden="true" className="animate-spin" size={22} />
          ) : (
            "Atendimento nao encontrado."
          )}
        </div>
      </div>
    );
  }

  const profile = readIrisProfileChip(ticket.crm360Registration);
  const waitingSince = getIrisWaitingSince(ticket);

  return (
    <div className="relative flex h-full flex-col bg-[#e7e0d6]">
      <IrisChatHeader
        avatarUrl={ticket.contactAvatarUrl}
        subtitle={`${ticket.queueLabel} · ${ticket.protocol}`}
        title={ticket.contactLabel}
      />

      {profile.label || waitingSince ? (
        <button
          className="flex items-center gap-2 border-b border-[#e4e9f0] bg-white px-3 py-2 text-left outline-none transition active:bg-[#f5f6f8]"
          onClick={() => {
            setCockpitTab("cliente");
            setCockpitOpen(true);
          }}
          type="button"
        >
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            <IrisProfileChip crm={profile} />
            {waitingSince ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#f6ecd7] px-2 py-0.5 text-[0.66rem] font-semibold text-[#8a6d1f]">
                <Clock aria-hidden="true" size={11} />
                {formatWaitingDuration(waitingSince)} sem resposta
              </span>
            ) : null}
          </span>
          <ChevronRight
            aria-hidden="true"
            className="shrink-0 text-[#9aa6b5]"
            size={16}
          />
        </button>
      ) : null}

      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3"
        ref={scrollRef}
      >
        <div className="grid gap-2">
          {orderedMessages.map((message) => {
            if (message.direction === "internal") {
              return (
                <p
                  className="mx-auto max-w-[88%] rounded-lg bg-[#fdf3d8] px-3 py-1.5 text-center text-xs text-[#8a6d1f]"
                  key={message.id}
                >
                  {message.body}
                </p>
              );
            }

            if (message.senderType === "system") {
              return (
                <p
                  className="mx-auto max-w-[88%] text-center text-[0.7rem] text-[#7c7264]"
                  key={message.id}
                >
                  {message.body}
                </p>
              );
            }

            const outbound = message.direction === "outbound";
            const failed = message.deliveryStatus === "failed";

            return (
              <article
                className={`grid min-w-0 max-w-[82%] gap-1 rounded-2xl px-3 py-2 text-sm shadow-sm ${
                  outbound
                    ? "ml-auto rounded-br-md bg-[#dcf8c6] text-[#123524]"
                    : "mr-auto rounded-bl-md bg-white text-[#17202f]"
                }`}
                key={message.id}
              >
                <p className="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {message.body}
                </p>
                <span className="flex items-center justify-end gap-1 text-[0.62rem] text-[#8894a5]">
                  {failed ? (
                    <span className="font-semibold text-[#c0392b]">
                      falha no envio
                    </span>
                  ) : null}
                  {formatClockTime(message.createdAt)}
                </span>
              </article>
            );
          })}
        </div>
      </div>

      <div className="flex gap-1.5 border-t border-[#d9d2c6] bg-white/70 px-2 py-2">
        {DOCK.map((item) => {
          const Icon = item.icon;

          return (
            <button
              className="flex flex-1 flex-col items-center gap-1 rounded-xl bg-[#f2f4f7] py-2 text-[10.5px] font-medium text-[#3a4657] outline-none transition active:scale-95"
              key={item.label}
              onClick={() => {
                setCockpitTab(item.tab);
                setCockpitOpen(true);
              }}
              type="button"
            >
              <Icon aria-hidden="true" className="text-[#A07C3B]" size={18} />
              {item.label}
            </button>
          );
        })}
      </div>

      {error ? (
        <p className="m-0 border-t border-red-100 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
          {error}
        </p>
      ) : null}

      <form
        className="flex items-end gap-2 border-t border-[#d9d2c6] bg-[#f0f2f5] p-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]"
        onSubmit={handleSubmit}
      >
        <textarea
          className="max-h-28 min-h-[2.75rem] flex-1 resize-none rounded-2xl border border-[#d9e0e7] bg-white px-3 py-2.5 text-sm text-[#17202f] outline-none transition placeholder:text-[#9aa6b5] focus:border-[#A07C3B]"
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Responder pelo WhatsApp..."
          rows={1}
          value={draft}
        />
        <button
          aria-label="Enviar"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#101820] text-white outline-none transition active:scale-90 disabled:opacity-50"
          disabled={!draft.trim() || sending}
          type="submit"
        >
          {sending ? (
            <Loader2 aria-hidden="true" className="animate-spin" size={18} />
          ) : (
            <Send aria-hidden="true" size={18} />
          )}
        </button>
      </form>

      {cockpitOpen ? (
        <IrisCockpitSheet
          initialTab={cockpitTab}
          onClose={() => setCockpitOpen(false)}
          ticket={ticket}
        />
      ) : null}
    </div>
  );
}

function IrisChatHeader({
  avatarUrl,
  subtitle,
  title,
}: {
  avatarUrl?: string | null;
  subtitle: string;
  title: string;
}) {
  return (
    <header className="flex items-center gap-2 border-b border-[#e4e9f0] bg-[#101820] px-2 pb-2.5 pt-[max(0.85rem,env(safe-area-inset-top))] text-white">
      <Link
        aria-label="Voltar"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[#dbe4ef] outline-none transition active:scale-90"
        href="/m/iris"
      >
        <ArrowLeft aria-hidden="true" size={20} />
      </Link>
      <MobileAvatar label={title} size={38} url={avatarUrl} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{title}</span>
        <span className="block truncate text-[0.7rem] text-[#cbd5e1]">
          {subtitle}
        </span>
      </span>
    </header>
  );
}
