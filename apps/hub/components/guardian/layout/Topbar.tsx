/* eslint-disable */
// @ts-nocheck
import { Bell, Flame } from "lucide-react";
import { Tooltip } from "@repo/uix";
import { PanteonTopbarUser } from "@/components/panteon/panteon-topbar-user";

export function Topbar() {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/90 backdrop-blur-xl">
      <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <div className="flex h-9 min-w-0 shrink-0 items-center gap-2 lg:hidden">
            <span className="grid size-9 place-items-center rounded-xl border border-[#A07C3B]/25 bg-slate-950 text-[#D5B46F]">
              <Flame className="size-4 stroke-[1.8]" aria-hidden="true" />
            </span>
            <span className="truncate text-base font-semibold text-slate-950">
              Hades
            </span>
          </div>

        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <Tooltip content="Notificações" placement="bottom">
            <button
              type="button"
              aria-label="Notificações"
              className="relative flex size-9 items-center justify-center rounded-xl border border-slate-200/70 text-slate-600 transition-colors hover:bg-slate-50"
            >
              <Bell className="size-4" aria-hidden="true" />
              <span className="absolute right-2 top-2 size-2 rounded-full bg-[#A07C3B]" />
            </button>
          </Tooltip>

          <PanteonTopbarUser />
        </div>
      </div>
    </header>
  );
}





