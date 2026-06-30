"use client";

import type {
  HermesChannel,
  HermesDepartment,
  HermesMessage,
  HermesMessageFilter,
  HermesPresenceUser,
} from "@/lib/pulsex";
import {
  getHermesShortcutChannels,
  getHermesShortcutCounts,
  type HermesShortcutFilter,
} from "@/lib/pulsex/shortcuts";
import { useOutsideDismiss } from "@/hooks/use-outside-dismiss";
import { PanteonLoadingMark } from "@/components/panteon/panteon-loading";
import { Tooltip } from "@repo/uix";
import {
  AtSign,
  Building2,
  ChevronDown,
  ChevronRight,
  LayoutGrid,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Star,
  SlidersHorizontal,
  X,
  Zap,
  Users,
} from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { ConversationList } from "./conversation-list";

type ConversationSidebarProps = {
  activeChannelId: string;
  activeMessageFilter: HermesMessageFilter;
  activeShortcutFilter: HermesShortcutFilter | null;
  channels: readonly HermesChannel[];
  currentUserId: HermesPresenceUser["id"];
  dataStatus?: "fallback" | "loading" | "ready";
  departments: readonly HermesDepartment[];
  favoriteChannelIds: readonly HermesChannel["id"][];
  isCollapsed?: boolean;
  messages: readonly HermesMessage[];
  onSelectChannel?: (channelId: HermesChannel["id"]) => void;
  onSelectMessageFilter?: (filter: HermesMessageFilter) => void;
  onSelectShortcut?: (shortcut: HermesShortcutFilter) => void;
  onToggleCollapsed?: () => void;
  onRefresh?: () => void;
  users: readonly HermesPresenceUser[];
};

type SidebarGroupId = string;

const messageFilters = [
  { id: "all", label: "Todas" },
  { id: "mentions", label: "Mencoes" },
  { id: "urgente", label: "Urgentes" },
  { id: "importante", label: "Importantes" },
  { id: "pendente", label: "Pendentes" },
  { id: "resolvido", label: "Resolvidas" },
  { id: "acompanhar", label: "Acompanhar" },
] as const satisfies readonly {
  id: HermesMessageFilter;
  label: string;
}[];

