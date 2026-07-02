import type { Metadata } from "next";
import type { ReactNode } from "react";

import { MobileViewport } from "@/modules/mobile/components/mobile-viewport";

// MVP mobile do Panteon (Notificacoes + Iris + Hermes). Rotas ADITIVAS sob /m,
// reaproveitando os providers globais (AppProviders) do layout raiz.
export const dynamic = "force-dynamic";

// Manifest DEDICADO do mobile: instalado, abre em /m (fila do Iris) em standalone
// (sem barra de URL). Sobrescreve o manifest do root só nas rotas /m.
export const metadata: Metadata = {
  manifest: "/api/pwa/manifest-mobile",
};

export default function MobileLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return <MobileViewport>{children}</MobileViewport>;
}
