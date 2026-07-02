"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Loader2 } from "lucide-react";

import { useAuth } from "@/providers/auth-provider";

/**
 * Moldura externa da PWA mobile: trava a altura em 100dvh, centraliza numa
 * largura de celular e segura o conteudo ate a sessao carregar. O AuthProvider
 * ja redireciona para /login quando nao ha sessao — aqui so evitamos renderizar
 * as telas (que carregam dados) antes do usuario existir.
 */
export function MobileViewport({ children }: { children: ReactNode }) {
  const { hubUser, profileStatus } = useAuth();
  const pathname = usePathname();
  const isLoginRoute = pathname === "/m/login";

  return (
    <div className="panteon-mobile-root mx-auto flex h-[100dvh] w-full max-w-[560px] flex-col overflow-hidden bg-[#f6f8fb] text-[#101820]">
      {hubUser || isLoginRoute ? (
        children
      ) : (
        <div className="grid flex-1 place-items-center px-8 text-center">
          <div className="grid justify-items-center gap-3 text-[#6b778c]">
            <Loader2 aria-hidden="true" className="animate-spin" size={26} />
            <p className="m-0 text-sm">
              {profileStatus === "error"
                ? "Nao foi possivel abrir a sessao. Faca login novamente."
                : "Carregando Panteon..."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
