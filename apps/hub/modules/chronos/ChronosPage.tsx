"use client";

import {
  createChronosMeeting,
  createChronosRoom,
  deleteChronosMeeting,
  deleteChronosRoom,
  draftChronosMinutes,
  loadChronosMeetingArtifacts,
  loadChronosProfiles,
  loadChronosRooms,
  loadChronosSnapshot,
  transcribeChronosExistingRecording,
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
import { expandChronosRecurrenceOccurrences } from "@/lib/chronos/calendar";
import {
  PanteonLoadingMark,
  PanteonLoadingState,
} from "@/components/panteon/panteon-loading";
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
import { RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { usePersistedState } from "@/hooks/use-persisted-state";
import {
  isChronosSnapshotCacheFresh,
  mirrorChronosSnapshotCache,
  readChronosSnapshotCache,
  writeChronosSnapshotCache,
} from "@/lib/chronos/snapshot-cache";

const emptySnapshot: ChronosSnapshot = {
  meetings: [],
  profiles: [...defaultChronosMeetingProfiles],
  rooms: [],
  storage: { status: "offline" },
};

export function ChronosPage() {
  const { authState, hubUser } = useAuth();
  const canManageChronos = Boolean(
    hubUser?.permissions.includes("chronos:manage"),
  );
  const canDeleteChronosMinutes = hubUser?.role === "admin";
  // Aba INSTANTANEA (pedido Lucas 7/jul): nasce com o snapshot da ultima
  // visita (cache em memoria) e atualiza em silencio por tras — sem esqueleto
  // de loading a cada clique na aba.
  const [snapshot, setSnapshot] = useState<ChronosSnapshot>(
    () => readChronosSnapshotCache() ?? emptySnapshot,
  );
  // Persistidos: reunião aberta, tela ativa (agenda/salas/drive), sub-visão do
  // Drive e sidebar "continuam de onde estavam". Ver [[use-persisted-state]].
  const [selectedMeetingId, setSelectedMeetingId] = usePersistedState(
    "chronos.selectedMeetingId",
    "",
  );
  const [activeView, setActiveView] = usePersistedState<ChronosView>(
    "chronos.activeView",
    "agenda",
  );
  const [driveView, setDriveView] = usePersistedState<ChronosDriveView>(
    "chronos.driveView",
    "recordings",
  );
  const [chronosSidebarCollapsed, setChronosSidebarCollapsed] = usePersistedState(
    "chronos.sidebarCollapsed",
    false,
    { backend: "local" },
  );
  const [loading, setLoading] = useState(() => readChronosSnapshotCache() === null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const localRecordings = useMemo<LocalRecording[]>(() => [], []);
  const selectedMeeting = useMemo(
    () =>
      snapshot.meetings.find((meeting) => meeting.id === selectedMeetingId) ??
      snapshot.meetings[0] ??
      null,
    [selectedMeetingId, snapshot.meetings],
  );
  const showInitialLoading =
    loading && snapshot.meetings.length === 0 && snapshot.rooms.length === 0;

  // Espelha o estado local no cache: a proxima montagem nasce com o que voce
  // estava vendo (mutacoes e hidratacoes inclusas).
  useEffect(() => {
    if (snapshot.meetings.length > 0 || snapshot.rooms.length > 0) {
      mirrorChronosSnapshotCache(snapshot);
    }
  }, [snapshot]);

  // SNAPSHOT LEVE: timeline/transcricao/chat nao vem mais no snapshot geral
  // (peso derrubava a funcao). Hidrata sob demanda quando a reuniao abre.
  const [hydratedMeetingIds] = useState(() => new Set<string>());

  useEffect(() => {
    const meeting = snapshot.meetings.find(
      (currentMeeting) => currentMeeting.id === selectedMeetingId,
    );

    if (!meeting || hydratedMeetingIds.has(meeting.id)) {
      return;
    }

    const needsArtifacts =
      (meeting.transcriptSegmentCount ?? 0) > 0 ||
      meeting.transcriptionStatus === "available" ||
      meeting.recordingStatus === "available" ||
      meeting.minutes.length > 0;

    if (!needsArtifacts) {
      return;
    }

    hydratedMeetingIds.add(meeting.id);
    let active = true;

    void loadChronosMeetingArtifacts(meeting.id)
      .then((artifacts) => {
        if (!active) {
          return;
        }

        setSnapshot((currentSnapshot) => ({
          ...currentSnapshot,
          meetings: currentSnapshot.meetings.map((currentMeeting) =>
            currentMeeting.id === meeting.id
              ? {
                  ...currentMeeting,
                  chatMessages: artifacts.chatMessages,
                  timeline: artifacts.timeline,
                  transcript: artifacts.transcript,
                }
              : currentMeeting,
          ),
        }));
      })
      .catch(() => {
        // Permite nova tentativa ao reabrir a reuniao.
        hydratedMeetingIds.delete(meeting.id);
      });

    return () => {
      active = false;
    };
  }, [hydratedMeetingIds, selectedMeetingId, snapshot.meetings]);

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
  }, [setSelectedMeetingId]);

  const reloadChronos = useCallback(async (
    { skipIfFresh = false }: { skipIfFresh?: boolean } = {},
  ) => {
    // Remontagem logo apos uma carga (ping-pong de abas): o cache fresco
    // segura a tela e NAO vai a rede — instantaneo e sem custo.
    if (skipIfFresh && isChronosSnapshotCacheFresh()) {
      setLoading(false);
      return;
    }

    // Com cache na tela, o refresh e SILENCIOSO (sem esqueleto por cima).
    if (readChronosSnapshotCache() === null) {
      setLoading(true);
    }
    setError(null);

    try {
      const nextSnapshot = await loadChronosSnapshot();

      writeChronosSnapshotCache(nextSnapshot);
      setSnapshot(nextSnapshot);
      setSelectedMeetingId((currentId) => {
        if (nextSnapshot.meetings.some((meeting) => meeting.id === currentId)) {
          return currentId;
        }

        return nextSnapshot.meetings[0]?.id ?? "";
      });
    } catch (loadError) {
      const fallbackSnapshot = await loadChronosFallbackSnapshot();

      if (fallbackSnapshot) {
        setSnapshot((currentSnapshot) => ({
          ...currentSnapshot,
          meetings: [],
          profiles: fallbackSnapshot.profiles,
          rooms: fallbackSnapshot.rooms,
          storage: {
            message:
              "Chronos carregou Salas e Perfis em modo parcial. A agenda ainda precisa de diagnostico do snapshot de reunioes.",
            status: "offline",
          },
        }));
        setSelectedMeetingId("");
      }

      setError(getChronosLoadErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [setSelectedMeetingId]);

  useEffect(() => {
    void reloadChronos({ skipIfFresh: true });
  }, [reloadChronos]);

  async function handleCreateMeeting(input: ChronosCreateMeetingInput) {
    if (!canManageChronos) {
      setError("Seu usuario pode visualizar o Chronos, mas nao gerenciar reunioes.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const recurrenceRule = input.recurrence?.rrule;
      const occurrences =
        recurrenceRule && input.startsAt
          ? expandChronosRecurrenceOccurrences({
              endsAt: input.endsAt ?? null,
              // Materializa um horizonte conservador (cada ocorrencia e uma
              // reuniao real criada agora); a serie pode ser estendida depois.
              horizonDays: 150,
              maxOccurrences: 16,
              rrule: recurrenceRule,
              startsAt: input.startsAt,
            })
          : [];

      if (occurrences.length > 1) {
        // Recorrencia materializada: cada ocorrencia vira uma reuniao real que
        // herda a sala/tipo/participantes (mantendo Drive e ata organizados por
        // sala). Todas levam a mesma referencia de serie e NAO enviam a RRULE
        // (cada uma e um evento individual no Google, sem perder a sala).
        const seriesReference = `chronos-series:${crypto.randomUUID()}`;

        for (const occurrence of occurrences) {
          const occurrenceMeeting = await createChronosMeeting({
            ...input,
            endsAt: occurrence.endsAt ?? undefined,
            externalReference: seriesReference,
            recurrence: undefined,
            startsAt: occurrence.startsAt,
          });

          replaceMeeting(occurrenceMeeting);
        }
      } else {
        const meeting = await createChronosMeeting(input);

        replaceMeeting(meeting);
      }
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

  async function handleUpdateParticipantResponse(
    input: Extract<
      Parameters<typeof updateChronosMeeting>[0],
      { action: "update_participant_response" }
    >,
  ) {
    setSaving(true);
    setError(null);

    try {
      const meeting = await updateChronosMeeting(input);

      replaceMeeting(meeting);
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Nao foi possivel responder a agenda.",
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

  async function handleTranscribeExistingRecording(input: {
    meeting: ChronosMeeting;
    minutesProfile?: ChronosMinutesProfile;
    recordingId: string;
  }): Promise<boolean> {
    setSaving(true);
    setError(null);

    try {
      const updatedMeeting = await transcribeChronosExistingRecording({
        meetingId: input.meeting.id,
        minutesProfile: input.minutesProfile,
        recordingId: input.recordingId,
        speakerLabel: "Audio completo da reuniao",
      });

      replaceMeeting(updatedMeeting);
      return true;
    } catch (transcriptionError) {
      setError(
        transcriptionError instanceof Error
          ? transcriptionError.message
          : "Nao foi possivel transcrever a gravacao salva.",
      );
      return false;
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
        <main className="relative min-h-0 min-w-0 overflow-y-auto p-3 lg:p-4">
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
                <PanteonLoadingMark size="xs" />
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
            currentUser={{
              email: authState.user?.email,
              id: hubUser?.id,
            }}
            meetings={snapshot.meetings}
            onCreate={handleCreateMeeting}
            onDeleteMeeting={handleDeleteMeeting}
            onReload={reloadChronos}
            onRespondToMeeting={handleUpdateParticipantResponse}
            onSelectMeeting={setSelectedMeetingId}
            onUpdate={handleUpdateMeeting}
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
            onUpdate={handleUpdateMeeting}
            rooms={snapshot.rooms}
            saving={saving}
            canDeleteMinutes={canDeleteChronosMinutes}
            userName={hubUser?.name ?? "Lucas"}
          />
        ) : null}
            </section>
          </WorkspaceLayout>
          {showInitialLoading ? (
            <PanteonLoadingState
              className="z-50 rounded-none border-0 bg-[#f3f6fa]/72 backdrop-blur-sm"
              markSize="lg"
              title="Carregando Chronos"
              variant="overlay"
            />
          ) : null}
        </main>
      </div>
    </div>
  );
}

async function loadChronosFallbackSnapshot(): Promise<
  Pick<ChronosSnapshot, "profiles" | "rooms"> | null
> {
  const [roomsResult, profilesResult] = await Promise.allSettled([
    loadChronosRooms(),
    loadChronosProfiles(),
  ]);

  const rooms =
    roomsResult.status === "fulfilled" ? roomsResult.value : null;
  const profiles =
    profilesResult.status === "fulfilled" ? profilesResult.value : null;

  if (!rooms && !profiles) {
    return null;
  }

  return {
    profiles: profiles ?? [...defaultChronosMeetingProfiles],
    rooms: rooms ?? [],
  };
}

function getChronosLoadErrorMessage(loadError: unknown) {
  return loadError instanceof Error
    ? loadError.message
    : "Nao foi possivel carregar o Chronos.";
}
