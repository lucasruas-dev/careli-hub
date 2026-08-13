import { HubShell } from "@/layouts/hub-shell";
import { PainelAssinatura } from "@/modules/apolo/blocks/assinaturas/painel-assinatura";

export const dynamic = "force-dynamic";

// Painel de assinatura de contratos do Vale do Ouro, no lugar do Painel Assinatura do Power BI.
// As regras vieram do .pbit e estão em docs/operations/c2x-painel-assinatura-dax.md.
export default function AssinaturasPage() {
  return (
    <HubShell chrome="operational" layoutMode="module">
      <PainelAssinatura />
    </HubShell>
  );
}
