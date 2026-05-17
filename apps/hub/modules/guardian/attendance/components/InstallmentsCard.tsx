/* eslint-disable */
// @ts-nocheck
"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ExternalLink, Eye, EyeOff, Filter, Loader2, ReceiptText } from "lucide-react";
import { Tooltip } from "@repo/uix";
import { DetailSection } from "@/modules/guardian/attendance/components/DetailSection";
import type { PortfolioUnit, QueueClient } from "@/modules/guardian/attendance/types";

const sortOptions = [
  "Referência",
  "Vencimento",
  "Dias de atraso",
  "Valor",
  "Status",
] as const;

const statusOptions = ["Todas", "Vencidas", "A vencer", "Liquidadas"] as const;

type SortOption = (typeof sortOptions)[number];
type StatusFilter = (typeof statusOptions)[number];

type InstallmentsCardProps = {
  client: QueueClient;
  defaultStatusFilter?: StatusFilter;
  unit?: PortfolioUnit;
};

type Installment = {
  id?: string;
  invoiceUrl?: string;
  installmentIndex: number;
  number: string;
  paymentUrl?: string;
  reference: string;
  referenceValue: number;
  dueDate: string;
  dueDateChanged: boolean;
  dueDateInput: string;
  dueDateOriginal: string;
  dueDateOriginalInput: string;
  dueDateOriginalValue: number;
  dueDateValue: number;
  paymentDate: string;
  paymentDateInput: string;
  paymentDateValue: number;
  value: string;
  valueNumber: number;
  status: "Vencida" | "A vencer" | "Liquidada";
  overdueDays: string;
  overdueDaysNumber: number;
};

