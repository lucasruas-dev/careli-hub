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
    <div className="rounded-md border border-[#d9e0e7] bg-[#eef2f6] p-3">
      <div className="mb-3 grid gap-2 text-xs font-semibold text-[#526078] sm:grid-cols-3">
        <span>Inicio: {context.scheduledStartLabel}</span>
        <span>Fim real: {context.actualEndLabel}</span>
        <span>
          Check-ins: {context.participants.length} | Duracao:{" "}
          {context.durationLabel}
        </span>
      </div>
      <div
        className="relative mx-auto min-h-[34rem] max-w-[52rem] overflow-hidden rounded-md bg-white p-8 shadow-sm"
        style={{
          fontFamily: '"Century Gothic", "Aptos", "Segoe UI", sans-serif',
          fontSize: "9pt",
          lineHeight: 1.5,
        }}
      >
        <Image
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1/2 w-72 -translate-x-1/2 -translate-y-1/2 opacity-[0.035]"
          height={288}
          src="/logoc.png"
          width={288}
        />
        <div className="relative z-10">
          <header className="mb-6 flex items-start justify-between gap-4 border-b border-[#eadfcb] pb-3">
            <div>
              <p className="m-0 text-[8pt] font-bold uppercase tracking-[0.14em] text-[#A07C3B]">
                Chronos
              </p>
              <h2 className="m-0 mt-1 text-[13pt] font-bold text-[#101820]">
                Ata de reuniao
              </h2>
              <p className="m-0 mt-1 text-[8pt] font-bold text-[#526078]">
                {meeting.protocol} | {meeting.title}
              </p>
            </div>
            <Image
              alt="Careli"
              className="h-12 w-12 object-contain"
              height={48}
              src="/logoc.png"
              width={48}
            />
          </header>
          <div
            className="chronos-minutes-body [&_h2]:mb-0 [&_h2]:mt-3 [&_h2]:text-[10pt] [&_h2]:font-bold [&_li]:m-0 [&_p]:m-0 [&_strong]:font-bold [&_table]:mt-2 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-[#d9e0e7] [&_td]:p-1.5 [&_td]:align-top [&_th]:border [&_th]:border-[#d9e0e7] [&_th]:bg-[#f3f6fa] [&_th]:p-1.5 [&_th]:text-left [&_th]:font-bold [&_ul]:m-0 [&_ul]:mt-1 [&_ul]:pl-5"
            dangerouslySetInnerHTML={{
              __html: buildChronosMinutesBodyHtml(minutes),
            }}
          />
          <footer className="mt-8 border-t border-[#eadfcb] pt-2 text-[7pt] font-bold text-[#A07C3B]">
            Careli | documento gerado para revisao e formalizacao humana
          </footer>
        </div>
      </div>
    </div>
  );
}
