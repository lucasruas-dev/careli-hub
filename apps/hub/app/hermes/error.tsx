"use client";

import Link from "next/link";
import { AlertTriangle, RefreshCcw, Trash2 } from "lucide-react";
import { useEffect } from "react";

const HERMES_RECOVERY_STORAGE_PREFIXES = ["careli:pulsex", "careli:hermes"];
const FALLBACK_ERROR_MESSAGE = "Codigo tecnico indisponivel";

function getRecoveryStorage(kind: "local" | "session") {
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return undefined;
  }
}

function clearHermesStorage(kind: "local" | "session") {
  const storage = getRecoveryStorage(kind);

  if (!storage) {
    return;
  }

  try {
    const keysToRemove: string[] = [];

    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);

      if (
        key &&
        HERMES_RECOVERY_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))
      ) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach((key) => storage.removeItem(key));
  } catch {
    // Recovery is best-effort. If storage is blocked, reset still gives the app a chance.
  }
}

export default function HermesError({
  error,
  reset,
}: Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
}>) {
  const safeErrorMessage = getSafeErrorMessage(error);

  useEffect(() => {
    console.error("[Hermes] client route error captured", {
      digest: error.digest ?? null,
      message: safeErrorMessage,
    });
  }, [error.digest, safeErrorMessage]);

  function handleClearLocalState() {
    clearHermesStorage("local");
    clearHermesStorage("session");
    reset();

    window.setTimeout(() => {
      window.location.reload();
    }, 50);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f4f7fa] px-6 py-10 text-[#101820]">
      <section className="w-full max-w-2xl rounded-lg border border-[#d9e0e7] bg-white p-8 shadow-[0_24px_80px_rgba(16,24,32,0.14)]">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[#fff7e8] text-[#A07C3B]">
            <AlertTriangle aria-hidden="true" size={24} />
          </div>
          <div className="min-w-0 space-y-3">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-[#A07C3B]">
              Hermes
            </p>
            <h1 className="text-2xl font-black tracking-[-0.03em] text-[#101820]">
              Falha ao carregar o Hermes
            </h1>
            <p className="text-sm leading-6 text-[#53627a]">
              Protegemos a operacao, mas este navegador encontrou um erro local ao
              abrir o modulo. Tente recarregar primeiro. Se repetir, limpe apenas
              o estado local do Hermes neste dispositivo.
            </p>
          </div>
        </div>

        <div className="mt-6 rounded-md border border-[#e5ebf0] bg-[#f7f9fb] p-4 text-xs font-semibold text-[#53627a]">
          {error.digest
            ? `Codigo tecnico: ${error.digest}`
            : safeErrorMessage || FALLBACK_ERROR_MESSAGE}
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            className="inline-flex items-center gap-2 rounded-md bg-[#101820] px-4 py-2.5 text-sm font-black text-white shadow-sm transition hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
            onClick={reset}
            type="button"
          >
            <RefreshCcw aria-hidden="true" size={16} />
            Tentar novamente
          </button>
          <button
            className="inline-flex items-center gap-2 rounded-md border border-[#d9e0e7] bg-white px-4 py-2.5 text-sm font-black text-[#101820] transition hover:border-[#A07C3B] hover:text-[#A07C3B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
            onClick={handleClearLocalState}
            type="button"
          >
            <Trash2 aria-hidden="true" size={16} />
            Limpar estado local
          </button>
          <Link
            className="inline-flex items-center rounded-md border border-transparent px-4 py-2.5 text-sm font-black text-[#53627a] transition hover:text-[#101820] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
            href="/"
          >
            Ir para Home
          </Link>
        </div>
      </section>
    </main>
  );
}

function getSafeErrorMessage(error: Error & { digest?: string }) {
  const name = sanitizeErrorText(error.name || "Erro");
  const message = sanitizeErrorText(error.message || "");

  if (!message) {
    return "";
  }

  return `${name}: ${message}`.slice(0, 180);
}

function sanitizeErrorText(value: string) {
  return value
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      "[id]",
    )
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[redacted]")
    .trim();
}
