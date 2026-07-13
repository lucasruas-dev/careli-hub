"use client";

import {
  Bot,
  CheckCircle2,
  LockKeyhole,
  Send,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react";

export type IrisAttendantDocumentPosition = "last4" | "first4";

export type IrisAttendantBillingItem = {
  acquisitionRequestId: string;
  dueDate: string;
  id: string;
  number: string;
  overdueDays: number;
  reference: string;
  status: "Vencida" | "A vencer" | "Liquidada";
  unitCode?: string;
  unitLabel?: string;
  value: string;
};

export type IrisAttendantResponse = {
  authentication?: {
    label?: string;
    status?: string;
  };
  billingItems?: IrisAttendantBillingItem[];
  boleto?: {
    boletoUrl?: string;
    message?: string;
    paymentId?: string;
  } | null;
  customer?: {
    c2xClientKnown?: boolean;
    documentMasked?: string | null;
    label?: string | null;
    phoneMasked?: string | null;
  };
  handoff?: {
    reason?: string | null;
    required?: boolean;
  };
  model?: string | null;
  nextStep?: string;
  replyText?: string;
  source?: "openai" | "fallback";
};

export function IrisAttendantPanel({
  disabled,
  documentFragment,
  documentPosition,
  feedback,
  loading,
  onAnalyze,
  onClose,
  onDocumentFragmentChange,
  onDocumentPositionChange,
  onPromptChange,
  onSelectBillingItem,
  onUseReply,
  prompt,
  result,
}: {
  disabled: boolean;
  documentFragment: string;
  documentPosition: IrisAttendantDocumentPosition;
  feedback: string;
  loading: boolean;
  onAnalyze: () => void;
  onClose: () => void;
  onDocumentFragmentChange: (value: string) => void;
  onDocumentPositionChange: (value: IrisAttendantDocumentPosition) => void;
  onPromptChange: (value: string) => void;
  onSelectBillingItem: (item: IrisAttendantBillingItem) => void;
  onUseReply: () => void;
  prompt: string;
  result: IrisAttendantResponse | null;
}) {
  const billingItems = result?.billingItems ?? [];
  const replyText = result?.replyText?.trim() ?? "";
  const hasBoletoOptions =
    result?.nextStep === "choose_boleto" && billingItems.length > 0;

  return (
    <div className="shrink-0 border-b border-line bg-subtle/60 px-4 py-3">
      <div className="rounded-xl border border-[#A07C3B]/20 bg-surface p-3 shadow-[0_12px_30px_rgba(15,23,42,0.08)]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#101820] text-white">
              <Bot className="size-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">
                Cacá
              </p>
              <h3 className="truncate text-sm font-semibold text-ink">
                Atendimento ao cliente e boletos
              </h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-subtle hover:text-[#7A5E2C]"
            aria-label="Fechar Cacá"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-3 grid gap-2 xl:grid-cols-[1fr_210px_auto]">
          <label className="min-w-0 rounded-lg border border-line/70 bg-subtle px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-normal text-ink-muted">
              Mensagem do cliente
            </span>
            <textarea
              value={prompt}
              onChange={(event) => onPromptChange(event.target.value)}
              disabled={disabled || loading}
              rows={2}
              placeholder="Use a ultima mensagem recebida ou descreva a solicitacao."
              className="mt-1 min-h-12 w-full resize-none bg-transparent text-sm font-medium text-ink outline-none placeholder:text-ink-muted disabled:cursor-not-allowed disabled:text-ink-muted"
            />
          </label>

          <div className="rounded-lg border border-line/70 bg-subtle px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-normal text-ink-muted">
              CPF/CNPJ
            </span>
            <div className="mt-1 flex items-center gap-2">
              <input
                value={documentFragment}
                onChange={(event) =>
                  onDocumentFragmentChange(
                    event.target.value.replace(/\D/g, "").slice(0, 4),
                  )
                }
                disabled={disabled || loading}
                inputMode="numeric"
                placeholder="4 digitos"
                className="h-9 min-w-0 flex-1 rounded-md border border-line bg-surface px-2 text-sm font-semibold text-ink outline-none transition-colors focus:border-[#A07C3B]/45 disabled:cursor-not-allowed disabled:text-ink-muted"
              />
              <div className="grid w-[82px] grid-cols-2 rounded-md bg-surface p-0.5 ring-1 ring-slate-200">
                {[
                  { label: "Fim", value: "last4" as const },
                  { label: "Ini", value: "first4" as const },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => onDocumentPositionChange(option.value)}
                    disabled={disabled || loading}
                    className={[
                      "h-8 rounded text-[11px] font-semibold transition-colors disabled:cursor-not-allowed",
                      documentPosition === option.value
                        ? "bg-[#101820] text-white"
                        : "text-ink-muted hover:bg-subtle",
                    ].join(" ")}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onAnalyze}
            disabled={disabled || loading}
            className="inline-flex h-full min-h-14 items-center justify-center gap-2 rounded-lg bg-[#A07C3B] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#8E6F35] disabled:cursor-not-allowed disabled:bg-subtle"
          >
            <Sparkles className="size-4" aria-hidden="true" />
            {loading ? "Analisando" : "Analisar"}
          </button>
        </div>

        {feedback ? (
          <div className="mt-3 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
            {feedback}
          </div>
        ) : null}

        {result ? (
          <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_260px]">
            <div className="min-w-0 rounded-lg border border-line/70 bg-subtle/70 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-1 text-[11px] font-semibold text-ink-soft ring-1 ring-slate-200">
                  <CheckCircle2
                    className="size-3 text-emerald-600"
                    aria-hidden="true"
                  />
                  {result.authentication?.label ?? "Analise pronta"}
                </span>
                {result.handoff?.required ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200">
                    <ShieldAlert className="size-3" aria-hidden="true" />
                    Atendimento humano
                  </span>
                ) : null}
                {result.source ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#A07C3B]/12 px-2 py-1 text-[11px] font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
                    {result.source === "openai" ? "OpenAI" : "Regra segura"}
                  </span>
                ) : null}
              </div>

              {replyText ? (
                <div className="mt-3 rounded-lg border border-line bg-surface p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-normal text-ink-muted">
                    Resposta sugerida
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink">
                    {replyText}
                  </p>
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={onUseReply}
                      className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#101820] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#17212b]"
                    >
                      <Send className="size-3.5" aria-hidden="true" />
                      Usar no rascunho
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="min-w-0 rounded-lg border border-line/70 bg-surface p-3">
              <p className="text-[11px] font-semibold uppercase tracking-normal text-ink-muted">
                Boletos
              </p>
              {hasBoletoOptions ? (
                <div className="mt-2 space-y-2">
                  {billingItems.slice(0, 6).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelectBillingItem(item)}
                      disabled={loading}
                      className="w-full rounded-lg border border-line bg-subtle px-3 py-2 text-left transition-colors hover:border-[#A07C3B]/30 hover:bg-[#A07C3B]/12 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span className="block text-xs font-semibold text-ink">
                        {item.number} - {item.reference}
                      </span>
                      <span className="mt-0.5 block text-[11px] font-medium text-ink-muted">
                        {item.value} - {item.status}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="mt-2 rounded-lg border border-dashed border-line bg-subtle px-3 py-4 text-xs font-semibold text-ink-muted">
                  Nenhum boleto selecionavel nesta analise.
                </div>
              )}
              {result.handoff?.reason ? (
                <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                  <LockKeyhole
                    className="mt-0.5 size-3.5 shrink-0"
                    aria-hidden="true"
                  />
                  <span>{result.handoff.reason}</span>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
