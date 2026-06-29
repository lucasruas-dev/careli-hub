import { apoloScreens, type ApoloScreen } from "@/lib/apolo/catalog";
import type { ApoloDashboardData } from "@/lib/apolo/types";
import { Tooltip } from "@repo/uix";
import { FileText, MessageCircle, Plus, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// Shell do Apolo (cabecalho + acoes) — extraido do ApoloPage monolitico.

export function ApoloHeader({
  dashboard,
  screen,
  onChangeScreen,
}: {
  dashboard: ApoloDashboardData | null;
  screen: ApoloScreen;
  onChangeScreen: (screen: ApoloScreen) => void;
}) {
  return (
    <header className="shrink-0 rounded-lg border border-slate-200/70 bg-white px-3 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <nav
          aria-label="Telas do Apolo"
          className="mr-1 flex w-fit gap-1 rounded-xl border border-slate-200/70 bg-white p-1"
        >
          {apoloScreens.map((item) => {
            const Icon = item.icon;
            const active = screen === item.id;

            return (
              <Tooltip content={item.label} key={item.id} placement="bottom">
                <button
                  aria-current={active ? "page" : undefined}
                  aria-label={item.label}
                  className={`inline-flex size-8 items-center justify-center rounded-lg ring-1 ring-inset transition-colors ${
                    active
                      ? "bg-[#A07C3B]/8 text-[#7A5E2C] ring-[#A07C3B]/20"
                      : "bg-white text-slate-500 ring-slate-200/70 hover:bg-slate-50 hover:text-slate-950"
                  }`}
                  onClick={() => onChangeScreen(item.id)}
                  type="button"
                >
                  <Icon className={`size-4 ${active ? "text-[#A07C3B]" : "text-slate-400"}`} />
                </button>
              </Tooltip>
            );
          })}
        </nav>
        {dashboard?.meta.status === "sync_pending" ? (
          <span className="inline-flex h-9 items-center rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-800">
            Atualizacao pendente
          </span>
        ) : null}
        <HeaderAction icon={MessageCircle} label="Atendimento" tone="emerald" />
        <HeaderAction icon={FileText} label="Documentos" tone="slate" />
        <HeaderAction icon={Sparkles} label="Preenchimento assistido" tone="amber" />
        <Tooltip content="Criacao de relacionamento sera liberada no fluxo de cadastro assistido.">
          <button
            aria-label="Novo relacionamento"
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200/70 bg-white px-3 text-sm font-semibold text-slate-500 opacity-70"
            disabled
            type="button"
          >
            <Plus className="size-4" aria-hidden="true" />
            Novo
          </button>
        </Tooltip>
      </div>
    </header>
  );
}

export function HeaderAction({
  icon: Icon,
  label,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  tone: "amber" | "emerald" | "slate";
}) {
  const toneClass = {
    amber: "border-[#A07C3B]/15 bg-[#A07C3B]/5 text-[#7A5E2C]",
    emerald: "border-emerald-100 bg-emerald-50 text-emerald-700",
    slate: "border-slate-200/70 bg-white text-slate-600",
  } as const;

  return (
    <Tooltip content={label} placement="bottom">
      <button
        aria-label={label}
        className={`inline-flex size-9 items-center justify-center rounded-lg border transition-colors hover:bg-slate-50 ${toneClass[tone]}`}
        type="button"
      >
        <Icon className="size-4" aria-hidden="true" />
      </button>
    </Tooltip>
  );
}
