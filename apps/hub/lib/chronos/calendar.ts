import {
  chronosCalendarEventKindLabels,
  chronosMeetingTypeLabels,
  type ChronosCalendarEventKind,
  type ChronosMeeting,
  type ChronosMeetingRecurrenceInput,
} from "@/lib/chronos/types";

export type ChronosAgendaFilter =
  | "all"
  | "today"
  | "live"
  | "review"
  | "followups";

export type ChronosCalendarView = "day" | "week" | "month" | "year" | "list";

export type ChronosRecurrenceMode =
  | "custom"
  | "daily"
  | "monthly_last_weekday"
  | "monthly_nth_weekday"
  | "none"
  | "weekdays"
  | "weekly"
  | "yearly";

export type ChronosCustomRecurrenceFrequency =
  | "daily"
  | "monthly"
  | "weekly"
  | "yearly";

export type ChronosCustomRecurrenceEnd = "never" | "on_date";

export const chronosTimeGridHourHeightRem = 5;

export function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function getChronosTimeGridEventPlacement(
  meeting: ChronosMeeting,
  hours: number[],
) {
  if (!meeting.startsAt || hours.length === 0) {
    return null;
  }

  const startsAt = new Date(meeting.startsAt);

  if (Number.isNaN(startsAt.getTime())) {
    return null;
  }

  const fallbackEndsAt = new Date(startsAt.getTime() + 60 * 60_000);
  const endsAt = meeting.endsAt ? new Date(meeting.endsAt) : fallbackEndsAt;
  const safeEndsAt =
    !Number.isNaN(endsAt.getTime()) && endsAt.getTime() > startsAt.getTime()
      ? endsAt
      : fallbackEndsAt;
  const firstHour = hours[0] ?? 0;
  const lastHour = (hours[hours.length - 1] ?? firstHour) + 1;
  const dayStart = new Date(
    startsAt.getFullYear(),
    startsAt.getMonth(),
    startsAt.getDate(),
    firstHour,
  );
  const dayEnd = new Date(
    startsAt.getFullYear(),
    startsAt.getMonth(),
    startsAt.getDate(),
    lastHour,
  );
  const clampedStart = Math.max(startsAt.getTime(), dayStart.getTime());
  const clampedEnd = Math.min(safeEndsAt.getTime(), dayEnd.getTime());
  const visibleMinutes = Math.max(15, (clampedEnd - clampedStart) / 60_000);
  const offsetMinutes = Math.max(0, (clampedStart - dayStart.getTime()) / 60_000);

  return {
    height: `calc(${(visibleMinutes / 60) * chronosTimeGridHourHeightRem}rem - 0.35rem)`,
    top: `calc(${(offsetMinutes / 60) * chronosTimeGridHourHeightRem}rem + 0.18rem)`,
  };
}

export function addDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setDate(date.getDate() + days);

  return nextDate;
}

export function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

export function addYears(date: Date, years: number) {
  return new Date(date.getFullYear() + years, 0, 1);
}

export function setDateHour(date: Date, hour: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour);
}

export function roundDateToNextHour(date: Date) {
  const nextDate = new Date(date);

  nextDate.setMinutes(0, 0, 0);

  if (date.getMinutes() > 0 || date.getSeconds() > 0) {
    nextDate.setHours(nextDate.getHours() + 1);
  }

  return nextDate;
}

