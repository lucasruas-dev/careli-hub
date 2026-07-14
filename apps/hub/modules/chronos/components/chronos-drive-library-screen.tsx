import {
  sortMeetingsByDate,
} from "@/lib/chronos/calendar";
import {
  buildChronosRecordingFolders,
  filterChronosDriveRecordingMeetings,
  type LocalRecording,
} from "@/lib/chronos/drive";
import { normalizeChronosMeetingRuntime } from "@/lib/chronos/runtime-meeting";
import { hasChronosMeetingAvailableRecording } from "@/lib/chronos/rooms";
import type {
  ChronosMeeting,
  ChronosMinutesProfile,
  ChronosRoom,
  ChronosUpdateInput,
} from "@/lib/chronos/types";
import { Badge, Surface } from "@repo/uix";
import {
  Folder,
  FolderOpen,
  LayoutGrid,
  ListChecks,
  Search,
  UsersRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  ChronosDrivePanel,
  type ChronosDriveView,
} from "./chronos-drive-panel";
import { ChronosDriveItemCard } from "./chronos-drive-item-card";
import { ChronosDriveMeetingRecordingCard } from "./chronos-drive-recording-card";
import { MinutesPanel } from "./chronos-minutes-panel";
import { EmptyPanel, PanelTitle } from "./chronos-panels";
import { TranscriptPanel } from "./chronos-transcript-panel";

type ChronosDriveViewMode = "grid" | "list";

type ChronosDriveLibraryScreenProps = {
  activeDriveView: ChronosDriveView;
  canDeleteMinutes: boolean;
  localRecordings: LocalRecording[];
  meeting: ChronosMeeting | null;
  meetings: ChronosMeeting[];
  onChangeDriveView: (view: ChronosDriveView) => void;
  onGenerateMinutesDraft: (
    meeting: ChronosMeeting,
    minutesProfile: ChronosMinutesProfile,
  ) => Promise<void>;
  onSelectMeeting: (meetingId: string) => void;
  onTranscribeExistingRecording: (input: {
    meeting: ChronosMeeting;
    minutesProfile?: ChronosMinutesProfile;
    recordingId: string;
  }) => Promise<boolean>;
  onUpdate: (input: ChronosUpdateInput) => Promise<void>;
  rooms: ChronosRoom[];
  saving: boolean;
  userName: string;
};

