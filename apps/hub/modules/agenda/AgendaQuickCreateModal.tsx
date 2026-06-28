"use client";

import { CalendarClock, ClipboardList, Link2, X } from "lucide-react";
import { useState } from "react";

import {
  createAgendaItem,
  type AgendaItemChannel,
  type AgendaItemPriority,
  type AgendaModule,
} from "@/modules/agenda/data";

// Criacao rapida de retorno/tarefa a partir do atendimento. Sempre vincula o
// protocolo do atendimento (e o cliente, quando houver) -- o item nasce ligado a
// conversa que o originou.

export type AgendaQuickCreateContext = {
  clientC2xId: number | null;
  clientName: string | null;
  module: AgendaModule;
  protocol: string | null;
};

export function AgendaQuickCreateModal({
  context,
  kind,
  onClose,
  onCreated,
}: {
  context: AgendaQuickCreateContext;
  kind: "retorno" | "tarefa";
  onClose: () => void;
  onCreated?: () => void;
}) {
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState<AgendaItemPriority | "">("");
  const [channel, setChannel] = useState<AgendaItemChannel | "">("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRetorno = kind === "retorno";

  const submit = async () => {
    if (!title.trim() || saving) {
      return;
    }
    setSaving(true);
    setError(null);
    const dueAt = due ? new Date(due).toISOString() : null;
    const created = await createAgendaItem({
      attendanceProtocol: context.protocol,
      channel: isRetorno && channel ? channel : null,
      clientC2xId: context.clientC2xId,
      clientName: context.clientName,
      dueAt,
      kind,
      module: context.module,
      priority: !isRetorno && priority ? priority : null,
      remindAt: isRetorno ? dueAt : null,
      title: title.trim(),
    });
    setSaving(false);
    if (!created) {
      setError("Nao foi possivel criar agora. Tente de novo.");
      return;
    }
    onCreated?.();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_24px_60px_rgba(15,23,42,0.22)]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-lg bg-[#A07C3B]/10 text-[#7A5E2C]">
              {isRetorno ? <CalendarClock className="size-5" /> : <ClipboardList className="size-5" />}
            </span>
            <div>
              <p className="m-0 text-sm font-semibold text-slate-900">
                {isRetorno ? "Agendar retorno" : "Nova tarefa"}
              </p>
              <p className="m-0 text-xs text-slate-500">
                {isRetorno ? "Lembrete pela Iris no horario" : "Entra no seu Meu dia"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex size-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="size-4" />
          </button>
        </div>

        {context.protocol ? (
          <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
            <Link2 className="size-3" />
            {context.protocol}
            {context.clientName ? <span className="font-normal text-slate-500">· {context.clientName}</span> : null}
          </div>
        ) : null}

        <div className="mt-4 grid gap-3">
          <input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
            placeholder={isRetorno ? "Sobre o que retornar?" : "O que precisa ser feito?"}
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#A07C3B]/50"
          />
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
              {isRetorno ? "Quando retornar" : "Prazo"}
              <input
                type="datetime-local"
                value={due}
                onChange={(event) => setDue(event.target.value)}
                className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#A07C3B]/50"
              />
            </label>
            {isRetorno ? (
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
                Canal
                <select
                  value={channel}
                  onChange={(event) => setChannel(event.target.value as AgendaItemChannel | "")}
                  className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#A07C3B]/50"
                >
                  <option value="">—</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="ligacao">Ligacao</option>
                  <option value="email">E-mail</option>
                  <option value="presencial">Presencial</option>
                  <option value="outro">Outro</option>
                </select>
              </label>
            ) : (
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
                Prioridade
                <select
                  value={priority}
                  onChange={(event) => setPriority(event.target.value as AgendaItemPriority | "")}
                  className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#A07C3B]/50"
                >
                  <option value="">Normal</option>
                  <option value="urgente">Urgente</option>
                  <option value="alta">Alta</option>
                  <option value="media">Media</option>
                  <option value="baixa">Baixa</option>
                </select>
              </label>
            )}
          </div>
        </div>

        {error ? <p className="mt-3 text-xs font-medium text-rose-600">{error}</p> : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!title.trim() || saving}
            onClick={() => void submit()}
            className="h-9 rounded-lg bg-[#A07C3B] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#8E6F35] disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {saving ? "Criando…" : isRetorno ? "Agendar" : "Criar tarefa"}
          </button>
        </div>
      </div>
    </div>
  );
}
