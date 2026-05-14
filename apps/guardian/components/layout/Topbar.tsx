import Image from "next/image";
import { Bell, Search } from "lucide-react";

export function Topbar() {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/90 backdrop-blur-xl">
      <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <div className="relative h-9 w-32 shrink-0 lg:hidden">
            <Image
              src="/logo-guardian.png"
              alt="Guardian"
              fill
              priority
              sizes="128px"
              className="object-contain object-left"
            />
          </div>

          <div className="hidden min-w-0 max-w-md flex-1 items-center gap-2 rounded-xl border border-slate-200/70 bg-slate-50/80 px-3 py-2 text-slate-500 md:flex">
            <Search className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate text-sm">Buscar cliente, contrato ou protocolo</span>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            aria-label="Pesquisar"
            title="Pesquisar"
            className="flex size-9 items-center justify-center rounded-xl border border-slate-200/70 text-slate-600 transition-colors hover:bg-slate-50 md:hidden"
          >
            <Search className="size-4" aria-hidden="true" />
          </button>

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
