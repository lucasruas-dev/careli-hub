import { HubShell } from "@/layouts/hub-shell";
import { PreviewSerasa } from "@/modules/apolo/blocks/serasa/preview-serasa";

export const dynamic = "force-dynamic";

// Tela de PREVIEW da analise de credito: o Lucas escolhe um documento da massa de teste, consulta
// o Serasa ao vivo (homologacao) e valida o que a integracao traz — antes de cravar o que vai
// pro cadastro. Consulta de verdade, com teto e historico (grava em serasa_consultas).
export default function SerasaPreviewPage() {
  return (
    <HubShell chrome="operational" layoutMode="module">
      <PreviewSerasa />
    </HubShell>
  );
}
