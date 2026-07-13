import { HubShell } from "@/layouts/hub-shell";
import { PrometeuModule } from "@/modules/prometeu/prometeu-module";

export const dynamic = "force-dynamic";

// Prometeu (gestao de fila do lancamento) entra no hub como modulo, seguindo o padrao
// dos outros: rail de telas a esquerda + conteudo a direita. As telas sao o mockup
// servido de /public/prometeu. Proximo passo real = telas React + tabelas prometeu_*.
export default function PrometeuModulePage() {
  return (
    <HubShell chrome="operational" layoutMode="module">
      <PrometeuModule />
    </HubShell>
  );
}
