"use client";

import {
  createChronosMeeting,
  loadChronosSnapshot,
  updateChronosMeeting,
} from "@/lib/chronos/client";
import {
  chronosCaptureStatusLabels,
  chronosFollowUpStatusLabels,
  chronosMeetingStatusLabels,
  chronosMeetingTypeLabels,
  chronosMeetingTypes,
  chronosMinutesStatusLabels,
  type ChronosCreateMeetingInput,
  type ChronosFollowUp,
  type ChronosMeeting,
  type ChronosMeetingType,
  type ChronosMinutesStatus,
  type ChronosRoom,
  type ChronosSnapshot,
} from "@/lib/chronos/types";
import { askHubAi } from "@/lib/hub-ai/client";
import { useAuth } from "@/providers/auth-provider";
import { Badge, Surface, Tooltip, WorkspaceLayout } from "@repo/uix";
import type { BadgeVariant } from "@repo/uix";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FileText,
  LayoutGrid,
  ListChecks,
  Loader2,
  Mic,
  MonitorUp,
  Plus,
  Radio,
  RefreshCcw,
  Save,
  ScreenShare,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  UsersRound,
  Video,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

type ChronosView =
  | "rooms"
  | "meetings"
  | "recordings"
  | "transcripts"
  | "minutes"
  | "followups"
  | "timeline"
  | "participants"
  | "settings";

type LocalRecording = {
  durationSeconds: number;
  id: string;
  name: string;
  url: string;
};

const emptySnapshot: ChronosSnapshot = {
  meetings: [],
  rooms: [],
  storage: { status: "offline" },
};

