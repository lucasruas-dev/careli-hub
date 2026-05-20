"use client";

import { AthenaIcon } from "@/components/athena-icon";
import { HubTicketOpenForm } from "@/components/hub-support/hub-ticket-open-form";
import { useOutsideDismiss } from "@/hooks/use-outside-dismiss";
import { useAuth } from "@/providers/auth-provider";
import { Bug, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";

export function HubSupportDock() {
  const { hubUser } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const dockRef = useRef<HTMLDivElement>(null);

  useOutsideDismiss({
    enabled: open,
    onDismiss: () => setOpen(false),
    ref: dockRef,
  });

  if (!hubUser || shouldHideGlobalAthena(pathname)) {
    return null;
  }

  return (
    <div
      className="fixed bottom-5 right-5 z-[80] flex flex-col items-end gap-3"
      ref={dockRef}
    >
      {open ? (
        <section className="w-[min(33rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.24)]">
          <header className="border-b border-slate-100 bg-[#101820] px-4 py-3 text-white">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl border border-[#A07C3B]/30 bg-[#101820] ring-1 ring-white/15">
                  <AthenaIcon
                    className="size-full object-cover"
                    variant="panel"
                    aria-hidden="true"
                  />
                </span>
                <div className="min-w-0">
                  <p className="m-0 text-sm font-semibold">Athena</p>
                  <p className="m-0 mt-1 truncate text-xs text-white/65">
                    Agente operacional do Panteon.
                  </p>
                </div>
              </div>
              <button
                aria-label="Fechar Athena"
                className="grid size-8 place-items-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white"
                onClick={() => setOpen(false)}
                type="button"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
            <div className="mt-3 inline-flex h-8 items-center gap-2 rounded-md bg-white px-3 text-xs font-semibold text-[#101820]">
              <Bug className="size-4" aria-hidden="true" />
              Ticket TI
            </div>
          </header>

          <div className="max-h-[calc(100dvh-12rem)] overflow-y-auto p-4">
            <HubTicketOpenForm />
          </div>
        </section>
      ) : null}

      <button
        aria-expanded={open}
        aria-label="Abrir Athena"
        className="relative grid size-14 place-items-center overflow-hidden rounded-full border border-[#A07C3B]/30 bg-[#101820] text-[#A07C3B] shadow-[0_18px_50px_rgba(15,23,42,0.18)] transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <AthenaIcon className="size-full object-cover" aria-hidden="true" />
        <span className="absolute right-1 top-1 size-3 rounded-full bg-emerald-500 ring-2 ring-white" />
      </button>
    </div>
  );
}

function shouldHideGlobalAthena(pathname: string) {
  return (
    pathname.startsWith("/zeus") ||
    pathname.startsWith("/hermes") ||
    pathname.startsWith("/hades/cobranca") ||
    pathname.startsWith("/hades/atendimento")
  );
}
