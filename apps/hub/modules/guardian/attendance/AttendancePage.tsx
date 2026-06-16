/* eslint-disable */
// @ts-nocheck
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Inbox, MapPinned, MessageCircle } from "lucide-react";
import { Tooltip } from "@repo/uix";
import { PanteonLoadingState } from "@/components/panteon/panteon-loading";
import { ClientDetailPanel } from "@/modules/guardian/attendance/components/ClientDetailPanel";
import { AiCopilotDrawer } from "@/modules/guardian/attendance/components/AiCopilotDrawer";
import { QueuePanel } from "@/modules/guardian/attendance/components/QueuePanel";
import { WhatsAppConversationPanel } from "@/modules/guardian/attendance/components/WhatsAppConversationPanel";
import { IrisPage } from "@/modules/caredesk/IrisPage";
import { getHubSupabaseClient } from "@/lib/supabase/client";
import { queueClients } from "@/modules/guardian/attendance/data";
import type {
  AttendancePriority,
  OperationalTimelineEvent,
  QueueClient,
  WorkflowStage,
} from "@/modules/guardian/attendance/types";

const priorities: Array<AttendancePriority | "Todos"> = [
  "Todos",
  "Crítica",
  "Alta",
  "Média",
  "Baixa",
];

type AttendanceSection = "queue" | "desk" | "portfolio";
type ManualHadesOperations = {
  commitments: QueueClient["commitments"];
  events: OperationalTimelineEvent[];
};

const attendanceSections: Array<{ id: AttendanceSection; label: string; badge?: string; icon: typeof Inbox }> = [
  { id: "queue", label: "Fila operacional", icon: Inbox },
  { id: "desk", label: "Iris", badge: "3", icon: MessageCircle },
  { id: "portfolio", label: "Carteira", icon: MapPinned },
];
const INITIAL_QUEUE_LIMIT = 600;
const emptyManualOperations: ManualHadesOperations = {
  commitments: [],
  events: [],
};

type AttendancePageProps = {
  clients?: QueueClient[];
  loadFromC2x?: boolean;
};

