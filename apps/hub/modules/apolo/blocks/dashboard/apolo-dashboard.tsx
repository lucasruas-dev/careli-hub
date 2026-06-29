import type { ReactNode } from "react";
import {
  CheckCircle2,
  Database,
  ShieldCheck,
  UsersRound,
} from "lucide-react";

import { PanteonLoadingMark } from "@/components/panteon/panteon-loading";
import { getApoloProfileIcon } from "@/lib/apolo/catalog";
import type { ApoloDashboardData, ApoloEntity } from "@/lib/apolo/types";

import {
  InfoTile,
  InsightCard,
  PanelTitle,
  StatusLine,
} from "../shared/apolo-ui";
import { formatCount, profileCount } from "../shared/apolo-utils";

export function DashboardScreen({
  dashboard,
  entities,
  loading,
}: {
  dashboard: ApoloDashboardData | null;
  entities: readonly ApoloEntity[];
  loading: boolean;
}) {
  const usuarioCount = profileCount(dashboard, "usuario");
  const linkedUsers = dashboard?.linkedUsersCount ?? 0;
  const notBuyerUsers = Math.max(usuarioCount - linkedUsers, 0);
  const reviewCount = dashboard?.pendingReviewCount ?? 0;
  const averageScore = entities.length
    ? Math.round(
        entities.reduce((total, entity) => total + entity.confidenceScore, 0) /
          entities.length,
      )
    : 0;

  return (
    <section className="grid min-h-0 flex-1 gap-3 overflow-y-auto">
      <ApoloProfileMetrics dashboard={dashboard} loading={loading} />
      <div className="grid gap-3 lg:grid-cols-4">
        <InsightCard
          icon={<Database className="size-4" aria-hidden="true" />}
          label="Base mestre"
          value={loading ? "--" : formatCount(dashboard?.totalCount ?? 0)}
          helper="Relacionamentos no Apolo"
        />
        <InsightCard
          icon={<CheckCircle2 className="size-4" aria-hidden="true" />}
          label="Usuarios compradores"
          value={loading ? "--" : formatCount(linkedUsers)}
          helper="Com vinculo comercial"
        />
        <InsightCard
          icon={<UsersRound className="size-4" aria-hidden="true" />}
          label="Usuarios nao compradores"
          value={loading ? "--" : formatCount(notBuyerUsers)}
          helper="Sem compra/vinculo confirmado"
        />
        <InsightCard
          icon={<ShieldCheck className="size-4" aria-hidden="true" />}
          label="Qualidade media"
          value={loading ? "--" : `${averageScore}%`}
          helper={`${formatCount(reviewCount)} cadastro(s) em revisao`}
        />
      </div>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)]">
        <section className="rounded-xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <PanelTitle eyebrow="Insights CRM" title="Leitura operacional da base" />
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <InfoTile label="Perfis comerciais" value={formatCount(profileCount(dashboard, "incorporador") + profileCount(dashboard, "imobiliaria") + profileCount(dashboard, "corretor"))} />
            <InfoTile label="Contatos cadastrados" value={formatCount(entities.reduce((total, entity) => total + entity.contacts.length, 0))} />
            <InfoTile label="Vinculos visiveis" value={formatCount(entities.reduce((total, entity) => total + entity.relationships.length, 0))} />
          </div>
        </section>
        <section className="rounded-xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <PanelTitle eyebrow="Proximas acoes" title="Fila de saneamento" />
          <div className="mt-4 grid gap-2">
            <StatusLine label={`${formatCount(notBuyerUsers)} usuario(s) sem compra confirmada`} status={notBuyerUsers ? "attention" : "verified"} />
            <StatusLine label={`${formatCount(reviewCount)} cadastro(s) pendente(s) de revisao`} status={reviewCount ? "pending" : "verified"} />
            <StatusLine label="Relatorios consolidados em preparacao" status="pending" />
          </div>
        </section>
      </div>
    </section>
  );
}

function ApoloProfileMetrics({
  dashboard,
  loading,
}: {
  dashboard: ApoloDashboardData | null;
  loading: boolean;
}) {
  const metrics = dashboard?.profileSummaries ?? [];

  return (
    <section className="grid shrink-0 grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-7">
      {metrics.map((metric) => {
        const Icon = getApoloProfileIcon(metric.profile);

        return (
          <MetricCard
            icon={<Icon className="size-4" aria-hidden="true" />}
            key={metric.profile}
            label={metric.label}
            loading={loading}
            value={metric.count}
          />
        );
      })}
      {!metrics.length
        ? Array.from({ length: 7 }).map((_, index) => (
            <MetricCard
              icon={<PanteonLoadingMark size="xs" />}
              key={index}
              label="Carregando"
              loading
              value={0}
            />
          ))
        : null}
    </section>
  );
}

function MetricCard({
  icon,
  label,
  loading,
  value,
}: {
  icon: ReactNode;
  label: string;
  loading: boolean;
  value: number;
}) {
  return (
    <article className="min-h-20 rounded-lg border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="m-0 text-xs font-medium text-slate-500">{label}</p>
          <p className="m-0 mt-2 text-xl font-semibold leading-none text-slate-950">
            {loading ? "--" : formatCount(value)}
          </p>
        </div>
        <span className="flex size-8 items-center justify-center rounded-lg bg-slate-50 text-[#A07C3B] ring-1 ring-slate-200/70">
          {icon}
        </span>
      </div>
    </article>
  );
}
