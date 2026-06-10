import type { ChronosRoom } from "@/lib/chronos/types";
import { Badge, Surface } from "@repo/uix";
import { PanelTitle } from "./chronos-panels";

type RoomsPanelProps = {
  rooms: ChronosRoom[];
  selectedRoomId?: string | null;
};

export function RoomsPanel({ rooms, selectedRoomId }: RoomsPanelProps) {
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
              <span>
                transcricao {room.transcriptionRequired ? "sim" : "nao"}
              </span>
              <span>ata {room.minutesRequired ? "sim" : "nao"}</span>
            </div>
          </div>
        ))}
      </div>
    </Surface>
  );
}
