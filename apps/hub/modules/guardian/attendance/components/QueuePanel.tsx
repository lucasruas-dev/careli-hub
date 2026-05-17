/* eslint-disable */
// @ts-nocheck
"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Filter, Search, X } from "lucide-react";
import { Tooltip } from "@repo/uix";
import { ClientQueueCard } from "@/modules/guardian/attendance/components/ClientQueueCard";
import { workflowStageDots, workflowStages, workflowStageStyles } from "@/modules/guardian/attendance/workflow";
import type { AttendancePriority, QueueClient, WorkflowStage } from "@/modules/guardian/attendance/types";

type QueuePanelProps = {
  clients: QueueClient[];
  enterprises: string[];
  summaryClients: QueueClient[];
  priorities: Array<AttendancePriority | "Todos">;
  search: string;
  selectedEnterprise: string;
  selectedClientId: string;
  selectedPriority: AttendancePriority | "Todos";
  selectedStage: WorkflowStage | "Todas";
  onEnterpriseChange: (enterprise: string) => void;
  onPriorityChange: (priority: AttendancePriority | "Todos") => void;
  onOpenWhatsApp: (clientId: string) => void;
  onSearchChange: (search: string) => void;
  onStageChange: (stage: WorkflowStage | "Todas") => void;
  onSelectClient: (id: string) => void;
};

