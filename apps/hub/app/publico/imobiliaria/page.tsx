import type { Metadata, Viewport } from "next";

import { listEmpreendimentosAtivos } from "@/lib/apolo/credenciamento";
import { createApoloAdminClient } from "@/lib/apolo/server";
import type { EmpreendimentoPublico } from "@/lib/publico/cad/regras";
import { ImobiliariaPublicoFlow } from "@/modules/publico/imobiliaria/ImobiliariaPublicoFlow";

// Página PÚBLICA do auto-cadastro de imobiliária (o segundo link).
//
// Server component: a lista de empreendimentos ativos é buscada aqui, com credencial de
// servidor, e só o recorte já mastigado chega ao browser. `force-dynamic` porque as logos são
// URLs assinadas com validade de 1h — a página não pode ser cacheada estaticamente.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Credenciamento de imobiliária | C2X",
};

export const viewport: Viewport = {
  initialScale: 1,
  viewportFit: "cover",
  width: "device-width",
};

export default async function ImobiliariaPublicoRoute() {
  const adminClient = createApoloAdminClient();
  let empreendimentos: EmpreendimentoPublico[] = [];

  if (adminClient) {
    try {
      empreendimentos = await listEmpreendimentosAtivos(adminClient);
    } catch {
      // Legado/Supabase fora do ar não pode derrubar a página: o cadastro segue sem a lista,
      // e a central completa a habilitação depois.
      empreendimentos = [];
    }
  }

  return <ImobiliariaPublicoFlow empreendimentos={empreendimentos} />;
}
