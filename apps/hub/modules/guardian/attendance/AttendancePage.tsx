/* eslint-disable */
// @ts-nocheck
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Handshake,
  Inbox,
  MessageCircle,
  PanelLeftOpen,
} from "lucide-react";
import {
  mapLegacyRoleToOperationalProfile,
  type HubUserContext,
  type OperationalProfileRole,
} from "@repo/shared";
import { Tooltip } from "@repo/uix";
import { PanteonLoadingState } from "@/components/panteon/panteon-loading";
import { ClientDetailPanel } from "@/modules/guardian/attendance/components/ClientDetailPanel";
import { HadesAttendanceModal } from "@/modules/guardian/attendance/components/HadesAttendanceModal";
import { HadesClientPicker } from "@/modules/guardian/attendance/components/HadesClientPicker";
import { ManagerApprovalCenter } from "@/modules/guardian/attendance/components/ManagerApprovalCenter";
import { AiCopilotDrawer } from "@/modules/guardian/attendance/components/AiCopilotDrawer";
import { ProposalModal } from "@/modules/guardian/attendance/components/PropostasPanel";
import { QueuePanel } from "@/modules/guardian/attendance/components/QueuePanel";
import { WhatsAppConversationPanel } from "@/modules/guardian/attendance/components/WhatsAppConversationPanel";
import { IrisPage } from "@/modules/caredesk/IrisPage";
import { useAuth } from "@/providers/auth-provider";
import { getHubSupabaseClient } from "@/lib/supabase/client";
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

type QueueMode = "daily" | "general";
type OverdueRangeFilter = "all" | "1-30" | "31-60" | "60+";
type AttendanceSection = "queue" | "desk" | "agreements";
type ManualHadesOperations = {
  commitments: QueueClient["commitments"];
  events: OperationalTimelineEvent[];
};

const INITIAL_QUEUE_LIMIT = 600;
const emptyManualOperations: ManualHadesOperations = {
  commitments: [],
  events: [],
};
const attendanceSections: Array<{
  id: AttendanceSection;
  label: string;
  icon: typeof Inbox;
}> = [
  { id: "queue", label: "Fila diaria", icon: Inbox },
  { id: "desk", label: "Fila de atendimento", icon: MessageCircle },
  { id: "agreements", label: "Acordos feitos", icon: Handshake },
];

type AttendancePageProps = {
  clients?: QueueClient[];
  loadFromC2x?: boolean;
};

