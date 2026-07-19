import { HubShell } from "@/layouts/hub-shell";
import { CredenciamentoFlow } from "@/modules/apolo/blocks/credenciamento/credenciamento-flow";

export const dynamic = "force-dynamic";

// Portal de credenciamento de imobiliárias. Hoje roda dentro do hub (autenticado) pra validação;
// o acesso externo (link enviado à imobiliária, sem login) é frente separada — depende do RBAC
// de acessos externos. Ver [[project_apolo_acessos_externos]].
export default function ApoloCredenciamentoPage() {
  return (
    <HubShell chrome="operational" layoutMode="module">
      <CredenciamentoFlow />
    </HubShell>
  );
}
