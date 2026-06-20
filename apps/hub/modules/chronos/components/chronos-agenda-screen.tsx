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
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ChronosCalendarCanvas,
  MiniCalendar,
} from "./chronos-calendar-canvas";
import { ChronosCalendarEventDetailsPopup } from "./chronos-calendar-event-details-popup";
import { ChronosCalendarEventEditorModal } from "./chronos-calendar-event-editor-modal";
import { ChronosCalendarEventPopup } from "./chronos-calendar-event-popup";
import { chronosMeetingTypeVisuals } from "./chronos-meeting-type-visuals";
import type { ChronosCurrentUser } from "./chronos-rsvp";

// Identifica os registros criados quando alguem abre uma sala Whereby sem ter
// uma reserva na agenda (source "chronos-whereby-native-entry" /
// external_reference "whereby-room:..."). Sao sessoes de video para
// historico/ata, nao compromissos — e nao existem no Google Agenda.
function isChronosWherebyNativeSession(meeting: ChronosMeeting): boolean {
  const source =
    typeof meeting.metadata?.source === "string"
      ? meeting.metadata.source
      : null;

  if (source === "chronos-whereby-native-entry") {
    return true;
  }

  return (
    typeof meeting.externalReference === "string" &&
    meeting.externalReference.startsWith("whereby-room:")
  );
}

