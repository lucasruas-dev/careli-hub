"use client";

import { useState } from "react";

import {
  PANTEON_CHANGELOG,
  type ChangelogEntry,
  type ChangelogType,
} from "@/lib/changelog/changelog";
import { PanelTitle } from "@/modules/squadops/blocks/shared/operations-ui";
import { ChevronDown, RotateCcw, Rocket } from "lucide-react";

const typeVisual: Record<
  ChangelogType,
  { chip: string; emoji: string; label: string }
> = {
  correcao: {
    chip: "bg-rose-50 dark:bg-rose-500/12 text-rose-700 dark:text-rose-300 ring-rose-200/70 dark:ring-rose-500/25",
    emoji: "🐛",
    label: "Correção",
  },
  melhoria: {
    chip: "bg-amber-50 dark:bg-amber-500/12 text-amber-700 dark:text-amber-300 ring-amber-200/70 dark:ring-amber-500/25",
    emoji: "✨",
    label: "Melhoria",
  },
  novidade: {
    chip: "bg-emerald-50 dark:bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 ring-emerald-200/70 dark:ring-emerald-500/25",
    emoji: "🚀",
    label: "Novidade",
  },
};

function formatDateTime(iso: string) {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yy = String(date.getFullYear()).slice(2);
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");

  return `${dd}/${mm}/${yy} ${hh}:${mi}`;
}

export function DeployView() {
  const entries = PANTEON_CHANGELOG;
  const current = entries[0];
  const [expandedVersion, setExpandedVersion] = useState<string | null>(
    current?.version ?? null,
  );

  return (
    <div className="flex flex-col gap-4">
      <PanelTitle
        eyebrow="Operations Center"
        icon={<Rocket className="size-5" />}
        title="Deploy"
      />

      {current ? (
        <div className="rounded-2xl border border-[#A07C3B]/30 bg-[#A07C3B]/[0.06] p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-[#7a5e2c] dark:text-[#d9b877]">
            No ar · produção
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono text-2xl font-bold leading-none text-[#7a5e2c] dark:text-[#d9b877]">
              {current.version}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${typeVisual[current.type].chip}`}
            >
              {typeVisual[current.type].emoji} {typeVisual[current.type].label}
            </span>
            <span className="text-xs text-ink-muted">
              desde {formatDateTime(current.deployedAt)}
            </span>
          </div>
          <p className="m-0 mt-1.5 text-sm font-medium text-ink">
            {current.title}
          </p>
          {current.rollback ? (
            <p className="m-0 mt-1 inline-flex items-center gap-1 text-[11px] text-ink-muted">
              <RotateCcw className="size-3" />
              rollback: <code className="text-ink-muted">{current.rollback}</code>
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-2xl border border-line bg-surface p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <p className="m-0 mb-3 text-xs font-semibold text-ink-muted">
          Histórico de deploys
        </p>
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {entries.map((entry) => (
            <DeployEntryCard
              entry={entry}
              expanded={expandedVersion === entry.version}
              key={entry.version}
              onToggle={() =>
                setExpandedVersion((current) =>
                  current === entry.version ? null : entry.version,
                )
              }
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

function DeployEntryCard({
  entry,
  expanded,
  onToggle,
}: {
  entry: ChangelogEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const tone = typeVisual[entry.type];

  return (
    <li className="overflow-hidden rounded-xl border border-line bg-surface">
      <button
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left outline-none transition hover:bg-subtle focus-visible:bg-subtle"
        onClick={onToggle}
        type="button"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono text-sm font-bold text-ink">
              {entry.version}
            </span>
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${tone.chip}`}
            >
              {tone.emoji} {tone.label}
            </span>
            <span className="text-[11px] text-ink-muted">
              {formatDateTime(entry.deployedAt)}
            </span>
          </div>
          <p className="m-0 mt-0.5 truncate text-sm font-medium text-ink">
            {entry.title}
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {entry.modules.map((module) => (
              <span
                className="rounded-md bg-subtle px-1.5 py-0.5 text-[10px] font-semibold text-ink-muted"
                key={module.module}
              >
                {module.module}
              </span>
            ))}
          </div>
        </div>
        <ChevronDown
          className={`size-4 shrink-0 text-ink-muted transition ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      {expanded ? (
        <div className="border-t border-line px-3 py-3">
          {/* Para o time: Modulo (bloco) -> Tela (subtitulo) -> bullets (acoes) */}
          <div className="flex flex-col gap-3">
            {entry.modules.map((module) => (
              <div key={module.module}>
                <p className="m-0 text-sm font-bold text-ink">
                  {module.module}
                </p>
                <div className="mt-1 flex flex-col gap-2">
                  {module.screens.map((screen) => (
                    <div key={screen.screen}>
                      <p className="m-0 text-xs font-semibold text-[#7a5e2c] dark:text-[#d9b877]">
                        {screen.screen}
                      </p>
                      <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0">
                        {screen.items.map((item, index) => (
                          <li
                            className="flex gap-1.5 text-[13px] leading-snug text-ink-soft"
                            key={index}
                          >
                            <span className="mt-1.5 size-1 shrink-0 rounded-full bg-[#A07C3B]" />
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Tecnico (so no Zeus) */}
          <div className="mt-3 rounded-lg bg-subtle p-3 text-xs leading-relaxed text-ink-soft ring-1 ring-line">
            <p className="m-0">
              <span className="font-semibold text-ink-muted">Motivo:</span>{" "}
              {entry.technical.motivation}
            </p>
            <p className="m-0 mt-1">
              <span className="font-semibold text-ink-muted">
                O que foi feito:
              </span>{" "}
              {entry.technical.done}
            </p>
            <p className="m-0 mt-1 text-[11px] text-ink-muted">
              build <code className="text-ink-muted">{entry.buildTag}</code>
              {entry.rollback ? (
                <>
                  {" · "}rollback{" "}
                  <code className="text-ink-muted">{entry.rollback}</code>
                </>
              ) : null}
            </p>
          </div>
        </div>
      ) : null}
    </li>
  );
}
