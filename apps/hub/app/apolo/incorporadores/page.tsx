import { HubShell } from "@/layouts/hub-shell";
import { GestaoIncorporadores } from "@/modules/apolo/blocks/incorporadores/gestao-incorporadores";

export const dynamic = "force-dynamic";

// Ferramenta INTERNA: criar o incorporador, dizer quais empreendimentos ele enxerga e abrir as
// contas de login do portal dele. Antes disso o caminho era INSERT manual no Supabase.
// Ver [[project_apolo_acesso_incorporador]].
export default function IncorporadoresPage() {
  return (
    <HubShell chrome="operational" layoutMode="module">
      <GestaoIncorporadores />
    </HubShell>
  );
}
