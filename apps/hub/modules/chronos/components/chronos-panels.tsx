import { getChronosCheckedInParticipants } from "@/lib/chronos/minutes";
import {
  chronosCaptureStatusLabels,
  type ChronosMeeting,
} from "@/lib/chronos/types";
import { Mic, ShieldCheck, UsersRound } from "lucide-react";
import type { ReactNode } from "react";

export function ParticipantMiniPanel({
  meeting,
}: {
  meeting: ChronosMeeting | null;
}) {
  return (
    <MiniPanel
      icon={<UsersRound size={16} />}
      label="participantes"
      value={String(meeting ? getChronosCheckedInParticipants(meeting).length : 0)}
    />
  );
}

export function RoomProtocolPanel({
  meeting,
}: {
  meeting: ChronosMeeting | null;
}) {
  return (
    <MiniPanel
      icon={<ShieldCheck size={16} />}
      label="protocolo"
      value={meeting?.protocol ?? "-"}
    />
  );
}

export function CaptureStatusPanel({
  meeting,
}: {
  meeting: ChronosMeeting | null;
}) {
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

export function MiniPanel({
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

export function RoomButton({
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

export function StatusActionButton({
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
      className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-line bg-surface px-2 text-sm font-semibold text-ink transition hover:bg-subtle disabled:cursor-wait disabled:opacity-60"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {icon}
      {label}
    </button>
  );
}

export function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-subtle p-3">
      <p className="m-0 text-xs font-bold uppercase text-ink-muted">{label}</p>
      <p className="m-0 mt-1 whitespace-pre-wrap text-sm font-semibold leading-6 text-ink">
        {value}
      </p>
    </div>
  );
}

export function PanelTitle({
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
          dark ? "text-[#9aa5b5]" : "text-ink-muted"
        }`}
      >
        {eyebrow}
      </p>
      <h2
        className={`m-0 mt-1 truncate text-base font-semibold ${
          dark ? "text-white" : "text-ink"
        }`}
      >
        {title}
      </h2>
    </div>
  );
}

export function EmptyPanel({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed border-line bg-subtle p-4 text-sm text-ink-muted">
      {text}
    </div>
  );
}
