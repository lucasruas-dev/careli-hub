import type { ChronosMeetingType } from "@/lib/chronos/types";

export const chronosMeetingTypeVisuals = {
  alignment: {
    accentClass: "border-l-blue-500",
    chipClass: "border-blue-100 bg-blue-50 text-blue-700",
    dotClass: "bg-blue-500",
    label: "Alinhamento",
    pillClass: "border-blue-200 bg-blue-50 text-blue-700",
  },
  client: {
    accentClass: "border-l-[#A07C3B]",
    chipClass: "border-[#eadfcb] bg-[#fff8e8] text-[#7a5a1f]",
    dotClass: "bg-[#A07C3B]",
    label: "Reuniao",
    pillClass: "border-[#eadfcb] bg-[#fff8e8] text-[#7a5a1f]",
  },
  executive: {
    accentClass: "border-l-[#101820]",
    chipClass: "border-[#d9e0e7] bg-[#f8fafc] text-[#101820]",
    dotClass: "bg-[#101820]",
    label: "Reuniao",
    pillClass: "border-[#d9e0e7] bg-[#f8fafc] text-[#101820]",
  },
  external: {
    accentClass: "border-l-[#526078]",
    chipClass: "border-[#d9e0e7] bg-[#f8fafc] text-[#526078]",
    dotClass: "bg-[#526078]",
    label: "Reuniao",
    pillClass: "border-[#d9e0e7] bg-[#f8fafc] text-[#526078]",
  },
  formal: {
    accentClass: "border-l-amber-500",
    chipClass: "border-amber-100 bg-amber-50 text-amber-800",
    dotClass: "bg-amber-500",
    label: "Comunicado",
    pillClass: "border-amber-200 bg-amber-50 text-amber-800",
  },
  results: {
    accentClass: "border-l-emerald-500",
    chipClass: "border-emerald-100 bg-emerald-50 text-emerald-700",
    dotClass: "bg-emerald-500",
    label: "Resultado",
    pillClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
} as const satisfies Record<
  ChronosMeetingType,
  {
    accentClass: string;
    chipClass: string;
    dotClass: string;
    label: string;
    pillClass: string;
  }
>;

export function getChronosMeetingTypeVisual(value: string) {
  return (
    chronosMeetingTypeVisuals[value as ChronosMeetingType] ??
    chronosMeetingTypeVisuals.alignment
  );
}
