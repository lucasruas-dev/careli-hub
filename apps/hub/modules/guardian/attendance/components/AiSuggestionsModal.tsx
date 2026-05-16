/* eslint-disable */
// @ts-nocheck
import { Bot, Sparkles, X } from "lucide-react";
import type { QueueClient } from "@/modules/guardian/attendance/types";

type AiSuggestionsModalProps = {
  client: QueueClient;
  open: boolean;
  onClose: () => void;
};

export function AiSuggestionsModal({
  client,
  open,
  onClose,
}: AiSuggestionsModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
      <button
        type="button"
        aria-label="Fechar sugestões IA"
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/25 backdrop-blur-[2px]"
      />

      <section className="relative z-10 w-full max-w-2xl rounded-2xl border border-slate-200/70 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)]">
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-[#A07C3B]/5 text-[#A07C3B] ring-1 ring-[#A07C3B]/15">
              <Bot className="size-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-950">Sugestões IA</h2>
              <p className="mt-1 text-sm text-slate-500">Análise operacional de cobrança</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar modal"
            className="flex size-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <InfoPanel title="Resumo da análise IA" value={client.aiSuggestion} wide />
          <InfoPanel title="Risco do cliente" value={`${client.scoreRisco}/100 · ${client.prioridade}`} />
          <InfoPanel
            title="Motivo do risco"
            value="Atraso recorrente, histórico de baixa resposta e parcelas em aberto no ciclo atual."
          />
          <InfoPanel
            title="Próxima ação sugerida"
            value="Priorizar contato consultivo e enviar proposta de regularização no mesmo atendimento."
          />
          <InfoPanel
            title="Abordagem recomendada"
            value="Usar tom humanizado, reconhecer o histórico do cliente e oferecer alternativa flexível de pagamento."
            wide
          />
        </div>
      </section>
    </div>
  );
}

function InfoPanel({
  title,
  value,
  wide = false,
}: {
  title: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <article
      className={`rounded-xl border border-slate-200/70 bg-slate-50/70 p-4 ${
        wide ? "sm:col-span-2" : ""
      }`}
    >
      <div className="mb-2 flex items-center gap-2">
        <Sparkles className="size-4 text-[#A07C3B]" aria-hidden="true" />
        <p className="text-xs font-medium uppercase tracking-normal text-slate-500">{title}</p>
      </div>
      <p className="text-sm leading-6 text-slate-700">{value}</p>
    </article>
  );
}




