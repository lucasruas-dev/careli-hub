import type { PulseXMessageTag } from "./types";

export const pulseXMessageTagOptions = [
  {
    className: "border-rose-200 bg-rose-50 text-rose-700",
    id: "urgente",
    label: "Urgente",
  },
  {
    className: "border-[#A07C3B]/30 bg-[#A07C3B]/10 text-[#7b5f2d]",
    id: "importante",
    label: "Importante",
  },
  {
    className: "border-amber-200 bg-amber-50 text-amber-700",
    id: "pendente",
    label: "Pendente",
  },
  {
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    id: "resolvido",
    label: "Resolvido",
  },
  {
    className: "border-sky-200 bg-sky-50 text-sky-700",
    id: "acompanhar",
    label: "Acompanhar",
  },
] as const satisfies readonly {
  className: string;
  id: PulseXMessageTag;
  label: string;
}[];

export const pulseXMessageTagIds = pulseXMessageTagOptions.map(
  (option) => option.id,
) as readonly PulseXMessageTag[];

export function isPulseXMessageTag(value: string): value is PulseXMessageTag {
  return pulseXMessageTagIds.some((tag) => tag === value);
}

export function normalizePulseXMessageTags(value: unknown): PulseXMessageTag[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value.filter(
        (tag): tag is PulseXMessageTag =>
          typeof tag === "string" && isPulseXMessageTag(tag),
      ),
    ),
  ];
}

export function getPulseXMessageTagLabel(tag: PulseXMessageTag) {
  return pulseXMessageTagOptions.find((option) => option.id === tag)?.label ?? tag;
}

export function getPulseXMessageTagClassName(tag: PulseXMessageTag) {
  return (
    pulseXMessageTagOptions.find((option) => option.id === tag)?.className ??
    "border-[#d9e0ea] bg-white text-[#344054]"
  );
}
