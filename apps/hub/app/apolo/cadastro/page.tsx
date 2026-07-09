import { HubShell } from "@/layouts/hub-shell";
import { CadastroFlow } from "@/modules/apolo/blocks/cadastro/cadastro-flow";

export const dynamic = "force-dynamic";

export default function ApoloCadastroPage() {
  return (
    <HubShell chrome="operational" layoutMode="module">
      <CadastroFlow />
    </HubShell>
  );
}
