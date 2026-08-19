import { HubShell } from "@/layouts/hub-shell";
import { CarteiraLsoft } from "@/modules/lsoft/CarteiraLsoft";

// `/lsoft` — a carteira do Garden e do Vale do Sol, vinda do LSoft da Cecílio Rocha.
//
// POC pedida pelo Lucas em 19/08/2026 para organizar esses dados antes de amarrá-los com Apolo e
// C2X. Fora do Apolo de propósito: aqui o dado é de OUTRO sistema e de outra empresa, e misturá-lo
// com a carteira da Careli antes de existir a regra de casamento confundiria as duas bases.
export const dynamic = "force-dynamic";

export default function LsoftPage() {
  return (
    <HubShell chrome="operational" layoutMode="module">
      <CarteiraLsoft />
    </HubShell>
  );
}
