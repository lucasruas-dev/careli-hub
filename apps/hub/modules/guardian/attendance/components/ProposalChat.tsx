"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Loader2, MessageSquare, Send } from "lucide-react";
import { Tooltip } from "@repo/uix";
import { getHubSupabaseClient } from "@/lib/supabase/client";
import { markProposalSeen } from "@/lib/guardian/proposal-seen";
import type { GuardianCompromissoComment } from "@/lib/guardian/compromissos";

// Chat vivo da proposta — compartilhado entre a Central do gestor (lado gestor)
// e a aba Propostas do cliente (lado operador). A mesma thread
// (guardian_compromisso_comments) dos dois lados: interacao MAO DUPLA.
// "Vivo": recarrega ao abrir, ao focar a janela e a cada 25s enquanto aberto
// (custo baixo: 1 chamada/25s, bem abaixo do limite).
export function ProposalChat({
  compromissoId,
  heading = "Conversa",
  note,
  placeholder = "Escreva uma mensagem...",
}: {
  compromissoId: string;
  heading?: string;
  note?: ReactNode;
  placeholder?: string;
}) {
  const [comments, setComments] = useState<GuardianCompromissoComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadComments = useCallback(async () => {
    try {
      const token = await accessToken();
      const response = await fetch(
        `/api/guardian/compromissos/${compromissoId}/comments`,
        {
          cache: "no-store",
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        data?: GuardianCompromissoComment[];
      } | null;
      setComments(payload?.data ?? []);
      // Abrir/visualizar a conversa = "visto": limpa a marcacao de novidade.
      markProposalSeen(compromissoId);
    } catch {
      // mantem o que tem
    } finally {
      setLoading(false);
    }
  }, [compromissoId]);

  useEffect(() => {
    void loadComments();
    const interval = window.setInterval(() => void loadComments(), 25000);
    const onFocus = () => void loadComments();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [loadComments]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [comments]);

  async function send() {
    const text = draft.trim();
    if (!text) return;
    setBusy(true);
    try {
      const token = await accessToken();
      const response = await fetch(
        `/api/guardian/compromissos/${compromissoId}/comments`,
        {
          body: JSON.stringify({ body: text }),
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          method: "POST",
        },
      );
      if (response.ok) {
        setDraft("");
        await loadComments();
      }
    } catch {
      // best-effort
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200/70 bg-white p-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-500">
        <MessageSquare className="size-3.5" aria-hidden="true" />
        {heading}
        {note}
      </p>

      {loading ? (
        <div className="flex items-center gap-2 px-1 py-3 text-xs text-slate-400">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          Carregando...
        </div>
      ) : comments.length === 0 ? (
        <p className="px-1 py-2 text-xs text-slate-400">Sem mensagens ainda.</p>
      ) : (
        <div
          ref={scrollRef}
          className="mb-2 max-h-52 space-y-2 overflow-y-auto pr-1 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]"
        >
          {comments.map((comment) => (
            <CommentBubble key={comment.id} comment={comment} />
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          placeholder={placeholder}
          className="h-9 flex-1 rounded-lg border border-slate-200/70 bg-white px-3 text-sm text-slate-700 outline-none focus:border-[#A07C3B]/40 focus:ring-2 focus:ring-[#A07C3B]/10"
        />
        <Tooltip content="Enviar" placement="left">
          <button
            type="button"
            disabled={busy || !draft.trim()}
            onClick={() => void send()}
            aria-label="Enviar"
            className="flex size-9 items-center justify-center rounded-lg bg-[#A07C3B] text-white transition-colors hover:bg-[#8E6F35] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="size-4" aria-hidden="true" />
            )}
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

function CommentBubble({ comment }: { comment: GuardianCompromissoComment }) {
  const tone =
    comment.kind === "aprovacao"
      ? "bg-emerald-50 text-emerald-800"
      : comment.kind === "reprovacao"
        ? "bg-rose-50 text-rose-800"
        : comment.kind === "sistema"
          ? "bg-amber-50 text-amber-800"
          : "bg-slate-50 text-slate-700";

  return (
    <div className="flex gap-2">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#A07C3B]/12 text-[10px] font-semibold text-[#7A5E2C]">
        {initials(comment.authorName ?? "?")}
      </span>
      <div className={`min-w-0 flex-1 rounded-lg px-2.5 py-1.5 ${tone}`}>
        <p className="text-xs">{comment.body}</p>
        <p className="mt-0.5 text-[10px] text-slate-400">
          {comment.authorName ?? "Sistema"} · {formatWhen(comment.createdAt)}
        </p>
      </div>
    </div>
  );
}

async function accessToken() {
  const supabase = getHubSupabaseClient();
  const session = await supabase?.auth.getSession();
  return session?.data.session?.access_token ?? "";
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

function formatWhen(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  });
}