export function getWeekDays(date: Date) {
  const weekStart = addDays(startOfDay(date), -date.getDay());

  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

export function getChronosIsoWeek(date: Date) {
  const safeDate = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
  const dayNumber = safeDate.getUTCDay() || 7;

  safeDate.setUTCDate(safeDate.getUTCDate() + 4 - dayNumber);

  const year = safeDate.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(
    ((safeDate.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );

  return { week, year };
}

export function formatChronosWeekOfYearLabel(date: Date) {
  const { week, year } = getChronosIsoWeek(date);

  return `Semana ${week}/${year}`;
}

export function getMonthMatrix(date: Date) {
  const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
  const calendarStart = addDays(firstDay, -firstDay.getDay());

  return Array.from({ length: 42 }, (_, index) => addDays(calendarStart, index));
}

export function sameMeetingDay(meeting: ChronosMeeting, date: Date) {
  if (!meeting.startsAt) {
    return false;
  }

  const meetingDate = new Date(meeting.startsAt);

  return !Number.isNaN(meetingDate.getTime()) && sameDay(meetingDate, date);
}

export function toDateTimeLocalValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function addMinutesToDateTimeLocal(value: string, minutes: number) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  date.setMinutes(date.getMinutes() + minutes);

  return toDateTimeLocalValue(date);
}

export function getChronosRecurrenceOptions(date: Date): Array<{
  id: ChronosRecurrenceMode;
  label: string;
}> {
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const weekday = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
  }).format(safeDate);
  const monthName = formatMonthName(safeDate);
  const nthWeekday = getNthWeekdayInMonth(safeDate);

  return [
    { id: "none", label: "Nao se repete" },
    { id: "daily", label: "Todos os dias" },
    { id: "weekly", label: `Semanal: cada ${weekday}` },
    {
      id: "monthly_nth_weekday",
      label: `Mensal no(a) ${nthWeekday}o(a) ${weekday}`,
    },
    {
      id: "monthly_last_weekday",
      label: `Mensal nos(nas) ultimos(as) ${weekday}`,
    },
    { id: "yearly", label: `Anual em ${monthName} ${safeDate.getDate()}` },
    {
      id: "weekdays",
      label: "Todos os dias da semana (segunda a sexta-feira)",
    },
    { id: "custom", label: "Personalizar..." },
  ];
}

export function buildChronosRecurrenceInput({
  customEnd,
  customFrequency,
  customInterval,
  customUntil,
  mode,
  startsAt,
}: {
  customEnd: ChronosCustomRecurrenceEnd;
  customFrequency: ChronosCustomRecurrenceFrequency;
  customInterval: number;
  customUntil: string;
  mode: ChronosRecurrenceMode;
  startsAt: string;
}): ChronosMeetingRecurrenceInput | undefined {
  if (mode === "none") {
    return undefined;
  }

  const date = new Date(startsAt);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const weekday = getRRuleWeekday(safeDate);
  const nthWeekday = getNthWeekdayInMonth(safeDate);
  const untilPart =
    customEnd === "on_date" && customUntil
      ? `;UNTIL=${formatRRuleUntilDate(customUntil)}`
      : "";

  if (mode === "custom") {
    const frequency = customFrequency.toUpperCase();
    const interval = Math.max(1, Math.min(99, Math.round(customInterval)));
    const byDay = customFrequency === "weekly" ? `;BYDAY=${weekday}` : "";

    return {
      label: `Personalizada: a cada ${interval} ${getChronosCustomFrequencyLabel(
        customFrequency,
      )}`,
      mode,
      rrule: `RRULE:FREQ=${frequency};INTERVAL=${interval}${byDay}${untilPart}`,
    };
  }

  const recurrenceMap: Record<
    Exclude<ChronosRecurrenceMode, "custom" | "none">,
    { label: string; rrule: string }
  > = {
    daily: {
      label: "Todos os dias",
      rrule: "RRULE:FREQ=DAILY",
    },
    monthly_last_weekday: {
      label: "Mensal no ultimo dia da semana equivalente",
      rrule: `RRULE:FREQ=MONTHLY;BYDAY=-1${weekday}`,
    },
    monthly_nth_weekday: {
      label: "Mensal no dia da semana equivalente",
      rrule: `RRULE:FREQ=MONTHLY;BYDAY=${nthWeekday}${weekday}`,
    },
    weekdays: {
      label: "Dias uteis",
      rrule: "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
    },
    weekly: {
      label: "Semanal",
      rrule: `RRULE:FREQ=WEEKLY;BYDAY=${weekday}`,
    },
    yearly: {
      label: "Anual",
      rrule: "RRULE:FREQ=YEARLY",
    },
  };
  const recurrence = recurrenceMap[mode];

  return {
    label: recurrence.label,
    mode,
    rrule: recurrence.rrule,
  };
}

