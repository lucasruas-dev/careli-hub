import { HermesAccessGate } from "@/components/pulsex";
import { HubShell } from "@/layouts/hub-shell";
import { getHubModuleById, isHubModuleActive } from "@repo/shared";
import { EmptyState, Surface, WorkspaceHeader, WorkspaceLayout } from "@repo/uix";
import { notFound } from "next/navigation";

export default function HermesPage() {
  const pantheonModule = getHubModuleById("hermes");

  if (!pantheonModule) {
    notFound();
  }

  if (!isHubModuleActive(pantheonModule)) {
    return (
      <HubShell layoutMode="module">
        <WorkspaceLayout
          header={
            <WorkspaceHeader
              description="Este modulo esta bloqueado enquanto a operacao real e preparada."
              eyebrow="operations"
              title="Hermes"
            />
          }
        >
          <Surface>
            <EmptyState
              description="O modulo aparecera na sidebar como desabilitado ate ser liberado para uso."
              title="Hermes em preparacao"
            />
          </Surface>
        </WorkspaceLayout>
      </HubShell>
    );
  }

  return (
    <HubShell chrome="operational" layoutMode="module">
      <HermesAccessGate module={pantheonModule} />
    </HubShell>
  );
}