export function InstallmentsCard({
  client,
  defaultStatusFilter = "Todas",
  unit,
}: InstallmentsCardProps) {
  const [sortBy, setSortBy] = useState<SortOption>("Referência");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [referenceStart, setReferenceStart] = useState("");
  const [referenceEnd, setReferenceEnd] = useState("");
  const [dueDateStart, setDueDateStart] = useState("");
  const [dueDateEnd, setDueDateEnd] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(defaultStatusFilter);
  const [installmentSearch, setInstallmentSearch] = useState("");
  const [expandedInstallmentsKey, setExpandedInstallmentsKey] = useState<string | null>(null);

  const allInstallments = useMemo(() => buildInstallments(client, unit), [client, unit]);
  const installments = useMemo(
    () =>
      sortInstallments(
        filterInstallments(allInstallments, {
          dueDateEnd,
          dueDateStart,
          installmentSearch,
          referenceEnd,
          referenceStart,
          statusFilter,
        }),
        sortBy
      ),
    [
      allInstallments,
      dueDateEnd,
      dueDateStart,
      installmentSearch,
      referenceEnd,
      referenceStart,
      sortBy,
      statusFilter,
    ]
  );
  const summary = buildContractSummary(installments);
  const installmentsKey = `${client.id}-${unit?.id ?? "all"}`;
  const installmentsPending = client.c2xInstallmentsLoaded === false;
  const showAllInstallments = expandedInstallmentsKey === installmentsKey;
  const visibleInstallments = showAllInstallments ? installments : installments.slice(0, 4);
  const canToggleInstallments = installments.length > 4;
  const activeFilters = [
    referenceStart ? { label: "Ref. inicial", value: referenceStart, clear: () => setReferenceStart("") } : null,
    referenceEnd ? { label: "Ref. final", value: referenceEnd, clear: () => setReferenceEnd("") } : null,
    dueDateStart ? { label: "Venc. inicial", value: dueDateStart, clear: () => setDueDateStart("") } : null,
    dueDateEnd ? { label: "Venc. final", value: dueDateEnd, clear: () => setDueDateEnd("") } : null,
    statusFilter !== "Todas" ? { label: "Status", value: statusFilter, clear: () => setStatusFilter("Todas") } : null,
    installmentSearch ? { label: "Parcela", value: installmentSearch, clear: () => setInstallmentSearch("") } : null,
  ].filter(Boolean) as Array<{ label: string; value: string; clear: () => void }>;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const stored = window.localStorage.getItem("guardian-installments-filters-expanded");
      if (stored) setFiltersOpen(stored === "true");
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  function toggleFilters() {
    setFiltersOpen((current) => {
      const next = !current;
      window.localStorage.setItem("guardian-installments-filters-expanded", String(next));
      return next;
    });
  }

  return (
    <DetailSection title="Parcelas" icon={ReceiptText}>
      {unit ? (
        <div className="mb-4 rounded-xl border border-slate-200/70 bg-slate-50/60 px-3 py-2.5">
          <p className="text-xs font-medium text-slate-500">Contrato selecionado</p>
          <p className="mt-1 truncate text-sm font-semibold text-slate-950">
            {unit.empreendimento} · Quadra {unit.quadra} · Lote {formatLote(unit.lote)}
          </p>
        </div>
      ) : null}

      <div className="mb-4 grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {summary.map((item) => (
          <SummaryCard
            key={item.label}
            detail={item.detail}
            label={item.label}
            value={item.value}
            tone={item.tone}
          />
        ))}
      </div>

      <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-slate-700">Lista de parcelas</p>
          {canToggleInstallments ? (
            <Tooltip content={showAllInstallments ? "Ver menos parcelas" : "Ver mais parcelas"} placement="bottom">
              <button
                type="button"
                onClick={() =>
                  setExpandedInstallmentsKey((current) =>
                    current === installmentsKey ? null : installmentsKey
                  )
                }
                aria-label={showAllInstallments ? "Ver menos parcelas" : "Ver mais parcelas"}
                className="flex size-9 items-center justify-center rounded-lg border border-slate-200/70 bg-white text-slate-700 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-slate-950"
              >
                <ChevronDown className={`size-4 text-[#A07C3B] transition-transform ${showAllInstallments ? "rotate-180" : ""}`} aria-hidden="true" />
              </button>
            </Tooltip>
          ) : null}
          <Tooltip content={filtersOpen ? "Recolher filtros" : "Expandir filtros"} placement="bottom">
            <button
              type="button"
              onClick={toggleFilters}
              aria-label={filtersOpen ? "Recolher filtros" : "Expandir filtros"}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200/70 bg-white px-2.5 text-xs font-semibold text-slate-700 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-slate-950"
            >
              <Filter className="size-4 text-[#A07C3B]" aria-hidden="true" />
              Filtros{activeFilters.length > 0 ? ` (${activeFilters.length})` : ""}
              <ChevronDown className={`size-3.5 text-[#A07C3B] transition-transform ${filtersOpen ? "rotate-180" : ""}`} aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
        {activeFilters.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {activeFilters.map((filter) => (
              <Tooltip key={`${filter.label}-${filter.value}`} content={`Remover ${filter.label}`} placement="top">
                <button type="button" onClick={filter.clear} className="inline-flex h-7 max-w-44 items-center gap-1 rounded-full bg-[#A07C3B]/5 px-2 text-[11px] font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
                  <span className="truncate">{filter.value}</span><span aria-hidden="true">×</span>
                </button>
              </Tooltip>
            ))}
          </div>
        ) : null}

        <label className="flex items-center gap-2 text-sm text-slate-500">
          Ordenar por
          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as SortOption)}
            className="h-9 rounded-lg border border-slate-200/70 bg-white px-3 text-sm font-medium text-slate-700 outline-none transition-colors hover:bg-slate-50"
          >
            {sortOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>

      {filtersOpen ? (
        <div className="mb-4 rounded-xl border border-slate-200/70 bg-slate-50/60 p-3">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <FilterInput
              label="Referência inicial"
              placeholder="03/2026"
              value={referenceStart}
              onChange={setReferenceStart}
            />
            <FilterInput
              label="Referência final"
              placeholder="07/2026"
              value={referenceEnd}
              onChange={setReferenceEnd}
            />
            <FilterInput
              label="Vencimento inicial"
              type="date"
              value={dueDateStart}
              onChange={setDueDateStart}
            />
            <FilterInput
              label="Vencimento final"
              type="date"
              value={dueDateEnd}
              onChange={setDueDateEnd}
            />
            <label>
              <span className="text-xs font-medium text-slate-500">Status</span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200/70 bg-white px-3 text-sm font-medium text-slate-700 outline-none transition-colors hover:bg-slate-50"
              >
                {statusOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <FilterInput
              label="Buscar parcela"
              placeholder="03/60"
              value={installmentSearch}
              onChange={setInstallmentSearch}
            />
          </div>
        </div>
      ) : null}

      <div
        className="space-y-3 overflow-hidden transition-[max-height,opacity] duration-300 ease-out"
        style={{ maxHeight: showAllInstallments ? `${Math.max(visibleInstallments.length, 1) * 260}px` : "680px" }}
      >
        {installmentsPending ? (
          <div className="rounded-xl border border-slate-200/70 bg-slate-50/60 px-4 py-6 text-center text-sm text-slate-500">
            Carregando parcelas reais do C2X...
          </div>
        ) : visibleInstallments.length > 0 ? (
          visibleInstallments.map((installment) => (
          <article
            key={installment.id ?? installment.number}
            className="rounded-xl border border-slate-200/70 bg-slate-50/60 p-3 transition-all duration-300 ease-out"
          >
            <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-start 2xl:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-slate-950">
                    Parcela {installment.number}
                  </p>
                  <StatusBadge status={installment.status} />
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
                  <InstallmentInfo label="Referência" value={installment.reference} />
                  <InstallmentInfo
                    label="Vencimento original"
                    tone="blue"
                    value={installment.dueDateOriginal}
                  />
                  <InstallmentInfo
                    label="Vencimento atual"
                    tone={installment.dueDateChanged ? "warning" : "neutral"}
                    value={installment.dueDate}
                  />
                  <InstallmentInfo
                    label="Data pagamento"
                    tone={installment.paymentDateInput ? "success" : "muted"}
                    value={installment.paymentDate}
                  />
                  <InstallmentInfo label="Valor" value={installment.value} />
                  <InstallmentInfo label="Dias de atraso" value={installment.overdueDays} />
                </div>
              </div>

              <div className="flex shrink-0 flex-col items-end gap-2">
                <ActionIcon href={installment.paymentUrl} label="Abrir boleto Asaas" icon={ExternalLink} />
                <PaymentViewingIndicator installment={installment} />
              </div>
            </div>
          </article>
          ))
        ) : (
          <div className="rounded-xl border border-slate-200/70 bg-slate-50/60 px-4 py-6 text-center text-sm text-slate-500">
            Nenhuma parcela real encontrada para este contrato.
          </div>
        )}
      </div>
    </DetailSection>
  );
}