export function ChronosDriveLibraryScreen({
  activeDriveView,
  canDeleteMinutes,
  localRecordings,
  meeting,
  meetings,
  onChangeDriveView,
  onGenerateMinutesDraft,
  onSelectMeeting,
  onTranscribeExistingRecording,
  onUpdate,
  rooms,
  saving,
  userName,
}: ChronosDriveLibraryScreenProps) {
  const [roomFilter, setRoomFilter] = useState("all");
  const [focusedMinutesMeetingId, setFocusedMinutesMeetingId] = useState("");
  const filteredMeetings = useMemo(() => {
    const byRoom =
      roomFilter === "all"
        ? meetings
        : meetings.filter((currentMeeting) => currentMeeting.roomId === roomFilter);

    if (activeDriveView === "recordings") {
      return sortMeetingsByDate(
        byRoom.filter(
          (currentMeeting) =>
            currentMeeting.recordingStatus !== "not_started" ||
            currentMeeting.recordings.length > 0,
        ),
      );
    }

    const minutesMeetings = sortMeetingsByDate(
      byRoom.filter(hasChronosMeetingMinutesWorkspace),
    );

    if (focusedMinutesMeetingId) {
      return minutesMeetings.filter(
        (currentMeeting) => currentMeeting.id === focusedMinutesMeetingId,
      );
    }

    return minutesMeetings;
  }, [activeDriveView, focusedMinutesMeetingId, meetings, roomFilter]);
  const selectedMinutesMeeting =
    activeDriveView === "minutes"
      ? meeting && filteredMeetings.some((currentMeeting) => currentMeeting.id === meeting.id)
        ? meeting
        : filteredMeetings[0] ?? null
      : meeting;
  const selectedMinutesMeetingRuntime = selectedMinutesMeeting
    ? normalizeChronosMeetingRuntime(selectedMinutesMeeting)
    : null;

  function handleOpenMeetingMinutes(meetingId: string) {
    setRoomFilter("all");
    setFocusedMinutesMeetingId(meetingId);
    onSelectMeeting(meetingId);
    onChangeDriveView("minutes");
  }

  function handleChangeDriveView(view: ChronosDriveView) {
    setFocusedMinutesMeetingId("");
    onChangeDriveView(view);
  }

  if (activeDriveView === "recordings") {
    return (
      <ChronosDrivePanel
        activeDriveView={activeDriveView}
        onChangeDriveView={handleChangeDriveView}
      >
        <ChronosRecordingFolderExplorer
          localRecordings={localRecordings}
          meetings={meetings}
          onOpenMeetingMinutes={handleOpenMeetingMinutes}
          rooms={rooms}
        />
      </ChronosDrivePanel>
    );
  }

  return (
    <ChronosDrivePanel
      activeDriveView={activeDriveView}
      onChangeDriveView={handleChangeDriveView}
    >
      <section className="grid min-h-[42rem] gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(24rem,0.72fr)]">
        <Surface bordered className="border-line bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-4">
            <PanelTitle eyebrow="Drive Chronos" title="Atas" />
            <select
              className="h-9 rounded-md border border-line bg-surface px-3 text-sm font-semibold text-ink-muted outline-none focus:border-[#A07C3B]"
              onChange={(event) => {
                setFocusedMinutesMeetingId("");
                setRoomFilter(event.target.value);
              }}
              value={roomFilter}
            >
              <option value="all">Todas as salas</option>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </select>
            {focusedMinutesMeetingId ? (
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-surface px-3 text-sm font-semibold text-ink-muted transition hover:border-[#A07C3B] hover:text-ink"
                onClick={() => setFocusedMinutesMeetingId("")}
                type="button"
              >
                <X aria-hidden="true" size={14} />
                Ver todas
              </button>
            ) : null}
          </div>
          <div className="grid min-w-0 gap-3 p-4 md:grid-cols-2">
            {filteredMeetings.map((driveMeeting) => (
              <ChronosDriveItemCard
                driveView="minutes"
                key={driveMeeting.id}
                meeting={driveMeeting}
                onSelectMeeting={onSelectMeeting}
                selected={driveMeeting.id === selectedMinutesMeeting?.id}
              />
            ))}
            {filteredMeetings.length === 0 ? (
              <EmptyPanel text="Nenhuma ata disponivel sem gravacao vinculada." />
            ) : null}
          </div>
        </Surface>

        {selectedMinutesMeetingRuntime ? (
          <div className="grid gap-4">
            <MinutesPanel
              canDeleteMinutes={canDeleteMinutes}
              meeting={selectedMinutesMeetingRuntime}
              onGenerateMinutesDraft={onGenerateMinutesDraft}
              onTranscribeExistingRecording={onTranscribeExistingRecording}
              onUpdate={onUpdate}
              saving={saving}
            />
            <TranscriptPanel
              meeting={selectedMinutesMeetingRuntime}
              onUpdate={onUpdate}
              saving={saving}
              userName={userName}
            />
          </div>
        ) : (
          <Surface bordered className="grid min-h-full place-items-center border-line bg-surface p-5 text-sm text-ink-muted">
            Selecione um item do Drive.
          </Surface>
        )}
      </section>
    </ChronosDrivePanel>
  );
}

function ChronosRecordingFolderExplorer({
  localRecordings,
  meetings,
  onOpenMeetingMinutes,
  rooms,
}: {
  localRecordings: LocalRecording[];
  meetings: ChronosMeeting[];
  onOpenMeetingMinutes: (meetingId: string) => void;
  rooms: ChronosRoom[];
}) {
  const folders = useMemo(
    () => buildChronosRecordingFolders({ localRecordings, meetings, rooms }),
    [localRecordings, meetings, rooms],
  );
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const [viewMode, setViewMode] = useState<ChronosDriveViewMode>("list");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [peopleFilter, setPeopleFilter] = useState("");
  const selectedFolder =
    folders.find((folder) => folder.id === selectedFolderId) ??
    folders[0] ??
    null;
  const filteredMeetings = useMemo(
    () =>
      filterChronosDriveRecordingMeetings(selectedFolder?.meetings ?? [], {
        dateFrom,
        dateTo,
        people: peopleFilter,
        subject: subjectFilter,
      }),
    [dateFrom, dateTo, peopleFilter, selectedFolder, subjectFilter],
  );
  const filtersActive = Boolean(
    dateFrom || dateTo || subjectFilter.trim() || peopleFilter.trim(),
  );

  useEffect(() => {
    if (!folders.some((folder) => folder.id === selectedFolderId)) {
      setSelectedFolderId(folders[0]?.id ?? "");
    }
  }, [folders, selectedFolderId]);

  function clearFilters() {
    setDateFrom("");
    setDateTo("");
    setSubjectFilter("");
    setPeopleFilter("");
  }

  return (
    <section className="grid min-h-[42rem] overflow-hidden rounded-md border border-line bg-surface xl:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="border-r border-line bg-[#fbfcfe]">
        <div className="border-b border-line p-4">
          <PanelTitle eyebrow="Drive Chronos" title="Pastas" />
        </div>
        <div className="grid gap-2 p-4">
          {folders.map((folder) => {
            const selected = selectedFolder?.id === folder.id;
            const FolderIcon = selected ? FolderOpen : Folder;

            return (
              <button
                className={`grid gap-2 rounded-md px-2.5 py-2 text-left transition ${
                  selected
                    ? "bg-[#fffaf0] dark:bg-[#a07c3b]/10 shadow-[inset_2px_0_0_#A07C3B]"
                    : "hover:bg-surface"
                }`}
                key={folder.id}
                onClick={() => setSelectedFolderId(folder.id)}
                type="button"
              >
                <span className="flex items-start gap-3">
                  <span
                    className={`grid h-10 w-10 shrink-0 place-items-center rounded-md ${
                      selected
                        ? "bg-inverse text-brand-ink"
                        : "bg-surface text-[#A07C3B]"
                    }`}
                  >
                    <FolderIcon aria-hidden="true" size={18} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ink">
                      {folder.label}
                    </span>
                    <span className="mt-1 block truncate text-xs text-ink-muted">
                      {folder.subtitle}
                    </span>
                  </span>
                </span>
                <span className="flex flex-wrap gap-1">
                  <Badge variant="neutral">
                    {folder.meetings.length} reunioes
                  </Badge>
                  <Badge variant="neutral">
                    {folder.totalRecordings} arquivos
                  </Badge>
                </span>
              </button>
            );
          })}
          {folders.length === 0 ? (
            <EmptyPanel text="Nenhuma pasta com gravacoes encontrada." />
          ) : null}
        </div>
      </aside>

      <div className="min-w-0 bg-surface">
        {selectedFolder ? (
          <>
            <div className="grid gap-3 border-b border-line p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <PanelTitle eyebrow="Gravacoes" title={selectedFolder.label} />
                <span className="text-xs font-semibold text-ink-muted">
                  {filteredMeetings.length} reunioes filtradas
                </span>
              </div>
              <div className="grid gap-2 xl:grid-cols-[minmax(8rem,0.7fr)_minmax(8rem,0.7fr)_minmax(12rem,1fr)_minmax(12rem,1fr)_auto_auto]">
                <label className="grid gap-1 text-xs font-bold uppercase text-ink-muted">
                  De
                  <input
                    className="h-9 rounded-md border border-line bg-surface px-3 text-sm normal-case text-ink outline-none focus:border-[#A07C3B]"
                    onChange={(event) => setDateFrom(event.target.value)}
                    type="date"
                    value={dateFrom}
                  />
                </label>
                <label className="grid gap-1 text-xs font-bold uppercase text-ink-muted">
                  Ate
                  <input
                    className="h-9 rounded-md border border-line bg-surface px-3 text-sm normal-case text-ink outline-none focus:border-[#A07C3B]"
                    onChange={(event) => setDateTo(event.target.value)}
                    type="date"
                    value={dateTo}
                  />
                </label>
                <label className="grid gap-1 text-xs font-bold uppercase text-ink-muted">
                  Assunto
                  <span className="relative">
                    <Search
                      aria-hidden="true"
                      className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted"
                      size={14}
                    />
                    <input
                      className="h-9 w-full rounded-md border border-line bg-surface pl-8 pr-3 text-sm normal-case text-ink outline-none focus:border-[#A07C3B]"
                      onChange={(event) => setSubjectFilter(event.target.value)}
                      placeholder="Tema ou protocolo"
                      value={subjectFilter}
                    />
                  </span>
                </label>
                <label className="grid gap-1 text-xs font-bold uppercase text-ink-muted">
                  Pessoas
                  <span className="relative">
                    <UsersRound
                      aria-hidden="true"
                      className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted"
                      size={14}
                    />
                    <input
                      className="h-9 w-full rounded-md border border-line bg-surface pl-8 pr-3 text-sm normal-case text-ink outline-none focus:border-[#A07C3B]"
                      onChange={(event) => setPeopleFilter(event.target.value)}
                      placeholder="Nome, email ou empresa"
                      value={peopleFilter}
                    />
                  </span>
                </label>
                <div className="flex items-end">
                  <button
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-surface px-3 text-sm font-semibold text-ink-muted transition hover:border-[#A07C3B] hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!filtersActive}
                    onClick={clearFilters}
                    type="button"
                  >
                    <X aria-hidden="true" size={14} />
                    Limpar
                  </button>
                </div>
                <div className="flex items-end">
                  <div className="inline-flex h-9 rounded-md border border-line bg-surface p-1">
                    {[
                      { icon: LayoutGrid, id: "grid" as const, label: "Grade" },
                      { icon: ListChecks, id: "list" as const, label: "Lista" },
                    ].map((item) => {
                      const Icon = item.icon;
                      const active = viewMode === item.id;

                      return (
                        <button
                          aria-label={item.label}
                          className={`grid h-7 w-8 place-items-center rounded-md transition ${
                            active
                              ? "bg-inverse text-brand-ink"
                              : "text-ink-muted hover:bg-subtle hover:text-ink"
                          }`}
                          key={item.id}
                          onClick={() => setViewMode(item.id)}
                          type="button"
                        >
                          <Icon aria-hidden="true" size={14} />
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
            {filteredMeetings.length > 0 ? (
              <div
                className={
                  viewMode === "grid"
                    ? "grid gap-3 p-4 lg:grid-cols-2 2xl:grid-cols-3"
                    : "grid gap-2 p-4"
                }
              >
                {filteredMeetings.map((recordingMeeting) => (
                  <ChronosDriveMeetingRecordingCard
                    key={recordingMeeting.id}
                    onOpenMeetingMinutes={onOpenMeetingMinutes}
                    recordingMeeting={recordingMeeting}
                    viewMode={viewMode}
                  />
                ))}
              </div>
            ) : (
              <div className="grid min-h-[20rem] place-items-center p-5">
                <EmptyPanel text="Nenhuma reuniao encontrada com os filtros atuais." />
              </div>
            )}
          </>
        ) : (
          <div className="grid min-h-[28rem] place-items-center p-5">
            <EmptyPanel text="Nenhuma gravacao registrada no Chronos Drive." />
          </div>
        )}
      </div>
    </section>
  );
}

function hasChronosMeetingMinutesWorkspace(meeting: ChronosMeeting) {
  const safeMeeting = normalizeChronosMeetingRuntime(meeting);

  return (
    hasChronosMeetingAvailableRecording(safeMeeting) ||
    // Snapshot leve: os segmentos completos chegam sob demanda; o resumo
    // (transcriptSegmentCount) diz se ha transcricao.
    (safeMeeting.transcriptSegmentCount ?? safeMeeting.transcript.length) > 0 ||
    safeMeeting.minutes.length > 0 ||
    safeMeeting.minutesStatus !== "not_started"
  );
}
