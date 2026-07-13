"use client";

import { Surface } from "@repo/uix";
import { AlertTriangle, CheckCircle2, Database, HardDriveDownload } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type BackfillResult = {
  failures: string[];
  migrated: number;
  pending: number;
  purgeable: number;
  purged: number;
};

// Faxina dos anexos legados (base64 no Postgres -> Storage). Aparece so quando
// ainda ha o que migrar ou o que liberar; some sozinho quando termina.
export function HelpDeskAttachmentMigrationCard({
  accessToken,
}: {
  accessToken: string | null;
}) {
  const [result, setResult] = useState<BackfillResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const call = useCallback(
    async (mode: "apply" | "dry-run" | "purge") => {
      if (!accessToken) {
        return null;
      }

      const response = await fetch("/api/hub/it-tickets/attachments-backfill", {
        body: JSON.stringify({ mode }),
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as
        | (BackfillResult & { error?: string })
        | null;

      if (!response.ok || !payload) {
        throw new Error(payload?.error ?? "Falha ao migrar os anexos.");
      }

      return payload;
    },
    [accessToken],
  );

  useEffect(() => {
    let isActive = true;

    void call("dry-run")
      .then((payload) => {
        if (isActive && payload) {
          setResult(payload);
        }
      })
      .catch(() => undefined);

    return () => {
      isActive = false;
    };
  }, [call]);

  async function run(mode: "apply" | "purge") {
    setError(null);
    setIsRunning(true);

    try {
      let payload = await call(mode);

      // `apply` trabalha em lotes; segue chamando ate a fila zerar.
      while (mode === "apply" && payload && payload.pending > 0) {
        if (payload.migrated === 0) {
          throw new Error(
            payload.failures[0] ?? "A migracao parou sem progresso.",
          );
        }

        setResult(payload);
        payload = await call(mode);
      }

      setResult(payload);
    } catch (runError) {
      setError(
        runError instanceof Error ? runError.message : "Falha na migracao.",
      );
    } finally {
      setIsRunning(false);
    }
  }

  if (!result || (result.pending === 0 && result.purgeable === 0)) {
    return null;
  }

  const isMigrating = result.pending > 0;

  return (
    <Surface bordered className="border-[#A07C3B]/25 bg-[#fffaf0] dark:bg-[#a07c3b]/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <Database className="mt-0.5 size-5 shrink-0 text-[#A07C3B]" />
          <div>
            <p className="m-0 text-sm font-semibold text-ink">
              {isMigrating
                ? `${result.pending} anexo(s) antigos ainda dentro do banco`
                : `${result.purgeable} anexo(s) ja no Storage, ocupando espaco em dobro`}
            </p>
            <p className="m-0 mt-1 text-xs text-ink-soft">
              {isMigrating
                ? "Eles continuam funcionando. Migrar move os arquivos pro Storage sem apagar nada."
                : "Os arquivos ja estao no Storage. Liberar remove a copia em base64 do Postgres."}
            </p>
          </div>
        </div>

        <button
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#A07C3B] bg-[#A07C3B] px-3 text-sm font-semibold text-white transition hover:bg-[#8f6f35] disabled:cursor-not-allowed disabled:opacity-55"
          disabled={isRunning}
          onClick={() => void run(isMigrating ? "apply" : "purge")}
          type="button"
        >
          <HardDriveDownload className="size-4" />
          {isRunning
            ? "Processando..."
            : isMigrating
              ? "Migrar para o Storage"
              : "Liberar espaco no banco"}
        </button>
      </div>

      {result.migrated > 0 || result.purged > 0 ? (
        <p className="m-0 mt-3 flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="size-4" />
          {result.migrated > 0
            ? `${result.migrated} anexo(s) migrados.`
            : `${result.purged} linha(s) liberadas.`}
        </p>
      ) : null}

      {error || result.failures.length > 0 ? (
        <p className="m-0 mt-3 flex items-start gap-2 text-xs font-semibold text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {error ?? result.failures.slice(0, 2).join(" / ")}
        </p>
      ) : null}
    </Surface>
  );
}
