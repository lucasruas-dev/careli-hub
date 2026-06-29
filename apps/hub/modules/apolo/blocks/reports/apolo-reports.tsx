import { BarChart3, Clock3, ShieldCheck } from "lucide-react";

import type { ApoloDashboardData, ApoloEntity } from "@/lib/apolo/types";

import { InsightCard, PanelTitle } from "../shared/apolo-ui";
import { formatCount } from "../shared/apolo-utils";

export function ReportsScreen({
  dashboard,
  entities,
  loading,
}: {
  dashboard: ApoloDashboardData | null;
  entities: readonly ApoloEntity[];
  loading: boolean;
}) {
  return (
    <section className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto">
      <div className="grid gap-3 md:grid-cols-3">
        <InsightCard
          icon={<BarChart3 className="size-4" aria-hidden="true" />}
          label="Relatorio de perfis"
          value={loading ? "--" : formatCount(dashboard?.profileSummaries.length ?? 0)}
          helper="Distribuicao por relacionamento"
        />
        <InsightCard
          icon={<ShieldCheck className="size-4" aria-hidden="true" />}
          label="Qualidade"
          value={loading ? "--" : formatCount(dashboard?.pendingReviewCount ?? 0)}
          helper="Cadastros em revisao"
        />
        <InsightCard
          icon={<Clock3 className="size-4" aria-hidden="true" />}
          label="Timeline"
          value={formatCount(entities.reduce((total, entity) => total + entity.timeline.length, 0))}
          helper="Eventos consolidados"
        />
      </div>
      <section className="overflow-hidden rounded-xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="border-b border-slate-100 px-5 py-4">
          <PanelTitle eyebrow="Relatorios" title="Consultas preparadas" />
        </div>
        <div className="divide-y divide-slate-100">
          {[
            ["Base por perfil", "Quantidade de usuarios, incorporadores, imobiliarias, corretores e colaboradores."],
            ["Qualidade cadastral", "Documentos, contatos, enderecos e vinculos pendentes de revisao."],
            ["Carteira e vinculos", "Usuarios compradores, nao compradores e origem comercial."],
            ["Timeline operacional", "Eventos com protocolo e informativos por relacionamento."],
          ].map(([title, description]) => (
            <div className="grid gap-1 px-5 py-4" key={title}>
              <p className="m-0 text-sm font-semibold text-slate-950">{title}</p>
              <p className="m-0 text-sm font-medium text-slate-500">{description}</p>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}
