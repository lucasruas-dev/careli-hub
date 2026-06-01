"use client";

import { useState } from "react";
import {
  Bot,
  CalendarCheck,
  Clock3,
  FileText,
  LockKeyhole,
  MessageCircle,
  PanelRightClose,
  Sparkles,
} from "lucide-react";
import { Tooltip } from "@repo/uix";
import { HadesWhatsAppContextItem } from "@/modules/guardian/attendance/components/hades-whatsapp-fields";
import { HadesWhatsAppOperationalToolbar } from "@/modules/guardian/attendance/components/hades-whatsapp-operational-toolbar";
import { HadesWhatsAppTicketChecklist } from "@/modules/guardian/attendance/components/hades-whatsapp-ticket-checklist";
import type { TicketCycle } from "@/modules/guardian/attendance/hades-whatsapp-thread";
import type {
  ContextTab,
  OperationDrawerMode,
  TicketChecklistItem,
  WhatsAppTicket,
} from "@/modules/guardian/attendance/hades-whatsapp-types";
import type {
  PortfolioUnit,
  QueueClient,
} from "@/modules/guardian/attendance/types";

type HadesWhatsAppClientContextPanelProps = {
  client: QueueClient;
  onCollapse: () => void;
  onCompleteTicket: () => void;
  onOpenOperation: (mode: OperationDrawerMode) => void;
  onSelectUnit: (unitId: string) => void;
  onUseTemplate: () => void;
  operationReady: boolean;
  previousTickets: TicketCycle[];
  selectedUnit?: PortfolioUnit;
  selectedUnitId?: string;
  ticket: WhatsAppTicket;
  ticketChecklist: TicketChecklistItem[];
  ticketIncomplete: boolean;
};

