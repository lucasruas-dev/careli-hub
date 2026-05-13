"use client";

import type {
  PulseXChannel,
  PulseXMessage,
  PulseXMessageFilter,
  PulseXPresenceUser,
} from "@/lib/pulsex";
import { Tooltip } from "@repo/uix";
import {
  AtSign,
  BriefcaseBusiness,
  ChevronDown,
  ChevronRight,
  Cpu,
  HeartHandshake,
  LayoutGrid,
  MessageCircle,
  Plus,
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
  messages: readonly PulseXMessage[];
  onSelectChannel?: (channelId: PulseXChannel["id"]) => void;
  onSelectMessageFilter?: (filter: PulseXMessageFilter) => void;
  users: readonly PulseXPresenceUser[];
};

type SidebarGroupId = "directs" | "operations" | "relation" | "technology";

const sidebarGroups = [
  { id: "operations", icon: BriefcaseBusiness, title: "Operacao" },
  { id: "technology", icon: Cpu, title: "Tecnologia" },
  { id: "relation", icon: HeartHandshake, title: "Relacao" },
  { id: "directs", icon: Users, title: "Diretas" },
] as const satisfies readonly {
  id: SidebarGroupId;
  icon: typeof BriefcaseBusiness;
  title: string;
}[];

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
  onSelectChannel,
  onSelectMessageFilter,
  users,
}: ConversationSidebarProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<
    Record<SidebarGroupId, boolean>
  >({
    directs: false,
    operations: false,
    relation: false,
    technology: false,
  });
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

  function getOrderedChannels(groupId: SidebarGroupId) {
    if (groupId === "directs") {
      return channels.filter((channel) => channel.kind === "direct");
    }

    if (groupId === "technology") {
      return channels.filter((channel) => channel.kind === "technology");
    }

    if (groupId === "relation") {
      return channels.filter((channel) => channel.kind === "relation");
    }

    return channels.filter((channel) => channel.kind === "operations");
  }

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
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
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
        {sidebarGroups.map((group) => {
          const GroupIcon = group.icon;
          const groupChannels = getOrderedChannels(group.id);
          const groupUnreadCount = groupChannels.reduce(
            (total, channel) => total + (channel.unreadCount ?? 0),
            0,
          );

          return (
            <SidebarSection
              collapsed={collapsedGroups[group.id]}
              icon={<GroupIcon size={14} />}
              key={group.id}
              onToggle={() => toggleGroup(group.id)}
              title={group.title}
              unreadCount={groupUnreadCount}
            >
              {groupChannels.length > 0 ? (
                <ConversationList
                  activeChannelId={activeChannelId}
                  channels={groupChannels}
                  onSelectChannel={onSelectChannel}
                />
              ) : (
                <p className="m-0 px-4 py-2 text-xs text-[#a5afbd]">
                  Nenhum canal configurado.
                </p>
              )}
            </SidebarSection>
          );
        })}
      </div>
      {dataStatus !== "ready" ? (
        <div className="border-t border-white/[0.075] px-4 py-2 text-xs text-[#a5afbd]">
          {dataStatus === "loading"
            ? "Carregando Supabase..."
            : "Fallback local ativo"}
        </div>
      ) : null}
    </aside>
  );
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
