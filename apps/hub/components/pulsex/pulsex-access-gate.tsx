"use client";

import { useAuth } from "@/providers/auth-provider";
import { canAccessModule, type HubModule } from "@repo/shared";
import { EmptyState, Surface, WorkspaceHeader, WorkspaceLayout } from "@repo/uix";
import { PulseXWorkspace } from "./pulsex-workspace";

type PulseXAccessGateProps = {
  module: HubModule;
};

export function PulseXAccessGate({ module }: PulseXAccessGateProps) {
  const { hubUser } = useAuth();

  if (!hubUser || !canAccessModule(hubUser, module)) {
    return (
      <WorkspaceLayout
        header={
          <WorkspaceHeader
            description="Seu usuario nao possui permissao para acessar este modulo."
            eyebrow="operations"
            title="PulseX"
          />
        }
      >
        <Surface>
          <EmptyState
            description="Solicite acesso a um administrador do workspace para visualizar o PulseX."
            title="Acesso negado"
          />
        </Surface>
      </WorkspaceLayout>
    );
  }

  return <PulseXWorkspace />;
}
