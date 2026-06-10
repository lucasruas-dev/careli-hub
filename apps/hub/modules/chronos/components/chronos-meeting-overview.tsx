import { getChronosCheckedInParticipants } from "@/lib/chronos/minutes";
import {
  chronosMeetingTypeLabels,
  type ChronosMeeting,
} from "@/lib/chronos/types";
import { formatChronosDateTime } from "@/lib/chronos/format";
import { Badge } from "@repo/uix";
import {
  CalendarClock,
  CheckCircle2,
  Radio,
  ShieldCheck,
} from "lucide-react";
import { buildChronosNextAction, type ChronosNextAction } from "./chronos-next-action";
import { InfoBlock, StatusActionButton } from "./chronos-panels";

type ChronosMeetingStatusUpdateInput = {
  action: "set_status";
  meetingId: string;
  status: ChronosMeeting["status"];
};

type MeetingOverviewProps = {
  meeting: ChronosMeeting;
  onUpdate: (input: ChronosMeetingStatusUpdateInput) => Promise<void>;
  saving: boolean;
};

export function MeetingOverview({
  meeting,
  onUpdate,
  saving,
}: MeetingOverviewProps) {
  const nextAction = buildChronosNextAction(meeting);

  return (
    <div className="grid gap-4">
      <ChronosNextActionPanel action={nextAction} />
      <ChronosGovernanceChecklist meeting={meeting} />
      <div className="grid grid-cols-2 gap-3">
        <InfoBlock label="sala" value={meeting.room?.name ?? "-"} />
        <InfoBlock
          label="tipo"
          value={chronosMeetingTypeLabels[meeting.meetingType]}
        />
        <InfoBlock
          label="inicio"
          value={formatChronosDateTime(meeting.startsAt)}
        />
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

function ChronosNextActionPanel({ action }: { action: ChronosNextAction }) {
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

function ChronosGovernanceChecklist({ meeting }: { meeting: ChronosMeeting }) {
  const agenda = Array.isArray(meeting.metadata.agenda)
    ? meeting.metadata.agenda
    : [];
  const checkedInParticipants = getChronosCheckedInParticipants(meeting);
  const items = [
    {
      complete: agenda.length > 0,
      label: "pauta",
    },
    {
      complete: checkedInParticipants.length > 0,
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
