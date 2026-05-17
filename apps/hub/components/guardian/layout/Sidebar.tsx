/* eslint-disable */
// @ts-nocheck
"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Tooltip } from "@repo/uix";
import {
  BarChart3,
  Bot,
  Inbox,
  LayoutDashboard,
  LayoutGrid,
  LineChart,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  WalletCards,
} from "lucide-react";

const menuItems = [
  {
    label: "Dashboard",
    icon: LayoutDashboard,
    href: "/guardian",
    released: true,
  },
  {
    label: "Cobrança",
    icon: WalletCards,
    href: "/guardian/cobranca",
    released: true,
  },
  {
    label: "CareDesk",
    icon: Inbox,
    href: "/caredesk",
    badge: "3",
    released: false,
  },
  {
    label: "Inteligência",
    icon: Bot,
    href: "/guardian/inteligencia",
    released: false,
  },
  {
    label: "Monitoramento",
    icon: LineChart,
    href: "/guardian/monitoramento",
    released: false,
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
      className={`fixed inset-y-0 left-0 z-40 hidden bg-[#343541] text-[#ECECF1] transition-[width] duration-300 ease-out lg:flex lg:flex-col ${
        collapsed ? "w-[72px]" : "w-60"
      }`}
    >
      <div className="px-3 pb-5 pt-4">
        <div className="relative grid gap-2 rounded-lg">
          {collapsed ? (
            <Tooltip
              content="Voltar ao Hub"
              placement="right"
              className="justify-self-center"
            >
              <Link
                aria-label="Voltar ao Hub"
                href="/"
                className="flex h-10 w-10 min-w-0 items-center justify-center rounded-lg outline-none transition hover:opacity-85 focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
              >
                <Image
                  src="/logoiconbranca.png"
                  alt="Guardian"
                  width={1976}
                  height={2374}
                  priority
                  sizes="32px"
                  className="h-8 w-8 object-contain"
                />
              </Link>
            </Tooltip>
          ) : (
            <Tooltip
              content="Voltar ao Hub"
              placement="bottom"
              className="w-full"
              triggerClassName="w-full"
            >
              <Link
                aria-label="Voltar ao Hub"
                href="/"
                className="flex h-12 min-w-0 items-center justify-center rounded-lg outline-none transition hover:opacity-85 focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
              >
                <Image
                  src="/logoCbranca.png"
                  alt="Guardian"
                  width={3300}
                  height={2047}
                  priority
                  sizes="150px"
                  className="h-11 w-auto max-w-[150px] object-contain"
                />
              </Link>
            </Tooltip>
          )}

          <div
            className={`grid items-center ${
              collapsed
                ? "w-full justify-items-center gap-2"
                : "grid-cols-2 gap-2"
            }`}
          >
            <Tooltip
              content="Abrir sidebar do Hub"
              placement={collapsed ? "right" : "bottom"}
              className={collapsed ? "w-full" : undefined}
              triggerClassName={collapsed ? "w-full" : undefined}
            >
              <button
                type="button"
                onClick={handleOpenModuleLauncher}
                aria-label="Abrir sidebar do Hub"
                className={`grid shrink-0 place-items-center rounded-lg border border-white/[0.075] bg-white/[0.055] text-[#C5C5D2] outline-none transition hover:border-white/[0.16] hover:bg-white/[0.07] hover:text-[#ECECF1] focus-visible:ring-2 focus-visible:ring-[#A07C3B] ${
                  collapsed ? "h-10 w-full" : "h-8 w-8"
                }`}
              >
                  <LayoutGrid className="size-[15px]" aria-hidden="true" />
              </button>
            </Tooltip>
            <Tooltip
              content={collapsed ? "Expandir sidebar" : "Recolher sidebar"}
              placement={collapsed ? "right" : "bottom"}
              className={collapsed ? "w-full" : undefined}
              triggerClassName={collapsed ? "w-full" : undefined}
            >
              <button
                type="button"
                onClick={onToggle}
                aria-label={collapsed ? "Expandir sidebar" : "Recolher sidebar"}
                className={`grid shrink-0 place-items-center rounded-lg border border-white/[0.075] text-[#C5C5D2] outline-none transition hover:border-white/[0.16] hover:bg-white/[0.07] hover:text-[#ECECF1] focus-visible:ring-2 focus-visible:ring-[#A07C3B] ${
                  collapsed ? "h-10 w-full" : "h-8 w-8"
                }`}
              >
                {collapsed ? (
                  <PanelLeftOpen className="size-4" aria-hidden="true" />
                ) : (
                  <PanelLeftClose className="size-4" aria-hidden="true" />
                )}
              </button>
            </Tooltip>
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {visibleMenuItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            item.href === "/guardian"
              ? pathname === "/guardian"
              : item.href !== "#" && pathname.startsWith(item.href);

          const link = (
            <Link
              href={item.href}
              className={`group relative flex h-11 items-center rounded-lg px-3 text-sm font-medium transition-colors duration-150 ${
                collapsed ? "justify-center" : "gap-3"
              } ${
                isActive
                  ? "bg-[#2A2B32] text-[#ECECF1]"
                  : "text-[#C5C5D2] hover:bg-[#2A2B32]/80 hover:text-[#ECECF1]"
              }`}
            >
              {isActive ? (
                <span className="absolute left-0 top-2 h-7 w-0.5 rounded-full bg-[#A07C3B]" />
              ) : null}
              <Icon
                className={`size-[17px] shrink-0 stroke-[1.75] ${
                  isActive ? "text-[#D5B46F]" : "text-[#8E8EA0]"
                }`}
                aria-hidden="true"
              />
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
          className={`truncate text-xs font-medium uppercase tracking-[0.16em] text-[#8E8EA0] transition-opacity duration-200 ${
            collapsed ? "opacity-0" : "opacity-100"
          }`}
        >
          Enterprise
        </p>
      </div>
    </aside>
  );
}
