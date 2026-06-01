import {
  loadChronosGoogleCalendarStatus,
  startChronosGoogleCalendarConnection,
  syncChronosGoogleCalendar,
} from "@/lib/chronos/client";
import {
  addDays,
  addMonths,
  addYears,
  formatCalendarPeriod,
  roundDateToNextHour,
  sortMeetingsByDate,
  startOfDay,
  toDateTimeLocalValue,
  type ChronosCalendarView,
} from "@/lib/chronos/calendar";
import type {
  ChronosCreateMeetingInput,
  ChronosGoogleCalendarStatus,
  ChronosMeeting,
  ChronosMeetingProfile,
  ChronosRoom,
} from "@/lib/chronos/types";
import { Surface } from "@repo/uix";
import { Loader2, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChronosCalendarCanvas,
  MiniCalendar,
} from "./chronos-calendar-canvas";
import { ChronosCalendarEventDetailsPopup } from "./chronos-calendar-event-details-popup";
import { ChronosCalendarEventPopup } from "./chronos-calendar-event-popup";
import { chronosMeetingTypeVisuals } from "./chronos-meeting-type-visuals";

export function ChronosAgendaScreen({
  canManage,
  meetings,
  onCreate,
  onDeleteMeeting,
  onReload,
  onSelectMeeting,
  profiles,
  rooms,
  saving,
  selectedMeetingId,
}: {
  canManage: boolean;
  meetings: ChronosMeeting[];
  onCreate: (input: ChronosCreateMeetingInput) => Promise<void>;
  onDeleteMeeting: (meetingId: string) => Promise<void>;
  onReload: () => Promise<void>;
  onSelectMeeting: (meetingId: string) => void;
  profiles: ChronosMeetingProfile[];
  rooms: ChronosRoom[];
  saving: boolean;
  selectedMeetingId: string;
}) {
  const [calendarView, setCalendarView] =
    useState<ChronosCalendarView>("week");
  const [cursorDate, setCursorDate] = useState(() => startOfDay(new Date()));
  const [detailMeetingId, setDetailMeetingId] = useState<string | null>(null);
  const [draftStartsAt, setDraftStartsAt] = useState<string | null>(null);
  const [googleCalendarStatus, setGoogleCalendarStatus] =
    useState<ChronosGoogleCalendarStatus | null>(null);
  const [googleCalendarError, setGoogleCalendarError] = useState<string | null>(
    null,
  );
  const [googleCalendarConnecting, setGoogleCalendarConnecting] = useState(false);
  const [googleCalendarInitialPullDone, setGoogleCalendarInitialPullDone] =
    useState(false);
  const [googleCalendarSyncing, setGoogleCalendarSyncing] = useState(false);
  const [googleCalendarSyncError, setGoogleCalendarSyncError] = useState<
    string | null
  >(null);
  const sortedMeetings = useMemo(() => sortMeetingsByDate(meetings), [meetings]);
  const detailMeeting = detailMeetingId
    ? sortedMeetings.find((meeting) => meeting.id === detailMeetingId) ?? null
    : null;
  const calendarViewItems: Array<{ id: ChronosCalendarView; label: string }> = [
    { id: "day", label: "Dia" },
    { id: "week", label: "Semana" },
    { id: "month", label: "Mes" },
    { id: "year", label: "Ano" },
    { id: "list", label: "Lista" },
  ];

  function moveCursor(direction: -1 | 1) {
    if (calendarView === "day" || calendarView === "list") {
      setCursorDate((currentDate) => addDays(currentDate, direction));
      return;
    }

    if (calendarView === "week") {
      setCursorDate((currentDate) => addDays(currentDate, direction * 7));
      return;
    }

    if (calendarView === "month") {
      setCursorDate((currentDate) => addMonths(currentDate, direction));
      return;
    }

    setCursorDate((currentDate) => addYears(currentDate, direction));
  }

  function openEventDraft(date: Date) {
    if (!canManage) {
      return;
    }

    setDraftStartsAt(toDateTimeLocalValue(date));
  }

  const refreshGoogleCalendarStatus = useCallback(async () => {
    try {
      const status = await loadChronosGoogleCalendarStatus();

      setGoogleCalendarStatus(status);
      setGoogleCalendarError(null);
    } catch (error) {
      setGoogleCalendarStatus(null);
      setGoogleCalendarError(
        error instanceof Error
          ? error.message
          : "Nao foi possivel verificar o Google Agenda.",
      );
    }
  }, []);

  useEffect(() => {
    void refreshGoogleCalendarStatus();
  }, [refreshGoogleCalendarStatus]);

  useEffect(() => {
    if (
      googleCalendarInitialPullDone ||
      googleCalendarSyncing ||
      googleCalendarStatus?.status !== "connected"
    ) {
      return;
    }

    let cancelled = false;

    setGoogleCalendarInitialPullDone(true);
    setGoogleCalendarSyncing(true);
    setGoogleCalendarSyncError(null);

    void syncChronosGoogleCalendar("pull", {
      full:
        !googleCalendarStatus.connection.syncTokenPresent ||
        !googleCalendarStatus.connection.lastSyncedAt,
    })
      .then(async () => {
        if (cancelled) {
          return;
        }

        await refreshGoogleCalendarStatus();
        await onReload();
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setGoogleCalendarSyncError(
          error instanceof Error
            ? error.message
            : "Nao foi possivel sincronizar Google Agenda.",
        );
      })
      .finally(() => {
        if (!cancelled) {
          setGoogleCalendarSyncing(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    googleCalendarInitialPullDone,
    googleCalendarStatus,
    googleCalendarSyncing,
    onReload,
    refreshGoogleCalendarStatus,
  ]);

  function openMeetingDetails(meetingId: string) {
    onSelectMeeting(meetingId);
    setDetailMeetingId(meetingId);
  }

  async function handleGoogleCalendarSync() {
    if (googleCalendarSyncing) {
      return;
    }

    setGoogleCalendarSyncing(true);
    setGoogleCalendarSyncError(null);

    try {
      await syncChronosGoogleCalendar("both");
      await refreshGoogleCalendarStatus();
      await onReload();
    } catch (error) {
      setGoogleCalendarSyncError(
        error instanceof Error
          ? error.message
          : "Nao foi possivel sincronizar Google Agenda.",
      );
    } finally {
      setGoogleCalendarSyncing(false);
    }
  }

  async function handleGoogleCalendarConnect() {
    if (googleCalendarConnecting) {
      return;
    }

    setGoogleCalendarConnecting(true);
    setGoogleCalendarSyncError(null);

    try {
      const authorizationUrl = await startChronosGoogleCalendarConnection(
        "/chronos",
      );

      window.location.assign(authorizationUrl);
    } catch (error) {
      setGoogleCalendarConnecting(false);
      setGoogleCalendarSyncError(
        error instanceof Error
          ? error.message
          : "Nao foi possivel conectar Google Agenda.",
      );
    }
  }

  const googleCalendarConnected =
    googleCalendarStatus?.connection.connected === true;
  const canConnectGoogleCalendar =
    googleCalendarStatus?.configured === true &&
    googleCalendarStatus.connection.storageReady &&
    !googleCalendarConnected;

  return (
    <Surface bordered className="relative grid min-h-[38rem] grid-rows-[auto_minmax(0,1fr)] overflow-hidden border-[#d9e0e7] bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#edf0f4] p-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            className="h-9 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm font-semibold text-[#101820] transition hover:bg-[#f8fafc]"
            onClick={() => setCursorDate(startOfDay(new Date()))}
            type="button"
          >
            Hoje
          </button>
          <button
            aria-label="Periodo anterior"
            className="grid h-9 w-9 place-items-center rounded-md border border-[#d9e0e7] bg-white text-[#526078] transition hover:bg-[#f8fafc] hover:text-[#101820]"
            onClick={() => moveCursor(-1)}
            type="button"
          >
            <span aria-hidden="true">{"<"}</span>
          </button>
          <button
            aria-label="Proximo periodo"
            className="grid h-9 w-9 place-items-center rounded-md border border-[#d9e0e7] bg-white text-[#526078] transition hover:bg-[#f8fafc] hover:text-[#101820]"
            onClick={() => moveCursor(1)}
            type="button"
          >
            <span aria-hidden="true">{">"}</span>
          </button>
          <span className="ml-1 text-base font-semibold text-[#101820]">
            {formatCalendarPeriod(cursorDate, calendarView)}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="hidden flex-wrap items-center gap-2 text-[11px] font-semibold text-[#667085] xl:flex">
            {(["alignment", "results", "formal", "executive"] as const).map(
              (type) => {
                const visual = chronosMeetingTypeVisuals[type];

                return (
                  <span className="inline-flex items-center gap-1" key={type}>
                    <span
                      aria-hidden="true"
                      className={`h-2 w-2 rounded-full ${visual.dotClass}`}
                    />
                    {visual.label}
                  </span>
                );
              },
            )}
          </div>
          <div className="flex gap-1 overflow-x-auto rounded-md border border-[#d9e0e7] bg-[#f8fafc] p-1">
            {calendarViewItems.map((item) => (
              <button
                aria-pressed={calendarView === item.id}
                className={`h-8 shrink-0 rounded-md px-3 text-sm font-semibold transition ${
                  calendarView === item.id
                    ? "bg-[#101820] text-white"
                    : "text-[#667085] hover:bg-white hover:text-[#101820]"
                }`}
                key={item.id}
                onClick={() => setCalendarView(item.id)}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>
          {googleCalendarSyncError || googleCalendarError ? (
            <span className="max-w-64 truncate text-xs font-semibold text-amber-700">
              {googleCalendarSyncError ?? googleCalendarError}
            </span>
          ) : null}
          {googleCalendarConnected ? (
            <button
              aria-label="Sincronizar Google Agenda"
              className="grid h-9 w-9 place-items-center rounded-md border border-emerald-200 bg-emerald-50 text-sm font-black text-emerald-700 transition hover:bg-emerald-100 focus-visible:ring-2 focus-visible:ring-[#A07C3B] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={googleCalendarSyncing}
              onClick={() => void handleGoogleCalendarSync()}
              type="button"
            >
              {googleCalendarSyncing ? (
                <Loader2 aria-hidden="true" className="animate-spin" size={15} />
              ) : (
                <span aria-hidden="true">G</span>
              )}
            </button>
          ) : (
            <button
              className="inline-flex h-9 items-center gap-2 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm font-semibold text-[#101820] transition hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-55"
              disabled={!canConnectGoogleCalendar || googleCalendarConnecting}
              onClick={() => void handleGoogleCalendarConnect()}
              type="button"
            >
              {googleCalendarConnecting ? (
                <Loader2 aria-hidden="true" className="animate-spin" size={15} />
              ) : (
                <span aria-hidden="true">G</span>
              )}
              Conectar
            </button>
          )}
          <button
            aria-label="Criar evento"
            className="grid h-9 w-9 place-items-center rounded-md bg-[#101820] text-white transition hover:bg-[#1f2937] disabled:cursor-not-allowed disabled:opacity-55"
            disabled={!canManage}
            onClick={() => openEventDraft(roundDateToNextHour(new Date()))}
            type="button"
          >
            <Plus aria-hidden="true" size={16} />
          </button>
        </div>
      </div>

      <div className="grid min-h-0 grid-cols-[16rem_minmax(0,1fr)] max-xl:grid-cols-1">
        <aside className="min-h-0 border-r border-[#edf0f4] bg-[#fafbfc] p-3 max-xl:hidden">
          <MiniCalendar
            cursorDate={cursorDate}
            meetings={sortedMeetings}
            onSelectDate={(date) => setCursorDate(date)}
          />
        </aside>

        <div className="min-h-0 overflow-auto">
          <ChronosCalendarCanvas
            cursorDate={cursorDate}
            meetings={sortedMeetings}
            onCreateAt={openEventDraft}
            onSelectMeeting={openMeetingDetails}
            rooms={rooms}
            selectedMeetingId={selectedMeetingId}
            view={calendarView}
          />
        </div>
      </div>

      {detailMeeting ? (
        <div className="absolute inset-0 z-40 flex items-start justify-center px-4 pt-24">
          <button
            aria-label="Fechar detalhes do evento"
            className="absolute inset-0 cursor-default bg-transparent"
            onClick={() => setDetailMeetingId(null)}
            type="button"
          />
          <ChronosCalendarEventDetailsPopup
            meeting={detailMeeting}
            onClose={() => setDetailMeetingId(null)}
            onDelete={async (meetingId) => {
              await onDeleteMeeting(meetingId);
              setDetailMeetingId(null);
            }}
            saving={saving}
          />
        </div>
      ) : null}

      {draftStartsAt ? (
        <div className="absolute inset-0 z-30 flex items-start justify-center px-4 pt-28">
          <button
            aria-label="Fechar criacao de evento"
            className="absolute inset-0 cursor-default bg-transparent"
            onClick={() => setDraftStartsAt(null)}
            type="button"
          />
          <ChronosCalendarEventPopup
            initialStartsAt={draftStartsAt}
            onCancel={() => setDraftStartsAt(null)}
            onCreate={async (input) => {
              await onCreate(input);
              setDraftStartsAt(null);
            }}
            profiles={profiles}
            rooms={rooms}
            saving={saving}
          />
        </div>
      ) : null}
    </Surface>
  );
}
