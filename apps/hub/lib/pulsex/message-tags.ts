import type { HermesMessageTag } from "./types";

export const hermesMessageTagOptions = [
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
  id: HermesMessageTag;
  label: string;
}[];

export const hermesMessageTagIds = hermesMessageTagOptions.map(
  (option) => option.id,
) as readonly HermesMessageTag[];

export function isHermesMessageTag(value: string): value is HermesMessageTag {
  return hermesMessageTagIds.some((tag) => tag === value);
}

export function normalizeHermesMessageTags(value: unknown): HermesMessageTag[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value.filter(
        (tag): tag is HermesMessageTag =>
          typeof tag === "string" && isHermesMessageTag(tag),
      ),
    ),
  ];
}

export function getHermesMessageTagLabel(tag: HermesMessageTag) {
  return hermesMessageTagOptions.find((option) => option.id === tag)?.label ?? tag;
}

export function getHermesMessageTagClassName(tag: HermesMessageTag) {
  return (
    hermesMessageTagOptions.find((option) => option.id === tag)?.className ??
    "border-[#d9e0ea] bg-white text-[#344054]"
  );
}
