/* eslint-disable */
// @ts-nocheck
"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BadgePercent,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Edit3,
  Filter,
  HandCoins,
  Plus,
  RefreshCw,
  Sparkles,
  TrendingUp,
  X,
  XCircle,
} from "lucide-react";
import { Tooltip } from "@repo/uix";
import { agreementRiskStyles, agreementStatusStyles } from "@/modules/guardian/attendance/agreements";
import { DetailSection } from "@/modules/guardian/attendance/components/DetailSection";
import type {
  CommitmentType,
  PaymentPromiseStatus,
  PortfolioUnit,
  QueueClient,
} from "@/modules/guardian/attendance/types";

type Commitment = QueueClient["commitments"][number];
type CommitmentDrawerMode = "Nova promessa" | "Novo acordo" | "Editar compromisso";
type EditableCommitment = {
  note: string;
  operator: string;
  primaryDate: string;
  primaryValue: string;
};

type AgreementsCenterCardProps = {
  client: QueueClient;
  onCreateCommitment?: (record: QueueClient["commitments"][number]) => Promise<void>;
  onUpdateCommitment?: (record: QueueClient["commitments"][number]) => Promise<void>;
  unit?: PortfolioUnit;
};

const promiseStatusStyles: Record<PaymentPromiseStatus, string> = {
  "Promessa realizada": "bg-[#A07C3B]/8 text-[#7A5E2C] ring-[#A07C3B]/15",
  "Aguardando pagamento": "bg-indigo-50 text-indigo-700 ring-indigo-100",
  Cumprida: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  Quebrada: "bg-rose-50 text-rose-700 ring-rose-100",
  Reagendada: "bg-amber-50 text-amber-700 ring-amber-100",
  Cancelada: "bg-zinc-100 text-zinc-700 ring-zinc-200",
};

const typeStyles: Record<CommitmentType, string> = {
  "Promessa de pagamento": "bg-slate-50 text-slate-700 ring-slate-200",
  Acordo: "bg-[#A07C3B]/8 text-[#7A5E2C] ring-[#A07C3B]/15",
};

