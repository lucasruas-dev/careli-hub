import { HubShell } from "@/layouts/hub-shell";
import { SyncC2xView } from "@/modules/apolo/blocks/sync-c2x/sync-c2x-view";

export const dynamic = "force-dynamic";

// Lote de cadastros Apolo -> C2X. Diagnostica o que falta em cada CAD (a lista de trabalho do
// time) e envia as prontas ao C2X. Ver docs/architecture/c2x-api-escrita-diagnostico.md.
export default function ApoloSyncC2xPage() {
  return (
    <HubShell chrome="operational" layoutMode="module">
      <SyncC2xView />
    </HubShell>
  );
}
