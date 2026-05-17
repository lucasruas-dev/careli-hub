import type { PulseXMessageTag } from "./types";

export const pulseXMessageTagOptions = [
  {
    className: "border-rose-300 bg-rose-100 text-rose-800",
    id: "urgente",
    label: "Urgente",
  },
  {
    className: "border-amber-400 bg-amber-100 text-amber-900",
    id: "importante",
    label: "Importante",
  },
  {
    className: "border-orange-300 bg-orange-100 text-orange-800",
    id: "pendente",
    label: "Pendente",
  },
  {
    className: "border-emerald-300 bg-emerald-100 text-emerald-800",
    id: "resolvido",
    label: "Resolvido",
  },
  {
    className: "border-sky-300 bg-sky-100 text-sky-800",
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
