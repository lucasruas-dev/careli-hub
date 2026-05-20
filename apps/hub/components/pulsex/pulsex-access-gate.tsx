"use client";

import { useAuth } from "@/providers/auth-provider";
import { canAccessModule, type HubModule } from "@repo/shared";
import { EmptyState, Surface, WorkspaceHeader, WorkspaceLayout } from "@repo/uix";
import { HermesWorkspace } from "./pulsex-workspace";

type HermesAccessGateProps = {
  module: HubModule;
};

export function HermesAccessGate({ module }: HermesAccessGateProps) {
  const { hubUser } = useAuth();
  const moduleName = module.name;

  if (!hubUser || !canAccessModule(hubUser, module)) {
    return (
      <WorkspaceLayout
        header={
          <WorkspaceHeader
            description="Seu usuario nao possui permissao para acessar este modulo."
            eyebrow="operations"
            title={moduleName}
          />
        }
      >
        <Surface>
          <EmptyState
            description={`Solicite acesso a um administrador do workspace para visualizar o ${moduleName}.`}
            title="Acesso negado"
          />
        </Surface>
      </WorkspaceLayout>
    );
  }

  return <HermesWorkspace />;
}
