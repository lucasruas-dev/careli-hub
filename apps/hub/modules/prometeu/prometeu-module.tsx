"use client";

import {
  ChevronRight,
  ExternalLink,
  LayoutDashboard,
  ListOrdered,
  Mic,
  Settings,
  TabletSmartphone,
  Tag,
  Tv,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useHubTheme } from "@/providers/theme-provider";

import { CentralView } from "./blocks/central/central-view";
import { SetupView } from "./blocks/setup/setup-view";

// Prometeu no hub: rail escuro de telas a esquerda (mesmo visual do Iris) + conteudo a direita.
//
// A migracao mockup -> real esta EM CURSO. Telas com `component` ja leem as tabelas prometeu_*;
// as demais ainda sao o HTML de /public/prometeu (o desenho aprovado), e vao caindo uma a uma.

type PrometeuScreen = {
  // Tela React de verdade. Quando presente, ganha do `file`.
  component?: () => React.JSX.Element;
  file: string;
  icon: LucideIcon;
  id: string;
  label: string;
  // Telão roda uma TV por aba: abre em nova aba (URL publica), nao no iframe do hub.
  newTab?: boolean;
};

const ALL_SCREENS: readonly PrometeuScreen[] = [
  {
    component: CentralView,
    file: "cockpit.html",
    icon: LayoutDashboard,
    id: "central",
    label: "Central",
  },
  { file: "atendente.html", icon: TabletSmartphone, id: "atendente", label: "Atendente" },
  { file: "etiqueta.html", icon: Tag, id: "etiqueta", label: "Etiqueta" },
  { file: "telao.html", icon: Tv, id: "telao", label: "Telão", newTab: true },
  { file: "locutor.html", icon: Mic, id: "locutor", label: "Locutor" },
  {
    component: SetupView,
    file: "setup.html",
    icon: Settings,
    id: "setup",
    label: "Setup",
  },
];

export function PrometeuModule() {
  const [activeId, setActiveId] = useState<string>("central");
  const { mode } = useHubTheme();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const active =
    ALL_SCREENS.find((screen) => screen.id === activeId) ?? ALL_SCREENS[0];

  // O mock (iframe) e mesma-origem: sincronizamos o tema dele com o do hub. Usa o
  // setTheme() do proprio mock (atualiza tambem os botoes do toggle); se a tela nao
  // tiver toggle, cai no fallback de body.classList.
  const applyIframeTheme = useCallback(() => {
    try {
      const win = iframeRef.current?.contentWindow as
        | (Window & { setTheme?: (t: string) => void })
        | null;
      if (win?.setTheme) {
        win.setTheme(mode === "dark" ? "dark" : "light");
        return;
      }
      const body = iframeRef.current?.contentDocument?.body;
      if (body) {
        body.classList.toggle("dark", mode === "dark");
      }
    } catch {
      // cross-origin ou iframe ainda nao pronto: ignora
    }
  }, [mode]);

  useEffect(() => {
    applyIframeTheme();
  }, [applyIframeTheme, activeId]);

  if (!active) {
    return null;
  }

  return (
    <div className="flex h-full min-h-0">
      <aside className="panteon-module-sidebar panteon-module-sidebar--themed flex h-full min-h-0 w-[232px] shrink-0 flex-col px-3 py-4 text-ink">
        <div className="panteon-module-sidebar__top -mx-3 mb-2 flex items-center gap-2.5 px-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[#A07C3B]/55 bg-[#101820] text-[#cba25a]">
            <ListOrdered aria-hidden="true" size={18} />
          </span>
          <span className="text-[0.95rem] font-semibold tracking-[0.01em] text-ink">
            Prometeu
          </span>
        </div>

        <nav className="mt-1 flex-1 space-y-0.5 overflow-y-auto">
          {ALL_SCREENS.map((screen) => {
            const Icon = screen.icon;
            const isActive = !screen.newTab && screen.id === active.id;
            return (
              <button
                key={screen.id}
                className={`group relative flex w-full items-center gap-3 rounded-[9px] px-3 py-2 text-left transition-colors ${
                  isActive
                    ? "bg-black/[0.07] text-ink dark:bg-white/[0.08]"
                    : "text-ink-soft hover:bg-black/[0.04] hover:text-ink dark:hover:bg-white/[0.05]"
                }`}
                onClick={() => {
                  if (screen.newTab) {
                    window.open(
                      `/prometeu/${screen.file}`,
                      "_blank",
                      "noopener,noreferrer",
                    );
                    return;
                  }
                  setActiveId(screen.id);
                }}
                type="button"
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
                  <Icon aria-hidden="true" size={17} />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {screen.label}
                </span>
                {screen.newTab ? (
                  <ExternalLink
                    aria-hidden="true"
                    className="text-ink-muted"
                    size={15}
                  />
                ) : isActive ? (
                  <ChevronRight
                    aria-hidden="true"
                    className="text-ink-muted"
                    size={15}
                  />
                ) : null}
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="min-w-0 flex-1 bg-canvas">
        {active.component ? (
          <active.component />
        ) : (
          <iframe
            key={active.id}
            ref={iframeRef}
            onLoad={applyIframeTheme}
            className="block h-full w-full border-0"
            src={`/prometeu/${active.file}`}
            title={`Prometeu · ${active.label}`}
          />
        )}
      </main>
    </div>
  );
}
