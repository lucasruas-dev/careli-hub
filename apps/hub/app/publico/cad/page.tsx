import type { Metadata, Viewport } from "next";

import { CadPublicoFlow } from "@/modules/publico/cad/CadPublicoFlow";

// Página PÚBLICA do formulário de CAD do corretor. Link enviável por WhatsApp, sem login.
//
// ⚠️ TEM QUE VIVER SOB /publico/. O gate de página não é o proxy.ts (ele só protege /api/*):
// é o providers/auth-provider.tsx, que libera por PREFIXO de pathname. Em /apolo/cad-externo o
// corretor seria redirecionado para /login.
//
// Server component, sem HubShell (o chrome do hub consome useAuth e não faz sentido aqui).
// Molde: app/publico/cads/[empreendimento]/page.tsx.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // noindex: é um canal operacional para parceiro, não conteúdo de busca.
  robots: { follow: false, index: false },
  title: "Enviar CAD | C2X",
};

export const viewport: Viewport = {
  initialScale: 1,
  // viewport-fit=cover é o que faz env(safe-area-inset-*) valer no iPhone.
  viewportFit: "cover",
  width: "device-width",
};

export default function CadPublicoRoute() {
  // O contato da central sai de env: número de atendimento muda, e trocar número não deveria
  // exigir deploy de código. Sem env configurada, cai no link genérico do WhatsApp.
  const numero = (process.env.PUBLICO_CENTRAL_WHATSAPP ?? "").replace(/\D/g, "");
  const whatsappCentral = numero ? `https://wa.me/${numero}` : "https://wa.me/";

  return <CadPublicoFlow whatsappCentral={whatsappCentral} />;
}