export function AttendancePage({ clients, loadFromC2x = false }: AttendancePageProps) {
  const { hubUser } = useAuth();
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
  const routeTab = searchParams.get("tab");
  const routeFrom = searchParams.get("from");
  // Protocolo dedicado pra "Voltar ao atendimento" reabrir a conversa (sem
  // colidir com `at`, que abre o painel antigo de conversa).
  const routeReopenProtocol = searchParams.get("reopenAt");
  const routeEditProposal = searchParams.get("editProposal");
  const clientOpenHandledRef = useRef(false);
  const [initialDetailTab, setInitialDetailTab] = useState<string | null>(null);
  const [backToCentral, setBackToCentral] = useState(false);
  const [backToAtendimento, setBackToAtendimento] = useState(false);
  const initialClients = clients ?? [];
  const [sourceClients, setSourceClients] = useState(initialClients);
  const [queueTotalCount, setQueueTotalCount] = useState(initialClients.length);
  const [queueLoading, setQueueLoading] = useState(loadFromC2x && initialClients.length === 0);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState(sourceClients[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const [enterprise, setEnterprise] = useState("Todos");
  const [priority, setPriority] = useState<AttendancePriority | "Todos">("Todos");
  const [stage, setStage] = useState<WorkflowStage | "Todas">("Todas");
  const [queueMode, setQueueMode] = useState<QueueMode>("daily");
  const [overdueRange, setOverdueRange] = useState<OverdueRangeFilter>("all");
  const [queueCollapsed, setQueueCollapsed] = useState(false);
  const [activeSection, setActiveSection] = useState<AttendanceSection>("queue");
  const [whatsAppClientId, setWhatsAppClientId] = useState<string | null>(null);
  const [whatsAppAttendanceProtocol, setWhatsAppAttendanceProtocol] = useState<string | null>(null);
  // Form de abertura de atendimento (Hades) — aberto a partir do card da fila.
  const [attendanceClientId, setAttendanceClientId] = useState<string | null>(null);
  // Seletor de cliente do "Novo atendimento" da Fila de atendimento (sem cliente pre-selecionado).
  const [attendancePickerOpen, setAttendancePickerOpen] = useState(false);
  const [timelineEventsByClient, setTimelineEventsByClient] = useState<
    Record<string, OperationalTimelineEvent[]>
  >({});
  const [manualOperationsByClient, setManualOperationsByClient] = useState<
    Record<string, ManualHadesOperations>
  >({});
  // Bump para re-buscar os eventos manuais/motor do cliente selecionado quando
  // uma proposta (acordo/promessa) e criada/editada (evento "guardian:motor-changed").
  const [motorRefreshTick, setMotorRefreshTick] = useState(0);

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
        // Honra o deep-link "Abrir no cliente" (?clientId=<c2xId>) e seta a aba
        // NO MESMO batch (senao o painel monta em "overview" antes da aba chegar).
        const routed = findClientByRouteId(payload.clients, routeClientId);
        if (routed) {
          clientOpenHandledRef.current = true;
          setSelectedId(routed.id);
          setQueueMode("general");
          if (routeTab === "propostas") {
            setInitialDetailTab("agreements");
            setBackToCentral(true);
          } else if (routeTab === "cliente") {
            setInitialDetailTab("client");
          }
          if (routeFrom === "atendimento") {
            setBackToAtendimento(true);
          }
        } else {
          setSelectedId(payload.clients[0]?.id ?? "");
        }
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
  }, [selectedId, motorRefreshTick]);

  // Quando uma proposta e criada/editada no motor (PropostasPanel), re-busca os
  // eventos do cliente selecionado para a Visao geral / Timeline atualizarem na
  // hora, sem precisar reselecionar o cliente.
  useEffect(() => {
    function onMotorChanged() {
      setMotorRefreshTick((tick) => tick + 1);
    }

    window.addEventListener("guardian:motor-changed", onMotorChanged);

    return () => {
      window.removeEventListener("guardian:motor-changed", onMotorChanged);
    };
  }, []);

  // Etapa do workflow (Auto - Hades) derivada do motor em LOTE, aplicada na FONTE
  // (sourceClients) para a fila e o detalhe mostrarem a MESMA etapa. Idempotente:
  // applyClientStage devolve a mesma referencia quando nada muda, entao o
  // setSourceClients nao dispara re-render em loop. Re-deriva quando uma proposta
  // e criada/editada (motorRefreshTick).
  useEffect(() => {
    if (sourceClients.length === 0) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/guardian/compromissos/stages", {
          cache: "no-store",
          headers: { Authorization: `Bearer ${await getHadesAccessToken()}` },
        });
        const payload = (await response.json().catch(() => null)) as {
          data?: {
            clientC2xId: number;
            nextAction: string;
            operator: string | null;
            stage: string;
          }[];
        } | null;

        if (cancelled || !response.ok) {
          return;
        }

        const stageByClient = new Map(
          (payload?.data ?? []).map((entry) => [Number(entry.clientC2xId), entry]),
        );

        setSourceClients((previous) => {
          let changed = false;
          const next = previous.map((client) => {
            const applied = applyClientStage(client, stageByClient);
            if (applied !== client) {
              changed = true;
            }
            return applied;
          });
          return changed ? next : previous;
        });
      } catch {
        // best-effort: sem motor, a fila mantem a etapa atual
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sourceClients, motorRefreshTick]);

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

  // Deep-link "Abrir no cliente" (?clientId=<c2xId>&tab=propostas) vindo da
  // Central de Propostas: seleciona o cliente casando pelo c2x id embutido no
  // id da fila (o id da fila nao e o numero cru) e abre na aba Propostas.
  useEffect(() => {
    if (
      clientOpenHandledRef.current ||
      !routeClientId ||
      routeAttendanceProtocol ||
      sourceClients.length === 0
    ) {
      return;
    }

    const target = findClientByRouteId(sourceClients, routeClientId);

    if (!target) {
      return;
    }

    clientOpenHandledRef.current = true;
    setSelectedId(target.id);
    // Fila geral pra o cliente do deep-link aparecer na lista (a diaria pode
    // nao conter ele).
    setQueueMode("general");
    if (routeTab === "propostas") {
      setInitialDetailTab("agreements");
      setBackToCentral(true);
    } else if (routeTab === "cliente") {
      setInitialDetailTab("client");
    }
    if (routeFrom === "atendimento") {
      setBackToAtendimento(true);
    }
  }, [routeAttendanceProtocol, routeClientId, routeFrom, routeTab, sourceClients]);

  const operationalProfile = useMemo(
    () => resolveHadesOperationalProfile(hubUser),
    [hubUser],
  );
  const profileScopedClients = useMemo(
    () =>
      sourceClients.filter((client) =>
        isClientInHadesProfileScope(client, operationalProfile.role),
      ),
    [operationalProfile.role, sourceClients],
  );
  const leadershipOverdueFilterEnabled = isHadesLeadershipProfile(
    operationalProfile.role,
  );
  const overdueRangeCounts = useMemo(
    () => buildOverdueRangeCounts(profileScopedClients),
    [profileScopedClients],
  );
  const overdueScopedClients = useMemo(
    () =>
      profileScopedClients.filter((client) =>
        isClientInOverdueRange(client, overdueRange),
      ),
    [overdueRange, profileScopedClients],
  );
  const todayContactClientIds = useMemo(
    () =>
      buildTodayContactClientIds(
        overdueScopedClients,
        timelineEventsByClient,
        manualOperationsByClient,
      ),
    [manualOperationsByClient, overdueScopedClients, timelineEventsByClient],
  );

  useEffect(() => {
    if (!leadershipOverdueFilterEnabled && overdueRange !== "all") {
      setOverdueRange("all");
    }
  }, [leadershipOverdueFilterEnabled, overdueRange]);

  const enterpriseOptions = useMemo(() => {
    const enterprises = overdueScopedClients
      .flatMap((client) => [
        client.carteira.empreendimento,
        ...client.carteira.unidades.map((unit) => unit.empreendimento),
      ])
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "pt-BR"));

    return ["Todos", ...Array.from(new Set(enterprises))];
  }, [overdueScopedClients]);

  const searchableClients = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return overdueScopedClients.filter((client) => {
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
  }, [enterprise, overdueScopedClients, priority, search]);

  const dailyQueueClients = useMemo(
    () => searchableClients.filter((client) => isDailyQueueClient(client)),
    [searchableClients],
  );
  const agreementClients = useMemo(
    () => overdueScopedClients.filter((client) => isAgreementClient(client)),
    [overdueScopedClients],
  );
  const queueSummaryClients = queueMode === "daily" ? dailyQueueClients : searchableClients;

  const filteredClients = useMemo(() => {
    const modeScopedClients = queueMode === "daily" ? dailyQueueClients : searchableClients;

    return modeScopedClients
      .filter((client) => stage === "Todas" || client.workflow.stage === stage)
      .sort((first, second) => {
        const firstContacted = todayContactClientIds.has(first.id) ? 1 : 0;
        const secondContacted = todayContactClientIds.has(second.id) ? 1 : 0;

        if (firstContacted !== secondContacted) {
          return firstContacted - secondContacted;
        }

        return second.parcelas.vencidas - first.parcelas.vencidas;
      });
  }, [dailyQueueClients, queueMode, searchableClients, stage, todayContactClientIds]);

  const selectedClient =
    // Match EXATO do selectedId em qualquer lista vence o "primeiro da fila":
    // senao o deep-link (cliente fora da fila filtrada) abre o cliente errado.
    filteredClients.find((client) => client.id === selectedId) ??
    overdueScopedClients.find((client) => client.id === selectedId) ??
    sourceClients.find((client) => client.id === selectedId) ??
    filteredClients[0] ??
    overdueScopedClients[0] ??
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
  const selectedAgreementClient =
    agreementClients.find((client) => client.id === selectedId) ?? agreementClients[0];
  const selectedAgreementManualOperations =
    manualOperationsByClient[selectedAgreementClient?.id ?? ""] ?? emptyManualOperations;
  const selectedAgreementClientWithManualOperations = selectedAgreementClient
    ? {
        ...selectedAgreementClient,
        commitments: mergeCommitments(
          selectedAgreementManualOperations.commitments,
          selectedAgreementClient.commitments,
        ),
      }
    : selectedAgreementClient;
  const selectedAgreementExtraTimelineEvents = dedupeTimelineEvents([
    ...selectedAgreementManualOperations.events,
    ...(timelineEventsByClient[selectedAgreementClient?.id ?? ""] ?? []),
  ]);

  useEffect(() => {
    if (activeSection !== "agreements" || agreementClients.length === 0) {
      return;
    }

    if (!agreementClients.some((client) => client.id === selectedId)) {
      setSelectedId(agreementClients[0].id);
    }
  }, [activeSection, agreementClients, selectedId]);

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

  function openAttendance(clientId = selectedClient.id) {
    if (!clientId) return;
    setSelectedId(clientId);
    setAttendanceClientId(clientId);
  }

  const attendanceClient = attendanceClientId
    ? sourceClients.find((client) => client.id === attendanceClientId) ?? null
    : null;

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

  async function saveManualCommitment(
    record: QueueClient["commitments"][number],
    clientContext = selectedClient,
  ) {
    const response = await fetch("/api/hades/attendance/manual-events", {
      body: JSON.stringify({
        client: {
          c2xAcquisitionRequestId: clientContext.c2xAcquisitionRequestId,
          id: clientContext.id,
          name: clientContext.nome,
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

    upsertManualOperations(clientContext.id, payload);
  }

  async function updateManualCommitment(
    record: QueueClient["commitments"][number],
    clientContext = selectedClient,
  ) {
    const isPersistedRecord = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.id);

    if (!isPersistedRecord) {
      await saveManualCommitment(record, clientContext);
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

    upsertManualOperations(clientContext.id, payload);
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
          {backToCentral && activeSection !== "agreements" ? (
            <Tooltip content="Voltar à Central de Propostas" placement="right">
              <button
                type="button"
                onClick={() => {
                  setActiveSection("agreements");
                  setBackToCentral(false);
                }}
                aria-label="Voltar à Central de Propostas"
                className="inline-flex size-9 items-center justify-center rounded-lg border border-[#A07C3B]/25 bg-[#FFF9EF] text-[#7A5E2C] transition-colors hover:bg-[#FCF3E2]"
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
              </button>
            </Tooltip>
          ) : null}
          {backToAtendimento && activeSection !== "desk" ? (
            <Tooltip content="Voltar ao atendimento" placement="right">
              <button
                type="button"
                onClick={() => {
                  setActiveSection("desk");
                  setBackToAtendimento(false);
                }}
                aria-label="Voltar ao atendimento"
                className="inline-flex size-9 items-center justify-center rounded-lg border border-[#A07C3B]/25 bg-[#FFF9EF] text-[#7A5E2C] transition-colors hover:bg-[#FCF3E2]"
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
              </button>
            </Tooltip>
          ) : null}
          <nav
            aria-label="Atalhos do Hades"
            className="inline-flex items-center gap-1 rounded-xl border border-[#d9e0e7] bg-white p-1 shadow-[0_1px_2px_rgba(15,23,42,0.06)]"
          >
            {attendanceSections.map((section) => {
              const Icon = section.icon;
              const isActive = activeSection === section.id;

              return (
                <Tooltip key={section.id} content={section.label} placement="bottom">
                  <button
                    type="button"
                    aria-label={section.label}
                    aria-pressed={isActive}
                    onClick={() => {
                      setActiveSection(section.id);

                      if (section.id === "queue") {
                        setQueueMode("daily");
                      }
                    }}
                    className={`inline-flex size-9 items-center justify-center rounded-lg border text-sm transition focus:outline-none focus:ring-2 focus:ring-[#A07C3B]/35 ${
                      isActive
                        ? "border-[#A07C3B]/35 bg-[#F8F3E8] text-[#8A6A2F]"
                        : "border-transparent bg-white text-slate-500 hover:border-[#d9e0e7] hover:text-slate-900"
                    }`}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                  </button>
                </Tooltip>
              );
            })}
          </nav>

          {activeSection === "desk" ? (
            <IrisPage
              embedded
              boardOnly
              cobrancaMode
              operatorScoped
              queueSlugFilter="cobranca"
              initialAttendanceProtocol={routeReopenProtocol}
              onStartAttendanceOverride={() => setAttendancePickerOpen(true)}
              renderCobrancaProposal={(args) => (
                <ProposalModal
                  kind={args.kind}
                  client={args.client}
                  clientC2xId={args.clientC2xId}
                  overdue={args.overdue}
                  onClose={args.onClose}
                  onCreated={args.onCreated}
                />
              )}
            />
          ) : activeSection === "agreements" ? (
            <ManagerApprovalCenter />
          ) : (
            <div
              className={`grid w-full items-start gap-5 ${
                queueCollapsed
                  ? "xl:grid-cols-[44px_minmax(0,1fr)]"
                  : "xl:grid-cols-[400px_minmax(0,1fr)]"
              }`}
            >
              {queueCollapsed ? (
                <Tooltip content="Expandir fila" placement="right">
                  <button
                    type="button"
                    onClick={() => setQueueCollapsed(false)}
                    aria-label="Expandir fila diária"
                    className="flex size-11 items-center justify-center rounded-xl border border-[#d9e0e7] bg-white text-slate-500 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-[#A07C3B]/35 hover:text-[#8A6A2F]"
                  >
                    <PanelLeftOpen className="size-4" aria-hidden="true" />
                  </button>
                </Tooltip>
              ) : (
                <QueuePanel
                  onCollapse={() => setQueueCollapsed(true)}
                  clients={filteredClients}
                contactedTodayClientIds={todayContactClientIds}
                dailyCount={dailyQueueClients.length}
                generalCount={searchableClients.length}
                summaryClients={queueSummaryClients}
                priorities={priorities}
                enterprises={enterpriseOptions}
                mode={queueMode}
                overdueRange={overdueRange}
                overdueRangeCounts={overdueRangeCounts}
                overdueRangeEnabled={leadershipOverdueFilterEnabled}
                profileLabel={operationalProfile.label}
                search={search}
                selectedEnterprise={enterprise}
                selectedClientId={selectedClient.id}
                selectedPriority={priority}
                selectedStage={stage}
                onEnterpriseChange={setEnterprise}
                onModeChange={setQueueMode}
                onOverdueRangeChange={setOverdueRange}
                onPriorityChange={setPriority}
                onOpenAttendance={(clientId) => openAttendance(clientId)}
                onSearchChange={setSearch}
                onStageChange={setStage}
                onSelectClient={setSelectedId}
                />
              )}
              <ClientDetailPanel
                key={selectedClient.id}
                client={selectedClientWithManualOperations}
                initialTab={initialDetailTab}
                initialEditProposalId={
                  initialDetailTab === "agreements" ? routeEditProposal : null
                }
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
        queueClients={overdueScopedClients}
        queueTotalCount={overdueScopedClients.length || queueTotalCount}
      />
      {attendancePickerOpen ? (
        <HadesClientPicker
          clients={sourceClients}
          onClose={() => setAttendancePickerOpen(false)}
          onSelect={(clientId) => {
            setAttendancePickerOpen(false);
            openAttendance(clientId);
          }}
        />
      ) : null}
      {attendanceClient ? (
        <HadesAttendanceModal
          client={attendanceClient}
          queueClients={sourceClients}
          onClose={() => setAttendanceClientId(null)}
          onCreated={() => {
            setAttendanceClientId(null);
            window.dispatchEvent(new CustomEvent("guardian:motor-changed"));
          }}
        />
      ) : null}
    </>
  );
}

function resolveHadesOperationalProfile(hubUser: HubUserContext | null) {
  const role = hubUser ? mapLegacyRoleToOperationalProfile(hubUser.role) : "op1";

  return {
    label: HADES_PROFILE_LABELS[role],
    role,
  };
}

function isClientInHadesProfileScope(
  client: QueueClient,
  profileRole: OperationalProfileRole,
) {
  const overdueDays = getOperationalOverdueDays(client);

  if (isHadesLeadershipProfile(profileRole)) {
    return isOperationalOverdueClient(client);
  }

  if (profileRole === "op1") {
    return overdueDays >= 1 && overdueDays <= 30;
  }

  if (profileRole === "op2") {
    return overdueDays >= 31 && overdueDays <= 60;
  }

  return overdueDays >= 61 && overdueDays <= 90;
}

function isHadesLeadershipProfile(profileRole: OperationalProfileRole) {
  return profileRole === "adm" || profileRole === "cdr" || profileRole === "ldr";
}

function isClientInOverdueRange(
  client: QueueClient,
  overdueRange: OverdueRangeFilter,
) {
  const overdueDays = getOperationalOverdueDays(client);

  if (overdueRange === "1-30") {
    return overdueDays >= 1 && overdueDays <= 30;
  }

  if (overdueRange === "31-60") {
    return overdueDays >= 31 && overdueDays <= 60;
  }

  if (overdueRange === "60+") {
    return overdueDays > 60;
  }

  return isOperationalOverdueClient(client);
}

function buildOverdueRangeCounts(clients: QueueClient[]) {
  return clients.reduce(
    (counts, client) => {
      if (!isOperationalOverdueClient(client)) {
        return counts;
      }

      const overdueDays = getOperationalOverdueDays(client);

      if (overdueDays >= 1 && overdueDays <= 30) {
        counts["1-30"] += 1;
      } else if (overdueDays >= 31 && overdueDays <= 60) {
        counts["31-60"] += 1;
      } else if (overdueDays > 60) {
        counts["60+"] += 1;
      }

      counts.all += 1;
      return counts;
    },
    { all: 0, "1-30": 0, "31-60": 0, "60+": 0 } as Record<
      OverdueRangeFilter,
      number
    >,
  );
}

function isDailyQueueClient(client: QueueClient) {
  const stage = normalizeDailyWorkflowStage(client.workflow.stage);
  const overdueDays = getOperationalOverdueDays(client);

  if (!isOperationalOverdueClient(client) || overdueDays < 3) {
    return false;
  }

  return stage !== "Promessa de pagamento" && stage !== "Acordo";
}

function isOperationalOverdueClient(client: QueueClient) {
  return (client.parcelas?.vencidas ?? 0) > 0;
}

function getOperationalOverdueDays(client: QueueClient) {
  const overdueDays = Number(client.atrasoDias) || 0;

  if (isOperationalOverdueClient(client) && overdueDays < 1) {
    return 1;
  }

  return overdueDays;
}

function isAgreementClient(client: QueueClient) {
  return (
    normalizeDailyWorkflowStage(client.workflow.stage) === "Acordo" ||
    client.commitments.some((commitment) => commitment.type === "Acordo")
  );
}

function AgreementsPanel({
  clients,
  selectedClientId,
  onSelectClient,
}: {
  clients: QueueClient[];
  selectedClientId: string;
  onSelectClient: (clientId: string) => void;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-[#d9e0e7] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="border-b border-[#edf1f5] px-5 py-4">
        <p className="text-[11px] font-semibold tracking-[0.18em] text-slate-400">
          Hades
        </p>
        <div className="mt-1 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-950">Acordos feitos</h2>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
            {clients.length}
          </span>
        </div>
      </div>

      <div className="max-h-[calc(100dvh-18rem)] overflow-y-auto p-3">
        {clients.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[#d9e0e7] px-4 py-8 text-center text-sm text-slate-500">
            Nenhum acordo feito encontrado na fila carregada.
          </div>
        ) : (
          <div className="space-y-2">
            {clients.map((client) => {
              const agreement = client.commitments.find((commitment) => commitment.type === "Acordo");
              const amount = agreement?.negotiatedValue ?? client.agreement?.negotiatedValue ?? client.saldoDevedor;
              const status = agreement?.status ?? client.agreement?.status ?? client.workflow.stage;
              const isActive = client.id === selectedClientId;

              return (
                <button
                  key={client.id}
                  type="button"
                  onClick={() => onSelectClient(client.id)}
                  className={`w-full rounded-lg border px-4 py-3 text-left transition focus:outline-none focus:ring-2 focus:ring-[#A07C3B]/25 ${
                    isActive
                      ? "border-[#A07C3B]/45 bg-[#FFF9EF]"
                      : "border-[#edf1f5] bg-white hover:border-[#d9e0e7] hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-950">
                        {client.nome}
                      </p>
                      <p className="mt-1 truncate text-xs text-slate-500">
                        {agreement?.enterprise ?? client.carteira.empreendimento}
                      </p>
                    </div>
                    <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-100">
                      {status}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-500">
                    <div>
                      <p className="font-semibold text-slate-900">{amount}</p>
                      <p>valor</p>
                    </div>
                    <div>
                      <p className="font-semibold text-slate-900">
                        {agreement?.installmentsCount ?? client.agreement?.installmentsCount ?? "-"}
                      </p>
                      <p>parcelas</p>
                    </div>
                    <div>
                      <p className="font-semibold text-slate-900">{client.atrasoDias}d</p>
                      <p>atraso</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

// Aplica a etapa derivada do motor num cliente da fila. Devolve a MESMA
// referencia quando nao ha mudanca (idempotente, evita loop de render). Carimba
// a transicao no historico como Auto - Hades.
function applyClientStage(
  client: QueueClient,
  stageByClient: Map<
    number,
    { nextAction: string; operator: string | null; stage: string }
  >,
): QueueClient {
  const match = String(client.id).match(/(\d+)/g);
  const clientC2xId = match ? Number(match[match.length - 1]) : null;
  const derived = clientC2xId ? stageByClient.get(clientC2xId) : null;

  if (!derived) {
    return client;
  }

  const stageChanged = derived.stage !== client.workflow.stage;
  // Operador que esta tratando = quem enviou a proposta mais recente. Cai pro
  // responsavel atual quando nao houver proposta.
  const responsavel =
    derived.operator && derived.operator !== "-"
      ? derived.operator
      : client.responsavel;
  const responsavelChanged = responsavel !== client.responsavel;

  if (!stageChanged && !responsavelChanged) {
    return client; // mesma referencia: idempotente (evita loop de render)
  }

  return {
    ...client,
    responsavel,
    workflow: stageChanged
      ? {
          ...client.workflow,
          stage: derived.stage as WorkflowStage,
          nextAction: derived.nextAction,
          history: [
            {
              changedAt: new Date().toLocaleString("pt-BR", {
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                month: "2-digit",
                year: "numeric",
              }),
              from: client.workflow.stage,
              id: `${client.id}-wf-auto-${derived.stage}`,
              operator: "Hades",
              origin: "auto",
              reason: derived.nextAction,
              to: derived.stage as WorkflowStage,
            },
            ...(client.workflow.history ?? []),
          ],
        }
      : client.workflow,
  };
}

// Casa o cliente do deep-link: por id exato OU pelo c2x id embutido no id da
// fila (o id da fila nao e o numero cru). Usado pelo "Abrir no cliente".
function findClientByRouteId(
  clients: QueueClient[],
  routeId: string | null,
): QueueClient | null {
  if (!routeId) {
    return null;
  }
  const direct = clients.find((client) => client.id === routeId);
  if (direct) {
    return direct;
  }
  const digits = String(routeId).match(/(\d+)/g);
  const wanted = digits ? Number(digits[digits.length - 1]) : NaN;
  if (!Number.isFinite(wanted)) {
    return null;
  }
  return (
    clients.find((client) => {
      const match = String(client.id).match(/(\d+)/g);
      return match ? Number(match[match.length - 1]) === wanted : false;
    }) ?? null
  );
}

function normalizeDailyWorkflowStage(stage: WorkflowStage): WorkflowStage {
  if (stage === "Promessa realizada" || stage === "Aguardando pagamento") {
    return "Promessa de pagamento";
  }

  if (stage === "Pago") {
    return "Acordo";
  }

  return stage;
}

function buildTodayContactClientIds(
  clients: QueueClient[],
  timelineEventsByClient: Record<string, OperationalTimelineEvent[]>,
  manualOperationsByClient: Record<string, ManualHadesOperations>,
) {
  const ids = new Set<string>();

  clients.forEach((client) => {
    const events = [
      ...(client.timeline ?? []),
      ...(client.workflow.history ?? []),
      ...(timelineEventsByClient[client.id] ?? []),
      ...(manualOperationsByClient[client.id]?.events ?? []),
    ];

    if (events.some((event) => hasTodayContactEvidence(event))) {
      ids.add(client.id);
    }
  });

  return ids;
}

function hasTodayContactEvidence(event: {
  changedAt?: string;
  createdAt?: string;
  date?: string;
  status?: string;
  type?: string;
  updatedAt?: string;
}) {
  const type = String(event.type ?? "").toLowerCase();
  const status = String(event.status ?? "").toLowerCase();
  const date =
    event.date ?? event.createdAt ?? event.updatedAt ?? event.changedAt ?? "";

  if (!isTodayDateLike(date)) {
    return false;
  }

  return (
    [
      "ligação realizada",
      "whatsapp enviado",
      "promessa de pagamento",
      "acordo gerado",
      "observação operacional",
    ].some((item) => type.includes(item)) ||
    ["realizado", "enviado", "prometido", "gerado", "registrado"].some(
      (item) => status.includes(item),
    )
  );
}

function isTodayDateLike(value: string) {
  if (!value) {
    return false;
  }

  const today = new Date();
  const day = String(today.getDate()).padStart(2, "0");
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const year = String(today.getFullYear());
  const normalized = String(value);

  if (normalized.includes(`${day}/${month}/${year}`)) {
    return true;
  }

  const parsed = new Date(normalized);

  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  return (
    parsed.getDate() === today.getDate() &&
    parsed.getMonth() === today.getMonth() &&
    parsed.getFullYear() === today.getFullYear()
  );
}

const HADES_PROFILE_LABELS: Record<OperationalProfileRole, string> = {
  adm: "Admin | visão total",
  cdr: "Coordenador | visão total",
  ldr: "Líder | visão total",
  op1: "OP1 | 1 a 30 dias",
  op2: "OP2 | 31 a 60 dias",
  op3: "OP3 | 61 a 90 dias",
};

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




