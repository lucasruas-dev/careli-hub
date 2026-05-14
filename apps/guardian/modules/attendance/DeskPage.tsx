"use client";

import { useState } from "react";
import {
  Bell,
  Headphones,
  MessageCircle,
  Radio,
  ShieldAlert,
  UsersRound,
  X,
} from "lucide-react";
import { TicketOperationsQueue } from "@/modules/attendance/components/TicketOperationsQueue";
import { WhatsAppConversationPanel } from "@/modules/attendance/components/WhatsAppConversationPanel";
import { queueClients } from "@/modules/attendance/data";
import type { OperationalTimelineEvent } from "@/modules/attendance/types";

type DeskPageProps = {
  embedded?: boolean;
};

export function DeskPage({ embedded = false }: DeskPageProps) {
  const [selectedId, setSelectedId] = useState(queueClients[0]?.id ?? "");
  const [whatsAppClientId, setWhatsAppClientId] = useState<string | null>(null);
  const [toastVisible, setToastVisible] = useState(true);

  const selectedClient = queueClients.find((client) => client.id === selectedId) ?? queueClients[0];
  const whatsAppClient = whatsAppClientId
    ? queueClients.find((client) => client.id === whatsAppClientId) ?? selectedClient
    : selectedClient;

  function openWhatsApp(clientId = selectedClient.id) {
    setSelectedId(clientId);
    setWhatsAppClientId(clientId);
    setToastVisible(false);
  }

  function addTimelineEvent(clientId: string, event: OperationalTimelineEvent) {
    void clientId;
    void event;
  }

  if (whatsAppClientId) {
    return (
      <WhatsAppConversationPanel
        key={whatsAppClient.id}
        client={whatsAppClient}
        initialOrigin="Cliente iniciou"
        onClose={() => setWhatsAppClientId(null)}
        onTimelineEvent={addTimelineEvent}
        open={Boolean(whatsAppClientId)}
      />
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <header className="border-b border-slate-100 px-4 py-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#A07C3B]/5 text-[#A07C3B] ring-1 ring-[#A07C3B]/15">
                  <Headphones className="size-5" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">
                    {embedded ? "Atendimento / Desk" : "Desk"}
                  </p>
                  <h1 className="mt-1 text-lg font-semibold tracking-normal text-slate-950">
                    Central operacional em tempo real
                  </h1>
                  <p className="hidden">
                    WhatsApp, tickets, protocolos, SLA, follow-ups e notificações operacionais em uma tela viva.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-4 xl:w-[620px]">
              <DeskMetric icon={Radio} label="Status" value="Online" tone="live" />
              <DeskMetric icon={MessageCircle} label="Ativos" value="12" />
              <DeskMetric icon={Bell} label="Aguardando" value="3" tone="gold" />
              <DeskMetric icon={ShieldAlert} label="SLA crítico" value="4" tone="danger" />
            </div>
          </div>
        </header>

        <div className="grid gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="grid gap-3 sm:grid-cols-3">
            <RealtimeCard title="Novas mensagens" value="3" description="2 clientes sem resposta acima de 15 min." />
            <RealtimeCard title="Tickets mudando status" value="7" description="Atualizações mockadas de SLA e atendimento." />
            <RealtimeCard title="Operadores online" value="5" description="Estrutura preparada para múltiplos atendentes." />
          </div>

          <div title="Pronto para operadores online, distribuição automática, fila inteligente e monitoramento realtime." className="rounded-xl border border-slate-200/70 bg-slate-50/70 p-3">
            <div className="flex items-center gap-2">
              <UsersRound className="size-4 text-[#A07C3B]" aria-hidden="true" />
              <p className="text-sm font-semibold text-slate-950">Distribuição futura</p>
            </div>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">
              Pronto para operadores online, distribuição automática, fila inteligente e monitoramento em tempo real.
            </p>
          </div>
        </div>
      </section>

      {toastVisible ? (
        <div className="fixed right-5 top-24 z-30 w-[340px] rounded-2xl border border-slate-200/70 bg-white p-4 shadow-[0_18px_60px_rgba(15,23,42,0.18)]">
          <div className="flex items-start justify-between gap-3">
            <div className="flex gap-3">
              <div className="relative flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
                <MessageCircle className="size-5" aria-hidden="true" />
                <span className="absolute -right-1 -top-1 size-3 rounded-full bg-[#A07C3B] ring-2 ring-white" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-950">Ana Paula Ribeiro</p>
                <p className="mt-1 text-sm text-slate-600">Nova mensagem recebida</p>
                <p className="mt-1 font-mono text-xs font-semibold text-[#7A5E2C]">Ticket GDN-000184</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setToastVisible(false)}
              className="flex size-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700"
              aria-label="Ignorar notificação"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => openWhatsApp(queueClients[0]?.id)}
              title="Abrir conversa"
              aria-label="Abrir conversa"
              className="inline-flex h-9 flex-1 items-center justify-center rounded-lg bg-[#A07C3B] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#8E6F35]"
            >
              <MessageCircle className="size-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setToastVisible(false)}
              title="Ignorar notificação"
              aria-label="Ignorar notificação"
              className="inline-flex h-9 flex-1 items-center justify-center rounded-lg border border-slate-200/70 bg-white px-3 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}

      <TicketOperationsQueue
        clients={queueClients}
        onOpenWhatsApp={(clientId) => openWhatsApp(clientId)}
        onSelectClient={setSelectedId}
      />
    </div>
  );
}

function DeskMetric({
  icon: Icon,
  label,
  tone = "neutral",
  value,
}: {
  icon: typeof Headphones;
  label: string;
  tone?: "neutral" | "live" | "danger" | "gold";
  value: string;
}) {
  const toneClass =
    tone === "live"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
      : tone === "danger"
        ? "bg-rose-50 text-rose-700 ring-rose-100"
        : tone === "gold"
          ? "bg-[#A07C3B]/5 text-[#7A5E2C] ring-[#A07C3B]/15"
          : "bg-slate-50 text-slate-700 ring-slate-200";

  return (
    <div className="rounded-xl border border-slate-200/70 bg-white px-3 py-2">
      <div className="flex items-center gap-2">
        <span className={`flex size-7 items-center justify-center rounded-lg ring-1 ${toneClass}`}>
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[11px] font-semibold uppercase tracking-normal text-slate-400">{label}</p>
          <p className="mt-0.5 text-sm font-semibold text-slate-950">{value}</p>
        </div>
      </div>
    </div>
  );
}

function RealtimeCard({ description, title, value }: { description: string; title: string; value: string }) {
  return (
    <div title={description} className="rounded-xl border border-slate-200/70 bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-slate-950">{title}</p>
        <span className="rounded-full bg-[#A07C3B]/5 px-2.5 py-1 text-xs font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
          {value}
        </span>
      </div>
      <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{description}</p>
    </div>
  );
}
