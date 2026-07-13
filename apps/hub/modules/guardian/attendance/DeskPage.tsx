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
import { Tooltip } from "@repo/uix";
import { PanteonLoadingState } from "@/components/panteon/panteon-loading";
import { getHubSupabaseClient } from "@/lib/supabase/client";
import { TicketOperationsQueue } from "@/modules/guardian/attendance/components/TicketOperationsQueue";
import { WhatsAppConversationPanel } from "@/modules/guardian/attendance/components/WhatsAppConversationPanel";
import type { OperationalTimelineEvent, QueueClient } from "@/modules/guardian/attendance/types";

type DeskPageProps = {
  clients?: QueueClient[];
  embedded?: boolean;
  loadFromC2x?: boolean;
};

type IrisSignalTone = "live" | "gold" | "danger" | "neutral" | "blue";
const INITIAL_QUEUE_LIMIT = 600;
const emptyQueueClients: QueueClient[] = [];

export function DeskPage({ clients = emptyQueueClients, embedded = false, loadFromC2x = false }: DeskPageProps) {
  const initialClients = useMemo(
    () => (clients.length > 0 ? clients : emptyQueueClients),
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
    const nextClients = clients.length > 0 ? clients : emptyQueueClients;
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
        const response = await fetch(`/api/hades/attendance/queue?limit=${INITIAL_QUEUE_LIMIT}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${await getIrisAccessToken()}`,
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

  const iris = useMemo(() => buildIrisSnapshot(sourceClients), [sourceClients]);
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
      <section className="overflow-hidden rounded-2xl border border-line/70 bg-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-[0_4px_16px_rgba(0,0,0,0.45)]">
        <header className="border-b border-line px-4 py-4">
          <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-center 2xl:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="relative flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#A07C3B] text-white shadow-[0_14px_34px_rgba(160,124,59,0.22)]">
                <Headphones className="size-6" aria-hidden="true" />
                <span className="absolute -right-1 -top-1 size-3 rounded-full bg-emerald-400 ring-2 ring-white" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold tracking-normal text-[#A07C3B]">
                  {embedded ? "Iris / Hades" : "Iris"}
                </p>
                <h1 className="mt-1 text-xl font-semibold tracking-normal text-ink">
                  Central de atendimento multicanal
                </h1>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4 2xl:w-[720px]">
              <DeskMetric icon={Wifi} label="Operacao" value={loading ? "Sincronizando" : "Online"} tone="live" />
              <DeskMetric icon={Inbox} label="Tickets" value={formatCount(iris.openTickets)} />
              <DeskMetric icon={ShieldAlert} label="SLA critico" value={formatCount(iris.criticalTickets)} tone="danger" />
              <DeskMetric icon={UsersRound} label="Operadores" value={formatCount(iris.operators)} tone="gold" />
            </div>
          </div>
        </header>

        <div className="grid gap-3 p-3 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
            <CommandCard
              icon={MessageCircle}
              title="Multicanal"
              value={`${iris.inboundMessages} novas`}
              description="Fila preparada para Meta, conversa, anexo e template."
              tone="live"
            />
            <CommandCard
              icon={Clock3}
              title="Primeira resposta"
              value={iris.firstResponse}
              description="SLA operacional para atendimento humano e Athena."
              tone="gold"
            />
            <CommandCard
              icon={Bot}
              title="Athena"
              value={`${iris.aiSuggestions} ações`}
              description="Copiloto pronto para boleto, contrato, resumo e próxima ação."
              tone="blue"
            />
            <CommandCard
              icon={Network}
              title="Handoff"
              value={`${iris.handoffs} casos`}
              description="Transferência entre cobrança, suporte, financeiro e jurídico."
              tone="neutral"
            />
          </div>

          <div className="rounded-2xl border border-[#A07C3B]/15 bg-[#A07C3B]/5 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-surface text-[#7A5E2C] dark:text-[#d9b877] ring-1 ring-[#A07C3B]/15">
                  <BrainCircuit className="size-5" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-ink">Roteamento inteligente</p>
                  <p className="text-xs font-medium text-ink-soft">C2X + Hades + Iris</p>
                </div>
              </div>
              <span className="rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-[#7A5E2C] dark:text-[#d9b877] ring-1 ring-[#A07C3B]/15">
                ativo
              </span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <MiniSignal label="Critico" value={iris.criticalTickets} />
              <MiniSignal label="Sem resp." value={iris.unanswered} />
              <MiniSignal label="Promessas" value={iris.promisesDue} />
            </div>
          </div>
        </div>

        {showLoadingState ? (
          <PanteonLoadingState
            className="mx-3 mb-3 border-line/70 bg-subtle"
            minHeightClassName="min-h-24"
            title="Carregando fila operacional do C2X"
          />
        ) : null}

        {error ? (
          <div className="mx-3 mb-3 rounded-xl border border-amber-200 dark:border-amber-500/25 bg-amber-50 dark:bg-amber-500/12 px-4 py-3 text-sm font-medium text-amber-800 dark:text-amber-300">
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
          <section className="rounded-2xl border border-line/70 bg-surface p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-[0_4px_16px_rgba(0,0,0,0.45)]">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-xl bg-[#A07C3B] text-white">
                  <Sparkles className="size-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-ink">Athena na fila</p>
                  <p className="text-xs font-medium text-ink-muted">Assistente Virtual da Careli</p>
                </div>
              </div>
              <Tooltip content="Abrir caso sugerido" placement="left">
                <button
                  type="button"
                  onClick={() => openWhatsApp(iris.focusClient?.id)}
                  disabled={!iris.focusClient}
                  className="inline-flex size-9 items-center justify-center rounded-lg border border-[#A07C3B]/20 bg-[#A07C3B]/5 text-[#7A5E2C] dark:text-[#d9b877] transition-colors hover:bg-[#A07C3B]/10 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Abrir caso sugerido"
                >
                  <ArrowRight className="size-4" aria-hidden="true" />
                </button>
              </Tooltip>
            </div>

            <div className="mt-4 rounded-xl border border-line/70 bg-subtle/70 p-3">
              <p className="text-xs font-semibold tracking-normal text-ink-muted">Caso recomendado</p>
              <p className="mt-1 truncate text-sm font-semibold text-ink">
                {iris.focusClient?.nome ?? "Nenhum cliente carregado"}
              </p>
              <p className="mt-2 line-clamp-3 text-sm leading-6 text-ink-soft">
                {iris.focusClient
                  ? `${iris.focusClient.parcelas.vencidas} parcelas vencidas, risco ${iris.focusClient.scoreRisco}/100 e proxima acao: ${iris.focusClient.parcelas.proximaAcao}.`
                  : "Aguardando fila operacional."}
              </p>
            </div>

            <div className="mt-3 grid gap-2">
              <IrisAction icon={Send} label="Sugerir resposta" value="Equipe Careli" />
              <IrisAction icon={TicketCheck} label="Abrir ticket" value="Com SLA" />
              <IrisAction icon={Bell} label="Agendar retorno" value="Follow-up" />
            </div>
          </section>

          <section className="rounded-2xl border border-line/70 bg-surface p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-[0_4px_16px_rgba(0,0,0,0.45)]">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-subtle text-[#7A5E2C] dark:text-[#d9b877] ring-1 ring-line">
                <Activity className="size-5" aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink">Pulso da operação</p>
                <p className="text-xs font-medium text-ink-muted">SLA, volume e risco</p>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {iris.pulse.map((item) => (
                <PulseRow key={item.label} {...item} />
              ))}
            </div>
          </section>
        </aside>
      </section>

      {toastVisible && iris.focusClient ? (
        <div className="fixed right-5 top-24 z-30 w-[360px] rounded-2xl border border-line/70 bg-surface p-4 shadow-[0_18px_60px_rgba(15,23,42,0.18)]">
          <div className="flex items-start justify-between gap-3">
            <div className="flex gap-3">
              <div className="relative flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-100 dark:ring-emerald-500/25">
                <MessageCircle className="size-5" aria-hidden="true" />
                <span className="absolute -right-1 -top-1 size-3 rounded-full bg-[#A07C3B] ring-2 ring-white" />
              </div>
              <div>
                <p className="text-sm font-semibold text-ink">{iris.focusClient.nome}</p>
                <p className="mt-1 text-sm text-ink-soft">Nova interação priorizada</p>
                <p className="mt-1 font-mono text-xs font-semibold text-[#7A5E2C] dark:text-[#d9b877]">Iris SLA</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setToastVisible(false)}
              className="flex size-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-subtle hover:text-ink"
              aria-label="Ignorar notificação"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
          <div className="mt-4 flex gap-2">
            <Tooltip content="Abrir atendimento" placement="top" className="flex-1" triggerClassName="w-full">
              <button
                type="button"
                onClick={() => openWhatsApp(iris.focusClient?.id)}
                aria-label="Abrir atendimento"
                className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-[#A07C3B] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#8E6F35]"
              >
                <MessageCircle className="size-4" aria-hidden="true" />
                Atender
              </button>
            </Tooltip>
            <Tooltip content="Ignorar" placement="top">
              <button
                type="button"
                onClick={() => setToastVisible(false)}
                aria-label="Ignorar"
                className="inline-flex h-9 items-center justify-center rounded-lg border border-line/70 bg-surface px-3 text-xs font-semibold text-ink-soft transition-colors hover:bg-subtle"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </Tooltip>
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
  tone?: IrisSignalTone;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-line/70 bg-surface px-3 py-2">
      <div className="flex items-center gap-2">
        <span className={`flex size-7 items-center justify-center rounded-lg ring-1 ${toneClasses(tone)}`}>
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[11px] font-semibold tracking-normal text-ink-muted">{label}</p>
          <p className="mt-0.5 text-sm font-semibold text-ink">{value}</p>
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
  tone: IrisSignalTone;
  value: string;
}) {
  return (
    <div className="group rounded-2xl border border-line/70 bg-surface p-4 transition-colors hover:border-[#A07C3B]/25 hover:bg-subtle/40">
      <div className="flex items-start justify-between gap-3">
        <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ring-1 ${toneClasses(tone)}`}>
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <span className="rounded-full bg-subtle px-2.5 py-1 text-xs font-semibold text-ink-muted ring-1 ring-line/70">
          {value}
        </span>
      </div>
      <p className="mt-4 text-sm font-semibold text-ink">{title}</p>
      <p className="mt-1 line-clamp-2 text-xs leading-5 text-ink-muted">{description}</p>
    </div>
  );
}

function MiniSignal({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-[#A07C3B]/15 bg-surface px-3 py-2">
      <p className="text-lg font-semibold text-ink">{formatCount(value)}</p>
      <p className="mt-0.5 truncate text-[11px] font-semibold tracking-normal text-ink-muted">{label}</p>
    </div>
  );
}

function IrisAction({ icon: Icon, label, value }: { icon: typeof Send; label: string; value: string }) {
  return (
    <button
      type="button"
      className="flex items-center justify-between gap-3 rounded-xl border border-line/70 bg-surface px-3 py-2.5 text-left transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-subtle text-[#7A5E2C] dark:text-[#d9b877] ring-1 ring-line">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <span className="truncate text-sm font-semibold text-ink">{label}</span>
      </span>
      <span className="rounded-full bg-subtle px-2 py-1 text-[11px] font-semibold text-ink-muted ring-1 ring-line/70">
        {value}
      </span>
    </button>
  );
}

function PulseRow({ label, percent, value }: { label: string; percent: number; value: string }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium text-ink-soft">{label}</span>
        <span className="font-semibold text-ink">{value}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-subtle">
        <div className="h-full rounded-full bg-[#A07C3B]" style={{ width: `${Math.min(Math.max(percent, 4), 100)}%` }} />
      </div>
    </div>
  );
}

function buildIrisSnapshot(clients: QueueClient[]) {
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

function toneClasses(tone: IrisSignalTone) {
  if (tone === "live") return "bg-emerald-50 dark:bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 ring-emerald-100 dark:ring-emerald-500/25";
  if (tone === "danger") return "bg-rose-50 dark:bg-rose-500/12 text-rose-700 dark:text-rose-300 ring-rose-100 dark:ring-rose-500/25";
  if (tone === "gold") return "bg-[#A07C3B]/5 text-[#7A5E2C] dark:text-[#d9b877] ring-[#A07C3B]/15";
  if (tone === "blue") return "bg-sky-50 dark:bg-sky-500/12 text-sky-700 dark:text-sky-300 ring-sky-100 dark:ring-sky-500/25";
  return "bg-subtle text-ink ring-line";
}

function formatCount(value: number) {
  return Number(value ?? 0).toLocaleString("pt-BR");
}

async function getIrisAccessToken() {
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
