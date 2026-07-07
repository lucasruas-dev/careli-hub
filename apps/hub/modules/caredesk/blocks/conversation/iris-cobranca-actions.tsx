"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Forward, Loader2, UserCheck, X } from "lucide-react";
import { getHubSupabaseClient } from "@/lib/supabase/client";

// Modais do cockpit de cobranca do Hades: encerramento (observacao + assunto)
// e direcionamento (setor e/ou colaborador + motivo). Os dois usam o motor da
// Iris (PATCH /api/iris/tickets action close|transfer).

type IrisQueueOption = { id: string; name: string; slug: string };
type IrisOperatorOption = {
  department?: string | null;
  id: string;
  label: string;
  role?: string | null;
};

// Motivo do encerramento (obrigatório): o operador aponta por que está fechando.
const IRIS_CLOSE_REASON_OPTIONS = [
  "Finalizado",
  "Sem Interação",
  "Sem Continuidade",
] as const;

export function IrisCobrancaCloseModal({
  currentSubject,
  onCancel,
  onConfirm,
  protocol,
  submitting,
}: {
  currentSubject: string;
  onCancel: () => void;
  onConfirm: (input: { note: string; reason: string; subject: string }) => void;
  protocol: string;
  submitting: boolean;
}) {
  const [note, setNote] = useState("");
  const [subject, setSubject] = useState(currentSubject);
  const [reason, setReason] = useState("");
  const [subjects, setSubjects] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const token = await accessToken();
        const response = await fetch("/api/iris/tickets", {
          cache: "no-store",
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        const payload = (await response.json().catch(() => null)) as {
          profiles?: { name: string; queue_id?: string | null; slug?: string }[];
          queues?: { id: string; slug: string }[];
        } | null;
        if (cancelled || !response.ok || !payload) return;
        // Catalogo de assuntos cadastrados (Setup). Mostra todos — vale p/ Iris e
        // Hades; o operador escolhe o assunto da lista.
        const list = (payload.profiles ?? []).map((profile) =>
          profile.slug === "primeiro-contato" ||
          profile.name.toLowerCase() === "primeiro contato"
            ? "Contato"
            : profile.name,
        );
        setSubjects(Array.from(new Set(list)));
      } catch {
        // mantem so o assunto atual editavel.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const subjectOptions = Array.from(
    new Set([currentSubject, ...subjects].filter(Boolean)),
  );

  return (
    <ModalShell
      icon={<UserCheck className="size-4" aria-hidden="true" />}
      onCancel={onCancel}
      subtitle={`Finaliza o protocolo ${protocol}`}
      title="Encerrar atendimento"
    >
      <label className="block">
        <span className="mb-1 block text-[11px] font-semibold text-slate-500">
          Assunto do atendimento{" "}
          <span className="font-normal text-rose-500">(obrigatório)</span>
        </span>
        <select
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          className="h-9 w-full rounded-lg border border-slate-200/70 bg-white px-2 text-sm text-slate-800 outline-none focus:border-[#A07C3B]/40"
        >
          <option value="">Selecione o assunto…</option>
          {subjectOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-[11px] font-semibold text-slate-500">
          Motivo do encerramento{" "}
          <span className="font-normal text-rose-500">(obrigatório)</span>
        </span>
        <select
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="h-9 w-full rounded-lg border border-slate-200/70 bg-white px-2 text-sm text-slate-800 outline-none focus:border-[#A07C3B]/40"
        >
          <option value="">Selecione o motivo…</option>
          {IRIS_CLOSE_REASON_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-[11px] font-semibold text-slate-500">
          Observação do encerramento{" "}
          <span className="font-normal text-slate-400">(opcional)</span>
        </span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          placeholder="Resumo do desfecho, combinados, próximos passos…"
          className="w-full resize-none rounded-lg border border-slate-200/70 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#A07C3B]/40"
        />
      </label>
      <ModalFooter
        confirmLabel="Encerrar"
        disabled={!subject.trim() || !reason}
        onCancel={onCancel}
        onConfirm={() =>
          onConfirm({ note: note.trim(), reason, subject: subject.trim() })
        }
        submitting={submitting}
        tone="danger"
      />
    </ModalShell>
  );
}

export function IrisCobrancaTransferModal({
  onCancel,
  onConfirm,
  submitting,
}: {
  onCancel: () => void;
  onConfirm: (input: {
    queueId: string | null;
    queueSlug: string | null;
    reason: string;
    userId: string | null;
  }) => void;
  submitting: boolean;
}) {
  const [operators, setOperators] = useState<IrisOperatorOption[]>([]);
  const [queues, setQueues] = useState<IrisQueueOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [queueId, setQueueId] = useState("");
  const [userId, setUserId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const token = await accessToken();
        const response = await fetch("/api/iris/tickets", {
          cache: "no-store",
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        const payload = (await response.json().catch(() => null)) as {
          operators?: IrisOperatorOption[];
          queues?: IrisQueueOption[];
        } | null;
        if (cancelled || !response.ok || !payload) return;
        setQueues(payload.queues ?? []);
        setOperators(payload.operators ?? []);
      } catch {
        if (!cancelled) setError("Não foi possível carregar setores e colaboradores.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function submit() {
    if (!queueId && !userId) {
      setError("Escolha um colaborador ou um setor de destino.");
      return;
    }
    const queue = queues.find((item) => item.id === queueId) ?? null;
    onConfirm({
      queueId: queueId || null,
      queueSlug: queue?.slug ?? null,
      reason: reason.trim() || "Direcionado pelo operador no atendimento de cobrança.",
      userId: userId || null,
    });
  }

  return (
    <ModalShell
      icon={<Forward className="size-4" aria-hidden="true" />}
      onCancel={onCancel}
      subtitle="Encaminha para um colaborador ou setor"
      title="Direcionar atendimento"
    >
      {loading ? (
        <p className="flex items-center gap-2 py-3 text-xs text-slate-400">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Carregando colaboradores e setores…
        </p>
      ) : (
        <>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-slate-500">
              Colaborador
            </span>
            <select
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              className="h-9 w-full rounded-lg border border-slate-200/70 bg-white px-2 text-sm text-slate-700 outline-none focus:border-[#A07C3B]/40"
            >
              <option value="">Sem colaborador específico</option>
              {operators.map((operator) => (
                <option key={operator.id} value={operator.id}>
                  {operator.label}
                  {operator.department ? ` · ${operator.department}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-slate-500">
              Setor / fila{" "}
              <span className="font-normal text-slate-400">(opcional)</span>
            </span>
            <select
              value={queueId}
              onChange={(event) => setQueueId(event.target.value)}
              className="h-9 w-full rounded-lg border border-slate-200/70 bg-white px-2 text-sm text-slate-700 outline-none focus:border-[#A07C3B]/40"
            >
              <option value="">Manter na fila atual</option>
              {queues.map((queue) => (
                <option key={queue.id} value={queue.id}>
                  {queue.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-slate-500">
              Motivo
            </span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              placeholder="Por que está direcionando este atendimento?"
              className="w-full resize-none rounded-lg border border-slate-200/70 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#A07C3B]/40"
            />
          </label>
        </>
      )}

      {error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
          {error}
        </p>
      ) : null}

      <ModalFooter
        confirmLabel="Direcionar"
        disabled={loading}
        onCancel={onCancel}
        onConfirm={submit}
        submitting={submitting}
        tone="gold"
      />
    </ModalShell>
  );
}

function ModalShell({
  children,
  icon,
  onCancel,
  subtitle,
  title,
}: {
  children: ReactNode;
  icon: ReactNode;
  onCancel: () => void;
  subtitle: string;
  title: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Fechar"
        onClick={onCancel}
        className="absolute inset-0 bg-slate-950/30 backdrop-blur-[2px]"
      />
      <div className="relative z-10 flex w-full max-w-md flex-col gap-3 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_24px_80px_rgba(15,23,42,0.22)]">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-[#A07C3B] text-white">
              {icon}
            </span>
            <div>
              <h2 className="text-base font-semibold text-slate-950">{title}</h2>
              <p className="text-[11px] text-slate-500">{subtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Fechar"
            className="flex size-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalFooter({
  confirmLabel,
  disabled = false,
  onCancel,
  onConfirm,
  submitting,
  tone,
}: {
  confirmLabel: string;
  disabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  submitting: boolean;
  tone: "danger" | "gold";
}) {
  return (
    <div className="mt-1 flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={onCancel}
        className="inline-flex h-9 items-center rounded-lg border border-slate-200/70 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        Cancelar
      </button>
      <button
        type="button"
        disabled={submitting || disabled}
        onClick={onConfirm}
        className={[
          "inline-flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50",
          tone === "danger"
            ? "bg-rose-600 hover:bg-rose-700"
            : "bg-[#A07C3B] hover:bg-[#8E6F35]",
        ].join(" ")}
      >
        {submitting ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : null}
        {confirmLabel}
      </button>
    </div>
  );
}

async function accessToken() {
  const supabase = getHubSupabaseClient();
  const session = await supabase?.auth.getSession();
  return session?.data.session?.access_token ?? "";
}
