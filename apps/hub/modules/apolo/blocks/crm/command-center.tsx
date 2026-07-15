import { CheckCircle2, MapPinned, ShieldCheck, UsersRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { ApoloDashboardData, ApoloEntity } from "@/lib/apolo/types";

import { formatCount, profileCount } from "../shared/apolo-utils";
import { buyerStatusLabel } from "../../data/apolo-derive";
import { NovoCadastroMenu } from "../shell/apolo-shell";

// Cabeçalho do CRM 360: título + KPIs compactos + botão de novo cadastro, tudo num
// só header (antes eram uma faixa do "+" e uma tira grande de cards separadas).
function CrmCommandCenter({
  dashboard,
  entities,
  filteredCount,
  loading,
}: {
  dashboard: ApoloDashboardData | null;
  entities: readonly ApoloEntity[];
  filteredCount: number;
  loading: boolean;
}) {
  const usuarioCount = profileCount(dashboard, "usuario");
  const pageBuyerCount = entities.filter((entity) => buyerStatusLabel(entity) === "Comprador").length;
  const buyerCount = dashboard?.buyerUsersCount ?? pageBuyerCount;
  const nonBuyerCount = dashboard?.nonBuyerUsersCount ?? Math.max(usuarioCount - pageBuyerCount, 0);
  const portfolioCount = dashboard?.portfolioUnitsCount ?? entities.reduce((total, entity) => total + entity.commercialLinks.length, 0);
  const paymentCount = dashboard?.portfolioPaymentsCount ?? 0;
  // Qualidade GLOBAL: % de cadastros sem pendência de revisão (antes mostrava a
  // confiança da entidade SELECIONada, que não é métrica de painel).
  const totalEntities = dashboard?.totalCount ?? entities.length;
  const pendingReview = dashboard?.pendingReviewCount ?? 0;
  const qualityPct = totalEntities > 0 ? Math.round((1 - pendingReview / totalEntities) * 100) : 0;

  return (
    <header className="shrink-0 rounded-xl border border-line bg-surface px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="m-0 text-base font-semibold text-ink">CRM 360</h2>
          <p className="m-0 mt-0.5 text-xs font-medium text-ink-muted">
            Pessoas, empresas, carteira e responsaveis.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CrmStat
            detail={`${formatCount(filteredCount)} na consulta atual`}
            icon={UsersRound}
            label="Relacionamentos"
            value={loading ? "--" : formatCount(dashboard?.totalCount ?? entities.length)}
          />
          <CrmStat
            detail={`${formatCount(nonBuyerCount)} sem pagamento`}
            icon={CheckCircle2}
            label="Compradores"
            value={loading ? "--" : formatCount(buyerCount)}
          />
          <CrmStat
            detail={paymentCount > 0 ? `${formatCount(paymentCount)} pagamento(s) cruzado(s)` : "Cruzamento por pagamentos"}
            icon={MapPinned}
            label="Unidades em carteira"
            value={loading ? "--" : formatCount(portfolioCount)}
          />
          <CrmStat
            detail={`${formatCount(pendingReview)} cadastro(s) para revisar`}
            icon={ShieldCheck}
            label="Qualidade"
            value={loading ? "--" : `${qualityPct}%`}
          />
          {dashboard?.meta.status === "sync_pending" ? (
            <span className="inline-flex h-9 items-center rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/12 dark:text-amber-300">
              Atualizacao pendente
            </span>
          ) : null}
          <NovoCadastroMenu />
        </div>
      </div>
    </header>
  );
}

// Célula compacta de KPI (o detalhe completo fica no tooltip).
function CrmStat({
  detail,
  icon: Icon,
  label,
  value,
}: {
  detail: string;
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div
      className="flex items-center gap-2 rounded-lg border border-line bg-subtle/60 px-3 py-1.5"
      title={detail}
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-[#A07C3B]/8 text-[#7a5e2c] ring-1 ring-[#A07C3B]/15 dark:text-[#d9b877]">
        <Icon className="size-3.5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="m-0 text-[10px] font-medium leading-tight text-ink-muted">{label}</p>
        <p className="m-0 text-sm font-semibold leading-tight tabular-nums text-ink">{value}</p>
      </div>
    </div>
  );
}

export { CrmCommandCenter };
