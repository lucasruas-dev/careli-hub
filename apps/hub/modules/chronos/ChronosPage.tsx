"use client";

import {
  createChronosMeeting,
  createChronosRoom,
  deleteChronosMeeting,
  deleteChronosRoom,
  draftChronosMinutes,
  loadChronosSnapshot,
  transcribeChronosExistingRecording,
  transcribeChronosRecording,
  updateChronosRoom,
  updateChronosMeeting,
} from "@/lib/chronos/client";
import {
  defaultChronosMeetingProfiles,
  type ChronosCreateMeetingInput,
  type ChronosMeeting,
  type ChronosMinutesProfile,
  type ChronosRoomInput,
  type ChronosRoomUpdateInput,
  type ChronosSnapshot,
} from "@/lib/chronos/types";
import type { LocalRecording } from "@/lib/chronos/drive";
import { useAuth } from "@/providers/auth-provider";
import { Surface, WorkspaceLayout } from "@repo/uix";
import { type ChronosDriveView } from "./components/chronos-drive-panel";
import { ChronosAgendaScreen } from "./components/chronos-agenda-screen";
import { ChronosDriveLibraryScreen } from "./components/chronos-drive-library-screen";
import { ChronosRoomsManagementScreen } from "./components/chronos-rooms-management-screen";
import {
  ChronosModuleSidebar,
  type ChronosView,
} from "./components/chronos-sidebar";
import { Loader2, RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

const emptySnapshot: ChronosSnapshot = {
  meetings: [],
  profiles: [...defaultChronosMeetingProfiles],
  rooms: [],
  storage: { status: "offline" },
};

export function ChronosPage() {
  const { hubUser } = useAuth();
  const canManageChronos = Boolean(
    hubUser?.permissions.includes("chronos:manage"),
  );
  const canDeleteChronosMinutes = hubUser?.role === "admin";
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

  async function handleTranscribeExistingRecording(input: {
    meeting: ChronosMeeting;
    minutesProfile?: ChronosMinutesProfile;
    recordingId: string;
  }) {
    setSaving(true);
    setError(null);

    try {
      const updatedMeeting = await transcribeChronosExistingRecording({
        meetingId: input.meeting.id,
        minutesProfile: input.minutesProfile,
        recordingId: input.recordingId,
        speakerLabel: "Athena",
      });

      replaceMeeting(updatedMeeting);
    } catch (transcriptionError) {
      setError(
        transcriptionError instanceof Error
          ? transcriptionError.message
          : "Nao foi possivel transcrever a gravacao salva.",
      );
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    setError(null);
  }, [activeView, driveView, selectedMeetingId]);

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
            onReload={reloadChronos}
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
            onTranscribeExistingRecording={handleTranscribeExistingRecording}
            onTranscribeRecording={handleTranscribeRecording}
            onUpdate={handleUpdateMeeting}
            rooms={snapshot.rooms}
            saving={saving}
            canDeleteMinutes={canDeleteChronosMinutes}
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
