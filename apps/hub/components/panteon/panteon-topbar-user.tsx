"use client";

import { ChevronDown, LogOut, Moon, Sun } from "lucide-react";
import { useRef, useState } from "react";
import { Tooltip } from "@repo/uix";

import { useHubPresenceController } from "@/hooks/use-hub-presence";
import { useOutsideDismiss } from "@/hooks/use-outside-dismiss";
import {
  getHubPresenceLabel,
  hubPresenceStatusOptions,
  type HubPresenceStatus,
} from "@/lib/hub-presence";
import { useAuth } from "@/providers/auth-provider";
import { useHubTheme } from "@/providers/theme-provider";
import { PANTEON_VERSION } from "@/lib/build-info";
import { PanteonLoadingMark } from "@/components/panteon/panteon-loading";
import { PanteonNotificationButton } from "@/components/panteon/panteon-notification-button";
import { PanteonUpdatePill } from "@/components/panteon/panteon-update-pill";

type PanteonTopbarUserProps = {
  className?: string;
  compact?: boolean;
  onDark?: boolean;
  source?: string;
};

export function PanteonTopbarUser({
  className = "",
  compact = false,
  onDark = false,
  source = "hub-shell",
}: PanteonTopbarUserProps) {
  const { hubUser, profileStatus, signOut } = useAuth();
  const [isPresenceMenuOpen, setIsPresenceMenuOpen] = useState(false);
  const isPresenceReady = profileStatus === "ready" && Boolean(hubUser);
  const hubPresence = useHubPresenceController({
    enabled: isPresenceReady,
    onAutoLogout: () => signOut(),
    source,
  });
  const name =
    hubUser?.name ?? (profileStatus === "ready" ? "Sessao" : "Carregando");
  const status = isPresenceReady ? hubPresence.status : "offline";

  return (
    <div className={`flex h-10 shrink-0 items-center gap-2 ${className}`}>
      <PanteonUpdatePill onDark={onDark} />

      <ThemeToggle onDark={onDark} />

      <PanteonNotificationButton />

      <PanteonPresenceControl
        disabled={!isPresenceReady}
        onDark={onDark}
        onChange={(nextStatus) => {
          setIsPresenceMenuOpen(false);
          void hubPresence
            .setStatus(nextStatus, {
              manual: true,
              metadata:
                nextStatus === "agenda" ? { rule: "manual_agenda" } : undefined,
              reason: "manual",
            })
            .catch((error: unknown) => {
              if (isLocalhostRuntime()) {
                console.warn("[presence] manual update error", error);
              }
            });
        }}
        onOpenChange={setIsPresenceMenuOpen}
        open={isPresenceMenuOpen}
        status={status}
        statusLabel={isPresenceReady ? undefined : "Conectando"}
        visibilityClassName={
          compact ? "hidden xl:inline-flex" : "hidden md:inline-flex"
        }
      />

      <span
        aria-label={`Foto de ${name}`}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#d9e0e7] bg-[#101820] bg-cover bg-center text-[0.6875rem] font-semibold text-white"
        role="img"
        title={`Panteon ${PANTEON_VERSION}`}
        style={
          hubUser?.avatarUrl
            ? {
                backgroundImage: `url(${hubUser.avatarUrl})`,
              }
            : undefined
        }
      >
        {hubUser?.avatarUrl ? null : getInitials(name)}
      </span>

      <span
        className={`max-w-28 truncate text-sm font-medium ${
          onDark ? "text-[#d5dde8]" : "text-[#243044]"
        } ${
          onDark ? "hidden" : compact ? "hidden xl:block" : "hidden sm:block"
        }`}
      >
        {name}
      </span>

      <Tooltip content="Sair" placement="bottom">
        <button
          aria-label="Sair"
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-md outline-none transition focus-visible:ring-2 focus-visible:ring-[#A07C3B] ${
            onDark
              ? "text-[#a5afbd] hover:bg-white/10 hover:text-white"
              : "text-[#526078] hover:bg-[#f3f6fa] hover:text-[#101820]"
          }`}
          onClick={() => {
            void signOut();
          }}
          type="button"
        >
          <LogOut aria-hidden="true" size={16} />
        </button>
      </Tooltip>
    </div>
  );
}

function ThemeToggle({ onDark }: { onDark: boolean }) {
  const { mode, toggle } = useHubTheme();
  const isDark = mode === "dark";

  return (
    <Tooltip content={isDark ? "Tema claro" : "Tema escuro"} placement="bottom">
      <button
        aria-label={isDark ? "Ativar tema claro" : "Ativar tema escuro"}
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-md outline-none transition focus-visible:ring-2 focus-visible:ring-[#A07C3B] ${
          onDark
            ? "text-[#a5afbd] hover:bg-white/10 hover:text-white"
            : "text-[#526078] hover:bg-[#f3f6fa] hover:text-[#101820]"
        }`}
        onClick={toggle}
        type="button"
      >
        {isDark ? (
          <Sun aria-hidden="true" size={16} />
        ) : (
          <Moon aria-hidden="true" size={16} />
        )}
      </button>
    </Tooltip>
  );
}

