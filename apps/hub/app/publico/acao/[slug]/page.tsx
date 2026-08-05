import type { Metadata, Viewport } from "next";

import { AcaoPublicoPortal } from "@/modules/publico/acao/AcaoPublicoPortal";

// Página PÚBLICA da ação de contato: a equipe (inclusive freela sem conta do hub) entra pelo link
// da campanha + senha, sem login do hub.
//
// ⚠️ TEM QUE VIVER SOB /publico/. O gate de página não é o proxy.ts (ele só protege /api/*): é o
// providers/auth-provider.tsx, que libera por PREFIXO de pathname (/publico/*). Em qualquer outra
// rota o usuário sem sessão seria redirecionado para /login. Molde: app/publico/cad/page.tsx.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // noindex: canal operacional da equipe, não conteúdo de busca.
  robots: { follow: false, index: false },
  title: "Ação de contato | C2X",
};

export const viewport: Viewport = {
  initialScale: 1,
  viewportFit: "cover",
  width: "device-width",
};

export default async function AcaoPublicaRoute({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <AcaoPublicoPortal slug={slug} />;
}