const chronosRRuleWeekdayIndex: Record<string, number> = {
  FR: 5,
  MO: 1,
  SA: 6,
  SU: 0,
  TH: 4,
  TU: 2,
  WE: 3,
};

type ParsedChronosRRule = {
  byDay: string[];
  count: number | null;
  freq: "DAILY" | "MONTHLY" | "WEEKLY" | "YEARLY";
  interval: number;
  until: Date | null;
};

function parseChronosRRule(rrule: string): ParsedChronosRRule | null {
  const body = rrule.replace(/^RRULE:/i, "").trim();

  if (!body) {
    return null;
  }

  const params = new Map<string, string>();

  for (const part of body.split(";")) {
    const [key, value] = part.split("=");

    if (key && value) {
      params.set(key.trim().toUpperCase(), value.trim());
    }
  }

  const freq = params.get("FREQ");

  if (
    freq !== "DAILY" &&
    freq !== "WEEKLY" &&
    freq !== "MONTHLY" &&
    freq !== "YEARLY"
  ) {
    return null;
  }

  const intervalRaw = Number.parseInt(params.get("INTERVAL") ?? "1", 10);
  const countRaw = Number.parseInt(params.get("COUNT") ?? "", 10);
  const untilRaw = params.get("UNTIL");
  let until: Date | null = null;

  if (untilRaw) {
    const match = untilRaw.match(
      /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/,
    );

    if (match) {
      until = new Date(
        Date.UTC(
          Number(match[1]),
          Number(match[2]) - 1,
          Number(match[3]),
          Number(match[4] ?? "23"),
          Number(match[5] ?? "59"),
          Number(match[6] ?? "59"),
        ),
      );
    }
  }

  return {
    byDay: (params.get("BYDAY") ?? "")
      .split(",")
      .map((day) => day.trim().toUpperCase())
      .filter(Boolean),
    count: Number.isFinite(countRaw) && countRaw > 0 ? countRaw : null,
    freq,
    interval: Number.isFinite(intervalRaw) && intervalRaw > 0 ? intervalRaw : 1,
    until,
  };
}

function applyTimeFromReference(target: Date, reference: Date) {
  target.setHours(
    reference.getHours(),
    reference.getMinutes(),
    reference.getSeconds(),
    0,
  );

  return target;
}

function getChronosMonthlyWeekdayDate(
  year: number,
  month: number,
  weekdayIndex: number,
  nth: number,
) {
  if (nth < 0) {
    const last = new Date(year, month + 1, 0);
    const offset = (last.getDay() - weekdayIndex + 7) % 7;

    return new Date(year, month, last.getDate() - offset);
  }

  const first = new Date(year, month, 1);
  const offset = (weekdayIndex - first.getDay() + 7) % 7;

  return new Date(year, month, 1 + offset + (nth - 1) * 7);
}

