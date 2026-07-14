import { Tooltip } from "@repo/uix";
import {
  CalendarClock,
  CalendarDays,
  FileText,
  PanelLeftClose,
  PanelLeftOpen,
  Video,
  type LucideIcon,
} from "lucide-react";

export type ChronosView = "agenda" | "rooms" | "drive";

const chronosNavigationItems: Array<{
  icon: LucideIcon;
  id: ChronosView;
  label: string;
}> = [
  { icon: CalendarDays, id: "agenda", label: "Agenda" },
  { icon: Video, id: "rooms", label: "Salas" },
  { icon: FileText, id: "drive", label: "Drive" },
];

type ChronosModuleSidebarProps = {
  activeView: ChronosView;
  collapsed: boolean;
  onSelect: (view: ChronosView) => void;
  onToggleCollapsed: () => void;
};

export function ChronosModuleSidebar({
  activeView,
  collapsed,
  onSelect,
  onToggleCollapsed,
}: ChronosModuleSidebarProps) {
  function _handleOpenModuleLauncher() {
    window.dispatchEvent(new Event("careli:toggle-module-launcher"));
  }

  return (
    <aside className="panteon-module-sidebar panteon-module-sidebar--themed flex h-full min-h-0 flex-col overflow-hidden border-r text-ink">
      <div className="panteon-module-sidebar__top">
        {collapsed ? (
          <div className="grid justify-items-center gap-2 pb-1 pt-0.5">
            <span className="grid h-10 w-10 place-items-center rounded-lg border border-[#A07C3B]/45 bg-[#101211] text-[#cba25a]">
              <CalendarClock aria-hidden="true" size={18} />
            </span>
            <Tooltip content="Expandir Chronos" placement="right">
              <button
                aria-label="Expandir sidebar Chronos"
                className="grid h-8 w-8 place-items-center rounded-lg border border-line text-ink-muted outline-none transition hover:border-line-strong hover:bg-black/[0.05] hover:text-ink dark:border-white/[0.08] dark:hover:border-white/[0.16] dark:hover:bg-white/[0.07] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                onClick={onToggleCollapsed}
                type="button"
              >
                <PanelLeftOpen aria-hidden="true" size={16} />
              </button>
            </Tooltip>
          </div>
        ) : (
          <div className="grid min-h-12 grid-cols-[minmax(0,1fr)_2rem] items-center gap-2 rounded-xl bg-black/[0.03] px-2.5 py-2 dark:bg-white/[0.035]">
            <div className="flex min-w-0 items-center gap-2.5 text-ink-soft">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[#A07C3B]/45 bg-[#101211] text-[#cba25a]">
                <CalendarClock aria-hidden="true" size={18} />
              </span>
              <span className="grid min-w-0 gap-0.5">
                <span className="min-w-0 truncate text-sm font-semibold leading-tight text-ink">
                  Chronos
                </span>
              </span>
            </div>
            <Tooltip content="Recolher Chronos" placement="right">
              <button
                aria-label="Recolher sidebar Chronos"
                className="grid h-8 w-8 place-items-center rounded-lg border border-line text-ink-muted outline-none transition hover:border-line-strong hover:bg-black/[0.05] hover:text-ink dark:border-white/[0.08] dark:hover:border-white/[0.16] dark:hover:bg-white/[0.07] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                onClick={onToggleCollapsed}
                type="button"
              >
                <PanelLeftClose aria-hidden="true" size={16} />
              </button>
            </Tooltip>
          </div>
        )}
      </div>

      <nav
        aria-label="Menu Chronos"
        className={`min-h-0 flex-1 overflow-y-auto py-3 ${
          collapsed ? "px-2" : "px-3"
        }`}
      >
        <div className="grid gap-1">
          {chronosNavigationItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            const button = (
              <button
                aria-current={isActive ? "page" : undefined}
                aria-label={collapsed ? item.label : undefined}
                className={`group relative flex h-10 w-full items-center gap-2 rounded-md px-2 text-left text-sm font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-[#A07C3B] ${
                  isActive
                    ? "border-transparent bg-black/[0.07] text-ink dark:bg-white/[0.08]"
                    : "text-ink-soft hover:bg-black/[0.04] hover:text-ink dark:hover:bg-white/[0.05]"
                } ${collapsed ? "justify-center" : ""}`}
                onClick={() => onSelect(item.id)}
                type="button"
              >
                {isActive ? (
                  <span
                    aria-hidden="true"
                    className="absolute left-0 top-1.5 h-7 w-0.5 rounded-full bg-[#A07C3B]"
                  />
                ) : null}
                <span
                  className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
                    isActive
                      ? "panteon-module-sidebar__active-icon"
                      : "text-ink-muted"
                  }`}
                >
                  <Icon
                    aria-hidden="true"
                    className="size-[17px] stroke-[1.75]"
                  />
                </span>
                <span className={`min-w-0 truncate ${collapsed ? "sr-only" : ""}`}>
                  {item.label}
                </span>
              </button>
            );

            return collapsed ? (
              <Tooltip content={item.label} key={item.id} placement="right">
                {button}
              </Tooltip>
            ) : (
              <div key={item.id}>{button}</div>
            );
          })}
        </div>
      </nav>

      <div className={`pb-5 pt-4 ${collapsed ? "px-3" : "px-6"}`}>
        <p
          className={`truncate text-xs font-medium uppercase tracking-[0.16em] text-ink-muted transition-opacity duration-200 ${
            collapsed ? "opacity-0" : "opacity-100"
          }`}
        >
          Enterprise
        </p>
      </div>
    </aside>
  );
}
