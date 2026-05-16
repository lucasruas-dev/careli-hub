"use client";

import { useHubPresenceController } from "@/hooks/use-hub-presence";
import {
  getHubPresenceLabel,
  hubPresenceStatusOptions,
  type HubPresenceStatus,
} from "@/lib/hub-presence";
import { useAuth } from "@/providers/auth-provider";
import {
  getHubSupabaseClient,
  getHubSupabaseDiagnostics,
  hasHubSupabaseConfig,
  logSupabaseDiagnostic,
  serializeDiagnosticError,
} from "@/lib/supabase/client";
import { useRealtime } from "@/providers/realtime-provider";
import {
  ActionGroup,
  AppShell,
  CommandPalette,
  ContentArea,
  IconButton,
  NotificationPanel,
  RealtimePulse,
  Sidebar,
  SidebarGroup,
  SidebarItem,
  StatusIndicator,
  Tooltip,
  Topbar,
} from "@repo/uix";
import {
  Bell,
  CalendarDays,
  ChevronDown,
  CircleDollarSign,
  ContactRound,
  FileText,
  FolderKanban,
  Headphones,
  Home,
  LogOut,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldCheck,
  ShoppingCart,
} from "lucide-react";
import {
  getUnreadNotificationsCount,
  mapConnectionStatusToPulseState,
} from "@repo/realtime";
import {
  canAccessModule,
  getHubModuleStatusLabel,
  isHubModuleActive,
  orderedHubModules,
  type HubUserContext,
} from "@repo/shared";
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
  caredesk: <Headphones aria-hidden="true" size={18} />,
  drive: <FolderKanban aria-hidden="true" size={18} />,
  financeiro: <CircleDollarSign aria-hidden="true" size={18} />,
  guardian: <ShieldCheck aria-hidden="true" size={18} />,
  pulsex: <MessageSquareText aria-hidden="true" size={18} />,
  setup: <Settings aria-hidden="true" size={18} />,
};

