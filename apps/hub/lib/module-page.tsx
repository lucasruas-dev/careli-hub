import { HubShell } from "@/layouts/hub-shell";
import { mockHubUserContext } from "@/lib/auth-state";
import {
  canAccessModule,
  getHubModuleById,
  getHubModuleStatusLabel,
  isHubModuleActive,
  type HubModule,
  type HubModuleStatus,
} from "@repo/shared";
import {
  Badge,
  EmptyState,
  RealtimePulse,
  Surface,
  WorkspaceHeader,
  WorkspaceLayout,
} from "@repo/uix";
import type { BadgeVariant, RealtimePulseState } from "@repo/uix";
import { notFound } from "next/navigation";

const moduleStatusBadgeVariant: Record<HubModuleStatus, BadgeVariant> = {
  active: "success",
  disabled: "neutral",
  locked: "warning",
  planned: "warning",
};

function getRealtimeState(module: HubModule): RealtimePulseState {
  if (!module.realtimeEnabled) {
    return "idle";
  }

  return isHubModuleActive(module) ? "live" : "syncing";
}

export function createModulePage(moduleId: string) {
  const hubModule = getHubModuleById(moduleId);

  if (!hubModule) {
    notFound();
  }

  if (!isHubModuleActive(hubModule)) {
    return (
      <HubShell layoutMode="module">
        <WorkspaceLayout
          header={
            <WorkspaceHeader
              actions={<Badge variant="warning">Em preparacao</Badge>}
              description="Este modulo esta bloqueado enquanto a operacao real e preparada."
              eyebrow={hubModule.category}
              title={hubModule.name}
            />
          }
        >
          <Surface>
            <EmptyState
              description="O modulo aparecera na sidebar como desabilitado ate ser liberado para uso."
              title={`${hubModule.name} em preparacao`}
            />
          </Surface>
        </WorkspaceLayout>
      </HubShell>
    );
  }

  if (!canAccessModule(mockHubUserContext, hubModule)) {
    return (
      <HubShell layoutMode="module">
        <WorkspaceLayout
          header={
            <WorkspaceHeader
              description="Seu usuario nao possui permissao para acessar este modulo."
              eyebrow={hubModule.category}
              title={hubModule.name}
            />
          }
        >
          <Surface>
            <EmptyState
              description="Solicite acesso a um administrador do workspace para visualizar este modulo."
              title="Acesso negado"
            />
          </Surface>
        </WorkspaceLayout>
      </HubShell>
    );
  }

  return (
    <HubShell layoutMode="module">
      <WorkspaceLayout
        header={
          <WorkspaceHeader
            actions={
              <Badge variant={moduleStatusBadgeVariant[hubModule.status]}>
                {getHubModuleStatusLabel(hubModule.status)}
              </Badge>
            }
            description={hubModule.description}
            eyebrow={hubModule.category}
            meta={
              <RealtimePulse
                label={hubModule.realtimeEnabled ? "Realtime ready" : "Standard"}
                state={getRealtimeState(hubModule)}
              />
            }
            title={hubModule.name}
          />
        }
      >
        <div className="grid grid-cols-[minmax(0,1fr)_22rem] gap-6">
          <Surface>
            <EmptyState
              description="Esta rota ja existe no Hub, mas o modulo real ainda nao foi implementado."
              title={`${hubModule.name} em preparacao`}
            />
          </Surface>
          <Surface muted>
            <div className="grid gap-4">
              <div>
                <p className="m-0 text-sm font-semibold text-[var(--uix-text-primary)]">
                  Contrato do modulo
                </p>
                <p className="m-0 mt-1 text-xs text-[var(--uix-text-muted)]">
                  Dados vindos do registry compartilhado.
                </p>
              </div>
              <dl className="m-0 grid gap-3 text-sm">
                <div>
                  <dt className="text-xs uppercase text-[var(--uix-text-muted)]">
                    Base path
                  </dt>
                  <dd className="m-0 text-[var(--uix-text-primary)]">
                    {hubModule.basePath}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-[var(--uix-text-muted)]">
                    Categoria
                  </dt>
                  <dd className="m-0 text-[var(--uix-text-primary)]">
                    {hubModule.category}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-[var(--uix-text-muted)]">
                    Realtime
                  </dt>
                  <dd className="m-0 text-[var(--uix-text-primary)]">
                    {hubModule.realtimeEnabled ? "enabled" : "disabled"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-[var(--uix-text-muted)]">
                    Permissao
                  </dt>
                  <dd className="m-0 text-[var(--uix-text-primary)]">
                    {hubModule.requiredPermissions.join(", ")}
                  </dd>
                </div>
              </dl>
            </div>
          </Surface>
        </div>
      </WorkspaceLayout>
    </HubShell>
  );
}