export function AttendancePage({ clients, loadFromC2x = false }: AttendancePageProps) {
  const searchParams = useSearchParams();
  const routeOpenHandledRef = useRef(false);
  const routeAttendanceProtocol = normalizeAttendanceProtocol(
    searchParams.get("attendanceProtocol") ??
      searchParams.get("atProtocol") ??
      searchParams.get("at"),
  );
  const routeClientId =
    searchParams.get("clientId") ??
    searchParams.get("client") ??
    searchParams.get("hadesClientId");
  const routeSection = normalizeAttendanceSection(
    searchParams.get("view") ?? searchParams.get("section"),
  );
  const initialClients = clients ?? queueClients;
  const [sourceClients, setSourceClients] = useState(initialClients);
  const [queueTotalCount, setQueueTotalCount] = useState(initialClients.length);
  const [queueLoading, setQueueLoading] = useState(loadFromC2x && initialClients.length === 0);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState(sourceClients[0]?.id ?? "");
  const [activeSection, setActiveSection] = useState<AttendanceSection>(
    routeSection ?? "queue",
  );
  const [search, setSearch] = useState("");
  const [enterprise, setEnterprise] = useState("Todos");
  const [priority, setPriority] = useState<AttendancePriority | "Todos">("Todos");
  const [stage, setStage] = useState<WorkflowStage | "Todas">("Todas");
  const [whatsAppClientId, setWhatsAppClientId] = useState<string | null>(null);
  const [whatsAppAttendanceProtocol, setWhatsAppAttendanceProtocol] = useState<string | null>(null);
  const [timelineEventsByClient, setTimelineEventsByClient] = useState<
    Record<string, OperationalTimelineEvent[]>
  >({});
  const [manualOperationsByClient, setManualOperationsByClient] = useState<
    Record<string, ManualHadesOperations>
  >({});

  useEffect(() => {
    setSourceClients(initialClients);
    setQueueTotalCount(initialClients.length);
    setSelectedId((current) =>
      initialClients.some((client) => client.id === current)
        ? current
        : initialClients[0]?.id ?? ""
    );
  }, [initialClients]);

  useEffect(() => {
    if (!loadFromC2x) {
      return;
    }

    let cancelled = false;

    async function loadQueue() {
      setQueueLoading(true);
      setQueueError(null);

      try {
        const accessToken = await getHadesAccessToken();
        const response = await fetch(`/api/hades/attendance/queue?limit=${INITIAL_QUEUE_LIMIT}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        const payload = (await response.json().catch(() => null)) as
          | { clients?: QueueClient[]; error?: string; meta?: { count?: number; loadedCount?: number } }
          | null;

        if (cancelled) {
          return;
        }

        if (!response.ok || !payload?.clients) {
          throw new Error(payload?.error ?? "Nao foi possivel carregar a fila do C2X.");
        }

        setSourceClients(payload.clients);
        setQueueTotalCount(payload.meta?.count ?? payload.clients.length);
        setSelectedId(payload.clients[0]?.id ?? "");
      } catch (error) {
        console.error("[guardian-attendance] queue load failed", error);
        if (!cancelled) {
          setQueueError(
            error instanceof Error
              ? error.message
              : "Nao foi possivel carregar a fila do C2X."
          );
        }
      } finally {
        if (!cancelled) {
          setQueueLoading(false);
        }
      }
    }

    void loadQueue();

    return () => {
      cancelled = true;
    };
  }, [loadFromC2x]);

  useEffect(() => {
    if (!selectedId) {
      return;
    }

    const selectedClientForDetails = sourceClients.find((client) => client.id === selectedId);

    if (!selectedClientForDetails || selectedClientForDetails.c2xInstallmentsLoaded !== false) {
      return;
    }

    let cancelled = false;

    async function loadSelectedClientDetails() {
      try {
        const response = await fetch(
          `/api/hades/attendance/client/${encodeURIComponent(selectedId)}`,
          {
            cache: "no-store",
            headers: {
              Authorization: `Bearer ${await getHadesAccessToken()}`,
            },
          }
        );
        const payload = (await response.json().catch(() => null)) as
          | { client?: QueueClient; error?: string }
          | null;

        if (cancelled) {
          return;
        }

        if (!response.ok || !payload?.client) {
          throw new Error(payload?.error ?? "Nao foi possivel carregar as parcelas do cliente.");
        }

        setSourceClients((current) =>
          current.map((client) =>
            client.id === payload.client?.id
              ? { ...client, ...payload.client }
              : client
          )
        );
      } catch (error) {
        console.error("[guardian-attendance] client detail load failed", error);
        if (!cancelled) {
          setSourceClients((current) =>
            current.map((client) =>
              client.id === selectedId
                ? { ...client, c2xInstallments: [], c2xInstallmentsLoaded: true }
                : client
            )
          );
        }
      }
    }

    void loadSelectedClientDetails();

    return () => {
      cancelled = true;
    };
  }, [selectedId, sourceClients]);

  useEffect(() => {
    if (!selectedId) {
      return;
    }

    let cancelled = false;

    async function loadManualOperations() {
      try {
        const response = await fetch(
          `/api/hades/attendance/manual-events?clientId=${encodeURIComponent(selectedId)}`,
          {
            cache: "no-store",
            headers: {
              Authorization: `Bearer ${await getHadesAccessToken()}`,
            },
          },
        );
        const payload = (await response.json().catch(() => null)) as
          | ManualHadesOperations
          | { error?: string }
          | null;

        if (cancelled) {
          return;
        }

        if (!response.ok || !payload || "error" in payload) {
          throw new Error(
            payload?.error ?? "Nao foi possivel carregar registros manuais.",
          );
        }

        setManualOperationsByClient((current) => ({
          ...current,
          [selectedId]: {
            commitments: payload.commitments ?? [],
            events: payload.events ?? [],
          },
        }));
      } catch (error) {
        console.error("[guardian-attendance] manual operations load failed", error);
      }
    }

    void loadManualOperations();

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => {
    if (routeOpenHandledRef.current || !routeAttendanceProtocol || sourceClients.length === 0) {
      return;
    }

    const routeClient =
      (routeClientId
        ? sourceClients.find((client) => client.id === routeClientId)
        : null) ??
      sourceClients.find((client) => client.id === selectedId) ??
      sourceClients[0];

    if (!routeClient) {
      return;
    }

    routeOpenHandledRef.current = true;
    setSelectedId(routeClient.id);
    setWhatsAppClientId(routeClient.id);
    setWhatsAppAttendanceProtocol(routeAttendanceProtocol);
  }, [routeAttendanceProtocol, routeClientId, selectedId, sourceClients]);

  const enterpriseOptions = useMemo(() => {
    const enterprises = sourceClients
      .flatMap((client) => [
        client.carteira.empreendimento,
        ...client.carteira.unidades.map((unit) => unit.empreendimento),
      ])
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "pt-BR"));

    return ["Todos", ...Array.from(new Set(enterprises))];
  }, [sourceClients]);

  const searchableClients = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return sourceClients.filter((client) => {
      const matchesSearch =
        normalizedSearch.length === 0 ||
        client.nome.toLowerCase().includes(normalizedSearch) ||
        client.responsavel.toLowerCase().includes(normalizedSearch) ||
        client.cpf.toLowerCase().includes(normalizedSearch) ||
        client.carteira.empreendimento.toLowerCase().includes(normalizedSearch) ||
        client.carteira.unidades.some((unit) =>
          `${unit.unidadeLote} ${unit.quadra} ${unit.lote} ${unit.matricula}`
            .toLowerCase()
            .includes(normalizedSearch)
        );

      const matchesEnterprise =
        enterprise === "Todos" ||
        client.carteira.empreendimento === enterprise ||
        client.carteira.unidades.some((unit) => unit.empreendimento === enterprise);
      const matchesPriority = priority === "Todos" || client.prioridade === priority;

      return matchesSearch && matchesEnterprise && matchesPriority;
    });
  }, [enterprise, priority, search, sourceClients]);

  const filteredClients = useMemo(() => {
    return searchableClients
      .filter((client) => stage === "Todas" || client.workflow.stage === stage)
      .sort((first, second) => second.parcelas.vencidas - first.parcelas.vencidas);
  }, [searchableClients, stage]);

  const selectedClient =
    filteredClients.find((client) => client.id === selectedId) ??
    filteredClients[0] ??
    sourceClients.find((client) => client.id === selectedId) ??
    sourceClients[0];
  const selectedManualOperations =
    manualOperationsByClient[selectedClient?.id ?? ""] ?? emptyManualOperations;
  const selectedClientWithManualOperations = selectedClient
    ? {
        ...selectedClient,
        commitments: mergeCommitments(
          selectedManualOperations.commitments,
          selectedClient.commitments,
        ),
      }
    : selectedClient;
  const selectedExtraTimelineEvents = dedupeTimelineEvents([
    ...selectedManualOperations.events,
    ...(timelineEventsByClient[selectedClient?.id ?? ""] ?? []),
  ]);
  const whatsAppClient = whatsAppClientId
    ? sourceClients.find((client) => client.id === whatsAppClientId) ?? selectedClient
    : selectedClient;

  if (!selectedClient) {
    if (queueLoading) {
      return (
        <div className="relative min-h-[calc(100dvh-9rem)] overflow-hidden rounded-xl border border-[#d9e0e7] bg-white/50 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <PanteonLoadingState
            className="rounded-xl bg-white/70 backdrop-blur-sm"
            markSize="lg"
            title="Carregando fila operacional do C2X"
            variant="overlay"
          />
        </div>
      );
    }

    return (
      <div className="rounded-xl border border-slate-200/70 bg-white p-8 text-center text-sm text-slate-500 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        {queueError ?? "Aguardando dados reais do C2X para montar a fila de cobrança."}
      </div>
    );
  }

  function openWhatsApp(clientId = selectedClient.id, attendanceProtocol?: string | null) {
    setSelectedId(clientId);
    setWhatsAppClientId(clientId);
    setWhatsAppAttendanceProtocol(normalizeAttendanceProtocol(attendanceProtocol));
  }

  async function saveManualTimelineEvent(
    clientId: string,
    event: OperationalTimelineEvent,
  ) {
    const clientForEvent =
      sourceClients.find((client) => client.id === clientId) ?? selectedClient;

    if (!clientForEvent) {
      return;
    }

    const response = await fetch("/api/hades/attendance/manual-events", {
      body: JSON.stringify({
        client: {
          c2xAcquisitionRequestId: clientForEvent.c2xAcquisitionRequestId,
          id: clientForEvent.id,
          name: clientForEvent.nome,
        },
        event,
        kind: "timeline",
      }),
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${await getHadesAccessToken()}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const payload = (await response.json().catch(() => null)) as
      | ManualHadesOperations
      | { error?: string }
      | null;

    if (!response.ok || !payload || "error" in payload) {
      throw new Error(payload?.error ?? "Nao foi possivel salvar evento manual.");
    }

    upsertManualOperations(clientForEvent.id, payload);
  }

  function addTimelineEvent(clientId: string, event: OperationalTimelineEvent) {
    void saveManualTimelineEvent(clientId, event).catch((error) => {
      console.error("[guardian-attendance] manual event save failed", error);
      setTimelineEventsByClient((current) => ({
        ...current,
        [clientId]: [event, ...(current[clientId] ?? [])],
      }));
    });
  }

  async function saveManualCommitment(record: QueueClient["commitments"][number]) {
    const response = await fetch("/api/hades/attendance/manual-events", {
      body: JSON.stringify({
        client: {
          c2xAcquisitionRequestId: selectedClient.c2xAcquisitionRequestId,
          id: selectedClient.id,
          name: selectedClient.nome,
        },
        commitment: record,
        kind: "commitment",
      }),
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${await getHadesAccessToken()}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const payload = (await response.json().catch(() => null)) as
      | ManualHadesOperations
      | { error?: string }
      | null;

    if (!response.ok || !payload || "error" in payload) {
      throw new Error(payload?.error ?? "Nao foi possivel salvar compromisso.");
    }

    upsertManualOperations(selectedClient.id, payload);
  }

  async function updateManualCommitment(record: QueueClient["commitments"][number]) {
    const isPersistedRecord = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.id);

    if (!isPersistedRecord) {
      await saveManualCommitment(record);
      return;
    }

    const response = await fetch("/api/hades/attendance/manual-events", {
      body: JSON.stringify({
        commitment: record,
        id: record.id,
        kind: "commitment",
      }),
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${await getHadesAccessToken()}`,
        "Content-Type": "application/json",
      },
      method: "PATCH",
    });
    const payload = (await response.json().catch(() => null)) as
      | ManualHadesOperations
      | { error?: string }
      | null;

    if (!response.ok || !payload || "error" in payload) {
      throw new Error(payload?.error ?? "Nao foi possivel atualizar compromisso.");
    }

    upsertManualOperations(selectedClient.id, payload);
  }

  function upsertManualOperations(clientId: string, payload: ManualHadesOperations) {
    setManualOperationsByClient((current) => {
      const currentOperations = current[clientId] ?? emptyManualOperations;

      return {
        ...current,
        [clientId]: {
          commitments: upsertById(
            payload.commitments ?? [],
            currentOperations.commitments,
          ),
          events: upsertById(payload.events ?? [], currentOperations.events),
        },
      };
    });
  }

  return (
    <>
      {whatsAppClientId ? (
        <WhatsAppConversationPanel
          key={`${whatsAppClient.id}-${whatsAppAttendanceProtocol ?? "novo"}`}
          client={whatsAppClient}
          initialAttendanceProtocol={whatsAppAttendanceProtocol}
          onClose={() => {
            setWhatsAppClientId(null);
            setWhatsAppAttendanceProtocol(null);
          }}
          onTimelineEvent={addTimelineEvent}
          open={Boolean(whatsAppClientId)}
        />
      ) : (
        <div className="space-y-5">
          <nav className="flex w-fit gap-1 overflow-x-auto rounded-xl border border-slate-200/70 bg-white p-1 shadow-[0_1px_2px_rgba(15,23,42,0.04)]" aria-label="Módulos de cobrança">
            {attendanceSections.map((section) => {
              const Icon = section.icon;
              const active = activeSection === section.id;

              return (
                <Tooltip key={section.id} content={section.label} placement="bottom">
                  <button
                    type="button"
                    onClick={() => setActiveSection(section.id)}
                    aria-label={section.label}
                    className={`relative inline-flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
                      active
                        ? "bg-[#A07C3B]/10 text-[#7A5E2C] ring-1 ring-[#A07C3B]/20"
                        : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                    }`}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    {section.badge ? (
                      <span className="absolute -right-1 -top-1 rounded-full bg-[#A07C3B] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                        {section.badge}
                      </span>
                    ) : null}
                  </button>
                </Tooltip>
              );
            })}
          </nav>

          {activeSection === "desk" ? (
            <IrisPage embedded boardOnly queueSlugFilter="cobranca" />
          ) : (
            <div className="grid w-full items-start gap-5 xl:grid-cols-[400px_minmax(0,1fr)]">
              <QueuePanel
                clients={filteredClients}
                summaryClients={searchableClients}
                priorities={priorities}
                enterprises={enterpriseOptions}
                search={search}
                selectedEnterprise={enterprise}
                selectedClientId={selectedClient.id}
                selectedPriority={priority}
                selectedStage={stage}
                onEnterpriseChange={setEnterprise}
                onPriorityChange={setPriority}
                onOpenWhatsApp={(clientId) => openWhatsApp(clientId)}
                onSearchChange={setSearch}
                onStageChange={setStage}
                onSelectClient={setSelectedId}
              />
              <ClientDetailPanel
                key={selectedClient.id}
                client={selectedClientWithManualOperations}
                extraTimelineEvents={selectedExtraTimelineEvents}
                onCreateCommitment={saveManualCommitment}
                onCreateTimelineEvent={(event) =>
                  saveManualTimelineEvent(selectedClient.id, event)
                }
                onOpenWhatsApp={() => openWhatsApp(selectedClient.id)}
                onUpdateCommitment={updateManualCommitment}
              />
            </div>
          )}
        </div>
      )}
      <AiCopilotDrawer
        client={selectedClientWithManualOperations}
        filteredQueueClients={filteredClients}
        queueClients={sourceClients}
        queueTotalCount={queueTotalCount}
      />
    </>
  );
}

function upsertById<T extends { id: string }>(nextRows: T[], currentRows: T[]) {
  const nextIds = new Set(nextRows.map((row) => row.id));

  return [
    ...nextRows,
    ...currentRows.filter((row) => !nextIds.has(row.id)),
  ];
}

function mergeCommitments(
  manualCommitments: QueueClient["commitments"],
  baseCommitments: QueueClient["commitments"],
) {
  return upsertById(manualCommitments, baseCommitments);
}

function dedupeTimelineEvents(events: OperationalTimelineEvent[]) {
  return upsertById(events, []);
}

function normalizeAttendanceProtocol(value?: string | null) {
  const normalized = String(value ?? "").trim().toUpperCase();

  return /^AT-\d{1,12}$/.test(normalized) ? normalized : null;
}

function normalizeAttendanceSection(value?: string | null): AttendanceSection | null {
  const normalized = String(value ?? "").trim().toLowerCase();

  if (["iris", "desk", "atendimento"].includes(normalized)) {
    return "desk";
  }

  if (["carteira", "portfolio"].includes(normalized)) {
    return "portfolio";
  }

  if (["fila", "queue", "cobranca"].includes(normalized)) {
    return "queue";
  }

  return null;
}

async function getHadesAccessToken() {
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




