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
    chip: "bg-rose-50 text-rose-700 ring-rose-200/70",
    emoji: "🐛",
    label: "Correção",
  },
  melhoria: {
    chip: "bg-amber-50 text-amber-700 ring-amber-200/70",
    emoji: "✨",
    label: "Melhoria",
  },
  novidade: {
    chip: "bg-emerald-50 text-emerald-700 ring-emerald-200/70",
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
          <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-[#7A5E2C]">
            No ar · produção
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono text-2xl font-bold leading-none text-[#7A5E2C]">
              {current.version}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${typeVisual[current.type].chip}`}
            >
              {typeVisual[current.type].emoji} {typeVisual[current.type].label}
            </span>
            <span className="text-xs text-slate-500">
              desde {formatDateTime(current.deployedAt)}
            </span>
          </div>
          <p className="m-0 mt-1.5 text-sm font-medium text-slate-800">
            {current.title}
          </p>
          {current.rollback ? (
            <p className="m-0 mt-1 inline-flex items-center gap-1 text-[11px] text-slate-400">
              <RotateCcw className="size-3" />
              rollback: <code className="text-slate-500">{current.rollback}</code>
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <p className="m-0 mb-3 text-xs font-semibold text-slate-500">
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
    <li className="overflow-hidden rounded-xl border border-slate-200/70 bg-white">
      <button
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left outline-none transition hover:bg-slate-50 focus-visible:bg-slate-50"
        onClick={onToggle}
        type="button"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono text-sm font-bold text-slate-900">
              {entry.version}
            </span>
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${tone.chip}`}
            >
              {tone.emoji} {tone.label}
            </span>
            <span className="text-[11px] text-slate-400">
              {formatDateTime(entry.deployedAt)}
            </span>
          </div>
          <p className="m-0 mt-0.5 truncate text-sm font-medium text-slate-700">
            {entry.title}
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {entry.modules.map((module) => (
              <span
                className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500"
                key={module.module}
              >
                {module.module}
              </span>
            ))}
          </div>
        </div>
        <ChevronDown
          className={`size-4 shrink-0 text-slate-400 transition ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      {expanded ? (
        <div className="border-t border-slate-100 px-3 py-3">
          {/* Para o time: Modulo (bloco) -> Tela (subtitulo) -> bullets (acoes) */}
          <div className="flex flex-col gap-3">
            {entry.modules.map((module) => (
              <div key={module.module}>
                <p className="m-0 text-sm font-bold text-slate-900">
                  {module.module}
                </p>
                <div className="mt-1 flex flex-col gap-2">
                  {module.screens.map((screen) => (
                    <div key={screen.screen}>
                      <p className="m-0 text-xs font-semibold text-[#7A5E2C]">
                        {screen.screen}
                      </p>
                      <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0">
                        {screen.items.map((item, index) => (
                          <li
                            className="flex gap-1.5 text-[13px] leading-snug text-slate-600"
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
          <div className="mt-3 rounded-lg bg-slate-50/80 p-3 text-xs leading-relaxed text-slate-600 ring-1 ring-slate-200/60">
            <p className="m-0">
              <span className="font-semibold text-slate-500">Motivo:</span>{" "}
              {entry.technical.motivation}
            </p>
            <p className="m-0 mt-1">
              <span className="font-semibold text-slate-500">
                O que foi feito:
              </span>{" "}
              {entry.technical.done}
            </p>
            <p className="m-0 mt-1 text-[11px] text-slate-400">
              build <code className="text-slate-500">{entry.buildTag}</code>
              {entry.rollback ? (
                <>
                  {" · "}rollback{" "}
                  <code className="text-slate-500">{entry.rollback}</code>
                </>
              ) : null}
            </p>
          </div>
        </div>
      ) : null}
    </li>
  );
}
