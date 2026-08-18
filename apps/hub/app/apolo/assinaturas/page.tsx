import { HubShell } from "@/layouts/hub-shell";
import { AssinaturasView } from "@/modules/apolo/blocks/assinaturas/assinaturas-view";

export const dynamic = "force-dynamic";

// CONTRATOS — a tela de assinatura do portal do incorporador, trazida para dentro do Apolo
// (pedido do Lucas, 18/08/2026), com o painel clássico a um clique de distância.
//
// A rota continua sendo `/apolo/assinaturas`: o link circula em conversa e está no changelog. O
// NOME da tela é Contratos, que é o que ela mostra desde a fusão com a aba de contratos.
export default function AssinaturasPage() {
  return (
    <HubShell chrome="operational" layoutMode="module">
      <AssinaturasView />
    </HubShell>
  );
}
