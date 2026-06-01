"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { HadesWhatsAppEditableField } from "@/modules/guardian/attendance/components/hades-whatsapp-fields";
import type { WhatsAppTicket } from "@/modules/guardian/attendance/hades-whatsapp-types";

export function HadesWhatsAppTicketCloseModal({
  onClose,
  onSubmit,
  ticket,
}: {
  onClose: () => void;
  onSubmit: (result: string, nextStep: string, finalNote: string) => void;
  ticket: WhatsAppTicket;
}) {
  const [result, setResult] = useState("Cliente orientado com proposta enviada");
  const [nextStep, setNextStep] = useState("Aguardar retorno do cliente até amanhã");
  const [finalNote, setFinalNote] = useState("Atendimento encerrado com histórico consolidado para acompanhamento.");

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/25 px-4 backdrop-blur-[2px]">
      <button
        type="button"
        aria-label="Fechar encerramento de ticket"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <section className="relative z-10 w-full max-w-xl rounded-2xl border border-slate-200/70 bg-white shadow-[0_20px_70px_rgba(15,23,42,0.2)]">
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">Encerrar atendimento</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">Ticket {ticket.protocol}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar encerramento"
            className="flex size-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="space-y-3 p-5">
          <HadesWhatsAppEditableField label="Resultado do atendimento" value={result} onChange={setResult} />
          <HadesWhatsAppEditableField label="Próximo passo" value={nextStep} onChange={setNextStep} />
          <label className="block rounded-xl border border-slate-200/70 bg-slate-50/70 p-4">
            <span className="text-xs font-semibold uppercase tracking-normal text-slate-400">Observação final</span>
            <textarea
              value={finalNote}
              onChange={(event) => setFinalNote(event.target.value)}
              className="mt-2 min-h-24 w-full resize-none rounded-lg border border-slate-200/70 bg-white px-3 py-2 text-sm leading-6 text-slate-700 outline-none transition-colors focus:border-[#A07C3B]/40 focus:ring-2 focus:ring-[#A07C3B]/10"
            />
          </label>
        </div>

        <footer className="border-t border-slate-100 p-4">
          <button
            type="button"
            onClick={() => onSubmit(result, nextStep, finalNote)}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#A07C3B] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#8E6F35]"
          >
            Encerrar ticket
          </button>
        </footer>
      </section>
    </div>
  );
}