// Expande uma RRULE do Chronos nas datas de inicio das ocorrencias (inclui a
// primeira, igual a startsAt). Como o Brasil nao tem horario de verao, avancar
// por dias/semanas/meses preserva o horario local com seguranca, sem depender
// de bibliotecas externas.
export function expandChronosRecurrenceOccurrences(input: {
  endsAt?: string | null;
  horizonDays?: number;
  maxOccurrences?: number;
  rrule: string;
  startsAt: string;
}): Array<{ endsAt: string | null; startsAt: string }> {
  const parsed = parseChronosRRule(input.rrule);
  const start = new Date(input.startsAt);

  if (!parsed || Number.isNaN(start.getTime())) {
    return [];
  }

  const end =
    input.endsAt && !Number.isNaN(new Date(input.endsAt).getTime())
      ? new Date(input.endsAt)
      : null;
  const durationMs = end ? end.getTime() - start.getTime() : null;
  const maxOccurrences = Math.max(
    1,
    Math.min(input.maxOccurrences ?? 60, parsed.count ?? 60),
  );
  const horizon = new Date(start);

  horizon.setDate(horizon.getDate() + (input.horizonDays ?? 365));

  const limit = parsed.until && parsed.until < horizon ? parsed.until : horizon;
  const occurrences: Date[] = [];
  const add = (date: Date) => {
    if (date < start || date > limit || occurrences.length >= maxOccurrences) {
      return;
    }

    occurrences.push(new Date(date));
  };

  if (parsed.freq === "DAILY") {
    const cursor = new Date(start);

    while (cursor <= limit && occurrences.length < maxOccurrences) {
      add(cursor);
      cursor.setDate(cursor.getDate() + parsed.interval);
    }
  } else if (parsed.freq === "WEEKLY") {
    const weekdays = (
      parsed.byDay.length > 0 ? parsed.byDay : [getRRuleWeekday(start)]
    )
      .map((day) => chronosRRuleWeekdayIndex[day])
      .filter((index): index is number => index !== undefined)
      .sort((a, b) => a - b);
    const weekStart = new Date(start);

    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    applyTimeFromReference(weekStart, start);

    while (weekStart <= limit && occurrences.length < maxOccurrences) {
      for (const weekdayIndex of weekdays) {
        const occurrence = new Date(weekStart);

        occurrence.setDate(weekStart.getDate() + weekdayIndex);
        applyTimeFromReference(occurrence, start);
        add(occurrence);
      }

      weekStart.setDate(weekStart.getDate() + 7 * parsed.interval);
    }
  } else if (parsed.freq === "MONTHLY") {
    const match = (parsed.byDay[0] ?? "").match(
      /^(-?\d+)(SU|MO|TU|WE|TH|FR|SA)$/,
    );
    const nth = match ? Number(match[1]) : getNthWeekdayInMonth(start);
    const weekdayCode = match?.[2] ?? getRRuleWeekday(start);
    const weekdayIndex = chronosRRuleWeekdayIndex[weekdayCode] ?? start.getDay();
    const monthCursor = new Date(start.getFullYear(), start.getMonth(), 1);

    while (monthCursor <= limit && occurrences.length < maxOccurrences) {
      const occurrence = getChronosMonthlyWeekdayDate(
        monthCursor.getFullYear(),
        monthCursor.getMonth(),
        weekdayIndex,
        nth,
      );

      applyTimeFromReference(occurrence, start);
      add(occurrence);
      monthCursor.setMonth(monthCursor.getMonth() + parsed.interval);
    }
  } else {
    const cursor = new Date(start);

    while (cursor <= limit && occurrences.length < maxOccurrences) {
      add(cursor);
      cursor.setFullYear(cursor.getFullYear() + parsed.interval);
    }
  }

  const unique = new Map<number, Date>();

  for (const occurrence of occurrences) {
    unique.set(occurrence.getTime(), occurrence);
  }

  return [...unique.values()]
    .sort((a, b) => a.getTime() - b.getTime())
    .map((occurrence) => ({
      endsAt:
        durationMs !== null
          ? new Date(occurrence.getTime() + durationMs).toISOString()
          : null,
      startsAt: occurrence.toISOString(),
    }));
}

export function formatWeekday(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", { weekday: "short" })
    .format(date)
    .replace(".", "");
}

export function formatMonthName(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", { month: "long" }).format(date);
}

export function formatMeetingHour(meeting: ChronosMeeting) {
  if (!meeting.startsAt) {
    return "--:--";
  }

  const startsAt = formatTimeOnly(meeting.startsAt);
  const endsAt = meeting.endsAt ? formatTimeOnly(meeting.endsAt) : null;

  return endsAt ? `${startsAt} - ${endsAt}` : startsAt;
}

export function getChronosMeetingLocationLabel(meeting: ChronosMeeting) {
  const location = meeting.metadata.location;

  if (location && typeof location === "object" && !Array.isArray(location)) {
    const locationRecord = location as {
      address?: unknown;
      mode?: unknown;
    };

    if (locationRecord.mode === "offline") {
      return typeof locationRecord.address === "string" &&
        locationRecord.address.trim()
        ? locationRecord.address.trim()
        : "Presencial";
    }
  }

  return meeting.room?.name ?? "Sala pendente";
}

