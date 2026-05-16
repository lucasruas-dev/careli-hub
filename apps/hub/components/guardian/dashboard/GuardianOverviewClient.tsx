"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  Building2,
  FileSignature,
  Gauge,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { getGuardianOverviewSnapshot } from "@/lib/guardian/overview-client";
import type {
  GuardianOverviewSnapshot,
  GuardianPaymentListItem,
  GuardianPaymentStatusBucket,
  GuardianProposalListItem,
  GuardianSignatureListItem,
  GuardianStageBucket,
} from "@/lib/guardian/overview";

type LoadState =
  | { data: GuardianOverviewSnapshot; status: "ready" }
  | { error: string; status: "error" }
  | { status: "loading" };

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  currency: "BRL",
  maximumFractionDigits: 0,
  style: "currency",
});

const compactNumberFormatter = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 0,
});

export function GuardianOverviewClient() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const loadOverview = useCallback(async () => {
    setState({ status: "loading" });

    try {
      const data = await getGuardianOverviewSnapshot();
      setState({ data, status: "ready" });
    } catch (error) {
      setState({
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel carregar o Guardian.",
        status: "error",
      });
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  if (state.status === "loading") {
    return <GuardianLoading />;
  }

  if (state.status === "error") {
    return <GuardianError message={state.error} onRetry={loadOverview} />;
  }

  return <GuardianOverview data={state.data} onRefresh={loadOverview} />;
}

function GuardianOverview({
  data,
  onRefresh,
}: {
  data: GuardianOverviewSnapshot;
  onRefresh: () => void;
}) {
  const stageTotal = useMemo(
    () => data.stages.reduce((total, stage) => total + stage.total, 0),
    [data.stages],
  );
  const paymentTotal = useMemo(
    () =>
      data.paymentStatuses.reduce((total, status) => total + status.total, 0),
    [data.paymentStatuses],
  );
  const openRate =
    data.summary.totalProposals > 0
      ? (data.summary.openProposals / data.summary.totalProposals) * 100
      : 0;

  return (
    <div className="flex w-full flex-col gap-4">
      <section className="flex flex-col gap-4 rounded-xl border border-slate-200/70 bg-white px-5 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-7 items-center rounded-full border border-emerald-100 bg-emerald-50 px-3 text-xs font-semibold text-emerald-700">
              <ShieldCheck className="mr-1.5 size-3.5" aria-hidden="true" />
              Read-only conectado
            </span>
            <span className="inline-flex h-7 items-center rounded-full border border-[#A07C3B]/15 bg-[#A07C3B]/5 px-3 text-xs font-semibold text-[#7A5E2C]">
              prod_careli
            </span>
          </div>
          <h1 className="mt-3 text-2xl font-semibold tracking-normal text-slate-950">
            Guardian operacional
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
            Primeira leitura real do Guardian dentro do Hub: propostas,
            parcelas, assinaturas e unidades sem alterar o banco original.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs text-slate-500">
            Atualizado {formatDateTime(data.generatedAt)}
          </p>
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition-colors hover:border-[#A07C3B]/30 hover:bg-[#A07C3B]/5 hover:text-[#7A5E2C]"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            Atualizar
          </button>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-6">
        <MetricCard
          description={`${formatPercent(openRate)} da carteira`}
          icon={Gauge}
          title="Propostas abertas"
          value={formatNumber(data.summary.openProposals)}
        />
        <MetricCard
          description={`${formatNumber(data.summary.totalProposals)} propostas totais`}
          icon={TrendingUp}
          title="Em assinatura"
          value={formatNumber(data.summary.inSignatureProposals)}
        />
        <MetricCard
          description="parcelas vencidas ou em atraso"
          icon={AlertTriangle}
          tone="danger"
          title="Parcelas em atencao"
          value={formatNumber(data.summary.overduePayments)}
        />
        <MetricCard
          description="saldo estimado em atraso"
          icon={Banknote}
          tone="danger"
          title="Valor em atraso"
          value={formatMoney(data.summary.overdueAmount)}
        />
        <MetricCard
          description="processando ou aguardando"
          icon={FileSignature}
          tone="gold"
          title="Assinaturas pendentes"
          value={formatNumber(data.summary.pendingSignatures)}
        />
        <MetricCard
          description="status disponivel"
          icon={Building2}
          title="Unidades disponiveis"
          value={formatNumber(data.summary.availableUnits)}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <DistributionPanel
          items={data.stages}
          title="Funil de propostas"
          total={stageTotal}
        />
        <PaymentStatusPanel
          items={data.paymentStatuses}
          title="Financeiro por status"
          total={paymentTotal}
        />
      </section>

      <section className="grid gap-4 2xl:grid-cols-[1.25fr_0.75fr]">
        <RecentProposalsTable items={data.recentProposals} />
        <SignatureQueue items={data.signatureQueue} />
      </section>

      <OverduePaymentsTable items={data.overduePayments} />
    </div>
  );
}

function MetricCard({
  description,
  icon: Icon,
  title,
  tone = "neutral",
  value,
}: {
  description: string;
  icon: LucideIcon;
  title: string;
  tone?: "danger" | "gold" | "neutral";
  value: string;
}) {
  const toneClass = {
    danger: "text-rose-700 bg-rose-50 ring-rose-100",
    gold: "text-[#7A5E2C] bg-[#A07C3B]/5 ring-[#A07C3B]/15",
    neutral: "text-[#A07C3B] bg-slate-50 ring-slate-200/70",
  }[tone];

  return (
    <article className="rounded-xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-normal text-slate-400">
            {title}
          </p>
          <p className="mt-2 text-2xl font-semibold tracking-normal text-slate-950">
            {value}
          </p>
        </div>
        <div
          className={`flex size-9 items-center justify-center rounded-lg ring-1 ${toneClass}`}
        >
          <Icon className="size-4 stroke-[1.8]" aria-hidden="true" />
        </div>
      </div>
      <p className="mt-3 truncate text-xs text-slate-500">{description}</p>
    </article>
  );
}

function DistributionPanel({
  items,
  title,
  total,
}: {
  items: GuardianStageBucket[];
  title: string;
  total: number;
}) {
  return (
    <section className="rounded-xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">{title}</h2>
          <p className="mt-1 text-sm text-slate-500">
            {formatNumber(total)} registros distribuidos por etapa.
          </p>
        </div>
      </div>
      <div className="mt-5 space-y-3">
        {items.map((item) => (
          <ProgressRow
            key={item.id}
            label={item.name}
            percent={getPercent(item.total, total)}
            value={formatNumber(item.total)}
          />
        ))}
      </div>
    </section>
  );
}

function PaymentStatusPanel({
  items,
  title,
  total,
}: {
  items: GuardianPaymentStatusBucket[];
  title: string;
  total: number;
}) {
  return (
    <section className="rounded-xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <h2 className="text-base font-semibold text-slate-950">{title}</h2>
      <p className="mt-1 text-sm text-slate-500">
        {formatNumber(total)} parcelas por situacao financeira.
      </p>
      <div className="mt-5 space-y-3">
        {items.map((item) => (
          <ProgressRow
            key={item.id}
            label={item.name}
            percent={getPercent(item.total, total)}
            value={formatNumber(item.total)}
          />
        ))}
      </div>
    </section>
  );
}

function ProgressRow({
  label,
  percent,
  value,
}: {
  label: string;
  percent: number;
  value: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-sm font-medium text-slate-700">
          {label}
        </span>
        <span className="text-sm font-semibold text-slate-950">{value}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-[#A07C3B]/75"
          style={{ width: `${Math.max(percent, 2)}%` }}
        />
      </div>
    </div>
  );
}

function RecentProposalsTable({
  items,
}: {
  items: GuardianProposalListItem[];
}) {
  return (
    <DataTable
      title="Propostas recentes"
      description="Ultimas movimentacoes no Guardian."
      headers={[
        "Codigo",
        "Cliente",
        "Empreendimento",
        "Unidade",
        "Etapa",
        "Atualizado",
      ]}
      rows={items.map((item) => [
        item.code ?? `#${item.id}`,
        item.clientName ?? "Sem cliente",
        item.enterpriseName ?? "Sem empreendimento",
        item.unitLabel ?? "-",
        item.stageName ?? "-",
        formatDateTime(item.updatedAt),
      ])}
    />
  );
}

function SignatureQueue({ items }: { items: GuardianSignatureListItem[] }) {
  return (
    <DataTable
      title="Assinaturas"
      description="Contratos aguardando processamento ou assinatura."
      headers={["Contrato", "Cliente", "Status", "Atualizado"]}
      rows={items.map((item) => [
        `#${item.contractId}`,
        item.clientName ?? item.code ?? "Sem cliente",
        item.statusName ?? "-",
        formatDateTime(item.updatedAt),
      ])}
    />
  );
}

function OverduePaymentsTable({
  items,
}: {
  items: GuardianPaymentListItem[];
}) {
  return (
    <DataTable
      title="Parcelas em atencao"
      description="Primeiros vencimentos em aberto ou atraso."
      headers={["Vencimento", "Cliente", "Proposta", "Parcela", "Status", "Saldo"]}
      rows={items.map((item) => [
        formatDate(item.dueDate),
        item.clientName ?? "Sem cliente",
        item.code ?? `#${item.id}`,
        item.parcelLabel ?? "-",
        item.statusName ?? "-",
        formatMoney(item.amount),
      ])}
    />
  );
}

function DataTable({
  description,
  headers,
  rows,
  title,
}: {
  description: string;
  headers: string[];
  rows: string[][];
  title: string;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-base font-semibold text-slate-950">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-slate-50/80 text-xs uppercase tracking-normal text-slate-500">
            <tr>
              {headers.map((header) => (
                <th key={header} className="px-4 py-3 font-medium">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {rows.map((row, rowIndex) => (
              <tr key={`${title}-${rowIndex}`} className="hover:bg-slate-50/60">
                {row.map((cell, cellIndex) => (
                  <td
                    key={`${title}-${rowIndex}-${cellIndex}`}
                    className={`whitespace-nowrap px-4 py-3 ${
                      cellIndex === 0
                        ? "font-semibold text-slate-950"
                        : "text-slate-600"
                    }`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 ? (
        <div className="border-t border-slate-100 px-5 py-8 text-center text-sm text-slate-500">
          Nenhum registro encontrado.
        </div>
      ) : null}
    </section>
  );
}

function GuardianLoading() {
  return (
    <div className="grid gap-4">
      <div className="h-32 animate-pulse rounded-xl bg-white ring-1 ring-slate-200/70" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          <div
            key={index}
            className="h-32 animate-pulse rounded-xl bg-white ring-1 ring-slate-200/70"
          />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="h-80 animate-pulse rounded-xl bg-white ring-1 ring-slate-200/70" />
        <div className="h-80 animate-pulse rounded-xl bg-white ring-1 ring-slate-200/70" />
      </div>
    </div>
  );
}

function GuardianError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <section className="rounded-xl border border-rose-100 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-700 ring-1 ring-rose-100">
          <AlertTriangle className="size-5" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-slate-950">
            Guardian indisponivel
          </h2>
          <p className="mt-1 text-sm text-slate-600">{message}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-3 text-sm font-semibold text-white transition-colors hover:bg-[#A07C3B]"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            Tentar novamente
          </button>
        </div>
      </div>
    </section>
  );
}

function getPercent(value: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return Math.round((value / total) * 100);
}

function formatMoney(value: number) {
  return currencyFormatter.format(value);
}

function formatNumber(value: number) {
  return compactNumberFormatter.format(value);
}

function formatPercent(value: number) {
  return `${value.toFixed(1).replace(".", ",")}%`;
}

function formatDate(value?: string) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("pt-BR").format(new Date(value));
}

function formatDateTime(value?: string) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  }).format(new Date(value));
}
