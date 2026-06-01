const EMPTY_FORMATTED_FIELD = "-";

export type FeedbackTone = "error" | "success" | "warning";

export function feedbackToneClassName(tone: FeedbackTone) {
  if (tone === "warning") return "border-amber-200 bg-amber-50 text-amber-800";
  if (tone === "error") return "border-rose-100 bg-rose-50 text-rose-700";

  return "border-emerald-100 bg-emerald-50 text-emerald-700";
}

export function formatDateTime(value?: string | null) {
  if (!value) return EMPTY_FORMATTED_FIELD;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return EMPTY_FORMATTED_FIELD;

  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  });
}

export function formatTime(value?: string | null) {
  if (!value) return EMPTY_FORMATTED_FIELD;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return EMPTY_FORMATTED_FIELD;

  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
