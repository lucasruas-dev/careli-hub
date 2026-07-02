// Helpers puros da casca mobile do Panteon. Sem estado, sem I/O — so formatacao.

const RELATIVE_TIME_DAY_MS = 24 * 60 * 60 * 1000;

const shortDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
});

const timeFormatter = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Tempo relativo curto em pt-BR para listas ("agora", "5 min", "3 h", "ontem",
 * "12/05"). Mobile: prioriza a leitura rapida na lista, nao a precisao absoluta.
 */
export function formatRelativeTime(value?: string | null): string {
  if (!value) {
    return "";
  }

  const time = Date.parse(value);

  if (Number.isNaN(time)) {
    return "";
  }

  const now = Date.now();
  const diff = now - time;

  if (diff < 60_000) {
    return "agora";
  }

  if (diff < 3_600_000) {
    return `${Math.floor(diff / 60_000)} min`;
  }

  if (diff < RELATIVE_TIME_DAY_MS) {
    return `${Math.floor(diff / 3_600_000)} h`;
  }

  if (diff < 2 * RELATIVE_TIME_DAY_MS) {
    return "ontem";
  }

  return shortDateFormatter.format(new Date(time));
}

/** Horario "HH:MM" para os baloes de conversa. */
export function formatClockTime(value?: string | null): string {
  if (!value) {
    return "";
  }

  const time = Date.parse(value);

  if (Number.isNaN(time)) {
    return "";
  }

  return timeFormatter.format(new Date(time));
}

/** Iniciais (ate 2 letras) a partir de um nome — fallback do avatar. */
export function getInitials(name?: string | null): string {
  const normalized = (name ?? "").trim();

  if (!normalized) {
    return "??";
  }

  const parts = normalized.split(/\s+/).filter(Boolean);

  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase();
  }

  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "America/Sao_Paulo",
  year: "numeric",
});

const dayLabelFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "long",
  timeZone: "America/Sao_Paulo",
});

/** Chave "AAAA-MM-DD" (fuso SP) para agrupar mensagens por dia. */
export function dayKey(value?: string | null): string {
  const time = value ? Date.parse(value) : Number.NaN;

  return Number.isNaN(time) ? "" : dayKeyFormatter.format(new Date(time));
}

/** Rótulo do separador de dia: "Hoje", "Ontem" ou "12 de maio". */
export function formatDayLabel(value?: string | null): string {
  const time = value ? Date.parse(value) : Number.NaN;

  if (Number.isNaN(time)) {
    return "";
  }

  const key = dayKey(value);
  const today = dayKey(new Date().toISOString());
  const yesterday = dayKey(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  if (key === today) {
    return "Hoje";
  }

  if (key === yesterday) {
    return "Ontem";
  }

  return dayLabelFormatter.format(new Date(time));
}

/**
 * Tempo decorrido desde `value` (ex.: cliente esperando resposta). Curto:
 * "agora", "12 min", "2 h", "3 d".
 */
export function formatWaitingDuration(value?: string | null): string {
  const time = value ? Date.parse(value) : Number.NaN;

  if (Number.isNaN(time)) {
    return "";
  }

  const diff = Math.max(0, Date.now() - time);

  if (diff < 60_000) {
    return "agora";
  }

  if (diff < 3_600_000) {
    return `${Math.floor(diff / 60_000)} min`;
  }

  if (diff < 24 * 3_600_000) {
    return `${Math.floor(diff / 3_600_000)} h`;
  }

  return `${Math.floor(diff / (24 * 3_600_000))} d`;
}
