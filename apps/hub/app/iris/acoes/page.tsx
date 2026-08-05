import { HubShell } from "@/layouts/hub-shell";
import { AcoesView } from "@/modules/caredesk/blocks/acoes/acoes-view";

// A aba AÇÕES da Iris (contato em massa), separada da fila de atendimento.
export const dynamic = "force-dynamic";

export default function AcoesPage() {
  return (
    <HubShell chrome="operational" layoutMode="module">
      <AcoesView />
    </HubShell>
  );
}