function FilterInput({
  label,
  onChange,
  placeholder,
  type = "text",
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "date" | "text";
  value: string;
}) {
  return (
    <label>
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-9 w-full rounded-lg border border-slate-200/70 bg-white px-3 text-sm font-medium text-slate-700 outline-none transition-colors placeholder:text-slate-400 hover:bg-slate-50"
      />
    </label>
  );
}

function SummaryCard({
  detail,
  label,
  value,
  tone = "neutral",
}: {
  detail?: string;
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
      <p className="mt-1 flex min-w-0 items-baseline gap-2">
        <span className="shrink-0 text-lg font-semibold tracking-normal">{value}</span>
        {detail ? (
          <span className="min-w-0 truncate text-xs font-semibold tracking-normal opacity-80">
            {detail}
          </span>
        ) : null}
      </p>
    </div>
  );
}

function InstallmentInfo({
  label,
  tone = "neutral",
  value,
}: {
  label: string;
  tone?: "neutral" | "blue" | "gold" | "warning" | "success" | "danger" | "muted";
  value: string;
}) {
  const toneClass = {
    blue: "bg-sky-50 text-sky-700 ring-sky-100",
    danger: "bg-rose-50 text-rose-700 ring-rose-100",
    gold: "bg-[#A07C3B]/5 text-[#7A5E2C] ring-[#A07C3B]/15",
    muted: "bg-slate-50 text-slate-500 ring-slate-200/70",
    neutral: "bg-white text-slate-950 ring-slate-200/70",
    success: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    warning: "bg-amber-50 text-amber-700 ring-amber-100",
  }[tone];

  return (
    <div className={`min-w-0 rounded-lg px-3 py-2 ring-1 ${toneClass}`}>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: Installment["status"] }) {
  const className = {
    "A vencer": "bg-slate-50 text-slate-600 ring-slate-200",
    Liquidada: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    Vencida: "bg-rose-50 text-rose-700 ring-rose-100",
  }[status];

  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${className}`}>
      {status}
    </span>
  );
}

function ActionIcon({
  href,
  label,
  icon: Icon,
}: {
  href?: string;
  label: string;
  icon: typeof ExternalLink;
}) {
  if (!href) {
    return (
      <Tooltip content={`${label} indisponível`} placement="left">
        <button
          type="button"
          aria-label={`${label} indisponível`}
          disabled
          className="inline-flex size-9 cursor-not-allowed items-center justify-center rounded-lg border border-amber-200/80 bg-amber-50 text-amber-700"
        >
          <Icon className="size-4" aria-hidden="true" />
        </button>
      </Tooltip>
    );
  }

  return (
    <Tooltip content={label} placement="left">
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        aria-label={label}
        className="inline-flex size-9 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 transition-colors hover:border-emerald-300 hover:bg-emerald-100 hover:text-emerald-800"
      >
        <Icon className="size-4" aria-hidden="true" />
      </a>
    </Tooltip>
  );
}

function PaymentViewingIndicator({ installment }: { installment: Installment }) {
  const hasBoleto = Boolean(installment.paymentUrl);
  const [state, setState] = useState<{
    lastViewedAt?: string;
    source?: "boleto" | "fatura";
    status: "idle" | "loading" | "not-viewed" | "unavailable" | "viewed";
  }>({ status: "idle" });

  useEffect(() => {
    if (!hasBoleto || !installment.id) {
      return;
    }

    let cancelled = false;

    async function loadViewingInfo() {
      setState({ status: "loading" });

      try {
        const response = await fetch(
          `/api/guardian/asaas/payment-viewing?paymentId=${encodeURIComponent(installment.id ?? "")}`,
          { cache: "no-store" }
        );
        const payload = (await response.json().catch(() => null)) as
          | {
              viewing?: {
                available?: boolean;
                hasBoleto?: boolean;
                lastViewedAt?: string;
                source?: "boleto" | "fatura";
                viewed?: boolean;
              };
            }
          | null;

        if (cancelled) {
          return;
        }

        if (!response.ok || !payload?.viewing?.available) {
          setState({ status: "unavailable" });
          return;
        }

        setState(
          payload.viewing.viewed
            ? {
                lastViewedAt: payload.viewing.lastViewedAt,
                source: payload.viewing.source,
                status: "viewed",
              }
            : { status: "not-viewed" }
        );
      } catch {
        if (!cancelled) {
          setState({ status: "unavailable" });
        }
      }
    }

    void loadViewingInfo();

    return () => {
      cancelled = true;
    };
  }, [hasBoleto, installment.id]);

  if (!hasBoleto || !installment.id) {
    return null;
  }

  if (state.status === "loading" || state.status === "idle") {
    return (
      <Tooltip content="Consultando visualização" placement="left">
        <span
          aria-label="Consultando visualização do boleto"
          className="inline-flex size-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        </span>
      </Tooltip>
    );
  }

  const viewed = state.status === "viewed";
  const unavailable = state.status === "unavailable";
  const ariaLabel = viewed
    ? `Boleto visualizado em ${formatViewingDate(state.lastViewedAt)}`
    : unavailable
      ? "Não foi possível consultar a visualização no Asaas"
      : "Boleto ainda não visualizado";
  const tooltipLabel = viewed
    ? `Visualizado: ${formatViewingDate(state.lastViewedAt)}`
    : unavailable
      ? "Consulta indisponível"
      : "Ainda não visualizado";
  const Icon = viewed ? Eye : EyeOff;
  const className = viewed
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : unavailable
      ? "border-slate-200 bg-slate-50 text-slate-500"
      : "border-rose-200 bg-rose-50 text-rose-700";

  return (
    <Tooltip content={tooltipLabel} placement="left">
      <span
        aria-label={ariaLabel}
        className={`inline-flex size-8 items-center justify-center rounded-lg border ${className}`}
      >
        <Icon className="size-4" aria-hidden="true" />
      </span>
    </Tooltip>
  );
}

function buildInstallments(client: QueueClient, unit?: PortfolioUnit): Installment[] {
  const realInstallments = (client.c2xInstallments ?? []).filter(
    (installment) => !unit || installment.unitId === unit.id
  );

  if (client.c2xInstallmentsLoaded === false) {
    return [];
  }

  if (realInstallments.length > 0) {
    return realInstallments.map((installment, index) => {
      const dueDateOriginalInput = installment.dueDateOriginalInput ?? installment.dueDateInput;
      const paymentDateInput = installment.paymentDateInput ?? "";

      return {
        dueDate: installment.dueDate,
        dueDateChanged: Boolean(installment.dueDateChanged),
        dueDateInput: installment.dueDateInput,
        dueDateOriginal: installment.dueDateOriginal ?? installment.dueDate,
        dueDateOriginalInput,
        dueDateOriginalValue: parseDateInput(dueDateOriginalInput),
        dueDateValue: parseDateInput(installment.dueDateInput),
        id: installment.id,
        installmentIndex: index + 1,
        invoiceUrl: installment.invoiceUrl,
        number: installment.number,
        overdueDays: installment.overdueDays > 0 ? `${installment.overdueDays} dias` : "-",
        overdueDaysNumber: installment.overdueDays,
        paymentDate: installment.paymentDate ?? "-",
        paymentDateInput,
        paymentDateValue: parseDateInput(paymentDateInput),
        paymentUrl: installment.paymentUrl,
        reference: installment.reference,
        referenceValue: installment.referenceValue,
        status: installment.status,
        value: installment.value,
        valueNumber: installment.valueNumber,
      };
    });
  }

  if (isC2xClient(client, unit)) {
    return [];
  }

  const total = unit?.id.endsWith("-2") ? 48 : 60;
  const liquidated = unit?.id.endsWith("-2") ? 18 : 12;
  const valueNumber = unit
    ? estimateInstallmentNumber(unit.valorTabela, total)
    : Number(client.parcelas.ultimaParcela.replace(/\D/g, "")) / 100;
  const value = formatCurrency(valueNumber);

  return Array.from({ length: total }, (_, index) => {
    const installmentIndex = index + 1;
    const isLiquidated = installmentIndex <= liquidated;
    const isOverdue =
      !isLiquidated && installmentIndex <= liquidated + client.parcelas.vencidas;
    const days = isOverdue
      ? Math.max(client.atrasoDias - (installmentIndex - liquidated - 1) * 8, 1)
      : 0;
    const dueDate = getMockDueDate(index);

    return {
      number: `${String(installmentIndex).padStart(2, "0")}/${String(total).padStart(2, "0")}`,
      installmentIndex,
      reference: getMockReference(index),
      referenceValue: getReferenceValue(index),
      dueDate,
      dueDateChanged: false,
      dueDateInput: toDateInput(dueDate),
      dueDateOriginal: dueDate,
      dueDateOriginalInput: toDateInput(dueDate),
      dueDateOriginalValue: parseBrazilianDate(dueDate),
      dueDateValue: parseBrazilianDate(dueDate),
      paymentDate: isLiquidated ? dueDate : "-",
      paymentDateInput: isLiquidated ? toDateInput(dueDate) : "",
      paymentDateValue: isLiquidated ? parseBrazilianDate(dueDate) : 0,
      value,
      valueNumber,
      status: isLiquidated ? "Liquidada" : isOverdue ? "Vencida" : "A vencer",
      overdueDays: `${days} dias`,
      overdueDaysNumber: days,
    };
  });
}

function isC2xClient(client: QueueClient, unit?: PortfolioUnit) {
  return (
    client.id.startsWith("c2x-") ||
    Boolean(client.c2xAcquisitionRequestId) ||
    Boolean(unit?.id.startsWith("c2x-unit-")) ||
    client.carteira.unidades.some((portfolioUnit) =>
      portfolioUnit.id.startsWith("c2x-unit-")
    )
  );
}

function parseDateInput(date: string) {
  const match = date.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return 0;
  }

  return Number(`${match[1]}${match[2]}${match[3]}`);
}

function filterInstallments(
  installments: Installment[],
  filters: {
    dueDateEnd: string;
    dueDateStart: string;
    installmentSearch: string;
    referenceEnd: string;
    referenceStart: string;
    statusFilter: StatusFilter;
  }
) {
  const referenceStartValue = parseReference(filters.referenceStart);
  const referenceEndValue = parseReference(filters.referenceEnd);
  const dueDateStartValue = filters.dueDateStart ? parseDateInput(filters.dueDateStart) : null;
  const dueDateEndValue = filters.dueDateEnd ? parseDateInput(filters.dueDateEnd) : null;
  const search = filters.installmentSearch.trim().toLowerCase();

  return installments.filter((installment) => {
    const matchesReferenceStart =
      referenceStartValue === null || installment.referenceValue >= referenceStartValue;
    const matchesReferenceEnd =
      referenceEndValue === null || installment.referenceValue <= referenceEndValue;
    const matchesDueDateStart =
      dueDateStartValue === null || installment.dueDateValue >= dueDateStartValue;
    const matchesDueDateEnd =
      dueDateEndValue === null || installment.dueDateValue <= dueDateEndValue;
    const matchesStatus =
      filters.statusFilter === "Todas" ||
      (filters.statusFilter === "Vencidas" && installment.status === "Vencida") ||
      (filters.statusFilter === "A vencer" && installment.status === "A vencer") ||
      (filters.statusFilter === "Liquidadas" && installment.status === "Liquidada");
    const matchesSearch =
      search.length === 0 ||
      installment.number.toLowerCase().includes(search) ||
      String(installment.installmentIndex).includes(search);

    return (
      matchesReferenceStart &&
      matchesReferenceEnd &&
      matchesDueDateStart &&
      matchesDueDateEnd &&
      matchesStatus &&
      matchesSearch
    );
  });
}

function sortInstallments(installments: Installment[], sortBy: SortOption) {
  return [...installments].sort((a, b) => {
    if (sortBy === "Vencimento") {
      return a.dueDateValue - b.dueDateValue;
    }

    if (sortBy === "Dias de atraso") {
      return b.overdueDaysNumber - a.overdueDaysNumber;
    }

    if (sortBy === "Valor") {
      return b.valueNumber - a.valueNumber;
    }

    if (sortBy === "Status") {
      return a.status.localeCompare(b.status);
    }

    return a.referenceValue - b.referenceValue;
  });
}

function buildContractSummary(installments: Installment[]) {
  const total = installments.length;
  const liquidatedInstallments = installments.filter((installment) => installment.status === "Liquidada");
  const overdueInstallments = installments.filter((installment) => installment.status === "Vencida");
  const upcomingInstallments = installments.filter((installment) => installment.status === "A vencer");
  const liquidated = liquidatedInstallments.length;
  const overdue = overdueInstallments.length;
  const upcoming = upcomingInstallments.length;
  const totalAmount = sumInstallments(installments);
  const liquidatedAmount = sumInstallments(liquidatedInstallments);
  const overdueAmount = sumInstallments(overdueInstallments);
  const upcomingAmount = sumInstallments(upcomingInstallments);
  const accumulatedAmount = liquidatedAmount + overdueAmount;
  const liquidatedPercent = total > 0 ? Math.round((liquidated / total) * 100) : 0;
  const delinquentPercent =
    accumulatedAmount > 0 ? Math.round((overdueAmount / accumulatedAmount) * 100) : 0;

  return [
    { detail: formatCurrency(totalAmount), label: "Total de parcelas", value: `${total}`, tone: "neutral" as const },
    { detail: formatCurrency(liquidatedAmount), label: "Liquidadas", value: `${liquidated}`, tone: "gold" as const },
    { detail: formatCurrency(upcomingAmount), label: "A vencer", value: `${upcoming}`, tone: "neutral" as const },
    { detail: formatCurrency(overdueAmount), label: "Vencidas", value: `${overdue}`, tone: "danger" as const },
    { label: "% liquidado", value: `${liquidatedPercent}%`, tone: "gold" as const },
    { label: "% inadimplente", value: `${delinquentPercent}%`, tone: "danger" as const },
  ];
}

function sumInstallments(installments: Installment[]) {
  return installments.reduce((total, installment) => total + installment.valueNumber, 0);
}

function estimateInstallmentNumber(valorTabela: string, total: number) {
  const numericValue = Number(valorTabela.replace(/\D/g, "")) / 100;
  return numericValue / Math.max(total, 1);
}

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function formatViewingDate(value?: string) {
  if (!value) {
    return "data não informada";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value.replace("T", " ");
  }

  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getMockReference(index: number) {
  const date = new Date(2025, 0 + index, 1);
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

function getReferenceValue(index: number) {
  const date = new Date(2025, 0 + index, 1);
  return date.getFullYear() * 100 + date.getMonth() + 1;
}

function parseReference(reference: string) {
  const match = reference.trim().match(/^(\d{2})\/(\d{4})$/);

  if (!match) {
    return null;
  }

  return Number(match[2]) * 100 + Number(match[1]);
}

function getMockDueDate(index: number) {
  const date = new Date(2025, 0 + index, 10);
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

function parseBrazilianDate(date: string) {
  const [day, month, year] = date.split("/").map(Number);
  return new Date(year, month - 1, day).getTime();
}

function toDateInput(date: string) {
  const [day, month, year] = date.split("/");
  return `${year}-${month}-${day}`;
}

function formatLote(lote: string) {
  return lote.replace(/^L/i, "");
}




