"use client";

import type { ReactNode } from "react";
import {
  Headphones,
  LayoutGrid,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon,
} from "lucide-react";
import { Tooltip } from "@repo/uix";

import { PanteonTopbarUser } from "@/components/panteon/panteon-topbar-user";

import { IrisNavButton } from "../shared/iris-ui";

export type IrisShellNavigationItem<TView extends string = string> = {
  icon: LucideIcon;
  id: TView;
  label: string;
};

export function IrisModuleShell<TView extends string>({
  activeView,
  children,
  collapsed,
  navigationItems,
  onOpenModuleLauncher,
  onSelectView,
  onToggleCollapsed,
}: {
  activeView: TView;
  children: ReactNode;
  collapsed: boolean;
  navigationItems: Array<IrisShellNavigationItem<TView>>;
  onOpenModuleLauncher: () => void;
  onSelectView: (view: TView) => void;
  onToggleCollapsed: () => void;
}) {
  return (
    <div
      className={[
        "grid h-full min-h-0 transition-[grid-template-columns] duration-200",
        collapsed
          ? "grid-cols-[72px_minmax(0,1fr)]"
          : "grid-cols-[240px_minmax(0,1fr)]",
      ].join(" ")}
    >
      <aside
        className={[
          "panteon-module-sidebar relative flex min-h-full flex-col border-r py-4 text-[#ECECF1] transition-all duration-200",
          collapsed ? "px-3" : "px-4",
        ].join(" ")}
      >
        <IrisSidebarHeader
          collapsed={collapsed}
          onOpenModuleLauncher={onOpenModuleLauncher}
          onToggleCollapsed={onToggleCollapsed}
        />

        <nav className="space-y-1">
          {navigationItems.map((item) => (
            <IrisNavButton
              key={item.id}
              active={activeView === item.id}
              collapsed={collapsed}
              icon={item.icon}
              label={item.label}
              onClick={() => onSelectView(item.id)}
            />
          ))}
        </nav>

        <div className="mt-auto" />
      </aside>

      <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
        <IrisTopbar />

        <section className="min-h-0 flex-1 overflow-hidden p-3">
          {children}
        </section>
      </main>
    </div>
  );
}

function IrisSidebarHeader({
  collapsed,
  onOpenModuleLauncher,
  onToggleCollapsed,
}: {
  collapsed: boolean;
  onOpenModuleLauncher: () => void;
  onToggleCollapsed: () => void;
}) {
  return (
    <div
      className={[
        "panteon-module-sidebar__top mb-4",
        collapsed ? "-mx-3 px-3" : "-mx-4 px-4",
      ].join(" ")}
    >
      {collapsed ? (
        <div className="grid justify-items-center gap-2 pb-1 pt-0.5">
          <span className="grid h-10 w-10 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.035] text-[#d5dde8]">
            <Headphones className="h-4 w-4" />
          </span>
          <Tooltip content="Abrir sidebar do Panteon" placement="right">
            <button
              type="button"
              onClick={onOpenModuleLauncher}
              aria-label="Abrir sidebar do Panteon"
              className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.075] text-[#a5afbd] outline-none transition hover:border-white/[0.16] hover:bg-white/[0.07] hover:text-white focus-visible:ring-2 focus-visible:ring-[#d0ad69]"
            >
              <LayoutGrid aria-hidden="true" size={15} />
            </button>
          </Tooltip>
          <Tooltip content="Expandir sidebar" placement="right">
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label="Expandir sidebar"
              className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.075] text-[#a5afbd] outline-none transition hover:border-white/[0.16] hover:bg-white/[0.07] hover:text-white focus-visible:ring-2 focus-visible:ring-[#d0ad69]"
            >
              <PanelLeftOpen aria-hidden="true" size={16} />
            </button>
          </Tooltip>
        </div>
      ) : (
        <div className="grid min-h-12 grid-cols-[minmax(0,1fr)_2rem_2rem] items-center gap-2 rounded-xl bg-white/[0.035] px-2.5 py-2">
          <div className="flex min-w-0 items-center gap-2.5 text-[#d5dde8]">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/[0.08] bg-[#101820]">
              <Headphones className="h-4 w-4" />
            </span>
            <span className="grid min-w-0 gap-0.5">
              <span className="min-w-0 truncate text-sm font-semibold leading-tight text-white">
                Iris
              </span>
            </span>
          </div>
          <Tooltip content="Abrir sidebar do Panteon" placement="right">
            <button
              type="button"
              onClick={onOpenModuleLauncher}
              aria-label="Abrir sidebar do Panteon"
              className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.075] text-[#a5afbd] outline-none transition hover:border-white/[0.16] hover:bg-white/[0.07] hover:text-white focus-visible:ring-2 focus-visible:ring-[#d0ad69]"
            >
              <LayoutGrid aria-hidden="true" size={15} />
            </button>
          </Tooltip>
          <Tooltip content="Recolher sidebar" placement="right">
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label="Recolher sidebar"
              className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.075] text-[#a5afbd] outline-none transition hover:border-white/[0.16] hover:bg-white/[0.07] hover:text-white focus-visible:ring-2 focus-visible:ring-[#d0ad69]"
            >
              <PanelLeftClose aria-hidden="true" size={16} />
            </button>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

function IrisTopbar() {
  return (
    <header className="sticky top-0 z-20 border-b border-[#dbe3ef] bg-white/95 px-4 py-3 backdrop-blur">
      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-[230px]">
          <h2 className="text-lg font-semibold text-[#101820]">Ticket</h2>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <PanteonTopbarUser className="ml-1 border-l border-[#dbe3ef] pl-3" compact />
        </div>
      </div>
    </header>
  );
}
