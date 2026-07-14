import {
  buildAbsoluteExternalRoomLink,
  buildExternalRoomLink,
  buildRoomInputFromDraft,
  createRoomDraft,
  optimizeChronosRoomBackgroundDataUrl,
  readChronosRoomBackgroundFileAsDataUrl,
  slugifyRoomName,
  type ChronosRoomDraft,
} from "@/lib/chronos/rooms";
import type {
  ChronosMeeting,
  ChronosRoom,
  ChronosRoomInput,
  ChronosRoomUpdateInput,
} from "@/lib/chronos/types";
import { Badge, Surface } from "@repo/uix";
import { ImagePlus, Plus, Save, Trash2, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { EmptyPanel, PanelTitle } from "./chronos-panels";

const chronosRoomBackgroundUploadLimitBytes = 5_000_000;
const chronosWherebyRoomBackgroundLimitBytes = 580 * 1024;

type ChronosRoomsManagementScreenProps = {
  meetings: ChronosMeeting[];
  onCreateRoom: (input: ChronosRoomInput) => Promise<ChronosRoom | null>;
  onDeleteRoom: (roomId: string) => Promise<ChronosRoom | null>;
  onUpdateRoom: (input: ChronosRoomUpdateInput) => Promise<ChronosRoom | null>;
  rooms: ChronosRoom[];
  saving: boolean;
};

export function ChronosRoomsManagementScreen({
  meetings,
  onCreateRoom,
  onDeleteRoom,
  onUpdateRoom,
  rooms,
  saving,
}: ChronosRoomsManagementScreenProps) {
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

    let normalizedDraft: ChronosRoomDraft;

    try {
      normalizedDraft = await normalizeRoomDraftBackground(roomDraft);
    } catch (error) {
      window.alert(
        error instanceof Error
          ? error.message
          : "Nao foi possivel otimizar o fundo da sala.",
      );
      return;
    }

    const input = buildRoomInputFromDraft(normalizedDraft);

    if (normalizedDraft !== roomDraft) {
      setRoomDraft(normalizedDraft);
    }

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

    try {
      const dataUrl = await readChronosRoomBackgroundFileAsDataUrl({
        file,
        maxBytes: chronosWherebyRoomBackgroundLimitBytes,
      });

      setRoomDraft((currentDraft) => ({
        ...currentDraft,
        backgroundDataUrl: dataUrl,
        backgroundName:
          file.size > chronosWherebyRoomBackgroundLimitBytes
            ? `${file.name} (otimizado)`
            : file.name,
      }));
    } catch (error) {
      window.alert(
        error instanceof Error
          ? error.message
          : "Nao foi possivel otimizar o fundo da sala.",
      );
    }
  }

  const externalRoomPath = buildExternalRoomLink(roomDraft.slug);
  const externalRoomLink = buildAbsoluteExternalRoomLink(roomDraft.slug);
  const roomFormTitle = isCreatingRoom ? "Nova sala" : selectedRoom?.name ?? "Sala";

  return (
    <div className="grid gap-4">
      <Surface bordered className="border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-4">
          <PanelTitle eyebrow="Salas" title="Ambientes fixos" />
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-surface px-3 text-sm font-semibold text-ink transition hover:border-[#A07C3B] hover:text-[#A07C3B] disabled:cursor-not-allowed disabled:opacity-55"
            disabled={saving}
            onClick={startNewRoomDraft}
            type="button"
          >
            <Plus aria-hidden="true" size={15} />
            Nova sala
          </button>
        </div>
        <div className="hidden grid-cols-[minmax(12rem,1.2fr)_minmax(10rem,0.8fr)_minmax(12rem,1fr)_minmax(8rem,0.7fr)_auto] gap-3 border-b border-line bg-subtle px-4 py-2 text-xs font-bold uppercase text-ink-muted lg:grid">
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

            const roomPath = buildExternalRoomLink(room.slug);
            const roomLink = buildAbsoluteExternalRoomLink(room.slug);

            return (
              <div
                className={`grid gap-3 px-4 py-3 text-sm transition lg:grid-cols-[minmax(12rem,1.2fr)_minmax(10rem,0.8fr)_minmax(12rem,1fr)_minmax(8rem,0.7fr)_auto] lg:items-center ${
                  roomEditorOpen && !isCreatingRoom && room.id === selectedRoom?.id
                    ? "bg-[#fffaf0] dark:bg-[#a07c3b]/10"
                    : "bg-surface hover:bg-subtle"
                }`}
                key={room.id}
              >
                <button
                  className="grid min-w-0 gap-1 text-left"
                  onClick={() => openRoomEditor(room)}
                  type="button"
                >
                  <span className="truncate font-semibold text-ink">
                    {room.name}
                  </span>
                  <span className="text-xs text-ink-muted">
                    {room.capacity} lugares
                  </span>
                </button>
                <a
                  className="truncate text-xs font-semibold text-ink-muted transition hover:text-[#A07C3B]"
                  href={roomPath}
                  rel="noreferrer"
                  target="_blank"
                >
                  {roomLink}
                </a>
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
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-xs font-semibold text-ink transition hover:border-[#A07C3B] hover:text-[#A07C3B]"
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
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-inverse/35 px-4 py-8 backdrop-blur-sm">
          <button
            aria-label="Fechar configuracao de sala"
            className="absolute inset-0 cursor-default"
            onClick={closeRoomEditor}
            type="button"
          />
          <Surface bordered className="relative z-10 w-full max-w-3xl border-line bg-surface shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-line p-4">
              <PanelTitle eyebrow="Configuracao" title={roomFormTitle} />
              <button
                aria-label="Fechar configuracao"
                className="grid h-8 w-8 place-items-center rounded-md text-ink-muted transition hover:bg-subtle hover:text-ink"
                onClick={closeRoomEditor}
                type="button"
              >
                <X aria-hidden="true" size={16} />
              </button>
            </div>
            <form className="grid gap-3 p-4" onSubmit={handleSaveRoom}>
              <label className="grid gap-1 text-xs font-bold uppercase text-ink-muted">
                Nome da sala
                <input
                  className="h-9 rounded-md border border-line bg-surface px-3 text-sm normal-case text-ink outline-none focus:border-[#A07C3B]"
                  onChange={(event) => updateRoomDraft("name", event.target.value)}
                  placeholder="Sala Financeiro"
                  value={roomDraft.name}
                />
              </label>
              <label className="grid gap-1 text-xs font-bold uppercase text-ink-muted">
                Link externo
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem]">
                  <input
                    className="h-9 rounded-md border border-line bg-surface px-3 text-sm normal-case text-ink outline-none focus:border-[#A07C3B]"
                    onChange={(event) =>
                      updateRoomDraft("slug", slugifyRoomName(event.target.value))
                    }
                    placeholder="sala-financeiro"
                    value={roomDraft.slug}
                  />
                  <span className="inline-flex h-9 items-center justify-center rounded-md border border-line bg-subtle px-2 text-xs normal-case text-ink-muted">
                    solicitar entrada
                  </span>
                </div>
                <a
                  className="truncate rounded-md border border-line bg-subtle px-3 py-2 text-xs normal-case text-ink-muted transition hover:border-[#A07C3B] hover:text-[#A07C3B]"
                  href={externalRoomPath}
                  rel="noreferrer"
                  target="_blank"
                >
                  {externalRoomLink}
                </a>
              </label>
              <label className="grid gap-1 text-xs font-bold uppercase text-ink-muted">
                Lugares
                <input
                  className="h-9 rounded-md border border-line bg-surface px-3 text-sm normal-case text-ink outline-none focus:border-[#A07C3B]"
                  min={1}
                  max={200}
                  onChange={(event) =>
                    updateRoomDraft("capacity", event.target.value)
                  }
                  type="number"
                  value={roomDraft.capacity}
                />
              </label>
              <div className="grid gap-2 rounded-md border border-line bg-subtle p-3">
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
                    className="flex items-center justify-between gap-3 text-sm font-semibold text-ink"
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
                <span className="text-xs font-bold uppercase text-ink-muted">
                  Fundo da sala
                </span>
                <label className="inline-flex h-9 w-fit cursor-pointer items-center gap-2 rounded-md border border-line bg-surface px-3 text-sm font-semibold text-ink transition hover:border-[#A07C3B] hover:text-[#A07C3B]">
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
                    className="min-h-28 rounded-md border border-line bg-cover bg-center p-3"
                    style={{
                      backgroundImage: `linear-gradient(rgba(16, 24, 32, 0.22), rgba(16, 24, 32, 0.22)), url(${roomDraft.backgroundDataUrl})`,
                    }}
                  >
                    <Badge variant="neutral">
                      {roomDraft.backgroundName || "fundo selecionado"}
                    </Badge>
                  </div>
                ) : roomDraft.backgroundName ? (
                  // Fundo salvo no banco: os bytes nao viajam mais no snapshot
                  // (fix 7/jul), entao mostramos o NOME do fundo definido em vez
                  // de mentir "sem fundo". Escolher novo arquivo substitui.
                  <div className="rounded-md border border-line bg-[#f7f3eb] dark:bg-[#a07c3b]/10 p-3 text-xs font-semibold text-[#7b5f2d]">
                    Fundo personalizado definido: {roomDraft.backgroundName}. Ele
                    e aplicado na sala de video; escolha um arquivo para
                    substituir.
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed border-line bg-subtle p-3 text-xs font-semibold text-ink-muted">
                    Sem fundo enviado. A sala usa o padrao institucional Chronos.
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                <button
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-line-strong bg-inverse px-3 text-sm font-semibold text-brand-ink transition hover:border-[#A07C3B] hover:bg-[#A07C3B] disabled:cursor-not-allowed disabled:opacity-55"
                  disabled={saving}
                  type="submit"
                >
                  <Save aria-hidden="true" size={15} />
                  Salvar
                </button>
                <div className="flex flex-wrap gap-2">
                  {isCreatingRoom ? (
                    <button
                      className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-surface px-3 text-sm font-semibold text-ink-muted transition hover:text-ink"
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
                      className="inline-flex h-9 items-center gap-2 rounded-md border border-red-200 dark:border-red-500/30 bg-surface px-3 text-sm font-semibold text-red-700 dark:text-red-300 transition hover:bg-red-50 dark:bg-red-500/12 disabled:cursor-not-allowed disabled:opacity-55"
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

async function normalizeRoomDraftBackground(draft: ChronosRoomDraft) {
  if (!draft.backgroundDataUrl) {
    return draft;
  }

  const backgroundDataUrl = await optimizeChronosRoomBackgroundDataUrl({
    dataUrl: draft.backgroundDataUrl,
    maxBytes: chronosWherebyRoomBackgroundLimitBytes,
  });

  if (backgroundDataUrl === draft.backgroundDataUrl) {
    return draft;
  }

  return {
    ...draft,
    backgroundDataUrl,
    backgroundName: draft.backgroundName
      ? `${draft.backgroundName} (otimizado)`
      : "fundo-chronos-otimizado.jpg",
  };
}
