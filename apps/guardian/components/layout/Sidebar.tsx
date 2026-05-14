"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Brain,
  ChevronsLeft,
  ChevronsRight,
  Headphones,
  Inbox,
  LayoutDashboard,
  LineChart,
  Settings,
} from "lucide-react";

const menuItems = [
  { label: "Dashboard", icon: LayoutDashboard, href: "/" },
  { label: "Atendimento", icon: Headphones, href: "/atendimento" },
  { label: "Desk", icon: Inbox, href: "/desk", badge: "3" },
  { label: "Inteligência", icon: Brain, href: "/inteligencia" },
  { label: "Monitoramento", icon: LineChart, href: "/monitoramento" },
  { label: "Relatórios", icon: BarChart3, href: "#" },
  { label: "Setup", icon: Settings, href: "#" },
];

type SidebarProps = {
  collapsed: boolean;
  onToggle: () => void;
};

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 hidden bg-[#343541] text-[#ECECF1] transition-[width] duration-300 ease-out lg:flex lg:flex-col ${
        collapsed ? "w-[72px]" : "w-60"
      }`}
    >
      <div className="px-3 pb-5 pt-5">
        <div
          className={`relative flex h-12 items-center rounded-lg ${
            collapsed ? "justify-center px-0" : "justify-center px-3"
          }`}
        >
          <div className={`flex min-w-0 items-center ${collapsed ? "justify-center" : ""}`}>
            {collapsed ? (
              <Image
                src="/logoiconbranca.png"
                alt="Guardian"
                width={1976}
                height={2374}
                priority
                sizes="32px"
                className="h-8 w-auto object-contain"
              />
            ) : (
              <Image
                src="/logoCbranca.png"
                alt="Guardian"
                width={3300}
                height={2047}
                priority
                sizes="150px"
                className="h-11 w-auto max-w-[150px] object-contain"
              />
            )}
          </div>

          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? "Expandir sidebar" : "Recolher sidebar"}
            className={`absolute right-0 flex size-8 shrink-0 items-center justify-center rounded-lg text-[#C5C5D2] transition-colors hover:bg-[#2A2B32]/80 hover:text-[#ECECF1] ${
              collapsed ? "hidden" : ""
            }`}
          >
            <ChevronsLeft className="size-4" aria-hidden="true" />
          </button>
        </div>

        {collapsed ? (
          <button
            type="button"
            onClick={onToggle}
            aria-label="Expandir sidebar"
            className="mt-2 flex size-10 w-full items-center justify-center rounded-lg text-[#C5C5D2] transition-colors hover:bg-[#2A2B32]/80 hover:text-[#ECECF1]"
          >
            <ChevronsRight className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : item.href !== "#" && pathname.startsWith(item.href);

          return (
            <Link
              key={item.label}
              href={item.href}
              title={collapsed ? item.label : undefined}
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
                  collapsed ? "pointer-events-none w-0 opacity-0" : "opacity-100"
                }`}
              >
                {item.label}
              </span>
              {"badge" in item && item.badge ? (
                <span
                  className={`ml-auto rounded-full bg-[#A07C3B] px-2 py-0.5 text-[11px] font-semibold text-white transition-opacity duration-200 ${
                    collapsed ? "absolute right-2 top-2 min-w-4 px-1 text-[10px]" : "opacity-100"
                  }`}
                >
                  {item.badge}
                </span>
              ) : null}

              {collapsed ? (
                <span className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 z-50 -translate-y-1/2 rounded-lg bg-[#202123] px-2.5 py-1.5 text-xs font-medium text-[#ECECF1] opacity-0 shadow-[0_8px_24px_rgba(0,0,0,0.18)] transition-opacity group-hover:opacity-100">
                  {item.label}
                </span>
              ) : null}
            </Link>
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
