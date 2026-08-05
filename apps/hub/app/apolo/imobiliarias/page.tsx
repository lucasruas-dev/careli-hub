import { HubShell } from "@/layouts/hub-shell";
import { VincularImobiliarias } from "@/modules/apolo/blocks/imobiliarias/vincular-imobiliarias";

export const dynamic = "force-dynamic";

// Ferramenta INTERNA: casar cada imobiliária que aparece nas CADs com o cadastro (entidade) dela
// no Apolo. É a base do vínculo por entidade — e da Central de CADs que as imobiliárias vão
// acessar. Ver [[project_apolo_acessos_externos]].
export default function VincularImobiliariasPage() {
  return (
    <HubShell chrome="operational" layoutMode="module">
      <VincularImobiliarias />
    </HubShell>
  );
}
