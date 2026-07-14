import { CheckCircle2, MapPinned, ShieldCheck, UsersRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { ApoloDashboardData, ApoloEntity } from "@/lib/apolo/types";

import { formatCount, profileCount } from "../shared/apolo-utils";
import { buyerStatusLabel, countPendingSignals } from "../../data/apolo-derive";
function CrmCommandCenter({
  dashboard,
  entities,
  filteredCount,
  loading,
  selectedEntity,
}: {
  dashboard: ApoloDashboardData | null;
  entities: readonly ApoloEntity[];
  filteredCount: number;
  loading: boolean;
  selectedEntity: ApoloEntity | null;
}) {
  const usuarioCount = profileCount(dashboard, "usuario");
  const pageBuyerCount = entities.filter((entity) => buyerStatusLabel(entity) === "Comprador").length;
  const buyerCount = dashboard?.buyerUsersCount ?? pageBuyerCount;
  const nonBuyerCount = dashboard?.nonBuyerUsersCount ?? Math.max(usuarioCount - pageBuyerCount, 0);
  const portfolioCount = dashboard?.portfolioUnitsCount ?? entities.reduce((total, entity) => total + entity.commercialLinks.length, 0);
  const paymentCount = dashboard?.portfolioPaymentsCount ?? 0;
  const pendingCount = selectedEntity ? countPendingSignals(selectedEntity) : dashboard?.pendingReviewCount ?? 0;

  return (
    <section className="grid shrink-0 gap-3">
      <div className="grid gap-3 md:grid-cols-4">
        <CrmSignalCard
          icon={UsersRound}
          label="Relacionamentos"
          value={loading ? "--" : formatCount(dashboard?.totalCount ?? entities.length)}
          detail={`${formatCount(filteredCount)} na consulta atual`}
        />
        <CrmSignalCard
          icon={CheckCircle2}
          label="Compradores com carteira"
          value={loading ? "--" : formatCount(buyerCount)}
          detail={`${formatCount(nonBuyerCount)} usuario(s) sem pagamento`}
        />
        <CrmSignalCard
          icon={MapPinned}
          label="Unidades em carteira"
          value={loading ? "--" : formatCount(portfolioCount)}
          detail={paymentCount > 0 ? `${formatCount(paymentCount)} pagamento(s) cruzado(s)` : "Cruzamento por pagamentos"}
        />
        <CrmSignalCard
          icon={ShieldCheck}
          label="Qualidade"
          value={loading ? "--" : `${selectedEntity?.confidenceScore ?? 0}%`}
          detail={`${formatCount(pendingCount)} ponto(s) para revisar`}
        />
      </div>
    </section>
  );
}

function CrmSignalCard({
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
    <article className="rounded-lg border border-line bg-surface p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-xs font-medium text-ink-muted">{label}</p>
          <p className="m-0 mt-2 text-xl font-semibold leading-none text-ink">{value}</p>
          <p className="m-0 mt-2 truncate text-xs font-medium text-ink-muted">{detail}</p>
        </div>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#A07C3B]/5 text-[#7a5e2c] dark:text-[#d9b877] ring-1 ring-[#A07C3B]/15">
          <Icon className="size-4" aria-hidden="true" />
        </span>
      </div>
    </article>
  );
}


export { CrmCommandCenter };
