"use client";

import type {
  PulseXChannel,
  PulseXDepartment,
  PulseXMessage,
  PulseXMessageFilter,
  PulseXPresenceUser,
  PulseXSector,
} from "@/lib/pulsex";
import { Tooltip } from "@repo/uix";
import {
  AtSign,
  Building2,
  ChevronDown,
  ChevronRight,
  LayoutGrid,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  Star,
  SlidersHorizontal,
  X,
  Zap,
  Users,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { ConversationList } from "./conversation-list";

type ConversationSidebarProps = {
  activeChannelId: string;
  activeMessageFilter: PulseXMessageFilter;
  channels: readonly PulseXChannel[];
  dataStatus?: "fallback" | "loading" | "ready";
  departments: readonly PulseXDepartment[];
  messages: readonly PulseXMessage[];
  onSelectChannel?: (channelId: PulseXChannel["id"]) => void;
  onSelectMessageFilter?: (filter: PulseXMessageFilter) => void;
  onRefresh?: () => void;
  sectors: readonly PulseXSector[];
  users: readonly PulseXPresenceUser[];
};

type SidebarGroupId = string;

const messageFilters = [
  { id: "all", label: "Todas" },
  { id: "urgente", label: "Urgentes" },
  { id: "importante", label: "Importantes" },
  { id: "pendente", label: "Pendentes" },
  { id: "resolvido", label: "Resolvidas" },
  { id: "acompanhar", label: "Acompanhar" },
] as const satisfies readonly {
  id: PulseXMessageFilter;
  label: string;
}[];

export function ConversationSidebar({
  activeChannelId,
  activeMessageFilter,
  channels,
  dataStatus = "ready",
  departments,
  onSelectChannel,
  onSelectMessageFilter,
  onRefresh,
  sectors,
  users,
}: ConversationSidebarProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<
    Record<SidebarGroupId, boolean>
  >({});
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const unreadCount = channels.reduce(
    (total, channel) => total + (channel.unreadCount ?? 0),
    0,
  );
  const mentionsCount = 2;
  const favoritesCount = 0;
  const shortcutsCount = unreadCount + mentionsCount + favoritesCount;
  const activeFilterLabel =
    messageFilters.find((filter) => filter.id === activeMessageFilter)?.label ??
    "Todas";

  const directChannels = channels.filter((channel) => channel.kind === "direct");
  const departmentGroups = buildDepartmentGroups({
    channels: channels.filter((channel) => channel.kind !== "direct"),
    departments,
    sectors,
  });

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
    <aside className="flex h-full flex-col overflow-hidden border-l border-white/[0.035] border-r border-[#252a35] bg-[#101820] shadow-[inset_1px_0_0_rgb(255_255_255_/_0.035)]">
      <div className="shrink-0 border-b border-white/[0.075] bg-[#101820] px-4 py-3">
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-2">
          <Tooltip content="Abrir modulos" placement="bottom">
            <button
              aria-label="Abrir modulos"
              className="grid h-8 w-8 place-items-center rounded-md border border-white/[0.075] bg-white/[0.055] text-[#a5afbd] outline-none transition hover:bg-white/[0.085] hover:text-white focus-visible:ring-2 focus-visible:ring-[#d0ad69]"
              onClick={handleOpenModuleLauncher}
              type="button"
            >
              <LayoutGrid aria-hidden="true" size={15} />
            </button>
          </Tooltip>
          <p className="m-0 truncate text-base font-semibold text-[#f7f8fa]">
            PulseX
          </p>
          <span className="sr-only">{users.length} usuarios carregados</span>
          <Tooltip content="Atualizar canais" placement="bottom">
            <button
              aria-label="Atualizar canais"
              className="grid h-9 w-9 place-items-center rounded-md border border-white/[0.075] bg-white/[0.055] text-[#a5afbd] outline-none transition hover:bg-white/[0.085] hover:text-white focus-visible:ring-2 focus-visible:ring-[#d0ad69]"
              onClick={onRefresh}
              type="button"
            >
              <RefreshCw aria-hidden="true" size={16} />
            </button>
          </Tooltip>
          <button
            aria-label="Nova conversa"
            className="grid h-9 w-9 place-items-center rounded-md border border-[#A07C3B]/45 bg-[#A07C3B] text-white outline-none transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[#d0ad69]"
            type="button"
          >
            <Plus aria-hidden="true" size={17} />
          </button>
        </div>
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
        <div className="relative mt-2">
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
            <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-white/[0.085] bg-[#121b26] py-1 shadow-xl">
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
        <div className="mt-2">
          <button
            aria-controls="pulsex-shortcuts-panel"
            aria-expanded={isShortcutsOpen}
            className="flex h-8 w-full items-center justify-between rounded-md px-2 text-sm text-[#c9d1dc] outline-none transition hover:bg-white/[0.065] hover:text-white focus-visible:ring-2 focus-visible:ring-[#d0ad69]"
            onClick={() => setIsShortcutsOpen((currentValue) => !currentValue)}
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
              <div className="grid grid-cols-3 gap-2 text-sm">
                <QuickAction
                  icon={<MessageCircle size={15} />}
                  label="Nao lidas"
                  value={unreadCount}
                />
                <QuickAction
                  icon={<AtSign size={15} />}
                  label="Mencoes"
                  value={mentionsCount}
                />
                <QuickAction
                  icon={<Star size={15} />}
                  label="Favoritos"
                  value={favoritesCount}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-2">
        {departmentGroups.length > 0 ? (
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
                    <p className="m-0 px-4 text-[0.66rem] font-semibold uppercase text-[#7f8a99]">
                      {sector.name}
                    </p>
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
            {dataStatus === "fallback"
              ? "Nao foi possivel carregar canais."
              : "Nenhum canal configurado."}
          </p>
        )}
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
              Nenhum usuario disponivel.
            </p>
          )}
        </SidebarSection>
      </div>
      {dataStatus !== "ready" ? (
        <div className="border-t border-white/[0.075] px-4 py-2 text-xs text-[#a5afbd]">
          {dataStatus === "loading"
            ? "Carregando Supabase..."
            : "Nao foi possivel carregar canais"}
        </div>
      ) : null}
    </aside>
  );
}

function buildDepartmentGroups({
  channels,
  departments,
  sectors,
}: {
  channels: readonly PulseXChannel[];
  departments: readonly PulseXDepartment[];
  sectors: readonly PulseXSector[];
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
      const departmentSectors = sectors.filter(
        (sector) => sector.departmentId === department.id,
      );
      const fallbackSector = {
        channels: departmentChannels.filter((channel) => !channel.sectorId),
        id: `${department.id}-department`,
        name: "Departamento",
      };
      const sectorGroups = [
        ...departmentSectors.map((sector) => ({
          channels: departmentChannels.filter(
            (channel) => channel.sectorId === sector.id,
          ),
          id: sector.id,
          name: sector.name,
        })),
        fallbackSector,
      ].filter((sector) => sector.channels.length > 0);
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
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: number;
}) {
  return (
    <button
      className="grid min-h-[4.75rem] grid-rows-[auto_1fr] rounded-md border border-white/[0.075] bg-white/[0.055] p-2 text-left text-[#c9d1dc] outline-none transition hover:border-white/[0.13] hover:bg-white/[0.075] hover:text-white focus-visible:ring-2 focus-visible:ring-[#d0ad69]"
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
