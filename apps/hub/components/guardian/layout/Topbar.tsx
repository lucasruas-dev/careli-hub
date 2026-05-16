/* eslint-disable */
// @ts-nocheck
import Image from "next/image";
import { Bell } from "lucide-react";

export function Topbar() {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/90 backdrop-blur-xl">
      <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <div className="relative h-9 w-32 shrink-0 lg:hidden">
            <Image
              src="/logog.png"
              alt="Guardian"
              fill
              priority
              sizes="128px"
              className="object-contain object-left"
            />
          </div>

        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            aria-label="Notificações"
            title="Notificações"
            className="relative flex size-9 items-center justify-center rounded-xl border border-slate-200/70 text-slate-600 transition-colors hover:bg-slate-50"
          >
            <Bell className="size-4" aria-hidden="true" />
            <span className="absolute right-2 top-2 size-2 rounded-full bg-[#A07C3B]" />
          </button>

          <button
            type="button"
            title="Perfil Guardian"
            aria-label="Perfil Guardian"
            className="flex size-9 items-center justify-center rounded-xl border border-slate-200/70 bg-white text-left transition-colors hover:bg-slate-50"
          >
            <span className="flex size-7 items-center justify-center rounded-lg bg-slate-950 text-xs font-medium text-white">
              G
            </span>
          </button>
        </div>
      </div>
    </header>
  );
}





