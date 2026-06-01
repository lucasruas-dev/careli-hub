export type AttendanceSection = "queue" | "desk" | "portfolio";

export function normalizeAttendanceProtocol(value?: string | null) {
  const normalized = String(value ?? "").trim().toUpperCase();

  return /^AT-\d{1,12}$/.test(normalized) ? normalized : null;
}

export function normalizeAttendanceSection(
  value?: string | null,
): AttendanceSection | null {
  const normalized = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

  if (
    normalized === "iris" ||
    normalized === "desk" ||
    normalized === "board"
  ) {
    return "desk";
  }

  if (normalized === "carteira" || normalized === "portfolio") {
    return "portfolio";
  }

  if (
    normalized === "fila" ||
    normalized === "queue" ||
    normalized === "cobranca"
  ) {
    return "queue";
  }

  return null;
}