export function ConversationSidebar({
  activeChannelId,
  activeMessageFilter,
  activeShortcutFilter,
  channels,
  currentUserId,
  dataStatus = "ready",
  departments,
  favoriteChannelIds,
  isCollapsed = false,
  messages,
  onSelectChannel,
  onSelectMessageFilter,
  onSelectShortcut,
  onToggleCollapsed,
  users,
}: ConversationSidebarProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<
    Record<SidebarGroupId, boolean>
  >({});
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const filtersRef = useRef<HTMLDivElement>(null);
  const shortcutsRef = useRef<HTMLDivElement>(null);
  const shortcutCounts = getHermesShortcutCounts({
    channels,
    currentUserId,
    favoriteChannelIds,
    messages,
  });
  const unreadCount = shortcutCounts.unread;
  const mentionsCount = shortcutCounts.mentions;
  const favoritesCount = shortcutCounts.favorites;
  const shortcutsCount = unreadCount + mentionsCount + favoritesCount;
  const activeFilterLabel =
    messageFilters.find((filter) => filter.id === activeMessageFilter)?.label ??
    "Todas";

  useOutsideDismiss({
    enabled: isFilterOpen,
    onDismiss: () => setIsFilterOpen(false),
    ref: filtersRef,
  });
  useOutsideDismiss({
    enabled: isShortcutsOpen,
    onDismiss: () => setIsShortcutsOpen(false),
    ref: shortcutsRef,
  });

  const shortcutChannels = getHermesShortcutChannels({
    channels,
    currentUserId,
    favoriteChannelIds,
    messages,
    shortcut: activeShortcutFilter,
  });
  const directChannels = shortcutChannels.filter(
    (channel) => channel.kind === "direct",
  );
  const departmentGroups = buildDepartmentGroups({
    channels: shortcutChannels.filter((channel) => channel.kind !== "direct"),
    departments,
  });
  const collapsedChannels = [
    ...departmentGroups.flatMap((group) =>
      group.sectors.flatMap((sector) => sector.channels),
    ),
    ...directChannels,
  ];

  function toggleGroup(groupId: SidebarGroupId) {
    setCollapsedGroups((currentGroups) => ({
      ...currentGroups,
      [groupId]: !currentGroups[groupId],
    }));
  }

  function handleOpenModuleLauncher() {
    window.dispatchEvent(new Event("careli:toggle-module-launcher"));
  }

  return (
    <aside className="panteon-module-sidebar flex h-full w-full flex-col overflow-hidden border-r">
      <div className="panteon-module-sidebar__top shrink-0">
        {isCollapsed ? (
          <div className="grid justify-items-center gap-2 pb-1 pt-0.5">
            <span className="grid h-10 w-10 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.035] text-[#d5dde8]">
              <MessageSquareText aria-hidden="true" size={18} />
            </span>
            <Tooltip content="Expandir sidebar" placement="right">
              <button
                aria-label="Expandir sidebar"
                aria-pressed={isCollapsed}
                className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.075] text-[#a5afbd] outline-none transition hover:border-white/[0.16] hover:bg-white/[0.07] hover:text-white focus-visible:ring-2 focus-visible:ring-[#d0ad69]"
                onClick={onToggleCollapsed}
                type="button"
              >
                <PanelLeftOpen aria-hidden="true" size={16} />
              </button>
            </Tooltip>
          </div>
        ) : (
          <div className="grid min-h-12 grid-cols-[minmax(0,1fr)_2rem] items-center gap-2 rounded-xl bg-white/[0.035] px-2.5 py-2">
            <div className="flex min-w-0 items-center gap-2.5 text-[#d5dde8]">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/[0.08] bg-[#101820]">
                <MessageSquareText aria-hidden="true" size={18} />
              </span>
              <span className="grid min-w-0 gap-0.5">
                <span className="min-w-0 truncate text-sm font-semibold leading-tight text-white">
                  Hermes
                </span>
              </span>
            </div>
            <span className="sr-only">{users.length} usuarios carregados</span>
            <Tooltip content="Recolher sidebar" placement="right">
              <button
                aria-label="Recolher sidebar"
                aria-pressed={isCollapsed}
                className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.075] text-[#a5afbd] outline-none transition hover:border-white/[0.16] hover:bg-white/[0.07] hover:text-white focus-visible:ring-2 focus-visible:ring-[#d0ad69]"
                onClick={onToggleCollapsed}
                type="button"
              >
                <PanelLeftClose aria-hidden="true" size={16} />
              </button>
            </Tooltip>
          </div>
        )}
        {isCollapsed ? null : (
          <>
            <label className="mt-4 block">
              <span className="sr-only">Buscar conversa</span>
              <span className="flex h-10 items-center gap-2 rounded-md border border-white/[0.09] bg-white/[0.06] px-3 text-[#a5afbd] focus-within:border-[#A07C3B] focus-within:bg-white/[0.075]">
                <Search aria-hidden="true" size={16} />
                <input
                  className="min-w-0 flex-1 bg-transparent text-sm text-[#f7f8fa] outline-none placeholder:text-[#a5afbd]"
                  placeholder="Buscar conversa..."
                />
              </span>
            </label>
            <div className="relative mt-2" ref={filtersRef}>
              <button
                aria-expanded={isFilterOpen}
                className="flex h-8 w-full items-center justify-between rounded-md px-2 text-sm text-[#c9d1dc] outline-none transition hover:bg-white/[0.065] hover:text-white focus-visible:ring-2 focus-visible:ring-[#d0ad69]"
                onClick={() => setIsFilterOpen((currentValue) => !currentValue)}
                type="button"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <SlidersHorizontal aria-hidden="true" size={15} />
                  <span className="truncate">
                    {activeMessageFilter === "all"
                      ? "Filtros"
                      : `Filtros / ${activeFilterLabel}`}
                  </span>
                </span>
                {activeMessageFilter === "all" ? null : (
                  <span className="rounded-full bg-[#A07C3B]/25 px-1.5 py-0.5 text-[0.62rem] font-semibold text-[#f2d79b]">
                    1
                  </span>
                )}
              </button>
              {isFilterOpen ? (
                <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-white/[0.085] bg-[#2A2B32] py-1 shadow-xl">
                  {messageFilters.map((filter) => (
                    <button
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-[#c9d1dc] outline-none transition hover:bg-white/[0.065] hover:text-white focus-visible:bg-white/[0.065] data-[active=true]:text-white"
                      data-active={filter.id === activeMessageFilter}
                      key={filter.id}
                      onClick={() => {
                        onSelectMessageFilter?.(filter.id);
                        setIsFilterOpen(false);
                      }}
                      type="button"
                    >
                      {filter.label}
                      {filter.id === activeMessageFilter ? (
                        <span className="h-1.5 w-1.5 rounded-full bg-[#A07C3B]" />
                      ) : null}
                    </button>
                  ))}
                  {activeMessageFilter === "all" ? null : (
                    <button
                      className="flex w-full items-center gap-2 border-t border-white/[0.07] px-3 py-2 text-left text-sm text-[#a5afbd] outline-none transition hover:bg-white/[0.065] hover:text-white focus-visible:bg-white/[0.065]"
                      onClick={() => {
                        onSelectMessageFilter?.("all");
                        setIsFilterOpen(false);
                      }}
                      type="button"
                    >
                      <X aria-hidden="true" size={14} />
                      Limpar filtro
                    </button>
                  )}
                </div>
              ) : null}
            </div>
            <div className="mt-2" ref={shortcutsRef}>
              <button
                aria-controls="pulsex-shortcuts-panel"
                aria-expanded={isShortcutsOpen}
                className="flex h-8 w-full items-center justify-between rounded-md px-2 text-sm text-[#c9d1dc] outline-none transition hover:bg-white/[0.065] hover:text-white focus-visible:ring-2 focus-visible:ring-[#d0ad69]"
                onClick={() =>
                  setIsShortcutsOpen((currentValue) => !currentValue)
                }
                type="button"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Zap aria-hidden="true" size={15} />
                  <span className="truncate">Atalhos</span>
                </span>
                <span className="flex items-center gap-2">
                  {shortcutsCount > 0 ? (
                    <span className="rounded-full bg-white/[0.09] px-1.5 py-0.5 text-[0.62rem] font-semibold text-[#f7f8fa]">
                      {shortcutsCount}
                    </span>
                  ) : null}
                  <ChevronDown
                    aria-hidden="true"
                    className="transition-transform duration-200 ease-out data-[open=false]:-rotate-90"
                    data-open={isShortcutsOpen}
                    size={14}
                  />
                </span>
              </button>
              <div
                className="grid grid-rows-[0fr] opacity-0 transition-[grid-template-rows,opacity,margin] duration-200 ease-out data-[open=true]:mt-2 data-[open=true]:grid-rows-[1fr] data-[open=true]:opacity-100"
                data-open={isShortcutsOpen}
                id="pulsex-shortcuts-panel"
              >
                <div className="min-h-0 overflow-hidden">
                  {isShortcutsOpen ? (
                    <div className="grid grid-cols-3 gap-2 text-sm">
                      <QuickAction
                        active={activeShortcutFilter === "unread"}
                        icon={<MessageSquareText size={15} />}
                        label="Nao lidas"
                        onClick={() => onSelectShortcut?.("unread")}
                        value={unreadCount}
                      />
                      <QuickAction
                        active={activeShortcutFilter === "mentions"}
                        icon={<AtSign size={15} />}
                        label="Mencoes"
                        onClick={() => onSelectShortcut?.("mentions")}
                        value={mentionsCount}
                      />
                      <QuickAction
                        active={activeShortcutFilter === "favorites"}
                        icon={<Star size={15} />}
                        label="Favoritos"
                        onClick={() => onSelectShortcut?.("favorites")}
                        value={favoritesCount}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
      <div
        className={`min-h-0 flex-1 overflow-auto ${
          isCollapsed ? "px-2 py-2" : "py-2"
        }`}
      >
        {isCollapsed ? (
          collapsedChannels.length > 0 ? (
            <ConversationList
              activeChannelId={activeChannelId}
              channels={collapsedChannels}
              collapsed
              onSelectChannel={onSelectChannel}
            />
          ) : null
        ) : departmentGroups.length > 0 ? (
          departmentGroups.map((group) => (
            <SidebarSection
              collapsed={collapsedGroups[group.id] ?? false}
              icon={<Building2 size={14} />}
              key={group.id}
              onToggle={() => toggleGroup(group.id)}
              title={group.name}
              unreadCount={group.unreadCount}
            >
              <div className="grid gap-2">
                {group.sectors.map((sector) => (
                  <div className="grid gap-1" key={sector.id}>
                    {sector.name ? (
                      <p className="m-0 px-4 text-[0.66rem] font-semibold uppercase text-[#7f8a99]">
                        {sector.name}
                      </p>
                    ) : null}
                    <ConversationList
                      activeChannelId={activeChannelId}
                      channels={sector.channels}
                      onSelectChannel={onSelectChannel}
                    />
                  </div>
                ))}
              </div>
            </SidebarSection>
          ))
        ) : (
          <p className="m-0 px-4 py-2 text-xs text-[#a5afbd]">
            {activeShortcutFilter
              ? "Nenhum canal neste atalho."
              : dataStatus === "fallback"
              ? "Nao foi possivel carregar canais."
              : "Nenhum canal configurado."}
          </p>
        )}
        {isCollapsed ? null : (
          <SidebarSection
            collapsed={collapsedGroups.directs ?? false}
            icon={<Users size={14} />}
            onToggle={() => toggleGroup("directs")}
            title="Diretas"
            unreadCount={directChannels.reduce(
              (total, channel) => total + (channel.unreadCount ?? 0),
              0,
            )}
          >
            {directChannels.length > 0 ? (
              <ConversationList
                activeChannelId={activeChannelId}
                channels={directChannels}
                onSelectChannel={onSelectChannel}
              />
            ) : (
              <p className="m-0 px-4 py-2 text-xs text-[#a5afbd]">
                {activeShortcutFilter
                  ? "Nenhuma direta neste atalho."
                  : "Nenhum usuario disponivel."}
              </p>
            )}
          </SidebarSection>
        )}
      </div>
      {!isCollapsed && dataStatus !== "ready" ? (
        <div className="border-t border-white/[0.075] px-4 py-2 text-xs text-[#a5afbd]">
          {dataStatus === "loading" ? (
            <span className="inline-flex items-center gap-2">
              <PanteonLoadingMark size="xs" />
              Carregando Supabase...
            </span>
          ) : (
            "Nao foi possivel carregar canais"
          )}
        </div>
      ) : null}
    </aside>
  );
}

function buildDepartmentGroups({
  channels,
  departments,
}: {
  channels: readonly HermesChannel[];
  departments: readonly HermesDepartment[];
}) {
  const knownDepartments = departments.map((department) => ({
    id: department.id,
    name: department.name,
  }));
  const fallbackDepartments = channels
    .filter((channel) => !departments.some((department) => department.id === channel.departmentId))
    .map((channel) => ({
      id: channel.departmentId ?? `department-${channel.departmentName ?? "geral"}`,
      name: channel.departmentName ?? "Geral",
    }));
  const groups = [...knownDepartments, ...fallbackDepartments].filter(
    (department, index, allDepartments) =>
      allDepartments.findIndex((item) => item.id === department.id) === index,
  );

  return groups
    .map((department) => {
      const departmentChannels = channels.filter(
        (channel) =>
          channel.departmentId === department.id ||
          (!channel.departmentId && department.name === "Geral"),
      );
      const sectorGroups = departmentChannels.length
        ? [
            {
              channels: departmentChannels,
              id: `${department.id}-channels`,
              name: "",
            },
          ]
        : [];
      const unreadCount = departmentChannels.reduce(
        (total, channel) => total + (channel.unreadCount ?? 0),
        0,
      );

      return {
        id: department.id,
        name: department.name,
        sectors: sectorGroups,
        unreadCount,
      };
    })
    .filter((department) => department.sectors.length > 0);
}

function QuickAction({
  active = false,
  icon,
  label,
  onClick,
  value,
}: {
  active?: boolean;
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  value: number;
}) {
  return (
    <button
      aria-pressed={active}
      className="grid min-h-[4.75rem] grid-rows-[auto_1fr] rounded-md border border-white/[0.075] bg-white/[0.055] p-2 text-left text-[#c9d1dc] outline-none transition hover:border-white/[0.13] hover:bg-white/[0.075] hover:text-white focus-visible:ring-2 focus-visible:ring-[#d0ad69] aria-pressed:border-[#A07C3B]/55 aria-pressed:bg-[#A07C3B]/20 aria-pressed:text-white"
      onClick={onClick}
      type="button"
    >
      <span className="flex min-w-0 items-center gap-1.5 text-xs">
        {icon}
        <span className="truncate">{label}</span>
      </span>
      <span className="self-end text-base font-semibold text-white">
        {value}
      </span>
    </button>
  );
}

function SidebarSection({
  children,
  collapsed,
  icon,
  onToggle,
  title,
  unreadCount,
}: {
  children: ReactNode;
  collapsed: boolean;
  icon: ReactNode;
  onToggle: () => void;
  title: string;
  unreadCount: number;
}) {
  return (
    <section className="py-1">
      <button
        aria-expanded={!collapsed}
        className="mb-1 grid w-full grid-cols-[1rem_minmax(0,1fr)_auto_auto] items-center gap-2 px-4 py-1 text-left text-[0.68rem] font-semibold uppercase text-[#a5afbd] outline-none transition hover:text-[#dce2ea] focus-visible:ring-2 focus-visible:ring-[#d0ad69]"
        onClick={onToggle}
        type="button"
      >
        {collapsed ? (
          <ChevronRight aria-hidden="true" size={13} />
        ) : (
          <ChevronDown aria-hidden="true" size={13} />
        )}
        <span className="flex min-w-0 items-center gap-2">
          {icon}
          <span className="truncate">{title}</span>
        </span>
        {unreadCount > 0 ? (
          <span className="rounded-full bg-white/[0.09] px-1.5 py-0.5 text-[0.62rem] text-[#dce2ea]">
            {unreadCount}
          </span>
        ) : null}
      </button>
      {collapsed ? null : children}
    </section>
  );
}
