import type { Metadata, Viewport } from "next";

import { createApoloAdminClient } from "@/lib/apolo/server";
import { verificarComprovante } from "@/lib/serasa/comprovante";
import { VerificarComprovante } from "@/modules/publico/verificar/VerificarComprovante";

// Página PÚBLICA de verificação do comprovante de crédito (o QR aponta para cá). Confere a
// autenticidade sem login; os DETALHES de crédito só abrem com a senha do empreendimento.
//
// ⚠️ TEM QUE VIVER SOB /publico/ (o gate de página é o auth-provider, não o proxy). Server
// component, sem HubShell. Molde: app/publico/cad/page.tsx.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Verificar comprovante | C2X",
};

export const viewport: Viewport = {
  initialScale: 1,
  viewportFit: "cover",
  width: "device-width",
};

export default async function VerificarRoute({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const { c } = await searchParams;
  const token = (c ?? "").trim();

  const client = createApoloAdminClient();
  const r = client
    ? await verificarComprovante(client, token)
    : { autentico: false as const, error: "Verificacao indisponivel." };

  return (
    <VerificarComprovante
      autentico={r.autentico}
      documento={"documento" in r ? r.documento : null}
      emitidoEm={"emitidoEm" in r ? r.emitidoEm : null}
      empreendimento={"empreendimento" in r ? r.empreendimento : null}
      erro={r.error ?? null}
      operador={"operador" in r ? r.operador : null}
      protocolo={"protocolo" in r ? r.protocolo : null}
      tipoPessoa={"tipoPessoa" in r ? r.tipoPessoa : null}
    />
  );
}
