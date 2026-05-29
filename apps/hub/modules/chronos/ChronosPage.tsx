"use client";

import {
  createChronosMeeting,
  createChronosRoom,
  deleteChronosMeeting,
  deleteChronosRoom,
  draftChronosMinutes,
  loadChronosGoogleCalendarStatus,
  loadChronosSnapshot,
  searchChronosInternalInvitees,
  syncChronosGoogleCalendar,
  transcribeChronosRecording,
  updateChronosRoom,
  updateChronosMeeting,
} from "@/lib/chronos/client";
import {
  chronosCalendarEventKindLabels,
  chronosCaptureStatusLabels,
  chronosMeetingStatusLabels,
  chronosMeetingTypeLabels,
  chronosMeetingTypes,
  chronosMinutesProfileLabels,
  chronosMinutesStatusLabels,
  defaultChronosMeetingProfiles,
  type ChronosApoloInvitee,
  type ChronosCalendarEventKind,
  type ChronosCaptureStatus,
  type ChronosCreateMeetingInput,
  type ChronosGoogleCalendarStatus,
  type ChronosHubInvitee,
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
  Folder,
  FolderOpen,
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
type ChronosDriveViewMode = "grid" | "list";

type ChronosAgendaFilter = "all" | "today" | "live" | "review" | "followups";

type ChronosCalendarView = "day" | "week" | "month" | "year" | "list";
type ChronosApoloSearchState = "error" | "idle" | "loading" | "ready";
type ChronosInviteeSource = "external" | "internal";

const chronosCalendarLegendItems = [
  { color: "#2f80ed", label: "Alinhamento" },
  { color: "#12b76a", label: "Resultado" },
  { color: "#f59e0b", label: "Comunicado" },
  { color: "#101820", label: "Reuniao" },
] as const;

type ChronosAgendaInvitee = ChronosApoloInvitee & {
  operationalProfile?: string | null;
  role?: string | null;
  source: ChronosInviteeSource;
  userId?: string;
};

const chronosCalendarLegendItems = [
  { color: "#2f80ed", label: "Alinhamento" },
  { color: "#12b76a", label: "Resultado" },
  { color: "#f59e0b", label: "Comunicado" },
  { color: "#101820", label: "Reuniao" },
] as const;

type ChronosRoomDraft = {
  backgroundDataUrl: string;
  backgroundName: string;
  capacity: string;
  minutesRequired: boolean;
  name: string;
  recordingRequired: boolean;
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
  sizeBytes?: number | null;
  startedAt?: string | null;
  status?: ChronosCaptureStatus;
  stoppedAt?: string | null;
  transcribedAt?: string;
  url: string;
};

type ChronosDriveRecordingItem = LocalRecording & {
  meeting: ChronosMeeting;
  roomLabel: string;
  sectorLabel: string;
};

type ChronosDriveRecordingFolder = {
  id: string;
  label: string;
  latestAt?: string | null;
  meetings: ChronosDriveRecordingMeeting[];
  roomLabels: string[];
  subtitle: string;
  totalRecordings: number;
  totalMeetings: number;
};

type ChronosDriveRecordingMeeting = {
  availableRecordings: number;
  id: string;
  latestAt?: string | null;
  meeting: ChronosMeeting;
  participantText: string;
  primaryRecording: ChronosDriveRecordingItem | null;
  recordings: ChronosDriveRecordingItem[];
  roomLabel: string;
  sectorLabel: string;
  totalDurationSeconds: number;
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

const chronosMeetingTypeVisuals = {
  alignment: {
    accentClass: "border-l-blue-500",
    chipClass: "border-blue-100 bg-blue-50 text-blue-700",
    dotClass: "bg-blue-500",
    label: "Alinhamento",
    pillClass: "border-blue-200 bg-blue-50 text-blue-700",
  },
  client: {
    accentClass: "border-l-[#A07C3B]",
    chipClass: "border-[#eadfcb] bg-[#fff8e8] text-[#7a5a1f]",
    dotClass: "bg-[#A07C3B]",
    label: "Reuniao",
    pillClass: "border-[#eadfcb] bg-[#fff8e8] text-[#7a5a1f]",
  },
  executive: {
    accentClass: "border-l-[#101820]",
    chipClass: "border-[#d9e0e7] bg-[#f8fafc] text-[#101820]",
    dotClass: "bg-[#101820]",
    label: "Reuniao",
    pillClass: "border-[#d9e0e7] bg-[#f8fafc] text-[#101820]",
  },
  external: {
    accentClass: "border-l-[#526078]",
    chipClass: "border-[#d9e0e7] bg-[#f8fafc] text-[#526078]",
    dotClass: "bg-[#526078]",
    label: "Reuniao",
    pillClass: "border-[#d9e0e7] bg-[#f8fafc] text-[#526078]",
  },
  formal: {
    accentClass: "border-l-amber-500",
    chipClass: "border-amber-100 bg-amber-50 text-amber-800",
    dotClass: "bg-amber-500",
    label: "Comunicado",
    pillClass: "border-amber-200 bg-amber-50 text-amber-800",
  },
  results: {
    accentClass: "border-l-emerald-500",
    chipClass: "border-emerald-100 bg-emerald-50 text-emerald-700",
    dotClass: "bg-emerald-500",
    label: "Resultado",
    pillClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
} as const satisfies Record<
  ChronosMeetingType,
  {
    accentClass: string;
    chipClass: string;
    dotClass: string;
    label: string;
    pillClass: string;
  }
>;

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

  async function handleDeleteMeeting(meetingId: string) {
    if (!canManageChronos) {
      setError("Seu usuario pode visualizar o Chronos, mas nao gerenciar reunioes.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await deleteChronosMeeting({ meetingId });
      setSnapshot((currentSnapshot) => ({
        ...currentSnapshot,
        meetings: currentSnapshot.meetings.filter(
          (meeting) => meeting.id !== meetingId,
        ),
      }));
      setSelectedMeetingId((currentId) =>
        currentId === meetingId ? "" : currentId,
      );
      await reloadChronos();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Nao foi possivel excluir o evento.",
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

        {activeView === "agenda" ? (
          <ChronosAgendaScreen
            canManage={canManageChronos}
            meetings={snapshot.meetings}
            onCreate={handleCreateMeeting}
            onDeleteMeeting={handleDeleteMeeting}
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
      <div className="flex gap-1 overflow-x-auto border-b border-[#d9e0e7] pb-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeDriveView === tab.id;

          return (
            <button
              aria-pressed={isActive}
              className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-semibold transition ${
                isActive
                  ? "bg-[#101820] text-white"
                  : "text-[#667085] hover:bg-white hover:text-[#101820]"
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
      <div className="min-h-0">{children}</div>
    </div>
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
        sizeBytes: blob.size,
        startedAt: new Date(recordingStartedAtRef.current).toISOString(),
        status: "available",
        stoppedAt: new Date().toISOString(),
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
        onDeleteMeeting={async () => undefined}
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
  onDeleteMeeting,
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
  onDeleteMeeting: (meetingId: string) => Promise<void>;
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
  const [detailMeetingId, setDetailMeetingId] = useState<string | null>(null);
  const [draftStartsAt, setDraftStartsAt] = useState<string | null>(null);
  const [googleCalendarStatus, setGoogleCalendarStatus] =
    useState<ChronosGoogleCalendarStatus | null>(null);
  const [googleCalendarError, setGoogleCalendarError] = useState<string | null>(
    null,
  );
  const [googleCalendarConnecting, setGoogleCalendarConnecting] =
    useState(false);
  const [googleCalendarSyncing, setGoogleCalendarSyncing] = useState(false);
  const [googleCalendarAutoSyncing, setGoogleCalendarAutoSyncing] =
    useState(false);
  const [googleCalendarAutoSyncedAt, setGoogleCalendarAutoSyncedAt] =
    useState<string | null>(null);
  const googleCalendarAutoSyncInFlightRef = useRef(false);
  const googleCalendarLastAutoSyncAtRef = useRef(0);
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

  function openMeetingDetails(meetingId: string) {
    onSelectMeeting(meetingId);
    setDetailMeetingId(meetingId);
  }

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

  const runGoogleCalendarAutoSync = useCallback(
    async (trigger: "interval" | "visible") => {
      if (
        !googleCalendarStatus?.connection.connected ||
        googleCalendarAutoSyncInFlightRef.current ||
        googleCalendarSyncing
      ) {
        return;
      }

      const now = Date.now();
      const minimumGapMs = trigger === "visible" ? 20_000 : 55_000;

      if (now - googleCalendarLastAutoSyncAtRef.current < minimumGapMs) {
        return;
      }

      googleCalendarAutoSyncInFlightRef.current = true;
      googleCalendarLastAutoSyncAtRef.current = now;
      setGoogleCalendarAutoSyncing(true);

      try {
        const result = await syncChronosGoogleCalendar("pull");

        if (result.status !== "failed") {
          setGoogleCalendarAutoSyncedAt(new Date().toISOString());
          await Promise.all([refreshGoogleCalendarStatus(), onRefresh()]);
        }
      } catch {
        // Auto-sync e silencioso para nao atrapalhar a operacao manual da agenda.
      } finally {
        googleCalendarAutoSyncInFlightRef.current = false;
        setGoogleCalendarAutoSyncing(false);
      }
    },
    [
      googleCalendarStatus?.connection.connected,
      googleCalendarSyncing,
      onRefresh,
      refreshGoogleCalendarStatus,
    ],
  );

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

  useEffect(() => {
    if (!googleCalendarStatus?.connection.connected) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (!document.hidden) {
        void runGoogleCalendarAutoSync("interval");
      }
    }, 60_000);
    const handleFocus = () => {
      void runGoogleCalendarAutoSync("visible");
    };
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        void runGoogleCalendarAutoSync("visible");
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [googleCalendarStatus?.connection.connected, runGoogleCalendarAutoSync]);

  const googleCalendarConnected = Boolean(
    googleCalendarStatus?.connection.connected,
  );
  const googleCalendarReady = Boolean(
    googleCalendarStatus?.configured &&
      googleCalendarStatus.connection.storageReady,
  );

  return (
    <Surface bordered className="relative grid min-h-[45rem] grid-rows-[auto_minmax(0,1fr)] overflow-hidden border-[#d9e0e7] bg-white">
      <div className="grid gap-3 border-b border-[#edf0f4] p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="m-0 text-base font-semibold text-[#101820]">Agenda</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Tooltip
              content={
                <ChronosGoogleCalendarStatusPopup
                  autoSyncedAt={googleCalendarAutoSyncedAt}
                  autoSyncing={googleCalendarAutoSyncing}
                  error={googleCalendarError}
                  status={googleCalendarStatus}
                  syncing={googleCalendarSyncing}
                />
              }
              contentClassName="w-72 text-left"
              placement="bottom"
            >
              <button
                aria-label={
                  googleCalendarConnected
                    ? "Google conectado"
                    : "Conectar Google"
                }
                className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-55 ${
                  googleCalendarConnected
                    ? "border-[#b7ebc6] bg-white text-[#067647] hover:bg-[#f1fbf5]"
                    : "border-[#d9e0e7] bg-white text-[#101820] hover:bg-[#f8fafc]"
                }`}
                disabled={googleCalendarConnecting || !googleCalendarReady}
                onClick={
                  googleCalendarConnected
                    ? refreshGoogleCalendarStatus
                    : handleGoogleCalendarConnect
                }
                type="button"
              >
                <GoogleGlyph connected={googleCalendarConnected} />
                {googleCalendarConnecting
                  ? "Abrindo..."
                  : googleCalendarConnected
                    ? "Google"
                    : "Conectar Google"}
              </button>
            </Tooltip>
            <button
              aria-label="Atualizar Google Agenda"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#d9e0e7] bg-white px-2.5 text-xs font-semibold text-[#101820] transition hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-55"
              disabled={!googleCalendarConnected || googleCalendarSyncing}
              onClick={handleGoogleCalendarSync}
              type="button"
            >
              <RefreshCcw
                aria-hidden="true"
                className={googleCalendarSyncing ? "animate-spin" : undefined}
                size={15}
              />
              {googleCalendarSyncing ? "Atualizando..." : "Atualizar"}
            </button>
            <button
              className="inline-flex h-8 items-center gap-2 rounded-md bg-[#101820] px-3 text-xs font-semibold text-white transition hover:bg-[#1f2937] disabled:cursor-not-allowed disabled:opacity-55"
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
          <div className="flex flex-wrap items-center justify-end gap-3">
            <ChronosCalendarLegend />
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

function ChronosCalendarEventDetailsPopup({
  meeting,
  onClose,
  onDelete,
  saving,
}: {
  meeting: ChronosMeeting;
  onClose: () => void;
  onDelete: (meetingId: string) => Promise<void>;
  saving: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const roomPath = getChronosMeetingRoomPath(meeting);
  const roomUrl =
    roomPath && typeof window !== "undefined"
      ? new URL(roomPath, window.location.origin).toString()
      : roomPath;
  const eventKind = getChronosCalendarEventKind(meeting);
  const meetingProfile = getChronosMeetingProfileLabel(meeting);
  const participants = meeting.participants.filter(
    (participant) => participant.role !== "host",
  );

  async function copyRoomLink() {
    if (!roomUrl) {
      return;
    }

    await navigator.clipboard.writeText(roomUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function requestDelete() {
    if (!window.confirm(`Excluir "${meeting.title}" da agenda Chronos?`)) {
      return;
    }

    await onDelete(meeting.id);
  }

  return (
    <section
      aria-label="Detalhes do evento Chronos"
      className="relative z-10 grid max-h-[calc(100vh-7rem)] w-full max-w-[34rem] gap-4 overflow-auto rounded-lg border border-[#d9e0e7] bg-white p-4 shadow-[0_22px_70px_rgb(16_24_32_/_0.22)]"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="neutral">
              {chronosCalendarEventKindLabels[eventKind]}
            </Badge>
            <Badge variant={statusVariant[meeting.status]}>
              {chronosMeetingStatusLabels[meeting.status]}
            </Badge>
          </div>
          <h2 className="mt-3 truncate text-xl font-semibold text-[#101820]">
            {meeting.title}
          </h2>
          <p className="m-0 mt-1 text-sm font-medium text-[#667085]">
            {formatDateTime(meeting.startsAt)}
            {meeting.endsAt ? ` - ${formatDateTime(meeting.endsAt)}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            aria-label="Excluir evento"
            className="grid h-8 w-8 place-items-center rounded-md text-red-600 transition hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-red-200 disabled:cursor-wait disabled:opacity-55"
            disabled={saving}
            onClick={() => void requestDelete()}
            type="button"
          >
            <Trash2 aria-hidden="true" size={16} />
          </button>
          <button
            aria-label="Fechar detalhes"
            className="grid h-8 w-8 place-items-center rounded-md text-[#667085] transition hover:bg-[#f5f7fa] hover:text-[#101820] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={17} />
          </button>
        </div>
      </div>

      <div className="grid gap-2 rounded-md border border-[#edf0f4] bg-[#fafbfc] p-3 text-sm">
        <DetailRow label="Tipo" value={meetingProfile} />
        <DetailRow label="Local" value={getChronosMeetingLocationLabel(meeting)} />
        <DetailRow label="Host" value={meeting.hostName ?? "Host Chronos"} />
        <DetailRow label="Protocolo" value={meeting.protocol} />
      </div>

      {roomUrl ? (
        <div className="grid gap-2 rounded-md border border-[#d9e0e7] bg-white p-3">
          <p className="m-0 text-xs font-bold uppercase text-[#667085]">
            Link da sala
          </p>
          <div className="flex min-w-0 items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md bg-[#f5f7fa] px-2 py-2 text-xs font-semibold text-[#344054]">
              {roomUrl}
            </code>
            <button
              aria-label="Copiar link da sala"
              className="grid h-9 w-9 place-items-center rounded-md border border-[#d9e0e7] text-[#526078] transition hover:bg-[#f8fafc] hover:text-[#101820] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
              onClick={() => void copyRoomLink()}
              type="button"
            >
              <ClipboardCheck aria-hidden="true" size={16} />
            </button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[#667085]">
              {copied ? "Link copiado." : "Disponivel para convidados externos."}
            </span>
            <a
              className="inline-flex h-8 items-center justify-center rounded-md bg-[#101820] px-3 text-xs font-semibold text-white transition hover:bg-[#1f2937]"
              href={roomPath ?? "#"}
              rel="noreferrer"
              target="_blank"
            >
              Abrir sala
            </a>
          </div>
        </div>
      ) : null}

      {meeting.objective ? (
        <div className="grid gap-1 rounded-md border border-[#edf0f4] bg-white p-3">
          <p className="m-0 text-xs font-bold uppercase text-[#667085]">
            Descricao
          </p>
          <p className="m-0 text-sm leading-5 text-[#344054]">
            {meeting.objective}
          </p>
        </div>
      ) : null}

      <div className="grid gap-2">
        <p className="m-0 text-xs font-bold uppercase text-[#667085]">
          Convidados
        </p>
        {participants.length > 0 ? (
          <div className="grid max-h-40 gap-1 overflow-auto">
            {participants.map((participant) => (
              <div
                className="flex items-center justify-between gap-2 rounded-md border border-[#edf0f4] bg-[#fafbfc] px-3 py-2"
                key={participant.id}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-[#101820]">
                    {participant.displayName}
                  </span>
                  <span className="block truncate text-xs text-[#667085]">
                    {[participant.email, participant.organization]
                      .filter(Boolean)
                      .join(" / ") || "Sem contato cadastrado"}
                  </span>
                </span>
                <Badge variant="neutral">{participant.role}</Badge>
              </div>
            ))}
          </div>
        ) : (
          <span className="rounded-md border border-dashed border-[#d9e0e7] bg-[#fafbfc] p-3 text-sm text-[#667085]">
            Nenhum convidado adicional registrado.
          </span>
        )}
      </div>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
      <span className="text-xs font-bold uppercase text-[#667085]">{label}</span>
      <span className="truncate font-semibold text-[#101820]">{value}</span>
    </div>
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
  const [calendarEventKind, setCalendarEventKind] =
    useState<ChronosCalendarEventKind>("event");
  const [profileId, setProfileId] = useState(
    activeProfiles[0]?.id ?? "external",
  );
  const [locationMode, setLocationMode] =
    useState<ChronosMeetingLocationMode>("online");
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? "");
  const [locationAddress, setLocationAddress] = useState("");
  const [objective, setObjective] = useState("");
  const [agenda, setAgenda] = useState("");
  const [inviteeSource, setInviteeSource] =
    useState<ChronosInviteeSource>("internal");
  const [contactQuery, setContactQuery] = useState("");
  const [contactOptions, setContactOptions] = useState<ChronosAgendaInvitee[]>(
    [],
  );
  const [selectedInvitees, setSelectedInvitees] = useState<
    ChronosAgendaInvitee[]
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
  const eventKinds: Array<{ id: ChronosCalendarEventKind; label: string }> = [
    { id: "event", label: "Evento" },
    { id: "task", label: "Tarefa" },
    { id: "out_of_office", label: "Ausente" },
    { id: "appointment", label: "Agendamento" },
  ];

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
      void searchInvitees();
    }, 240);

    async function searchInvitees() {
      try {
        setContactSearchStatus("loading");
        setContactSearchError(null);

        const options =
          inviteeSource === "internal"
            ? await searchInternalInvitees(normalizedQuery)
            : await searchExternalInvitees(normalizedQuery, controller.signal);

        if (!active) {
          return;
        }

        setContactOptions(
          options.filter(
            (invitee) =>
              !selectedInvitees.some(
                (selectedInvitee) =>
                  getInviteeKey(selectedInvitee) === getInviteeKey(invitee),
              ),
          ),
        );
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
            : inviteeSource === "internal"
              ? "Nao foi possivel buscar o time interno."
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
  }, [contactQuery, inviteeSource, selectedInvitees]);

  async function searchInternalInvitees(query: string) {
    const invitees = await searchChronosInternalInvitees(query);

    return invitees.map(mapHubInviteeToAgendaInvitee);
  }

  async function searchExternalInvitees(query: string, signal: AbortSignal) {
    const accessToken = await getChronosApoloAccessToken();
    const params = new URLSearchParams({
      limit: "8",
      q: query,
    });
    const response = await fetch(`/api/apolo/relationships?${params.toString()}`, {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      signal,
    });
    const payload = (await response.json().catch(() => null)) as
      | { data?: ApoloDashboardData; error?: string }
      | null;

    if (!response.ok || !payload?.data) {
      throw new Error(payload?.error ?? "Nao foi possivel buscar no Apolo.");
    }

    return payload.data.entities
      .map(mapApoloEntityToChronosInvitee)
      .filter(hasChronosInviteeContact)
      .map((invitee) => ({
        ...invitee,
        source: "external" as const,
      }));
  }

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

  function addInvitee(invitee: ChronosAgendaInvitee) {
    setSelectedInvitees((currentInvitees) =>
      currentInvitees.some(
        (currentInvitee) => getInviteeKey(currentInvitee) === getInviteeKey(invitee),
      )
        ? currentInvitees
        : [...currentInvitees, invitee].slice(0, 30),
    );
    setContactQuery("");
    setContactOptions([]);
    setContactSearchStatus("idle");
  }

  function removeInvitee(inviteeKey: string) {
    setSelectedInvitees((currentInvitees) =>
      currentInvitees.filter((invitee) => getInviteeKey(invitee) !== inviteeKey),
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const internalInvitees = selectedInvitees.filter(
      (invitee) => invitee.source === "internal",
    );
    const externalInvitees = selectedInvitees.filter(
      (invitee) => invitee.source === "external",
    );

    await onCreate({
      agenda: parseLines(agenda),
      apoloInvitees: externalInvitees.map(mapAgendaInviteeToApoloInvitee),
      calendarEventKind,
      endsAt,
      hubInvitees: internalInvitees.map(mapAgendaInviteeToHubInvitee),
      locationAddress:
        locationMode === "offline" ? locationAddress.trim() : undefined,
      locationMode,
      meetingType: selectedProfile.meetingType,
      objective,
      participants: selectedInvitees.map((invitee) => ({
        displayName: invitee.displayName,
        email: invitee.email,
        organization:
          invitee.organization ??
          (invitee.source === "internal" ? "Careli" : undefined),
        role: "participant" as const,
        userId: invitee.userId,
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
          {eventKinds.map((kind) => (
            <button
              aria-pressed={calendarEventKind === kind.id}
              className={`h-8 shrink-0 rounded-md px-3 text-xs font-semibold transition ${
                calendarEventKind === kind.id
                  ? "bg-[#d8edf8] text-[#075985]"
                  : "text-[#667085] hover:bg-[#f5f7fa] hover:text-[#101820]"
              }`}
              key={kind.id}
              onClick={() => setCalendarEventKind(kind.id)}
              type="button"
            >
              {kind.label}
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
            <div className="inline-grid w-fit grid-cols-2 rounded-md border border-[#d9e0e7] bg-[#f8fafc] p-0.5">
              {[
                { id: "internal", label: "Interno" },
                { id: "external", label: "Apolo" },
              ].map((option) => (
                <button
                  aria-pressed={inviteeSource === option.id}
                  className={`h-8 rounded px-3 text-xs font-semibold transition ${
                    inviteeSource === option.id
                      ? "bg-[#101820] text-white"
                      : "text-[#667085] hover:bg-white hover:text-[#101820]"
                  }`}
                  key={option.id}
                  onClick={() => {
                    setInviteeSource(option.id as ChronosInviteeSource);
                    setContactQuery("");
                    setContactOptions([]);
                    setContactSearchStatus("idle");
                    setContactSearchError(null);
                  }}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#98a2b3]"
                size={15}
              />
              <input
                className="h-9 w-full rounded-md border border-[#d9e0e7] bg-[#fafbfc] pl-9 pr-3 text-sm text-[#101820] outline-none placeholder:text-[#98a2b3] focus:border-[#A07C3B] focus:ring-2 focus:ring-[#A07C3B]/20"
                onChange={(event) => setContactQuery(event.target.value)}
                placeholder={
                  inviteeSource === "internal"
                    ? "Buscar time interno"
                    : "Buscar convidados no Apolo"
                }
                type="search"
                value={contactQuery}
              />
            </div>
            {contactSearchStatus === "loading" ? (
              <span className="text-xs font-semibold text-[#667085]">
                {inviteeSource === "internal"
                  ? "Buscando cadastro interno..."
                  : "Buscando contatos reais do Apolo..."}
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
                    key={getInviteeKey(invitee)}
                    onClick={() => addInvitee(invitee)}
                    type="button"
                  >
                    <span className="font-semibold text-[#101820]">
                      {invitee.displayName}
                    </span>
                    <span className="truncate text-xs text-[#667085]">
                      {[
                        invitee.email,
                        invitee.phone,
                        invitee.organization ??
                          (invitee.source === "internal" ? "Careli" : null),
                      ]
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
                    key={getInviteeKey(invitee)}
                  >
                    {invitee.displayName}
                    <span className="rounded bg-[#edf0f4] px-1 py-0.5 text-[10px] uppercase text-[#667085]">
                      {invitee.source === "internal" ? "Interno" : "Apolo"}
                    </span>
                    <button
                      aria-label={`Remover ${invitee.displayName}`}
                      className="grid h-5 w-5 place-items-center rounded text-[#667085] hover:bg-[#f5f7fa] hover:text-[#101820]"
                      onClick={() => removeInvitee(getInviteeKey(invitee))}
                      type="button"
                    >
                      <X aria-hidden="true" size={12} />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-xs text-[#667085]">
                Use Interno para o time da empresa e Apolo para convidados externos.
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

function ChronosCalendarLegend() {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 text-[11px] font-semibold text-[#667085]">
      {chronosCalendarLegendItems.map((item) => (
        <span className="inline-flex items-center gap-1" key={item.label}>
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: item.color }}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function ChronosGoogleCalendarStatusPopup({
  autoSyncedAt,
  autoSyncing,
  error,
  status,
  syncing,
}: {
  autoSyncedAt: string | null;
  autoSyncing: boolean;
  error: string | null;
  status: ChronosGoogleCalendarStatus | null;
  syncing: boolean;
}) {
  if (error) {
    return (
      <div className="grid gap-1 text-xs leading-5 text-amber-200">
        <strong>Google Agenda</strong>
        <span>Status indisponivel agora.</span>
        <span>{error}</span>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="text-xs leading-5 text-white">
        Verificando Google Agenda...
      </div>
    );
  }

  return (
    <div className="grid gap-1 text-xs leading-5 text-white">
      <strong>Google Agenda</strong>
      <span>{status.connection.connected ? "Conectado" : "Nao conectado"}</span>
      {status.connection.calendarId ? (
        <span>Calendario: {status.connection.calendarId}</span>
      ) : null}
      {status.connection.lastSyncedAt ? (
        <span>Ultimo sync: {formatDateTime(status.connection.lastSyncedAt)}</span>
      ) : null}
      {status.connection.connected ? (
        <span>
          Auto-sync:{" "}
          {syncing || autoSyncing
            ? "atualizando agora"
            : autoSyncedAt
              ? formatDateTime(autoSyncedAt)
              : status.connection.push?.active
                ? "webhook ativo"
                : "fallback ativo"}
        </span>
      ) : null}
      {status.connection.push?.lastError ? (
        <span className="text-amber-200">
          Webhook: {status.connection.push.lastError}
        </span>
      ) : null}
      {status.missingEnvNames.length > 0 ? (
        <span className="text-amber-200">
          Pendentes: {status.missingEnvNames.join(", ")}
        </span>
      ) : null}
    </div>
  );
}

function GoogleGlyph({ connected }: { connected?: boolean }) {
  if (connected) {
    return (
      <span
        aria-hidden="true"
        className="grid h-5 w-5 place-items-center rounded-full bg-[#12b76a] text-[11px] font-black text-white shadow-[inset_0_0_0_1px_rgba(6,118,71,0.2)]"
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
            {formatDateTime(meeting.startsAt)} /{" "}
            {getChronosMeetingLocationLabel(meeting)}
          </span>
        </span>
        <Badge variant={statusVariant[meeting.status]}>
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
  const typeVisual = chronosMeetingTypeVisuals[meeting.meetingType];

  return (
    <span
      className={`block rounded border px-2 py-1 text-xs font-semibold ${
        selected
          ? `${typeVisual.pillClass} ring-2 ring-[#A07C3B]/40`
          : typeVisual.pillClass
      }`}
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

function ChronosRoomsManagementScreen({
  meetings,
  onCreateRoom,
  onDeleteRoom,
  onUpdateRoom,
  rooms,
  saving,
}: {
  meetings: ChronosMeeting[];
  onCreateRoom: (input: ChronosRoomInput) => Promise<ChronosRoom | null>;
  onDeleteRoom: (roomId: string) => Promise<ChronosRoom | null>;
  onUpdateRoom: (input: ChronosRoomUpdateInput) => Promise<ChronosRoom | null>;
  rooms: ChronosRoom[];
  saving: boolean;
}) {
  const [selectedRoomId, setSelectedRoomId] = useState(rooms[0]?.id ?? "");
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [roomEditorOpen, setRoomEditorOpen] = useState(false);
  const [roomDraft, setRoomDraft] = useState<ChronosRoomDraft>(() =>
    createRoomDraft(rooms[0] ?? null),
  );
  const selectedRoom =
    rooms.find((room) => room.id === selectedRoomId) ?? rooms[0] ?? null;

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
    setIsCreatingRoom(true);
    setSelectedRoomId("");
    setRoomDraft(createRoomDraft(null));
    setRoomEditorOpen(true);
  }

  function openRoomEditor(room: ChronosRoom) {
    setIsCreatingRoom(false);
    setSelectedRoomId(room.id);
    setRoomDraft(createRoomDraft(room));
    setRoomEditorOpen(true);
  }

  function closeRoomEditor() {
    setRoomEditorOpen(false);

    if (isCreatingRoom) {
      setIsCreatingRoom(false);
      setSelectedRoomId(rooms[0]?.id ?? "");
    }
  }

  async function handleSaveRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const input = buildRoomInputFromDraft(roomDraft);

    if (isCreatingRoom) {
      const room = await onCreateRoom(input);

      if (room) {
        setIsCreatingRoom(false);
        setSelectedRoomId(room.id);
        setRoomEditorOpen(false);
      }

      return;
    }

    if (!selectedRoom) {
      return;
    }

    const updatedRoom = await onUpdateRoom({
      ...input,
      roomId: selectedRoom.id,
    });

    if (updatedRoom) {
      setRoomEditorOpen(false);
    }
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
      setRoomEditorOpen(false);
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
      <Surface bordered className="border-[#d9e0e7] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#edf0f4] p-4">
          <PanelTitle eyebrow="Salas" title="Ambientes fixos" />
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm font-semibold text-[#101820] transition hover:border-[#A07C3B] hover:text-[#A07C3B] disabled:cursor-not-allowed disabled:opacity-55"
            disabled={saving}
            onClick={startNewRoomDraft}
            type="button"
          >
            <Plus aria-hidden="true" size={15} />
            Nova sala
          </button>
        </div>
        <div className="hidden grid-cols-[minmax(12rem,1.2fr)_minmax(10rem,0.8fr)_minmax(12rem,1fr)_minmax(8rem,0.7fr)_auto] gap-3 border-b border-[#edf0f4] bg-[#fafbfc] px-4 py-2 text-xs font-bold uppercase text-[#667085] lg:grid">
          <span>Sala</span>
          <span>Link</span>
          <span>Configuracao</span>
          <span>Historico</span>
          <span className="text-right">Acoes</span>
        </div>
        <div className="divide-y divide-[#edf0f4]">
          {rooms.map((room) => {
            const totalRoomMeetings = meetings.filter(
              (currentMeeting) => currentMeeting.roomId === room.id,
            ).length;

            return (
              <div
                className={`grid gap-3 px-4 py-3 text-sm transition lg:grid-cols-[minmax(12rem,1.2fr)_minmax(10rem,0.8fr)_minmax(12rem,1fr)_minmax(8rem,0.7fr)_auto] lg:items-center ${
                  roomEditorOpen && !isCreatingRoom && room.id === selectedRoom?.id
                    ? "bg-[#fffaf0]"
                    : "bg-white hover:bg-[#fafbfc]"
                }`}
                key={room.id}
              >
                <button
                  className="grid min-w-0 gap-1 text-left"
                  onClick={() => openRoomEditor(room)}
                  type="button"
                >
                  <span className="truncate font-semibold text-[#101820]">
                    {room.name}
                  </span>
                  <span className="text-xs text-[#667085]">
                    {room.capacity} lugares
                  </span>
                </button>
                <span className="truncate text-xs font-semibold text-[#526078]">
                  {buildExternalRoomLink(room.slug)}
                </span>
                <span className="flex flex-wrap gap-1">
                  <Badge variant={room.recordingRequired ? "info" : "neutral"}>
                    gravacao {room.recordingRequired ? "sim" : "nao"}
                  </Badge>
                  <Badge
                    variant={room.transcriptionRequired ? "info" : "neutral"}
                  >
                    transcricao {room.transcriptionRequired ? "sim" : "nao"}
                  </Badge>
                  <Badge variant={room.minutesRequired ? "info" : "neutral"}>
                    ata {room.minutesRequired ? "sim" : "nao"}
                  </Badge>
                </span>
                <span className="flex flex-wrap gap-1">
                  <Badge variant={room.status === "active" ? "success" : "neutral"}>
                    {room.status}
                  </Badge>
                  <Badge variant="neutral">{totalRoomMeetings} reunioes</Badge>
                </span>
                <div className="flex justify-start lg:justify-end">
                  <button
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#d9e0e7] bg-white px-2.5 text-xs font-semibold text-[#101820] transition hover:border-[#A07C3B] hover:text-[#A07C3B]"
                    onClick={() => openRoomEditor(room)}
                    type="button"
                  >
                    <ImagePlus aria-hidden="true" size={13} />
                    Configurar
                  </button>
                </div>
              </div>
            );
          })}
          {rooms.length === 0 ? (
            <div className="p-4">
              <EmptyPanel text="Nenhuma sala Chronos carregada." />
            </div>
          ) : null}
        </div>
      </Surface>

      {roomEditorOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#101820]/35 px-4 py-8 backdrop-blur-sm">
          <button
            aria-label="Fechar configuracao de sala"
            className="absolute inset-0 cursor-default"
            onClick={closeRoomEditor}
            type="button"
          />
          <Surface bordered className="relative z-10 w-full max-w-3xl border-[#d9e0e7] bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-[#edf0f4] p-4">
              <PanelTitle eyebrow="Configuracao" title={roomFormTitle} />
              <button
                aria-label="Fechar configuracao"
                className="grid h-8 w-8 place-items-center rounded-md text-[#667085] transition hover:bg-[#f3f6fa] hover:text-[#101820]"
                onClick={closeRoomEditor}
                type="button"
              >
                <X aria-hidden="true" size={16} />
              </button>
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
                      closeRoomEditor();
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
        </div>
      ) : null}
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

  if (activeDriveView === "recordings") {
    return (
      <ChronosDrivePanel
        activeDriveView={activeDriveView}
        onChangeDriveView={onChangeDriveView}
      >
        <ChronosRecordingFolderExplorer
          localRecordings={localRecordings}
          meetings={meetings}
          onSelectMeeting={onSelectMeeting}
          onTranscribeRecording={onTranscribeRecording}
          rooms={rooms}
          saving={saving}
        />
      </ChronosDrivePanel>
    );
  }

  return (
    <ChronosDrivePanel
      activeDriveView={activeDriveView}
      onChangeDriveView={onChangeDriveView}
    >
      <section className="grid min-h-[42rem] gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(24rem,0.72fr)]">
        <Surface bordered className="border-[#d9e0e7] bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#edf0f4] p-4">
            <PanelTitle eyebrow="Drive Chronos" title="Atas" />
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
                driveView="minutes"
                key={driveMeeting.id}
                meeting={driveMeeting}
                onSelectMeeting={onSelectMeeting}
                selected={driveMeeting.id === meeting?.id}
              />
            ))}
            {filteredMeetings.length === 0 ? (
              <EmptyPanel text="Nenhuma reuniao encontrada para organizar atas." />
            ) : null}
          </div>
        </Surface>

        {meeting ? (
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
        ) : (
          <Surface bordered className="grid min-h-full place-items-center border-[#d9e0e7] bg-white p-5 text-sm text-[#667085]">
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
  onSelectMeeting,
  onTranscribeRecording,
  rooms,
  saving,
}: {
  localRecordings: LocalRecording[];
  meetings: ChronosMeeting[];
  onSelectMeeting: (meetingId: string) => void;
  onTranscribeRecording: (input: {
    file: Blob;
    fileName?: string;
    meeting: ChronosMeeting;
    recordingId?: string;
  }) => Promise<void>;
  rooms: ChronosRoom[];
  saving: boolean;
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
    <section className="grid min-h-[42rem] overflow-hidden rounded-md border border-[#d9e0e7] bg-white xl:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="border-r border-[#edf0f4] bg-[#fbfcfe]">
        <div className="border-b border-[#edf0f4] p-4">
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
                    ? "bg-[#fffaf0] shadow-[inset_2px_0_0_#A07C3B]"
                    : "hover:bg-white"
                }`}
                key={folder.id}
                onClick={() => setSelectedFolderId(folder.id)}
                type="button"
              >
                <span className="flex items-start gap-3">
                  <span
                    className={`grid h-10 w-10 shrink-0 place-items-center rounded-md ${
                      selected
                        ? "bg-[#101820] text-white"
                        : "bg-white text-[#A07C3B]"
                    }`}
                  >
                    <FolderIcon aria-hidden="true" size={18} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-[#101820]">
                      {folder.label}
                    </span>
                    <span className="mt-1 block truncate text-xs text-[#667085]">
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

      <div className="min-w-0 bg-white">
        {selectedFolder ? (
          <>
            <div className="grid gap-3 border-b border-[#edf0f4] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <PanelTitle eyebrow="Gravacoes" title={selectedFolder.label} />
                <span className="text-xs font-semibold text-[#667085]">
                  {filteredMeetings.length} reunioes filtradas
                </span>
              </div>
              <div className="grid gap-2 xl:grid-cols-[minmax(8rem,0.7fr)_minmax(8rem,0.7fr)_minmax(12rem,1fr)_minmax(12rem,1fr)_auto_auto]">
                <label className="grid gap-1 text-xs font-bold uppercase text-[#667085]">
                  De
                  <input
                    className="h-9 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm normal-case text-[#101820] outline-none focus:border-[#A07C3B]"
                    onChange={(event) => setDateFrom(event.target.value)}
                    type="date"
                    value={dateFrom}
                  />
                </label>
                <label className="grid gap-1 text-xs font-bold uppercase text-[#667085]">
                  Ate
                  <input
                    className="h-9 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm normal-case text-[#101820] outline-none focus:border-[#A07C3B]"
                    onChange={(event) => setDateTo(event.target.value)}
                    type="date"
                    value={dateTo}
                  />
                </label>
                <label className="grid gap-1 text-xs font-bold uppercase text-[#667085]">
                  Assunto
                  <span className="relative">
                    <Search
                      aria-hidden="true"
                      className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8a95a6]"
                      size={14}
                    />
                    <input
                      className="h-9 w-full rounded-md border border-[#d9e0e7] bg-white pl-8 pr-3 text-sm normal-case text-[#101820] outline-none focus:border-[#A07C3B]"
                      onChange={(event) => setSubjectFilter(event.target.value)}
                      placeholder="Tema ou protocolo"
                      value={subjectFilter}
                    />
                  </span>
                </label>
                <label className="grid gap-1 text-xs font-bold uppercase text-[#667085]">
                  Pessoas
                  <span className="relative">
                    <UsersRound
                      aria-hidden="true"
                      className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8a95a6]"
                      size={14}
                    />
                    <input
                      className="h-9 w-full rounded-md border border-[#d9e0e7] bg-white pl-8 pr-3 text-sm normal-case text-[#101820] outline-none focus:border-[#A07C3B]"
                      onChange={(event) => setPeopleFilter(event.target.value)}
                      placeholder="Nome, email ou empresa"
                      value={peopleFilter}
                    />
                  </span>
                </label>
                <div className="flex items-end">
                  <button
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm font-semibold text-[#526078] transition hover:border-[#A07C3B] hover:text-[#101820] disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!filtersActive}
                    onClick={clearFilters}
                    type="button"
                  >
                    <X aria-hidden="true" size={14} />
                    Limpar
                  </button>
                </div>
                <div className="flex items-end">
                  <div className="inline-flex h-9 rounded-md border border-[#d9e0e7] bg-white p-1">
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
                              ? "bg-[#101820] text-white"
                              : "text-[#667085] hover:bg-[#f3f6fa] hover:text-[#101820]"
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
                    onSelectMeeting={onSelectMeeting}
                    onTranscribeRecording={onTranscribeRecording}
                    recordingMeeting={recordingMeeting}
                    saving={saving}
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

function ChronosDriveMeetingRecordingCard({
  onSelectMeeting,
  onTranscribeRecording,
  recordingMeeting,
  saving,
  viewMode,
}: {
  onSelectMeeting: (meetingId: string) => void;
  onTranscribeRecording: (input: {
    file: Blob;
    fileName?: string;
    meeting: ChronosMeeting;
    recordingId?: string;
  }) => Promise<void>;
  recordingMeeting: ChronosDriveRecordingMeeting;
  saving: boolean;
  viewMode: ChronosDriveViewMode;
}) {
  const { meeting, primaryRecording } = recordingMeeting;
  const downloadUrl = primaryRecording?.downloadUrl ?? primaryRecording?.url;
  const canOpenVideo = Boolean(primaryRecording?.url && primaryRecording.url !== "#");
  const startedAt = getChronosMeetingDriveStart(meeting);
  const endedAt = getChronosMeetingDriveEnd(meeting);
  const displayTitle = getChronosDriveMeetingDisplayTitle(
    meeting,
    recordingMeeting.roomLabel,
  );
  const status =
    primaryRecording?.status ??
    (recordingMeeting.availableRecordings > 0 ? "available" : meeting.recordingStatus);

  if (viewMode === "list") {
    return (
      <article className="grid gap-3 border-b border-[#edf0f4] bg-white px-3 py-3 text-sm text-[#101820] transition hover:bg-[#fafbfc] xl:grid-cols-[minmax(14rem,1.4fr)_minmax(10rem,0.8fr)_minmax(14rem,1fr)_auto] xl:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="m-0 truncate text-sm font-semibold text-[#101820]">
              {displayTitle}
            </p>
            <Badge variant={status === "available" ? "success" : "neutral"}>
              {chronosCaptureStatusLabels[status]}
            </Badge>
          </div>
          <p className="m-0 mt-1 truncate text-xs text-[#667085]">
            {meeting.protocol}
          </p>
        </div>
        <div className="grid gap-1 text-xs text-[#667085]">
          <span>Inicio: {formatDateTime(startedAt)}</span>
          <span>Fim: {formatDateTime(endedAt)}</span>
        </div>
        <div className="grid gap-1 text-xs text-[#667085]">
          <span>Participantes: {meeting.participants.length}</span>
          <span className="truncate">Pessoas: {recordingMeeting.participantText || "-"}</span>
          <span className="truncate">
            Assunto: {meeting.objective || meeting.title}
          </span>
        </div>
        <ChronosDriveRecordingActions
          canOpenVideo={canOpenVideo}
          downloadUrl={downloadUrl}
          onSelectMeeting={onSelectMeeting}
          onTranscribeRecording={onTranscribeRecording}
          primaryRecording={primaryRecording}
          recordingMeeting={recordingMeeting}
          saving={saving}
        />
      </article>
    );
  }

  return (
    <article className="grid overflow-hidden rounded-md border border-[#edf0f4] bg-[#fafbfc] text-sm text-[#101820] transition hover:border-[#d9e0e7] hover:bg-white">
      {canOpenVideo ? (
        <video
          className="aspect-video w-full bg-black"
          controls
          preload="metadata"
          src={primaryRecording?.url}
        />
      ) : (
        <div className="grid aspect-video place-items-center bg-[#101820] text-white">
          <div className="grid justify-items-center gap-2">
            <Video aria-hidden="true" size={24} />
            <span className="text-xs font-semibold text-[#d7dee8]">
              {recordingMeeting.recordings.length > 0
                ? "Video em processamento"
                : "Gravacao ainda nao disponivel"}
            </span>
          </div>
        </div>
      )}
      <div className="grid gap-3 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="m-0 truncate text-sm font-semibold text-[#101820]">
              {displayTitle}
            </p>
            <p className="m-0 mt-1 truncate text-xs text-[#667085]">
              {meeting.protocol}
            </p>
          </div>
          <Badge variant={status === "available" ? "success" : "neutral"}>
            {chronosCaptureStatusLabels[status]}
          </Badge>
        </div>
        <div className="grid gap-1 text-xs text-[#667085]">
          <span>Inicio: {formatDateTime(startedAt)}</span>
          <span>Fim: {formatDateTime(endedAt)}</span>
          <span>Participantes: {meeting.participants.length}</span>
          <span className="truncate">
            Pessoas: {recordingMeeting.participantText || "-"}
          </span>
          <span className="truncate">
            Assunto: {meeting.objective || meeting.title}
          </span>
          <span>
            Duracao: {formatDuration(recordingMeeting.totalDurationSeconds)}
            {primaryRecording?.sizeBytes
              ? ` / ${formatFileSize(primaryRecording.sizeBytes)}`
              : ""}
          </span>
          <span>
            Arquivos: {recordingMeeting.recordings.length} / disponiveis:{" "}
            {recordingMeeting.availableRecordings}
          </span>
        </div>
        <ChronosDriveRecordingActions
          canOpenVideo={canOpenVideo}
          downloadUrl={downloadUrl}
          onSelectMeeting={onSelectMeeting}
          onTranscribeRecording={onTranscribeRecording}
          primaryRecording={primaryRecording}
          recordingMeeting={recordingMeeting}
          saving={saving}
        />
      </div>
    </article>
  );
}

function ChronosDriveRecordingActions({
  canOpenVideo,
  downloadUrl,
  onSelectMeeting,
  onTranscribeRecording,
  primaryRecording,
  recordingMeeting,
  saving,
}: {
  canOpenVideo: boolean;
  downloadUrl?: string;
  onSelectMeeting: (meetingId: string) => void;
  onTranscribeRecording: (input: {
    file: Blob;
    fileName?: string;
    meeting: ChronosMeeting;
    recordingId?: string;
  }) => Promise<void>;
  primaryRecording: ChronosDriveRecordingItem | null;
  recordingMeeting: ChronosDriveRecordingMeeting;
  saving: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <button
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#d9e0e7] bg-white px-2.5 text-xs font-semibold text-[#101820] transition hover:border-[#A07C3B]"
        onClick={() => onSelectMeeting(recordingMeeting.meeting.id)}
        type="button"
      >
        <FileText aria-hidden="true" size={13} />
        Reuniao
      </button>
      <div className="flex flex-wrap gap-2">
        {canOpenVideo && primaryRecording ? (
          <a
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#d9e0e7] bg-white px-2.5 text-xs font-semibold text-[#101820] transition hover:border-[#A07C3B]"
            href={primaryRecording.url}
            rel="noreferrer"
            target="_blank"
          >
            <PlayCircle aria-hidden="true" size={13} />
            Assistir
          </a>
        ) : (
          <button
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#d9e0e7] bg-white px-2.5 text-xs font-semibold text-[#8a95a6] disabled:cursor-not-allowed disabled:opacity-70"
            disabled
            type="button"
          >
            <PlayCircle aria-hidden="true" size={13} />
            Video em processamento
          </button>
        )}
        {downloadUrl && downloadUrl !== "#" && primaryRecording ? (
          <a
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#101820] bg-[#101820] px-2.5 text-xs font-semibold text-white transition hover:bg-black"
            download={primaryRecording.name}
            href={downloadUrl}
          >
            <Download aria-hidden="true" size={13} />
            Baixar
          </a>
        ) : null}
        {primaryRecording?.blob ? (
          <button
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#d9e0e7] bg-white px-2.5 text-xs font-semibold text-[#101820] transition hover:bg-[#f8fafc] disabled:cursor-wait disabled:opacity-60"
            disabled={saving || Boolean(primaryRecording.transcribedAt)}
            onClick={() =>
              void onTranscribeRecording({
                file: primaryRecording.blob as Blob,
                fileName: primaryRecording.name,
                meeting: recordingMeeting.meeting,
                recordingId: primaryRecording.id,
              })
            }
            type="button"
          >
            <Mic aria-hidden="true" size={13} />
            {primaryRecording.transcribedAt ? "Transcrita" : "Transcrever"}
          </button>
        ) : null}
      </div>
    </div>
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

function getChronosMeetingRoomPath(meeting: ChronosMeeting) {
  return meeting.room?.slug ? `/chronos/${meeting.room.slug}` : null;
}

function getChronosCalendarEventKind(
  meeting: ChronosMeeting,
): ChronosCalendarEventKind {
  const value = meeting.metadata.calendarEventKind;

  return typeof value === "string" && value in chronosCalendarEventKindLabels
    ? (value as ChronosCalendarEventKind)
    : "event";
}

function getChronosMeetingProfileLabel(meeting: ChronosMeeting) {
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

function mapHubInviteeToAgendaInvitee(
  invitee: ChronosHubInvitee,
): ChronosAgendaInvitee {
  return {
    displayName: invitee.displayName,
    email: invitee.email,
    entityId: invitee.userId,
    operationalProfile: invitee.operationalProfile,
    organization: "Careli",
    role: invitee.role,
    source: "internal",
    userId: invitee.userId,
  };
}

function mapAgendaInviteeToApoloInvitee(
  invitee: ChronosAgendaInvitee,
): ChronosApoloInvitee {
  return {
    displayName: invitee.displayName,
    email: invitee.email,
    entityId: invitee.entityId,
    organization: invitee.organization,
    phone: invitee.phone,
  };
}

function mapAgendaInviteeToHubInvitee(
  invitee: ChronosAgendaInvitee,
): ChronosHubInvitee {
  return {
    displayName: invitee.displayName,
    email: invitee.email ?? "",
    operationalProfile: invitee.operationalProfile ?? null,
    role: invitee.role ?? null,
    userId: invitee.userId ?? invitee.entityId,
  };
}

function getInviteeKey(invitee: ChronosAgendaInvitee) {
  return `${invitee.source}:${invitee.entityId}`;
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

function buildChronosRecordingFolders({
  localRecordings,
  meetings,
  rooms,
}: {
  localRecordings: LocalRecording[];
  meetings: ChronosMeeting[];
  rooms: ChronosRoom[];
}) {
  const roomsById = new Map(rooms.map((room) => [room.id, room]));
  const foldersById = new Map<string, ChronosDriveRecordingFolder>();

  for (const meeting of meetings) {
    const room =
      meeting.room ??
      (meeting.roomId ? roomsById.get(meeting.roomId) ?? null : null);
    const descriptor = getChronosDriveFolderDescriptor(meeting, room);
    const recordings = getChronosMeetingRecordingItems({
      localRecordings,
      meeting,
      roomLabel: descriptor.roomLabel,
      sectorLabel: descriptor.label,
    });

    if (recordings.length === 0) {
      continue;
    }

    const currentFolder =
      foldersById.get(descriptor.id) ??
      {
        id: descriptor.id,
        label: descriptor.label,
        latestAt: null,
        meetings: [],
        roomLabels: [],
        subtitle: descriptor.subtitle,
        totalRecordings: 0,
        totalMeetings: 0,
      };
    const recordingMeeting = buildChronosDriveRecordingMeeting({
      meeting,
      recordings,
      roomLabel: descriptor.roomLabel,
      sectorLabel: descriptor.label,
    });

    currentFolder.meetings.push(recordingMeeting);
    currentFolder.totalRecordings += recordings.length;
    currentFolder.totalMeetings += 1;

    if (!currentFolder.roomLabels.includes(descriptor.roomLabel)) {
      currentFolder.roomLabels.push(descriptor.roomLabel);
    }

    const meetingDate = recordingMeeting.latestAt ?? meeting.startsAt ?? meeting.updatedAt;

    if (
      meetingDate &&
      (!currentFolder.latestAt ||
        Date.parse(meetingDate) > Date.parse(currentFolder.latestAt))
    ) {
      currentFolder.latestAt = meetingDate;
    }

    foldersById.set(descriptor.id, currentFolder);
  }

  return [...foldersById.values()]
    .map((folder) => ({
      ...folder,
      meetings: folder.meetings.sort((firstMeeting, secondMeeting) => {
        const firstDate = getChronosDriveMeetingSortDate(firstMeeting);
        const secondDate = getChronosDriveMeetingSortDate(secondMeeting);

        return secondDate - firstDate;
      }),
      roomLabels: folder.roomLabels.sort((firstLabel, secondLabel) =>
        firstLabel.localeCompare(secondLabel, "pt-BR"),
      ),
    }))
    .sort((firstFolder, secondFolder) => {
      const firstDate = firstFolder.latestAt
        ? Date.parse(firstFolder.latestAt)
        : 0;
      const secondDate = secondFolder.latestAt
        ? Date.parse(secondFolder.latestAt)
        : 0;

      return secondDate - firstDate;
    });
}

function buildChronosDriveRecordingMeeting({
  meeting,
  recordings,
  roomLabel,
  sectorLabel,
}: {
  meeting: ChronosMeeting;
  recordings: ChronosDriveRecordingItem[];
  roomLabel: string;
  sectorLabel: string;
}): ChronosDriveRecordingMeeting {
  const primaryRecording = selectChronosPrimaryRecording(recordings);
  const latestAt =
    recordings
      .map((recording) => recording.stoppedAt ?? recording.startedAt)
      .filter((value): value is string => Boolean(value))
      .sort((firstValue, secondValue) => Date.parse(secondValue) - Date.parse(firstValue))[0] ??
    getChronosMeetingDriveEnd(meeting) ??
    getChronosMeetingDriveStart(meeting) ??
    meeting.updatedAt;
  const participantText = meeting.participants
    .map((participant) =>
      [participant.displayName, participant.email, participant.organization]
        .filter(Boolean)
        .join(" / "),
    )
    .filter(Boolean)
    .join(", ");

  return {
    availableRecordings: recordings.filter(
      (recording) => recording.status === "available" && recording.url !== "#",
    ).length,
    id: meeting.id,
    latestAt,
    meeting,
    participantText,
    primaryRecording,
    recordings,
    roomLabel,
    sectorLabel,
    totalDurationSeconds: recordings.reduce(
      (total, recording) => total + recording.durationSeconds,
      0,
    ),
  };
}

function selectChronosPrimaryRecording(recordings: ChronosDriveRecordingItem[]) {
  return (
    [...recordings].sort((firstRecording, secondRecording) => {
      const firstPlayable = firstRecording.url && firstRecording.url !== "#" ? 1 : 0;
      const secondPlayable =
        secondRecording.url && secondRecording.url !== "#" ? 1 : 0;

      if (firstPlayable !== secondPlayable) {
        return secondPlayable - firstPlayable;
      }

      const firstAvailable = firstRecording.status === "available" ? 1 : 0;
      const secondAvailable = secondRecording.status === "available" ? 1 : 0;

      if (firstAvailable !== secondAvailable) {
        return secondAvailable - firstAvailable;
      }

      return (
        getChronosRecordingSortDate(secondRecording) -
        getChronosRecordingSortDate(firstRecording)
      );
    })[0] ?? null
  );
}

function filterChronosDriveRecordingMeetings(
  recordingMeetings: ChronosDriveRecordingMeeting[],
  filters: {
    dateFrom: string;
    dateTo: string;
    people: string;
    subject: string;
  },
) {
  const subjectQuery = normalizeChronosSearchText(filters.subject);
  const peopleQuery = normalizeChronosSearchText(filters.people);
  const fromTime = filters.dateFrom
    ? Date.parse(`${filters.dateFrom}T00:00:00`)
    : null;
  const toTime = filters.dateTo
    ? Date.parse(`${filters.dateTo}T23:59:59`)
    : null;

  return recordingMeetings.filter((recordingMeeting) => {
    const meetingDate = getChronosDriveMeetingSortDate(recordingMeeting);

    if (fromTime !== null && meetingDate < fromTime) {
      return false;
    }

    if (toTime !== null && meetingDate > toTime) {
      return false;
    }

    if (subjectQuery) {
      const subjectText = normalizeChronosSearchText(
        [
          recordingMeeting.meeting.title,
          recordingMeeting.meeting.protocol,
          recordingMeeting.meeting.objective,
          recordingMeeting.roomLabel,
          recordingMeeting.sectorLabel,
          ...recordingMeeting.recordings.map((recording) => recording.name),
        ].join(" "),
      );

      if (!subjectText.includes(subjectQuery)) {
        return false;
      }
    }

    if (peopleQuery) {
      const peopleText = normalizeChronosSearchText(recordingMeeting.participantText);

      if (!peopleText.includes(peopleQuery)) {
        return false;
      }
    }

    return true;
  });
}

function getChronosDriveMeetingSortDate(recordingMeeting: ChronosDriveRecordingMeeting) {
  return (
    parseChronosDateValue(recordingMeeting.latestAt) ??
    parseChronosDateValue(getChronosMeetingDriveEnd(recordingMeeting.meeting)) ??
    parseChronosDateValue(getChronosMeetingDriveStart(recordingMeeting.meeting)) ??
    parseChronosDateValue(recordingMeeting.meeting.updatedAt) ??
    0
  );
}

function getChronosRecordingSortDate(recording: ChronosDriveRecordingItem) {
  return (
    parseChronosDateValue(recording.stoppedAt) ??
    parseChronosDateValue(recording.startedAt) ??
    parseChronosDateValue(recording.meeting.startsAt) ??
    parseChronosDateValue(recording.meeting.updatedAt) ??
    0
  );
}

function getChronosDriveMeetingDisplayTitle(
  meeting: ChronosMeeting,
  roomLabel: string,
) {
  const title = (meeting.title || meeting.objective || meeting.protocol).trim();
  const normalizedTitle = title.toLocaleLowerCase("pt-BR");
  const normalizedRoomPrefix = `${roomLabel} - `.toLocaleLowerCase("pt-BR");

  if (normalizedTitle.startsWith(normalizedRoomPrefix)) {
    return title.slice(roomLabel.length + 3).trim() || title;
  }

  return title;
}

function getChronosMeetingRecordingItems({
  localRecordings,
  meeting,
  roomLabel,
  sectorLabel,
}: {
  localRecordings: LocalRecording[];
  meeting: ChronosMeeting;
  roomLabel: string;
  sectorLabel: string;
}) {
  const meetingLocalRecordings = localRecordings.filter(
    (recording) => recording.meetingId === meeting.id,
  );

  return [
    ...meetingLocalRecordings.map((recording) => ({
      ...recording,
      meeting,
      roomLabel,
      sectorLabel,
      status: (recording.status ?? "available") as ChronosCaptureStatus,
    })),
    ...meeting.recordings.map((recording) => ({
      ...mapPersistedRecording(recording, meeting.id),
      meeting,
      roomLabel,
      sectorLabel,
    })),
  ];
}

function getChronosDriveFolderDescriptor(
  meeting: ChronosMeeting,
  room: ChronosRoom | null,
) {
  const metadata = room?.metadata ?? {};
  const sectorId = readChronosMetadataText(metadata, [
    "sectorId",
    "sector_id",
    "departmentId",
    "department_id",
  ]);
  const sectorLabel = readChronosMetadataText(metadata, [
    "sectorName",
    "sectorLabel",
    "sector",
    "setor",
    "departmentName",
    "departmentLabel",
    "department",
  ]);
  const roomLabel = room?.name ?? meeting.room?.name ?? "Sala pendente";

  return {
    id: sectorId
      ? `sector:${sectorId}`
      : room?.id
        ? `room:${room.id}`
        : `room:${meeting.roomId ?? "sem-sala"}`,
    label: sectorLabel || roomLabel,
    roomLabel,
    subtitle: sectorLabel ? roomLabel : "Sala Chronos",
  };
}

function readChronosMetadataText(
  metadata: Record<string, unknown>,
  keys: string[],
) {
  for (const key of keys) {
    const value = metadata[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }

    if (value && typeof value === "object" && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      const label = record.label ?? record.name ?? record.title;

      if (typeof label === "string" && label.trim()) {
        return label.trim();
      }
    }
  }

  return "";
}

function getChronosMeetingDriveStart(meeting: ChronosMeeting) {
  return (
    readChronosMetadataText(meeting.metadata, [
      "actualStartedAt",
      "startedAt",
      "openedAt",
    ]) ||
    meeting.startsAt ||
    meeting.createdAt
  );
}

function getChronosMeetingDriveEnd(meeting: ChronosMeeting) {
  return (
    readChronosMetadataText(meeting.metadata, [
      "actualEndedAt",
      "closedAt",
      "endedAt",
    ]) ||
    meeting.endsAt ||
    null
  );
}

function parseChronosDateValue(value?: string | null) {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp) ? timestamp : null;
}

function normalizeChronosSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
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
    sizeBytes: recording.sizeBytes,
    startedAt: recording.startedAt,
    status: recording.status,
    stoppedAt: recording.stoppedAt,
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
    slug: slugifyRoomName(draft.slug || name),
    transcriptionRequired: draft.transcriptionRequired,
  };
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

function formatFileSize(sizeBytes: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return "-";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = sizeBytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex] ?? "B"}`;
}

function getSupportedRecordingMimeType() {
  const candidates = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}