export function QueuePanel({
  clients,
  enterprises,
  summaryClients,
  priorities,
  search,
  selectedEnterprise,
  selectedClientId,
  selectedPriority,
  selectedStage,
  onEnterpriseChange,
  onPriorityChange,
  onOpenWhatsApp,
  onSearchChange,
  onStageChange,
  onSelectClient,
}: QueuePanelProps) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [distributionOpen, setDistributionOpen] = useState(false);
  const stageCounts = workflowStages.map((stage) => ({
    stage,
    count: summaryClients.filter((client) => client.workflow.stage === stage).length,
  }));
  const activeStages = stageCounts.filter((item) => item.count > 0);
  const total = Math.max(summaryClients.length, 1);
  const activeFilters = [
    selectedEnterprise !== "Todos" ? { label: "Empreendimento", value: selectedEnterprise, clear: () => onEnterpriseChange("Todos") } : null,
    selectedPriority !== "Todos" ? { label: "Prioridade", value: selectedPriority, clear: () => onPriorityChange("Todos") } : null,
    selectedStage !== "Todas" ? { label: "Workflow", value: selectedStage, clear: () => onStageChange("Todas") } : null,
  ].filter(Boolean) as Array<{ label: string; value: string; clear: () => void }>;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const stored = window.localStorage.getItem("guardian-attendance-filters-expanded");
      if (stored) setFiltersOpen(stored === "true");
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  function toggleFilters() {
    setFiltersOpen((current) => {
      const next = !current;
      window.localStorage.setItem("guardian-attendance-filters-expanded", String(next));
      return next;
    });
  }

  function clearFilters() {
    onEnterpriseChange("Todos");
    onPriorityChange("Todos");
    onStageChange("Todas");
  }

  return (
    <section className="flex min-h-0 rounded-xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] xl:sticky xl:top-20 xl:h-[calc(100vh-112px)]">
      <div className="flex min-h-0 w-full flex-col">
        <div className="shrink-0 border-b border-slate-100 px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-base font-semibold text-slate-950">Fila operacional</h1>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2 rounded-xl border border-slate-200/70 bg-slate-50/80 px-3 py-2 text-slate-500">
            <Search className="size-4 shrink-0" aria-hidden="true" />
            <input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Buscar cliente, CPF, lote ou responsável"
              className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={toggleFilters}
              aria-expanded={filtersOpen}
              className="inline-flex h-8 items-center gap-2 rounded-lg border border-slate-200/70 bg-white px-2.5 text-xs font-semibold text-slate-600 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-slate-950"
            >
              <Filter className="size-3.5 text-[#A07C3B]" aria-hidden="true" />
              Filtros{activeFilters.length > 0 ? ` (${activeFilters.length})` : ""}
              <ChevronDown className={`size-3.5 text-[#A07C3B] transition-transform ${filtersOpen ? "rotate-180" : ""}`} aria-hidden="true" />
            </button>
            <span className="text-xs font-medium text-slate-500">{clients.length} na fila</span>
            {activeFilters.map((filter) => (
              <Tooltip key={`${filter.label}-${filter.value}`} content={`Remover ${filter.label}`} placement="top">
                <button
                  type="button"
                  onClick={filter.clear}
                  className="inline-flex h-7 max-w-40 items-center gap-1 rounded-full bg-[#A07C3B]/5 px-2 text-[11px] font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15"
                >
                  <span className="truncate">{filter.value}</span>
                  <span aria-hidden="true">×</span>
                </button>
              </Tooltip>
            ))}
            {activeFilters.length > 0 ? (
              <Tooltip content="Limpar filtros" placement="bottom">
                <button
                  type="button"
                  onClick={clearFilters}
                  aria-label="Limpar filtros"
                  className="flex size-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:border-[#A07C3B]/30 hover:bg-[#A07C3B]/5 hover:text-[#7A5E2C]"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </Tooltip>
            ) : null}
          </div>

          <div className={`grid transition-all duration-300 ease-out ${filtersOpen ? "mt-3 grid-rows-[1fr] opacity-100" : "mt-0 grid-rows-[0fr] opacity-0"}`}>
            <div className="min-h-0 overflow-hidden">
              <label className="mb-3 block">
                <span className="text-xs font-semibold uppercase tracking-normal text-slate-400">
                  Empreendimento
                </span>
                <select
                  value={selectedEnterprise}
                  onChange={(event) => onEnterpriseChange(event.target.value)}
                  className="mt-1 h-9 w-full rounded-lg border border-slate-200/70 bg-white px-3 text-sm font-medium text-slate-700 outline-none transition-colors hover:bg-slate-50"
                >
                  {enterprises.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex gap-2 overflow-x-auto pb-1">
                {priorities.map((item) => (
                  <Tooltip key={item} content={`Prioridade: ${item}`} placement="top">
                    <button
                      type="button"
                      onClick={() => onPriorityChange(item)}
                      aria-label={`Prioridade: ${item}`}
                      className={`inline-flex h-8 shrink-0 items-center justify-center rounded-full px-2.5 text-xs font-semibold transition-colors ${
                        selectedPriority === item
                          ? "border border-[#A07C3B]/20 bg-[#A07C3B]/8 text-[#7A5E2C]"
                          : "border border-slate-200/70 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {item}
                    </button>
                  </Tooltip>
                ))}
              </div>

              <div className="mt-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-normal text-slate-400">
                    Workflow operacional
                  </p>
                  <span className="text-xs font-medium text-slate-500">{clients.length} na etapa</span>
                </div>

                <div className="flex gap-2 overflow-x-auto pb-1">
                  <StageFilterButton
                    active={selectedStage === "Todas"}
                    label="Todas"
                    count={summaryClients.length}
                    onClick={() => onStageChange("Todas")}
                  />
                  {workflowStages.map((stage) => (
                    <StageFilterButton
                      key={stage}
                      active={selectedStage === stage}
                      label={stage}
                      count={stageCounts.find((item) => item.stage === stage)?.count ?? 0}
                      className={workflowStageStyles[stage]}
                      onClick={() => onStageChange(stage)}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3">
            <button
              type="button"
              onClick={() => setDistributionOpen((current) => !current)}
              aria-expanded={distributionOpen}
              className="inline-flex h-8 items-center gap-2 rounded-lg border border-slate-200/70 bg-white px-3 text-xs font-semibold text-slate-600 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-slate-950"
            >
              {distributionOpen ? "Ocultar distribuição" : "Exibir distribuição"}
              <ChevronDown
                className={`size-3.5 text-[#A07C3B] transition-transform duration-300 ${
                  distributionOpen ? "rotate-180" : ""
                }`}
                aria-hidden="true"
              />
            </button>

            <div
              className={`grid transition-[grid-template-rows,opacity,margin] duration-300 ease-out ${
                distributionOpen
                  ? "mt-3 grid-rows-[1fr] opacity-100"
                  : "mt-0 grid-rows-[0fr] opacity-0"
              }`}
            >
              <div className="min-h-0 overflow-hidden">
                <div className="rounded-xl border border-slate-200/70 bg-slate-50/70 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-semibold text-slate-700">
                      Distribuição operacional
                    </p>
                    <span className="text-xs text-slate-500">{summaryClients.length} clientes</span>
                  </div>
                  <div className="flex h-2 overflow-hidden rounded-full bg-white ring-1 ring-slate-200/70">
                    {activeStages.map((item) => (
                      <div
                        key={item.stage}
                        className={workflowStageDots[item.stage]}
                        style={{ width: `${(item.count / total) * 100}%` }}
                      />
                    ))}
                  </div>
                  <div className="mt-3 grid gap-2">
                    {activeStages.slice(0, 4).map((item) => (
                      <div
                        key={item.stage}
                        className="flex items-center justify-between gap-3 text-xs"
                      >
                        <span className="flex min-w-0 items-center gap-2 text-slate-600">
                          <span
                            className={`size-2 shrink-0 rounded-full ${
                              workflowStageDots[item.stage]
                            }`}
                          />
                          <span className="truncate">{item.stage}</span>
                        </span>
                        <span className="font-semibold text-slate-900">{item.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {clients.map((client) => (
            <ClientQueueCard
              key={client.id}
              client={client}
              selected={client.id === selectedClientId}
              onOpenWhatsApp={() => onOpenWhatsApp(client.id)}
              onSelect={() => onSelectClient(client.id)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function StageFilterButton({
  active,
  label,
  count,
  className = "bg-white text-slate-600 ring-slate-200",
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  className?: string;
  onClick: () => void;
}) {
  return (
    <Tooltip content={`${label}: ${count}`} placement="top">
      <button
        type="button"
        onClick={onClick}
        aria-label={`${label}: ${count}`}
        className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold ring-1 ring-inset transition-colors ${
          active ? "border border-[#A07C3B]/20 bg-[#A07C3B]/8 text-[#7A5E2C]" : className
        }`}
      >
        <span>{label}</span>
        <span className="rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] text-slate-500 ring-1 ring-slate-200/70">
          {count}
        </span>
      </button>
    </Tooltip>
  );
}




