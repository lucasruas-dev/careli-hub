"use client";

import { useHubPresenceController } from "@/hooks/use-hub-presence";
import { useOutsideDismiss } from "@/hooks/use-outside-dismiss";
import { AthenaTicketRecordingProvider } from "@/components/hub-support/athena-ticket-recording-provider";
import { HubSupportDock } from "@/components/hub-support/hub-support-dock";
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
  BellRing,
  BarChart3,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  CircleDollarSign,
  ContactRound,
  Download,
  FileText,
  FolderKanban,
  Headphones,
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
  type RealtimeNotification,
} from "@repo/realtime";
import {
  getPanteonNativeNotificationPermission,
  getPanteonNativeNotificationSupportLabel,
  requestPanteonNativeNotificationPermission,
  showPanteonNativeNotification,
  type PanteonNativeNotificationPermission,
} from "@/lib/hub/native-notifications";
import {
  canAccessModule,
  getHubModuleStatusLabel,
  isHubModuleActive,
  orderedHubModules,
  roleCanViewModule,
  type HubUserContext,
} from "@repo/shared";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

type HubShellProps = Readonly<{
  children: ReactNode;
  chrome?: "operational" | "standard";
  layoutMode?: "dashboard" | "module";
}>;

const shellAppEnvironment =
  process.env.NEXT_PUBLIC_CARELI_APP_ENV?.toLowerCase() ?? "";
const shellAppUrl = (
  process.env.NEXT_PUBLIC_CARELI_APP_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  ""
).toLowerCase();
const isShellHomologationEnvironment =
  shellAppEnvironment.includes("homolog") ||
  shellAppEnvironment.includes("homo") ||
  shellAppUrl.includes("homo.c2x.app.br") ||
  shellAppUrl.includes("homolog.c2x.app.br");

const moduleIconMap: Record<string, ReactNode> = {
  agenda: <CalendarDays aria-hidden="true" size={18} />,
  apolo: <ContactRound aria-hidden="true" size={18} />,
  atlas: <BarChart3 aria-hidden="true" size={18} />,
  compras: <ShoppingCart aria-hidden="true" size={18} />,
  contatos: <ContactRound aria-hidden="true" size={18} />,
  hermes: <MessageSquareText aria-hidden="true" size={18} />,
  hades: <ShieldCheck aria-hidden="true" size={18} />,
  iris: <Headphones aria-hidden="true" size={18} />,
  chronos: <CalendarClock aria-hidden="true" size={18} />,
  drive: <FolderKanban aria-hidden="true" size={18} />,
  financeiro: <CircleDollarSign aria-hidden="true" size={18} />,
  setup: <Settings aria-hidden="true" size={18} />,
  zeus: <ZeusModuleIcon />,
};

