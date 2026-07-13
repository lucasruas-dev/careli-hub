/* eslint-disable */
// @ts-nocheck
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Tooltip } from "@repo/uix";
import {
  BarChart3,
  Bot,
  ChevronRight,
  Inbox,
  LayoutDashboard,
  LayoutGrid,
  LineChart,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldCheck,
  WalletCards,
} from "lucide-react";

const menuItems = [
  {
    label: "Dashboard",
    icon: LayoutDashboard,
    href: "/hades",
    released: true,
  },
  {
    label: "Cobrança",
    icon: WalletCards,
    href: "/hades/cobranca",
    released: true,
  },
  {
    label: "Iris",
    icon: Inbox,
    href: "/iris",
    released: false,
  },
  {
    label: "Inteligência",
    icon: Bot,
    href: "/hades/inteligencia",
    released: true,
  },
  {
    label: "Monitoramento",
    icon: LineChart,
    href: "/hades/monitoramento",
    released: true,
  },
  { label: "Relatórios", icon: BarChart3, href: "#", released: false },
  { label: "Setup", icon: Settings, href: "#", released: false },
];
const visibleMenuItems = menuItems.filter((item) => item.released);

type SidebarProps = {
  collapsed: boolean;
  onToggle: () => void;
};

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();

  function handleOpenModuleLauncher() {
    window.dispatchEvent(new Event("careli:toggle-module-launcher"));
  }

  return (
    <aside
      className={`panteon-module-sidebar panteon-module-sidebar--themed fixed bottom-0 left-0 top-[3.25rem] z-30 hidden text-ink transition-[width] duration-300 ease-out lg:flex lg:flex-col ${
        collapsed ? "w-[72px]" : "w-60"
      }`}
    >
      <div className="panteon-module-sidebar__top">
        {collapsed ? (
          <div className="grid justify-items-center gap-2 pb-1 pt-0.5">
            <Tooltip content="Voltar ao Panteon" placement="right">
              <Link
                aria-label="Voltar ao Panteon"
                href="/"
                className="grid h-10 w-10 place-items-center rounded-lg border border-[#A07C3B]/55 bg-[#101820] text-[#cba25a] outline-none transition hover:border-[#A07C3B]/75 focus-visible:ring-2 focus-visible:ring-[#d0ad69]"
              >
                <ShieldCheck className="size-[18px]" aria-hidden="true" />
              </Link>
            </Tooltip>
            <Tooltip content="Expandir sidebar" placement="right">
              <button
                type="button"
                onClick={onToggle}
                aria-label="Expandir sidebar"
                className="grid h-8 w-8 place-items-center rounded-lg border border-line text-ink-muted outline-none transition hover:border-line-strong hover:bg-black/[0.05] hover:text-ink dark:border-white/[0.08] dark:hover:border-white/[0.16] dark:hover:bg-white/[0.07] focus-visible:ring-2 focus-visible:ring-[#d0ad69]"
              >
                <PanelLeftOpen className="size-4" aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
        ) : (
          <div className="grid min-h-12 grid-cols-[minmax(0,1fr)_2rem] items-center gap-2 rounded-xl bg-black/[0.03] px-2.5 py-2 dark:bg-white/[0.035]">
            <Link
              aria-label="Voltar ao Panteon"
              href="/"
              className="flex min-w-0 items-center gap-2.5 text-ink outline-none transition hover:text-ink focus-visible:ring-2 focus-visible:ring-[#d0ad69]"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[#A07C3B]/55 bg-[#101820] text-[#cba25a]">
                <ShieldCheck className="size-[18px]" aria-hidden="true" />
              </span>
              <span className="grid min-w-0 gap-0.5">
                <span className="min-w-0 truncate text-sm font-semibold leading-tight text-ink">
                  Hades
                </span>
              </span>
            </Link>
            <Tooltip content="Recolher sidebar" placement="right">
              <button
                type="button"
                onClick={onToggle}
                aria-label="Recolher sidebar"
                className="grid h-8 w-8 place-items-center rounded-lg border border-line text-ink-muted outline-none transition hover:border-line-strong hover:bg-black/[0.05] hover:text-ink dark:border-white/[0.08] dark:hover:border-white/[0.16] dark:hover:bg-white/[0.07] focus-visible:ring-2 focus-visible:ring-[#d0ad69]"
              >
                <PanelLeftClose className="size-4" aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
        )}
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-2.5 py-3">
        {visibleMenuItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            item.href === "/hades"
              ? pathname === "/hades"
              : item.href !== "#" && pathname.startsWith(item.href);

          const link = (
            <Link
              href={item.href}
              className={`group relative grid min-h-[2.625rem] items-center rounded-[0.625rem] px-2.5 text-sm font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-[#d0ad69] ${
                collapsed
                  ? "w-[2.625rem] grid-cols-1 justify-items-center px-0"
                  : "grid-cols-[2rem_minmax(0,1fr)_auto] gap-x-3"
              } ${
                isActive
                  ? "bg-black/[0.07] text-ink dark:bg-white/[0.08]"
                  : "text-ink-soft hover:bg-black/[0.04] hover:text-ink dark:hover:bg-white/[0.05]"
              }`}
            >
              {isActive ? (
                <span className="absolute left-0 top-2 h-7 w-0.5 rounded-full bg-[#A07C3B]" />
              ) : null}
              <span
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
                  isActive
                    ? "panteon-module-sidebar__active-icon"
                    : "text-ink-muted"
                }`}
              >
                <Icon
                  className="size-[17px] stroke-[1.75]"
                  aria-hidden="true"
                />
              </span>
              <span
                className={`truncate transition-opacity duration-200 ${
                  collapsed
                    ? "pointer-events-none w-0 opacity-0"
                    : "opacity-100"
                }`}
              >
                {item.label}
              </span>
              {"badge" in item && item.badge ? (
                <span
                  className={`ml-auto rounded-full bg-[#A07C3B] px-2 py-0.5 text-[11px] font-semibold text-white transition-opacity duration-200 ${
                    collapsed
                      ? "absolute right-2 top-2 min-w-4 px-1 text-[10px]"
                      : "opacity-100"
                  }`}
                >
                  {item.badge}
                </span>
              ) : isActive && !collapsed ? (
                <ChevronRight className="ml-auto size-4 text-ink-muted" aria-hidden="true" />
              ) : null}
            </Link>
          );

          return collapsed ? (
            <Tooltip
              key={item.label}
              content={item.label}
              placement="right"
              className="w-full"
              triggerClassName="w-full"
            >
              {link}
            </Tooltip>
          ) : (
            <span key={item.label} className="block">
              {link}
            </span>
          );
        })}
      </nav>

      <div className={`pb-5 pt-4 ${collapsed ? "px-3" : "px-6"}`}>
        <p
          className={`truncate text-xs font-medium tracking-[0.16em] text-ink-muted transition-opacity duration-200 ${
            collapsed ? "opacity-0" : "opacity-100"
          }`}
        >
          Enterprise
        </p>
      </div>
    </aside>
  );
}
