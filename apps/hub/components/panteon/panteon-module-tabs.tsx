"use client";

import { Plus, X } from "lucide-react";
import type { ReactNode } from "react";
import { Tooltip } from "@repo/uix";

import { PanteonTopbarUser } from "@/components/panteon/panteon-topbar-user";

// Barra global do Panteon (modo operacional): marca + abas dos modulos abertos (estilo
// navegador) + "+" (launcher) + cluster do usuario (sino/presenca/avatar). Trocar de
// modulo = clicar na aba, sem reabrir o launcher. O badge de nao-lido por aba vem do
// unreadByModule da central.

export type PanteonModuleTab = {
  active: boolean;
  basePath: string;
  icon: ReactNode;
  id: string;
  label: string;
  // @mencoes nao-lidas (so Hermes hoje): badge ambar distinto no lugar do vermelho.
  mentionUnread?: number;
  unread: number;
};

export function PanteonModuleTabsBar({
  brandSrc,
  homeActive,
  onCloseTab,
  onOpenLauncher,
  onSelectHome,
  onSelectTab,
  tabs,
}: {
  brandSrc: string;
  homeActive: boolean;
  onCloseTab: (id: string) => void;
  onOpenLauncher: () => void;
  onSelectHome: () => void;
  onSelectTab: (basePath: string) => void;
  tabs: readonly PanteonModuleTab[];
}) {
  return (
    <header className="flex h-[3.25rem] shrink-0 items-center gap-2 border-b border-white/[0.07] bg-[#0a0b0b] px-3">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
        <PanteonHomeTab
          active={homeActive}
          brandSrc={brandSrc}
          onSelect={onSelectHome}
        />
        {tabs.map((tab) => (
          <ModuleTab
            key={tab.id}
            onClose={() => onCloseTab(tab.id)}
            onSelect={() => onSelectTab(tab.basePath)}
            tab={tab}
          />
        ))}
        <Tooltip content="Abrir modulo" placement="bottom">
          <button
            aria-label="Abrir modulo"
            className="grid h-[2.125rem] w-[2.125rem] shrink-0 place-items-center rounded-lg border border-dashed border-white/[0.16] text-[#9aa6b4] outline-none transition hover:border-white/[0.28] hover:bg-white/[0.04] hover:text-white focus-visible:ring-2 focus-visible:ring-[var(--uix-color-focus)]"
            onClick={onOpenLauncher}
            type="button"
          >
            <Plus aria-hidden="true" size={18} />
          </button>
        </Tooltip>
      </div>

      <div className="shrink-0 border-l border-white/[0.08] pl-2">
        <PanteonTopbarUser compact onDark source="hub-tabs" />
      </div>
    </header>
  );
}

function PanteonHomeTab({
  active,
  brandSrc,
  onSelect,
}: {
  active: boolean;
  brandSrc: string;
  onSelect: () => void;
}) {
  return (
    <button
      aria-label="Abrir a Home do Panteon"
      className={`flex h-[2.375rem] shrink-0 items-center gap-2.5 rounded-[9px] border pl-2 pr-3 outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--uix-color-focus)] ${
        active
          ? "border-[#D6B56F]/45 bg-[#1b2430] text-white shadow-[inset_0_-2px_0_#D6B56F]"
          : "border-white/[0.06] bg-white/[0.04] text-[#d5dde8] hover:bg-white/[0.07] hover:text-white"
      }`}
      onClick={onSelect}
      type="button"
    >
      <span className="grid h-[1.625rem] w-[1.625rem] shrink-0 place-items-center rounded-md border border-[#A07C3B]/55 bg-[#101820]">
        <span
          aria-hidden="true"
          className="block h-4 w-4 bg-contain bg-center bg-no-repeat"
          style={{ backgroundImage: `url("${brandSrc}")` }}
        />
      </span>
      <span className="text-[0.86rem] font-semibold tracking-[0.01em]">
        Panteon
      </span>
    </button>
  );
}

function ModuleTab({
  onClose,
  onSelect,
  tab,
}: {
  onClose: () => void;
  onSelect: () => void;
  tab: PanteonModuleTab;
}) {
  return (
    <div
      className={`flex h-[2.375rem] shrink-0 items-center gap-2 rounded-[9px] border pl-2.5 pr-1.5 transition ${
        tab.active
          ? "border-[#D6B56F]/45 bg-[#1b2430] text-white shadow-[inset_0_-2px_0_#D6B56F]"
          : "border-white/[0.06] bg-white/[0.04] text-[#c5ced9] hover:bg-white/[0.07] hover:text-white"
      }`}
    >
      <button
        className="flex min-w-0 items-center gap-2 outline-none focus-visible:ring-2 focus-visible:ring-[var(--uix-color-focus)]"
        onClick={onSelect}
        type="button"
      >
        <span className={tab.active ? "text-[#D6B56F]" : "text-[#9aa6b4]"}>
          {tab.icon}
        </span>
        <span className="max-w-[9rem] truncate text-[0.84rem] font-medium">
          {tab.label}
        </span>
        {/* Convencao visual do hub (Lucas 7/jul): DOURADO = novidade comum;
            VERMELHO = voce foi mencionado. Igual a lista de canais. */}
        {(tab.mentionUnread ?? 0) > 0 ? (
          <span className="grid min-h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[0.625rem] font-bold leading-none text-white">
            @{(tab.mentionUnread ?? 0) > 99 ? "99+" : tab.mentionUnread}
          </span>
        ) : tab.unread > 0 ? (
          <span className="grid min-h-4 min-w-4 place-items-center rounded-full bg-[#A07C3B] px-1 text-[0.625rem] font-bold leading-none text-white">
            {tab.unread > 99 ? "99+" : tab.unread}
          </span>
        ) : null}
      </button>
      <Tooltip content="Fechar aba" placement="bottom">
        <button
          aria-label={`Fechar ${tab.label}`}
          className="grid h-5 w-5 shrink-0 place-items-center rounded text-[#8b97a6] outline-none transition hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-[var(--uix-color-focus)]"
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" size={13} />
        </button>
      </Tooltip>
    </div>
  );
}
