"use client";

import { LogOut } from "lucide-react";
import { Tooltip } from "@repo/uix";

import { useAuth } from "@/providers/auth-provider";

type PanteonTopbarUserProps = {
  className?: string;
  compact?: boolean;
};

export function PanteonTopbarUser({
  className = "",
  compact = false,
}: PanteonTopbarUserProps) {
  const { hubUser, profileStatus, signOut } = useAuth();
  const name =
    hubUser?.name ?? (profileStatus === "ready" ? "Sessao" : "Carregando");
  const isOnline = profileStatus === "ready" && Boolean(hubUser);
  const statusLabel = isOnline ? "Online" : "Conectando";
  const statusTone = isOnline
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-slate-200 bg-slate-50 text-slate-500";

  return (
    <div className={`flex h-10 shrink-0 items-center gap-2 ${className}`}>
      <span
        className={`h-8 items-center gap-2 rounded-md border px-2.5 text-xs font-semibold ${statusTone} ${
          compact ? "hidden 2xl:inline-flex" : "hidden md:inline-flex"
        }`}
      >
        <span
          aria-hidden="true"
          className={`h-2 w-2 rounded-full ${
            isOnline ? "bg-emerald-500" : "bg-slate-300"
          }`}
        />
        {statusLabel}
      </span>

      <span
        aria-label={`Foto de ${name}`}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#d9e0e7] bg-[#101820] bg-cover bg-center text-[0.6875rem] font-semibold text-white"
        role="img"
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
        className={`max-w-28 truncate text-sm font-medium text-[#243044] ${
          compact ? "hidden xl:block" : "hidden sm:block"
        }`}
      >
        {name}
      </span>

      <Tooltip content="Sair" placement="bottom">
        <button
          aria-label="Sair"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-[#526078] outline-none transition hover:bg-[#f3f6fa] hover:text-[#101820] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
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
