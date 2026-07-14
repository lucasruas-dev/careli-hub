import type { ChronosMeetingType } from "@/lib/chronos/types";

export const chronosMeetingTypeVisuals = {
  alignment: {
    accentClass: "border-l-blue-500",
    chipClass: "border-blue-100 dark:border-blue-500/25 bg-blue-50 dark:bg-blue-500/12 text-blue-700 dark:text-blue-300",
    dotClass: "bg-blue-500",
    label: "Alinhamento",
    pillClass: "border-blue-200 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/12 text-blue-700 dark:text-blue-300",
  },
  client: {
    accentClass: "border-l-[#A07C3B]",
    chipClass: "border-[#eadfcb] bg-[#fff8e8] dark:bg-[#a07c3b]/10 text-[#7a5a1f] dark:text-[#d9b877]",
    dotClass: "bg-[#A07C3B]",
    label: "Reuniao",
    pillClass: "border-[#eadfcb] bg-[#fff8e8] dark:bg-[#a07c3b]/10 text-[#7a5a1f] dark:text-[#d9b877]",
  },
  executive: {
    accentClass: "border-l-[#101820]",
    chipClass: "border-line bg-subtle text-ink",
    dotClass: "bg-inverse",
    label: "Reuniao",
    pillClass: "border-line bg-subtle text-ink",
  },
  external: {
    accentClass: "border-l-[#526078]",
    chipClass: "border-line bg-subtle text-ink-muted",
    dotClass: "bg-[#526078]",
    label: "Reuniao",
    pillClass: "border-line bg-subtle text-ink-muted",
  },
  formal: {
    accentClass: "border-l-amber-500",
    chipClass: "border-amber-100 dark:border-amber-500/25 bg-amber-50 dark:bg-amber-500/12 text-amber-800 dark:text-amber-300",
    dotClass: "bg-amber-500",
    label: "Comunicado",
    pillClass: "border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/12 text-amber-800 dark:text-amber-300",
  },
  results: {
    accentClass: "border-l-emerald-500",
    chipClass: "border-emerald-100 dark:border-emerald-500/25 bg-emerald-50 dark:bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
    dotClass: "bg-emerald-500",
    label: "Resultado",
    pillClass: "border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
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