function PanteonPresenceControl({
  disabled,
  onChange,
  onDark,
  onOpenChange,
  open,
  status,
  statusLabel,
  visibilityClassName,
}: {
  disabled: boolean;
  onChange: (status: HubPresenceStatus) => void;
  onDark: boolean;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  status: HubPresenceStatus;
  statusLabel?: string;
  visibilityClassName: string;
}) {
  const tone = getPresenceTone(status, onDark);
  const controlRef = useRef<HTMLDivElement>(null);

  useOutsideDismiss({
    enabled: open,
    onDismiss: () => onOpenChange(false),
    ref: controlRef,
  });

  return (
    <div className={`relative ${visibilityClassName}`} ref={controlRef}>
      <button
        aria-expanded={open}
        aria-label="Alterar status de presenca"
        className={`inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs font-semibold outline-none transition hover:brightness-95 focus-visible:ring-2 focus-visible:ring-[#A07C3B] disabled:cursor-not-allowed disabled:opacity-70 ${tone.button}`}
        disabled={disabled}
        onClick={() => onOpenChange(!open)}
        type="button"
      >
        {disabled ? (
          <PanteonLoadingMark size="xs" />
        ) : (
          <span className={`h-2 w-2 rounded-full ${tone.dot}`} />
        )}
        <span className="capitalize">
          {statusLabel ?? getHubPresenceLabel(status)}
        </span>
        {disabled ? null : <ChevronDown aria-hidden="true" size={14} />}
      </button>
      {open && !disabled ? (
        <div
          className={`absolute right-0 top-10 z-[var(--uix-z-popover)] w-44 rounded-md border p-1.5 shadow-xl ${
            onDark
              ? "border-white/10 bg-[#242725]"
              : "border-[#d9e0e7] bg-white"
          }`}
        >
          {hubPresenceStatusOptions.map((option) => {
            const optionTone = getPresenceTone(option, onDark);

            return (
              <button
                className={`flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-[#A07C3B] ${
                  onDark
                    ? "text-[#dadcd7] hover:bg-white/10"
                    : "text-[#17202f] hover:bg-[#f4f6f8]"
                }`}
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

function getPresenceTone(status: HubPresenceStatus, onDark: boolean) {
  const normalizedStatus = status === "busy" ? "agenda" : status;
  const lightTones = {
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
    { button: string; dot: string }
  >;
  // Barra escura (onDark): pilulas translucidas + texto claro, pra nao virar mancha clara no grafite.
  const darkTones = {
    agenda: {
      button: "border-sky-500/30 bg-sky-500/15 text-sky-200",
      dot: "bg-sky-500",
    },
    away: {
      button: "border-red-500/30 bg-red-500/15 text-red-200",
      dot: "bg-red-500",
    },
    lunch: {
      button: "border-yellow-500/30 bg-yellow-500/15 text-yellow-200",
      dot: "bg-yellow-400",
    },
    offline: {
      button: "border-white/[0.12] bg-white/[0.06] text-[#a5afbd]",
      dot: "bg-zinc-400",
    },
    online: {
      button: "border-emerald-500/30 bg-emerald-500/15 text-emerald-200",
      dot: "bg-emerald-500",
    },
  } as const satisfies Record<
    Exclude<HubPresenceStatus, "busy">,
    { button: string; dot: string }
  >;

  return (onDark ? darkTones : lightTones)[normalizedStatus];
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "P";
  }

  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function isLocalhostRuntime() {
  return ["localhost", "127.0.0.1"].includes(window.location.hostname);
}
