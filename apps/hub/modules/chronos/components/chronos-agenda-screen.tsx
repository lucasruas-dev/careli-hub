import {
  loadChronosGoogleCalendarStatus,
  syncChronosGoogleCalendar,
} from "@/lib/chronos/client";
import {
  addDays,
  addMonths,
  addYears,
  formatCalendarPeriod,
  formatChronosWeekOfYearLabel,
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
  ChronosUpdateInput,
} from "@/lib/chronos/types";
import { PanteonLoadingMark } from "@/components/panteon/panteon-loading";
import { Surface } from "@repo/uix";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChronosCalendarCanvas,
  MiniCalendar,
} from "./chronos-calendar-canvas";
import { ChronosCalendarEventDetailsPopup } from "./chronos-calendar-event-details-popup";
import { ChronosCalendarEventEditorModal } from "./chronos-calendar-event-editor-modal";
import { ChronosCalendarEventPopup } from "./chronos-calendar-event-popup";
import { chronosMeetingTypeVisuals } from "./chronos-meeting-type-visuals";
import type { ChronosCurrentUser } from "./chronos-rsvp";

export function ChronosAgendaScreen({
  canManage,
  currentUser,
  meetings,
  onCreate,
  onDeleteMeeting,
  onReload,
  onRespondToMeeting,
  onSelectMeeting,
  onUpdate,
  profiles,
  rooms,
  saving,
  selectedMeetingId,
}: {
  canManage: boolean;
  currentUser?: ChronosCurrentUser | null;
  meetings: ChronosMeeting[];
  onCreate: (input: ChronosCreateMeetingInput) => Promise<void>;
  onDeleteMeeting: (meetingId: string) => Promise<void>;
  onReload: () => Promise<void>;
  onRespondToMeeting: (
    input: Extract<ChronosUpdateInput, { action: "update_participant_response" }>,
  ) => Promise<void>;
  onSelectMeeting: (meetingId: string) => void;
  onUpdate: (input: ChronosUpdateInput) => Promise<void>;
  profiles: ChronosMeetingProfile[];
  rooms: ChronosRoom[];
  saving: boolean;
  selectedMeetingId: string;
}) {
  const [calendarView, setCalendarView] =
    useState<ChronosCalendarView>("week");
  const [cursorDate, setCursorDate] = useState(() => startOfDay(new Date()));
  const [detailMeetingId, setDetailMeetingId] = useState<string | null>(null);
  const [editingMeetingId, setEditingMeetingId] = useState<string | null>(null);
  const [draftStartsAt, setDraftStartsAt] = useState<string | null>(null);
  const [googleCalendarStatus, setGoogleCalendarStatus] =
    useState<ChronosGoogleCalendarStatus | null>(null);
  const [googleCalendarError, setGoogleCalendarError] = useState<string | null>(
    null,
  );
  const [googleCalendarSyncing, setGoogleCalendarSyncing] = useState(false);
  const [googleCalendarSyncError, setGoogleCalendarSyncError] = useState<
    string | null
  >(null);
  const sortedMeetings = useMemo(() => sortMeetingsByDate(meetings), [meetings]);
  const detailMeeting = detailMeetingId
    ? sortedMeetings.find((meeting) => meeting.id === detailMeetingId) ?? null
    : null;
  const editingMeeting = editingMeetingId
    ? sortedMeetings.find((meeting) => meeting.id === editingMeetingId) ?? null
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

  const isGoogleCalendarConnected = Boolean(
    googleCalendarStatus?.connection?.connected,
  );

  const runBackgroundGoogleCalendarSync = useCallback(async () => {
    if (!isGoogleCalendarConnected) {
      return;
    }

    try {
      const result = await syncChronosGoogleCalendar("pull");

      if (
        result.status !== "skipped" &&
        (result.synced > 0 || result.processed > 0)
      ) {
        await onReload();
      }
    } catch {
      // Sincronizacao em segundo plano e silenciosa: falhas nao interrompem o uso.
    }
  }, [isGoogleCalendarConnected, onReload]);

  useEffect(() => {
    if (!isGoogleCalendarConnected) {
      return;
    }

    // Reflete no Chronos as mudancas feitas no Google sem precisar clicar em
    // "sincronizar": puxa ao abrir, ao voltar o foco e a cada intervalo curto.
    // O pull e incremental (syncToken), entao cada execucao e leve.
    void runBackgroundGoogleCalendarSync();

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void runBackgroundGoogleCalendarSync();
      }
    }, 3 * 60 * 1000);

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void runBackgroundGoogleCalendarSync();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isGoogleCalendarConnected, runBackgroundGoogleCalendarSync]);

  function openMeetingDetails(meetingId: string) {
    onSelectMeeting(meetingId);
    setDetailMeetingId(meetingId);
  }

  function openMeetingEditor(meetingId: string) {
    onSelectMeeting(meetingId);
    setDetailMeetingId(null);
    setEditingMeetingId(meetingId);
  }

  async function handleGoogleCalendarSync() {
    if (googleCalendarSyncing) {
      return;
    }

    if (
      googleCalendarStatus?.configured &&
      googleCalendarStatus.connection.storageReady &&
      !googleCalendarStatus.connection.connected
    ) {
      const returnTo = `${window.location.pathname}${window.location.search}`;

      window.location.href = `${googleCalendarStatus.authorizationPath}?returnTo=${encodeURIComponent(returnTo)}`;
      return;
    }

    setGoogleCalendarSyncing(true);
    setGoogleCalendarSyncError(null);

    try {
      await syncChronosGoogleCalendar("pull", { forceFullSync: true });
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

  return (
    <Surface bordered className="relative grid min-h-[38rem] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-[28px] border-[#d9e0e7] bg-white shadow-[0_18px_60px_rgb(16_24_32_/_0.08)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#edf0f4] px-5 py-4">
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
          {calendarView === "week" ? (
            <span className="rounded-full border border-[#d6c29b] bg-[#fffaf0] px-2.5 py-1 text-xs font-bold text-[#8a682d]">
              {formatChronosWeekOfYearLabel(cursorDate)}
            </span>
          ) : null}
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
          <button
            aria-label={
              googleCalendarStatus?.connection.connected
                ? "Sincronizar Google Agenda"
                : "Conectar Google Agenda"
            }
            className={`grid h-9 w-9 place-items-center rounded-md border text-sm font-black transition focus-visible:ring-2 focus-visible:ring-[#A07C3B] ${
              googleCalendarStatus?.connection.connected
                ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                : "border-[#d9e0e7] bg-white text-[#526078] hover:bg-[#f8fafc] hover:text-[#101820]"
            }`}
            disabled={googleCalendarSyncing}
            onClick={() => void handleGoogleCalendarSync()}
            type="button"
          >
            {googleCalendarSyncing ? (
              <PanteonLoadingMark size="xs" />
            ) : (
              <span aria-hidden="true">G</span>
            )}
          </button>
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

      <div className="grid min-h-0 grid-cols-[16rem_minmax(0,1fr)] bg-white max-xl:grid-cols-1">
        <aside className="min-h-0 border-r border-[#edf0f4] bg-[#fafbfc] p-3 max-xl:hidden">
          <MiniCalendar
            cursorDate={cursorDate}
            meetings={sortedMeetings}
            onSelectDate={(date) => setCursorDate(date)}
          />
        </aside>

        <div className="min-h-0 overflow-x-auto overflow-y-hidden">
          <ChronosCalendarCanvas
            cursorDate={cursorDate}
            currentUser={currentUser}
            meetings={sortedMeetings}
            onCreateAt={openEventDraft}
            onOpenFullEditor={openMeetingEditor}
            onSelectMeeting={openMeetingDetails}
            onUpdate={onUpdate}
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
            currentUser={currentUser}
            meeting={detailMeeting}
            onClose={() => setDetailMeetingId(null)}
            onDelete={async (meetingId) => {
              await onDeleteMeeting(meetingId);
              setDetailMeetingId(null);
            }}
            onEdit={openMeetingEditor}
            onUpdateParticipantResponse={onRespondToMeeting}
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

      {editingMeeting ? (
        <div className="absolute inset-0 z-50 bg-[#f3f6fa]">
          <ChronosCalendarEventEditorModal
            meeting={editingMeeting}
            onClose={() => setEditingMeetingId(null)}
            onDelete={async (meetingId) => {
              await onDeleteMeeting(meetingId);
              setEditingMeetingId(null);
            }}
            onSave={async (input) => {
              await onUpdate(input);
              setEditingMeetingId(null);
            }}
            saving={saving}
          />
        </div>
      ) : null}
    </Surface>
  );
}
