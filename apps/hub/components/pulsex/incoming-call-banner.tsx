import type { PulseXCallSession } from "@/lib/pulsex";
import { Phone, PhoneOff, Video } from "lucide-react";

type IncomingCallBannerProps = {
  onAccept: () => void;
  onDecline: () => void;
  session: PulseXCallSession;
};

export function IncomingCallBanner({
  onAccept,
  onDecline,
  session,
}: IncomingCallBannerProps) {
  const caller =
    session.participants.find(
      (participant) => participant.userId === session.initiatedByUserId,
    ) ?? session.participants[0];
  const CallIcon = session.type === "video" ? Video : Phone;
  const callTypeLabel = session.type === "video" ? "Video" : "Audio";
  const callStatusLabel =
    session.status === "ringing" ? "Chamada recebida" : "Ligando...";

  return (
    <aside className="mx-4 mt-4 flex items-center justify-between gap-3 rounded-lg border border-[#d9e0ea] bg-white px-4 py-3 shadow-sm">
      <div className="flex min-w-0 items-center gap-3">
        <span className="relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-[#101820] text-sm font-semibold text-white">
          {caller?.avatarUrl ? (
            <span
              aria-hidden="true"
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: `url(${caller.avatarUrl})` }}
            />
          ) : (
            caller?.initials
          )}
          <span className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full border-2 border-white bg-emerald-600 text-white">
            <CallIcon aria-hidden="true" size={10} />
          </span>
        </span>
        <div className="min-w-0">
          <p className="m-0 truncate text-sm font-semibold text-[var(--uix-text-primary)]">
            {caller?.label ?? "Chamada recebida"}
          </p>
          <p className="m-0 mt-0.5 flex items-center gap-1.5 text-xs text-[var(--uix-text-muted)]">
            <span>{callTypeLabel}</span>
            <span aria-hidden="true" className="h-1 w-1 rounded-full bg-[#a9b2c0]" />
            <span>{callStatusLabel}</span>
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          className="inline-flex h-8 items-center gap-2 rounded-md bg-emerald-600 px-3 text-xs font-semibold text-white transition hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
          onClick={onAccept}
          type="button"
        >
          <Phone aria-hidden="true" size={14} />
          Aceitar
        </button>
        <button
          className="inline-flex h-8 items-center gap-2 rounded-md bg-rose-600 px-3 text-xs font-semibold text-white transition hover:bg-rose-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
          onClick={onDecline}
          type="button"
        >
          <PhoneOff aria-hidden="true" size={14} />
          Recusar
        </button>
      </div>
    </aside>
  );
}
