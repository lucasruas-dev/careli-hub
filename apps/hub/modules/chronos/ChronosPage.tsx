"use client";

import {
  createChronosMeeting,
  createChronosRoom,
  deleteChronosRoom,
  draftChronosMinutes,
  loadChronosGoogleCalendarStatus,
  loadChronosSnapshot,
  startChronosGoogleCalendarConnection,
  syncChronosGoogleCalendar,
  transcribeChronosRecording,
  updateChronosRoom,
  updateChronosMeeting,
} from "@/lib/chronos/client";
import {
  chronosCaptureStatusLabels,
  chronosMeetingStatusLabels,
  chronosMeetingTypeLabels,
  chronosMeetingTypes,
  chronosMinutesProfileLabels,
  chronosMinutesStatusLabels,
  defaultChronosMeetingProfiles,
  type ChronosApoloInvitee,
  type ChronosCreateMeetingInput,
  type ChronosGoogleCalendarStatus,
  type ChronosMeeting,
  type ChronosMeetingLocationMode,
  type ChronosMeetingProfile,
  type ChronosMeetingType,
  type ChronosMinutesProfile,
  type ChronosMinutesStatus,
  type ChronosRoom,
  type ChronosRoomInput,
  type ChronosRoomUpdateInput,
  type ChronosSnapshot,
} from "@/lib/chronos/types";
import type { ApoloDashboardData, ApoloEntity } from "@/lib/apolo/types";
import { getHubSupabaseClient } from "@/lib/supabase/client";
import { useAuth } from "@/providers/auth-provider";
import { Badge, Surface, Tooltip, WorkspaceLayout } from "@repo/uix";
import type { BadgeVariant } from "@repo/uix";
import {
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Download,
  FileText,
  ImagePlus,
  LayoutGrid,
  ListChecks,
  Loader2,
  MapPin,
  Mic,
  MonitorUp,
  PanelLeftClose,
  PanelLeftOpen,
  PlayCircle,
  Plus,
  Radio,
  RefreshCcw,
  Save,
  ScreenShare,
  ShieldCheck,
  Sparkles,
  Square,
  Search,
  Trash2,
  Upload,
  UsersRound,
  Video,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";

type ChronosView =
  | "agenda"
  | "rooms"
  | "drive";

type ChronosDriveView = "recordings" | "minutes";

type ChronosAgendaFilter = "all" | "today" | "live" | "review" | "followups";

type ChronosCalendarView = "day" | "week" | "month" | "year" | "list";
type ChronosRoomsTab = "profiles" | "rooms";
type ChronosApoloSearchState = "error" | "idle" | "loading" | "ready";

type ChronosRoomDraft = {
  backgroundDataUrl: string;
  backgroundName: string;
  capacity: string;
  minutesRequired: boolean;
  name: string;
  recordingRequired: boolean;
  roomType: string;
  slug: string;
  transcriptionRequired: boolean;
};

type LocalRecording = {
  blob?: Blob;
  downloadUrl?: string;
  durationSeconds: number;
  id: string;
  meetingId: string;
  mimeType?: string | null;
  name: string;
  transcribedAt?: string;
  url: string;
};

const chronosRoomBackgroundUploadLimitBytes = 5_000_000;

const emptySnapshot: ChronosSnapshot = {
  meetings: [],
  profiles: [...defaultChronosMeetingProfiles],
  rooms: [],
  storage: { status: "offline" },
};

const chronosNavigationItems: Array<{
  icon: LucideIcon;
  id: ChronosView;
  label: string;
}> = [
  { icon: CalendarDays, id: "agenda", label: "Agenda" },
  { icon: Video, id: "rooms", label: "Salas" },
  { icon: FileText, id: "drive", label: "Drive" },
];

const agendaFilterItems: Array<{
  id: ChronosAgendaFilter;
  label: string;
}> = [
  { id: "all", label: "Todas" },
  { id: "today", label: "Hoje" },
  { id: "live", label: "Ao vivo" },
  { id: "review", label: "Revisao" },
  { id: "followups", label: "Follow-ups" },
];

const statusVariant = {
  cancelled: "neutral",
  closed: "success",
  live: "danger",
  lobby: "info",
  review: "warning",
  scheduled: "neutral",
} as const satisfies Record<ChronosMeeting["status"], BadgeVariant>;

const minutesVariant = {
  approved: "success",
  draft: "neutral",
  in_review: "warning",
  not_started: "neutral",
  rejected: "danger",
} as const satisfies Record<ChronosMinutesStatus, BadgeVariant>;

export function ChronosPage() {
  const { hubUser } = useAuth();
  const canManageChronos = Boolean(
    hubUser?.permissions.includes("chronos:manage"),
  );
  const [snapshot, setSnapshot] = useState<ChronosSnapshot>(emptySnapshot);
  const [selectedMeetingId, setSelectedMeetingId] = useState("");
  const [activeView, setActiveView] = useState<ChronosView>("agenda");
  const [driveView, setDriveView] = useState<ChronosDriveView>("recordings");
  const [chronosSidebarCollapsed, setChronosSidebarCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localRecordings, setLocalRecordings] = useState<LocalRecording[]>([]);
  const selectedMeeting = useMemo(
    () =>
      snapshot.meetings.find((meeting) => meeting.id === selectedMeetingId) ??
      snapshot.meetings[0] ??
      null,
    [selectedMeetingId, snapshot.meetings],
  );
  const metrics = useMemo(
    () => buildChronosMetrics(snapshot.meetings),
    [snapshot.meetings],
  );

  const replaceMeeting = useCallback((meeting: ChronosMeeting) => {
    setSnapshot((currentSnapshot) => ({
      ...currentSnapshot,
      meetings: [
        meeting,
        ...currentSnapshot.meetings.filter(
          (currentMeeting) => currentMeeting.id !== meeting.id,
        ),
      ].sort((firstMeeting, secondMeeting) =>
        secondMeeting.updatedAt.localeCompare(firstMeeting.updatedAt),
      ),
    }));
    setSelectedMeetingId(meeting.id);
  }, []);

  const reloadChronos = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const nextSnapshot = await loadChronosSnapshot();

      setSnapshot(nextSnapshot);
      setSelectedMeetingId((currentId) => {
        if (nextSnapshot.meetings.some((meeting) => meeting.id === currentId)) {
          return currentId;
        }

        return nextSnapshot.meetings[0]?.id ?? "";
      });
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Nao foi possivel carregar o Chronos.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadChronos();
  }, [reloadChronos]);

  async function handleCreateMeeting(input: ChronosCreateMeetingInput) {
    if (!canManageChronos) {
      setError("Seu usuario pode visualizar o Chronos, mas nao gerenciar reunioes.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const meeting = await createChronosMeeting(input);

      replaceMeeting(meeting);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Nao foi possivel criar a reuniao.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateMeeting(
    input: Parameters<typeof updateChronosMeeting>[0],
  ) {
    if (!canManageChronos) {
      setError("Seu usuario pode visualizar o Chronos, mas nao gerenciar reunioes.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const meeting = await updateChronosMeeting(input);

      replaceMeeting(meeting);
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Nao foi possivel atualizar a reuniao.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateRoom(input: ChronosRoomInput) {
    if (!canManageChronos) {
      setError("Seu usuario pode visualizar o Chronos, mas nao gerenciar salas.");
      return null;
    }

    setSaving(true);
    setError(null);

    try {
      const room = await createChronosRoom(input);

      await reloadChronos();

      return room;
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Nao foi possivel criar a sala.",
      );
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateRoom(input: ChronosRoomUpdateInput) {
    if (!canManageChronos) {
      setError("Seu usuario pode visualizar o Chronos, mas nao gerenciar salas.");
      return null;
    }

    setSaving(true);
    setError(null);

    try {
      const room = await updateChronosRoom(input);

      await reloadChronos();

      return room;
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Nao foi possivel atualizar a sala.",
      );
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteRoom(roomId: string) {
    if (!canManageChronos) {
      setError("Seu usuario pode visualizar o Chronos, mas nao gerenciar salas.");
      return null;
    }

    setSaving(true);
    setError(null);

    try {
      const room = await deleteChronosRoom({ roomId });

      await reloadChronos();

      return room;
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Nao foi possivel excluir a sala.",
      );
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function handleGenerateMinutesDraft(
    meeting: ChronosMeeting,
    minutesProfile: ChronosMinutesProfile,
  ) {
    setSaving(true);
    setError(null);

    try {
      const updatedMeeting = await draftChronosMinutes({
        meetingId: meeting.id,
        minutesProfile,
      });

      replaceMeeting(updatedMeeting);
    } catch (minutesError) {
      setError(
        minutesError instanceof Error
          ? minutesError.message
          : "Nao foi possivel gerar a ata Chronos.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleTranscribeRecording(input: {
    file: Blob;
    fileName?: string;
    meeting: ChronosMeeting;
    recordingId?: string;
  }) {
    setSaving(true);
    setError(null);

    try {
      const updatedMeeting = await transcribeChronosRecording({
        file: input.file,
        fileName: input.fileName,
        meetingId: input.meeting.id,
        speakerLabel: "Athena",
      });

      replaceMeeting(updatedMeeting);

      if (input.recordingId) {
        const transcribedAt = new Date().toISOString();

        setLocalRecordings((currentRecordings) =>
          currentRecordings.map((recording) =>
            recording.id === input.recordingId
              ? { ...recording, transcribedAt }
              : recording,
          ),
        );
      }
    } catch (transcriptionError) {
      setError(
        transcriptionError instanceof Error
          ? transcriptionError.message
          : "Nao foi possivel transcrever a gravacao.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="h-[100dvh] max-h-[100dvh] overflow-hidden bg-[#f3f6fa] text-[#101820]">
      <div
        className={`grid h-full min-h-0 ${
          chronosSidebarCollapsed
            ? "lg:grid-cols-[4.5rem_minmax(0,1fr)]"
            : "lg:grid-cols-[16rem_minmax(0,1fr)]"
        }`}
      >
        <ChronosModuleSidebar
          activeView={activeView}
          collapsed={chronosSidebarCollapsed}
          onSelect={setActiveView}
          onToggleCollapsed={() =>
            setChronosSidebarCollapsed((currentValue) => !currentValue)
          }
        />
        <main className="min-h-0 min-w-0 overflow-y-auto p-3 lg:p-4">
          <WorkspaceLayout className="chronos-workspace">
            <section className="grid gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="m-0 text-xl font-semibold tracking-normal text-[#101820]">
              {activeView === "agenda"
                ? "Agenda"
                : activeView === "rooms"
                  ? "Salas"
                  : "Drive"}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Tooltip content="Recarregar Chronos">
              <button
                aria-label="Recarregar Chronos"
                className="grid h-9 w-9 place-items-center rounded-md border border-[#d9e0e7] bg-white text-[#526078] transition hover:bg-[#f8fafc] hover:text-[#101820] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                onClick={() => void reloadChronos()}
                type="button"
              >
                {loading ? (
                  <Loader2 aria-hidden="true" className="animate-spin" size={16} />
                ) : (
                  <RefreshCcw aria-hidden="true" size={16} />
                )}
              </button>
            </Tooltip>
          </div>
        </div>

        {error ? (
          <Surface bordered className="border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
            {error}
          </Surface>
        ) : null}

        {snapshot.storage.message ? (
          <Surface bordered className="border-[#d9e0e7] bg-[#fafbfc] p-3 text-xs font-semibold text-[#667085]">
            {snapshot.storage.message}
          </Surface>
        ) : null}

        {activeView !== "agenda" ? (
          <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <ChronosMetric icon={<CalendarClock size={17} />} label="reunioes" value={metrics.total} />
            <ChronosMetric icon={<Clock3 size={17} />} label="hoje" value={metrics.today} />
            <ChronosMetric icon={<Radio size={17} />} label="ao vivo" value={metrics.live} />
            <ChronosMetric icon={<ClipboardCheck size={17} />} label="revisao" value={metrics.minutesReview} />
            <ChronosMetric icon={<FileText size={17} />} label="atas pend." value={metrics.minutesPending} />
            <ChronosMetric icon={<ListChecks size={17} />} label="follow-ups" value={metrics.followUpsOpen} />
          </section>
        ) : null}

        {activeView === "agenda" ? (
          <ChronosAgendaScreen
            canManage={canManageChronos}
            meetings={snapshot.meetings}
            onCreate={handleCreateMeeting}
            onRefresh={reloadChronos}
            onSelectMeeting={setSelectedMeetingId}
            profiles={snapshot.profiles}
            rooms={snapshot.rooms}
            saving={saving}
            selectedMeetingId={selectedMeeting?.id ?? ""}
          />
        ) : null}

        {activeView === "rooms" ? (
          <ChronosRoomsManagementScreen
            meetings={snapshot.meetings}
            onCreateRoom={handleCreateRoom}
            onDeleteRoom={handleDeleteRoom}
            onUpdateRoom={handleUpdateRoom}
            profiles={snapshot.profiles}
            rooms={snapshot.rooms}
            saving={saving}
          />
        ) : null}

        {activeView === "drive" ? (
          <ChronosDriveLibraryScreen
            activeDriveView={driveView}
            localRecordings={localRecordings}
            meeting={selectedMeeting}
            meetings={snapshot.meetings}
            onChangeDriveView={setDriveView}
            onGenerateMinutesDraft={handleGenerateMinutesDraft}
            onSelectMeeting={setSelectedMeetingId}
            onTranscribeRecording={handleTranscribeRecording}
            onUpdate={handleUpdateMeeting}
            rooms={snapshot.rooms}
            saving={saving}
            userName={hubUser?.name ?? "Lucas"}
          />
        ) : null}
            </section>
          </WorkspaceLayout>
        </main>
      </div>
    </div>
  );
}

function ChronosModuleSidebar({
  activeView,
  collapsed,
  onSelect,
  onToggleCollapsed,
}: {
  activeView: ChronosView;
  collapsed: boolean;
  onSelect: (view: ChronosView) => void;
  onToggleCollapsed: () => void;
}) {
  function handleOpenModuleLauncher() {
    window.dispatchEvent(new Event("careli:toggle-module-launcher"));
  }

  return (
    <aside className="panteon-module-sidebar flex h-full min-h-0 flex-col overflow-hidden border-r text-[#ECECF1]">
      <div className="panteon-module-sidebar__top">
        {collapsed ? (
          <div className="grid justify-items-center gap-2 pb-1 pt-0.5">
            <span className="grid h-10 w-10 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.035] text-[#d5dde8]">
              <CalendarClock aria-hidden="true" size={18} />
            </span>
            <Tooltip content="Abrir sidebar do Panteon" placement="right">
              <button
                aria-label="Abrir sidebar do Panteon"
                className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.075] text-[#a5afbd] outline-none transition hover:border-white/[0.16] hover:bg-white/[0.07] hover:text-white focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                onClick={handleOpenModuleLauncher}
                type="button"
              >
                <LayoutGrid aria-hidden="true" size={15} />
              </button>
            </Tooltip>
            <Tooltip content="Expandir Chronos" placement="right">
              <button
                aria-label="Expandir sidebar Chronos"
                className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.075] text-[#a5afbd] outline-none transition hover:border-white/[0.16] hover:bg-white/[0.07] hover:text-white focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                onClick={onToggleCollapsed}
                type="button"
              >
                <PanelLeftOpen aria-hidden="true" size={16} />
              </button>
            </Tooltip>
          </div>
        ) : (
          <div className="grid min-h-12 grid-cols-[minmax(0,1fr)_2rem_2rem] items-center gap-2 rounded-xl bg-white/[0.035] px-2.5 py-2">
            <div className="flex min-w-0 items-center gap-2.5 text-[#d5dde8]">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/[0.08] bg-[#101820]">
                <CalendarClock aria-hidden="true" size={18} />
              </span>
              <span className="grid min-w-0 gap-0.5">
                <span className="min-w-0 truncate text-sm font-semibold leading-tight text-white">
                  Chronos
                </span>
              </span>
            </div>
            <Tooltip content="Abrir sidebar do Panteon" placement="right">
              <button
                aria-label="Abrir sidebar do Panteon"
                className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.075] text-[#a5afbd] outline-none transition hover:border-white/[0.16] hover:bg-white/[0.07] hover:text-white focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                onClick={handleOpenModuleLauncher}
                type="button"
              >
                <LayoutGrid aria-hidden="true" size={15} />
              </button>
            </Tooltip>
            <Tooltip content="Recolher Chronos" placement="right">
              <button
                aria-label="Recolher sidebar Chronos"
                className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.075] text-[#a5afbd] outline-none transition hover:border-white/[0.16] hover:bg-white/[0.07] hover:text-white focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                onClick={onToggleCollapsed}
                type="button"
              >
                <PanelLeftClose aria-hidden="true" size={16} />
              </button>
            </Tooltip>
          </div>
        )}
      </div>

      <nav
        aria-label="Menu Chronos"
        className={`min-h-0 flex-1 overflow-y-auto py-3 ${
          collapsed ? "px-2" : "px-3"
        }`}
      >
        <div className="grid gap-1">
          {chronosNavigationItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            const button = (
              <button
                aria-current={isActive ? "page" : undefined}
                aria-label={collapsed ? item.label : undefined}
                className={`group relative flex h-10 w-full items-center gap-2 rounded-md px-2 text-left text-sm font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-[#A07C3B] ${
                  isActive
                    ? "bg-[#2A2B32] text-white shadow-[inset_0_0_0_1px_rgb(160_124_59_/_0.22)]"
                    : "text-[#ECECF1]/80 hover:bg-[#3f4048] hover:text-white"
                } ${collapsed ? "justify-center" : ""}`}
                onClick={() => onSelect(item.id)}
                type="button"
              >
                {isActive ? (
                  <span
                    aria-hidden="true"
                    className="absolute left-0 top-1.5 h-7 w-0.5 rounded-full bg-[#A07C3B]"
                  />
                ) : null}
                <span
                  className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
                    isActive
                      ? "panteon-module-sidebar__active-icon"
                      : "text-[#8E8EA0]"
                  }`}
                >
                  <Icon
                    aria-hidden="true"
                    className="size-[17px] stroke-[1.75]"
                  />
                </span>
                <span className={`min-w-0 truncate ${collapsed ? "sr-only" : ""}`}>
                  {item.label}
                </span>
              </button>
            );

            return collapsed ? (
              <Tooltip content={item.label} key={item.id} placement="right">
                {button}
              </Tooltip>
            ) : (
              <div key={item.id}>{button}</div>
            );
          })}
        </div>
      </nav>

      <div className={`pb-5 pt-4 ${collapsed ? "px-3" : "px-6"}`}>
        <p
          className={`truncate text-xs font-medium uppercase tracking-[0.16em] text-[#8E8EA0] transition-opacity duration-200 ${
            collapsed ? "opacity-0" : "opacity-100"
          }`}
        >
          Enterprise
        </p>
      </div>
    </aside>
  );
}

function ChronosDrivePanel({
  activeDriveView,
  children,
  onChangeDriveView,
}: {
  activeDriveView: ChronosDriveView;
  children: ReactNode;
  onChangeDriveView: (view: ChronosDriveView) => void;
}) {
  const tabs: Array<{
    icon: typeof Radio;
    id: ChronosDriveView;
    label: string;
  }> = [
    { icon: Radio, id: "recordings", label: "Gravacoes" },
    { icon: ClipboardCheck, id: "minutes", label: "Atas" },
  ];

  return (
    <div className="grid min-h-full grid-rows-[auto_minmax(0,1fr)] gap-3">
      <Surface bordered className="border-[#d9e0e7] bg-white p-2">
        <div className="flex gap-1 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeDriveView === tab.id;

            return (
              <button
                aria-pressed={isActive}
                className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-semibold transition ${
                  isActive
                    ? "bg-[#101820] text-white"
                    : "text-[#667085] hover:bg-[#f5f7fa] hover:text-[#101820]"
                }`}
                key={tab.id}
                onClick={() => onChangeDriveView(tab.id)}
                type="button"
              >
                <Icon aria-hidden="true" size={15} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </Surface>
      <div className="min-h-0">{children}</div>
    </div>
  );
}

function ChronosMetric({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: number;
}) {
  return (
    <Surface bordered className="grid min-h-20 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 border-[#d9e0e7] bg-white p-3">
      <span className="grid h-9 w-9 place-items-center rounded-md bg-[#101820] text-white">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-xl font-semibold text-[#101820]">
          {value}
        </span>
        <span className="block truncate text-xs font-semibold uppercase text-[#667085]">
          {label}
        </span>
      </span>
    </Surface>
  );
}

export function ChronosMeetingColumn({
  agendaFilter,
  canManage,
  meetings,
  onCreate,
  onFilterChange,
  onSelect,
  rooms,
  saving,
  selectedMeetingId,
}: {
  agendaFilter: ChronosAgendaFilter;
  canManage: boolean;
  meetings: ChronosMeeting[];
  onCreate: (input: ChronosCreateMeetingInput) => Promise<void>;
  onFilterChange: (filter: ChronosAgendaFilter) => void;
  onSelect: (meetingId: string) => void;
  rooms: ChronosRoom[];
  saving: boolean;
  selectedMeetingId: string;
}) {
  const [formOpen, setFormOpen] = useState(meetings.length === 0);
  const filteredMeetings = useMemo(
    () => filterChronosMeetings(meetings, agendaFilter),
    [agendaFilter, meetings],
  );

  useEffect(() => {
    if (meetings.length === 0) {
      setFormOpen(true);
    }
  }, [meetings.length]);

  return (
    <Surface bordered className="flex min-h-0 flex-col border-[#d9e0e7] bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-[#edf0f4] p-3">
        <PanelTitle eyebrow="Agenda" title="Reunioes" />
        <Tooltip content="Nova reuniao">
          <button
            aria-expanded={formOpen}
            aria-label="Nova reuniao"
            className="grid h-8 w-8 place-items-center rounded-md border border-[#d9e0e7] bg-white text-[#526078] transition hover:bg-[#f8fafc] hover:text-[#101820] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
            disabled={!canManage}
            onClick={() => setFormOpen((currentValue) => !currentValue)}
            type="button"
          >
            <Plus aria-hidden="true" size={16} />
          </button>
        </Tooltip>
      </div>
      {formOpen && canManage ? (
        <NewMeetingForm
          onCreate={async (input) => {
            await onCreate(input);
            setFormOpen(false);
          }}
          rooms={rooms}
          saving={saving}
        />
      ) : null}
      <div className="flex gap-1 overflow-x-auto border-b border-[#edf0f4] bg-white p-2">
        {agendaFilterItems.map((item) => (
          <button
            aria-pressed={agendaFilter === item.id}
            className={`h-8 shrink-0 rounded-md px-2.5 text-xs font-bold transition ${
              agendaFilter === item.id
                ? "bg-[#101820] text-white"
                : "bg-[#f5f7fa] text-[#667085] hover:bg-[#edf0f4] hover:text-[#101820]"
            }`}
            key={item.id}
            onClick={() => onFilterChange(item.id)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {filteredMeetings.map((meeting) => {
          const openFollowUps = countOpenFollowUps(meeting);

          return (
            <button
              className={`mb-2 grid w-full gap-2 rounded-md border p-3 text-left transition ${
                meeting.id === selectedMeetingId
                  ? "border-[#A07C3B] bg-[#fffaf0]"
                  : "border-[#edf0f4] bg-[#fafbfc] hover:border-[#d9e0e7] hover:bg-white"
              }`}
              key={meeting.id}
              onClick={() => onSelect(meeting.id)}
              type="button"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold text-[#101820]">
                  {meeting.title}
                </span>
                <Badge variant={statusVariant[meeting.status]}>
                  {chronosMeetingStatusLabels[meeting.status]}
                </Badge>
              </span>
              <span className="flex items-center gap-2 text-xs text-[#667085]">
                <span className="font-semibold">{meeting.protocol}</span>
                <span>/</span>
                <span>{chronosMeetingTypeLabels[meeting.meetingType]}</span>
              </span>
              <span className="flex items-center gap-2 text-xs text-[#667085]">
                <CalendarClock aria-hidden="true" size={13} />
                <span className="truncate">
                  {formatDateTime(meeting.startsAt)}
                </span>
              </span>
              <span className="truncate text-xs text-[#667085]">
                {meeting.room?.name ?? "Sala pendente"}
              </span>
              <span className="flex flex-wrap gap-1">
                <Badge variant={minutesVariant[meeting.minutesStatus]}>
                  {chronosMinutesStatusLabels[meeting.minutesStatus]}
                </Badge>
                {openFollowUps > 0 ? (
                  <Badge variant="warning">{openFollowUps} follow-up</Badge>
                ) : null}
                {meeting.recordingStatus === "available" ? (
                  <Badge variant="success">gravada</Badge>
                ) : null}
              </span>
            </button>
          );
        })}
        {meetings.length === 0 ? (
          <div className="rounded-md border border-dashed border-[#d9e0e7] bg-[#fafbfc] p-4 text-sm text-[#667085]">
            Nenhuma reuniao formal registrada.
          </div>
        ) : null}
        {meetings.length > 0 && filteredMeetings.length === 0 ? (
          <div className="rounded-md border border-dashed border-[#d9e0e7] bg-[#fafbfc] p-4 text-sm text-[#667085]">
            Nenhuma reuniao neste filtro.
          </div>
        ) : null}
      </div>
    </Surface>
  );
}

function NewMeetingForm({
  onCreate,
  rooms,
  saving,
}: {
  onCreate: (input: ChronosCreateMeetingInput) => Promise<void>;
  rooms: ChronosRoom[];
  saving: boolean;
}) {
  const [title, setTitle] = useState("");
  const [meetingType, setMeetingType] =
    useState<ChronosMeetingType>("executive");
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? "");
  const [startsAt, setStartsAt] = useState("");
  const [objective, setObjective] = useState("");
  const [externalReference, setExternalReference] = useState("");
  const [participants, setParticipants] = useState("");
  const [agenda, setAgenda] = useState("");

  useEffect(() => {
    setRoomId((currentRoomId) => currentRoomId || rooms[0]?.id || "");
  }, [rooms]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await onCreate({
      agenda: parseLines(agenda),
      externalReference,
      meetingType,
      objective,
      participants: parseParticipants(participants),
      roomId,
      startsAt,
      title,
    });
    setTitle("");
    setObjective("");
    setExternalReference("");
    setParticipants("");
    setAgenda("");
  }

  return (
    <form className="grid gap-2 border-b border-[#edf0f4] bg-[#fafbfc] p-3" onSubmit={handleSubmit}>
      <input
        className="h-9 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm outline-none focus:border-[#A07C3B] focus:ring-2 focus:ring-[#A07C3B]/20"
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Titulo"
        required
        value={title}
      />
      <div className="grid grid-cols-2 gap-2">
        <select
          className="h-9 rounded-md border border-[#d9e0e7] bg-white px-2 text-sm outline-none focus:border-[#A07C3B]"
          onChange={(event) =>
            setMeetingType(event.target.value as ChronosMeetingType)
          }
          value={meetingType}
        >
          {chronosMeetingTypes.map((type) => (
            <option key={type} value={type}>
              {chronosMeetingTypeLabels[type]}
            </option>
          ))}
        </select>
        <select
          className="h-9 rounded-md border border-[#d9e0e7] bg-white px-2 text-sm outline-none focus:border-[#A07C3B]"
          onChange={(event) => setRoomId(event.target.value)}
          value={roomId}
        >
          {rooms.map((room) => (
            <option key={room.id} value={room.id}>
              {room.name}
            </option>
          ))}
        </select>
      </div>
      <input
        className="h-9 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm outline-none focus:border-[#A07C3B] focus:ring-2 focus:ring-[#A07C3B]/20"
        onChange={(event) => setStartsAt(event.target.value)}
        type="datetime-local"
        value={startsAt}
      />
      <input
        className="h-9 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm outline-none focus:border-[#A07C3B] focus:ring-2 focus:ring-[#A07C3B]/20"
        onChange={(event) => setExternalReference(event.target.value)}
        placeholder="Referencia externa"
        value={externalReference}
      />
      <textarea
        className="min-h-20 resize-none rounded-md border border-[#d9e0e7] bg-white p-3 text-sm outline-none focus:border-[#A07C3B] focus:ring-2 focus:ring-[#A07C3B]/20"
        onChange={(event) => setObjective(event.target.value)}
        placeholder="Objetivo"
        value={objective}
      />
      <textarea
        className="min-h-20 resize-none rounded-md border border-[#d9e0e7] bg-white p-3 text-sm outline-none focus:border-[#A07C3B] focus:ring-2 focus:ring-[#A07C3B]/20"
        onChange={(event) => setParticipants(event.target.value)}
        placeholder="Participantes: nome | email | organizacao"
        value={participants}
      />
      <textarea
        className="min-h-20 resize-none rounded-md border border-[#d9e0e7] bg-white p-3 text-sm outline-none focus:border-[#A07C3B] focus:ring-2 focus:ring-[#A07C3B]/20"
        onChange={(event) => setAgenda(event.target.value)}
        placeholder="Pauta"
        value={agenda}
      />
      <button
        className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[#101820] px-3 text-sm font-semibold text-white transition hover:bg-[#1f2937] disabled:cursor-wait disabled:opacity-60"
        disabled={saving}
        type="submit"
      >
        {saving ? (
          <Loader2 aria-hidden="true" className="animate-spin" size={15} />
        ) : (
          <Save aria-hidden="true" size={15} />
        )}
        Salvar
      </button>
    </form>
  );
}

function ExecutiveRoomPanel({
  meeting,
  onLocalRecording,
  onUpdate,
  saving,
}: {
  meeting: ChronosMeeting | null;
  onLocalRecording: (recording: LocalRecording) => void;
  onUpdate: (input: Parameters<typeof updateChronosMeeting>[0]) => Promise<void>;
  saving: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef<number>(0);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingActive, setRecordingActive] = useState(false);
  const activeStream = screenStream ?? cameraStream;

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = activeStream;
    }
  }, [activeStream]);

  useEffect(() => () => stopStream(cameraStream), [cameraStream]);
  useEffect(() => () => stopStream(screenStream), [screenStream]);

  useEffect(() => {
    if (!recordingActive) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setRecordingSeconds(
        Math.max(0, Math.floor((Date.now() - recordingStartedAtRef.current) / 1000)),
      );
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [recordingActive]);

  async function startCamera() {
    setMediaError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });

      setCameraStream(stream);
    } catch {
      setMediaError("Camera ou microfone indisponivel.");
    }
  }

  async function startScreenShare() {
    setMediaError(null);

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: true,
      });

      setScreenStream(stream);
      if (meeting) {
        await onUpdate({
          action: "add_timeline_event",
          eventType: "screen_shared",
          meetingId: meeting.id,
          title: "Compartilhamento de tela iniciado",
        });
      }
    } catch {
      setMediaError("Compartilhamento de tela nao iniciado.");
    }
  }

  async function startRecording() {
    if (!meeting || !activeStream) {
      setMediaError("Ative camera ou tela antes de gravar.");
      return;
    }

    if (typeof MediaRecorder === "undefined") {
      setMediaError("Gravacao indisponivel neste navegador.");
      return;
    }

    recordingChunksRef.current = [];
    const mimeType = getSupportedRecordingMimeType();
    const recorder = mimeType
      ? new MediaRecorder(activeStream, { mimeType })
      : new MediaRecorder(activeStream);

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordingChunksRef.current.push(event.data);
      }
    };
    recorder.onstop = () => {
      const blob = new Blob(recordingChunksRef.current, {
        type: recorder.mimeType || "video/webm",
      });
      const url = URL.createObjectURL(blob);
      const durationSeconds = Math.max(
        1,
        Math.floor((Date.now() - recordingStartedAtRef.current) / 1000),
      );

      onLocalRecording({
        blob,
        downloadUrl: url,
        durationSeconds,
        id: `local-recording-${Date.now().toString(36)}`,
        meetingId: meeting.id,
        mimeType: blob.type,
        name: `${meeting.protocol}.webm`,
        url,
      });
      void onUpdate({
        action: "mark_recording",
        durationSeconds,
        meetingId: meeting.id,
        status: "available",
      });
    };
    mediaRecorderRef.current = recorder;
    recordingStartedAtRef.current = Date.now();
    setRecordingSeconds(0);
    setRecordingActive(true);
    recorder.start(1000);
    await onUpdate({
      action: "mark_recording",
      meetingId: meeting.id,
      status: "recording",
    });
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setRecordingActive(false);
  }

  function stopAllMedia() {
    stopStream(cameraStream);
    stopStream(screenStream);
    setCameraStream(null);
    setScreenStream(null);
  }

  return (
    <Surface bordered className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] border-[#d9e0e7] bg-[#101820] text-white">
      <div className="flex items-start justify-between gap-3 border-b border-white/[0.08] p-4">
        <PanelTitle
          dark
          eyebrow={meeting?.protocol ?? "Chronos"}
          title={meeting?.title ?? "Sala executiva"}
        />
        {meeting ? (
          <Badge variant={statusVariant[meeting.status]}>
            {chronosMeetingStatusLabels[meeting.status]}
          </Badge>
        ) : null}
      </div>
      <div className="grid min-h-0 gap-3 p-4">
        <div className="relative grid min-h-[23rem] place-items-center overflow-hidden rounded-md border border-white/[0.08] bg-[#161d27]">
          {activeStream ? (
            <video
              autoPlay
              className="h-full max-h-[31rem] w-full object-contain"
              muted
              playsInline
              ref={videoRef}
            />
          ) : (
            <div className="grid justify-items-center gap-3 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-md border border-white/[0.08] bg-white/[0.05] text-[#D6B56F]">
                <Video aria-hidden="true" size={28} />
              </span>
              <span className="text-sm font-semibold text-[#d7dee8]">
                {meeting ? "Entrada da reuniao" : "Selecione uma reuniao"}
              </span>
            </div>
          )}
          {recordingActive ? (
            <span className="absolute right-3 top-3 inline-flex items-center gap-2 rounded-full bg-red-600 px-3 py-1 text-xs font-bold text-white">
              <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
              {formatDuration(recordingSeconds)}
            </span>
          ) : null}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <ParticipantMiniPanel meeting={meeting} />
          <RoomProtocolPanel meeting={meeting} />
          <CaptureStatusPanel meeting={meeting} />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.08] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <RoomButton
            disabled={!meeting}
            icon={<Video size={16} />}
            label="Camera"
            onClick={() => void startCamera()}
          />
          <RoomButton
            disabled={!meeting}
            icon={<ScreenShare size={16} />}
            label="Tela"
            onClick={() => void startScreenShare()}
          />
          <RoomButton
            disabled={!meeting || !activeStream || recordingActive || saving}
            icon={<Radio size={16} />}
            label="Gravar"
            onClick={() => void startRecording()}
          />
          <RoomButton
            disabled={!recordingActive}
            icon={<Square size={15} />}
            label="Parar"
            onClick={stopRecording}
          />
          <RoomButton
            disabled={!cameraStream && !screenStream}
            icon={<MonitorUp size={16} />}
            label="Encerrar midia"
            onClick={stopAllMedia}
          />
        </div>
        {mediaError ? (
          <span className="inline-flex items-center gap-2 text-xs font-semibold text-amber-200">
            <AlertTriangle aria-hidden="true" size={14} />
            {mediaError}
          </span>
        ) : null}
      </div>
    </Surface>
  );
}

export function ChronosPrimaryPanel({
  activeView,
  driveView,
  localRecordings,
  meeting,
  onDriveViewChange,
  onGenerateMinutesDraft,
  onLocalRecording,
  onSelectMeeting,
  onTranscribeRecording,
  onUpdate,
  meetings,
  saving,
}: {
  activeView: ChronosView;
  driveView: ChronosDriveView;
  localRecordings: LocalRecording[];
  meeting: ChronosMeeting | null;
  onDriveViewChange: (view: ChronosDriveView) => void;
  onGenerateMinutesDraft: (
    meeting: ChronosMeeting,
    minutesProfile: ChronosMinutesProfile,
  ) => Promise<void>;
  onLocalRecording: (recording: LocalRecording) => void;
  onSelectMeeting: (meetingId: string) => void;
  onTranscribeRecording: (input: {
    file: Blob;
    fileName?: string;
    meeting: ChronosMeeting;
    recordingId?: string;
  }) => Promise<void>;
  onUpdate: (input: Parameters<typeof updateChronosMeeting>[0]) => Promise<void>;
  meetings: ChronosMeeting[];
  saving: boolean;
}) {
  if (activeView === "agenda") {
    return (
      <ChronosAgendaScreen
        canManage={false}
        meetings={meetings}
        onCreate={async () => undefined}
        onRefresh={async () => undefined}
        onSelectMeeting={onSelectMeeting}
        profiles={[...defaultChronosMeetingProfiles]}
        rooms={[]}
        saving={false}
        selectedMeetingId={meeting?.id ?? ""}
      />
    );
  }

  if (!meeting) {
    return (
      <Surface bordered className="grid min-h-full place-items-center border-[#d9e0e7] bg-white p-5 text-sm text-[#667085]">
        Selecione ou crie uma reuniao Chronos.
      </Surface>
    );
  }

  if (activeView === "rooms") {
    return (
      <ExecutiveRoomPanel
        meeting={meeting}
        onLocalRecording={onLocalRecording}
        onUpdate={onUpdate}
        saving={saving}
      />
    );
  }

  if (activeView === "drive" && driveView === "recordings") {
    return (
      <ChronosDrivePanel
        activeDriveView={driveView}
        onChangeDriveView={onDriveViewChange}
      >
        <RecordingsPanel
          localRecordings={localRecordings}
          meeting={meeting}
          onTranscribeRecording={onTranscribeRecording}
          saving={saving}
        />
      </ChronosDrivePanel>
    );
  }

  return (
    <ChronosDrivePanel
      activeDriveView={driveView}
      onChangeDriveView={onDriveViewChange}
    >
      <MinutesPanel
        meeting={meeting}
        onGenerateMinutesDraft={onGenerateMinutesDraft}
        onUpdate={onUpdate}
        saving={saving}
      />
    </ChronosDrivePanel>
  );
}

export function ChronosDetailPanel({
  activeView,
  driveView,
  meeting,
  onUpdate,
  rooms,
  saving,
  userName,
}: {
  activeView: ChronosView;
  driveView: ChronosDriveView;
  meeting: ChronosMeeting | null;
  onUpdate: (input: Parameters<typeof updateChronosMeeting>[0]) => Promise<void>;
  rooms: ChronosRoom[];
  saving: boolean;
  userName: string;
}) {
  if (!meeting) {
    return (
      <Surface bordered className="grid min-h-full place-items-center border-[#d9e0e7] bg-white p-5 text-sm text-[#667085]">
        Selecione uma reuniao para ver os detalhes.
      </Surface>
    );
  }

  if (activeView === "rooms") {
    return <RoomsPanel rooms={rooms} selectedRoomId={meeting.roomId} />;
  }

  if (activeView === "drive" && driveView === "recordings") {
    return <RecordingContextPanel meeting={meeting} />;
  }

  if (activeView === "drive" && driveView === "minutes") {
    return (
      <TranscriptPanel
        meeting={meeting}
        onUpdate={onUpdate}
        saving={saving}
        userName={userName}
      />
    );
  }

  return (
    <Surface bordered className="grid min-h-full grid-rows-[auto_minmax(0,1fr)] border-[#d9e0e7] bg-white">
      <div className="flex items-start justify-between gap-3 border-b border-[#edf0f4] p-4">
        <PanelTitle eyebrow="Dossie" title="Reuniao formal" />
        <Badge variant={minutesVariant[meeting.minutesStatus]}>
          {chronosMinutesStatusLabels[meeting.minutesStatus]}
        </Badge>
      </div>
      <div className="min-h-0 overflow-y-auto p-4">
        <MeetingOverview meeting={meeting} onUpdate={onUpdate} saving={saving} />
      </div>
    </Surface>
  );
}

function ChronosAgendaScreen({
  canManage,
  meetings,
  onCreate,
  onRefresh,
  onSelectMeeting,
  profiles,
  rooms,
  saving,
  selectedMeetingId,
}: {
  canManage: boolean;
  meetings: ChronosMeeting[];
  onCreate: (input: ChronosCreateMeetingInput) => Promise<void>;
  onRefresh: () => Promise<void>;
  onSelectMeeting: (meetingId: string) => void;
  profiles: ChronosMeetingProfile[];
  rooms: ChronosRoom[];
  saving: boolean;
  selectedMeetingId: string;
}) {
  const [calendarView, setCalendarView] =
    useState<ChronosCalendarView>("week");
  const [cursorDate, setCursorDate] = useState(() => startOfDay(new Date()));
  const [draftStartsAt, setDraftStartsAt] = useState<string | null>(null);
  const [googleCalendarStatus, setGoogleCalendarStatus] =
    useState<ChronosGoogleCalendarStatus | null>(null);
  const [googleCalendarError, setGoogleCalendarError] = useState<string | null>(
    null,
  );
  const [googleCalendarConnecting, setGoogleCalendarConnecting] =
    useState(false);
  const [googleCalendarSyncing, setGoogleCalendarSyncing] = useState(false);
  const sortedMeetings = useMemo(() => sortMeetingsByDate(meetings), [meetings]);
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

  const handleGoogleCalendarSync = useCallback(async () => {
    setGoogleCalendarSyncing(true);
    setGoogleCalendarError(null);

    try {
      await syncChronosGoogleCalendar("both", { full: true });
      await Promise.all([refreshGoogleCalendarStatus(), onRefresh()]);
    } catch (error) {
      setGoogleCalendarError(
        error instanceof Error
          ? error.message
          : "Nao foi possivel sincronizar Google Agenda.",
      );
    } finally {
      setGoogleCalendarSyncing(false);
    }
  }, [onRefresh, refreshGoogleCalendarStatus]);

  const handleGoogleCalendarConnect = useCallback(async () => {
    setGoogleCalendarConnecting(true);
    setGoogleCalendarError(null);

    try {
      const authorizationUrl =
        await startChronosGoogleCalendarConnection("/chronos");

      window.location.assign(authorizationUrl);
    } catch (error) {
      setGoogleCalendarError(
        error instanceof Error
          ? error.message
          : "Nao foi possivel conectar o Google.",
      );
      setGoogleCalendarConnecting(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function loadGoogleCalendarStatus() {
      try {
        const status = await loadChronosGoogleCalendarStatus();

        if (active) {
          setGoogleCalendarStatus(status);
          setGoogleCalendarError(null);
        }
      } catch (error) {
        if (active) {
          setGoogleCalendarStatus(null);
          setGoogleCalendarError(
            error instanceof Error
              ? error.message
              : "Nao foi possivel verificar o Google Agenda.",
          );
        }
      }
    }

    void loadGoogleCalendarStatus();

    return () => {
      active = false;
    };
  }, []);

  return (
    <Surface bordered className="relative grid min-h-[45rem] grid-rows-[auto_minmax(0,1fr)] overflow-hidden border-[#d9e0e7] bg-white">
      <div className="grid gap-3 border-b border-[#edf0f4] p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="m-0 text-base font-semibold text-[#101820]">Agenda</h2>
          <div className="flex flex-wrap items-center gap-2">
            <button
              aria-label={
                googleCalendarStatus?.connection.connected
                  ? "Google conectado"
                  : "Conectar Google"
              }
              className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-55 ${
                googleCalendarStatus?.connection.connected
                  ? "border-[#d6eadf] bg-[#f1fbf5] text-[#067647] hover:bg-[#e7f8ef]"
                  : "border-[#d9e0e7] bg-white text-[#101820] hover:bg-[#f8fafc]"
              }`}
              disabled={
                googleCalendarConnecting ||
                !googleCalendarStatus?.configured ||
                !googleCalendarStatus.connection.storageReady
              }
              onClick={handleGoogleCalendarConnect}
              type="button"
            >
              <GoogleGlyph connected={googleCalendarStatus?.connection.connected} />
              {googleCalendarConnecting ? "Abrindo..." : "Google"}
            </button>
            <button
              className="inline-flex h-9 items-center gap-2 rounded-md bg-[#101820] px-3 text-sm font-semibold text-white transition hover:bg-[#1f2937] disabled:cursor-not-allowed disabled:opacity-55"
              disabled={!canManage}
              onClick={() => openEventDraft(roundDateToNextHour(new Date()))}
              type="button"
            >
              <Plus aria-hidden="true" size={15} />
              Criar evento
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
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
        </div>
      </div>

      <div className="grid min-h-0 grid-cols-[16rem_minmax(0,1fr)] max-xl:grid-cols-1">
        <aside className="min-h-0 border-r border-[#edf0f4] bg-[#fafbfc] p-3 max-xl:hidden">
          <MiniCalendar
            cursorDate={cursorDate}
            meetings={sortedMeetings}
            onSelectDate={(date) => setCursorDate(date)}
          />
          <div className="mt-4 grid gap-2">
            <p className="m-0 text-xs font-bold uppercase text-[#667085]">
              Fonte atual
            </p>
            <ChronosGoogleCalendarReadiness
              connecting={googleCalendarConnecting}
              error={googleCalendarError}
              onConnect={handleGoogleCalendarConnect}
              onRefresh={refreshGoogleCalendarStatus}
              onSync={handleGoogleCalendarSync}
              status={googleCalendarStatus}
              syncing={googleCalendarSyncing}
            />
          </div>
        </aside>

        <div className="min-h-0 overflow-auto">
          <ChronosCalendarCanvas
            cursorDate={cursorDate}
            meetings={sortedMeetings}
            onCreateAt={openEventDraft}
            onSelectMeeting={onSelectMeeting}
            rooms={rooms}
            selectedMeetingId={selectedMeetingId}
            view={calendarView}
          />
        </div>
      </div>

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

function ChronosCalendarEventPopup({
  initialStartsAt,
  onCancel,
  onCreate,
  profiles,
  rooms,
  saving,
}: {
  initialStartsAt: string;
  onCancel: () => void;
  onCreate: (input: ChronosCreateMeetingInput) => Promise<void>;
  profiles: ChronosMeetingProfile[];
  rooms: ChronosRoom[];
  saving: boolean;
}) {
  const activeProfiles = useMemo(
    () => profiles.filter((profile) => profile.status === "active"),
    [profiles],
  );
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState(initialStartsAt);
  const [endsAt, setEndsAt] = useState(() =>
    addMinutesToDateTimeLocal(initialStartsAt, 60),
  );
  const [profileId, setProfileId] = useState(
    activeProfiles[0]?.id ?? "external",
  );
  const [locationMode, setLocationMode] =
    useState<ChronosMeetingLocationMode>("online");
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? "");
  const [locationAddress, setLocationAddress] = useState("");
  const [objective, setObjective] = useState("");
  const [agenda, setAgenda] = useState("");
  const [contactQuery, setContactQuery] = useState("");
  const [contactOptions, setContactOptions] = useState<ChronosApoloInvitee[]>(
    [],
  );
  const [selectedInvitees, setSelectedInvitees] = useState<
    ChronosApoloInvitee[]
  >([]);
  const [contactSearchStatus, setContactSearchStatus] =
    useState<ChronosApoloSearchState>("idle");
  const [contactSearchError, setContactSearchError] = useState<string | null>(
    null,
  );
  const selectedProfile =
    activeProfiles.find((profile) => profile.id === profileId) ??
    activeProfiles[0] ??
    defaultChronosMeetingProfiles[0];
  const eventKinds = ["Evento", "Tarefa", "Ausente", "Agendamento"];

  useEffect(() => {
    setStartsAt(initialStartsAt);
    setEndsAt(addMinutesToDateTimeLocal(initialStartsAt, 60));
  }, [initialStartsAt]);

  useEffect(() => {
    setRoomId((currentRoomId) => currentRoomId || rooms[0]?.id || "");
  }, [rooms]);

  useEffect(() => {
    setProfileId((currentProfileId) =>
      activeProfiles.some((profile) => profile.id === currentProfileId)
        ? currentProfileId
        : activeProfiles[0]?.id ?? "external",
    );
  }, [activeProfiles]);

  useEffect(() => {
    const normalizedQuery = contactQuery.trim();

    if (normalizedQuery.length < 2) {
      setContactOptions([]);
      setContactSearchError(null);
      setContactSearchStatus("idle");
      return;
    }

    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void searchApoloInvitees();
    }, 240);

    async function searchApoloInvitees() {
      try {
        setContactSearchStatus("loading");
        setContactSearchError(null);

        const accessToken = await getChronosApoloAccessToken();
        const params = new URLSearchParams({
          limit: "8",
          q: normalizedQuery,
        });
        const response = await fetch(
          `/api/apolo/relationships?${params.toString()}`,
          {
            cache: "no-store",
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
            signal: controller.signal,
          },
        );
        const payload = (await response.json().catch(() => null)) as
          | { data?: ApoloDashboardData; error?: string }
          | null;

        if (!response.ok || !payload?.data) {
          throw new Error(payload?.error ?? "Nao foi possivel buscar no Apolo.");
        }

        if (!active) {
          return;
        }

        const options = payload.data.entities
          .map(mapApoloEntityToChronosInvitee)
          .filter(hasChronosInviteeContact)
          .filter(
            (invitee) =>
              !selectedInvitees.some(
                (selectedInvitee) => selectedInvitee.entityId === invitee.entityId,
              ),
          );

        setContactOptions(options);
        setContactSearchStatus("ready");
      } catch (error) {
        if (!active) {
          return;
        }

        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setContactOptions([]);
        setContactSearchError(
          error instanceof Error
            ? error.message
            : "Nao foi possivel buscar contatos no Apolo.",
        );
        setContactSearchStatus("error");
      }
    }

    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [contactQuery, selectedInvitees]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCancel();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  function handleStartsAtChange(value: string) {
    setStartsAt(value);

    if (!endsAt || new Date(endsAt).getTime() <= new Date(value).getTime()) {
      setEndsAt(addMinutesToDateTimeLocal(value, 60));
    }
  }

  function addInvitee(invitee: ChronosApoloInvitee) {
    setSelectedInvitees((currentInvitees) =>
      currentInvitees.some(
        (currentInvitee) => currentInvitee.entityId === invitee.entityId,
      )
        ? currentInvitees
        : [...currentInvitees, invitee].slice(0, 30),
    );
    setContactQuery("");
    setContactOptions([]);
    setContactSearchStatus("idle");
  }

  function removeInvitee(entityId: string) {
    setSelectedInvitees((currentInvitees) =>
      currentInvitees.filter((invitee) => invitee.entityId !== entityId),
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await onCreate({
      agenda: parseLines(agenda),
      apoloInvitees: selectedInvitees,
      endsAt,
      locationAddress:
        locationMode === "offline" ? locationAddress.trim() : undefined,
      locationMode,
      meetingType: selectedProfile.meetingType,
      objective,
      participants: selectedInvitees.map((invitee) => ({
        displayName: invitee.displayName,
        email: invitee.email,
        organization: invitee.organization,
        role: "participant" as const,
      })),
      profileId: selectedProfile.id,
      roomId: locationMode === "online" ? roomId : undefined,
      startsAt,
      title,
    });
  }

  return (
    <form
      className="relative z-10 grid max-h-[calc(100vh-8rem)] w-full max-w-[34rem] gap-3 overflow-auto rounded-lg border border-[#d9e0e7] bg-white p-4 shadow-[0_22px_70px_rgb(16_24_32_/_0.22)]"
      onSubmit={handleSubmit}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="grid h-7 w-7 place-items-center rounded-md text-[#667085]">
          <CalendarClock aria-hidden="true" size={17} />
        </span>
        <button
          aria-label="Fechar popup de evento"
          className="grid h-8 w-8 place-items-center rounded-md text-[#667085] transition hover:bg-[#f5f7fa] hover:text-[#101820] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
          onClick={onCancel}
          type="button"
        >
          <X aria-hidden="true" size={17} />
        </button>
      </div>

      <div className="grid gap-3 pl-10">
        <input
          className="h-11 border-0 border-b-2 border-[#d9e0e7] bg-transparent px-0 text-xl font-semibold text-[#101820] outline-none placeholder:text-[#667085] focus:border-[#A07C3B]"
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Adicionar titulo"
          required
          value={title}
        />

        <div className="flex gap-1 overflow-x-auto">
          {eventKinds.map((kind, index) => (
            <button
              aria-pressed={index === 0}
              className={`h-8 shrink-0 rounded-md px-3 text-xs font-semibold transition ${
                index === 0
                  ? "bg-[#d8edf8] text-[#075985]"
                  : "text-[#667085] hover:bg-[#f5f7fa] hover:text-[#101820]"
              }`}
              disabled={index !== 0}
              key={kind}
              type="button"
            >
              {kind}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3">
        <div className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-3">
          <Clock3 aria-hidden="true" className="justify-self-center text-[#667085]" size={17} />
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1 text-[11px] font-bold uppercase text-[#667085]">
              Inicio
              <input
                className="h-9 rounded-md border border-[#d9e0e7] bg-[#fafbfc] px-3 text-sm font-medium normal-case text-[#101820] outline-none focus:border-[#A07C3B] focus:ring-2 focus:ring-[#A07C3B]/20"
                onChange={(event) => handleStartsAtChange(event.target.value)}
                required
                type="datetime-local"
                value={startsAt}
              />
            </label>
            <label className="grid gap-1 text-[11px] font-bold uppercase text-[#667085]">
              Fim
              <input
                className="h-9 rounded-md border border-[#d9e0e7] bg-[#fafbfc] px-3 text-sm font-medium normal-case text-[#101820] outline-none focus:border-[#A07C3B] focus:ring-2 focus:ring-[#A07C3B]/20"
                min={startsAt}
                onChange={(event) => setEndsAt(event.target.value)}
                required
                type="datetime-local"
                value={endsAt}
              />
            </label>
          </div>
        </div>

        <div className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-start gap-3">
          <UsersRound aria-hidden="true" className="justify-self-center text-[#667085]" size={17} />
          <div className="grid gap-2">
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#98a2b3]"
                size={15}
              />
              <input
                className="h-9 w-full rounded-md border border-[#d9e0e7] bg-[#fafbfc] pl-9 pr-3 text-sm text-[#101820] outline-none placeholder:text-[#98a2b3] focus:border-[#A07C3B] focus:ring-2 focus:ring-[#A07C3B]/20"
                onChange={(event) => setContactQuery(event.target.value)}
                placeholder="Buscar convidados no Apolo"
                type="search"
                value={contactQuery}
              />
            </div>
            {contactSearchStatus === "loading" ? (
              <span className="text-xs font-semibold text-[#667085]">
                Buscando contatos reais do Apolo...
              </span>
            ) : null}
            {contactSearchError ? (
              <span className="text-xs font-semibold text-red-600">
                {contactSearchError}
              </span>
            ) : null}
            {contactOptions.length > 0 ? (
              <div className="grid max-h-44 overflow-auto rounded-md border border-[#edf0f4] bg-white p-1">
                {contactOptions.map((invitee) => (
                  <button
                    className="grid gap-0.5 rounded px-2 py-2 text-left text-sm transition hover:bg-[#f8fafc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                    key={invitee.entityId}
                    onClick={() => addInvitee(invitee)}
                    type="button"
                  >
                    <span className="font-semibold text-[#101820]">
                      {invitee.displayName}
                    </span>
                    <span className="truncate text-xs text-[#667085]">
                      {[invitee.email, invitee.phone, invitee.organization]
                        .filter(Boolean)
                        .join(" / ")}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            {selectedInvitees.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {selectedInvitees.map((invitee) => (
                  <span
                    className="inline-flex min-h-7 items-center gap-1 rounded-md border border-[#d9e0e7] bg-white px-2 text-xs font-semibold text-[#344054]"
                    key={invitee.entityId}
                  >
                    {invitee.displayName}
                    <button
                      aria-label={`Remover ${invitee.displayName}`}
                      className="grid h-5 w-5 place-items-center rounded text-[#667085] hover:bg-[#f5f7fa] hover:text-[#101820]"
                      onClick={() => removeInvitee(invitee.entityId)}
                      type="button"
                    >
                      <X aria-hidden="true" size={12} />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-xs text-[#667085]">
                Convidados entram exclusivamente pela base Apolo, com e-mail e
                telefone quando cadastrados.
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-start gap-3">
          {locationMode === "online" ? (
            <Video aria-hidden="true" className="mt-2 justify-self-center text-[#A07C3B]" size={17} />
          ) : (
            <MapPin aria-hidden="true" className="mt-2 justify-self-center text-[#A07C3B]" size={17} />
          )}
          <div className="grid gap-2">
            <div className="inline-grid w-fit grid-cols-2 rounded-md border border-[#d9e0e7] bg-[#f8fafc] p-0.5">
              {[
                { id: "online", label: "Online" },
                { id: "offline", label: "Presencial" },
              ].map((option) => (
                <button
                  aria-pressed={locationMode === option.id}
                  className={`h-8 rounded px-3 text-xs font-semibold transition ${
                    locationMode === option.id
                      ? "bg-[#101820] text-white"
                      : "text-[#667085] hover:bg-white hover:text-[#101820]"
                  }`}
                  key={option.id}
                  onClick={() =>
                    setLocationMode(option.id as ChronosMeetingLocationMode)
                  }
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
            {locationMode === "online" ? (
              <select
                className="h-9 rounded-md border border-[#d9e0e7] bg-white px-2 text-sm text-[#344054] outline-none transition focus:border-[#A07C3B] focus:bg-[#fafbfc]"
                disabled={rooms.length === 0}
                onChange={(event) => setRoomId(event.target.value)}
                value={roomId}
              >
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="h-9 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm text-[#101820] outline-none placeholder:text-[#98a2b3] focus:border-[#A07C3B] focus:bg-[#fafbfc] focus:ring-2 focus:ring-[#A07C3B]/20"
                onChange={(event) => setLocationAddress(event.target.value)}
                placeholder="Endereco presencial"
                required={locationMode === "offline"}
                value={locationAddress}
              />
            )}
          </div>
        </div>

        <div className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-3">
          <CalendarClock aria-hidden="true" className="justify-self-center text-[#667085]" size={17} />
          <select
            className="h-9 rounded-md border border-transparent bg-white px-2 text-sm text-[#344054] outline-none transition hover:border-[#edf0f4] focus:border-[#A07C3B] focus:bg-[#fafbfc]"
            onChange={(event) => setProfileId(event.target.value)}
            value={selectedProfile.id}
          >
            {activeProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.label}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-start gap-3">
          <FileText aria-hidden="true" className="mt-2 justify-self-center text-[#667085]" size={17} />
          <textarea
            className="min-h-16 resize-none rounded-md border border-transparent bg-white p-2 text-sm outline-none transition hover:border-[#edf0f4] focus:border-[#A07C3B] focus:bg-[#fafbfc] focus:ring-2 focus:ring-[#A07C3B]/20"
            onChange={(event) => setObjective(event.target.value)}
            placeholder="Adicionar descricao"
            value={objective}
          />
        </div>

        <div className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-start gap-3">
          <ListChecks aria-hidden="true" className="mt-2 justify-self-center text-[#667085]" size={17} />
          <textarea
            className="min-h-16 resize-none rounded-md border border-transparent bg-white p-2 text-sm outline-none transition hover:border-[#edf0f4] focus:border-[#A07C3B] focus:bg-[#fafbfc] focus:ring-2 focus:ring-[#A07C3B]/20"
            onChange={(event) => setAgenda(event.target.value)}
            placeholder="Adicionar pauta"
            value={agenda}
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-[#edf0f4] pt-3">
        <button
          className="h-9 rounded-md px-3 text-sm font-semibold text-[#526078] transition hover:bg-[#f5f7fa] hover:text-[#101820]"
          type="button"
        >
          Mais opcoes
        </button>
        <button
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[#101820] px-4 text-sm font-semibold text-white transition hover:bg-[#1f2937] disabled:cursor-wait disabled:opacity-60"
          disabled={saving}
          type="submit"
        >
          {saving ? (
            <Loader2 aria-hidden="true" className="animate-spin" size={15} />
          ) : (
            <Save aria-hidden="true" size={15} />
          )}
          Salvar
        </button>
      </div>
    </form>
  );
}

function ChronosGoogleCalendarReadiness({
  connecting,
  error,
  onConnect,
  onRefresh,
  onSync,
  status,
  syncing,
}: {
  connecting: boolean;
  error: string | null;
  onConnect: () => void;
  onRefresh: () => void;
  onSync: () => void;
  status: ChronosGoogleCalendarStatus | null;
  syncing: boolean;
}) {
  if (error) {
    return (
      <div className="grid gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
        <p className="m-0">
          Google Agenda preparado com rota segura, mas o status nao pode ser
          consultado agora.
        </p>
        <p className="m-0 font-semibold">{error}</p>
        <button
          className="h-8 rounded-md border border-amber-200 bg-white px-2 font-bold text-amber-900"
          onClick={onRefresh}
          type="button"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="rounded-md border border-[#edf0f4] bg-white p-3 text-xs leading-5 text-[#667085]">
        Verificando preparo seguro do Google Agenda...
      </div>
    );
  }

  return (
    <div className="grid gap-2 rounded-md border border-[#edf0f4] bg-white p-3 text-xs leading-5 text-[#667085]">
      <p className="m-0">
        Espelho Google para criar e atualizar eventos dos dois lados com vinculo
        idempotente por evento.
      </p>
      <div className="flex flex-wrap gap-1">
        <Badge variant={status.configured ? "info" : "warning"}>
          {status.configured ? "envs obrigatorias presentes" : "envs pendentes"}
        </Badge>
        <Badge variant={status.connection.connected ? "success" : "warning"}>
          {status.connection.connected ? "conectado" : "nao conectado"}
        </Badge>
        <Badge variant={status.connection.storageReady ? "success" : "warning"}>
          {status.connection.storageReady ? "storage ok" : "migration pendente"}
        </Badge>
        <Badge variant="neutral">{status.provider}</Badge>
      </div>
      {status.connection.calendarId ? (
        <p className="m-0">
          Calendario: <strong>{status.connection.calendarId}</strong>
        </p>
      ) : null}
      {status.connection.lastSyncedAt ? (
        <p className="m-0">
          Ultimo sync: {formatDateTime(status.connection.lastSyncedAt)}
        </p>
      ) : null}
      {status.missingEnvNames.length > 0 ? (
        <div>
          <p className="m-0 font-bold uppercase text-[#667085]">
            Pendentes por nome
          </p>
          <p className="m-0 mt-1 break-words">
            {status.missingEnvNames.join(", ")}
          </p>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          aria-label={
            status.connection.connected ? "Google conectado" : "Conectar Google"
          }
          className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-2 font-bold transition disabled:cursor-not-allowed disabled:opacity-55 ${
            status.configured && status.connection.storageReady
              ? "bg-[#101820] text-white"
              : "bg-[#edf0f4] text-[#98a2b3]"
          }`}
          disabled={
            connecting || !status.configured || !status.connection.storageReady
          }
          onClick={onConnect}
          type="button"
        >
          <GoogleGlyph connected={status.connection.connected} />
          {connecting ? "Abrindo..." : "Google"}
        </button>
        <button
          className="h-8 rounded-md border border-[#d9e0e7] bg-white px-2 font-bold text-[#101820] disabled:opacity-50"
          disabled={!status.connection.connected || syncing}
          onClick={onSync}
          type="button"
        >
          {syncing ? "Sincronizando..." : "Sincronizar"}
        </button>
      </div>
    </div>
  );
}

function GoogleGlyph({ connected }: { connected?: boolean }) {
  if (connected) {
    return (
      <span
        aria-hidden="true"
        className="grid h-5 w-5 place-items-center rounded-full bg-white text-[11px] font-black text-[#4285f4] shadow-[inset_0_0_0_1px_rgba(16,24,32,0.1)]"
      >
        G
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className="grid h-5 w-5 place-items-center rounded-full border border-current bg-transparent text-[11px] font-black"
    >
      G
    </span>
  );
}

function ChronosCalendarCanvas({
  cursorDate,
  meetings,
  onCreateAt,
  onSelectMeeting,
  rooms,
  selectedMeetingId,
  view,
}: {
  cursorDate: Date;
  meetings: ChronosMeeting[];
  onCreateAt: (date: Date) => void;
  onSelectMeeting: (meetingId: string) => void;
  rooms: ChronosRoom[];
  selectedMeetingId: string;
  view: ChronosCalendarView;
}) {
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
      {hours.map((hour) => (
        <div className="contents" key={hour}>
          <div className="border-b border-[#edf0f4] bg-white p-2 text-right text-xs text-[#667085]">
            {String(hour).padStart(2, "0")}:00
          </div>
          {dates.map((date) => {
            const slotDate = setDateHour(date, hour);
            const slotMeetings = meetings.filter((meeting) =>
              meetingStartsInHour(meeting, slotDate),
            );

            return (
              <button
                className="min-h-20 border-b border-l border-[#edf0f4] bg-white p-1 text-left transition hover:bg-[#f8fafc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                key={`${date.toISOString()}-${hour}`}
                onClick={() => onCreateAt(slotDate)}
                type="button"
              >
                <span className="grid gap-1">
                  {slotMeetings.map((meeting) => (
                    <ChronosCalendarEventPill
                      key={meeting.id}
                      meeting={meeting}
                      onSelectMeeting={onSelectMeeting}
                      selected={meeting.id === selectedMeetingId}
                    />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      ))}
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
                const hasMeeting = meetings.some((meeting) =>
                  sameMeetingDay(meeting, date),
                );

                return (
                  <button
                    className={`grid h-7 place-items-center rounded text-xs font-semibold transition hover:bg-white ${
                      hasMeeting
                        ? "bg-[#101820] text-white"
                        : sameDay(date, new Date())
                          ? "bg-[#0b66d8] text-white"
                          : "text-[#667085]"
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
  return (
    <button
      className={`grid gap-2 rounded-md border p-3 text-left transition ${
        selected
          ? "border-[#A07C3B] bg-[#fffaf0]"
          : "border-[#edf0f4] bg-[#fafbfc] hover:border-[#d9e0e7] hover:bg-white"
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
            {formatDateTime(meeting.startsAt)} /{" "}
            {getChronosMeetingLocationLabel(meeting)}
          </span>
        </span>
        <Badge variant={statusVariant[meeting.status]}>
          {chronosMeetingStatusLabels[meeting.status]}
        </Badge>
      </span>
      <span className="flex flex-wrap gap-1">
        <Badge variant="neutral">{meeting.protocol}</Badge>
        <Badge variant={minutesVariant[meeting.minutesStatus]}>
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
  meeting,
  onSelectMeeting,
  selected,
}: {
  meeting: ChronosMeeting;
  onSelectMeeting: (meetingId: string) => void;
  selected: boolean;
}) {
  return (
    <span
      className={`block rounded border px-2 py-1 text-xs font-semibold ${
        selected
          ? "border-[#A07C3B] bg-[#fffaf0] text-[#101820]"
          : "border-[#0ea5e9] bg-[#e0f2fe] text-[#0369a1]"
      }`}
      onClick={(event) => {
        event.stopPropagation();
        onSelectMeeting(meeting.id);
      }}
      role="button"
      tabIndex={0}
    >
      <span className="block truncate">
        {formatMeetingHour(meeting)} {meeting.title}
      </span>
      <span className="block truncate font-medium">
        {getChronosMeetingLocationLabel(meeting)}
      </span>
    </span>
  );
}

function MiniCalendar({
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
          const hasMeeting = meetings.some((meeting) =>
            sameMeetingDay(meeting, date),
          );

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
                {hasMeeting ? (
                  <span className="absolute -bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-[#A07C3B]" />
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ChronosRoomsManagementScreen({
  meetings,
  onCreateRoom,
  onDeleteRoom,
  onUpdateRoom,
  profiles,
  rooms,
  saving,
}: {
  meetings: ChronosMeeting[];
  onCreateRoom: (input: ChronosRoomInput) => Promise<ChronosRoom | null>;
  onDeleteRoom: (roomId: string) => Promise<ChronosRoom | null>;
  onUpdateRoom: (input: ChronosRoomUpdateInput) => Promise<ChronosRoom | null>;
  profiles: ChronosMeetingProfile[];
  rooms: ChronosRoom[];
  saving: boolean;
}) {
  const [selectedRoomId, setSelectedRoomId] = useState(rooms[0]?.id ?? "");
  const [activeRoomsTab, setActiveRoomsTab] =
    useState<ChronosRoomsTab>("rooms");
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [roomDraft, setRoomDraft] = useState<ChronosRoomDraft>(() =>
    createRoomDraft(rooms[0] ?? null),
  );
  const selectedRoom =
    rooms.find((room) => room.id === selectedRoomId) ?? rooms[0] ?? null;
  const activeProfiles = useMemo(
    () => profiles.filter((profile) => profile.status === "active"),
    [profiles],
  );

  useEffect(() => {
    setSelectedRoomId((currentRoomId) => currentRoomId || rooms[0]?.id || "");
  }, [rooms]);

  useEffect(() => {
    if (!isCreatingRoom) {
      setRoomDraft(createRoomDraft(selectedRoom));
    }
  }, [isCreatingRoom, selectedRoom]);

  function updateRoomDraft<Key extends keyof ChronosRoomDraft>(
    key: Key,
    value: ChronosRoomDraft[Key],
  ) {
    setRoomDraft((currentDraft) => {
      const nextDraft = { ...currentDraft, [key]: value };

      if (key === "name" && !isCreatingRoom) {
        return nextDraft;
      }

      if (key === "name") {
        nextDraft.slug = slugifyRoomName(String(value));
      }

      return nextDraft;
    });
  }

  function startNewRoomDraft() {
    setActiveRoomsTab("rooms");
    setIsCreatingRoom(true);
    setSelectedRoomId("");
    setRoomDraft(createRoomDraft(null));
  }

  async function handleSaveRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const input = buildRoomInputFromDraft(roomDraft);

    if (isCreatingRoom) {
      const room = await onCreateRoom(input);

      if (room) {
        setIsCreatingRoom(false);
        setSelectedRoomId(room.id);
      }

      return;
    }

    if (!selectedRoom) {
      return;
    }

    await onUpdateRoom({
      ...input,
      roomId: selectedRoom.id,
    });
  }

  async function handleDeleteRoom() {
    if (!selectedRoom) {
      return;
    }

    const confirmed = window.confirm(
      `Excluir a sala ${selectedRoom.name}? Reunioes antigas permanecem preservadas.`,
    );

    if (!confirmed) {
      return;
    }

    const archivedRoom = await onDeleteRoom(selectedRoom.id);

    if (archivedRoom) {
      setSelectedRoomId(
        rooms.find((room) => room.id !== selectedRoom.id)?.id ?? "",
      );
    }
  }

  async function handleBackgroundUpload(file: File | null) {
    if (!file) {
      return;
    }

    if (
      !file.type.startsWith("image/") ||
      file.size > chronosRoomBackgroundUploadLimitBytes
    ) {
      window.alert("Use uma imagem PNG, JPG ou WebP de ate 5 MB.");
      return;
    }

    const dataUrl = await readFileAsDataUrl(file);

    setRoomDraft((currentDraft) => ({
      ...currentDraft,
      backgroundDataUrl: dataUrl,
      backgroundName: file.name,
    }));
  }

  const externalRoomLink = buildExternalRoomLink(roomDraft.slug);
  const roomFormTitle = isCreatingRoom ? "Nova sala" : selectedRoom?.name ?? "Sala";

  return (
    <div className="grid gap-4">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(22rem,0.9fr)]">
        <Surface bordered className="border-[#d9e0e7] bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#edf0f4] p-4">
            <PanelTitle eyebrow="Salas" title="Ambientes fixos" />
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-grid grid-cols-2 rounded-md border border-[#d9e0e7] bg-[#f8fafc] p-0.5">
                {[
                  { id: "rooms", label: "Salas" },
                  { id: "profiles", label: "Perfis" },
                ].map((tab) => (
                  <button
                    aria-pressed={activeRoomsTab === tab.id}
                    className={`h-8 rounded px-3 text-xs font-semibold transition ${
                      activeRoomsTab === tab.id
                        ? "bg-[#101820] text-white"
                        : "text-[#667085] hover:bg-white hover:text-[#101820]"
                    }`}
                    key={tab.id}
                    onClick={() => setActiveRoomsTab(tab.id as ChronosRoomsTab)}
                    type="button"
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              {activeRoomsTab === "rooms" ? (
                <button
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm font-semibold text-[#101820] transition hover:border-[#A07C3B] hover:text-[#A07C3B] disabled:cursor-not-allowed disabled:opacity-55"
                  disabled={saving}
                  onClick={startNewRoomDraft}
                  type="button"
                >
                  <Plus aria-hidden="true" size={15} />
                  Nova sala
                </button>
              ) : null}
            </div>
          </div>
          {activeRoomsTab === "rooms" ? (
            <div className="grid gap-3 p-4 md:grid-cols-2 2xl:grid-cols-3">
              {rooms.map((room) => {
                const totalRoomMeetings = meetings.filter(
                  (currentMeeting) => currentMeeting.roomId === room.id,
                ).length;

                return (
                  <button
                    className={`grid gap-3 rounded-md border p-3 text-left transition ${
                      !isCreatingRoom && room.id === selectedRoom?.id
                        ? "border-[#A07C3B] bg-[#fffaf0]"
                        : "border-[#edf0f4] bg-[#fafbfc] hover:border-[#d9e0e7] hover:bg-white"
                    }`}
                    key={room.id}
                    onClick={() => {
                      setIsCreatingRoom(false);
                      setSelectedRoomId(room.id);
                    }}
                    type="button"
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-[#101820]">
                          {room.name}
                        </span>
                        <span className="mt-1 block text-xs text-[#667085]">
                          {getChronosProfileLabel(activeProfiles, room.roomType)} /{" "}
                          {room.capacity} lugares
                        </span>
                      </span>
                      <Badge variant={room.status === "active" ? "success" : "neutral"}>
                        {room.status}
                      </Badge>
                    </span>
                    <span className="grid grid-cols-3 gap-2 text-xs font-semibold text-[#667085]">
                      <span>gravacao {room.recordingRequired ? "sim" : "nao"}</span>
                      <span>
                        transcricao {room.transcriptionRequired ? "sim" : "nao"}
                      </span>
                      <span>ata {room.minutesRequired ? "sim" : "nao"}</span>
                    </span>
                    <span className="flex flex-wrap gap-1">
                      <Badge variant="neutral">{totalRoomMeetings} reunioes</Badge>
                      <Badge variant="info">{buildExternalRoomLink(room.slug)}</Badge>
                    </span>
                  </button>
                );
              })}
              {rooms.length === 0 ? (
                <EmptyPanel text="Nenhuma sala Chronos carregada." />
              ) : null}
            </div>
          ) : (
            <div className="grid gap-3 p-4 md:grid-cols-2 2xl:grid-cols-3">
              {activeProfiles.map((profile) => {
                const usedByRooms = rooms.filter(
                  (room) => normalizeChronosProfileId(room.roomType) === profile.id,
                ).length;

                return (
                  <article
                    className="grid gap-3 rounded-md border border-[#edf0f4] bg-[#fafbfc] p-3"
                    key={profile.id}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="min-w-0 text-sm font-semibold text-[#101820]">
                        {profile.label}
                      </span>
                      <Badge variant="info">oficial</Badge>
                    </span>
                    <p className="m-0 text-xs leading-5 text-[#667085]">
                      {profile.description}
                    </p>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold uppercase text-[#A07C3B]">
                        {chronosMeetingTypeLabels[profile.meetingType]}
                      </span>
                      <Badge variant="neutral">{usedByRooms} salas</Badge>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </Surface>

        <Surface bordered className="border-[#d9e0e7] bg-white">
          <div className="border-b border-[#edf0f4] p-4">
            <PanelTitle eyebrow="Configuracao" title={roomFormTitle} />
          </div>
          <form className="grid gap-3 p-4" onSubmit={handleSaveRoom}>
            <label className="grid gap-1 text-xs font-bold uppercase text-[#667085]">
              Nome da sala
              <input
                className="h-9 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm normal-case text-[#101820] outline-none focus:border-[#A07C3B]"
                onChange={(event) => updateRoomDraft("name", event.target.value)}
                placeholder="Sala Financeiro"
                value={roomDraft.name}
              />
            </label>
            <label className="grid gap-1 text-xs font-bold uppercase text-[#667085]">
              Link externo
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem]">
                <input
                  className="h-9 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm normal-case text-[#101820] outline-none focus:border-[#A07C3B]"
                  onChange={(event) =>
                    updateRoomDraft("slug", slugifyRoomName(event.target.value))
                  }
                  placeholder="sala-financeiro"
                  value={roomDraft.slug}
                />
                <span className="inline-flex h-9 items-center justify-center rounded-md border border-[#d9e0e7] bg-[#f8fafc] px-2 text-xs normal-case text-[#667085]">
                  solicitar entrada
                </span>
              </div>
              <span className="truncate rounded-md border border-[#edf0f4] bg-[#fafbfc] px-3 py-2 text-xs normal-case text-[#526078]">
                {externalRoomLink}
              </span>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-xs font-bold uppercase text-[#667085]">
                Perfil
                <select
                  className="h-9 rounded-md border border-[#d9e0e7] bg-white px-2 text-sm normal-case text-[#101820] outline-none focus:border-[#A07C3B]"
                  onChange={(event) =>
                    updateRoomDraft("roomType", event.target.value)
                  }
                  value={roomDraft.roomType}
                >
                  {activeProfiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-bold uppercase text-[#667085]">
                Lugares
                <input
                  className="h-9 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm normal-case text-[#101820] outline-none focus:border-[#A07C3B]"
                  min={1}
                  max={200}
                  onChange={(event) =>
                    updateRoomDraft("capacity", event.target.value)
                  }
                  type="number"
                  value={roomDraft.capacity}
                />
              </label>
            </div>
            <div className="grid gap-2 rounded-md border border-[#edf0f4] bg-[#fafbfc] p-3">
              {[
                {
                  checked: roomDraft.recordingRequired,
                  key: "recordingRequired" as const,
                  label: "Gravacao",
                },
                {
                  checked: roomDraft.transcriptionRequired,
                  key: "transcriptionRequired" as const,
                  label: "Transcricao",
                },
                {
                  checked: roomDraft.minutesRequired,
                  key: "minutesRequired" as const,
                  label: "Ata",
                },
              ].map((option) => (
                <label
                  className="flex items-center justify-between gap-3 text-sm font-semibold text-[#101820]"
                  key={option.key}
                >
                  <span>{option.label}</span>
                  <input
                    checked={option.checked}
                    className="h-4 w-4 accent-[#A07C3B]"
                    onChange={(event) =>
                      updateRoomDraft(option.key, event.target.checked)
                    }
                    type="checkbox"
                  />
                </label>
              ))}
            </div>
            <div className="grid gap-2">
              <span className="text-xs font-bold uppercase text-[#667085]">
                Fundo da sala
              </span>
              <label className="inline-flex h-9 w-fit cursor-pointer items-center gap-2 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm font-semibold text-[#101820] transition hover:border-[#A07C3B] hover:text-[#A07C3B]">
                <ImagePlus aria-hidden="true" size={15} />
                Subir fundo
                <input
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  onChange={(event) =>
                    void handleBackgroundUpload(event.target.files?.[0] ?? null)
                  }
                  type="file"
                />
              </label>
              {roomDraft.backgroundDataUrl ? (
                <div
                  className="min-h-28 rounded-md border border-[#d9e0e7] bg-cover bg-center p-3"
                  style={{
                    backgroundImage: `linear-gradient(rgba(16, 24, 32, 0.22), rgba(16, 24, 32, 0.22)), url(${roomDraft.backgroundDataUrl})`,
                  }}
                >
                  <Badge variant="neutral">
                    {roomDraft.backgroundName || "fundo selecionado"}
                  </Badge>
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-[#d9e0e7] bg-[#fafbfc] p-3 text-xs font-semibold text-[#667085]">
                  Sem fundo enviado. A sala usa o padrao institucional Chronos.
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#edf0f4] pt-3">
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md border border-[#101820] bg-[#101820] px-3 text-sm font-semibold text-white transition hover:border-[#A07C3B] hover:bg-[#A07C3B] disabled:cursor-not-allowed disabled:opacity-55"
                disabled={saving}
                type="submit"
              >
                <Save aria-hidden="true" size={15} />
                Salvar
              </button>
              <div className="flex flex-wrap gap-2">
                {isCreatingRoom ? (
                  <button
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm font-semibold text-[#667085] transition hover:text-[#101820]"
                    onClick={() => {
                      setIsCreatingRoom(false);
                      setSelectedRoomId(rooms[0]?.id ?? "");
                    }}
                    type="button"
                  >
                    <X aria-hidden="true" size={15} />
                    Cancelar
                  </button>
                ) : null}
                {!isCreatingRoom && selectedRoom ? (
                  <button
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-red-200 bg-white px-3 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-55"
                    disabled={saving}
                    onClick={handleDeleteRoom}
                    type="button"
                  >
                    <Trash2 aria-hidden="true" size={15} />
                    Excluir
                  </button>
                ) : null}
              </div>
            </div>
          </form>
        </Surface>
      </section>
    </div>
  );
}

function ChronosDriveLibraryScreen({
  activeDriveView,
  localRecordings,
  meeting,
  meetings,
  onChangeDriveView,
  onGenerateMinutesDraft,
  onSelectMeeting,
  onTranscribeRecording,
  onUpdate,
  rooms,
  saving,
  userName,
}: {
  activeDriveView: ChronosDriveView;
  localRecordings: LocalRecording[];
  meeting: ChronosMeeting | null;
  meetings: ChronosMeeting[];
  onChangeDriveView: (view: ChronosDriveView) => void;
  onGenerateMinutesDraft: (
    meeting: ChronosMeeting,
    minutesProfile: ChronosMinutesProfile,
  ) => Promise<void>;
  onSelectMeeting: (meetingId: string) => void;
  onTranscribeRecording: (input: {
    file: Blob;
    fileName?: string;
    meeting: ChronosMeeting;
    recordingId?: string;
  }) => Promise<void>;
  onUpdate: (input: Parameters<typeof updateChronosMeeting>[0]) => Promise<void>;
  rooms: ChronosRoom[];
  saving: boolean;
  userName: string;
}) {
  const [roomFilter, setRoomFilter] = useState("all");
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

    return sortMeetingsByDate(byRoom);
  }, [activeDriveView, meetings, roomFilter]);

  return (
    <ChronosDrivePanel
      activeDriveView={activeDriveView}
      onChangeDriveView={onChangeDriveView}
    >
      <section className="grid min-h-[42rem] gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(24rem,0.72fr)]">
        <Surface bordered className="border-[#d9e0e7] bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#edf0f4] p-4">
            <PanelTitle
              eyebrow="Drive Chronos"
              title={activeDriveView === "recordings" ? "Gravacoes" : "Atas"}
            />
            <select
              className="h-9 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm font-semibold text-[#526078] outline-none focus:border-[#A07C3B]"
              onChange={(event) => setRoomFilter(event.target.value)}
              value={roomFilter}
            >
              <option value="all">Todas as salas</option>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-3 p-4 md:grid-cols-2 2xl:grid-cols-3">
            {filteredMeetings.map((driveMeeting) => (
              <ChronosDriveItemCard
                driveView={activeDriveView}
                key={driveMeeting.id}
                meeting={driveMeeting}
                onSelectMeeting={onSelectMeeting}
                selected={driveMeeting.id === meeting?.id}
              />
            ))}
            {filteredMeetings.length === 0 ? (
              <EmptyPanel
                text={
                  activeDriveView === "recordings"
                    ? "Nenhuma gravacao encontrada para este filtro."
                    : "Nenhuma reuniao encontrada para organizar atas."
                }
              />
            ) : null}
          </div>
        </Surface>

        {meeting ? (
          activeDriveView === "recordings" ? (
            <RecordingsPanel
              localRecordings={localRecordings}
              meeting={meeting}
              onTranscribeRecording={onTranscribeRecording}
              saving={saving}
            />
          ) : (
            <div className="grid gap-4">
              <MinutesPanel
                meeting={meeting}
                onGenerateMinutesDraft={onGenerateMinutesDraft}
                onUpdate={onUpdate}
                saving={saving}
              />
              <TranscriptPanel
                meeting={meeting}
                onUpdate={onUpdate}
                saving={saving}
                userName={userName}
              />
            </div>
          )
        ) : (
          <Surface bordered className="grid min-h-full place-items-center border-[#d9e0e7] bg-white p-5 text-sm text-[#667085]">
            Selecione um item do Drive.
          </Surface>
        )}
      </section>
    </ChronosDrivePanel>
  );
}

function ChronosDriveItemCard({
  driveView,
  meeting,
  onSelectMeeting,
  selected,
}: {
  driveView: ChronosDriveView;
  meeting: ChronosMeeting;
  onSelectMeeting: (meetingId: string) => void;
  selected: boolean;
}) {
  const participants = meeting.participants
    .map((participant) => participant.displayName)
    .filter(Boolean)
    .slice(0, 3)
    .join(", ");

  return (
    <button
      className={`grid gap-3 rounded-md border p-3 text-left transition ${
        selected
          ? "border-[#A07C3B] bg-[#fffaf0]"
          : "border-[#edf0f4] bg-[#fafbfc] hover:border-[#d9e0e7] hover:bg-white"
      }`}
      onClick={() => onSelectMeeting(meeting.id)}
      type="button"
    >
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-[#101820]">
            {meeting.title}
          </span>
          <span className="mt-1 block text-xs text-[#667085]">
            {meeting.room?.name ?? "Sala pendente"}
          </span>
        </span>
        <Badge
          variant={
            driveView === "recordings"
              ? meeting.recordingStatus === "available"
                ? "success"
                : "warning"
              : minutesVariant[meeting.minutesStatus]
          }
        >
          {driveView === "recordings"
            ? chronosCaptureStatusLabels[meeting.recordingStatus]
            : chronosMinutesStatusLabels[meeting.minutesStatus]}
        </Badge>
      </span>
      <span className="grid gap-1 text-xs text-[#667085]">
        <span>Inicio: {formatDateTime(meeting.startsAt)}</span>
        <span>Participantes: {meeting.participants.length}</span>
        <span className="truncate">Nomes: {participants || "-"}</span>
        <span>Tema: {meeting.objective || meeting.title}</span>
      </span>
      <span className="flex flex-wrap gap-1">
        <Badge variant="neutral">{meeting.protocol}</Badge>
        {driveView === "recordings" ? (
          <Badge variant="neutral">{meeting.recordings.length} arquivos</Badge>
        ) : (
          <Badge variant="neutral">{meeting.minutes.length} versoes</Badge>
        )}
      </span>
    </button>
  );
}

function MeetingOverview({
  meeting,
  onUpdate,
  saving,
}: {
  meeting: ChronosMeeting;
  onUpdate: (input: Parameters<typeof updateChronosMeeting>[0]) => Promise<void>;
  saving: boolean;
}) {
  const nextAction = buildChronosNextAction(meeting);

  return (
    <div className="grid gap-4">
      <ChronosNextActionPanel action={nextAction} />
      <ChronosGovernanceChecklist meeting={meeting} />
      <div className="grid grid-cols-2 gap-3">
        <InfoBlock label="sala" value={meeting.room?.name ?? "-"} />
        <InfoBlock label="tipo" value={chronosMeetingTypeLabels[meeting.meetingType]} />
        <InfoBlock label="inicio" value={formatDateTime(meeting.startsAt)} />
        <InfoBlock label="host" value={meeting.hostName ?? "-"} />
      </div>
      <InfoBlock label="objetivo" value={meeting.objective || "-"} />
      <div className="grid gap-2">
        <p className="m-0 text-xs font-bold uppercase text-[#667085]">
          Controle formal
        </p>
        <div className="grid grid-cols-2 gap-2 2xl:grid-cols-4">
          <StatusActionButton
            disabled={saving}
            icon={<CalendarClock size={15} />}
            label="Entrada"
            onClick={() =>
              onUpdate({
                action: "set_status",
                meetingId: meeting.id,
                status: "lobby",
              })
            }
          />
          <StatusActionButton
            disabled={saving}
            icon={<Radio size={15} />}
            label="Ao vivo"
            onClick={() =>
              onUpdate({
                action: "set_status",
                meetingId: meeting.id,
                status: "live",
              })
            }
          />
          <StatusActionButton
            disabled={saving}
            icon={<CheckCircle2 size={15} />}
            label="Revisao"
            onClick={() =>
              onUpdate({
                action: "set_status",
                meetingId: meeting.id,
                status: "review",
              })
            }
          />
          <StatusActionButton
            disabled={saving}
            icon={<ShieldCheck size={15} />}
            label="Fechar"
            onClick={() =>
              onUpdate({
                action: "set_status",
                meetingId: meeting.id,
                status: "closed",
              })
            }
          />
        </div>
      </div>
      <div className="grid gap-2">
        <p className="m-0 text-xs font-bold uppercase text-[#667085]">
          Resumo executivo
        </p>
        <div className="rounded-md border border-[#edf0f4] bg-[#fafbfc] p-3 text-sm leading-6 text-[#344054]">
          {meeting.executiveSummary || "-"}
        </div>
      </div>
    </div>
  );
}

function ChronosNextActionPanel({
  action,
}: {
  action: ReturnType<typeof buildChronosNextAction>;
}) {
  return (
    <div className="rounded-md border border-[#d9e0e7] bg-[#101820] p-3 text-white">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-xs font-bold uppercase text-[#D6B56F]">
            Proxima acao formal
          </p>
          <p className="m-0 mt-1 text-sm font-semibold text-white">
            {action.title}
          </p>
        </div>
        <Badge variant={action.variant}>{action.badge}</Badge>
      </div>
      <p className="m-0 mt-2 text-sm leading-6 text-[#d7dee8]">
        {action.description}
      </p>
    </div>
  );
}

function ChronosGovernanceChecklist({
  meeting,
}: {
  meeting: ChronosMeeting;
}) {
  const agenda = Array.isArray(meeting.metadata.agenda)
    ? meeting.metadata.agenda
    : [];
  const items = [
    {
      complete: agenda.length > 0,
      label: "pauta",
    },
    {
      complete: meeting.participants.length > 0,
      label: "participantes",
    },
    {
      complete: meeting.recordingStatus === "available",
      label: "gravacao",
    },
    {
      complete: meeting.transcript.length > 0,
      label: "transcricao",
    },
    {
      complete: meeting.minutesStatus === "approved",
      label: "ata revisada",
    },
  ];

  return (
    <div className="rounded-md border border-[#edf0f4] bg-[#fafbfc] p-3">
      <p className="m-0 text-xs font-bold uppercase text-[#667085]">
        Governanca da reuniao
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {items.map((item) => (
          <Badge
            key={item.label}
            variant={item.complete ? "success" : "neutral"}
          >
            {item.label}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function RoomsPanel({
  rooms,
  selectedRoomId,
}: {
  rooms: ChronosRoom[];
  selectedRoomId?: string | null;
}) {
  return (
    <Surface bordered className="min-h-full border-[#d9e0e7] bg-white p-4">
      <PanelTitle eyebrow="Salas executivas" title="Ambientes" />
      <div className="mt-4 grid gap-3">
        {rooms.map((room) => (
          <div
            className={`rounded-md border p-3 ${
              room.id === selectedRoomId
                ? "border-[#A07C3B] bg-[#fffaf0]"
                : "border-[#edf0f4] bg-[#fafbfc]"
            }`}
            key={room.id}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="m-0 text-sm font-semibold text-[#101820]">
                  {room.name}
                </p>
                <p className="m-0 mt-1 text-xs text-[#667085]">
                  {getChronosProfileLabel(defaultChronosMeetingProfiles, room.roomType)} /{" "}
                  {room.capacity} lugares
                </p>
              </div>
              <Badge variant={room.id === selectedRoomId ? "warning" : "neutral"}>
                {room.status}
              </Badge>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs font-semibold text-[#667085]">
              <span>gravacao {room.recordingRequired ? "sim" : "nao"}</span>
              <span>transcricao {room.transcriptionRequired ? "sim" : "nao"}</span>
              <span>ata {room.minutesRequired ? "sim" : "nao"}</span>
            </div>
          </div>
        ))}
      </div>
    </Surface>
  );
}

function RecordingsPanel({
  localRecordings,
  meeting,
  onTranscribeRecording,
  saving,
}: {
  localRecordings: LocalRecording[];
  meeting: ChronosMeeting;
  onTranscribeRecording: (input: {
    file: Blob;
    fileName?: string;
    meeting: ChronosMeeting;
    recordingId?: string;
  }) => Promise<void>;
  saving: boolean;
}) {
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const meetingLocalRecordings = localRecordings.filter(
    (recording) => recording.meetingId === meeting.id,
  );
  const recordings = [
    ...meetingLocalRecordings,
    ...meeting.recordings.map((recording) =>
      mapPersistedRecording(recording, meeting.id),
    ),
  ];

  async function handleUploadChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (file) {
      await onTranscribeRecording({
        file,
        fileName: file.name,
        meeting,
      });
    }

    event.target.value = "";
  }

  return (
    <Surface bordered className="min-h-full border-[#d9e0e7] bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <PanelTitle eyebrow="Gravacoes" title="Registro audiovisual" />
        <input
          accept="audio/*,video/*,.webm,.m4a,.mp3,.mp4,.ogg,.wav"
          className="hidden"
          onChange={(event) => void handleUploadChange(event)}
          ref={uploadInputRef}
          type="file"
        />
        <button
          className="inline-flex h-9 items-center gap-2 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm font-semibold text-[#101820] transition hover:bg-[#f8fafc] disabled:cursor-wait disabled:opacity-60"
          disabled={saving}
          onClick={() => uploadInputRef.current?.click()}
          type="button"
        >
          <Upload aria-hidden="true" size={15} />
          Transcrever arquivo
        </button>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <InfoBlock
          label="status"
          value={chronosCaptureStatusLabels[meeting.recordingStatus]}
        />
        <InfoBlock
          label="arquivos locais"
          value={String(meetingLocalRecordings.length)}
        />
      </div>
      <div className="mt-4 grid gap-3">
        {recordings.map((recording) => {
          const downloadUrl = recording.downloadUrl ?? recording.url;

          return (
            <div
              className="rounded-md border border-[#edf0f4] bg-[#fafbfc] p-3 text-sm text-[#101820] transition hover:border-[#d9e0e7] hover:bg-white"
              key={recording.id}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <strong className="block truncate text-sm font-semibold">
                    {recording.name}
                  </strong>
                  <span className="text-xs font-semibold text-[#667085]">
                    {formatDuration(recording.durationSeconds)}
                  </span>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  {recording.url !== "#" ? (
                    <a
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#d9e0e7] bg-white px-2.5 text-xs font-semibold text-[#101820] transition hover:border-[#A07C3B]"
                      href={recording.url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <PlayCircle aria-hidden="true" size={13} />
                      Assistir
                    </a>
                  ) : null}
                  {downloadUrl && downloadUrl !== "#" ? (
                    <a
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#101820] bg-[#101820] px-2.5 text-xs font-semibold text-white transition hover:bg-black"
                      download={recording.name}
                      href={downloadUrl}
                    >
                      <Download aria-hidden="true" size={13} />
                      Baixar
                    </a>
                  ) : null}
                  {recording.blob ? (
                    <button
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#d9e0e7] bg-white px-2.5 text-xs font-semibold text-[#101820] transition hover:bg-[#f8fafc] disabled:cursor-wait disabled:opacity-60"
                      disabled={saving || Boolean(recording.transcribedAt)}
                      onClick={() =>
                        void onTranscribeRecording({
                          file: recording.blob as Blob,
                          fileName: recording.name,
                          meeting,
                          recordingId: recording.id,
                        })
                      }
                      type="button"
                    >
                      <Mic aria-hidden="true" size={13} />
                      {recording.transcribedAt ? "Transcrita" : "Transcrever"}
                    </button>
                  ) : null}
                </div>
              </div>
              {recording.url !== "#" ? (
                <video
                  className="mt-3 aspect-video w-full rounded-md border border-[#d9e0e7] bg-black"
                  controls
                  preload="metadata"
                  src={recording.url}
                />
              ) : null}
            </div>
          );
        })}
        {recordings.length === 0 ? (
          <EmptyPanel text="Nenhuma gravacao registrada." />
        ) : null}
      </div>
    </Surface>
  );
}

function RecordingContextPanel({ meeting }: { meeting: ChronosMeeting }) {
  return (
    <Surface bordered className="min-h-full border-[#d9e0e7] bg-white p-4">
      <PanelTitle eyebrow="Gravacoes" title="Identificacao da reuniao" />
      <div className="mt-4 grid gap-3">
        <InfoBlock label="protocolo" value={meeting.protocol} />
        <InfoBlock label="reuniao" value={meeting.title} />
        <InfoBlock label="data" value={formatDateTime(meeting.startsAt)} />
        <InfoBlock label="sala" value={meeting.room?.name ?? "-"} />
        <InfoBlock
          label="gravacao"
          value={chronosCaptureStatusLabels[meeting.recordingStatus]}
        />
        <InfoBlock
          label="transcricao"
          value={chronosCaptureStatusLabels[meeting.transcriptionStatus]}
        />
      </div>
    </Surface>
  );
}

function TranscriptPanel({
  meeting,
  onUpdate,
  saving,
  userName,
}: {
  meeting: ChronosMeeting;
  onUpdate: (input: Parameters<typeof updateChronosMeeting>[0]) => Promise<void>;
  saving: boolean;
  userName: string;
}) {
  const [speakerLabel, setSpeakerLabel] = useState(userName);
  const [content, setContent] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await onUpdate({
      action: "add_transcript",
      content,
      meetingId: meeting.id,
      speakerLabel,
    });
    setContent("");
  }

  return (
    <Surface bordered className="grid min-h-full grid-rows-[auto_auto_minmax(0,1fr)] border-[#d9e0e7] bg-white">
      <div className="border-b border-[#edf0f4] p-4">
        <PanelTitle eyebrow="Transcricao" title="Memoria textual" />
      </div>
      <form className="grid gap-2 border-b border-[#edf0f4] bg-[#fafbfc] p-3" onSubmit={handleSubmit}>
        <input
          className="h-9 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm outline-none focus:border-[#A07C3B]"
          onChange={(event) => setSpeakerLabel(event.target.value)}
          placeholder="Participante"
          value={speakerLabel}
        />
        <textarea
          className="min-h-24 resize-none rounded-md border border-[#d9e0e7] bg-white p-3 text-sm outline-none focus:border-[#A07C3B]"
          onChange={(event) => setContent(event.target.value)}
          placeholder="Trecho da transcricao"
          required
          value={content}
        />
        <button
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[#101820] px-3 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-60"
          disabled={saving}
          type="submit"
        >
          <Mic aria-hidden="true" size={15} />
          Registrar
        </button>
      </form>
      <div className="min-h-0 overflow-y-auto p-3">
        {meeting.transcript.map((segment) => (
          <div
            className="mb-2 rounded-md border border-[#edf0f4] bg-[#fafbfc] p-3"
            key={segment.id}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase text-[#667085]">
                {segment.speakerLabel ?? "Participante"}
              </span>
              <span className="text-xs text-[#98a2b3]">
                {formatDateTime(segment.createdAt)}
              </span>
            </div>
            <p className="m-0 mt-2 text-sm leading-6 text-[#344054]">
              {segment.content}
            </p>
          </div>
        ))}
        {meeting.transcript.length === 0 ? (
          <EmptyPanel text="Nenhum trecho transcrito." />
        ) : null}
      </div>
    </Surface>
  );
}

function MinutesPanel({
  meeting,
  onGenerateMinutesDraft,
  onUpdate,
  saving,
}: {
  meeting: ChronosMeeting;
  onGenerateMinutesDraft: (
    meeting: ChronosMeeting,
    minutesProfile: ChronosMinutesProfile,
  ) => Promise<void>;
  onUpdate: (input: Parameters<typeof updateChronosMeeting>[0]) => Promise<void>;
  saving: boolean;
}) {
  const latestMinutes = meeting.minutes[0];
  const [minutesProfile, setMinutesProfile] =
    useState<ChronosMinutesProfile>("alinhamento");
  const [minutesDraft, setMinutesDraft] = useState(
    latestMinutes?.content || buildMinutesDraft(meeting),
  );

  useEffect(() => {
    setMinutesDraft(latestMinutes?.content || buildMinutesDraft(meeting));
  }, [latestMinutes?.content, meeting]);

  async function saveMinutes(status: ChronosMinutesStatus) {
    await onUpdate({
      action: "save_minutes",
      content: minutesDraft,
      meetingId: meeting.id,
      status,
    });
  }

  return (
    <Surface bordered className="grid min-h-full grid-rows-[auto_minmax(0,1fr)_auto] border-[#d9e0e7] bg-white">
      <div className="flex items-start justify-between gap-3 border-b border-[#edf0f4] p-4">
        <PanelTitle eyebrow="Ata" title="Formalizacao" />
        <Badge variant={minutesVariant[meeting.minutesStatus]}>
          {chronosMinutesStatusLabels[meeting.minutesStatus]}
        </Badge>
      </div>
      <div className="min-h-0 overflow-y-auto p-4">
        <div className="mb-4 grid gap-2">
          <div className="flex flex-wrap gap-2">
            {Object.entries(chronosMinutesProfileLabels).map(
              ([profileId, label]) => (
                <button
                  className={`inline-flex h-9 items-center justify-center rounded-md border px-3 text-sm font-semibold transition ${
                    minutesProfile === profileId
                      ? "border-[#101820] bg-[#101820] text-white"
                      : "border-[#d9e0e7] bg-white text-[#526078] hover:bg-[#f8fafc]"
                  }`}
                  key={profileId}
                  onClick={() =>
                    setMinutesProfile(profileId as ChronosMinutesProfile)
                  }
                  type="button"
                >
                  {label}
                </button>
              ),
            )}
          </div>
          <button
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm font-semibold text-[#101820] transition hover:bg-[#f8fafc] disabled:cursor-wait disabled:opacity-60"
            disabled={saving}
            onClick={() => void onGenerateMinutesDraft(meeting, minutesProfile)}
            type="button"
          >
            <Sparkles aria-hidden="true" size={15} />
            Gerar ata Athena
          </button>
          <div className="rounded-md border border-[#edf0f4] bg-[#fafbfc] p-3 text-sm leading-6 text-[#344054]">
            {meeting.executiveSummary || "Resumo executivo pendente."}
          </div>
        </div>
        <textarea
          className="min-h-[22rem] w-full resize-none rounded-md border border-[#d9e0e7] bg-white p-3 text-sm leading-6 outline-none focus:border-[#A07C3B]"
          onChange={(event) => setMinutesDraft(event.target.value)}
          value={minutesDraft}
        />
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#edf0f4] p-3">
        <button
          className="inline-flex h-9 items-center gap-2 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm font-semibold text-[#101820] transition hover:bg-[#f8fafc] disabled:cursor-wait disabled:opacity-60"
          disabled={saving}
          onClick={() => void saveMinutes("in_review")}
          type="button"
        >
          <Save aria-hidden="true" size={15} />
          Revisao
        </button>
        <button
          className="inline-flex h-9 items-center gap-2 rounded-md bg-[#101820] px-3 text-sm font-semibold text-white transition hover:bg-[#1f2937] disabled:cursor-wait disabled:opacity-60"
          disabled={saving}
          onClick={() => void saveMinutes("approved")}
          type="button"
        >
          <ShieldCheck aria-hidden="true" size={15} />
          Aprovar
        </button>
      </div>
    </Surface>
  );
}

function ParticipantMiniPanel({ meeting }: { meeting: ChronosMeeting | null }) {
  return (
    <MiniPanel
      icon={<UsersRound size={16} />}
      label="participantes"
      value={String(meeting?.participants.length ?? 0)}
    />
  );
}

function RoomProtocolPanel({ meeting }: { meeting: ChronosMeeting | null }) {
  return (
    <MiniPanel
      icon={<ShieldCheck size={16} />}
      label="protocolo"
      value={meeting?.protocol ?? "-"}
    />
  );
}

function CaptureStatusPanel({ meeting }: { meeting: ChronosMeeting | null }) {
  return (
    <MiniPanel
      icon={<Mic size={16} />}
      label="transcricao"
      value={
        meeting ? chronosCaptureStatusLabels[meeting.transcriptionStatus] : "-"
      }
    />
  );
}

function MiniPanel({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="grid min-h-16 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-md border border-white/[0.08] bg-white/[0.045] p-3">
      <span className="text-[#D6B56F]">{icon}</span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-white">
          {value}
        </span>
        <span className="block truncate text-xs font-semibold uppercase text-[#9aa5b5]">
          {label}
        </span>
      </span>
    </div>
  );
}

function RoomButton({
  disabled,
  icon,
  label,
  onClick,
}: {
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="inline-flex h-9 items-center gap-2 rounded-md border border-white/[0.1] bg-white/[0.055] px-3 text-sm font-semibold text-[#d7dee8] transition hover:border-[#A07C3B]/40 hover:bg-white/[0.09] hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {icon}
      {label}
    </button>
  );
}

function StatusActionButton({
  disabled,
  icon,
  label,
  onClick,
}: {
  disabled: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[#d9e0e7] bg-white px-2 text-sm font-semibold text-[#101820] transition hover:bg-[#f8fafc] disabled:cursor-wait disabled:opacity-60"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {icon}
      {label}
    </button>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[#edf0f4] bg-[#fafbfc] p-3">
      <p className="m-0 text-xs font-bold uppercase text-[#667085]">{label}</p>
      <p className="m-0 mt-1 whitespace-pre-wrap text-sm font-semibold leading-6 text-[#101820]">
        {value}
      </p>
    </div>
  );
}

function PanelTitle({
  dark,
  eyebrow,
  title,
}: {
  dark?: boolean;
  eyebrow: string;
  title: string;
}) {
  return (
    <div className="min-w-0">
      <p
        className={`m-0 text-xs font-bold uppercase ${
          dark ? "text-[#9aa5b5]" : "text-[#667085]"
        }`}
      >
        {eyebrow}
      </p>
      <h2
        className={`m-0 mt-1 truncate text-base font-semibold ${
          dark ? "text-white" : "text-[#101820]"
        }`}
      >
        {title}
      </h2>
    </div>
  );
}

function EmptyPanel({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed border-[#d9e0e7] bg-[#fafbfc] p-4 text-sm text-[#667085]">
      {text}
    </div>
  );
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setDate(date.getDate() + days);

  return nextDate;
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function addYears(date: Date, years: number) {
  return new Date(date.getFullYear() + years, 0, 1);
}

function setDateHour(date: Date, hour: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour);
}

function roundDateToNextHour(date: Date) {
  const nextDate = new Date(date);

  nextDate.setMinutes(0, 0, 0);

  if (date.getMinutes() > 0 || date.getSeconds() > 0) {
    nextDate.setHours(nextDate.getHours() + 1);
  }

  return nextDate;
}

function sameDay(firstDate: Date, secondDate: Date) {
  return (
    firstDate.getFullYear() === secondDate.getFullYear() &&
    firstDate.getMonth() === secondDate.getMonth() &&
    firstDate.getDate() === secondDate.getDate()
  );
}

function getWeekDays(date: Date) {
  const weekStart = addDays(startOfDay(date), -date.getDay());

  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

function getMonthMatrix(date: Date) {
  const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
  const calendarStart = addDays(firstDay, -firstDay.getDay());

  return Array.from({ length: 42 }, (_, index) => addDays(calendarStart, index));
}

function sameMeetingDay(meeting: ChronosMeeting, date: Date) {
  if (!meeting.startsAt) {
    return false;
  }

  const meetingDate = new Date(meeting.startsAt);

  return !Number.isNaN(meetingDate.getTime()) && sameDay(meetingDate, date);
}

function meetingStartsInHour(meeting: ChronosMeeting, date: Date) {
  if (!meeting.startsAt) {
    return false;
  }

  const meetingDate = new Date(meeting.startsAt);

  return (
    !Number.isNaN(meetingDate.getTime()) &&
    sameDay(meetingDate, date) &&
    meetingDate.getHours() === date.getHours()
  );
}

function toDateTimeLocalValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function addMinutesToDateTimeLocal(value: string, minutes: number) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  date.setMinutes(date.getMinutes() + minutes);

  return toDateTimeLocalValue(date);
}

function formatWeekday(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", { weekday: "short" })
    .format(date)
    .replace(".", "");
}

function formatMonthName(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", { month: "long" }).format(date);
}

function formatMeetingHour(meeting: ChronosMeeting) {
  if (!meeting.startsAt) {
    return "--:--";
  }

  const startsAt = formatTimeOnly(meeting.startsAt);
  const endsAt = meeting.endsAt ? formatTimeOnly(meeting.endsAt) : null;

  return endsAt ? `${startsAt} - ${endsAt}` : startsAt;
}

function formatTimeOnly(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function getChronosMeetingLocationLabel(meeting: ChronosMeeting) {
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

function formatCalendarPeriod(date: Date, view: ChronosCalendarView) {
  if (view === "year") {
    return String(date.getFullYear());
  }

  if (view === "month") {
    return `${formatMonthName(date)} de ${date.getFullYear()}`;
  }

  if (view === "week") {
    const [firstDate, , , , , , lastDate] = getWeekDays(date);

    if (!firstDate || !lastDate) {
      return formatDateTime(date.toISOString());
    }

    return `${firstDate.getDate()} ${formatMonthName(firstDate)} - ${lastDate.getDate()} ${formatMonthName(lastDate)}`;
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "full",
  }).format(date);
}

function buildChronosMetrics(meetings: ChronosMeeting[]) {
  return {
    followUpsOpen: meetings.reduce(
      (total, meeting) =>
        total +
        meeting.followUps.filter((followUp) => followUp.status !== "done")
          .length,
      0,
    ),
    live: meetings.filter((meeting) => meeting.status === "live").length,
    minutesPending: meetings.filter(
      (meeting) => meeting.minutesStatus !== "approved",
    ).length,
    minutesReview: meetings.filter(
      (meeting) => meeting.minutesStatus === "in_review",
    ).length,
    today: meetings.filter((meeting) => isToday(meeting.startsAt)).length,
    total: meetings.length,
  };
}

function filterChronosMeetings(
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

function sortMeetingsByDate(meetings: ChronosMeeting[]) {
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

function countOpenFollowUps(meeting: ChronosMeeting) {
  return meeting.followUps.filter((followUp) => followUp.status !== "done")
    .length;
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

function buildChronosNextAction(meeting: ChronosMeeting) {
  const openFollowUps = countOpenFollowUps(meeting);

  if (meeting.status === "scheduled") {
    return {
      badge: "agenda",
      description:
        "Confirmar sala, participantes, pauta e referencia externa antes de abrir a entrada.",
      title: "Preparar compromisso executivo",
      variant: "neutral" as BadgeVariant,
    };
  }

  if (meeting.status === "lobby") {
    return {
      badge: "entrada",
      description:
        "Validar presenca dos participantes e iniciar a reuniao somente quando a sala estiver pronta.",
      title: "Controlar entrada da reuniao",
      variant: "info" as BadgeVariant,
    };
  }

  if (meeting.status === "live") {
    return {
      badge: "ao vivo",
      description:
        "Manter gravacao, transcricao e marcos de timeline acompanhados durante a sessao.",
      title: "Conduzir registro formal",
      variant: "danger" as BadgeVariant,
    };
  }

  if (!meeting.executiveSummary) {
    return {
      badge: "resumo",
      description:
        "Gerar ou registrar resumo executivo antes de submeter a ata para revisao humana.",
      title: "Criar resumo executivo",
      variant: "warning" as BadgeVariant,
    };
  }

  if (meeting.minutesStatus === "not_started" || meeting.minutesStatus === "draft") {
    return {
      badge: "ata",
      description:
        "Revisar o rascunho, ajustar decisoes e enviar a ata para revisao humana.",
      title: "Submeter ata para revisao",
      variant: "warning" as BadgeVariant,
    };
  }

  if (meeting.minutesStatus === "in_review") {
    return {
      badge: "revisao",
      description:
        "Aprovar somente depois de leitura humana. O Chronos nao formaliza ata automaticamente.",
      title: "Aprovar ata revisada",
      variant: "warning" as BadgeVariant,
    };
  }

  if (openFollowUps > 0) {
    return {
      badge: "follow-up",
      description: `Acompanhar ${openFollowUps} encaminhamento${
        openFollowUps === 1 ? "" : "s"
      } antes de encerrar a memoria executiva.`,
      title: "Acompanhar encaminhamentos",
      variant: "info" as BadgeVariant,
    };
  }

  if (meeting.status !== "closed") {
    return {
      badge: "fechamento",
      description:
        "Ata aprovada e encaminhamentos resolvidos. A reuniao ja pode ser fechada formalmente.",
      title: "Fechar memoria executiva",
      variant: "success" as BadgeVariant,
    };
  }

  return {
    badge: "formalizada",
    description:
      "Reuniao preservada como historico formal, com rastreabilidade e memoria executiva.",
    title: "Historico concluido",
    variant: "success" as BadgeVariant,
  };
}

function parseLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function getChronosApoloAccessToken() {
  const client = getHubSupabaseClient();

  if (!client) {
    throw new Error("Sessao administrativa ausente.");
  }

  const sessionResult = await client.auth.getSession();
  const accessToken = sessionResult.data.session?.access_token ?? null;

  if (sessionResult.error || !accessToken) {
    throw new Error("Sessao administrativa ausente.");
  }

  return accessToken;
}

function mapApoloEntityToChronosInvitee(
  entity: ApoloEntity,
): ChronosApoloInvitee {
  const email = entity.contacts.find(
    (contact) => contact.type === "email" && contact.value.trim(),
  )?.value;
  const phone = entity.contacts.find(
    (contact) =>
      (contact.type === "whatsapp" || contact.type === "phone") &&
      contact.value.trim(),
  )?.value;

  return {
    displayName: entity.displayName,
    email,
    entityId: entity.id,
    organization: entity.relationships[0]?.label ?? entity.locationLabel,
    phone,
  };
}

function hasChronosInviteeContact(invitee: ChronosApoloInvitee) {
  return Boolean(invitee.email || invitee.phone);
}

function parseParticipants(value: string) {
  return parseLines(value).map((line) => {
    const [displayName = "", email = "", organization = ""] = line
      .split("|")
      .map((part) => part.trim());

    return {
      displayName,
      email,
      organization,
      role: "participant" as const,
    };
  });
}

function buildMinutesDraft(meeting: ChronosMeeting) {
  const participants = meeting.participants
    .map((participant) => participant.displayName)
    .join(", ");
  const timeline = meeting.timeline
    .slice(0, 8)
    .map((event) => `- ${event.title}`)
    .join("\n");
  const followUps = meeting.followUps
    .map((followUp) => `- ${followUp.title} / ${followUp.ownerName ?? "-"}`)
    .join("\n");

  return [
    `Ata ${meeting.protocol}`,
    "",
    `Reuniao: ${meeting.title}`,
    `Data: ${formatDateTime(meeting.startsAt)}`,
    `Participantes: ${participants || "-"}`,
    "",
    "Resumo executivo:",
    meeting.executiveSummary || "-",
    "",
    "Linha do tempo:",
    timeline || "-",
    "",
    "Follow-ups:",
    followUps || "-",
    "",
    "Status: rascunho sujeito a revisao humana.",
  ].join("\n");
}

function mapPersistedRecording(
  recording: ChronosMeeting["recordings"][number],
  meetingId: string,
): LocalRecording {
  return {
    downloadUrl: recording.downloadUrl ?? recording.playbackUrl ?? "#",
    durationSeconds: recording.durationSeconds ?? 0,
    id: recording.id,
    meetingId,
    mimeType: recording.mimeType,
    name: recording.fileName ?? recording.storagePath ?? recording.status,
    url: recording.playbackUrl ?? recording.downloadUrl ?? "#",
  };
}

function createRoomDraft(room: ChronosRoom | null): ChronosRoomDraft {
  const background = readRoomBackground(room);

  return {
    backgroundDataUrl: background.dataUrl,
    backgroundName: background.name,
    capacity: String(room?.capacity ?? 12),
    minutesRequired: room?.minutesRequired ?? true,
    name: room?.name ?? "",
    recordingRequired: room?.recordingRequired ?? true,
    roomType: normalizeChronosProfileId(room?.roomType),
    slug: room?.slug ?? "",
    transcriptionRequired: room?.transcriptionRequired ?? true,
  };
}

function buildRoomInputFromDraft(draft: ChronosRoomDraft): ChronosRoomInput {
  const name = draft.name.trim();

  return {
    backgroundDataUrl: draft.backgroundDataUrl || undefined,
    backgroundName: draft.backgroundName || undefined,
    capacity: Number(draft.capacity || 12),
    minutesRequired: draft.minutesRequired,
    name,
    recordingRequired: draft.recordingRequired,
    roomType: normalizeChronosProfileId(draft.roomType),
    slug: slugifyRoomName(draft.slug || name),
    transcriptionRequired: draft.transcriptionRequired,
  };
}

function normalizeChronosProfileId(value?: string | null) {
  const candidate = value ?? "";

  return defaultChronosMeetingProfiles.some((profile) => profile.id === candidate)
    ? candidate
    : defaultChronosMeetingProfiles[0].id;
}

function getChronosProfileLabel(
  profiles: ReadonlyArray<Pick<ChronosMeetingProfile, "id" | "label">>,
  value?: string | null,
) {
  const profileId = normalizeChronosProfileId(value);

  return (
    profiles.find((profile) => profile.id === profileId)?.label ??
    defaultChronosMeetingProfiles.find((profile) => profile.id === profileId)?.label ??
    defaultChronosMeetingProfiles[0].label
  );
}

function readRoomBackground(room: ChronosRoom | null) {
  const background =
    room?.metadata && typeof room.metadata.background === "object"
      ? (room.metadata.background as Record<string, unknown>)
      : null;

  return {
    dataUrl:
      typeof background?.dataUrl === "string" ? background.dataUrl : "",
    name: typeof background?.name === "string" ? background.name : "",
  };
}

function slugifyRoomName(value: string) {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return slug || "";
}

function buildExternalRoomLink(slug: string) {
  return `/chronos/${slug || "nome-da-sala"}`;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener("load", () => {
      resolve(typeof reader.result === "string" ? reader.result : "");
    });
    reader.addEventListener("error", () => {
      reject(new Error("Nao foi possivel ler o fundo da sala."));
    });
    reader.readAsDataURL(file);
  });
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return "-";
  }

  try {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return "-";
  }
}

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getSupportedRecordingMimeType() {
  const candidates = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}
