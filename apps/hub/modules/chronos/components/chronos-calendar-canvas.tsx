import {
  chronosTimeGridHourHeightRem,
  countOpenFollowUps,
  formatMeetingHour,
  formatMonthName,
  formatWeekday,
  getChronosMeetingLocationLabel,
  getChronosTimeGridEventPlacement,
  getMonthMatrix,
  getWeekDays,
  sameDay,
  sameMeetingDay,
  setDateHour,
  type ChronosCalendarView,
} from "@/lib/chronos/calendar";
import { formatChronosDateTime } from "@/lib/chronos/format";
import {
  chronosMeetingStatusLabels,
  chronosMinutesStatusLabels,
  type ChronosMeeting,
  type ChronosRoom,
} from "@/lib/chronos/types";
import { Badge } from "@repo/uix";
import type { CSSProperties } from "react";
import { chronosMeetingStatusVariant } from "./chronos-meeting-status";
import { getChronosMeetingTypeVisual } from "./chronos-meeting-type-visuals";
import { chronosMinutesStatusVariant } from "./chronos-minutes-status";
import { EmptyPanel } from "./chronos-panels";

type ChronosCalendarCanvasProps = {
  cursorDate: Date;
  meetings: ChronosMeeting[];
  onCreateAt: (date: Date) => void;
  onSelectMeeting: (meetingId: string) => void;
  rooms: ChronosRoom[];
  selectedMeetingId: string;
  view: ChronosCalendarView;
};

export function ChronosCalendarCanvas({
  cursorDate,
  meetings,
  onCreateAt,
  onSelectMeeting,
  rooms,
  selectedMeetingId,
  view,
}: ChronosCalendarCanvasProps) {
  const hours = Array.from({ length: 16 }, (_, index) => index + 7);

  if (view === "list") {
    return (
      <div className="grid gap-2 p-4">
        {meetings.map((meeting) => (
          <ChronosAgendaEventCard
            key={meeting.id}
            meeting={meeting}
            onSelectMeeting={onSelectMeeting}
            selected={meeting.id === selectedMeetingId}
          />
        ))}
        {meetings.length === 0 ? (
          <EmptyPanel text="Nenhum compromisso formal registrado." />
        ) : null}
      </div>
    );
  }

  if (view === "day") {
    return (
      <ChronosTimeGrid
        dates={[cursorDate]}
        hours={hours}
        meetings={meetings}
        onCreateAt={onCreateAt}
        onSelectMeeting={onSelectMeeting}
        selectedMeetingId={selectedMeetingId}
      />
    );
  }

  if (view === "week") {
    return (
      <ChronosTimeGrid
        dates={getWeekDays(cursorDate)}
        hours={hours}
        meetings={meetings}
        onCreateAt={onCreateAt}
        onSelectMeeting={onSelectMeeting}
        selectedMeetingId={selectedMeetingId}
      />
    );
  }

  if (view === "year") {
    return (
      <ChronosYearGrid
        cursorDate={cursorDate}
        meetings={meetings}
        onCreateAt={onCreateAt}
      />
    );
  }

  return (
    <ChronosMonthGrid
      cursorDate={cursorDate}
      meetings={meetings}
      onCreateAt={onCreateAt}
      onSelectMeeting={onSelectMeeting}
      rooms={rooms}
      selectedMeetingId={selectedMeetingId}
    />
  );
}

