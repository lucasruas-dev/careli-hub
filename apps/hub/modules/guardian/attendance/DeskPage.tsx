/* eslint-disable */
// @ts-nocheck
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  Bell,
  Bot,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  Headphones,
  Inbox,
  MessageCircle,
  Network,
  Radio,
  RefreshCw,
  Send,
  ShieldAlert,
  Sparkles,
  TicketCheck,
  UsersRound,
  Wifi,
  X,
} from "lucide-react";
import { getHubSupabaseClient } from "@/lib/supabase/client";
import { TicketOperationsQueue } from "@/modules/guardian/attendance/components/TicketOperationsQueue";
import { WhatsAppConversationPanel } from "@/modules/guardian/attendance/components/WhatsAppConversationPanel";
import { queueClients } from "@/modules/guardian/attendance/data";
import type { OperationalTimelineEvent, QueueClient } from "@/modules/guardian/attendance/types";

type DeskPageProps = {
  clients?: QueueClient[];
  embedded?: boolean;
  loadFromC2x?: boolean;
};

type CareDeskSignalTone = "live" | "gold" | "danger" | "neutral" | "blue";
const emptyQueueClients: QueueClient[] = [];

export function DeskPage({ clients = emptyQueueClients, embedded = false, loadFromC2x = false }: DeskPageProps) {
  const initialClients = useMemo(
    () => (clients.length > 0 ? clients : loadFromC2x ? emptyQueueClients : queueClients),
    [clients, loadFromC2x]
  );
  const [sourceClients, setSourceClients] = useState(initialClients);
  const [selectedId, setSelectedId] = useState(initialClients[0]?.id ?? "");
  const [whatsAppClientId, setWhatsAppClientId] = useState<string | null>(null);
  const [toastVisible, setToastVisible] = useState(true);
  const [loading, setLoading] = useState(loadFromC2x);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loadFromC2x) return;
    const nextClients = clients.length > 0 ? clients : queueClients;
    setSourceClients(nextClients);
    setSelectedId((current) => (nextClients.some((client) => client.id === current) ? current : nextClients[0]?.id ?? ""));
  }, [clients, loadFromC2x]);

  useEffect(() => {
    if (!loadFromC2x) return;

    let cancelled = false;

    async function loadQueue() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/guardian/attendance/queue?limit=1000", {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${await getCareDeskAccessToken()}`,
          },
        });
        const payload = (await response.json().catch(() => null)) as { clients?: QueueClient[]; error?: string } | null;

        if (cancelled) return;

        if (!response.ok || !payload?.clients) {
          throw new Error(payload?.error ?? "Nao foi possivel carregar a fila do C2X.");
        }

        setSourceClients(payload.clients);
        setSelectedId(payload.clients[0]?.id ?? "");
      } catch (loadError) {
        console.error("[caredesk] queue load failed", loadError);
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Nao foi possivel carregar a fila do C2X.");
          setSourceClients([]);
          setSelectedId("");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadQueue();

    return () => {
      cancelled = true;
    };
  }, [initialClients, loadFromC2x]);

  const selectedClient = sourceClients.find((client) => client.id === selectedId) ?? sourceClients[0];
  const whatsAppClient = whatsAppClientId
    ? sourceClients.find((client) => client.id === whatsAppClientId) ?? selectedClient
    : selectedClient;

  const careDesk = useMemo(() => buildCareDeskSnapshot(sourceClients), [sourceClients]);
  const showLoadingState = loading && sourceClients.length === 0;

  function openWhatsApp(clientId = selectedClient?.id) {
    if (!clientId) return;
    setSelectedId(clientId);
    setWhatsAppClientId(clientId);
    setToastVisible(false);
  }

  function addTimelineEvent(clientId: string, event: OperationalTimelineEvent) {
    void clientId;
    void event;
  }

  if (whatsAppClientId && whatsAppClient) {
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
    <div className="space-y-4">
      <section className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <header className="border-b border-slate-100 px-4 py-4">
          <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-center 2xl:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="relative flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#A07C3B] text-white shadow-[0_14px_34px_rgba(160,124,59,0.22)]">
                <Headphones className="size-6" aria-hidden="true" />
                <span className="absolute -right-1 -top-1 size-3 rounded-full bg-emerald-400 ring-2 ring-white" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">
                  {embedded ? "CareDesk / Guardian" : "CareDesk"}
                </p>
                <h1 className="mt-1 text-xl font-semibold tracking-normal text-slate-950">
                  Central de atendimento multicanal
                </h1>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4 2xl:w-[720px]">
              <DeskMetric icon={Wifi} label="Operacao" value={loading ? "Sincronizando" : "Online"} tone="live" />
              <DeskMetric icon={Inbox} label="Tickets" value={formatCount(careDesk.openTickets)} />
              <DeskMetric icon={ShieldAlert} label="SLA critico" value={formatCount(careDesk.criticalTickets)} tone="danger" />
              <DeskMetric icon={UsersRound} label="Operadores" value={formatCount(careDesk.operators)} tone="gold" />
            </div>
          </div>
        </header>

        <div className="grid gap-3 p-3 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
            <CommandCard
              icon={MessageCircle}
              title="Multicanal"
              value={`${careDesk.inboundMessages} novas`}
              description="Fila preparada para Meta, conversa, anexo e template."
              tone="live"
            />
            <CommandCard
              icon={Clock3}
              title="Primeira resposta"
              value={careDesk.firstResponse}
              description="SLA operacional para atendimento humano e Cacá."
              tone="gold"
            />
            <CommandCard
              icon={Bot}
              title="Cacá"
              value={`${careDesk.aiSuggestions} ações`}
              description="Copiloto pronto para boleto, contrato, resumo e próxima ação."
              tone="blue"
            />
            <CommandCard
              icon={Network}
              title="Handoff"
              value={`${careDesk.handoffs} casos`}
              description="Transferência entre cobrança, suporte, financeiro e jurídico."
              tone="neutral"
            />
          </div>

          <div className="rounded-2xl border border-[#A07C3B]/15 bg-[#A07C3B]/5 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-white text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
                  <BrainCircuit className="size-5" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-950">Roteamento inteligente</p>
                  <p className="text-xs font-medium text-slate-600">C2X + Guardian + CareDesk</p>
                </div>
              </div>
              <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
                ativo
              </span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <MiniSignal label="Critico" value={careDesk.criticalTickets} />
              <MiniSignal label="Sem resp." value={careDesk.unanswered} />
              <MiniSignal label="Promessas" value={careDesk.promisesDue} />
            </div>
          </div>
        </div>

        {showLoadingState ? (
          <div className="mx-3 mb-3 rounded-xl border border-slate-200/70 bg-slate-50 px-4 py-5 text-center text-sm font-semibold text-slate-500">
            Carregando fila operacional do C2X...
          </div>
        ) : null}

        {error ? (
          <div className="mx-3 mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
            {error}
          </div>
        ) : null}
      </section>

      <section className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          {showLoadingState ? null : (
            <TicketOperationsQueue
              clients={sourceClients}
              onOpenWhatsApp={(clientId) => openWhatsApp(clientId)}
              onSelectClient={setSelectedId}
            />
          )}
        </div>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-xl bg-[#A07C3B] text-white">
                  <Sparkles className="size-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-950">Cacá na fila</p>
                  <p className="text-xs font-medium text-slate-500">Assistente Virtual da Careli</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => openWhatsApp(careDesk.focusClient?.id)}
                disabled={!careDesk.focusClient}
                className="inline-flex size-9 items-center justify-center rounded-lg border border-[#A07C3B]/20 bg-[#A07C3B]/5 text-[#7A5E2C] transition-colors hover:bg-[#A07C3B]/10 disabled:cursor-not-allowed disabled:opacity-50"
                title="Abrir caso sugerido"
                aria-label="Abrir caso sugerido"
              >
                <ArrowRight className="size-4" aria-hidden="true" />
              </button>
            </div>

            <div className="mt-4 rounded-xl border border-slate-200/70 bg-slate-50/70 p-3">
              <p className="text-xs font-semibold uppercase tracking-normal text-slate-400">Caso recomendado</p>
              <p className="mt-1 truncate text-sm font-semibold text-slate-950">
                {careDesk.focusClient?.nome ?? "Nenhum cliente carregado"}
              </p>
              <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-600">
                {careDesk.focusClient
                  ? `${careDesk.focusClient.parcelas.vencidas} parcelas vencidas, risco ${careDesk.focusClient.scoreRisco}/100 e proxima acao: ${careDesk.focusClient.parcelas.proximaAcao}.`
                  : "Aguardando fila operacional."}
              </p>
            </div>

            <div className="mt-3 grid gap-2">
              <CareDeskAction icon={Send} label="Sugerir resposta" value="Equipe Careli" />
              <CareDeskAction icon={TicketCheck} label="Abrir ticket" value="Com SLA" />
              <CareDeskAction icon={Bell} label="Agendar retorno" value="Follow-up" />
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-slate-50 text-[#7A5E2C] ring-1 ring-slate-200">
                <Activity className="size-5" aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-950">Pulso da operação</p>
                <p className="text-xs font-medium text-slate-500">SLA, volume e risco</p>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {careDesk.pulse.map((item) => (
                <PulseRow key={item.label} {...item} />
              ))}
            </div>
          </section>
        </aside>
      </section>

      {toastVisible && careDesk.focusClient ? (
        <div className="fixed right-5 top-24 z-30 w-[360px] rounded-2xl border border-slate-200/70 bg-white p-4 shadow-[0_18px_60px_rgba(15,23,42,0.18)]">
          <div className="flex items-start justify-between gap-3">
            <div className="flex gap-3">
              <div className="relative flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
                <MessageCircle className="size-5" aria-hidden="true" />
                <span className="absolute -right-1 -top-1 size-3 rounded-full bg-[#A07C3B] ring-2 ring-white" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-950">{careDesk.focusClient.nome}</p>
                <p className="mt-1 text-sm text-slate-600">Nova interação priorizada</p>
                <p className="mt-1 font-mono text-xs font-semibold text-[#7A5E2C]">CareDesk SLA</p>
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
              onClick={() => openWhatsApp(careDesk.focusClient?.id)}
              title="Abrir atendimento"
              aria-label="Abrir atendimento"
              className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg bg-[#A07C3B] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#8E6F35]"
            >
              <MessageCircle className="size-4" aria-hidden="true" />
              Atender
            </button>
            <button
              type="button"
              onClick={() => setToastVisible(false)}
              title="Ignorar"
              aria-label="Ignorar"
              className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200/70 bg-white px-3 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}
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
  tone?: CareDeskSignalTone;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200/70 bg-white px-3 py-2">
      <div className="flex items-center gap-2">
        <span className={`flex size-7 items-center justify-center rounded-lg ring-1 ${toneClasses(tone)}`}>
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

function CommandCard({
  description,
  icon: Icon,
  title,
  tone,
  value,
}: {
  description: string;
  icon: typeof Headphones;
  title: string;
  tone: CareDeskSignalTone;
  value: string;
}) {
  return (
    <div className="group rounded-2xl border border-slate-200/70 bg-white p-4 transition-colors hover:border-[#A07C3B]/25 hover:bg-slate-50/40">
      <div className="flex items-start justify-between gap-3">
        <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ring-1 ${toneClasses(tone)}`}>
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <span className="rounded-full bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-500 ring-1 ring-slate-200/70">
          {value}
        </span>
      </div>
      <p className="mt-4 text-sm font-semibold text-slate-950">{title}</p>
      <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{description}</p>
    </div>
  );
}

function MiniSignal({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-[#A07C3B]/15 bg-white px-3 py-2">
      <p className="text-lg font-semibold text-slate-950">{formatCount(value)}</p>
      <p className="mt-0.5 truncate text-[11px] font-semibold uppercase tracking-normal text-slate-400">{label}</p>
    </div>
  );
}

function CareDeskAction({ icon: Icon, label, value }: { icon: typeof Send; label: string; value: string }) {
  return (
    <button
      type="button"
      className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/70 bg-white px-3 py-2.5 text-left transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-[#7A5E2C] ring-1 ring-slate-200">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <span className="truncate text-sm font-semibold text-slate-800">{label}</span>
      </span>
      <span className="rounded-full bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-500 ring-1 ring-slate-200/70">
        {value}
      </span>
    </button>
  );
}

function PulseRow({ label, percent, value }: { label: string; percent: number; value: string }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium text-slate-600">{label}</span>
        <span className="font-semibold text-slate-950">{value}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-[#A07C3B]" style={{ width: `${Math.min(Math.max(percent, 4), 100)}%` }} />
      </div>
    </div>
  );
}

function buildCareDeskSnapshot(clients: QueueClient[]) {
  const sorted = [...clients].sort((first, second) => {
    if (second.parcelas.vencidas !== first.parcelas.vencidas) return second.parcelas.vencidas - first.parcelas.vencidas;
    return second.scoreRisco - first.scoreRisco;
  });
  const criticalTickets = clients.filter((client) => client.prioridade === "Crítica").length;
  const highTickets = clients.filter((client) => client.prioridade === "Alta").length;
  const promisesDue = clients.filter((client) =>
    client.commitments.some((commitment) => commitment.type === "Promessa de pagamento" && commitment.status !== "Cumprida")
  ).length;
  const operators = new Set(clients.map((client) => client.responsavel).filter(Boolean)).size;
  const openTickets = clients.length;
  const unanswered = openTickets ? Math.max(criticalTickets, Math.round(openTickets * 0.12)) : 0;
  const inboundMessages = openTickets ? Math.max(3, Math.round(openTickets * 0.06)) : 0;
  const aiSuggestions = openTickets ? Math.max(8, criticalTickets + highTickets) : 0;
  const handoffs = clients.filter((client) => client.workflow.stage === "Jurídico" || client.workflow.stage === "Crítico").length;

  return {
    aiSuggestions,
    criticalTickets,
    firstResponse: openTickets ? (criticalTickets > 0 ? "5m 12s" : "8m 40s") : "-",
    focusClient: sorted[0],
    handoffs,
    inboundMessages,
    openTickets,
    operators,
    promisesDue,
    unanswered,
    pulse: [
      { label: "SLA protegido", value: `${Math.max(openTickets - criticalTickets, 0)} casos`, percent: openTickets ? ((openTickets - criticalTickets) / openTickets) * 100 : 0 },
      { label: "Fila critica", value: `${criticalTickets} casos`, percent: openTickets ? (criticalTickets / openTickets) * 100 : 0 },
      { label: "Resposta pendente", value: `${unanswered} conversas`, percent: openTickets ? (unanswered / openTickets) * 100 : 0 },
      { label: "Promessas em risco", value: `${promisesDue} alertas`, percent: openTickets ? (promisesDue / openTickets) * 100 : 0 },
    ],
  };
}

function toneClasses(tone: CareDeskSignalTone) {
  if (tone === "live") return "bg-emerald-50 text-emerald-700 ring-emerald-100";
  if (tone === "danger") return "bg-rose-50 text-rose-700 ring-rose-100";
  if (tone === "gold") return "bg-[#A07C3B]/5 text-[#7A5E2C] ring-[#A07C3B]/15";
  if (tone === "blue") return "bg-sky-50 text-sky-700 ring-sky-100";
  return "bg-slate-50 text-slate-700 ring-slate-200";
}

function formatCount(value: number) {
  return Number(value ?? 0).toLocaleString("pt-BR");
}

async function getCareDeskAccessToken() {
  const client = getHubSupabaseClient();

  if (!client) {
    throw new Error("Conexao do Supabase indisponivel.");
  }

  const sessionResult = await client.auth.getSession();
  const accessToken = sessionResult.data.session?.access_token;

  if (sessionResult.error || !accessToken) {
    throw new Error("Sessao administrativa ausente.");
  }

  return accessToken;
}
