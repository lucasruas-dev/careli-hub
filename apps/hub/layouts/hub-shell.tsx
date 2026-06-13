"use client";

import { useOutsideDismiss } from "@/hooks/use-outside-dismiss";
import { PanteonTopbarUser } from "@/components/panteon/panteon-topbar-user";
import { AthenaTicketRecordingProvider } from "@/components/hub-support/athena-ticket-recording-provider";
import { HubSupportDock } from "@/components/hub-support/hub-support-dock";
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
  BarChart3,
  CalendarClock,
  CalendarDays,
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
  const notificationPanelRef = useRef<HTMLDivElement>(null);
  const [releasedModuleIds, setReleasedModuleIds] =
    useState<Set<string> | null>(null);
  const [isHomologationBrand, setIsHomologationBrand] = useState(
    isShellHomologationEnvironment,
  );
  const { hubUser, profileStatus, signOut } = useAuth();
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
              user={<PanteonTopbarUser />}
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
