import {
  countOpenFollowUps,
  formatMeetingHour,
  formatMonthName,
  formatWeekday,
  getChronosCalendarEventKind,
  getChronosMeetingLocationLabel,
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
  type ChronosUpdateInput,
} from "@/lib/chronos/types";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import { Badge } from "@repo/uix";
import type { CSSProperties } from "react";
import { chronosMeetingStatusVariant } from "./chronos-meeting-status";
import { chronosMeetingTypeVisuals } from "./chronos-meeting-type-visuals";
import { chronosMinutesStatusVariant } from "./chronos-minutes-status";
import { EmptyPanel } from "./chronos-panels";
import {
  getChronosCurrentUserRsvpStatus,
  type ChronosCurrentUser,
} from "./chronos-rsvp";

type ChronosCalendarCanvasProps = {
  cursorDate: Date;
  meetings: ChronosMeeting[];
  onCreateAt: (date: Date) => void;
  onOpenFullEditor: (meetingId: string) => void;
  onSelectMeeting: (meetingId: string) => void;
  onUpdate: (input: ChronosUpdateInput) => Promise<void>;
  rooms: ChronosRoom[];
  currentUser?: ChronosCurrentUser | null;
  selectedMeetingId: string;
  view: ChronosCalendarView;
};

export function ChronosCalendarCanvas({
  cursorDate,
  meetings,
  onCreateAt,
  onOpenFullEditor,
  onSelectMeeting,
  onUpdate,
  rooms,
  currentUser,
  selectedMeetingId,
  view,
}: ChronosCalendarCanvasProps) {
  const hours = Array.from({ length: 24 }, (_, index) => index);

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
        currentUser={currentUser}
        onCreateAt={onCreateAt}
        onOpenFullEditor={onOpenFullEditor}
        onSelectMeeting={onSelectMeeting}
        onUpdate={onUpdate}
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
        currentUser={currentUser}
        onCreateAt={onCreateAt}
        onOpenFullEditor={onOpenFullEditor}
        onSelectMeeting={onSelectMeeting}
        onUpdate={onUpdate}
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
  meetings,
  onCreateAt,
  currentUser,
  onOpenFullEditor,
  onSelectMeeting,
  onUpdate,
  selectedMeetingId,
}: {
  dates: Date[];
  hours: number[];
  meetings: ChronosMeeting[];
  currentUser?: ChronosCurrentUser | null;
  onCreateAt: (date: Date) => void;
  onOpenFullEditor: (meetingId: string) => void;
  onSelectMeeting: (meetingId: string) => void;
  onUpdate: (input: ChronosUpdateInput) => Promise<void>;
  selectedMeetingId: string;
}) {
  const isWeek = dates.length > 1;
  const calendarStartDate = dates[0] ?? new Date();
  // Abre o calendario rolado para perto da hora atual (1h antes, para dar
  // contexto), como o Google Agenda, em vez de comecar na meia-noite.
  const scrollToTime = `${String(Math.max(0, new Date().getHours() - 1)).padStart(2, "0")}:00:00`;
  const fullCalendarEvents = meetings
    .filter((meeting) => meeting.startsAt)
    .map((meeting) => {
      const allDay = isChronosAllDayMeeting(meeting);
      const rsvpStatus = getChronosCurrentUserRsvpStatus(meeting, currentUser);

      return {
        allDay,
        backgroundColor: getChronosCalendarEventColor(meeting),
        borderColor: getChronosCalendarEventColor(meeting),
        textColor: "#ffffff",
        classNames: [
          "chronos-google-event",
          meeting.id === selectedMeetingId ? "chronos-google-event-selected" : "",
          rsvpStatus !== "accepted"
            ? `chronos-google-event-rsvp-${rsvpStatus}`
            : "",
        ].filter(Boolean),
        end: getChronosFullCalendarEnd(meeting, allDay),
        extendedProps: { meeting },
        id: meeting.id,
        start: getChronosFullCalendarStart(meeting, allDay),
        title: meeting.title,
      };
    });

  return (
    <div className="chronos-google-calendar h-full min-w-[58rem] overflow-hidden rounded-[28px] bg-white">
      <FullCalendar
        allDaySlot
        dayHeaderContent={(arg) => (
          <div className={arg.isToday ? "text-[#0b66d8]" : "text-[#101820]"}>
            <span className="block text-[11px] font-bold uppercase">
              {formatWeekday(arg.date)}
            </span>
            <span className="text-lg font-semibold">{arg.date.getDate()}</span>
          </div>
        )}
        dateClick={(info) => {
          const clickedDate = info.allDay ? setDateHour(info.date, 9) : info.date;

          onCreateAt(clickedDate);
        }}
        editable
        eventClick={(info) => {
          info.jsEvent.preventDefault();

          if (info.jsEvent.detail >= 2) {
            onOpenFullEditor(info.event.id);
            return;
          }

          onSelectMeeting(info.event.id);
        }}
        eventContent={(arg) => {
          const meeting = arg.event.extendedProps.meeting as ChronosMeeting;

          return (
            <div className="min-w-0 px-1 py-0.5 leading-tight text-white">
              <span className="block truncate text-[11px] font-bold">
                {arg.timeText ? `${arg.timeText} ` : ""}
                {meeting.title}
              </span>
              {!arg.event.allDay ? (
                <span className="block truncate text-[10px] font-semibold text-white/85">
                  {getChronosMeetingLocationLabel(meeting)}
                </span>
              ) : null}
            </div>
          );
        }}
        eventDrop={(info) => {
          void onUpdate({
            action: "update_schedule",
            endsAt: info.event.end?.toISOString() ?? null,
            meetingId: info.event.id,
            startsAt: info.event.start?.toISOString() ?? null,
          }).catch(() => info.revert());
        }}
        eventOverlap
        eventResizableFromStart
        eventResize={(info) => {
          void onUpdate({
            action: "update_schedule",
            endsAt: info.event.end?.toISOString() ?? null,
            meetingId: info.event.id,
            startsAt: info.event.start?.toISOString() ?? null,
          }).catch(() => info.revert());
        }}
        events={fullCalendarEvents}
        expandRows={false}
        firstDay={0}
        headerToolbar={false}
        height="100%"
        initialDate={calendarStartDate}
        initialView={isWeek ? "timeGridWeek" : "timeGridDay"}
        key={`${isWeek ? "week" : "day"}-${calendarStartDate.toISOString()}`}
        locale="pt-br"
        nowIndicator
        plugins={[timeGridPlugin, dayGridPlugin, listPlugin, interactionPlugin]}
        scrollTime={scrollToTime}
        slotDuration="00:30:00"
        slotEventOverlap
        slotLabelFormat={{
          hour: "2-digit",
          minute: "2-digit",
          omitZeroMinute: false,
        }}
        slotLabelInterval="01:00:00"
        slotMaxTime="24:00:00"
        slotMinTime="00:00:00"
        stickyHeaderDates
        timeZone="local"
      />
      <style>{`
        .chronos-google-calendar .fc {
          --fc-border-color: #edf0f4;
          --fc-event-border-color: #7db7ff;
          --fc-event-bg-color: #eaf3ff;
          --fc-event-text-color: #0b66d8;
          color: #101820;
          font-family: inherit;
          font-size: 12px;
          overflow: hidden;
        }
        .chronos-google-calendar .fc-scrollgrid {
          border: 0;
        }
        .chronos-google-calendar .fc-scrollgrid,
        .chronos-google-calendar .fc-theme-standard td,
        .chronos-google-calendar .fc-theme-standard th {
          border-color: #edf0f4;
        }
        .chronos-google-calendar .fc-col-header-cell,
        .chronos-google-calendar .fc-timegrid-axis,
        .chronos-google-calendar .fc-timegrid-slot-label {
          background: #fff;
        }
        .chronos-google-calendar .fc-timegrid-axis-cushion,
        .chronos-google-calendar .fc-timegrid-slot-label-cushion {
          color: #667085;
          font-size: 11px;
          font-weight: 600;
        }
        .chronos-google-calendar .fc-timegrid-slot {
          height: 3rem;
        }
        .chronos-google-calendar .fc-timegrid-slot-minor {
          border-top-style: solid;
          border-top-color: #f3f6fa;
        }
        .chronos-google-calendar .fc-timegrid-now-indicator-line {
          border-color: #e2342f;
          border-top-width: 2px;
        }
        .chronos-google-calendar .fc-timegrid-now-indicator-arrow {
          background: #e2342f;
          border: 0;
          border-radius: 999px;
          box-shadow: 0 0 0 2px #ffffff;
          height: 10px;
          margin-left: 5px;
          margin-top: -5px;
          width: 10px;
        }
        .chronos-google-calendar .fc-event {
          border-radius: 4px;
          box-shadow: none;
          cursor: pointer;
          overflow: hidden;
        }
        .chronos-google-calendar .fc-v-event {
          background: #eaf3ff;
          border-color: #7db7ff;
          color: #0b66d8;
        }
        .chronos-google-calendar .chronos-google-event-rsvp-pending,
        .chronos-google-calendar .chronos-google-event-rsvp-tentative {
          background: #ffffff !important;
          border-color: #0b66d8 !important;
          color: #0b66d8 !important;
        }
        .chronos-google-calendar .chronos-google-event-rsvp-declined {
          background: #ffffff !important;
          border-color: #dc2626 !important;
          color: #b91c1c !important;
          opacity: 0.82;
        }
        .chronos-google-calendar .chronos-google-event-rsvp-declined .fc-event-title,
        .chronos-google-calendar .chronos-google-event-rsvp-declined span {
          text-decoration: line-through;
        }
        .chronos-google-calendar .fc-daygrid-event,
        .chronos-google-calendar .fc-timegrid-event {
          margin: 1px 2px;
        }
        .chronos-google-calendar .chronos-google-event-selected {
          box-shadow: 0 0 0 2px rgba(160, 124, 59, 0.45);
        }
      `}</style>
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
                  ? chronosMeetingTypeVisuals[dayMeeting.meetingType]
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
  const typeVisual = chronosMeetingTypeVisuals[meeting.meetingType];

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
        <Badge variant={chronosMeetingStatusVariant[meeting.status]}>
          {chronosMeetingStatusLabels[meeting.status]}
        </Badge>
      </span>
      <span className="flex flex-wrap gap-1">
        <span
          className={`inline-flex h-6 items-center rounded-full border px-2 text-xs font-semibold ${typeVisual.chipClass}`}
        >
          {typeVisual.label}
        </span>
        <Badge variant="neutral">{meeting.protocol}</Badge>
        <Badge variant={chronosMinutesStatusVariant[meeting.minutesStatus]}>
          {chronosMinutesStatusLabels[meeting.minutesStatus]}
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
  const typeVisual = chronosMeetingTypeVisuals[meeting.meetingType];

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

function isChronosAllDayMeeting(meeting: ChronosMeeting) {
  const startsAt = meeting.startsAt ? new Date(meeting.startsAt) : null;
  const endsAt = meeting.endsAt ? new Date(meeting.endsAt) : null;
  const kind = getChronosCalendarEventKind(meeting);
  const options =
    meeting.metadata.calendarOptions &&
    typeof meeting.metadata.calendarOptions === "object"
      ? (meeting.metadata.calendarOptions as { allDay?: unknown })
      : null;

  if (options?.allDay === true) {
    return true;
  }

  if (!startsAt || Number.isNaN(startsAt.getTime())) {
    return false;
  }

  if (
    startsAt.getHours() === 0 &&
    startsAt.getMinutes() === 0 &&
    (!endsAt || (endsAt.getHours() === 0 && endsAt.getMinutes() === 0))
  ) {
    return true;
  }

  if (endsAt && !Number.isNaN(endsAt.getTime())) {
    const durationHours = (endsAt.getTime() - startsAt.getTime()) / 3_600_000;

    return durationHours >= 20 || (kind === "event" && durationHours >= 23);
  }

  return false;
}

function getChronosFullCalendarStart(meeting: ChronosMeeting, allDay: boolean) {
  if (!meeting.startsAt) {
    return undefined;
  }

  const startsAt = new Date(meeting.startsAt);

  return allDay ? toDateOnly(startsAt) : startsAt.toISOString();
}

function getChronosFullCalendarEnd(meeting: ChronosMeeting, allDay: boolean) {
  if (!meeting.endsAt) {
    return undefined;
  }

  const endsAt = new Date(meeting.endsAt);

  if (!allDay) {
    return endsAt.toISOString();
  }

  const exclusiveEnd = new Date(
    endsAt.getFullYear(),
    endsAt.getMonth(),
    endsAt.getDate() + 1,
  );

  return toDateOnly(exclusiveEnd);
}

function getChronosCalendarEventColor(meeting: ChronosMeeting) {
  if (getChronosCalendarEventKind(meeting) === "out_of_office") {
    return "#0ea5e9";
  }

  switch (meeting.meetingType) {
    case "results":
      return "#078b4f"; // Resultado — verde
    case "formal":
      return "#d97706"; // Comunicado — ambar
    case "client":
      return "#A07C3B"; // Reuniao com cliente — dourado Careli
    case "executive":
      return "#1f2a37"; // Executiva — grafite
    case "external":
      return "#526078"; // Externa — cinza
    case "alignment":
    default:
      return "#0b66d8"; // Alinhamento — azul
  }
}

function toDateOnly(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
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
            ? chronosMeetingTypeVisuals[dayMeeting.meetingType]
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