export function AgreementsCenterCard({
  client,
  onCreateCommitment,
  onUpdateCommitment,
  unit,
}: AgreementsCenterCardProps) {
  const [records, setRecords] = useState(client.commitments);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<"Todos" | CommitmentType>("Todos");
  const [statusFilter, setStatusFilter] = useState("Todos");
  const [operatorFilter, setOperatorFilter] = useState("Todos");
  const [unitFilter, setUnitFilter] = useState(unit?.matricula ?? "Todas");
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [drawer, setDrawer] = useState<{
    mode: CommitmentDrawerMode;
    record?: Commitment;
  } | null>(null);

  const filteredRecords = useMemo(() => {
    return records.filter((record) => {
      const unitMatch = unit ? record.unitCode === unit.matricula : unitFilter === "Todas" || record.unitCode === unitFilter;
      const typeMatch = typeFilter === "Todos" || record.type === typeFilter;
      const statusMatch = statusFilter === "Todos" || record.status === statusFilter;
      const operatorMatch = operatorFilter === "Todos" || record.operator === operatorFilter;

      return unitMatch && typeMatch && statusMatch && operatorMatch;
    });
  }, [operatorFilter, records, statusFilter, typeFilter, unit, unitFilter]);

  const summary = buildCommitmentSummary(filteredRecords);
  const operators = unique(records.map((record) => record.operator));
  const statuses = unique(records.map((record) => record.status));
  const activeFilters = [
    typeFilter !== "Todos" ? { label: "Tipo", value: typeFilter, clear: () => setTypeFilter("Todos") } : null,
    statusFilter !== "Todos" ? { label: "Status", value: statusFilter, clear: () => setStatusFilter("Todos") } : null,
    operatorFilter !== "Todos" ? { label: "Operador", value: operatorFilter, clear: () => setOperatorFilter("Todos") } : null,
    !unit && unitFilter !== "Todas" ? { label: "Unidade", value: unitFilter, clear: () => setUnitFilter("Todas") } : null,
  ].filter(Boolean) as Array<{ label: string; value: string; clear: () => void }>;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const stored = window.localStorage.getItem("guardian-agreements-filters-expanded");
      if (stored) setFiltersExpanded(stored === "true");
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    setRecords(client.commitments);
  }, [client.commitments]);

  function toggleFilters() {
    setFiltersExpanded((current) => {
      const next = !current;
      window.localStorage.setItem("guardian-agreements-filters-expanded", String(next));
      return next;
    });
  }

  async function persistCreatedCommitment(record: Commitment) {
    if (!onCreateCommitment) {
      return;
    }

    try {
      await onCreateCommitment(record);
      setFeedback("Compromisso salvo no histórico operacional.");
    } catch (error) {
      console.error("[guardian-agreements] commitment save failed", error);
      setFeedback("Nao foi possivel salvar o compromisso agora.");
    }
  }

  async function persistUpdatedCommitment(record: Commitment) {
    if (!onUpdateCommitment) {
      return;
    }

    try {
      await onUpdateCommitment(record);
      setFeedback("Compromisso atualizado no histórico operacional.");
    } catch (error) {
      console.error("[guardian-agreements] commitment update failed", error);
      setFeedback("Nao foi possivel atualizar o compromisso agora.");
    }
  }

  function addMockRecord(
    mode: Exclude<CommitmentDrawerMode, "Editar compromisso">,
    draft?: EditableCommitment,
  ) {
    const baseUnit = unit ?? client.carteira.unidades[0];
    const now = nowForDisplay();
    const operator = draft?.operator || client.responsavel;

    if (mode === "Nova promessa") {
      const record: Commitment = {
        id: `${client.id}-promise-${Date.now()}`,
        type: "Promessa de pagamento",
        client: client.nome,
        enterprise: baseUnit.empreendimento,
        unitCode: baseUnit.matricula,
        unitLabel: `${baseUnit.unidadeLote} · ${baseUnit.area}`,
        relatedInstallments: "04/60, 05/60",
        promisedValue: draft?.primaryValue || client.parcelas.ultimaParcela,
        promisedDate: draft?.primaryDate || nowShortDate(),
        contactChannel: "WhatsApp",
        operator,
        note: draft?.note || "Promessa criada manualmente pelo operador.",
        protocol: guardianProtocol(records.length + 101),
        status: "Promessa realizada",
        history: [
          {
            id: `${client.id}-promise-${Date.now()}-history`,
            protocol: guardianProtocol(records.length + 102),
            action: "Promessa criada",
            occurredAt: now,
            operator,
            description: draft?.note || "Registro manual de promessa no Guardian.",
          },
        ],
      };

      setRecords((current) => [record, ...current]);
      setDrawer({ mode: "Editar compromisso", record });
      void persistCreatedCommitment(record);
      return;
    }

    const firstDue = client.agreement.dueDates.find((dueDate) => dueDate.label !== "Entrada");
    const record: Commitment = {
      id: `${client.id}-agreement-${Date.now()}`,
      type: "Acordo",
      client: client.nome,
      enterprise: baseUnit.empreendimento,
      unitCode: baseUnit.matricula,
      unitLabel: `${baseUnit.unidadeLote} · ${baseUnit.area}`,
      includedInstallments: "03/60, 04/60, 05/60",
      originalValue: client.agreement.originalDebt,
      discount: client.agreement.discount,
      negotiatedValue: draft?.primaryValue || client.agreement.negotiatedValue,
      entry: client.agreement.entry,
      entryDueDate: draft?.primaryDate || nowShortDate(),
      installmentsCount: client.agreement.installmentsCount,
      installmentValue: firstDue?.amount ?? client.parcelas.ultimaParcela,
      firstDueDate: firstDue?.dueDate ?? "10/06/2026",
      operator,
      note: draft?.note || client.agreement.aiSuggestion.composition,
      protocol: guardianProtocol(records.length + 201),
      status: "Em negociação",
      risk: client.agreement.risk,
      history: [
        {
          id: `${client.id}-agreement-${Date.now()}-history`,
          protocol: guardianProtocol(records.length + 202),
          action: "Acordo criado",
          occurredAt: now,
          operator,
          description: draft?.note || "Registro manual de acordo no Guardian.",
        },
      ],
    };

    setRecords((current) => [record, ...current]);
    setDrawer({ mode: "Editar compromisso", record });
    void persistCreatedCommitment(record);
  }

  function updateStatus(record: Commitment, status: Commitment["status"], action: string) {
    const updatedRecord = {
      ...record,
      status,
      history: [
        {
          id: `${record.id}-${record.history.length + 1}`,
          protocol: guardianProtocol(record.history.length + 301),
          action,
          occurredAt: nowForDisplay(),
          operator: client.responsavel,
          description: `${action} registrada na Central de Compromissos para integração com Timeline e Workflow.`,
        },
        ...record.history,
      ],
    } as Commitment;

    setRecords((current) => current.map((item) => (item.id === record.id ? updatedRecord : item)));
    setDrawer((current) => (current?.record?.id === record.id ? { ...current, record: updatedRecord } : current));
    void persistUpdatedCommitment(updatedRecord);
  }

  function updateRecord(record: Commitment, draft: EditableCommitment) {
    const updatedRecord = {
      ...record,
      note: draft.note,
      operator: draft.operator,
      ...(record.type === "Promessa de pagamento"
        ? {
            promisedDate: draft.primaryDate,
            promisedValue: draft.primaryValue,
          }
        : {
            entryDueDate: draft.primaryDate,
            negotiatedValue: draft.primaryValue,
          }),
      history: [
        {
          id: `${record.id}-edit-${record.history.length + 1}`,
          protocol: guardianProtocol(record.history.length + 401),
          action: "Edição registrada",
          occurredAt: nowForDisplay(),
          operator: draft.operator,
          description: "Compromisso atualizado com trilha auditável para Timeline operacional.",
        },
        ...record.history,
      ],
    } as Commitment;

    setRecords((current) => current.map((item) => (item.id === record.id ? updatedRecord : item)));
    setDrawer((current) => (current?.record?.id === record.id ? { ...current, record: updatedRecord } : current));
    void persistUpdatedCommitment(updatedRecord);
  }

  return (
    <DetailSection title="Central Operacional de Acordos e Promessas" icon={HandCoins} accent>
      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[#A07C3B]/8 px-2.5 py-1 text-xs font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
              Promessas e acordos
            </span>
            {unit ? (
              <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
                Cod. unidade {unit.matricula}
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-sm font-semibold text-slate-950">{client.nome}</p>
          <p className="mt-1 text-xs text-slate-500">
            Histórico operacional de acordos e promessas com trilha auditável de status e alterações.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Tooltip content="Nova promessa" placement="bottom">
            <button
              type="button"
              onClick={() => setDrawer({ mode: "Nova promessa" })}
              aria-label="Nova promessa"
              className="inline-flex size-9 items-center justify-center rounded-lg border border-[#A07C3B]/20 bg-[#A07C3B]/5 text-[#7A5E2C] transition-colors hover:bg-[#A07C3B]/10"
            >
              <Plus className="size-4" aria-hidden="true" />
            </button>
          </Tooltip>
          <Tooltip content="Novo acordo" placement="bottom">
            <button
              type="button"
              onClick={() => setDrawer({ mode: "Novo acordo" })}
              aria-label="Novo acordo"
              className="inline-flex size-9 items-center justify-center rounded-lg bg-[#A07C3B] text-white shadow-[0_8px_18px_rgba(160,124,59,0.22)] transition-colors hover:bg-[#8E6F35]"
            >
              <Plus className="size-4" aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
      </div>

      {feedback ? (
        <div className="mb-3 rounded-lg border border-[#A07C3B]/15 bg-[#A07C3B]/5 px-3 py-2 text-xs font-semibold text-[#7A5E2C]">
          {feedback}
        </div>
      ) : null}

      <div className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
        <MetricCard label="Promessas abertas" value={`${summary.openPromises}`} tone="gold" />
        <MetricCard label="Promessas cumpridas" value={`${summary.fulfilledPromises}`} />
        <MetricCard label="Promessas quebradas" value={`${summary.brokenPromises}`} tone="danger" />
        <MetricCard label="Acordos ativos" value={`${summary.activeAgreements}`} tone="gold" />
        <MetricCard label="Taxa de cumprimento" value={`${summary.fulfillmentRate}%`} />
        <MetricCard label="Valor prometido" value={formatMoney(summary.promisedValue)} tone="gold" />
      </div>

      <div className="mb-4 grid gap-3 rounded-xl border border-slate-200/70 bg-slate-50/60 p-3 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={toggleFilters} className="inline-flex h-8 items-center gap-2 rounded-lg border border-slate-200/70 bg-white px-2.5 text-xs font-semibold text-slate-600 hover:bg-[#A07C3B]/5" aria-expanded={filtersExpanded}>
              <Filter className="size-3.5 text-[#A07C3B]" aria-hidden="true" />
              Filtros{activeFilters.length > 0 ? ` (${activeFilters.length})` : ""}
              <ChevronDown className={`size-3.5 text-[#A07C3B] transition-transform ${filtersExpanded ? "rotate-180" : ""}`} aria-hidden="true" />
            </button>
            {activeFilters.map((filter) => (
              <Tooltip key={`${filter.label}-${filter.value}`} content={`Remover ${filter.label}`} placement="top">
                <button type="button" onClick={filter.clear} className="inline-flex h-7 max-w-44 items-center gap-1 rounded-full bg-[#A07C3B]/5 px-2 text-[11px] font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
                  <span className="truncate">{filter.value}</span><span aria-hidden="true">×</span>
                </button>
              </Tooltip>
            ))}
          </div>
          <div className={`grid transition-all duration-300 ease-out ${filtersExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
            <div className="min-h-0 overflow-hidden">
              <div className="grid gap-2 pt-3 md:grid-cols-2 xl:grid-cols-4">
                <FilterSelect label="Tipo" value={typeFilter} onChange={(value) => setTypeFilter(value as typeof typeFilter)}>
                  <option>Todos</option>
                  <option>Promessa de pagamento</option>
                  <option>Acordo</option>
                </FilterSelect>
                <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter}>
                  <option>Todos</option>
                  {statuses.map((status) => (
                    <option key={status}>{status}</option>
                  ))}
                </FilterSelect>
                <FilterSelect label="Operador" value={operatorFilter} onChange={setOperatorFilter}>
                  <option>Todos</option>
                  {operators.map((operator) => (
                    <option key={operator}>{operator}</option>
                  ))}
                </FilterSelect>
                <FilterSelect disabled={Boolean(unit)} label="Unidade/lote" value={unit ? unit.matricula : unitFilter} onChange={setUnitFilter}>
                  <option value="Todas">Todas</option>
                  {client.carteira.unidades.map((portfolioUnit) => (
                    <option key={portfolioUnit.id} value={portfolioUnit.matricula}>
                      {portfolioUnit.matricula} · {portfolioUnit.unidadeLote}
                    </option>
                  ))}
                </FilterSelect>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[#A07C3B]/15 bg-white p-3">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-[#A07C3B]" aria-hidden="true" />
            <p className="text-sm font-semibold text-slate-950">IA operacional</p>
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-600">
            Risco de quebra {client.agreement.aiSuggestion.breakChance}%. Recomenda follow-up antes do
            vencimento e composição com entrada proporcional ao histórico.
          </p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="overflow-hidden rounded-xl border border-slate-200/70 bg-white">
          <div className="grid grid-cols-[0.95fr_0.85fr_0.9fr_0.85fr_0.8fr_0.85fr_84px] gap-3 border-b border-slate-100 bg-slate-50/80 px-4 py-2.5 text-xs font-semibold text-slate-500 max-lg:hidden">
            <span>Tipo</span>
            <span>Status</span>
            <span>Cliente</span>
            <span>Cod. unidade</span>
            <span>Valor</span>
            <span>Data</span>
            <span className="text-right">Ações</span>
          </div>

          <div className="max-h-[520px] overflow-y-auto [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300">
            {filteredRecords.map((record) => (
              <article
                key={record.id}
                className="grid gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0 lg:grid-cols-[0.95fr_0.85fr_0.9fr_0.85fr_0.8fr_0.85fr_84px] lg:items-center"
              >
                <div className="min-w-0">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${typeStyles[record.type]}`}>
                    {record.type}
                  </span>
                  <p className="mt-1 truncate text-sm font-semibold text-slate-950">
                    {record.enterprise}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">{record.unitLabel}</p>
                  <p className="mt-1 w-fit rounded-full bg-[#A07C3B]/5 px-2 py-0.5 text-[11px] font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
                    {record.protocol}
                  </p>
                </div>

                <div>{renderStatusBadge(record)}</div>

                <div className="min-w-0">
                  <p className="truncate text-xs text-slate-500 lg:hidden">Cliente</p>
                  <p className="mt-1 truncate text-sm font-semibold text-slate-950 lg:mt-0">{record.client}</p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">{record.operator}</p>
                </div>

                <div className="min-w-0">
                  <p className="truncate text-xs text-slate-500 lg:hidden">Cod. unidade</p>
                  <p className="mt-1 truncate text-sm font-semibold text-slate-950 lg:mt-0">{record.unitCode}</p>
                </div>

                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-500">Valor</p>
                  <p className="mt-1 truncate text-sm font-semibold text-slate-950">
                    {record.type === "Promessa de pagamento" ? record.promisedValue : record.negotiatedValue}
                  </p>
                </div>

                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-500">
                    {record.type === "Promessa de pagamento" ? "Data prometida" : "Entrada"}
                  </p>
                  <p className="mt-1 truncate text-sm font-semibold text-slate-950">
                    {record.type === "Promessa de pagamento" ? record.promisedDate : record.entryDueDate}
                  </p>
                </div>

                <div className="flex justify-end gap-1.5">
                  <Tooltip content="Editar compromisso" placement="top">
                    <button
                      type="button"
                      onClick={() => setDrawer({ mode: "Editar compromisso", record })}
                      className="flex size-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-50 hover:text-[#A07C3B]"
                      aria-label="Editar compromisso"
                    >
                      <Edit3 className="size-4" aria-hidden="true" />
                    </button>
                  </Tooltip>
                  <Tooltip content="Alterar status" placement="top">
                    <button
                      type="button"
                      onClick={() => handlePrimaryAction(record, updateStatus)}
                      className="flex size-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-[#A07C3B]/5 hover:text-[#A07C3B]"
                      aria-label="Alterar status"
                    >
                      <RefreshCw className="size-4" aria-hidden="true" />
                    </button>
                  </Tooltip>
                </div>
              </article>
            ))}

            {filteredRecords.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-slate-500">
                Nenhum compromisso encontrado para os filtros selecionados.
              </div>
            ) : null}
          </div>
        </div>

        <CommitmentInsights client={client} summary={summary} />
      </div>

      {drawer ? (
        <CommitmentDrawer
          client={client}
          mode={drawer.mode}
          onClose={() => setDrawer(null)}
          onCreate={addMockRecord}
          onSave={updateRecord}
          onStatusChange={updateStatus}
          record={drawer.record}
        />
      ) : null}
    </DetailSection>
  );
}

