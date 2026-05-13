"use client";

import { useAuth } from "@/providers/auth-provider";
import {
  getHubSupabaseClient,
  hasHubSupabaseConfig,
} from "@/lib/supabase/client";
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
  isHubModuleActive,
  orderedHubModules,
} from "@repo/shared";
import Image from "next/image";
import Link from "next/link";
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
  guardian: (
    <Image
      alt=""
      aria-hidden="true"
      className="h-[1.125rem] w-[1.125rem] object-contain"
      height={18}
      src="/logog.png"
      width={18}
    />
  ),
  pulsex: <MessageSquareText aria-hidden="true" size={18} />,
  setup: <Settings aria-hidden="true" size={18} />,
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
  const [releasedModuleIds, setReleasedModuleIds] = useState<Set<string> | null>(
    null,
  );
  const { hubUser, signOut } = useAuth();
  const { realtimeState } = useRealtime();
  const pathname = usePathname();
  const router = useRouter();
  const unreadNotificationsCount = getUnreadNotificationsCount(realtimeState);
  const onlinePresenceUsers = getOnlinePresenceUsers(realtimeState.presence);
  const activeModule = orderedHubModules.find((hubModule) =>
    pathname.startsWith(hubModule.basePath),
  );
  const visibleHubModules = orderedHubModules.filter((hubModule) => {
    if (!releasedModuleIds) {
      return isHubModuleActive(hubModule);
    }

    return isHubModuleActive(hubModule) && releasedModuleIds.has(hubModule.id);
  });
  const moduleNavigationItems = orderedHubModules
    .filter((hubModule) => visibleHubModules.includes(hubModule))
    .flatMap((hubModule) => {
      if (!hubUser || !canAccessModule(hubUser, hubModule)) {
        return [];
      }

      return hubModule.navigationItems.map((item) => ({
        ...item,
        badge: hubModule.realtimeEnabled
          ? "live"
          : "badge" in item
            ? item.badge
            : undefined,
        disabled: false,
        icon: moduleIconMap[hubModule.id] ?? (
          <FileText aria-hidden="true" size={18} />
        ),
        moduleId: hubModule.id,
        statusLabel: getHubModuleStatusLabel(hubModule.status),
      }));
    })
    .sort((firstItem, secondItem) =>
      firstItem.label.localeCompare(secondItem.label, "pt-BR"),
    );
  const commands = orderedHubModules
    .filter((hubModule) => visibleHubModules.includes(hubModule))
    .flatMap((hubModule) => {
    const canOpenModule = hubUser ? canAccessModule(hubUser, hubModule) : false;

    if (!canOpenModule) {
      return [];
    }

    return hubModule.routes.map((route) => ({
      disabled: false,
      group: hubModule.name,
      id: route.id,
      keywords: [hubModule.id, hubModule.name, route.label],
      label: `Abrir ${hubModule.name} - ${route.label}`,
      path: route.path,
      shortcut: `G ${hubModule.iconKey.slice(0, 1).toUpperCase()}`,
    }));
  });

  useEffect(() => {
    if (!hasHubSupabaseConfig()) {
      setReleasedModuleIds(null);
      return;
    }

    let isMounted = true;
    const client = getHubSupabaseClient();

    if (!client) {
      return;
    }

    Promise.all([
      client.from("hub_modules").select("id").eq("status", "active"),
      client
        .from("hub_department_modules")
        .select("module_id")
        .eq("status", "enabled"),
    ])
      .then(([modulesResult, accessResult]) => {
        if (!isMounted || modulesResult.error || accessResult.error) {
          return;
        }

        const activeIds = new Set(
          (modulesResult.data as { id: string }[] | null)?.map(
            (module) => module.id,
          ) ?? [],
        );
        const accessIds = new Set(
          (accessResult.data as { module_id: string }[] | null)?.map(
            (access) => access.module_id,
          ) ?? [],
        );
        const nextReleasedIds = new Set(
          [...activeIds].filter((moduleId) => accessIds.has(moduleId)),
        );

        setReleasedModuleIds(nextReleasedIds);
      })
      .catch(() => {
        if (isMounted) {
          setReleasedModuleIds(null);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

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
        className="careli-hub-shell"
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
              isSidebarCollapsed ? (
                <div className="grid justify-items-center gap-2 pb-1 pt-0.5">
                  <Link
                    aria-label="Voltar para a Home do Hub"
                    className="grid h-9 w-9 place-items-center rounded-md text-[#c9d1dc] outline-none transition hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-[var(--uix-color-focus)]"
                    href="/"
                  >
                    <span
                      aria-hidden="true"
                      className="h-7 w-7 bg-current"
                      style={{
                        WebkitMaskImage: "url('/logocbr.png')",
                        WebkitMaskPosition: "center",
                        WebkitMaskRepeat: "no-repeat",
                        WebkitMaskSize: "contain",
                        maskImage: "url('/logocbr.png')",
                        maskPosition: "center",
                        maskRepeat: "no-repeat",
                        maskSize: "contain",
                      }}
                    />
                  </Link>
                  <Tooltip content="Expandir menu" placement="right">
                    <button
                      aria-label="Expandir sidebar"
                      className="grid h-8 w-8 place-items-center rounded-md border border-white/10 text-[var(--uix-text-muted)] outline-none transition hover:bg-white/[0.08] hover:text-[var(--uix-text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--uix-color-focus)]"
                      onClick={handleToggleSidebar}
                      type="button"
                    >
                      <PanelLeftOpen aria-hidden="true" size={16} />
                    </button>
                  </Tooltip>
                </div>
              ) : (
                <div className="grid min-h-11 grid-cols-[2rem_minmax(0,1fr)_2rem] items-center gap-3 pb-1 pt-0.5">
                  <span aria-hidden="true" />
                  <Link
                    aria-label="Careli C2X"
                    className="flex min-w-0 items-center justify-center text-[#c9d1dc]"
                    href="/"
                  >
                    <span
                      aria-hidden="true"
                      className="h-[2.125rem] w-[6.875rem] bg-current"
                      style={{
                        WebkitMaskImage: "url('/logocb.png')",
                        WebkitMaskPosition: "center",
                        WebkitMaskRepeat: "no-repeat",
                        WebkitMaskSize: "contain",
                        maskImage: "url('/logocb.png')",
                        maskPosition: "center",
                        maskRepeat: "no-repeat",
                        maskSize: "contain",
                      }}
                    />
                  </Link>
                  <Tooltip content="Recolher menu" placement="right">
                    <button
                      aria-label="Recolher sidebar"
                      className="grid h-8 w-8 place-items-center rounded-md border border-white/10 text-[var(--uix-text-muted)] outline-none transition hover:bg-white/[0.08] hover:text-[var(--uix-text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--uix-color-focus)]"
                      onClick={handleToggleSidebar}
                      type="button"
                    >
                      <PanelLeftClose aria-hidden="true" size={16} />
                    </button>
                  </Tooltip>
                </div>
              )
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
                <p className="m-0 text-base font-semibold text-[var(--uix-text-primary)]">
                  {layoutMode === "module" ? (activeModule?.name ?? "Modulo") : "Home"}
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
              <Link
                aria-label="Voltar para a Home do Hub"
                className="grid h-10 w-10 place-items-center rounded-md border border-white/[0.08] bg-white/[0.04] outline-none transition hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-[var(--uix-color-focus)]"
                href="/"
              >
                <Image
                  alt=""
                  aria-hidden="true"
                  className="h-8 w-8 object-contain"
                  height={32}
                  src="/logocbr.png"
                  width={32}
                />
              </Link>
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
