"use client";

import { useAuth } from "@/providers/auth-provider";
import { useRealtime } from "@/providers/realtime-provider";
import {
  ActionGroup,
  AppShell,
  CommandPalette,
  CommandTrigger,
  ContentArea,
  IconButton,
  NotificationBell,
  NotificationPanel,
  PresenceStack,
  RealtimePulse,
  Sidebar,
  SidebarGroup,
  SidebarItem,
  StatusIndicator,
  Tooltip,
  Topbar,
} from "@repo/uix";
import {
  CalendarDays,
  CircleDollarSign,
  ContactRound,
  FileText,
  FolderKanban,
  LogOut,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldCheck,
  ShoppingCart,
} from "lucide-react";
import {
  getOnlinePresenceUsers,
  getUnreadNotificationsCount,
  mapConnectionStatusToPulseState,
} from "@repo/realtime";
import {
  canAccessModule,
  getHubModuleStatusLabel,
  orderedHubModules,
} from "@repo/shared";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

type HubShellProps = Readonly<{
  children: ReactNode;
  chrome?: "operational" | "standard";
  layoutMode?: "dashboard" | "module";
}>;

const moduleIconMap: Record<string, ReactNode> = {
  agenda: <CalendarDays aria-hidden="true" size={18} />,
  compras: <ShoppingCart aria-hidden="true" size={18} />,
  contatos: <ContactRound aria-hidden="true" size={18} />,
  drive: <FolderKanban aria-hidden="true" size={18} />,
  financeiro: <CircleDollarSign aria-hidden="true" size={18} />,
  guardian: <ShieldCheck aria-hidden="true" size={18} />,
  pulsex: <MessageSquareText aria-hidden="true" size={18} />,
};

