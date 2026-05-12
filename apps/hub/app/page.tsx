import { HubShell } from "@/layouts/hub-shell";
import { DatabaseStatusCard } from "@/components/database-status-card";
import { RealtimeOverview } from "@/components/realtime-overview";
import {
  getHubModuleStatusLabel,
  isHubModuleActive,
  orderedHubModules,
  type HubModuleStatus,
} from "@repo/shared";
import {
  Badge,
  Surface,
  WorkspaceHeader,
  WorkspaceLayout,
} from "@repo/uix";
import type { BadgeVariant } from "@repo/uix";

const moduleStatusBadgeVariant: Record<HubModuleStatus, BadgeVariant> = {
  active: "success",
  disabled: "neutral",
  locked: "warning",
  planned: "warning",
};

export default function HomePage() {
  const activeModulesCount = orderedHubModules.filter(isHubModuleActive).length;

  return (
    <HubShell>
      <WorkspaceLayout
        header={
          <WorkspaceHeader
            description="Shell operacional preparado para uma arquitetura desktop-first, realtime-first e futura composicao visual com packages/uix."
            eyebrow="Hub Central"
            title="Fundacao inicial do Careli Hub"
          />
        }
      >
        <Surface>
          <div className="max-w-3xl">
            <p className="m-0 text-sm leading-6 text-[var(--uix-text-muted)]">
              Shell operacional preparado para uma arquitetura desktop-first,
              realtime-first e futura composicao visual com packages/uix.
            </p>
          </div>
        </Surface>
        <DatabaseStatusCard />
        <Surface>
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <p className="m-0 text-sm font-semibold text-[var(--uix-text-primary)]">
                Modulos registrados
              </p>
              <p className="m-0 mt-1 text-xs text-[var(--uix-text-muted)]">
                Registry compartilhado em packages/shared.
              </p>
            </div>
            <Badge variant="neutral">{activeModulesCount} modulo ativo</Badge>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {orderedHubModules.map((hubModule) => {
              const isActive = isHubModuleActive(hubModule);

              return (
                <Surface
                  bordered
                  className={`grid min-h-40 gap-4 ${
                    isActive ? "border-[#A07C3B]/45 bg-[#A07C3B]/[0.04]" : ""
                  }`}
                  key={hubModule.id}
                  muted={!isActive}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="m-0 text-base font-semibold text-[var(--uix-text-primary)]">
                        {hubModule.name}
                      </p>
                      <p className="m-0 mt-1 text-xs uppercase text-[var(--uix-text-muted)]">
                        {hubModule.category}
                      </p>
                    </div>
                    <Badge variant={moduleStatusBadgeVariant[hubModule.status]}>
                      {getHubModuleStatusLabel(hubModule.status)}
                    </Badge>
                  </div>
                  <p className="m-0 text-sm leading-6 text-[var(--uix-text-muted)]">
                    {hubModule.description}
                  </p>
                  <div className="flex items-center justify-between gap-3 text-xs text-[var(--uix-text-muted)]">
                    {isActive ? (
                      <a
                        className="font-semibold text-[#8A682F] underline-offset-4 transition hover:text-[#5f461d] hover:underline"
                        href={hubModule.basePath}
                      >
                        Abrir {hubModule.name}
                      </a>
                    ) : (
                      <span>Em preparacao</span>
                    )}
                    <span>
                      {hubModule.realtimeEnabled ? "realtime" : "standard"}
                    </span>
                  </div>
                </Surface>
              );
            })}
          </div>
        </Surface>
        <RealtimeOverview />
      </WorkspaceLayout>
    </HubShell>
  );
}