export function getChronosMeetingRoomPath(meeting: ChronosMeeting) {
  return meeting.room?.slug ? `/chronos/${meeting.room.slug}` : null;
}

export function getChronosCalendarEventKind(
  meeting: ChronosMeeting,
): ChronosCalendarEventKind {
  const value = meeting.metadata.calendarEventKind;

  return typeof value === "string" && value in chronosCalendarEventKindLabels
    ? (value as ChronosCalendarEventKind)
    : "event";
}

export function getChronosMeetingProfileLabel(meeting: ChronosMeeting) {
  const meetingProfile = meeting.metadata.meetingProfile;

  if (
    meetingProfile &&
    typeof meetingProfile === "object" &&
    !Array.isArray(meetingProfile)
  ) {
    const label = (meetingProfile as { label?: unknown }).label;

    if (typeof label === "string" && label.trim()) {
      return label.trim();
    }
  }

  return chronosMeetingTypeLabels[meeting.meetingType];
}

export function formatCalendarPeriod(date: Date, view: ChronosCalendarView) {
  if (view === "year") {
    return String(date.getFullYear());
  }

  if (view === "month") {
    return `${formatMonthName(date)} de ${date.getFullYear()}`;
  }

  if (view === "week") {
    const [firstDate, , , , , , lastDate] = getWeekDays(date);

    if (!firstDate || !lastDate) {
      return new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(date);
    }

    return `${firstDate.getDate()} ${formatMonthName(firstDate)} - ${lastDate.getDate()} ${formatMonthName(lastDate)}`;
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "full",
  }).format(date);
}

export function filterChronosMeetings(
  meetings: ChronosMeeting[],
  agendaFilter: ChronosAgendaFilter,
) {
  if (agendaFilter === "today") {
    return meetings.filter((meeting) => isToday(meeting.startsAt));
  }

  if (agendaFilter === "live") {
    return meetings.filter((meeting) => meeting.status === "live");
  }

  if (agendaFilter === "review") {
    return meetings.filter(
      (meeting) =>
        meeting.status === "review" || meeting.minutesStatus === "in_review",
    );
  }

  if (agendaFilter === "followups") {
    return meetings.filter((meeting) => countOpenFollowUps(meeting) > 0);
  }

  return meetings;
}

export function sortMeetingsByDate(meetings: ChronosMeeting[]) {
  return [...meetings].sort((firstMeeting, secondMeeting) => {
    const firstTime = firstMeeting.startsAt
      ? Date.parse(firstMeeting.startsAt)
      : Number.POSITIVE_INFINITY;
    const secondTime = secondMeeting.startsAt
      ? Date.parse(secondMeeting.startsAt)
      : Number.POSITIVE_INFINITY;

    return firstTime - secondTime;
  });
}

export function countOpenFollowUps(meeting: ChronosMeeting) {
  return meeting.followUps.filter((followUp) => followUp.status !== "done")
    .length;
}

export function sameDay(firstDate: Date, secondDate: Date) {
  return (
    firstDate.getFullYear() === secondDate.getFullYear() &&
    firstDate.getMonth() === secondDate.getMonth() &&
    firstDate.getDate() === secondDate.getDate()
  );
}

function getRRuleWeekday(date: Date) {
  return ["SU", "MO", "TU", "WE", "TH", "FR", "SA"][date.getDay()] ?? "MO";
}

function getNthWeekdayInMonth(date: Date) {
  return Math.ceil(date.getDate() / 7);
}

function formatRRuleUntilDate(value: string) {
  const date = new Date(`${value}T23:59:59`);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return `${year}${month}${day}T235959Z`;
}

function getChronosCustomFrequencyLabel(
  frequency: ChronosCustomRecurrenceFrequency,
) {
  return {
    daily: "dia(s)",
    monthly: "mes(es)",
    weekly: "semana(s)",
    yearly: "ano(s)",
  }[frequency];
}

function formatTimeOnly(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function isToday(value?: string | null) {
  if (!value) {
    return false;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return false;
  }

  const today = new Date();

  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
}
