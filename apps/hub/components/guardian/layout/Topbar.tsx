/* eslint-disable */
// @ts-nocheck
import { ShieldCheck } from "lucide-react";

export function Topbar() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur-xl lg:hidden">
      <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <div className="flex h-9 min-w-0 shrink-0 items-center gap-2 lg:hidden">
            <span className="grid size-9 place-items-center rounded-xl border border-[#A07C3B]/25 bg-slate-950 text-[#D5B46F]">
              <ShieldCheck className="size-4 stroke-[1.8]" aria-hidden="true" />
            </span>
            <span className="truncate text-base font-semibold text-ink">
              Hades
            </span>
          </div>

        </div>
      </div>
    </header>
  );
}