const minimumReleasedModuleIds = [
  "apolo",
  "hades",
  "atlas",
  "iris",
  "chronos",
  "hermes",
  "financeiro",
  "setup",
] as const;
const hiddenProductionModuleIds = new Set<string>();

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
  const notificationPanelRef = useRef<HTMLDivElement>(null);
  const [releasedModuleIds, setReleasedModuleIds] =
    useState<Set<string> | null>(null);
  const [isHomologationBrand, setIsHomologationBrand] = useState(
    isShellHomologationEnvironment,
  );
  const { hubUser, profileStatus, signOut } = useAuth();
  const hubPresence = useHubPresenceController({
    enabled: profileStatus === "ready" && Boolean(hubUser),
  });
  const { realtimeState } = useRealtime();
  const pathname = usePathname();
  const router = useRouter();
  const unreadNotificationsCount = getUnreadNotificationsCount(realtimeState);
  const panteonBrandIconSrc = isHomologationBrand
    ? "/panteon-mark-homolog.png"
    : "/panteon-mark-light.png";
  const activeModule = orderedHubModules.find((hubModule) =>
    pathname.startsWith(hubModule.basePath),
  );

  useOutsideDismiss({
    enabled: isNotificationPanelOpen,
    onDismiss: () => setIsNotificationPanelOpen(false),
    ref: notificationPanelRef,
  });

  useEffect(() => {
    setIsHomologationBrand(
      isShellHomologationEnvironment ||
        isHomologationHostname(window.location.hostname),
    );
  }, []);

  const visibleHubModules = orderedHubModules.filter((hubModule) => {
    if (!isVisibleInCurrentEnvironment(hubModule.id, isHomologationBrand)) {
      return false;
    }

    if (isZeusModuleId(hubModule.id)) {
      return false;
    }

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
      if (
        !canOpenShellModule(hubModule.id, hubUser, hubModule, profileStatus)
      ) {
        return [];
      }

      return hubModule.navigationItems.map((item) => ({
        ...item,
        badge: undefined,
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

    withShellTimeout(
      Promise.all([
        client.from("hub_modules").select("id").eq("status", "active"),
        client
          .from("hub_department_modules")
          .select("module_id")
          .eq("status", "enabled"),
      ]),
      "modules",
      8_000,
    )
      .then(([modulesResult, accessResult]) => {
        if (!isMounted) {
          return;
        }

        if (modulesResult.error || accessResult.error) {
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
    function handleToggleModuleLauncher() {
      if (isOperationalChrome) {
        setIsOperationalRailOpen((currentValue) => !currentValue);
        return;
      }

      setIsSidebarCollapsed(false);
      window.localStorage.setItem("careli:hub-sidebar", "expanded");
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
    <AthenaTicketRecordingProvider>
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
                      aria-label="Voltar para a Home do Panteon"
                      className="grid h-10 w-10 place-items-center rounded-lg border border-white/[0.08] bg-[#101820] text-[#d5dde8] outline-none transition hover:border-[#A07C3B]/45 hover:bg-[#05070b] hover:text-white focus-visible:ring-2 focus-visible:ring-[var(--uix-color-focus)]"
                      href="/"
                    >
                      <PanteonBrandMark
                        className="h-7 w-7"
                        src={panteonBrandIconSrc}
                      />
                    </Link>
                    <Tooltip content="Expandir menu" placement="right">
                      <button
                        aria-label="Expandir sidebar"
                        className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.075] text-[var(--uix-text-muted)] outline-none transition hover:border-white/[0.16] hover:bg-white/[0.07] hover:text-[var(--uix-text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--uix-color-focus)]"
                        onClick={handleToggleSidebar}
                        type="button"
                      >
                        <PanelLeftOpen aria-hidden="true" size={16} />
                      </button>
                    </Tooltip>
                  </div>
                ) : (
                  <div className="grid min-h-12 grid-cols-[minmax(0,1fr)_2rem] items-center gap-3 rounded-xl bg-white/[0.035] px-2.5 py-2">
                    <Link
                      aria-label="Panteon"
                      className="flex min-w-0 items-center gap-2.5 text-[#d5dde8] outline-none transition hover:text-white focus-visible:ring-2 focus-visible:ring-[var(--uix-color-focus)]"
                      href="/"
                    >
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/[0.08] bg-[#101820]">
                        <PanteonBrandMark
                          className="h-7 w-7"
                          src={panteonBrandIconSrc}
                        />
                      </span>
                      <span className="grid min-w-0 gap-0.5">
                        <span className="min-w-0 truncate text-sm font-semibold leading-tight text-white">
                          Panteon
                        </span>
                      </span>
                    </Link>
                    <Tooltip content="Recolher menu" placement="right">
                      <button
                        aria-label="Recolher sidebar"
                        className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.075] text-[var(--uix-text-muted)] outline-none transition hover:border-white/[0.16] hover:bg-white/[0.07] hover:text-[var(--uix-text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--uix-color-focus)]"
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
              <SidebarGroup>
                {moduleNavigationItems.map((item) => (
                  <Tooltip
                    content={item.disabled ? item.statusLabel : item.label}
                    key={`${item.moduleId}-${item.id}`}
                    placement="right"
                  >
                    <SidebarItem
                      active={
                        !item.disabled && isShellPathActive(pathname, item.path)
                      }
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
                  <div className="relative" ref={notificationPanelRef}>
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
                        items={realtimeState.notifications.map(
                          (notification) => ({
                            description: notification.moduleId
                              ? `Modulo: ${notification.moduleId}`
                              : "Panteon Central",
                            id: notification.id,
                            read: notification.read,
                            status: notification.severity,
                            timestamp: notification.timestamp,
                            title: notification.title,
                          }),
                        )}
                        title="Notificacoes"
                        unreadCount={unreadNotificationsCount}
                      />
                    ) : null}
                  </div>
                  <PanteonNativeNotificationButton
                    notifications={realtimeState.notifications}
                  />
                  <PanteonInstallButton />
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
                    {layoutMode === "module"
                      ? (activeModule?.name ?? "Modulo")
                      : "Home"}
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
                      void hubPresence
                        .setStatus(nextStatus, {
                          manual: true,
                          reason: "manual",
                        })
                        .catch((error: unknown) => {
                          if (isLocalhostRuntime()) {
                            console.warn(
                              "[presence] manual update error",
                              error,
                            );
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
            isOperationalChrome
              ? "h-[100dvh] max-h-[100dvh] min-h-0"
              : undefined
          }
          padded={layoutMode === "dashboard"}
        >
          {children}
        </ContentArea>
      </AppShell>
      {isOperationalChrome && isOperationalRailOpen ? (
        <>
          <button
            aria-label="Fechar menu Panteon"
            className="fixed inset-0 z-[var(--uix-z-overlay)] cursor-default bg-black/[0.06] outline-none"
            onClick={() => setIsOperationalRailOpen(false)}
            type="button"
          />
          <aside
            aria-label="Menu Panteon"
            className="careli-module-launcher fixed left-3 top-[4.25rem] z-[var(--uix-z-modal)] grid w-[15.25rem] gap-2 rounded-xl border border-white/[0.09] bg-[#232832] p-2.5 shadow-2xl"
          >
            <Tooltip content="Panteon" placement="right">
              <Link
                aria-label="Voltar para a Home do Panteon"
                className="careli-module-launcher__home flex h-12 items-center gap-3 rounded-lg border border-white/[0.075] bg-white/[0.04] px-2.5 text-[#d7dee8] outline-none transition hover:border-[#A07C3B]/45 hover:bg-white/[0.075] hover:text-white focus-visible:ring-2 focus-visible:ring-[var(--uix-color-focus)]"
                href="/"
                onClick={() => setIsOperationalRailOpen(false)}
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/[0.08] bg-[#101820]">
                  <PanteonBrandMark
                    className="h-6 w-6"
                    src={panteonBrandIconSrc}
                  />
                </span>
                <span className="grid min-w-0 gap-0.5">
                  <span className="min-w-0 truncate text-sm font-semibold">
                    Panteon
                  </span>
                </span>
              </Link>
            </Tooltip>
            {moduleNavigationItems.map((item) => (
              <Tooltip
                content={item.disabled ? item.statusLabel : item.label}
                key={`${item.moduleId}-${item.id}`}
                placement="right"
              >
                {item.disabled ? (
                  <button
                    aria-label={`${item.label} em preparacao`}
                    className="relative flex h-11 w-full cursor-not-allowed items-center gap-3 rounded-lg border border-transparent px-2.5 text-[#687386] opacity-60 outline-none"
                    disabled
                    type="button"
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/[0.04]">
                      {item.icon}
                    </span>
                    <span className="min-w-0 truncate text-sm font-semibold">
                      {item.label}
                    </span>
                  </button>
                ) : (
                  <Link
                    aria-current={
                      isShellPathActive(pathname, item.path)
                        ? "page"
                        : undefined
                    }
                    className="careli-module-launcher__item relative flex h-11 items-center gap-3 rounded-lg border border-transparent px-2.5 text-[#c5ceda] outline-none transition hover:border-white/[0.08] hover:bg-white/[0.075] hover:text-white focus-visible:ring-2 focus-visible:ring-[var(--uix-color-focus)] aria-[current=page]:border-[#A07C3B]/35 aria-[current=page]:bg-[#171b23] aria-[current=page]:text-white"
                    href={item.path}
                    onClick={() => setIsOperationalRailOpen(false)}
                  >
                    {isShellPathActive(pathname, item.path) ? (
                      <span className="absolute left-0 top-2 h-7 w-0.5 rounded-full bg-[#D6B56F]" />
                    ) : null}
                    <span className="careli-module-launcher__icon grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/[0.055] text-[#d7dee8]">
                      {item.icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                      {item.label}
                    </span>
                  </Link>
                )}
              </Tooltip>
            ))}
            <Tooltip content="Sair" placement="right">
              <button
                aria-label="Sair"
                className="flex h-10 w-full items-center gap-3 rounded-lg border border-transparent px-2.5 text-[#aeb7c5] outline-none transition hover:border-white/[0.08] hover:bg-white/[0.075] hover:text-white focus-visible:ring-2 focus-visible:ring-[var(--uix-color-focus)]"
                onClick={() => {
                  void signOut();
                }}
                type="button"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/[0.055]">
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
        title="Comandos do Panteon"
      />
      <HubSupportDock />
    </AthenaTicketRecordingProvider>
  );
}

function PanteonNativeNotificationButton({
  notifications,
}: {
  notifications: readonly RealtimeNotification[];
}) {
  const [permission, setPermission] =
    useState<PanteonNativeNotificationPermission>("unsupported");
  const [feedback, setFeedback] = useState<string | null>(null);
  const seenNotificationIdsRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    setPermission(getPanteonNativeNotificationPermission());
  }, []);

  useEffect(() => {
    if (!feedback) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setFeedback(null);
    }, 3500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [feedback]);

  useEffect(() => {
    if (seenNotificationIdsRef.current === null) {
      seenNotificationIdsRef.current = new Set(
        notifications.map((notification) => notification.id),
      );
      return;
    }

    if (permission !== "granted") {
      return;
    }

    const seenNotificationIds = seenNotificationIdsRef.current;

    notifications.forEach((notification) => {
      if (seenNotificationIds.has(notification.id)) {
        return;
      }

      seenNotificationIds.add(notification.id);

      if (notification.read) {
        return;
      }

      void showPanteonNativeNotification({
        body: createPanteonNativeNotificationBody(notification),
        tag: `panteon-${notification.id}`,
        title: notification.title,
        url: getPanteonNativeNotificationPath(notification),
      });
    });
  }, [notifications, permission]);

  if (permission === "unsupported") {
    return null;
  }

  const tone = getPanteonNativeNotificationTone(permission);

  return (
    <Tooltip
      content={feedback ?? getPanteonNativeNotificationSupportLabel(permission)}
    >
      <button
        aria-label="Ativar notificacoes do Windows"
        className={`relative grid h-8 w-8 place-items-center rounded-md border outline-none transition hover:brightness-95 focus-visible:ring-2 focus-visible:ring-[#A07C3B] ${tone.button}`}
        onClick={() => {
          void handlePanteonNativeNotificationClick(
            permission,
            setFeedback,
            setPermission,
          );
        }}
        type="button"
      >
        <BellRing aria-hidden="true" size={17} />
        <span
          aria-hidden="true"
          className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-white ${tone.dot}`}
        />
      </button>
    </Tooltip>
  );
}

async function handlePanteonNativeNotificationClick(
  permission: PanteonNativeNotificationPermission,
  setFeedback: (feedback: string) => void,
  setPermission: (permission: PanteonNativeNotificationPermission) => void,
) {
  const nextPermission =
    permission === "default"
      ? await requestPanteonNativeNotificationPermission()
      : getPanteonNativeNotificationPermission();

  setPermission(nextPermission);

  if (nextPermission === "granted") {
    await showPanteonNativeNotification({
      body: "Notificacoes do Hub ativas no Windows.",
      tag: "panteon-native-test",
      title: "Panteon",
      url: "/",
    });
    setFeedback("Teste enviado para o Windows.");
    return;
  }

  if (nextPermission === "denied") {
    setFeedback("Permissao bloqueada nas configuracoes do site/app.");
    return;
  }

  if (nextPermission === "unsupported") {
    setFeedback("Notificacoes do Windows indisponiveis neste navegador.");
    return;
  }

  setFeedback("Clique para permitir notificacoes do Windows.");
}

function createPanteonNativeNotificationBody(
  notification: RealtimeNotification,
) {
  const hubModule = notification.moduleId
    ? orderedHubModules.find(
        (moduleItem) => moduleItem.id === notification.moduleId,
      )
    : null;

  if (hubModule) {
    return `Abrir ${hubModule.name} no Panteon.`;
  }

  return "Nova notificacao operacional no Panteon.";
}

function getPanteonNativeNotificationPath(
  notification: RealtimeNotification,
) {
  const hubModule = notification.moduleId
    ? orderedHubModules.find(
        (moduleItem) => moduleItem.id === notification.moduleId,
      )
    : null;

  return hubModule?.basePath ?? "/";
}

function getPanteonNativeNotificationTone(
  permission: PanteonNativeNotificationPermission,
) {
  if (permission === "granted") {
    return {
      button:
        "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
      dot: "bg-emerald-500",
    };
  }

  if (permission === "denied") {
    return {
      button: "border-red-200 bg-red-50 text-red-700 hover:bg-red-100",
      dot: "bg-red-500",
    };
  }

  return {
    button:
      "border-[#d9e0e7] bg-white text-[#526078] hover:bg-[#f8fafc] hover:text-[#101820]",
    dot: "bg-amber-500",
  };
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function PanteonInstallButton() {
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (isStandalonePwa()) {
      setInstallPrompt(null);
      return;
    }

    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    }

    function handleAppInstalled() {
      setInstallPrompt(null);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt,
      );
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  if (!installPrompt) {
    return null;
  }

  return (
    <Tooltip content="Instalar Panteon">
      <button
        aria-label="Instalar Panteon"
        className="grid h-8 w-8 place-items-center rounded-md border border-[#d9e0e7] bg-white text-[#526078] outline-none transition hover:bg-[#f8fafc] hover:text-[#101820] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
        onClick={() => {
          void installPrompt.prompt().finally(() => {
            setInstallPrompt(null);
          });
        }}
        type="button"
      >
        <Download aria-hidden="true" size={17} />
      </button>
    </Tooltip>
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
  const controlRef = useRef<HTMLDivElement>(null);

  useOutsideDismiss({
    enabled: open,
    onDismiss: () => onOpenChange(false),
    ref: controlRef,
  });

  return (
    <div className="relative" ref={controlRef}>
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
                <span
                  className={`h-2.5 w-2.5 rounded-full ${optionTone.dot}`}
                />
                <span className="capitalize">
                  {getHubPresenceLabel(option)}
                </span>
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

function PanteonBrandMark({
  className,
  src,
}: {
  className: string;
  src: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`block bg-contain bg-center bg-no-repeat ${className}`}
      style={{
        backgroundImage: `url("${src}")`,
      }}
    />
  );
}

function ZeusModuleIcon() {
  return (
    <span
      aria-hidden="true"
      className="block h-[18px] w-[18px] bg-current"
      style={{
        WebkitMaskImage: "url('/zeus-module-mark.png')",
        WebkitMaskPosition: "center",
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
        maskImage: "url('/zeus-module-mark.png')",
        maskPosition: "center",
        maskRepeat: "no-repeat",
        maskSize: "contain",
      }}
    />
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
  } as const satisfies Record<
    Exclude<HubPresenceStatus, "busy">,
    {
      button: string;
      dot: string;
    }
  >;

  return tones[normalizedStatus];
}

function getInitials(name: string) {
  const [first = "", second = ""] = name.trim().split(/\s+/);

  return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase() || "--";
}

function isLocalhostRuntime() {
  return ["localhost", "127.0.0.1"].includes(window.location.hostname);
}

function isStandalonePwa() {
  const navigatorWithStandalone = navigator as Navigator & {
    standalone?: boolean;
  };

  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    navigatorWithStandalone.standalone === true
  );
}

function isHomologationHostname(hostname: string) {
  const normalizedHostname = hostname.toLowerCase();

  return (
    normalizedHostname.includes("homo") ||
    normalizedHostname.includes("homolog")
  );
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
  if (isZeusModuleId(moduleId)) {
    return canAccessZeusModule(hubUser);
  }

  if (hubUser && canAccessModule(hubUser, hubModule)) {
    return true;
  }

  if (hubUser && roleCanViewModule(hubUser.role, hubModule)) {
    return true;
  }

  if (
    hubUser &&
    minimumReleasedModuleIds.includes(
      moduleId as (typeof minimumReleasedModuleIds)[number],
    )
  ) {
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

function isVisibleInCurrentEnvironment(
  moduleId: string,
  isHomologationEnvironment: boolean,
) {
  return (
    process.env.NODE_ENV !== "production" ||
    isHomologationEnvironment ||
    !hiddenProductionModuleIds.has(moduleId)
  );
}

function isZeusModuleId(moduleId: string) {
  return moduleId === "zeus";
}

function canAccessZeusModule(hubUser: HubUserContext | null) {
  return (
    hubUser?.role === "admin" ||
    hubUser?.operationalProfile?.profileRole === "adm"
  );
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