const viewItems: Array<{
  icon: typeof LayoutGrid;
  id: ChronosView;
  label: string;
}> = [
  { icon: LayoutGrid, id: "rooms", label: "Salas" },
  { icon: CalendarClock, id: "meetings", label: "Reunioes" },
  { icon: Radio, id: "recordings", label: "Gravacoes" },
  { icon: FileText, id: "transcripts", label: "Transcricoes" },
  { icon: ClipboardCheck, id: "minutes", label: "Atas" },
  { icon: ListChecks, id: "followups", label: "Follow-ups" },
  { icon: Clock3, id: "timeline", label: "Timeline" },
  { icon: UsersRound, id: "participants", label: "Participantes" },
  { icon: Settings2, id: "settings", label: "Config" },
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
  const [activeView, setActiveView] = useState<ChronosView>("meetings");
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

  async function handleGenerateSummary(meeting: ChronosMeeting) {
    const fallbackSummary = buildLocalExecutiveSummary(meeting);

    setSaving(true);
    setError(null);

    try {
      const response = await askHubAi({
        context: {
          agenda: meeting.metadata.agenda,
          followUps: meeting.followUps,
          meeting: {
            objective: meeting.objective,
            participants: meeting.participants,
            protocol: meeting.protocol,
            title: meeting.title,
          },
          timeline: meeting.timeline,
          transcript: meeting.transcript,
        },
        feature: "Resumo executivo Chronos com ata sob revisao humana",
        module: "chronos",
        prompt:
          "Gere um resumo executivo curto da reuniao, com decisoes, riscos, pendencias e proximos passos. Nao aprove ata automaticamente.",
      });

      await handleUpdateMeeting({
        action: "save_summary",
        meetingId: meeting.id,
        summary: response.text,
      });
    } catch {
      await handleUpdateMeeting({
        action: "save_summary",
        meetingId: meeting.id,
        summary: fallbackSummary,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <WorkspaceLayout className="chronos-workspace">
      <section className="grid gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="m-0 text-xl font-semibold tracking-normal text-[#101820]">
                Chronos
              </h1>
              <Badge variant="warning">v1 executiva</Badge>
              <StorageBadge status={snapshot.storage.status} />
            </div>
            <p className="m-0 mt-1 max-w-3xl text-sm text-[#667085]">
              Reunioes formais, memoria executiva, atas revisadas e follow-ups.
            </p>
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

        <section className="grid grid-cols-4 gap-3 lg:grid-cols-8">
          <ChronosMetric icon={<CalendarClock size={17} />} label="reunioes" value={metrics.total} />
          <ChronosMetric icon={<Radio size={17} />} label="ao vivo" value={metrics.live} />
          <ChronosMetric icon={<ClipboardCheck size={17} />} label="atas rev." value={metrics.minutesReview} />
          <ChronosMetric icon={<ListChecks size={17} />} label="follow-ups" value={metrics.followUpsOpen} />
        </section>

        <nav className="flex min-h-11 gap-1 overflow-x-auto rounded-md border border-[#d9e0e7] bg-white p-1 shadow-[0_8px_22px_rgb(16_24_32_/_0.05)]">
          {viewItems.map((item) => {
            const Icon = item.icon;

            return (
              <button
                aria-pressed={activeView === item.id}
                className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-semibold transition ${
                  activeView === item.id
                    ? "bg-[#101820] text-white"
                    : "text-[#667085] hover:bg-[#f5f7fa] hover:text-[#101820]"
                }`}
                key={item.id}
                onClick={() => setActiveView(item.id)}
                type="button"
              >
                <Icon aria-hidden="true" size={15} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <section className="grid min-h-[42rem] grid-cols-[18rem_minmax(0,1fr)_minmax(22rem,0.76fr)] gap-4 max-xl:grid-cols-[17rem_minmax(0,1fr)] max-lg:grid-cols-1">
          <ChronosMeetingColumn
            canManage={canManageChronos}
            meetings={snapshot.meetings}
            onCreate={handleCreateMeeting}
            onSelect={setSelectedMeetingId}
            rooms={snapshot.rooms}
            saving={saving}
            selectedMeetingId={selectedMeeting?.id ?? ""}
          />
          <ExecutiveRoomPanel
            meeting={selectedMeeting}
            onLocalRecording={(recording) =>
              setLocalRecordings((currentRecordings) => [
                recording,
                ...currentRecordings,
              ])
            }
            onUpdate={handleUpdateMeeting}
            saving={saving}
          />
          <section className="max-xl:col-span-2 max-lg:col-span-1">
            <ChronosDetailPanel
              activeView={activeView}
              localRecordings={localRecordings}
              meeting={selectedMeeting}
              onGenerateSummary={handleGenerateSummary}
              onUpdate={handleUpdateMeeting}
              rooms={snapshot.rooms}
              saving={saving}
              userName={hubUser?.name ?? "Lucas"}
            />
          </section>
        </section>
      </section>
    </WorkspaceLayout>
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

function ChronosMeetingColumn({
  canManage,
  meetings,
  onCreate,
  onSelect,
  rooms,
  saving,
  selectedMeetingId,
}: {
  canManage: boolean;
  meetings: ChronosMeeting[];
  onCreate: (input: ChronosCreateMeetingInput) => Promise<void>;
  onSelect: (meetingId: string) => void;
  rooms: ChronosRoom[];
  saving: boolean;
  selectedMeetingId: string;
}) {
  const [formOpen, setFormOpen] = useState(meetings.length === 0);

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
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {meetings.map((meeting) => (
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
            <span className="truncate text-xs text-[#667085]">
              {meeting.room?.name ?? "Sala pendente"}
            </span>
          </button>
        ))}
        {meetings.length === 0 ? (
          <div className="rounded-md border border-dashed border-[#d9e0e7] bg-[#fafbfc] p-4 text-sm text-[#667085]">
            Nenhuma reuniao formal registrada.
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
        durationSeconds,
        id: `local-recording-${Date.now().toString(36)}`,
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

function ChronosDetailPanel({
  activeView,
  localRecordings,
  meeting,
  onGenerateSummary,
  onUpdate,
  rooms,
  saving,
  userName,
}: {
  activeView: ChronosView;
  localRecordings: LocalRecording[];
  meeting: ChronosMeeting | null;
  onGenerateSummary: (meeting: ChronosMeeting) => Promise<void>;
  onUpdate: (input: Parameters<typeof updateChronosMeeting>[0]) => Promise<void>;
  rooms: ChronosRoom[];
  saving: boolean;
  userName: string;
}) {
  if (!meeting) {
    return (
      <Surface bordered className="grid min-h-full place-items-center border-[#d9e0e7] bg-white p-5 text-sm text-[#667085]">
        Selecione ou crie uma reuniao Chronos.
      </Surface>
    );
  }

  if (activeView === "rooms") {
    return <RoomsPanel rooms={rooms} selectedRoomId={meeting.roomId} />;
  }

  if (activeView === "recordings") {
    return <RecordingsPanel localRecordings={localRecordings} meeting={meeting} />;
  }

  if (activeView === "transcripts") {
    return (
      <TranscriptPanel
        meeting={meeting}
        onUpdate={onUpdate}
        saving={saving}
        userName={userName}
      />
    );
  }

  if (activeView === "minutes") {
    return (
      <MinutesPanel
        meeting={meeting}
        onGenerateSummary={onGenerateSummary}
        onUpdate={onUpdate}
        saving={saving}
      />
    );
  }

  if (activeView === "followups") {
    return <FollowUpsPanel meeting={meeting} onUpdate={onUpdate} saving={saving} />;
  }

  if (activeView === "timeline") {
    return <TimelinePanel meeting={meeting} onUpdate={onUpdate} saving={saving} />;
  }

  if (activeView === "participants") {
    return <ParticipantsPanel meeting={meeting} />;
  }

  if (activeView === "settings") {
    return <ChronosSettingsPanel meeting={meeting} />;
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

function MeetingOverview({
  meeting,
  onUpdate,
  saving,
}: {
  meeting: ChronosMeeting;
  onUpdate: (input: Parameters<typeof updateChronosMeeting>[0]) => Promise<void>;
  saving: boolean;
}) {
  return (
    <div className="grid gap-4">
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
        <div className="grid grid-cols-3 gap-2">
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
                  {room.roomType} / {room.capacity} lugares
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
}: {
  localRecordings: LocalRecording[];
  meeting: ChronosMeeting;
}) {
  return (
    <Surface bordered className="min-h-full border-[#d9e0e7] bg-white p-4">
      <PanelTitle eyebrow="Gravacoes" title="Registro audiovisual" />
      <div className="mt-4 grid grid-cols-2 gap-3">
        <InfoBlock
          label="status"
          value={chronosCaptureStatusLabels[meeting.recordingStatus]}
        />
        <InfoBlock label="arquivos locais" value={String(localRecordings.length)} />
      </div>
      <div className="mt-4 grid gap-2">
        {[...localRecordings, ...meeting.recordings.map(mapPersistedRecording)].map(
          (recording) => (
            <a
              className="flex items-center justify-between gap-3 rounded-md border border-[#edf0f4] bg-[#fafbfc] p-3 text-sm font-semibold text-[#101820] transition hover:border-[#d9e0e7] hover:bg-white"
              href={recording.url}
              key={recording.id}
              rel="noreferrer"
              target="_blank"
            >
              <span className="truncate">{recording.name}</span>
              <span className="text-xs text-[#667085]">
                {formatDuration(recording.durationSeconds)}
              </span>
            </a>
          ),
        )}
        {localRecordings.length === 0 && meeting.recordings.length === 0 ? (
          <EmptyPanel text="Nenhuma gravacao registrada." />
        ) : null}
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
  onGenerateSummary,
  onUpdate,
  saving,
}: {
  meeting: ChronosMeeting;
  onGenerateSummary: (meeting: ChronosMeeting) => Promise<void>;
  onUpdate: (input: Parameters<typeof updateChronosMeeting>[0]) => Promise<void>;
  saving: boolean;
}) {
  const latestMinutes = meeting.minutes[0];
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
          <button
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm font-semibold text-[#101820] transition hover:bg-[#f8fafc] disabled:cursor-wait disabled:opacity-60"
            disabled={saving}
            onClick={() => void onGenerateSummary(meeting)}
            type="button"
          >
            <Sparkles aria-hidden="true" size={15} />
            Gerar resumo IA
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

function FollowUpsPanel({
  meeting,
  onUpdate,
  saving,
}: {
  meeting: ChronosMeeting;
  onUpdate: (input: Parameters<typeof updateChronosMeeting>[0]) => Promise<void>;
  saving: boolean;
}) {
  const [title, setTitle] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [dueAt, setDueAt] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await onUpdate({
      action: "create_followup",
      dueAt,
      meetingId: meeting.id,
      ownerName,
      title,
    });
    setTitle("");
    setOwnerName("");
    setDueAt("");
  }

  return (
    <Surface bordered className="grid min-h-full grid-rows-[auto_auto_minmax(0,1fr)] border-[#d9e0e7] bg-white">
      <div className="border-b border-[#edf0f4] p-4">
        <PanelTitle eyebrow="Follow-ups" title="Encaminhamentos" />
      </div>
      <form className="grid grid-cols-[minmax(0,1fr)_9rem_10rem_auto] gap-2 border-b border-[#edf0f4] bg-[#fafbfc] p-3 max-lg:grid-cols-1" onSubmit={handleSubmit}>
        <input
          className="h-9 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm outline-none focus:border-[#A07C3B]"
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Encaminhamento"
          required
          value={title}
        />
        <input
          className="h-9 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm outline-none focus:border-[#A07C3B]"
          onChange={(event) => setOwnerName(event.target.value)}
          placeholder="Responsavel"
          value={ownerName}
        />
        <input
          className="h-9 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm outline-none focus:border-[#A07C3B]"
          onChange={(event) => setDueAt(event.target.value)}
          type="datetime-local"
          value={dueAt}
        />
        <button
          className="grid h-9 w-9 place-items-center rounded-md bg-[#101820] text-white disabled:cursor-wait disabled:opacity-60"
          disabled={saving}
          type="submit"
        >
          <Plus aria-hidden="true" size={16} />
        </button>
      </form>
      <div className="min-h-0 overflow-y-auto p-3">
        {meeting.followUps.map((followUp) => (
          <FollowUpItem
            followUp={followUp}
            key={followUp.id}
            meetingId={meeting.id}
            onUpdate={onUpdate}
            saving={saving}
          />
        ))}
        {meeting.followUps.length === 0 ? (
          <EmptyPanel text="Nenhum follow-up aberto." />
        ) : null}
      </div>
    </Surface>
  );
}

function FollowUpItem({
  followUp,
  meetingId,
  onUpdate,
  saving,
}: {
  followUp: ChronosFollowUp;
  meetingId: string;
  onUpdate: (input: Parameters<typeof updateChronosMeeting>[0]) => Promise<void>;
  saving: boolean;
}) {
  return (
    <div className="mb-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-[#edf0f4] bg-[#fafbfc] p-3">
      <div className="min-w-0">
        <p className="m-0 truncate text-sm font-semibold text-[#101820]">
          {followUp.title}
        </p>
        <p className="m-0 mt-1 truncate text-xs text-[#667085]">
          {followUp.ownerName || "Sem responsavel"} / {formatDateTime(followUp.dueAt)}
        </p>
      </div>
      {followUp.status === "done" ? (
        <Badge variant="success">{chronosFollowUpStatusLabels.done}</Badge>
      ) : (
        <Tooltip content="Concluir follow-up">
          <button
            aria-label="Concluir follow-up"
            className="grid h-8 w-8 place-items-center rounded-md border border-[#d9e0e7] bg-white text-[#526078] hover:text-emerald-700 disabled:cursor-wait disabled:opacity-60"
            disabled={saving}
            onClick={() =>
              void onUpdate({
                action: "complete_followup",
                followUpId: followUp.id,
                meetingId,
              })
            }
            type="button"
          >
            <CheckCircle2 aria-hidden="true" size={16} />
          </button>
        </Tooltip>
      )}
    </div>
  );
}

function TimelinePanel({
  meeting,
  onUpdate,
  saving,
}: {
  meeting: ChronosMeeting;
  onUpdate: (input: Parameters<typeof updateChronosMeeting>[0]) => Promise<void>;
  saving: boolean;
}) {
  const [title, setTitle] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await onUpdate({
      action: "add_timeline_event",
      eventType: "note",
      meetingId: meeting.id,
      title,
    });
    setTitle("");
  }

  return (
    <Surface bordered className="grid min-h-full grid-rows-[auto_auto_minmax(0,1fr)] border-[#d9e0e7] bg-white">
      <div className="border-b border-[#edf0f4] p-4">
        <PanelTitle eyebrow="Timeline" title="Linha do tempo" />
      </div>
      <form className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-b border-[#edf0f4] bg-[#fafbfc] p-3" onSubmit={handleSubmit}>
        <input
          className="h-9 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm outline-none focus:border-[#A07C3B]"
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Marco operacional"
          required
          value={title}
        />
        <button
          className="grid h-9 w-9 place-items-center rounded-md bg-[#101820] text-white disabled:cursor-wait disabled:opacity-60"
          disabled={saving}
          type="submit"
        >
          <Plus aria-hidden="true" size={16} />
        </button>
      </form>
      <div className="min-h-0 overflow-y-auto p-3">
        {meeting.timeline.map((event) => (
          <div
            className="mb-2 grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-md border border-[#edf0f4] bg-[#fafbfc] p-3"
            key={event.id}
          >
            <span className="mt-1 h-2.5 w-2.5 rounded-full bg-[#A07C3B]" />
            <div className="min-w-0">
              <p className="m-0 text-sm font-semibold text-[#101820]">
                {event.title}
              </p>
              <p className="m-0 mt-1 text-xs text-[#667085]">
                {formatDateTime(event.eventAt)} / {event.eventType}
              </p>
            </div>
          </div>
        ))}
      </div>
    </Surface>
  );
}

function ParticipantsPanel({ meeting }: { meeting: ChronosMeeting }) {
  return (
    <Surface bordered className="min-h-full border-[#d9e0e7] bg-white p-4">
      <PanelTitle eyebrow="Participantes" title="Presenca formal" />
      <div className="mt-4 grid gap-2">
        {meeting.participants.map((participant) => (
          <div
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-[#edf0f4] bg-[#fafbfc] p-3"
            key={participant.id}
          >
            <div className="min-w-0">
              <p className="m-0 truncate text-sm font-semibold text-[#101820]">
                {participant.displayName}
              </p>
              <p className="m-0 mt-1 truncate text-xs text-[#667085]">
                {participant.email || "-"} / {participant.organization || "Careli"}
              </p>
            </div>
            <Badge variant={participant.role === "host" ? "warning" : "neutral"}>
              {participant.role}
            </Badge>
          </div>
        ))}
      </div>
    </Surface>
  );
}

function ChronosSettingsPanel({ meeting }: { meeting: ChronosMeeting }) {
  return (
    <Surface bordered className="min-h-full border-[#d9e0e7] bg-white p-4">
      <PanelTitle eyebrow="Config" title="Politica da reuniao" />
      <div className="mt-4 grid gap-3">
        <InfoBlock label="ata" value="revisao humana obrigatoria" />
        <InfoBlock label="gravacao" value={chronosCaptureStatusLabels[meeting.recordingStatus]} />
        <InfoBlock label="transcricao" value={chronosCaptureStatusLabels[meeting.transcriptionStatus]} />
        <InfoBlock label="status formal" value={chronosMeetingStatusLabels[meeting.status]} />
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

function StorageBadge({ status }: { status: ChronosSnapshot["storage"]["status"] }) {
  if (status === "supabase") {
    return <Badge variant="success">Supabase</Badge>;
  }

  if (status === "migration_pendente") {
    return <Badge variant="warning">migration</Badge>;
  }

  if (status === "local") {
    return <Badge variant="info">local</Badge>;
  }

  return <Badge variant="neutral">offline</Badge>;
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
    minutesReview: meetings.filter(
      (meeting) => meeting.minutesStatus === "in_review",
    ).length,
    total: meetings.length,
  };
}

function parseLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
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

function buildLocalExecutiveSummary(meeting: ChronosMeeting) {
  const agenda = Array.isArray(meeting.metadata.agenda)
    ? meeting.metadata.agenda.join("; ")
    : "";
  const transcript = meeting.transcript
    .slice(-5)
    .map((segment) => segment.content)
    .join(" ");
  const followUps = meeting.followUps
    .filter((followUp) => followUp.status !== "done")
    .map((followUp) => followUp.title)
    .join("; ");

  return [
    `Resumo preliminar da reuniao ${meeting.protocol}.`,
    meeting.objective ? `Objetivo: ${meeting.objective}` : "",
    agenda ? `Pauta: ${agenda}` : "",
    transcript ? `Pontos registrados: ${transcript.slice(0, 900)}` : "",
    followUps ? `Follow-ups abertos: ${followUps}` : "Follow-ups abertos: -",
    "Ata permanece pendente de revisao humana antes de formalizacao.",
  ]
    .filter(Boolean)
    .join("\n");
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

function mapPersistedRecording(recording: ChronosMeeting["recordings"][number]) {
  return {
    durationSeconds: recording.durationSeconds ?? 0,
    id: recording.id,
    name: recording.storagePath ?? recording.status,
    url: "#",
  };
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
