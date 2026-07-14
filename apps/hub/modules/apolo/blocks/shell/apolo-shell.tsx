"use client";

import { useState } from "react";

import { CADASTRO_TIPOS } from "@/lib/apolo/cadastro-tipos";
import type { ApoloDashboardData } from "@/lib/apolo/types";
import { Tooltip } from "@repo/uix";
import { FileText, MessageCircle, Plus, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// Shell do Apolo (cabecalho + acoes) — extraido do ApoloPage monolitico.
// A navegacao entre telas mudou para o sidebar lateral (ApoloSidebar); o header
// fica so com as acoes e o botao de novo cadastro.

export function ApoloHeader({
  dashboard,
}: {
  dashboard: ApoloDashboardData | null;
}) {
  return (
    <header className="shrink-0 rounded-lg border border-line bg-surface px-3 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {dashboard?.meta.status === "sync_pending" ? (
          <span className="inline-flex h-9 items-center rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/12 px-3 text-xs font-semibold text-amber-800 dark:text-amber-300">
            Atualizacao pendente
          </span>
        ) : null}
        <HeaderAction icon={MessageCircle} label="Atendimento" tone="emerald" />
        <HeaderAction icon={FileText} label="Documentos" tone="slate" />
        <HeaderAction icon={Sparkles} label="Preenchimento assistido" tone="amber" />
        <NovoCadastroMenu />
      </div>
    </header>
  );
}

// Botão "+" que abre o seletor de tipo de cadastro (CAD). Só Prospect está
// liberado; os demais aparecem como "em breve".
function NovoCadastroMenu() {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <Tooltip content="Novo cadastro de CAD">
        <button
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label="Novo cadastro de CAD"
          className="inline-flex size-9 items-center justify-center rounded-lg bg-[#A07C3B] text-white transition-colors hover:bg-[#8a682f]"
          onClick={() => setOpen((v) => !v)}
          type="button"
        >
          <Plus className="size-4" aria-hidden="true" />
        </button>
      </Tooltip>
      {open ? (
        <>
          <button
            aria-label="Fechar"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
            type="button"
          />
          <div
            className="absolute right-0 top-full z-20 mt-1.5 w-64 rounded-xl border border-line bg-surface p-1 shadow-lg"
            role="menu"
          >
            <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
              Tipo de cadastro
            </p>
            {CADASTRO_TIPOS.map((tipo) =>
              tipo.disponivel ? (
                <a
                  className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 hover:bg-subtle"
                  href={`/apolo/cadastro?tipo=${tipo.slug}`}
                  key={tipo.slug}
                  role="menuitem"
                >
                  <span className="flex flex-col">
                    <span className="text-sm font-medium text-ink">{tipo.label}</span>
                    <span className="text-[11px] text-ink-muted">{tipo.descricao}</span>
                  </span>
                </a>
              ) : (
                <div
                  aria-disabled="true"
                  className="flex cursor-default items-center justify-between gap-2 rounded-lg px-3 py-2 opacity-60"
                  key={tipo.slug}
                >
                  <span className="flex flex-col">
                    <span className="text-sm font-medium text-ink-muted">{tipo.label}</span>
                    <span className="text-[11px] text-ink-muted">{tipo.descricao}</span>
                  </span>
                  <span className="shrink-0 rounded-full bg-subtle px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-ink-muted">
                    em breve
                  </span>
                </div>
              ),
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function HeaderAction({
  icon: Icon,
  label,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  tone: "amber" | "emerald" | "slate";
}) {
  const toneClass = {
    amber: "border-[#A07C3B]/15 bg-[#A07C3B]/5 text-[#7a5e2c] dark:text-[#d9b877]",
    emerald: "border-emerald-100 dark:border-emerald-500/25 bg-emerald-50 dark:bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
    slate: "border-line bg-surface text-ink-soft",
  } as const;

  return (
    <Tooltip content={label} placement="bottom">
      <button
        aria-label={label}
        className={`inline-flex size-9 items-center justify-center rounded-lg border transition-colors hover:bg-subtle ${toneClass[tone]}`}
        type="button"
      >
        <Icon className="size-4" aria-hidden="true" />
      </button>
    </Tooltip>
  );
}
