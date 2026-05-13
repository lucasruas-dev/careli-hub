import { PulseXAccessGate } from "@/components/pulsex";
import { HubShell } from "@/layouts/hub-shell";
import { getHubModuleById, isHubModuleActive } from "@repo/shared";
import { EmptyState, Surface, WorkspaceHeader, WorkspaceLayout } from "@repo/uix";
import { notFound } from "next/navigation";

export default function PulseXPage() {
  const hubModule = getHubModuleById("pulsex");

  if (!hubModule) {
    notFound();
  }

  if (!isHubModuleActive(hubModule)) {
    return (
      <HubShell layoutMode="module">
        <WorkspaceLayout
          header={
            <WorkspaceHeader
              description="Este modulo esta bloqueado enquanto a operacao real e preparada."
              eyebrow="operations"
              title="PulseX"
            />
          }
        >
          <Surface>
            <EmptyState
              description="O modulo aparecera na sidebar como desabilitado ate ser liberado para uso."
              title="PulseX em preparacao"
            />
          </Surface>
        </WorkspaceLayout>
      </HubShell>
    );
  }

  return (
    <HubShell chrome="operational" layoutMode="module">
      <PulseXAccessGate module={hubModule} />
    </HubShell>
  );
}
