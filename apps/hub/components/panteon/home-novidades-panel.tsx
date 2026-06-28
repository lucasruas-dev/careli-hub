"use client";

import { Surface } from "@repo/uix";
import { Megaphone } from "lucide-react";

import {
  PANTEON_CHANGELOG,
  type ChangelogEntry,
  type ChangelogType,
} from "@/lib/changelog/changelog";

// Painel de Novidades da Home (visivel pro time). Substitui o antigo painel
// "Rotina / Agenda e tarefas". Fonte unica: o changelog do Panteon (parte
// amigavel: Modulo -> Tela -> melhorias). A parte tecnica fica so no Zeus.

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

function formatBrDate(iso: string) {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yy = String(date.getFullYear()).slice(2);
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");

  return `${dd}/${mm}/${yy} · ${hh}:${min}`;
}

export function HomeNovidadesPanel() {
  const entries = PANTEON_CHANGELOG;
  const current = PANTEON_CHANGELOG[0];

  return (
    <Surface
      bordered
      className="relative col-span-12 h-full min-h-[20rem] overflow-hidden border-[#d9e0e7] bg-white p-0 shadow-[0_18px_42px_rgb(16_24_32_/_0.08)] xl:col-span-5"
    >
      <div className="absolute inset-0 flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-[#A07C3B]/10 text-[#A07C3B]">
            <Megaphone size={18} />
          </span>
          <div>
            <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-[#A07C3B]">
              Novidades
            </p>
            <p className="m-0 text-sm font-semibold text-[#17202f]">
              O que mudou no Panteon
            </p>
          </div>
        </div>

        {current ? (
          <div className="shrink-0 rounded-lg border border-[#A07C3B]/25 bg-[#A07C3B]/[0.06] px-2.5 py-1 text-right">
            <p className="m-0 text-[9px] font-semibold uppercase tracking-wide text-[#98a2b3]">
              Build atual
            </p>
            <p className="m-0 font-mono text-sm font-bold leading-none text-[#7A5E2C]">
              {current.version}
            </p>
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
        {entries.length === 0 ? (
          <div className="rounded-md border border-dashed border-[#d9e0e7] bg-[#fafbfc] p-5 text-sm text-[#667085]">
            Nenhuma novidade registrada ainda.
          </div>
        ) : (
          entries.map((entry) => (
            <NovidadeCard entry={entry} key={entry.version} />
          ))
        )}
      </div>
      </div>
    </Surface>
  );
}

function NovidadeCard({ entry }: { entry: ChangelogEntry }) {
  const tone = typeVisual[entry.type];

  return (
    <article className="rounded-xl border border-[#edf0f4] bg-[#fafbfc] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${tone.chip}`}
        >
          {tone.emoji} {tone.label}
        </span>
        <span className="font-mono text-[11px] font-semibold text-[#7A5E2C]">
          {entry.version}
        </span>
        <span className="text-[11px] text-[#98a2b3]">
          {formatBrDate(entry.deployedAt)}
        </span>
      </div>

      <p className="m-0 mt-1.5 text-sm font-semibold text-[#17202f]">
        {entry.title}
      </p>

      <div className="mt-2 flex flex-col gap-2">
        {entry.modules.map((module) => (
          <div key={module.module}>
            <p className="m-0 text-xs font-bold text-[#344054]">
              {module.module}
            </p>
            <div className="mt-1 flex flex-col gap-1.5">
              {module.screens.map((screen) => (
                <div key={screen.screen}>
                  <p className="m-0 text-[11px] font-semibold text-[#A07C3B]">
                    {screen.screen}
                  </p>
                  <ul className="m-0 mt-0.5 flex list-none flex-col gap-1 p-0">
                    {screen.items.map((item, index) => (
                      <li
                        className="flex gap-1.5 text-[13px] leading-snug text-[#475467]"
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
    </article>
  );
}
