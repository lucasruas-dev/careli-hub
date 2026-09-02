"use client";

import { Tooltip } from "@repo/uix";
import { FileSignature, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Link from "next/link";

import { temisScreens, type TemisScreen } from "@/lib/temis/catalog";

// Sidebar da Têmis, na mesma pele dos outros módulos (`panteon-module-sidebar`), comandando a tela
// por estado interno — o mesmo desenho do Apolo, para quem já usa o Panteon não precisar reaprender.

const visiveis = temisScreens.filter((item) => !item.hidden);

export function TemisSidebar({
  aoAlternar,
  aoSelecionar,
  ativa,
  recolhida,
}: {
  aoAlternar: () => void;
  aoSelecionar: (tela: TemisScreen) => void;
  ativa: TemisScreen;
  recolhida: boolean;
}) {
  return (
    <aside
      className={`panteon-module-sidebar panteon-module-sidebar--themed fixed bottom-0 left-0 top-[3.25rem] z-30 hidden text-ink transition-[width] duration-300 ease-out lg:flex lg:flex-col ${
        recolhida ? "w-[72px]" : "w-60"
      }`}
    >
      <div className="panteon-module-sidebar__top">
        {recolhida ? (
          <div className="grid justify-items-center gap-2 pb-1 pt-0.5">
            <Tooltip content="Voltar ao Panteon" placement="right">
              <Link
                aria-label="Voltar ao Panteon"
                className="grid h-10 w-10 place-items-center rounded-lg border border-[#A07C3B]/55 bg-[#101211] text-[#cba25a] outline-none transition hover:border-[#A07C3B]/75 focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                href="/"
              >
                <FileSignature aria-hidden="true" className="size-[18px]" />
              </Link>
            </Tooltip>
            <Tooltip content="Expandir sidebar" placement="right">
              <button
                aria-label="Expandir sidebar"
                className="grid h-8 w-8 place-items-center rounded-lg border border-line text-ink-muted outline-none transition hover:border-line-strong hover:bg-black/[0.05] hover:text-ink focus-visible:ring-2 focus-visible:ring-[#A07C3B] dark:border-white/[0.08] dark:hover:border-white/[0.16] dark:hover:bg-white/[0.07]"
                onClick={aoAlternar}
                type="button"
              >
                <PanelLeftOpen aria-hidden="true" className="size-4" />
              </button>
            </Tooltip>
          </div>
        ) : (
          <div className="grid min-h-12 grid-cols-[minmax(0,1fr)_2rem] items-center gap-2 rounded-xl bg-black/[0.03] px-2.5 py-2 dark:bg-white/[0.035]">
            <Link
              aria-label="Voltar ao Panteon"
              className="flex min-w-0 items-center gap-2.5 text-ink outline-none transition hover:text-ink focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
              href="/"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[#A07C3B]/45 bg-[#101211] text-[#cba25a]">
                <FileSignature aria-hidden="true" className="size-[18px]" />
              </span>
              <span className="grid min-w-0 gap-0.5">
                <span className="min-w-0 truncate text-sm font-semibold leading-tight text-ink">
                  Têmis
                </span>
              </span>
            </Link>
            <Tooltip content="Recolher sidebar" placement="right">
              <button
                aria-label="Recolher sidebar"
                className="grid h-8 w-8 place-items-center rounded-lg border border-line text-ink-muted outline-none transition hover:border-line-strong hover:bg-black/[0.05] hover:text-ink focus-visible:ring-2 focus-visible:ring-[#A07C3B] dark:border-white/[0.08] dark:hover:border-white/[0.16] dark:hover:bg-white/[0.07]"
                onClick={aoAlternar}
                type="button"
              >
                <PanelLeftClose aria-hidden="true" className="size-4" />
              </button>
            </Tooltip>
          </div>
        )}
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-2.5 py-3">
        {visiveis.map((item) => {
          const Icon = item.icon;
          const ativo = ativa === item.id;

          const botao = (
            <button
              aria-current={ativo ? "page" : undefined}
              className={`group relative grid min-h-[2.625rem] w-full items-center rounded-[0.625rem] border px-2.5 text-left text-sm font-medium transition-colors duration-150 ${
                recolhida
                  ? "grid-cols-1 justify-items-center px-0"
                  : "grid-cols-[2rem_minmax(0,1fr)] gap-x-3"
              } ${
                ativo
                  ? "border-transparent bg-black/[0.07] text-ink dark:bg-white/[0.08]"
                  : "border-transparent text-ink-soft hover:bg-black/[0.04] hover:text-ink dark:hover:bg-white/[0.05]"
              }`}
              onClick={() => aoSelecionar(item.id)}
              type="button"
            >
              {ativo ? (
                <span className="absolute left-0 top-2 h-7 w-0.5 rounded-full bg-[#A07C3B]" />
              ) : null}
              <span
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
                  ativo ? "panteon-module-sidebar__active-icon" : "text-ink-muted"
                }`}
              >
                <Icon aria-hidden="true" className="size-[17px] stroke-[1.75]" />
              </span>
              <span
                className={`truncate transition-opacity duration-200 ${
                  recolhida ? "pointer-events-none w-0 opacity-0" : "opacity-100"
                }`}
              >
                {item.label}
              </span>
            </button>
          );

          return recolhida ? (
            <Tooltip
              className="w-full"
              content={item.label}
              key={item.id}
              placement="right"
              triggerClassName="w-full"
            >
              {botao}
            </Tooltip>
          ) : (
            <span className="block" key={item.id}>
              {botao}
            </span>
          );
        })}
      </nav>
    </aside>
  );
}
