"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Tooltip } from "@repo/uix";

import { PANTEON_VERSION } from "@/lib/build-info";

// Aviso "Nova versao - Atualizar" no topo. Compara a versao "cozida" neste bundle
// (PANTEON_VERSION) com a versao atual do servidor (/api/version). Quando saiu deploy
// novo, mostra uma pilula dourada ao lado do sino; um clique recarrega e pega o bundle
// novo (o navegador/PWA cacheiam o app carregado ate o reload). So aparece quando ha
// diferenca real de versao — invisivel no dia a dia.
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 min: leve, respeita a regra de custo

export function PanteonUpdatePill({ onDark = false }: { onDark?: boolean }) {
  const [nextVersion, setNextVersion] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function check() {
      if (typeof document !== "undefined" && document.hidden) {
        return;
      }

      try {
        const response = await fetch("/api/version", { cache: "no-store" });

        if (!response.ok) {
          return;
        }

        const data = (await response.json()) as { version?: unknown };
        const serverVersion =
          typeof data.version === "string" ? data.version : null;

        if (active && serverVersion && serverVersion !== PANTEON_VERSION) {
          setNextVersion(serverVersion);
        }
      } catch {
        // rede instavel: tenta de novo no proximo ciclo (sem barulho).
      }
    }

    void check();
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    const intervalId = window.setInterval(check, POLL_INTERVAL_MS);

    return () => {
      active = false;
      window.removeEventListener("focus", onFocus);
      window.clearInterval(intervalId);
    };
  }, []);

  if (!nextVersion) {
    return null;
  }

  return (
    <Tooltip content={`Atualizar para ${nextVersion}`} placement="bottom">
      <button
        aria-label={`Nova versao disponivel (${nextVersion}). Clique para atualizar.`}
        className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-[#A07C3B] ${
          onDark
            ? "border-[#c9a253]/50 bg-[#A07C3B]/25 text-[#f0dcb3] hover:bg-[#A07C3B]/40"
            : "border-[#A07C3B]/40 bg-[#A07C3B]/10 text-[#7a5b25] hover:bg-[#A07C3B]/20"
        }`}
        onClick={() => window.location.reload()}
        type="button"
      >
        <RefreshCw aria-hidden="true" size={14} />
        <span className="hidden sm:inline">Nova versão</span>
      </button>
    </Tooltip>
  );
}
