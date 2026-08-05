import { HubShell } from "@/layouts/hub-shell";
import { PreviewAsaas } from "@/modules/apolo/blocks/asaas/preview-asaas";

export const dynamic = "force-dynamic";

// BANCADA de teste do Asaas (pré-venda, conta Gurgel): testar a comunicação, gerar um PIX real,
// pagar e observar o comportamento (QR/expiração + eventos do webhook). Ver [[project_asaas_prevenda]].
export default function AsaasPreviewPage() {
  return (
    <HubShell chrome="operational" layoutMode="module">
      <PreviewAsaas />
    </HubShell>
  );
}
