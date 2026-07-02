import type { HermesMessageTag } from "@/lib/pulsex";

// Emojis rápidos de reação (mesma ideia do desktop). Emoji é conteúdo do chat,
// não decoração de UI — ok usar aqui.
export const HERMES_REACTION_EMOJIS = [
  "👍",
  "❤️",
  "😂",
  "🎉",
  "🙏",
  "✅",
] as const;

// Tags do Hermes com rótulo + classes de cor (bg/text).
export const HERMES_TAG_OPTIONS: readonly {
  chip: string;
  key: HermesMessageTag;
  label: string;
}[] = [
  { chip: "bg-[#fceaea] text-[#a32d2d]", key: "urgente", label: "Urgente" },
  { chip: "bg-[#f6ecd7] text-[#8a6d1f]", key: "importante", label: "Importante" },
  { chip: "bg-[#fdf3d8] text-[#8a6d1f]", key: "pendente", label: "Pendente" },
  { chip: "bg-[#e7f6ee] text-[#1d7a52]", key: "resolvido", label: "Resolvido" },
  { chip: "bg-[#eaf1fb] text-[#185fa5]", key: "acompanhar", label: "Acompanhar" },
];

const TAG_BY_KEY = new Map(HERMES_TAG_OPTIONS.map((tag) => [tag.key, tag]));

export function hermesTagChipClass(tag: HermesMessageTag): string {
  return TAG_BY_KEY.get(tag)?.chip ?? "bg-[#f0f2f6] text-[#526078]";
}

export function hermesTagLabel(tag: HermesMessageTag): string {
  return TAG_BY_KEY.get(tag)?.label ?? tag;
}
