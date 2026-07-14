"use client";

import Link from "next/link";
import { ContactRound, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Tooltip } from "@repo/uix";

import { apoloScreens, type ApoloScreen } from "@/lib/apolo/catalog";

// Sidebar lateral do Apolo, no padrao dos outros modulos (mesma pele
// panteon-module-sidebar do Hades), mas comandando a tela por estado interno
// (nao por rota). Por enquanto so o CRM 360 aparece; as demais telas ficam
// ocultas (hidden no catalogo) ate o Lucas liberar.

const visibleScreens = apoloScreens.filter((item) => !item.hidden);

export function ApoloSidebar({
  active,
  collapsed,
  onSelect,
  onToggle,
}: {
  active: ApoloScreen;
  collapsed: boolean;
  onSelect: (screen: ApoloScreen) => void;
  onToggle: () => void;
}) {
  return (
    <aside
      className={`panteon-module-sidebar fixed bottom-0 left-0 top-[3.25rem] z-30 hidden text-[#ECECF1] transition-[width] duration-300 ease-out lg:flex lg:flex-col ${
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
                className="grid h-10 w-10 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.035] text-[#d5dde8] outline-none transition hover:border-[#A07C3B]/45 hover:bg-white/[0.075] hover:text-white focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
              >
                <ContactRound className="size-[18px]" aria-hidden="true" />
              </Link>
            </Tooltip>
            <Tooltip content="Expandir sidebar" placement="right">
              <button
                type="button"
                onClick={onToggle}
                aria-label="Expandir sidebar"
                className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.075] text-ink-muted outline-none transition hover:border-white/[0.16] hover:bg-white/[0.07] hover:text-white focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
              >
                <PanelLeftOpen className="size-4" aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
        ) : (
          <div className="grid min-h-12 grid-cols-[minmax(0,1fr)_2rem] items-center gap-2 rounded-xl bg-white/[0.035] px-2.5 py-2">
            <Link
              aria-label="Voltar ao Panteon"
              href="/"
              className="flex min-w-0 items-center gap-2.5 text-[#d5dde8] outline-none transition hover:text-white focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/[0.08] bg-inverse">
                <ContactRound className="size-[18px]" aria-hidden="true" />
              </span>
              <span className="grid min-w-0 gap-0.5">
                <span className="min-w-0 truncate text-sm font-semibold leading-tight text-white">
                  Apolo
                </span>
              </span>
            </Link>
            <Tooltip content="Recolher sidebar" placement="right">
              <button
                type="button"
                onClick={onToggle}
                aria-label="Recolher sidebar"
                className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.075] text-ink-muted outline-none transition hover:border-white/[0.16] hover:bg-white/[0.07] hover:text-white focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
              >
                <PanelLeftClose className="size-4" aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
        )}
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-2.5 py-3">
        {visibleScreens.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.id;

          const botao = (
            <button
              type="button"
              onClick={() => onSelect(item.id)}
              aria-current={isActive ? "page" : undefined}
              className={`group relative grid min-h-[2.625rem] w-full items-center rounded-[0.625rem] border px-2.5 text-left text-sm font-medium transition-colors duration-150 ${
                collapsed
                  ? "grid-cols-1 justify-items-center px-0"
                  : "grid-cols-[2rem_minmax(0,1fr)] gap-x-3"
              } ${
                isActive
                  ? "border-[#A07C3B]/35 bg-[#171b23] text-white shadow-[inset_0_1px_0_rgb(255_255_255_/_0.04)]"
                  : "border-transparent text-[#c9d1dc] hover:border-white/[0.08] hover:bg-white/[0.075] hover:text-white"
              }`}
            >
              {isActive ? (
                <span className="absolute left-0 top-2 h-7 w-0.5 rounded-full bg-[#A07C3B]" />
              ) : null}
              <span
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
                  isActive
                    ? "panteon-module-sidebar__active-icon"
                    : "bg-white/[0.055] text-[#d5dde8] group-hover:bg-white/[0.085] group-hover:text-white"
                }`}
              >
                <Icon className="size-[17px] stroke-[1.75]" aria-hidden="true" />
              </span>
              <span
                className={`truncate transition-opacity duration-200 ${
                  collapsed ? "pointer-events-none w-0 opacity-0" : "opacity-100"
                }`}
              >
                {item.label}
              </span>
            </button>
          );

          return collapsed ? (
            <Tooltip
              key={item.id}
              content={item.label}
              placement="right"
              className="w-full"
              triggerClassName="w-full"
            >
              {botao}
            </Tooltip>
          ) : (
            <span key={item.id} className="block">
              {botao}
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
          CRM 360
        </p>
      </div>
    </aside>
  );
}
