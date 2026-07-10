import { HubShell } from "@/layouts/hub-shell";
import { EnrichmentLab } from "@/modules/apolo/blocks/enriquecimento/enrichment-lab";

export const dynamic = "force-dynamic";

export default function ApoloEnriquecimentoPage() {
  return (
    <HubShell chrome="operational" layoutMode="module">
      <EnrichmentLab />
    </HubShell>
  );
}