function CommitmentInsights({
  client,
  summary,
}: {
  client: QueueClient;
  summary: ReturnType<typeof buildCommitmentSummary>;
}) {
  return (
    <div className="grid gap-3">
      <div className="rounded-xl border border-slate-200/70 bg-slate-50/60 p-4">
        <div className="mb-3 flex items-center gap-2">
          <TrendingUp className="size-4 text-[#A07C3B]" aria-hidden="true" />
          <p className="text-sm font-semibold text-slate-950">Recuperação</p>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-white ring-1 ring-slate-200/70">
          <div
            className="h-full rounded-full bg-[#A07C3B]"
            style={{ width: `${Math.min(client.agreement.recoveryRate, 100)}%` }}
          />
        </div>
        <div className="mt-3 grid gap-2">
          <CompactInfo label="Valor recuperado" value={formatMoney(summary.recoveredValue)} />
          <CompactInfo label="Taxa de quebra" value={`${summary.breakRate}%`} />
        </div>
      </div>

      <div className="rounded-xl border border-slate-200/70 bg-white p-4">
        <div className="mb-3 flex items-center gap-2">
          <BadgePercent className="size-4 text-[#A07C3B]" aria-hidden="true" />
          <p className="text-sm font-semibold text-slate-950">Recomendação IA</p>
        </div>
        <p className="text-sm leading-6 text-slate-600">{client.agreement.aiSuggestion.composition}</p>
        <div className="mt-3 rounded-xl bg-slate-50/80 p-3 ring-1 ring-slate-200/70">
          <p className="text-xs font-semibold uppercase tracking-normal text-slate-400">
            Próxima ação
          </p>
          <p className="mt-1 text-sm leading-6 text-slate-700">
            {client.agreement.aiSuggestion.nextAction}
          </p>
        </div>
      </div>
    </div>
  );
}