export function HubShell({
  children,
  chrome = "standard",
  layoutMode = "dashboard",
}: HubShellProps) {
  const isOperationalChrome = chrome === "operational";
  const [isOperationalRailOpen, setIsOperationalRailOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(
    isOperationalChrome || layoutMode === "module",
  );
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isNotificationPanelOpen, setIsNotificationPanelOpen] = useState(false);
  const { hubUser, signOut } = useAuth();
  const { realtimeState } = useRealtime();
  const pathname = usePathname();
  const router = useRouter();
  const unreadNotificationsCount = getUnreadNotificationsCount(realtimeState);
  const onlinePresenceUsers = getOnlinePresenceUsers(realtimeState.presence);
  const activeModule = orderedHubModules.find((hubModule) =>
    pathname.startsWith(hubModule.basePath),
  );
  const moduleNavigationItems = orderedHubModules.flatMap((hubModule) => {
    const canOpenModule = hubUser ? canAccessModule(hubUser, hubModule) : false;

    return hubModule.navigationItems.map((item) => ({
      ...item,
      badge:
        canOpenModule && hubModule.realtimeEnabled
          ? "live"
          : canOpenModule
            ? ("badge" in item ? item.badge : undefined)
            : "Em preparacao",
      disabled: !canOpenModule,
      icon: moduleIconMap[hubModule.id] ?? (
        <FileText aria-hidden="true" size={18} />
      ),
      moduleId: hubModule.id,
      statusLabel: getHubModuleStatusLabel(hubModule.status),
    }));
  });
  const commands = orderedHubModules.flatMap((hubModule) => {
    const canOpenModule = hubUser ? canAccessModule(hubUser, hubModule) : false;

    return hubModule.routes.map((route) => ({
      disabled: !canOpenModule,
      group: hubModule.name,
      id: route.id,
      keywords: [hubModule.id, hubModule.name, route.label],
      label: canOpenModule
        ? `Abrir ${hubModule.name} - ${route.label}`
        : `${hubModule.name} - Em preparacao`,
      path: route.path,
      shortcut: `G ${hubModule.iconKey.slice(0, 1).toUpperCase()}`,
    }));
  });

  useEffect(() => {
    if (isOperationalChrome) {
      setIsSidebarCollapsed(true);
      setIsOperationalRailOpen(false);
      return;
    }

    const storedValue = window.localStorage.getItem("careli:hub-sidebar");

    if (storedValue === "collapsed") {
      setIsSidebarCollapsed(true);
      return;
    }

    if (storedValue === "expanded") {
      setIsSidebarCollapsed(false);
      return;
    }

    setIsSidebarCollapsed(layoutMode === "module");
  }, [isOperationalChrome, layoutMode]);

  useEffect(() => {
    if (!isOperationalChrome) {
      return;
    }

    function handleToggleModuleLauncher() {
      setIsOperationalRailOpen((currentValue) => !currentValue);
    }

    window.addEventListener(
      "careli:toggle-module-launcher",
      handleToggleModuleLauncher,
    );

    return () => {
      window.removeEventListener(
        "careli:toggle-module-launcher",
        handleToggleModuleLauncher,
      );
    };
  }, [isOperationalChrome]);

  useEffect(() => {
    if (!isOperationalChrome || !isOperationalRailOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOperationalRailOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOperationalChrome, isOperationalRailOpen]);

  function handleToggleSidebar() {
    setIsSidebarCollapsed((currentValue) => {
      const nextValue = !currentValue;

      window.localStorage.setItem(
        "careli:hub-sidebar",
        nextValue ? "collapsed" : "expanded",
      );

      return nextValue;
    });
  }

  return (
    <>
      <AppShell
        layoutMode={isOperationalChrome ? "fullscreen" : layoutMode}
        sidebarVisibility={
          isOperationalChrome && !isOperationalRailOpen ? "hidden" : "visible"
        }
        sidebar={
          isOperationalChrome ? null : (
          <Sidebar
            collapsed={isSidebarCollapsed}
            footer={
              isSidebarCollapsed ? null : (
                <StatusIndicator label="Realtime online" variant="online" />
              )
            }
            header={
              <div className="flex items-center justify-between gap-3">
                {isSidebarCollapsed ? (
                  <span className="grid h-9 w-9 place-items-center rounded-md border border-white/10 bg-white p-1.5">
                    <Image
                      alt=""
                      aria-hidden="true"
                      className="h-full w-full object-contain"
                      height={36}
                      src="/logo-hub.png"
                      width={36}
                    />
                  </span>
                ) : (
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-white/10 bg-white p-1.5">
                      <Image
                        alt=""
                        aria-hidden="true"
                        className="h-full w-full object-contain"
                        height={40}
                        src="/logo-hub.png"
                        width={40}
                      />
                    </span>
                    <div className="min-w-0">
                      <p className="m-0 truncate text-sm font-semibold text-[var(--uix-text-primary)]">
                        Careli Hub
                      </p>
                      <p className="m-0 mt-1 truncate text-xs text-[var(--uix-text-muted)]">
                        Central operacional
                      </p>
                    </div>
                  </div>
                )}
                <Tooltip
                  content={
                    isSidebarCollapsed ? "Expandir menu" : "Recolher menu"
                  }
                  placement="right"
                >
                  <button
                    aria-label={
                      isSidebarCollapsed
                        ? "Expandir sidebar"
                        : "Recolher sidebar"
                    }
                    className="grid h-8 w-8 place-items-center rounded-md border border-white/10 text-[var(--uix-text-muted)] outline-none transition hover:bg-white/[0.08] hover:text-[var(--uix-text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--uix-color-focus)]"
                    onClick={handleToggleSidebar}
                    type="button"
                  >
                    {isSidebarCollapsed ? (
                      <PanelLeftOpen aria-hidden="true" size={16} />
                    ) : (
                      <PanelLeftClose aria-hidden="true" size={16} />
                    )}
                  </button>
                </Tooltip>
              </div>
            }
          >
            <SidebarGroup title="Modulos">
              {moduleNavigationItems.map((item) => (
                <Tooltip
                  content={item.disabled ? item.statusLabel : item.label}
                  key={`${item.moduleId}-${item.id}`}
                  placement="right"
                >
                  <SidebarItem
                    active={!item.disabled && pathname === item.path}
                    badge={item.badge}
                    collapsed={isSidebarCollapsed}
                    disabled={item.disabled}
                    href={item.disabled ? undefined : item.path}
                    icon={item.icon}
                    label={item.label}
                  />
                </Tooltip>
              ))}
            </SidebarGroup>
          </Sidebar>
          )
        }
        topbar={
          isOperationalChrome ? null : (
          <Topbar
            actions={
              <ActionGroup align="end">
                <div className="relative">
                  <Tooltip content="Notificacoes">
                    <NotificationBell
                      aria-expanded={isNotificationPanelOpen}
                      aria-label="Abrir notificacoes"
                      count={unreadNotificationsCount}
                      onClick={() =>
                        setIsNotificationPanelOpen(
                          (currentValue) => !currentValue,
                        )
                      }
                      unread={unreadNotificationsCount > 0}
                    />
                  </Tooltip>
                  {isNotificationPanelOpen ? (
                    <NotificationPanel
                      items={realtimeState.notifications.map((notification) => ({
                        description: notification.moduleId
                          ? `Modulo: ${notification.moduleId}`
                          : "Hub Central",
                        id: notification.id,
                        read: notification.read,
                        status: notification.severity,
                        timestamp: notification.timestamp,
                        title: notification.title,
                      }))}
                      title="Notificacoes"
                      unreadCount={unreadNotificationsCount}
                    />
                  ) : null}
                </div>
                <Tooltip content="Ajustes">
                  <IconButton
                    aria-label="Abrir ajustes"
                    icon={<Settings aria-hidden="true" size={17} />}
                  />
                </Tooltip>
              </ActionGroup>
            }
            command={
              <CommandTrigger
                aria-label="Abrir command palette"
                onClick={() => setIsCommandPaletteOpen(true)}
              />
            }
            context={
              <div>
                <p className="m-0 text-xs font-medium uppercase tracking-[0.16em] text-[var(--uix-text-muted)]">
                  {layoutMode === "module" ? "Modulo" : "Operacao"}
                </p>
                <p className="m-0 mt-1 text-base font-semibold text-[var(--uix-text-primary)]">
                  {layoutMode === "module"
                    ? (activeModule?.name ?? "Modulo operacional")
                    : "Painel inicial"}
                </p>
              </div>
            }
            realtime={
              <RealtimePulse
                label={realtimeState.connectionStatus}
                state={mapConnectionStatusToPulseState(
                  realtimeState.connectionStatus,
                )}
              />
            }
            user={
              <div className="flex items-center gap-3">
                <PresenceStack limit={3} users={onlinePresenceUsers} />
                <span className="text-sm text-[var(--uix-text-muted)]">
                  {hubUser?.name ?? "Sessao"}
                </span>
                <Tooltip content="Sair">
                  <IconButton
                    aria-label="Sair"
                    icon={<LogOut aria-hidden="true" size={17} />}
                    onClick={() => {
                      void signOut();
                    }}
                  />
                </Tooltip>
              </div>
            }
          />
          )
        }
      >
        <ContentArea padded={layoutMode === "dashboard"}>{children}</ContentArea>
      </AppShell>
      {isOperationalChrome && isOperationalRailOpen ? (
        <>
          <button
            aria-label="Fechar launcher de módulos"
            className="fixed inset-0 z-[var(--uix-z-overlay)] cursor-default bg-black/10 outline-none"
            onClick={() => setIsOperationalRailOpen(false)}
            type="button"
          />
          <aside
            aria-label="Launcher de módulos"
            className="fixed left-3 top-[4.25rem] z-[var(--uix-z-modal)] grid w-14 gap-2 rounded-lg border border-white/[0.08] bg-[#0b0d11] p-2 shadow-2xl"
          >
            <Tooltip content="Careli Hub" placement="right">
              <span className="grid h-10 w-10 place-items-center rounded-md border border-white/[0.08] bg-white p-1.5">
                <Image
                  alt=""
                  aria-hidden="true"
                  className="h-full w-full object-contain"
                  height={40}
                  src="/logo-hub.png"
                  width={40}
                />
              </span>
            </Tooltip>
            <div className="my-1 h-px bg-white/[0.08]" />
            {moduleNavigationItems.map((item) => (
              <Tooltip
                content={item.disabled ? item.statusLabel : item.label}
                key={`${item.moduleId}-${item.id}`}
                placement="right"
              >
                {item.disabled ? (
                  <button
                    aria-label={`${item.label} em preparacao`}
                    className="relative grid h-10 w-10 cursor-not-allowed place-items-center rounded-md border border-transparent text-[#687386] opacity-60 outline-none"
                    disabled
                    type="button"
                  >
                    {item.icon}
                  </button>
                ) : (
                  <a
                    aria-current={pathname === item.path ? "page" : undefined}
                    className="relative grid h-10 w-10 place-items-center rounded-md border border-transparent text-[#c5ceda] outline-none transition hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-[var(--uix-color-focus)] aria-[current=page]:border-[#A07C3B]/60 aria-[current=page]:bg-[#A07C3B]/20 aria-[current=page]:text-white"
                    href={item.path}
                  >
                    {item.icon}
                    {item.badge ? (
                      <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border border-[#0b0d11] bg-[#A07C3B]" />
                    ) : null}
                  </a>
                )}
              </Tooltip>
            ))}
            <div className="my-1 h-px bg-white/[0.08]" />
            <Tooltip content="Sair" placement="right">
              <button
                aria-label="Sair"
                className="grid h-10 w-10 place-items-center rounded-md border border-transparent text-[#c5ceda] outline-none transition hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-[var(--uix-color-focus)]"
                onClick={() => {
                  void signOut();
                }}
                type="button"
              >
                <LogOut aria-hidden="true" size={17} />
              </button>
            </Tooltip>
          </aside>
        </>
      ) : null}
      <CommandPalette
        commands={commands.map((command) => ({
          ...command,
          onSelect: command.disabled
            ? undefined
            : () => router.push(command.path),
        }))}
        onOpenChange={setIsCommandPaletteOpen}
        open={isCommandPaletteOpen}
        title="Comandos do Hub"
      />
    </>
  );
}