// Referencia compartilhada por todas as ocorrencias de uma serie recorrente
// materializada no Chronos. Permite excluir/identificar a serie inteira.
function getChronosSeriesReference(meeting: ChronosMeeting): string | null {
  return typeof meeting.externalReference === "string" &&
    meeting.externalReference.startsWith("chronos-series:")
    ? meeting.externalReference
    : null;
}

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
  const [detailAnchor, setDetailAnchor] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [detailPosition, setDetailPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const detailPopupRef = useRef<HTMLDivElement | null>(null);
  const [editingMeetingId, setEditingMeetingId] = useState<string | null>(null);
  const [seriesDeleteMeetingId, setSeriesDeleteMeetingId] = useState<
    string | null
  >(null);
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
  // Sessoes de sala Whereby abertas sem reserva viram um registro "ao vivo" so
  // para historico/ata — nao sao compromissos reais e nao existem no Google.
  // Ocultamos do calendario para nao poluir a agenda (igual ao Google Agenda).
  const calendarMeetings = useMemo(
    () => meetings.filter((meeting) => !isChronosWherebyNativeSession(meeting)),
    [meetings],
  );
  const sortedMeetings = useMemo(
    () => sortMeetingsByDate(calendarMeetings),
    [calendarMeetings],
  );
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

  // Calcula a posicao do popup de detalhes ja com o tamanho REAL medido (ele
  // pode ter ate 34rem de largura e altura variavel conforme o conteudo),
  // garantindo que nunca ultrapasse a viewport — nao importa onde o evento foi
  // clicado. Substitui o chute fixo anterior que vazava a tela.
  useLayoutEffect(() => {
    if (!detailMeetingId) {
      return;
    }

    const popup = detailPopupRef.current;

    if (!popup) {
      return;
    }

    const margin = 12;
    const { width, height } = popup.getBoundingClientRect();

    if (!detailAnchor) {
      setDetailPosition({
        left: Math.max(margin, (window.innerWidth - width) / 2),
        top: Math.max(
          margin,
          Math.min(96, window.innerHeight - height - margin),
        ),
      });
      return;
    }

    setDetailPosition({
      left: Math.min(
        Math.max(margin, detailAnchor.x + 16),
        Math.max(margin, window.innerWidth - width - margin),
      ),
      top: Math.min(
        Math.max(margin, detailAnchor.y - 40),
        Math.max(margin, window.innerHeight - height - margin),
      ),
    });
  }, [detailMeetingId, detailAnchor]);

  function openMeetingDetails(
    meetingId: string,
    anchor?: { x: number; y: number },
  ) {
    onSelectMeeting(meetingId);
    setDetailMeetingId(meetingId);
    // A posicao final e definida no useLayoutEffect acima (com o tamanho real
    // ja medido). Zeramos para medir antes de exibir.
    setDetailAnchor(anchor ?? null);
    setDetailPosition(null);
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
    <Surface bordered className="relative grid h-[calc(100dvh-5.5rem)] min-h-[34rem] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-[28px] border-[#d9e0e7] bg-white shadow-[0_18px_60px_rgb(16_24_32_/_0.08)]">
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
        <div className="fixed inset-0 z-40">
          <button
            aria-label="Fechar detalhes do evento"
            className="absolute inset-0 cursor-default bg-transparent"
            onClick={() => setDetailMeetingId(null)}
            type="button"
          />
          <div
            className="absolute max-w-[calc(100vw-1.5rem)]"
            ref={detailPopupRef}
            style={
              detailPosition
                ? {
                    left: detailPosition.left,
                    top: detailPosition.top,
                    visibility: "visible",
                  }
                : { left: 12, top: 12, visibility: "hidden" }
            }
          >
            <ChronosCalendarEventDetailsPopup
              currentUser={currentUser}
              meeting={detailMeeting}
              onClose={() => setDetailMeetingId(null)}
              onDelete={async (meetingId) => {
                const target = sortedMeetings.find(
                  (meeting) => meeting.id === meetingId,
                );

                // Evento recorrente: pergunta o escopo (este / toda a serie).
                if (target && getChronosSeriesReference(target)) {
                  setDetailMeetingId(null);
                  setSeriesDeleteMeetingId(meetingId);
                  return;
                }

                await onDeleteMeeting(meetingId);
                setDetailMeetingId(null);
              }}
              onEdit={openMeetingEditor}
              onUpdateParticipantResponse={onRespondToMeeting}
              saving={saving}
            />
          </div>
        </div>
      ) : null}

      {draftStartsAt ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center p-4">
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
      {seriesDeleteMeetingId ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <button
            aria-label="Cancelar exclusao"
            className="absolute inset-0 cursor-default bg-black/20"
            onClick={() => setSeriesDeleteMeetingId(null)}
            type="button"
          />
          <div className="relative z-10 w-[min(26rem,calc(100vw-2rem))] rounded-lg border border-[#d9e0e7] bg-white p-5 shadow-[0_22px_70px_rgb(16_24_32_/_0.22)]">
            <h2 className="text-lg font-semibold text-[#101820]">
              Excluir evento recorrente
            </h2>
            <p className="mt-1 text-sm text-[#667085]">
              Este evento faz parte de uma serie. O que deseja excluir?
            </p>
            <div className="mt-4 grid gap-2">
              <button
                className="h-10 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm font-semibold text-[#101820] transition hover:bg-[#f8fafc] disabled:opacity-55"
                disabled={saving}
                onClick={async () => {
                  const meetingId = seriesDeleteMeetingId;

                  setSeriesDeleteMeetingId(null);
                  await onDeleteMeeting(meetingId);
                }}
                type="button"
              >
                Somente este evento
              </button>
              <button
                className="h-10 rounded-md border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-55"
                disabled={saving}
                onClick={async () => {
                  const target = sortedMeetings.find(
                    (meeting) => meeting.id === seriesDeleteMeetingId,
                  );
                  const reference = target
                    ? getChronosSeriesReference(target)
                    : null;

                  setSeriesDeleteMeetingId(null);

                  if (!reference) {
                    return;
                  }

                  // Exclui todas as ocorrencias da serie (mesma referencia).
                  const seriesMeetings = sortedMeetings.filter(
                    (meeting) =>
                      getChronosSeriesReference(meeting) === reference,
                  );

                  for (const meeting of seriesMeetings) {
                    await onDeleteMeeting(meeting.id);
                  }
                }}
                type="button"
              >
                Todos os eventos da serie
              </button>
              <button
                className="h-10 rounded-md px-3 text-sm font-semibold text-[#526078] transition hover:bg-[#f8fafc]"
                onClick={() => setSeriesDeleteMeetingId(null)}
                type="button"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </Surface>
  );
}
