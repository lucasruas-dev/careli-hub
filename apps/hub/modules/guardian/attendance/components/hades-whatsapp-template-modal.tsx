"use client";

import { X } from "lucide-react";
import { hadesWhatsAppQuickTemplates } from "@/modules/guardian/attendance/hades-whatsapp-quick-templates";

export function HadesWhatsAppTemplateModal({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (body: string) => void;
}) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/20 px-4">
      <button
        type="button"
        aria-label="Fechar templates"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <section className="relative z-10 w-full max-w-2xl rounded-2xl border border-slate-200/70 bg-white shadow-[0_20px_70px_rgba(15,23,42,0.2)]">
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">Templates WhatsApp</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">Usar template</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar templates"
            className="flex size-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="grid max-h-[520px] gap-3 overflow-y-auto p-5 sm:grid-cols-2">
          {hadesWhatsAppQuickTemplates.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => onSelect(template.body)}
              className="rounded-xl border border-slate-200/70 bg-slate-50/60 p-4 text-left transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5"
            >
              <p className="text-sm font-semibold text-slate-950">{template.title}</p>
              <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-600">{template.body}</p>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
