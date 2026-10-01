import type { Metadata, Viewport } from "next";

import { listEmpreendimentosParaImobiliaria } from "@/lib/apolo/credenciamento";
import { createApoloAdminClient } from "@/lib/apolo/server";
import type { EmpreendimentoPublico } from "@/lib/publico/cad/regras";
import { AutonomoPublicoPortal } from "@/modules/publico/autonomo/AutonomoPublicoPortal";

// Página PÚBLICA do cadastro de corretor autônomo (o terceiro link, ao lado da CAD e da imobiliária).
// Pedido do Lucas, 01/10/2026: *"preciso criar o link publico igual temos da cad, imobiliaria"*.
//
// Server component, como a da imobiliária: a vitrine de empreendimentos é lida aqui, com credencial
// de servidor, e só o recorte mastigado chega ao browser. `force-dynamic` porque as logos são URLs
// assinadas com validade de 1h.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Cadastro de corretor autônomo | C2X",
};

export const viewport: Viewport = {
  initialScale: 1,
  viewportFit: "cover",
  width: "device-width",
};

export default async function AutonomoPublicoRoute() {
  const adminClient = createApoloAdminClient();
  let empreendimentos: EmpreendimentoPublico[] = [];

  if (adminClient) {
    try {
      // O MESMO portão da imobiliária (master + `recepcao_imobiliaria`): é a vitrine dos
      // empreendimentos abertos a parceiro novo. Aqui ela só recolhe interesse.
      empreendimentos = await listEmpreendimentosParaImobiliaria(adminClient);
    } catch {
      // Base fora do ar não derruba a página: o cadastro segue sem a lista.
      empreendimentos = [];
    }
  }

  return <AutonomoPublicoPortal empreendimentos={empreendimentos} />;
}
