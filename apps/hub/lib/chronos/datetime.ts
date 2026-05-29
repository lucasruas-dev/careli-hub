export const chronosDefaultTimeZone = "America/Sao_Paulo";

const localDateTimePattern =
  /^(\d{4})-(\d{2})-(\d{2})(?:T|\s)(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?$/;
const localDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const explicitOffsetPattern = /(Z|[+-]\d{2}:?\d{2})$/i;

type ChronosLocalDateTimeParts = {
  day: number;
  hour: number;
  millisecond: number;
  minute: number;
  month: number;
  second: number;
  year: number;
};

export function normalizeChronosDateTime(
  input: string,
  options: {
    dateOnlyHour?: number;
    timeZone?: string;
  } = {},
) {
  const value = input.trim();
  const timeZone = options.timeZone ?? chronosDefaultTimeZone;

  if (!value) {
    return null;
  }

  if (explicitOffsetPattern.test(value)) {
    return toIsoString(value);
  }

  const dateTimeParts = parseLocalDateTime(value);

  if (dateTimeParts) {
    return zonedDateTimeToUtc(dateTimeParts, timeZone).toISOString();
  }

  const dateParts = parseLocalDate(value, options.dateOnlyHour ?? 0);

  if (dateParts) {
    return zonedDateTimeToUtc(dateParts, timeZone).toISOString();
  }

  return toIsoString(value);
}

export function normalizeGoogleCalendarDateTime(
  input: {
    date?: string;
    dateTime?: string;
    timeZone?: string;
  } | null | undefined,
  options: {
    dateOnlyHour?: number;
  } = {},
) {
  if (!input?.dateTime && !input?.date) {
    return null;
  }

  const raw = input.dateTime ?? input.date;

  if (!raw) {
    return null;
  }

  return normalizeChronosDateTime(raw, {
    dateOnlyHour: options.dateOnlyHour ?? 9,
    timeZone: input.timeZone ?? chronosDefaultTimeZone,
  });
}

export function formatChronosDateTimeForGoogleCalendar(
  input: string,
  timeZone = chronosDefaultTimeZone,
) {
  const date = new Date(input);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone,
    year: "numeric",
  });
  const values = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  ) as Partial<Record<Intl.DateTimeFormatPartTypes, string>>;

  if (
    !values.year ||
    !values.month ||
    !values.day ||
    !values.hour ||
    !values.minute ||
    !values.second
  ) {
    return null;
  }

  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}`;
}

function parseLocalDateTime(value: string): ChronosLocalDateTimeParts | null {
  const match = localDateTimePattern.exec(value);

  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute, second = "0", millisecond = "0"] =
    match;

  return {
    day: Number(day),
    hour: Number(hour),
    millisecond: Number(millisecond.padEnd(3, "0")),
    minute: Number(minute),
    month: Number(month),
    second: Number(second),
    year: Number(year),
  };
}

function parseLocalDate(
  value: string,
  dateOnlyHour: number,
): ChronosLocalDateTimeParts | null {
  const match = localDatePattern.exec(value);

  if (!match) {
    return null;
  }

  const [, year, month, day] = match;

  return {
    day: Number(day),
    hour: dateOnlyHour,
    millisecond: 0,
    minute: 0,
    month: Number(month),
    second: 0,
    year: Number(year),
  };
}

function toIsoString(value: string) {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function zonedDateTimeToUtc(
  parts: ChronosLocalDateTimeParts,
  timeZone: string,
) {
  const utcGuess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
  let offset = getTimeZoneOffsetMs(timeZone, utcGuess);
  let timestamp = utcGuess - offset;
  const resolvedOffset = getTimeZoneOffsetMs(timeZone, timestamp);

  if (resolvedOffset !== offset) {
    offset = resolvedOffset;
    timestamp = utcGuess - offset;
  }

  return new Date(timestamp);
}

function getTimeZoneOffsetMs(timeZone: string, timestamp: number) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone,
    year: "numeric",
  });
  const parts = formatter.formatToParts(new Date(timestamp));
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  ) as Partial<Record<Intl.DateTimeFormatPartTypes, number>>;
  const zonedAsUtc = Date.UTC(
    values.year ?? 1970,
    (values.month ?? 1) - 1,
    values.day ?? 1,
    values.hour ?? 0,
    values.minute ?? 0,
    values.second ?? 0,
  );

  return zonedAsUtc - timestamp;
}