export function HadesWhatsAppClientContextPanel({
  client,
  onCollapse,
  onCompleteTicket,
  onOpenOperation,
  onSelectUnit,
  onUseTemplate,
  operationReady,
  previousTickets,
  selectedUnit,
  selectedUnitId,
  ticket,
  ticketChecklist,
  ticketIncomplete,
}: HadesWhatsAppClientContextPanelProps) {
  const [activeTab, setActiveTab] = useState<ContextTab>("info");
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const visibleTickets = historyExpanded ? previousTickets : previousTickets.slice(-2);
  const contextTabs: { id: ContextTab; label: string; icon: typeof MessageCircle }[] = [
    { id: "info", label: "Informações", icon: FileText },
    { id: "actions", label: "Ações", icon: CalendarCheck },
    { id: "ai", label: "IA", icon: Bot },
    { id: "history", label: "Histórico", icon: Clock3 },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-100 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">Contexto</p>
            <h3 className="mt-1 truncate text-sm font-semibold text-slate-950">{client.nome}</h3>
            <p className="mt-0.5 text-xs text-slate-500">{client.dados360.telefone}</p>
          </div>
          <Tooltip content="Recolher contexto" placement="bottom">
            <button
              type="button"
              onClick={onCollapse}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-50 hover:text-[#7A5E2C]"
              aria-label="Recolher contexto"
            >
              <PanelRightClose className="size-4" aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
        <div className="mt-3 flex gap-1 overflow-x-auto rounded-lg bg-slate-100/70 p-1 [scrollbar-width:none]">
          {contextTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <Tooltip key={tab.id} content={tab.label} placement="bottom">
                <button
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  aria-label={tab.label}
                  className={`flex size-8 shrink-0 items-center justify-center rounded-md transition-colors ${
                    activeTab === tab.id ? "bg-white text-[#7A5E2C] shadow-sm" : "text-slate-500 hover:bg-white/70"
                  }`}
                >
                  <Icon className="size-4" aria-hidden="true" />
                </button>
              </Tooltip>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
        {activeTab === "info" ? (
          <div className="space-y-3">
            <div className="grid gap-2">
              <HadesWhatsAppContextItem label="Cliente" value={client.nome} />
              <HadesWhatsAppContextItem label="Telefone" value={client.dados360.telefone} />
              <HadesWhatsAppContextItem label="Saldo em atraso" value={client.saldoDevedor} />
              <HadesWhatsAppContextItem label="Workflow" value={client.workflow.stage} />
              <HadesWhatsAppContextItem label="Operador" value={client.responsavel} />
              <HadesWhatsAppContextItem label="Protocolo" value={ticket.protocol} />
              <HadesWhatsAppContextItem label="Assunto" value={ticket.profileName} />
              <HadesWhatsAppContextItem label="SLA" value={ticket.slaHours > 0 ? `${ticket.slaHours}h · Atenção` : "Sem SLA"} />
              <HadesWhatsAppContextItem label="Prioridade" value={ticket.priority} />
              <HadesWhatsAppContextItem label="Origem" value={ticket.origin} />
              <HadesWhatsAppContextItem label="Unidade vinculada" value={selectedUnit?.matricula ?? "-"} />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-normal text-slate-400">Unidades</p>
              {client.carteira.unidades.map((unit) => {
                const active = selectedUnitId === unit.id;

                return (
                  <button
                    key={unit.id}
                    type="button"
                    onClick={() => onSelectUnit(unit.id)}
                    className={`w-full rounded-xl border px-3 py-2 text-left transition-colors ${
                      active
                        ? "border-[#A07C3B]/30 bg-white text-slate-950 shadow-sm"
                        : "border-slate-200/70 bg-slate-50/70 text-slate-700 hover:border-[#A07C3B]/25 hover:bg-white"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <p className="truncate text-xs font-semibold text-[#7A5E2C]">Cod. {unit.matricula}</p>
                        <p className="truncate text-sm font-semibold">{unit.empreendimento}</p>
                        <p className="text-xs text-slate-500">Quadra {unit.quadra} · Lote {unit.lote}</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-500 ring-1 ring-slate-200/70">
                        {unit.unidadeLote}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {activeTab === "actions" ? (
          <div className="space-y-3">
            {!operationReady ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-amber-800">
                  <LockKeyhole className="size-3.5" aria-hidden="true" />
                  <span>Complete o ticket para operar</span>
                </div>
                <HadesWhatsAppTicketChecklist items={ticketChecklist} className="mt-2" />
              </div>
            ) : null}
            {ticketIncomplete ? (
              <Tooltip
                content="Completar assunto, unidade e parcelas vencidas do ticket autoaberto."
                placement="top"
                className="w-full"
                triggerClassName="w-full"
              >
                <button
                  type="button"
                  onClick={onCompleteTicket}
                  className="inline-flex h-9 w-full items-center justify-center rounded-lg bg-[#A07C3B] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#8E6F35]"
                >
                  Completar ticket
                </button>
              </Tooltip>
            ) : null}
            <HadesWhatsAppOperationalToolbar
              disabled={!operationReady}
              disabledTooltip="Complete o ticket para iniciar o atendimento."
              onOpenOperation={onOpenOperation}
              onUseTemplate={onUseTemplate}
              vertical
            />
          </div>
        ) : null}

        {activeTab === "ai" ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-[#A07C3B]/15 bg-[#A07C3B]/5 p-4">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-[#A07C3B]" aria-hidden="true" />
                <p className="text-sm font-semibold text-slate-950">IA da conversa</p>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-700">
                Cliente demonstra abertura para composição. Recomenda confirmar valor possível, registrar promessa
                com data curta ou formalizar acordo com entrada acessível.
              </p>
            </div>
            <div className="rounded-xl border border-slate-200/70 bg-slate-50/70 p-4">
              <div className="flex items-center gap-2">
                <Bot className="size-4 text-[#A07C3B]" aria-hidden="true" />
                <p className="text-sm font-semibold text-slate-950">Resumo IA</p>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Histórico recente: cobrança amigável enviada, cliente pediu boleto C2X e sinalizou pagamento parcial.
              </p>
            </div>
            <HadesWhatsAppContextItem label="Próxima ação sugerida" value={client.aiSuggestion} />
          </div>
        ) : null}

        {activeTab === "history" ? (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setHistoryExpanded((current) => !current)}
              className="inline-flex h-9 w-full items-center justify-center rounded-lg border border-slate-200/70 bg-white px-3 text-xs font-semibold text-slate-600 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-slate-950"
            >
              {historyExpanded ? "Ocultar tickets anteriores" : `Ver tickets anteriores (${previousTickets.length})`}
            </button>
            {historyExpanded ? (
              <p className="text-center text-[11px] font-medium text-slate-400">Histórico completo preparado para versão futura</p>
            ) : null}
            <div className="space-y-2">
              {visibleTickets.map((cycle) => (
                <div key={cycle.protocol} className="rounded-lg border border-slate-200/70 bg-slate-50/70 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-mono text-xs font-semibold text-[#7A5E2C]">{cycle.protocol}</p>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-500 ring-1 ring-slate-200/70">
                      {cycle.status}
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-slate-950">{cycle.profileName}</p>
                  <p className="mt-1 text-xs text-slate-500">{cycle.openedAt} · {cycle.operator}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
