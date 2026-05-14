"use client";

import { useMemo, useState } from "react";
import { Inbox, MapPinned, MessageCircle } from "lucide-react";
import { ClientDetailPanel } from "@/modules/attendance/components/ClientDetailPanel";
import { AiCopilotDrawer } from "@/modules/attendance/components/AiCopilotDrawer";
import { QueuePanel } from "@/modules/attendance/components/QueuePanel";
import { WhatsAppConversationPanel } from "@/modules/attendance/components/WhatsAppConversationPanel";
import { DeskPage } from "@/modules/attendance/DeskPage";
import { queueClients } from "@/modules/attendance/data";
import type {
  AttendancePriority,
  OperationalTimelineEvent,
  WorkflowStage,
} from "@/modules/attendance/types";

const priorities: Array<AttendancePriority | "Todos"> = [
  "Todos",
  "Crítica",
  "Alta",
  "Média",
  "Baixa",
];

type AttendanceSection = "queue" | "desk" | "portfolio";

const attendanceSections: Array<{ id: AttendanceSection; label: string; badge?: string; icon: typeof Inbox }> = [
  { id: "queue", label: "Fila operacional", icon: Inbox },
  { id: "desk", label: "Desk", badge: "3", icon: MessageCircle },
  { id: "portfolio", label: "Carteira", icon: MapPinned },
];

export function AttendancePage() {
  const [selectedId, setSelectedId] = useState(queueClients[0]?.id ?? "");
  const [activeSection, setActiveSection] = useState<AttendanceSection>("queue");
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState<AttendancePriority | "Todos">("Todos");
  const [stage, setStage] = useState<WorkflowStage | "Todas">("Todas");
  const [whatsAppClientId, setWhatsAppClientId] = useState<string | null>(null);
  const [timelineEventsByClient, setTimelineEventsByClient] = useState<
    Record<string, OperationalTimelineEvent[]>
  >({});

  const searchableClients = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return queueClients.filter((client) => {
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

      const matchesPriority = priority === "Todos" || client.prioridade === priority;

      return matchesSearch && matchesPriority;
    });
  }, [priority, search]);

  const filteredClients = useMemo(() => {
    return searchableClients.filter((client) => stage === "Todas" || client.workflow.stage === stage);
  }, [searchableClients, stage]);

  const selectedClient =
    queueClients.find((client) => client.id === selectedId) ??
    filteredClients[0] ??
    queueClients[0];
  const whatsAppClient = whatsAppClientId
    ? queueClients.find((client) => client.id === whatsAppClientId) ?? selectedClient
    : selectedClient;

  function openWhatsApp(clientId = selectedClient.id) {
    setSelectedId(clientId);
    setWhatsAppClientId(clientId);
  }

  function addTimelineEvent(clientId: string, event: OperationalTimelineEvent) {
    setTimelineEventsByClient((current) => ({
      ...current,
      [clientId]: [event, ...(current[clientId] ?? [])],
    }));
  }

  return (
    <>
      {whatsAppClientId ? (
        <WhatsAppConversationPanel
          key={whatsAppClient.id}
          client={whatsAppClient}
          onClose={() => setWhatsAppClientId(null)}
          onTimelineEvent={addTimelineEvent}
          open={Boolean(whatsAppClientId)}
        />
      ) : (
        <div className="space-y-5">
          <nav className="flex w-fit gap-1 overflow-x-auto rounded-xl border border-slate-200/70 bg-white p-1 shadow-[0_1px_2px_rgba(15,23,42,0.04)]" aria-label="Módulos de atendimento">
            {attendanceSections.map((section) => {
              const Icon = section.icon;
              const active = activeSection === section.id;

              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setActiveSection(section.id)}
                  title={section.label}
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
              );
            })}
          </nav>

          {activeSection === "desk" ? (
            <DeskPage embedded />
          ) : (
            <div className="grid w-full items-start gap-5 xl:grid-cols-[400px_minmax(0,1fr)]">
              <QueuePanel
                clients={filteredClients}
                summaryClients={searchableClients}
                priorities={priorities}
                search={search}
                selectedClientId={selectedClient.id}
                selectedPriority={priority}
                selectedStage={stage}
                onPriorityChange={setPriority}
                onOpenWhatsApp={(clientId) => openWhatsApp(clientId)}
                onSearchChange={setSearch}
                onStageChange={setStage}
                onSelectClient={setSelectedId}
              />
              <ClientDetailPanel
                key={selectedClient.id}
                client={selectedClient}
                extraTimelineEvents={timelineEventsByClient[selectedClient.id] ?? []}
                onOpenWhatsApp={() => openWhatsApp(selectedClient.id)}
              />
            </div>
          )}
        </div>
      )}
      <AiCopilotDrawer client={selectedClient} />
    </>
  );
}
