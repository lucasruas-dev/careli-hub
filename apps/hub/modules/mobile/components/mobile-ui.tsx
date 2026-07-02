import type { ReactNode } from "react";

import { getInitials } from "@/modules/mobile/lib/format";
import type { IrisProfileChipData } from "@/modules/mobile/lib/iris-profile";

// Paleta Panteon (mesma do desktop): tinta escura, dourado da marca e neutros.
export const MOBILE_COLORS = {
  border: "#e4e9f0",
  gold: "#A07C3B",
  goldSoft: "#f2e9d8",
  ink: "#101820",
  muted: "#6b778c",
  surface: "#f6f8fb",
} as const;

const MODULE_TONES: Record<string, { bg: string; fg: string; label: string }> = {
  apolo: { bg: "#eaf1fb", fg: "#2f5fa8", label: "Apolo" },
  chronos: { bg: "#eef0f5", fg: "#4a5568", label: "Chronos" },
  hades: { bg: "#fdeceb", fg: "#c0392b", label: "Hades" },
  hermes: { bg: "#e7f6ee", fg: "#1f8a5b", label: "Hermes" },
  iris: { bg: "#f6ecd7", fg: "#A07C3B", label: "Iris" },
  panteon: { bg: "#eef0f5", fg: "#4a5568", label: "Panteon" },
};

export function getModuleTone(moduleId: string) {
  return (
    MODULE_TONES[moduleId] ?? {
      bg: "#eef0f5",
      fg: "#4a5568",
      label: moduleId ? moduleId[0]!.toUpperCase() + moduleId.slice(1) : "Panteon",
    }
  );
}

/** Avatar circular: usa foto quando existe, senao iniciais sobre fundo escuro. */
export function MobileAvatar({
  label,
  size = 44,
  url,
}: {
  label?: string | null;
  size?: number;
  url?: string | null;
}) {
  const dimension = `${size}px`;

  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt={label ?? "Avatar"}
        className="shrink-0 rounded-full object-cover"
        height={size}
        src={url}
        style={{ height: dimension, width: dimension }}
        width={size}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-full bg-[#101820] font-semibold text-white"
      style={{ fontSize: size * 0.34, height: dimension, width: dimension }}
    >
      {getInitials(label)}
    </span>
  );
}

/** Pilula de contagem (nao-lidas). Nao renderiza nada quando zero. */
export function UnreadBadge({ count }: { count: number }) {
  if (!count || count < 1) {
    return null;
  }

  return (
    <span className="grid min-w-[1.15rem] place-items-center rounded-full bg-[#A07C3B] px-1.5 text-[0.7rem] font-bold leading-5 text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** Chip do modulo (Iris/Hermes/...) com a cor da marca. */
export function ModuleChip({ moduleId }: { moduleId: string }) {
  const tone = getModuleTone(moduleId);

  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[0.68rem] font-semibold"
      style={{ backgroundColor: tone.bg, color: tone.fg }}
    >
      {tone.label}
    </span>
  );
}

/** Estado vazio padrao das telas mobile. */
export function MobileEmptyState({
  description,
  icon,
  title,
}: {
  description?: string;
  icon?: ReactNode;
  title: string;
}) {
  return (
    <div className="grid place-items-center px-8 py-16 text-center">
      {icon ? (
        <span className="mb-3 grid h-14 w-14 place-items-center rounded-full bg-white text-[#A07C3B] shadow-sm">
          {icon}
        </span>
      ) : null}
      <p className="m-0 text-sm font-semibold text-[#101820]">{title}</p>
      {description ? (
        <p className="mt-1 max-w-[16rem] text-xs text-[#6b778c]">{description}</p>
      ) : null}
    </div>
  );
}

/**
 * Chip de perfil do contato (igual ao board): "Comprador" fica VERMELHO
 * (inadimplente) ou VERDE (adimplente); demais perfis (Imob./Colab./Prospect…)
 * ficam neutros. Sem bolinha — a cor do chip já diz a adimplência.
 */
export function IrisProfileChip({ crm }: { crm: IrisProfileChipData }) {
  if (!crm.label) {
    return null;
  }

  const toneClass =
    crm.dotColor === "red"
      ? "bg-[#fceaea] text-[#a32d2d]"
      : crm.dotColor === "green"
        ? "bg-[#e7f6ee] text-[#1d7a52]"
        : "bg-[#eef1f5] text-[#526078]";

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[0.66rem] font-medium ${toneClass}`}
    >
      {crm.label}
    </span>
  );
}
