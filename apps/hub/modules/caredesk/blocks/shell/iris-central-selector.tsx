"use client";

// SELETOR DE CENTRAL — o recorte de topo da Iris, no alto da sidebar.
//
// Fica ACIMA da navegação de propósito: primeiro a pessoa escolhe de qual operação está
// falando (Atendimento ou Relacionamento), depois escolhe a tela. Board, Histórico,
// E-mail e Relatórios abaixo dele já vêm recortados.

import { Building2, Headphones, Layers, type LucideIcon } from "lucide-react";
import { Tooltip } from "@repo/uix";

import {
  IRIS_CENTRAL_DESCRICAO,
  IRIS_CENTRAL_LABEL_CURTO,
  type IrisCentralSelecionada,
} from "../../lib/centrais";

const ICONE: Record<IrisCentralSelecionada, LucideIcon> = {
  atendimento: Headphones,
  relacionamento: Building2,
  todas: Layers,
};

export function IrisCentralSelector({
  central,
  collapsed,
  disponiveis,
  onSelect,
}: {
  central: IrisCentralSelecionada;
  collapsed: boolean;
  disponiveis: IrisCentralSelecionada[];
  onSelect: (central: IrisCentralSelecionada) => void;
}) {
  // Uma central só (ou nenhuma) não vira controle: não há o que escolher.
  if (disponiveis.length < 2) {
    return null;
  }

  if (collapsed) {
    return (
      <div className="grid justify-items-center gap-1">
        {disponiveis.map((item) => {
          const Icon = ICONE[item];
          const ativo = item === central;

          return (
            <Tooltip
              key={item}
              content={IRIS_CENTRAL_LABEL_CURTO[item]}
              placement="right"
            >
              <button
                type="button"
                onClick={() => onSelect(item)}
                aria-label={IRIS_CENTRAL_LABEL_CURTO[item]}
                aria-pressed={ativo}
                className={[
                  "grid h-9 w-9 place-items-center rounded-lg border outline-none transition focus-visible:ring-2 focus-visible:ring-[#d0ad69]",
                  ativo
                    ? "border-[#A07C3B]/55 bg-[#A07C3B]/15 text-[#cba25a]"
                    : "border-transparent text-ink-muted hover:bg-black/[0.05] hover:text-ink dark:hover:bg-white/[0.06]",
                ].join(" ")}
              >
                <Icon aria-hidden="true" className="h-4 w-4" />
              </button>
            </Tooltip>
          );
        })}
      </div>
    );
  }

  return (
    <div className="grid gap-1.5">
      <span className="px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
        Central
      </span>

      <div className="grid gap-1 rounded-xl bg-black/[0.03] p-1 dark:bg-white/[0.035]">
        {disponiveis.map((item) => {
          const Icon = ICONE[item];
          const ativo = item === central;

          return (
            <button
              key={item}
              type="button"
              onClick={() => onSelect(item)}
              aria-pressed={ativo}
              className={[
                "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-[#d0ad69]",
                ativo
                  ? "bg-surface text-ink shadow-sm dark:bg-white/[0.07]"
                  : "text-ink-soft hover:bg-black/[0.04] hover:text-ink dark:hover:bg-white/[0.05]",
              ].join(" ")}
            >
              <span
                className={[
                  "grid h-7 w-7 shrink-0 place-items-center rounded-md",
                  ativo
                    ? "bg-[#A07C3B]/15 text-[#cba25a]"
                    : "text-ink-muted",
                ].join(" ")}
              >
                <Icon aria-hidden="true" className="h-4 w-4" />
              </span>
              <span className="grid min-w-0 gap-0.5">
                <span className="truncate text-[13px] font-semibold leading-tight">
                  {IRIS_CENTRAL_LABEL_CURTO[item]}
                </span>
                <span className="truncate text-[10px] leading-tight text-ink-muted">
                  {IRIS_CENTRAL_DESCRICAO[item]}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
