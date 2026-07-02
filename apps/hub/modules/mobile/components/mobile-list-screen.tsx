"use client";

import type { ReactNode } from "react";

import { MobileTopBar } from "@/modules/mobile/components/mobile-top-bar";

// Casca das telas de LISTA (fila do Iris / canais do Hermes): barra superior fixa
// (avatar + abas + sino) e conteúdo rolável. As telas de conversa NÃO usam isto —
// elas montam o próprio cabeçalho de chat + compositor em tela cheia.
export function MobileListScreen({
  children,
  subheader,
}: {
  children: ReactNode;
  subheader?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      <MobileTopBar />
      {subheader}
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {children}
      </main>
    </div>
  );
}
