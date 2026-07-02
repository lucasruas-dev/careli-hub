"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, BellOff, CheckCheck } from "lucide-react";

import type { PanteonNotificationItem } from "@/lib/panteon-notifications";
import { usePanteonNotifications } from "@/providers/pulsex-notification-provider";
import {
  MobileEmptyState,
  ModuleChip,
} from "@/modules/mobile/components/mobile-ui";
import { formatRelativeTime } from "@/modules/mobile/lib/format";

export default function MobileNotificationsPage() {
  const router = useRouter();
  const { items, markAllRead, markNotificationRead, unreadCount } =
    usePanteonNotifications();

  // Esconde o "diário" por-mensagem do Hermes (id `hermes:msg:*`) na central
  // mobile — mantém só a notificação POR CANAL (`hermes:channel:*`, some ao abrir
  // o canal) + os demais módulos. Evita a central "dobrar" (Nova mensagem em X +
  // Mensagem em X por linha) que confundia.
  const visibleItems = items.filter(
    (item) => !item.id.startsWith("hermes:msg:"),
  );

  function openNotification(item: PanteonNotificationItem) {
    markNotificationRead(item.id);

    const hermesChannelId = item.context?.hermesChannelId;

    if (hermesChannelId) {
      router.push(`/m/hermes/${encodeURIComponent(hermesChannelId)}`);
      return;
    }

    if (item.moduleId === "iris") {
      router.push("/m/iris");
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 bg-[#101820] px-2 pb-3 pt-[max(0.85rem,env(safe-area-inset-top))] text-white">
        <Link
          aria-label="Voltar"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[#dbe4ef] outline-none transition active:scale-90"
          href="/m/iris"
        >
          <ArrowLeft aria-hidden="true" size={20} />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="m-0 text-sm font-semibold">Notificações</p>
          <p className="m-0 text-[11px] text-[#9fb0c2]">
            {unreadCount > 0
              ? `${unreadCount} não ${unreadCount === 1 ? "lida" : "lidas"}`
              : "Tudo em dia"}
          </p>
        </div>
        {unreadCount > 0 ? (
          <button
            className="flex items-center gap-1.5 rounded-full border border-[#33404f] px-3 py-1.5 text-xs font-medium text-[#dbe4ef] outline-none transition active:scale-95"
            onClick={markAllRead}
            type="button"
          >
            <CheckCheck aria-hidden="true" size={15} />
            Marcar lidas
          </button>
        ) : null}
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[#f5f6f8]">
        {visibleItems.length === 0 ? (
          <MobileEmptyState
            description="Alertas de atendimento, cobrança e mensagens aparecem aqui."
            icon={<BellOff aria-hidden="true" size={22} />}
            title="Sem notificações"
          />
        ) : (
          <ul className="m-0 grid list-none gap-2 p-3">
            {visibleItems.map((item) => (
              <li key={item.id}>
                <button
                  className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left outline-none transition active:scale-[0.99] ${
                    item.read
                      ? "border-[#e4e9f0] bg-white"
                      : "border-[#ecd9b0] bg-[#fffaf0]"
                  }`}
                  onClick={() => openNotification(item)}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                      item.read ? "bg-transparent" : "bg-[#A07C3B]"
                    }`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <ModuleChip moduleId={item.moduleId} />
                      <span className="ml-auto shrink-0 text-[0.7rem] text-[#9aa6b5]">
                        {formatRelativeTime(item.createdAt)}
                      </span>
                    </span>
                    <span
                      className={`mt-1 block text-sm ${
                        item.read
                          ? "font-medium text-[#3a4657]"
                          : "font-semibold text-[#101820]"
                      }`}
                    >
                      {item.title}
                    </span>
                    {item.description ? (
                      <span className="mt-0.5 line-clamp-2 block text-xs text-[#6b778c]">
                        {item.description}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
