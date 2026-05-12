import { PulseXWorkspace } from "@/components/pulsex";
import { HubShell } from "@/layouts/hub-shell";
import { mockHubUserContext } from "@/lib/auth-state";
import { canAccessModule, getHubModuleById } from "@repo/shared";
import { EmptyState, Surface, WorkspaceHeader, WorkspaceLayout } from "@repo/uix";
import { notFound } from "next/navigation";

export default function PulseXPage() {
  const hubModule = getHubModuleById("pulsex");

  if (!hubModule) {
    notFound();
  }

  if (!canAccessModule(mockHubUserContext, hubModule)) {
    return (
      <HubShell layoutMode="module">
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
      </HubShell>
    );
  }

  return (
    <HubShell chrome="operational" layoutMode="module">
      <PulseXWorkspace />
    </HubShell>
  );
}