function CommitmentDrawer({
  client,
  mode,
  onClose,
  onCreate,
  onSave,
  onStatusChange,
  record,
}: {
  client: QueueClient;
  mode: CommitmentDrawerMode;
  onClose: () => void;
  onCreate: (
    mode: Exclude<CommitmentDrawerMode, "Editar compromisso">,
    draft: EditableCommitment,
  ) => void;
  onSave: (record: Commitment, draft: EditableCommitment) => void;
  onStatusChange: (record: Commitment, status: Commitment["status"], action: string) => void;
  record?: Commitment;
}) {
  const isCreate = mode !== "Editar compromisso";

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Fechar central de compromissos"
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/25 backdrop-blur-[2px]"
      />

      <aside className="relative z-10 flex h-full w-full max-w-xl flex-col border-l border-slate-200/70 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)]">
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">
              Central Operacional
            </p>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">{mode}</h2>
            <p className="mt-1 text-sm text-slate-500">{client.nome}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar drawer"
            className="flex size-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
          {isCreate ? (
            <CreateCommitmentForm client={client} mode={mode} onCreate={onCreate} />
          ) : record ? (
            <CommitmentDetail record={record} onSave={onSave} onStatusChange={onStatusChange} />
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function CreateCommitmentForm({
  client,
  mode,
  onCreate,
}: {
  client: QueueClient;
  mode: Exclude<CommitmentDrawerMode, "Editar compromisso">;
  onCreate: (
    mode: Exclude<CommitmentDrawerMode, "Editar compromisso">,
    draft: EditableCommitment,
  ) => void;
}) {
  const unit = client.carteira.unidades[0];
  const isPromise = mode === "Nova promessa";
  const [draft, setDraft] = useState<EditableCommitment>({
    note: isPromise
      ? "Promessa registrada manualmente após contato com o cliente."
      : client.agreement.aiSuggestion.composition,
    operator: client.responsavel,
    primaryDate: nowShortDate(),
    primaryValue: isPromise
      ? client.parcelas.ultimaParcela
      : client.agreement.negotiatedValue,
  });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <ReadonlyField label="Cliente" value={client.nome} />
        <EditableField
          label="Operador responsável"
          value={draft.operator}
          onChange={(value) => setDraft((current) => ({ ...current, operator: value }))}
        />
        <ReadonlyField label="Empreendimento" value={unit.empreendimento} />
        <ReadonlyField label="Cod. unidade" value={unit.matricula} />
        <ReadonlyField label="Unidade/lote" value={unit.unidadeLote} />
        <ReadonlyField label="Parcelas relacionadas" value={isPromise ? "04/60, 05/60" : "03/60, 04/60, 05/60"} />
        <EditableField
          label={isPromise ? "Valor prometido" : "Valor negociado"}
          value={draft.primaryValue}
          onChange={(value) => setDraft((current) => ({ ...current, primaryValue: value }))}
        />
        <EditableField
          label={isPromise ? "Data prometida" : "Vencimento da entrada"}
          value={draft.primaryDate}
          onChange={(value) => setDraft((current) => ({ ...current, primaryDate: value }))}
        />
        <ReadonlyField label={isPromise ? "Canal do contato" : "Quantidade de parcelas"} value={isPromise ? "WhatsApp" : `${client.agreement.installmentsCount}`} />
        <ReadonlyField label={isPromise ? "Status da promessa" : "Status do acordo"} value={isPromise ? "Promessa realizada" : "Em negociação"} />
      </div>

      <div className="rounded-xl border border-slate-200/70 bg-slate-50/70 p-4">
        <p className="text-xs font-semibold uppercase tracking-normal text-slate-400">Observação</p>
        <textarea
          value={draft.note}
          onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
          className="mt-2 min-h-24 w-full resize-none rounded-lg border border-slate-200/70 bg-white px-3 py-2 text-sm leading-6 text-slate-700 outline-none transition-colors focus:border-[#A07C3B]/40 focus:ring-2 focus:ring-[#A07C3B]/10"
        />
      </div>

      <button
        type="button"
        onClick={() => onCreate(mode, draft)}
        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#A07C3B] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#8E6F35]"
      >
        <CheckCircle2 className="size-4" aria-hidden="true" />
        Registrar compromisso
      </button>
    </div>
  );
}

function CommitmentDetail({
  onSave,
  onStatusChange,
  record,
}: {
  onSave: (record: Commitment, draft: EditableCommitment) => void;
  onStatusChange: (record: Commitment, status: Commitment["status"], action: string) => void;
  record: Commitment;
}) {
  const [draft, setDraft] = useState<EditableCommitment>({
    note: record.note,
    operator: record.operator,
    primaryDate: record.type === "Promessa de pagamento" ? record.promisedDate : record.entryDueDate,
    primaryValue: record.type === "Promessa de pagamento" ? record.promisedValue : record.negotiatedValue,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${typeStyles[record.type]}`}>
          {record.type}
        </span>
        {renderStatusBadge(record)}
        {"risk" in record ? (
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${agreementRiskStyles[record.risk]}`}>
            Risco {record.risk}
          </span>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <ReadonlyField label="Cliente" value={record.client} />
        <ReadonlyField label="Protocolo" value={record.protocol} />
        <ReadonlyField label="Empreendimento" value={record.enterprise} />
        <ReadonlyField label="Cod. unidade" value={record.unitCode} />
        <ReadonlyField label="Unidade/lote" value={record.unitLabel} />
        {record.type === "Promessa de pagamento" ? (
          <>
            <ReadonlyField label="Parcelas relacionadas" value={record.relatedInstallments} />
            <EditableField
              label="Valor prometido"
              value={draft.primaryValue}
              onChange={(value) => setDraft((current) => ({ ...current, primaryValue: value }))}
            />
            <EditableField
              label="Data prometida"
              value={draft.primaryDate}
              onChange={(value) => setDraft((current) => ({ ...current, primaryDate: value }))}
            />
            <ReadonlyField label="Canal do contato" value={record.contactChannel} />
          </>
        ) : (
          <>
            <ReadonlyField label="Parcelas incluídas" value={record.includedInstallments} />
            <ReadonlyField label="Valor original" value={record.originalValue} />
            <ReadonlyField label="Desconto" value={record.discount} />
            <EditableField
              label="Valor negociado"
              value={draft.primaryValue}
              onChange={(value) => setDraft((current) => ({ ...current, primaryValue: value }))}
            />
            <ReadonlyField label="Entrada" value={record.entry} />
            <EditableField
              label="Vencimento da entrada"
              value={draft.primaryDate}
              onChange={(value) => setDraft((current) => ({ ...current, primaryDate: value }))}
            />
            <ReadonlyField label="Quantidade de parcelas" value={`${record.installmentsCount}`} />
            <ReadonlyField label="Valor das parcelas" value={record.installmentValue} />
          </>
        )}
        <EditableField
          label="Operador responsável"
          value={draft.operator}
          onChange={(value) => setDraft((current) => ({ ...current, operator: value }))}
        />
      </div>

      <div className="rounded-xl border border-slate-200/70 bg-slate-50/70 p-4">
        <p className="text-xs font-semibold uppercase tracking-normal text-slate-400">Observação</p>
        <textarea
          value={draft.note}
          onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
          className="mt-2 min-h-24 w-full resize-none rounded-lg border border-slate-200/70 bg-white px-3 py-2 text-sm leading-6 text-slate-700 outline-none transition-colors focus:border-[#A07C3B]/40 focus:ring-2 focus:ring-[#A07C3B]/10"
        />
      </div>

      <button
        type="button"
        onClick={() => onSave(record, draft)}
        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[#A07C3B]/20 bg-[#A07C3B]/5 px-4 text-sm font-semibold text-[#7A5E2C] transition-colors hover:bg-[#A07C3B]/10"
      >
        <CheckCircle2 className="size-4" aria-hidden="true" />
        Salvar edição
      </button>

      <div className="grid gap-2 sm:grid-cols-3">
        {record.type === "Promessa de pagamento" ? (
          <>
            <StatusButton icon={CheckCircle2} label="Cumprida" onClick={() => onStatusChange(record, "Cumprida", "Cumprimento registrado")} />
            <StatusButton icon={XCircle} label="Quebrada" onClick={() => onStatusChange(record, "Quebrada", "Quebra registrada")} />
            <StatusButton icon={CalendarClock} label="Reagendar" onClick={() => onStatusChange(record, "Reagendada", "Reagendamento registrado")} />
          </>
        ) : (
          <>
            <StatusButton icon={CheckCircle2} label="Pago" onClick={() => onStatusChange(record, "Pago", "Pagamento registrado")} />
            <StatusButton icon={XCircle} label="Quebrado" onClick={() => onStatusChange(record, "Quebrado", "Quebra de acordo registrada")} />
            <StatusButton icon={RefreshCw} label="Reativado" onClick={() => onStatusChange(record, "Reativado", "Reativação registrada")} />
          </>
        )}
      </div>

      <div className="rounded-xl border border-slate-200/70 bg-white p-4">
        <p className="mb-3 text-sm font-semibold text-slate-950">Histórico de alterações</p>
        <div className="space-y-3">
          {record.history.map((entry) => (
            <div key={entry.id} className="border-l-2 border-[#A07C3B]/30 pl-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold text-slate-950">{entry.action}</p>
                <span className="text-[11px] text-slate-400">{entry.occurredAt}</span>
              </div>
              <p className="mt-1 w-fit rounded-full bg-[#A07C3B]/5 px-2 py-0.5 text-[11px] font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
                {entry.protocol}
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-600">{entry.description}</p>
              <p className="mt-1 text-[11px] font-semibold text-slate-400">{entry.operator}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function handlePrimaryAction(
  record: Commitment,
  updateStatus: (record: Commitment, status: Commitment["status"], action: string) => void
) {
  if (record.type === "Promessa de pagamento") {
    updateStatus(record, record.status === "Quebrada" ? "Reagendada" : "Aguardando pagamento", "Status operacional alterado");
    return;
  }

  updateStatus(record, record.status === "Quebrado" ? "Reativado" : "Formalizando", "Status operacional alterado");
}

function renderStatusBadge(record: Commitment) {
  const style =
    record.type === "Promessa de pagamento"
      ? promiseStatusStyles[record.status]
      : agreementStatusStyles[record.status];

  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${style}`}>
      {record.status}
    </span>
  );
}

function FilterSelect({
  children,
  disabled = false,
  label,
  onChange,
  value,
}: {
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="min-w-0">
      <span className="mb-1 block text-xs font-semibold text-slate-500">{label}</span>
      <select
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-lg border border-slate-200/70 bg-white px-3 text-sm font-medium text-slate-700 outline-none transition-colors hover:bg-slate-50 disabled:bg-slate-50 disabled:text-slate-400"
      >
        {children}
      </select>
    </label>
  );
}

function StatusButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof CheckCircle2;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200/70 bg-white px-3 text-xs font-semibold text-slate-700 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-[#7A5E2C]"
    >
      <Icon className="size-4 text-[#A07C3B]" aria-hidden="true" />
      {label}
    </button>
  );
}

function MetricCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "gold" | "danger";
}) {
  const toneClass = {
    neutral: "bg-slate-50/70 text-slate-950 ring-slate-200/70",
    gold: "bg-[#A07C3B]/5 text-[#7A5E2C] ring-[#A07C3B]/15",
    danger: "bg-rose-50 text-rose-700 ring-rose-100",
  }[tone];

  return (
    <div className={`min-w-0 rounded-xl px-3 py-2.5 ring-1 ${toneClass}`}>
      <p className="truncate text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 truncate text-lg font-semibold tracking-normal">{value}</p>
    </div>
  );
}

function CompactInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200/70">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-200/70 bg-white px-3 py-2.5">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function EditableField({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="min-w-0 rounded-xl border border-slate-200/70 bg-white px-3 py-2.5">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-7 w-full min-w-0 rounded-md border border-transparent bg-slate-50/80 px-2 text-sm font-semibold text-slate-950 outline-none transition-colors focus:border-[#A07C3B]/35 focus:bg-white focus:ring-2 focus:ring-[#A07C3B]/10"
      />
    </label>
  );
}

function buildCommitmentSummary(records: Commitment[]) {
  const promiseRecords = records.filter((record) => record.type === "Promessa de pagamento");
  const agreementRecords = records.filter((record) => record.type === "Acordo");
  const fulfilledPromises = promiseRecords.filter((record) => record.status === "Cumprida").length;
  const brokenPromises = promiseRecords.filter((record) => record.status === "Quebrada").length;
  const openPromises = promiseRecords.filter((record) =>
    ["Promessa realizada", "Aguardando pagamento", "Reagendada"].includes(record.status)
  ).length;
  const activeAgreements = agreementRecords.filter((record) =>
    ["Ativo", "Formalizando", "Em negociação", "Reativado"].includes(record.status)
  ).length;
  const concluded = fulfilledPromises + brokenPromises;
  const promisedValue = promiseRecords.reduce((total, record) => total + parseMoney(record.promisedValue), 0);
  const recoveredValue =
    fulfilledPromises > 0
      ? promiseRecords
          .filter((record) => record.status === "Cumprida")
          .reduce((total, record) => total + parseMoney(record.promisedValue), 0)
      : agreementRecords
          .filter((record) => record.status === "Pago" || record.status === "Ativo")
          .reduce((total, record) => total + parseMoney(record.entry), 0);

  return {
    activeAgreements,
    breakRate: promiseRecords.length > 0 ? Math.round((brokenPromises / promiseRecords.length) * 100) : 0,
    brokenPromises,
    fulfilledPromises,
    fulfillmentRate: concluded > 0 ? Math.round((fulfilledPromises / concluded) * 100) : 0,
    openPromises,
    promisedValue,
    recoveredValue,
  };
}

function unique(values: string[]) {
  return Array.from(new Set(values)).filter(Boolean);
}

function parseMoney(value: string) {
  const normalized = value.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  return Number.parseFloat(normalized) || 0;
}

function formatMoney(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function nowForDisplay() {
  return new Date().toLocaleString("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function nowShortDate() {
  return new Date().toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function guardianProtocol(seed: number) {
  return `GDN-${String(Math.max(seed, 1)).padStart(6, "0")}`;
}




