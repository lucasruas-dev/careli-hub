import { buildChronosMinutesBodyHtml } from "@/lib/chronos/minutes-preview";
import type { ChronosMinutesContext } from "@/lib/chronos/minutes";
import type { ChronosMeeting } from "@/lib/chronos/types";
import Image from "next/image";

type ChronosMinutesFormattedPreviewProps = {
  context: ChronosMinutesContext;
  meeting: ChronosMeeting;
  minutes: string;
};

export function ChronosMinutesFormattedPreview({
  context,
  meeting,
  minutes,
}: ChronosMinutesFormattedPreviewProps) {
  return (
    <div className="rounded-md border border-line bg-subtle p-3">
      <div className="mb-3 grid gap-2 text-xs font-semibold text-ink-muted sm:grid-cols-3">
        <span>Inicio: {context.scheduledStartLabel}</span>
        <span>Fim real: {context.actualEndLabel}</span>
        <span>
          Check-ins: {context.participants.length} | Duracao:{" "}
          {context.durationLabel}
        </span>
      </div>
      <div
        className="relative mx-auto min-h-[70rem] max-w-[52rem] overflow-hidden rounded-md bg-surface px-10 pb-24 pt-36 shadow-sm"
        style={{
          fontFamily: '"Century Gothic", "Aptos", "Segoe UI", sans-serif',
          fontSize: "9pt",
          lineHeight: 1.5,
        }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 z-0 h-32 overflow-hidden"
        >
          <Image
            alt=""
            className="block h-auto w-full"
            height={1650}
            src="/chronos-minutes-letterhead-top.png"
            width={1275}
          />
        </div>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-24 overflow-hidden"
        >
          <Image
            alt=""
            className="absolute bottom-0 block h-auto w-full"
            height={1650}
            src="/chronos-minutes-letterhead-footer.png"
            width={1275}
          />
        </div>
        <Image
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1/2 z-0 w-80 -translate-x-1/2 -translate-y-1/2 opacity-[0.035]"
          height={288}
          src="/logoc.png"
          width={288}
        />
        <div className="relative z-10">
          <header className="mb-3 flex items-start justify-between gap-4 border-b border-[#eadfcb] pb-2">
            <div>
              <p className="m-0 text-[8pt] font-bold uppercase tracking-normal text-[#A07C3B]">
                Chronos
              </p>
              <h2 className="m-0 mt-1 text-[13pt] font-bold text-ink">
                Ata de reuniao
              </h2>
              <p className="m-0 mt-1 text-[8pt] font-bold text-ink-muted">
                {meeting.protocol} | {meeting.title}
              </p>
            </div>
          </header>
          <div
            className="chronos-minutes-body [&_h2]:mb-0 [&_h2]:mt-2.5 [&_h2]:text-[10pt] [&_h2]:font-bold [&_h2]:leading-[1.5] [&_li]:m-0 [&_li]:leading-[1.5] [&_p]:m-0 [&_p]:leading-[1.5] [&_strong]:font-bold [&_table]:mt-1 [&_table]:w-full [&_table]:border-collapse [&_table]:text-[9pt] [&_td]:border [&_td]:border-line [&_td]:p-1 [&_td]:align-top [&_td]:leading-[1.5] [&_th]:border [&_th]:border-line [&_th]:bg-subtle [&_th]:p-1 [&_th]:text-left [&_th]:font-bold [&_th]:leading-[1.5] [&_ul]:m-0 [&_ul]:pl-4"
            dangerouslySetInnerHTML={{
              __html: buildChronosMinutesBodyHtml(minutes),
            }}
          />
          <footer className="mt-4 border-t border-[#eadfcb] pt-1.5 text-[7pt] font-bold leading-[1.5] text-[#A07C3B]">
            Careli | documento gerado para revisao e formalizacao humana
          </footer>
        </div>
      </div>
    </div>
  );
}
