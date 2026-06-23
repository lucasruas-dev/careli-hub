"use client";

import { Bell, CheckCheck, History, Inbox } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Tooltip } from "@repo/uix";

import {
  isPanteonNotificationFromToday,
  type PanteonNotificationItem,
} from "@/lib/panteon-notifications";
import { usePanteonNotifications } from "@/providers/pulsex-notification-provider";

export function PanteonNotificationButton({
  className = "",
}: {
  className?: string;
}) {
  const { items, markAllRead, openHermesChannel, unreadCount } =
    usePanteonNotifications();
  const [open, setOpen] = useState(false);
  // C: separa as notificacoes em "novas" (nao lidas) e "historico" (lidas). A Central
  // abre nas novas; o icone de historico mostra as lidas num so popup.
  const [showHistory, setShowHistory] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const unreadItems = items.filter((item) => !item.read);
  const readItems = items.filter(
    (item) => item.read && isPanteonNotificationFromToday(item.createdAt),
  );
  const visibleItems = showHistory ? readItems : unreadItems;

  useEffect(() => {
    if (!open) {
      setShowHistory(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;

      if (
        target instanceof Node &&
        panelRef.current &&
        !panelRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open]);

  return (
    <div className={`relative ${className}`} ref={panelRef}>
      <Tooltip content="Central de notificacoes" placement="bottom">
        <button
          aria-expanded={open}
          aria-label="Abrir central de notificacoes"
          className="relative grid h-8 w-8 shrink-0 place-items-center rounded-md border border-[#d9e0e7] bg-white text-[#526078] outline-none transition hover:bg-[#f8fafc] hover:text-[#101820] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
          onClick={() => setOpen((currentValue) => !currentValue)}
          type="button"
        >
          <Bell aria-hidden="true" size={17} />
          {unreadCount > 0 ? (
            <span className="absolute -right-1 -top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[0.625rem] font-bold leading-none text-white">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          ) : null}
        </button>
      </Tooltip>
      {open ? (
        <div className="absolute right-0 top-10 z-[var(--uix-z-popover)] w-[min(25rem,calc(100vw-2rem))] rounded-lg border border-[#d9e0e7] bg-white shadow-2xl">
          <header className="flex items-center justify-between gap-3 border-b border-[#e4e9ef] px-3 py-2.5">
            <div className="min-w-0">
              <p className="m-0 text-sm font-semibold text-[#101820]">
                {showHistory ? "Historico" : "Central Panteon"}
              </p>
              <p className="m-0 text-xs text-[#6b778c]">
                {showHistory
                  ? `${readItems.length} lida(s)`
                  : unreadItems.length > 0
                    ? `${unreadItems.length} pendente(s)`
                    : "Tudo em dia"}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                aria-label={showHistory ? "Ver novas" : "Ver historico"}
                aria-pressed={showHistory}
                className={`inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-[#A07C3B] ${
                  showHistory
                    ? "border-[#A07C3B] bg-[#f7f3eb] text-[#7b5f2d]"
                    : "border-[#d9e0e7] text-[#526078] hover:bg-[#f8fafc] hover:text-[#101820]"
                }`}
                onClick={() => setShowHistory((current) => !current)}
                type="button"
              >
                <History aria-hidden="true" size={14} />
                Historico
              </button>
              {showHistory ? null : (
                <button
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-[#d9e0e7] px-2 text-xs font-semibold text-[#526078] outline-none transition hover:bg-[#f8fafc] hover:text-[#101820] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                  onClick={markAllRead}
                  type="button"
                >
                  <CheckCheck aria-hidden="true" size={14} />
                  Lidas
                </button>
              )}
            </div>
          </header>
          <div className="max-h-[28rem] overflow-y-auto p-2">
            {visibleItems.length > 0 ? (
              <div className="grid gap-1.5">
                {visibleItems.map((item) => (
                  <NotificationCenterRow
                    item={item}
                    key={item.id}
                    onOpen={() => {
                      if (item.context?.hermesChannelId) {
                        openHermesChannel(item.context.hermesChannelId);
                        setOpen(false);
                        return;
                      }

                      if (item.href) {
                        window.location.assign(item.href);
                      }
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="grid min-h-28 place-items-center rounded-md border border-dashed border-[#d9e0e7] px-4 text-center text-sm text-[#6b778c]">
                <span className="inline-flex items-center gap-2">
                  <Inbox aria-hidden="true" size={16} />
                  {showHistory
                    ? "Sem notificacoes no historico."
                    : "Sem notificacoes novas."}
                </span>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function NotificationCenterRow({
  item,
  onOpen,
}: {
  item: PanteonNotificationItem;
  onOpen: () => void;
}) {
  const tone = getNotificationTone(item.severity);

  return (
    <button
      className={`grid w-full grid-cols-[0.25rem_minmax(0,1fr)_auto] items-start gap-2 rounded-md border p-2.5 text-left outline-none transition hover:bg-[#f8fafc] focus-visible:ring-2 focus-visible:ring-[#A07C3B] ${item.read ? "border-[#e8edf2] bg-white" : "border-[#cbd8e6] bg-[#f8fbff]"}`}
      onClick={onOpen}
      type="button"
    >
      <span className={`mt-1 h-8 rounded-full ${tone.accent}`} />
      <span className="min-w-0">
        <span className="mb-1 flex items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-[0.65rem] font-bold ${tone.badge}`}
          >
            {item.moduleLabel}
          </span>
          <span className="truncate text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-[#7a8798]">
            {getNotificationKindLabel(item.kind)}
          </span>
        </span>
        <span className="block truncate text-sm font-semibold text-[#101820]">
          {item.title}
        </span>
        {item.description ? (
          <span className="mt-0.5 block truncate text-xs text-[#526078]">
            {item.description}
          </span>
        ) : null}
      </span>
      <span className="grid justify-items-end gap-1 text-right">
        <span className="text-[0.7rem] font-semibold text-[#7a8798]">
          {formatNotificationTime(item.createdAt)}
        </span>
        <span className="text-[0.7rem] font-semibold text-[#526078]">
          {item.actionLabel ?? "Abrir"}
        </span>
      </span>
    </button>
  );
}

function formatNotificationTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getNotificationKindLabel(kind: PanteonNotificationItem["kind"]) {
  const labels = {
    agenda: "Agenda",
    alerta: "Alerta",
    atendimento: "Atendimento",
    mensagem: "Mensagem",
    operacao: "Operacao",
    sistema: "Sistema",
    tarefa: "Tarefa",
  } as const satisfies Record<PanteonNotificationItem["kind"], string>;

  return labels[kind];
}

function getNotificationTone(severity: PanteonNotificationItem["severity"]) {
  const tones = {
    danger: {
      accent: "bg-red-500",
      badge: "bg-red-50 text-red-700",
    },
    info: {
      accent: "bg-sky-500",
      badge: "bg-sky-50 text-sky-700",
    },
    neutral: {
      accent: "bg-slate-400",
      badge: "bg-slate-100 text-slate-700",
    },
    success: {
      accent: "bg-emerald-500",
      badge: "bg-emerald-50 text-emerald-700",
    },
    warning: {
      accent: "bg-amber-500",
      badge: "bg-amber-50 text-amber-700",
    },
  } as const satisfies Record<
    PanteonNotificationItem["severity"],
    {
      accent: string;
      badge: string;
    }
  >;

  return tones[severity];
}
