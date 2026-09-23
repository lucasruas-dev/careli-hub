import { HubShell } from "@/layouts/hub-shell";
import { PainelDefasagem } from "@/modules/apolo/blocks/defasagem/painel-defasagem";

export const dynamic = "force-dynamic";

// PARCELAS A CORRIGIR (`/apolo/defasagem`) — os contratos cuja parcela futura ficou no valor
// antigo, porque a correção só alcança a parcela quando o boleto dela é emitido.
//
// A rota se chama `defasagem` (o termo técnico, que não muda) e a TELA se chama "Parcelas a
// corrigir", que é o que a pessoa vai fazer com ela.
export default function DefasagemPage() {
  return (
    <HubShell chrome="operational" layoutMode="module">
      <PainelDefasagem />
    </HubShell>
  );
}
