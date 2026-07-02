"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Headphones, MessageSquareText } from "lucide-react";

import { useAuth } from "@/providers/auth-provider";
import { usePanteonNotifications } from "@/providers/pulsex-notification-provider";
import { MobileAvatar } from "@/modules/mobile/components/mobile-ui";

// Barra superior do app mobile (padrão "sidebar no topo" pedido pelo Lucas):
// avatar à esquerda, abas Hermes/Iris no meio, sino de notificações à direita.
// As notificações abrem em tela cheia (/m/notificacoes).
export function MobileTopBar() {
  const pathname = usePathname() ?? "";
  const { hubUser } = useAuth();
  const { unreadCount } = usePanteonNotifications();

  const onIris = pathname.startsWith("/m/iris");
  const onHermes = pathname.startsWith("/m/hermes");

  return (
    <header className="flex items-center gap-2 bg-[#101820] px-3 pb-3 pt-[max(0.85rem,env(safe-area-inset-top))] text-white">
      <MobileAvatar label={hubUser?.name} size={34} url={hubUser?.avatarUrl} />

      <div className="flex flex-1 rounded-full bg-[#1d2734] p-[3px]">
        <Link
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-full py-1.5 text-[13px] font-medium transition ${
            onHermes ? "bg-[#A07C3B] text-white" : "text-[#9fb0c2]"
          }`}
          href="/m/hermes"
        >
          <MessageSquareText aria-hidden="true" size={16} />
          Hermes
        </Link>
        <Link
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-full py-1.5 text-[13px] font-medium transition ${
            onIris ? "bg-[#A07C3B] text-white" : "text-[#9fb0c2]"
          }`}
          href="/m/iris"
        >
          <Headphones aria-hidden="true" size={16} />
          Iris
        </Link>
      </div>

      <Link
        aria-label="Notificacoes"
        className="relative grid h-9 w-9 shrink-0 place-items-center text-[#dbe4ef] outline-none"
        href="/m/notificacoes"
      >
        <Bell aria-hidden="true" size={21} />
        {unreadCount > 0 ? (
          <span className="absolute right-0 top-0 grid min-w-[16px] place-items-center rounded-full bg-[#A07C3B] px-1 text-[10px] font-semibold leading-4 text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </Link>
    </header>
  );
}