const minimumReleasedModuleIds = ["guardian", "caredesk", "pulsex", "setup"] as const;

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
  const [isPresenceMenuOpen, setIsPresenceMenuOpen] = useState(false);
  const [releasedModuleIds, setReleasedModuleIds] = useState<Set<string> | null>(
    null,
  );
  const { hubUser, profileStatus, signOut } = useAuth();
  const hubPresence = useHubPresenceController({
    enabled: profileStatus === "ready" && Boolean(hubUser),
  });
  const { realtimeState } = useRealtime();
  const pathname = usePathname();
  const router = useRouter();
  const unreadNotificationsCount = getUnreadNotificationsCount(realtimeState);
  const activeModule = orderedHubModules.find((hubModule) =>
    pathname.startsWith(hubModule.basePath),
  );
  const visibleHubModules = orderedHubModules.filter((hubModule) => {
    if (!releasedModuleIds) {
      return (
        isHubModuleActive(hubModule) &&
        minimumReleasedModuleIds.includes(
          hubModule.id as (typeof minimumReleasedModuleIds)[number],
        )
      );
    }

    return isHubModuleActive(hubModule) && releasedModuleIds.has(hubModule.id);
  });
  const moduleNavigationItems = orderedHubModules
    .filter((hubModule) => visibleHubModules.includes(hubModule))
    .flatMap((hubModule) => {
      if (!canOpenShellModule(hubModule.id, hubUser, hubModule, profileStatus)) {
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
    const canOpenModule = canOpenShellModule(
      hubModule.id,
      hubUser,
      hubModule,
      profileStatus,
    );

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
      setReleasedModuleIds(createMinimumReleasedModuleIds());
      return;
    }

    setReleasedModuleIds(createMinimumReleasedModuleIds());
    logSupabaseDiagnostic("shell", "modules start", {
      function: "HubShell.loadReleasedModules",
      supabase: getHubSupabaseDiagnostics(),
      tables: ["hub_modules", "hub_department_modules"],
    });

    withShellTimeout(Promise.all([
      client.from("hub_modules").select("id").eq("status", "active"),
      client
        .from("hub_department_modules")
        .select("module_id")
        .eq("status", "enabled"),
    ]), "modules", 8_000)
      .then(([modulesResult, accessResult]) => {
        if (!isMounted || modulesResult.error || accessResult.error) {
          logSupabaseDiagnostic("shell", "modules error", {
            accessError: accessResult.error
              ? serializeDiagnosticError(accessResult.error)
              : null,
            function: "HubShell.loadReleasedModules",
            modulesError: modulesResult.error
              ? serializeDiagnosticError(modulesResult.error)
              : null,
            supabase: getHubSupabaseDiagnostics(),
            tables: ["hub_modules", "hub_department_modules"],
          });
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

        minimumReleasedModuleIds.forEach((moduleId) => {
          nextReleasedIds.add(moduleId);
        });

        setReleasedModuleIds(nextReleasedIds);
        logSupabaseDiagnostic("shell", "modules done", {
          function: "HubShell.loadReleasedModules",
          count: nextReleasedIds.size,
        });
      })
      .catch((error: unknown) => {
        logSupabaseDiagnostic("shell", "modules error", {
          error: serializeDiagnosticError(error),
          function: "HubShell.loadReleasedModules",
          message: getShellErrorMessage(error),
          supabase: getHubSupabaseDiagnostics(),
          tables: ["hub_modules", "hub_department_modules"],
        });
        if (isMounted) {
          setReleasedModuleIds(createMinimumReleasedModuleIds());
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
                    <button
                      aria-expanded={isNotificationPanelOpen}
                      aria-label="Abrir notificacoes"
                      className="relative grid h-8 w-8 place-items-center rounded-md border border-[#d9e0e7] bg-white text-[#526078] outline-none transition hover:bg-[#f8fafc] hover:text-[#101820] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                      onClick={() =>
                        setIsNotificationPanelOpen(
                          (currentValue) => !currentValue,
                        )
                      }
                      type="button"
                    >
                      <Bell aria-hidden="true" size={17} />
                      {unreadNotificationsCount > 0 ? (
                        <span className="absolute -right-1 -top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[0.625rem] font-bold leading-none text-white">
                          {unreadNotificationsCount > 99
                            ? "99+"
                            : unreadNotificationsCount}
                        </span>
                      ) : null}
                    </button>
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
                <HubPresenceControl
                  onChange={(nextStatus) => {
                    setIsPresenceMenuOpen(false);
                    void hubPresence.setStatus(nextStatus, {
                      manual: true,
                      reason: "manual",
                    }).catch((error: unknown) => {
                      if (isLocalhostRuntime()) {
                        console.warn("[presence] manual update error", error);
                      }
                    });
                  }}
                  onOpenChange={setIsPresenceMenuOpen}
                  open={isPresenceMenuOpen}
                  status={hubPresence.status}
                />
                <div className="flex items-center gap-2">
                  <TopbarUserAvatar
                    avatarUrl={hubUser?.avatarUrl}
                    name={hubUser?.name ?? "Sessao"}
                  />
                  <span className="max-w-24 text-sm text-[var(--uix-text-muted)]">
                    {hubUser?.name ?? "Sessao"}
                  </span>
                </div>
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
        <ContentArea
          className={
            isOperationalChrome ? "h-[100dvh] max-h-[100dvh] min-h-0" : undefined
          }
          padded={layoutMode === "dashboard"}
        >
          {children}
        </ContentArea>
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
            className="fixed left-3 top-[4.25rem] z-[var(--uix-z-modal)] grid w-56 gap-2 rounded-lg border border-white/[0.08] bg-[#343541] p-2 shadow-2xl"
          >
            <Tooltip content="Careli Hub" placement="right">
              <Link
                aria-label="Voltar para a Home do Hub"
                className="flex h-11 items-center gap-3 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 text-[#d7dee8] outline-none transition hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-[var(--uix-color-focus)]"
                href="/"
                onClick={() => setIsOperationalRailOpen(false)}
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-white/[0.06] text-[#A07C3B]">
                  <Home aria-hidden="true" size={17} />
                </span>
                <span className="min-w-0 truncate text-sm font-semibold">
                  Careli Hub
                </span>
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
                    className="relative flex h-11 w-full cursor-not-allowed items-center gap-3 rounded-md border border-transparent px-2 text-[#687386] opacity-60 outline-none"
                    disabled
                    type="button"
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-white/[0.04]">
                      {item.icon}
                    </span>
                    <span className="min-w-0 truncate text-sm font-semibold">
                      {item.label}
                    </span>
                  </button>
                ) : (
                  <Link
                    aria-current={
                      isShellPathActive(pathname, item.path) ? "page" : undefined
                    }
                    className="relative flex h-11 items-center gap-3 rounded-md border border-transparent px-2 text-[#c5ceda] outline-none transition hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-[var(--uix-color-focus)] aria-[current=page]:bg-[#2A2B32] aria-[current=page]:text-white"
                    href={item.path}
                    onClick={() => setIsOperationalRailOpen(false)}
                  >
                    {isShellPathActive(pathname, item.path) ? (
                      <span className="absolute left-0 top-2 h-7 w-0.5 rounded-full bg-[#A07C3B]" />
                    ) : null}
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-white/[0.055] text-[#d7dee8]">
                      {item.icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                      {item.label}
                    </span>
                    {item.badge ? (
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#A07C3B]" />
                    ) : null}
                  </Link>
                )}
              </Tooltip>
            ))}
            <div className="my-1 h-px bg-white/[0.08]" />
            <Tooltip content="Sair" placement="right">
              <button
                aria-label="Sair"
                className="flex h-11 w-full items-center gap-3 rounded-md border border-transparent px-2 text-[#c5ceda] outline-none transition hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-[var(--uix-color-focus)]"
                onClick={() => {
                  void signOut();
                }}
                type="button"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-white/[0.055]">
                  <LogOut aria-hidden="true" size={17} />
                </span>
                <span className="min-w-0 truncate text-sm font-semibold">
                  Sair
                </span>
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

function HubPresenceControl({
  onChange,
  onOpenChange,
  open,
  status,
}: {
  onChange: (status: HubPresenceStatus) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  status: HubPresenceStatus;
}) {
  const tone = getPresenceTone(status);

  return (
    <div className="relative">
      <button
        aria-expanded={open}
        aria-label="Alterar status de presenca"
        className={`inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs font-semibold outline-none transition hover:brightness-95 focus-visible:ring-2 focus-visible:ring-[#A07C3B] ${tone.button}`}
        onClick={() => onOpenChange(!open)}
        type="button"
      >
        <span className={`h-2 w-2 rounded-full ${tone.dot}`} />
        <span className="capitalize">{getHubPresenceLabel(status)}</span>
        <ChevronDown aria-hidden="true" size={14} />
      </button>
      {open ? (
        <div className="absolute right-0 top-10 z-[var(--uix-z-popover)] w-44 rounded-md border border-[#d9e0e7] bg-white p-1.5 shadow-xl">
          {hubPresenceStatusOptions.map((option) => {
            const optionTone = getPresenceTone(option);

            return (
              <button
                className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-[#17202f] outline-none transition hover:bg-[#f4f6f8] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                key={option}
                onClick={() => onChange(option)}
                type="button"
              >
                <span className={`h-2.5 w-2.5 rounded-full ${optionTone.dot}`} />
                <span className="capitalize">{getHubPresenceLabel(option)}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function TopbarUserAvatar({
  avatarUrl,
  name,
}: {
  avatarUrl?: string;
  name: string;
}) {
  return (
    <span
      aria-label={`Foto de ${name}`}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#d9e0e7] bg-[#101820] bg-cover bg-center text-[0.6875rem] font-semibold text-white"
      role="img"
      style={
        avatarUrl
          ? {
              backgroundImage: `url(${avatarUrl})`,
            }
          : undefined
      }
    >
      {avatarUrl ? null : getInitials(name)}
    </span>
  );
}

function getPresenceTone(status: HubPresenceStatus) {
  const normalizedStatus = status === "busy" ? "agenda" : status;
  const tones = {
    agenda: {
      button: "border-sky-200 bg-sky-50 text-sky-700",
      dot: "bg-sky-500",
    },
    away: {
      button: "border-red-200 bg-red-50 text-red-700",
      dot: "bg-red-500",
    },
    lunch: {
      button: "border-yellow-200 bg-yellow-50 text-yellow-700",
      dot: "bg-yellow-400",
    },
    offline: {
      button: "border-zinc-200 bg-zinc-50 text-zinc-500",
      dot: "bg-zinc-400",
    },
    online: {
      button: "border-emerald-200 bg-emerald-50 text-emerald-700",
      dot: "bg-emerald-500",
    },
  } as const satisfies Record<Exclude<HubPresenceStatus, "busy">, {
    button: string;
    dot: string;
  }>;

  return tones[normalizedStatus];
}

function getInitials(name: string) {
  const [first = "", second = ""] = name.trim().split(/\s+/);

  return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase() || "--";
}

function isLocalhostRuntime() {
  return ["localhost", "127.0.0.1"].includes(window.location.hostname);
}

function isShellPathActive(pathname: string, itemPath: string) {
  if (itemPath === "/") {
    return pathname === "/";
  }

  return pathname === itemPath || pathname.startsWith(`${itemPath}/`);
}

function canOpenShellModule(
  moduleId: string,
  hubUser: HubUserContext | null,
  hubModule: (typeof orderedHubModules)[number],
  profileStatus: "error" | "idle" | "loading" | "ready",
) {
  if (hubUser && canAccessModule(hubUser, hubModule)) {
    return true;
  }

  return (
    profileStatus === "loading" &&
    minimumReleasedModuleIds.includes(
      moduleId as (typeof minimumReleasedModuleIds)[number],
    )
  );
}

function createMinimumReleasedModuleIds() {
  return new Set<string>(minimumReleasedModuleIds);
}

function withShellTimeout<Result>(
  promise: PromiseLike<Result>,
  label: string,
  timeoutMs: number,
): Promise<Result> {
  const startedAt = performance.now();

  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(`${label} timeout`));
    }, timeoutMs);

    promise.then(
      (result) => {
        window.clearTimeout(timeoutId);
        logShellDebug(`${label} done`, {
          elapsedMs: Math.round(performance.now() - startedAt),
        });
        resolve(result);
      },
      (error: unknown) => {
        window.clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

function logShellDebug(event: string, detail?: unknown) {
  if (!["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    return;
  }

  console.debug(`[shell] ${event}`, detail ?? "");
}

function getShellErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return "Erro desconhecido.";
}