function ChronosTimeGrid({
  dates,
  hours,
  meetings,
  onCreateAt,
  onSelectMeeting,
  selectedMeetingId,
}: {
  dates: Date[];
  hours: number[];
  meetings: ChronosMeeting[];
  onCreateAt: (date: Date) => void;
  onSelectMeeting: (meetingId: string) => void;
  selectedMeetingId: string;
}) {
  const hourRows = `repeat(${hours.length}, ${chronosTimeGridHourHeightRem}rem)`;

  return (
    <div
      className="grid min-w-[58rem]"
      style={{
        gridTemplateColumns: `4.5rem repeat(${dates.length}, minmax(8.5rem, 1fr))`,
      }}
    >
      <div className="sticky top-0 z-10 border-b border-[#edf0f4] bg-white p-2 text-xs font-bold uppercase text-[#98a2b3]">
        GMT-03
      </div>
      {dates.map((date) => (
        <div
          className={`sticky top-0 z-10 border-b border-l border-[#edf0f4] bg-white p-2 text-center ${
            sameDay(date, new Date()) ? "text-[#0b66d8]" : "text-[#101820]"
          }`}
          key={date.toISOString()}
        >
          <span className="block text-xs font-bold uppercase">
            {formatWeekday(date)}
          </span>
          <span className="text-lg font-semibold">{date.getDate()}</span>
        </div>
      ))}
      <div
        className="grid bg-white"
        style={{
          gridTemplateRows: hourRows,
        }}
      >
        {hours.map((hour) => (
          <div
            className="border-b border-[#edf0f4] p-2 text-right text-xs text-[#667085]"
            key={hour}
          >
            {String(hour).padStart(2, "0")}:00
          </div>
        ))}
      </div>
      {dates.map((date) => {
        const dayMeetings = meetings.filter((meeting) =>
          sameMeetingDay(meeting, date),
        );

        return (
          <div
            className="relative border-l border-[#edf0f4] bg-white"
            key={date.toISOString()}
          >
            <div
              className="grid"
              style={{
                gridTemplateRows: hourRows,
              }}
            >
              {hours.map((hour) => {
                const slotDate = setDateHour(date, hour);

                return (
                  <button
                    className="min-h-20 border-b border-l border-[#edf0f4] bg-white p-1 text-left transition hover:bg-[#f8fafc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                    key={`${date.toISOString()}-${hour}`}
                    onClick={() => onCreateAt(slotDate)}
                    type="button"
                  />
                );
              })}
            </div>
            <div className="pointer-events-none absolute inset-0">
              {dayMeetings.map((meeting) => {
                const placement = getChronosTimeGridEventPlacement(
                  meeting,
                  hours,
                );

                if (!placement) {
                  return null;
                }

                return (
                  <ChronosCalendarEventPill
                    className="pointer-events-auto absolute left-1 right-1 overflow-hidden"
                    key={meeting.id}
                    meeting={meeting}
                    onSelectMeeting={onSelectMeeting}
                    selected={meeting.id === selectedMeetingId}
                    style={{
                      height: placement.height,
                      top: placement.top,
                    }}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ChronosMonthGrid({
  cursorDate,
  meetings,
  onCreateAt,
  onSelectMeeting,
  selectedMeetingId,
}: {
  cursorDate: Date;
  meetings: ChronosMeeting[];
  onCreateAt: (date: Date) => void;
  onSelectMeeting: (meetingId: string) => void;
  rooms: ChronosRoom[];
  selectedMeetingId: string;
}) {
  const monthDays = getMonthMatrix(cursorDate);

  return (
    <div className="grid min-w-[58rem] grid-cols-7">
      {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"].map((day) => (
        <div
          className="border-b border-[#edf0f4] bg-[#fafbfc] p-2 text-center text-xs font-bold uppercase text-[#667085]"
          key={day}
        >
          {day}
        </div>
      ))}
      {monthDays.map((date) => {
        const dayMeetings = meetings.filter((meeting) =>
          sameMeetingDay(meeting, date),
        );
        const outsideMonth = date.getMonth() !== cursorDate.getMonth();

        return (
          <button
            className={`min-h-32 border-b border-r border-[#edf0f4] p-2 text-left transition hover:bg-[#f8fafc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B] ${
              outsideMonth ? "bg-[#fafbfc] text-[#98a2b3]" : "bg-white"
            }`}
            key={date.toISOString()}
            onClick={() => onCreateAt(setDateHour(date, 9))}
            type="button"
          >
            <span
              className={`mb-2 grid h-7 w-7 place-items-center rounded-full text-sm font-semibold ${
                sameDay(date, new Date())
                  ? "bg-[#0b66d8] text-white"
                  : "text-[#101820]"
              }`}
            >
              {date.getDate()}
            </span>
            <span className="grid gap-1">
              {dayMeetings.slice(0, 3).map((meeting) => (
                <ChronosCalendarEventPill
                  key={meeting.id}
                  meeting={meeting}
                  onSelectMeeting={onSelectMeeting}
                  selected={meeting.id === selectedMeetingId}
                />
              ))}
              {dayMeetings.length > 3 ? (
                <span className="text-xs font-semibold text-[#667085]">
                  +{dayMeetings.length - 3} compromissos
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ChronosYearGrid({
  cursorDate,
  meetings,
  onCreateAt,
}: {
  cursorDate: Date;
  meetings: ChronosMeeting[];
  onCreateAt: (date: Date) => void;
}) {
  return (
    <div className="grid gap-3 p-4 md:grid-cols-2 2xl:grid-cols-4">
      {Array.from({ length: 12 }, (_, monthIndex) => {
        const monthDate = new Date(cursorDate.getFullYear(), monthIndex, 1);
        const monthDays = getMonthMatrix(monthDate).filter(
          (date) => date.getMonth() === monthIndex,
        );

        return (
          <div
            className="rounded-md border border-[#edf0f4] bg-[#fafbfc] p-3"
            key={monthIndex}
          >
            <p className="m-0 text-sm font-semibold text-[#101820]">
              {formatMonthName(monthDate)}
            </p>
            <div className="mt-2 grid grid-cols-7 gap-1">
              {monthDays.map((date) => {
                const dayMeeting = meetings.find((meeting) =>
                  sameMeetingDay(meeting, date),
                );
                const typeVisual = dayMeeting
                  ? getChronosMeetingTypeVisual(dayMeeting.meetingType)
                  : null;

                return (
                  <button
                    className={`grid h-7 place-items-center rounded border text-xs font-semibold transition hover:bg-white ${
                      typeVisual
                        ? typeVisual.pillClass
                        : sameDay(date, new Date())
                          ? "border-[#0b66d8] bg-[#0b66d8] text-white"
                          : "border-transparent text-[#667085]"
                    }`}
                    key={date.toISOString()}
                    onClick={() => onCreateAt(setDateHour(date, 9))}
                    type="button"
                  >
                    {date.getDate()}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ChronosAgendaEventCard({
  meeting,
  onSelectMeeting,
  selected,
}: {
  meeting: ChronosMeeting;
  onSelectMeeting: (meetingId: string) => void;
  selected: boolean;
}) {
  const typeVisual = getChronosMeetingTypeVisual(meeting.meetingType);

  return (
    <button
      className={`grid gap-2 rounded-md border border-l-4 p-3 text-left transition ${
        selected
          ? `border-[#A07C3B] bg-[#fffaf0] ${typeVisual.accentClass}`
          : `border-[#edf0f4] bg-[#fafbfc] hover:border-[#d9e0e7] hover:bg-white ${typeVisual.accentClass}`
      }`}
      onClick={() => onSelectMeeting(meeting.id)}
      type="button"
    >
      <span className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-[#101820]">
            {meeting.title}
          </span>
          <span className="mt-1 block text-xs text-[#667085]">
            {formatChronosDateTime(meeting.startsAt)} /{" "}
            {getChronosMeetingLocationLabel(meeting)}
          </span>
        </span>
        <Badge variant={chronosMeetingStatusVariant[meeting.status] ?? "neutral"}>
          {chronosMeetingStatusLabels[meeting.status] ?? "Agendada"}
        </Badge>
      </span>
      <span className="flex flex-wrap gap-1">
        <span
          className={`inline-flex h-6 items-center rounded-full border px-2 text-xs font-semibold ${typeVisual.chipClass}`}
        >
          {typeVisual.label}
        </span>
        <Badge variant="neutral">{meeting.protocol}</Badge>
        <Badge
          variant={chronosMinutesStatusVariant[meeting.minutesStatus] ?? "neutral"}
        >
          {chronosMinutesStatusLabels[meeting.minutesStatus] ?? "Nao iniciada"}
        </Badge>
        {countOpenFollowUps(meeting) > 0 ? (
          <Badge variant="warning">{countOpenFollowUps(meeting)} follow-up</Badge>
        ) : null}
      </span>
    </button>
  );
}

function ChronosCalendarEventPill({
  className = "",
  meeting,
  onSelectMeeting,
  selected,
  style,
}: {
  className?: string;
  meeting: ChronosMeeting;
  onSelectMeeting: (meetingId: string) => void;
  selected: boolean;
  style?: CSSProperties;
}) {
  const typeVisual = getChronosMeetingTypeVisual(meeting.meetingType);

  return (
    <span
      className={`block rounded border px-2 py-1 text-xs font-semibold ${
        selected
          ? `${typeVisual.pillClass} ring-2 ring-[#A07C3B]/40`
          : typeVisual.pillClass
      } ${className}`}
      onClick={(event) => {
        event.stopPropagation();
        onSelectMeeting(meeting.id);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        onSelectMeeting(meeting.id);
      }}
      role="button"
      style={style}
      tabIndex={0}
    >
      <span className="flex min-w-0 items-center gap-1 truncate">
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${typeVisual.dotClass}`}
        />
        <span className="truncate">
          {formatMeetingHour(meeting)} {meeting.title}
        </span>
      </span>
      <span className="block truncate font-medium">
        {getChronosMeetingLocationLabel(meeting)}
      </span>
    </span>
  );
}

export function MiniCalendar({
  cursorDate,
  meetings,
  onSelectDate,
}: {
  cursorDate: Date;
  meetings: ChronosMeeting[];
  onSelectDate: (date: Date) => void;
}) {
  const monthDays = getMonthMatrix(cursorDate);

  return (
    <div>
      <p className="m-0 text-sm font-semibold text-[#101820]">
        {formatMonthName(cursorDate)} {cursorDate.getFullYear()}
      </p>
      <div className="mt-3 grid grid-cols-7 gap-1">
        {["D", "S", "T", "Q", "Q", "S", "S"].map((day, index) => (
          <span
            className="grid h-6 place-items-center text-[11px] font-bold uppercase text-[#98a2b3]"
            key={`${day}-${index}`}
          >
            {day}
          </span>
        ))}
        {monthDays.map((date) => {
          const dayMeeting = meetings.find((meeting) =>
            sameMeetingDay(meeting, date),
          );
          const typeVisual = dayMeeting
            ? getChronosMeetingTypeVisual(dayMeeting.meetingType)
            : null;

          return (
            <button
              className={`grid h-7 place-items-center rounded text-xs font-semibold transition hover:bg-white ${
                sameDay(date, cursorDate)
                  ? "bg-[#101820] text-white"
                  : sameDay(date, new Date())
                    ? "bg-[#0b66d8] text-white"
                    : date.getMonth() === cursorDate.getMonth()
                      ? "text-[#667085]"
                      : "text-[#c0c7d2]"
              }`}
              key={date.toISOString()}
              onClick={() => onSelectDate(date)}
              type="button"
            >
              <span className="relative">
                {date.getDate()}
                {typeVisual ? (
                  <span
                    className={`absolute -bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full ${typeVisual.dotClass}`}
                  />
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
