"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, FolderOpen, Maximize2, Search, X } from "lucide-react";

import { POP_CATALOG, type PopProcess } from "@/lib/processos/catalog";
import { ProcessFlowchart } from "@/modules/processos/ProcessFlowchart";

type FlatProcess = {
  modulo: string;
  moduloId: string;
  process: PopProcess;
  tela: string;
  telaId: string;
};

type DetailTab = "ficha" | "fluxo" | "regras" | "sla";

function flattenCatalog(): FlatProcess[] {
  const rows: FlatProcess[] = [];

  POP_CATALOG.forEach((module) => {
    module.telas.forEach((screen) => {
      screen.processos.forEach((process) => {
        rows.push({
          modulo: module.modulo,
          moduloId: module.id,
          process,
          tela: screen.tela,
          telaId: screen.id,
        });
      });
    });
  });

  return rows;
}

function matchesFolder(row: FlatProcess, folderKey: string): boolean {
  if (folderKey === "all") {
    return true;
  }

  if (folderKey.startsWith("mod:")) {
    return row.moduloId === folderKey.slice(4);
  }

  if (folderKey.startsWith("tela:")) {
    const [, moduloId, telaId] = folderKey.split(":");
    return row.moduloId === moduloId && row.telaId === telaId;
  }

  return true;
}

export function ProcessosLibrary() {
  const allProcesses = useMemo(flattenCatalog, []);
  const [search, setSearch] = useState("");
  const [folderKey, setFolderKey] = useState("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [fullId, setFullId] = useState<string | null>(null);

  const fullRow = allProcesses.find((row) => row.process.id === fullId) ?? null;

  const filtered = useMemo(() => {
    const normalized = search.trim().toLowerCase();

    return allProcesses.filter((row) => {
      const matchesSearch =
        normalized.length === 0 ||
        `${row.process.nome} ${row.modulo} ${row.tela} ${row.process.resumo}`
          .toLowerCase()
          .includes(normalized);

      return matchesFolder(row, folderKey) && matchesSearch;
    });
  }, [allProcesses, folderKey, search]);

  const openRow = filtered.find((row) => row.process.id === openId) ?? null;

  if (fullRow) {
    return <ProcessFullView onClose={() => setFullId(null)} row={fullRow} />;
  }

  return (
    <section className="rounded-xl border border-[#d9e0e7] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="relative mb-4 max-w-md">
        <Search aria-hidden="true" className="absolute left-3 top-2.5 text-slate-400" size={16} />
        <input
          className="h-9 w-full rounded-md border border-[#d9e0e7] bg-white pl-9 pr-3 text-sm text-slate-800 outline-none transition focus:border-[#A07C3B]"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar processo, módulo ou regra"
          value={search}
        />
      </div>

      <div className="grid gap-5 md:grid-cols-[190px_minmax(0,1fr)]">
        <FolderTree allCount={allProcesses.length} folderKey={folderKey} onSelect={setFolderKey} />

        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(248px,1fr))]">
          {filtered.map((row) => (
            <ProcessCard key={row.process.id} onOpen={() => setOpenId(row.process.id)} row={row} />
          ))}
          {filtered.length === 0 ? (
            <div className="col-span-full rounded-lg border border-dashed border-[#d9e0e7] p-8 text-center text-sm text-slate-500">
              Nenhum processo encontrado.
            </div>
          ) : null}
        </div>
      </div>

      {openRow ? (
        <ProcessModal
          onClose={() => setOpenId(null)}
          onExpand={() => {
            setFullId(openRow.process.id);
            setOpenId(null);
          }}
          row={openRow}
        />
      ) : null}
    </section>
  );
}

function FolderTree({
  allCount,
  folderKey,
  onSelect,
}: {
  allCount: number;
  folderKey: string;
  onSelect: (key: string) => void;
}) {
  return (
    <nav aria-label="Pastas" className="md:border-r md:border-[#edf1f5] md:pr-3">
      <p className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Pastas</p>
      <div className="grid gap-0.5">
        <FolderButton active={folderKey === "all"} count={allCount} label="Todos" onClick={() => onSelect("all")} />
        {POP_CATALOG.map((module) => {
          const moduleKey = `mod:${module.id}`;
          const moduleCount = module.telas.reduce((total, screen) => total + screen.processos.length, 0);

          return (
            <div key={module.id}>
              <FolderButton
                active={folderKey === moduleKey}
                count={moduleCount}
                label={module.modulo}
                onClick={() => onSelect(moduleKey)}
              />
              {module.telas.map((screen) => {
                const telaKey = `tela:${module.id}:${screen.id}`;

                return (
                  <FolderButton
                    active={folderKey === telaKey}
                    count={screen.processos.length}
                    indented
                    key={screen.id}
                    label={screen.tela}
                    onClick={() => onSelect(telaKey)}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </nav>
  );
}

function FolderButton({
  active,
  count,
  indented = false,
  label,
  onClick,
}: {
  active: boolean;
  count: number;
  indented?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex items-center justify-between gap-2 rounded-md py-1.5 pr-2.5 text-left text-sm transition ${
        indented ? "pl-7" : "pl-2.5"
      } ${
        active
          ? "bg-[#FFF9EF] font-medium text-slate-950 ring-1 ring-inset ring-[#A07C3B]/30"
          : "text-slate-600 hover:bg-slate-50"
      }`}
      onClick={onClick}
      type="button"
    >
      <span className="flex min-w-0 items-center gap-2">
        {indented ? null : (
          <FolderOpen aria-hidden="true" className={active ? "text-[#A07C3B]" : "text-slate-400"} size={15} />
        )}
        <span className="truncate">{label}</span>
      </span>
      <span className="text-xs text-slate-400">{count}</span>
    </button>
  );
}

function ProcessCard({ onOpen, row }: { onOpen: () => void; row: FlatProcess }) {
  const { process } = row;

  return (
    <button
      className="flex flex-col rounded-xl border border-[#d9e0e7] bg-white p-3.5 text-left transition hover:border-[#A07C3B]/40 hover:bg-[#fffdf8] focus:outline-none focus:ring-2 focus:ring-[#A07C3B]/25"
      onClick={onOpen}
      type="button"
    >
      <span className="text-sm font-semibold text-slate-950">{process.nome}</span>
      <span className="mt-1 text-xs text-slate-500">
        {row.modulo} › {row.tela}
      </span>
      {process.responsavel ? <span className="mt-0.5 text-xs text-slate-400">{process.responsavel}</span> : null}
      <span className="mt-3 text-[11px] text-slate-400">
        {process.estados.length} etapas · {process.transicoes.length} regras
      </span>
    </button>
  );
}

function ProcessHeaderInfo({ row }: { row: FlatProcess }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-slate-500">
        {row.modulo} › {row.tela}
      </p>
      <h2 className="mt-0.5 text-lg font-semibold text-slate-950">{row.process.nome}</h2>
      {row.process.responsavel ? <p className="mt-1 text-xs text-slate-500">{row.process.responsavel}</p> : null}
    </div>
  );
}

function ProcessModal({
  onClose,
  onExpand,
  row,
}: {
  onClose: () => void;
  onExpand: () => void;
  row: FlatProcess;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[#d9e0e7] bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <header className="flex items-start justify-between gap-3 border-b border-[#edf1f5] px-5 py-4">
          <ProcessHeaderInfo row={row} />
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              aria-label="Abrir em tela cheia"
              className="grid size-8 place-items-center rounded-md border border-[#d9e0e7] text-slate-500 transition hover:bg-slate-50"
              onClick={onExpand}
              type="button"
            >
              <Maximize2 aria-hidden="true" size={15} />
            </button>
            <button
              aria-label="Fechar"
              className="grid size-8 place-items-center rounded-md border border-[#d9e0e7] text-slate-500 transition hover:bg-slate-50"
              onClick={onClose}
              type="button"
            >
              <X aria-hidden="true" size={16} />
            </button>
          </div>
        </header>
        <div className="overflow-y-auto px-5 py-4">
          <ProcessDetail process={row.process} />
        </div>
      </div>
    </div>
  );
}

function ProcessFullView({ onClose, row }: { onClose: () => void; row: FlatProcess }) {
  return (
    <section className="rounded-xl border border-[#d9e0e7] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="mb-4 flex items-start gap-3 border-b border-[#edf1f5] pb-4">
        <button
          aria-label="Voltar à biblioteca"
          className="grid size-9 shrink-0 place-items-center rounded-md border border-[#d9e0e7] text-slate-600 transition hover:bg-slate-50"
          onClick={onClose}
          type="button"
        >
          <ArrowLeft aria-hidden="true" size={16} />
        </button>
        <ProcessHeaderInfo row={row} />
      </div>
      <ProcessDetail process={row.process} />
    </section>
  );
}

function ProcessDetail({ process }: { process: PopProcess }) {
  const [tab, setTab] = useState<DetailTab>("ficha");

  const stateLabel = useMemo(() => {
    const map = new Map<string, string>();
    process.estados.forEach((state) => map.set(state.id, state.label));
    return map;
  }, [process]);

  const tabs: Array<{ id: DetailTab; label: string }> = [
    { id: "ficha", label: "Ficha O&M" },
    { id: "fluxo", label: "Fluxo" },
    { id: "regras", label: "Regras" },
    { id: "sla", label: "SLA" },
  ];

  return (
    <div>
      <div className="mb-4 flex gap-1 border-b border-[#edf1f5]">
        {tabs.map((item) => (
          <button
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition ${
              tab === item.id
                ? "border-[#A07C3B] font-medium text-[#8A6A2F]"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
            key={item.id}
            onClick={() => setTab(item.id)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "ficha" ? (
        <div>
          <p className="max-w-3xl text-sm leading-6 text-slate-600">{process.resumo}</p>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <FichaItem label="Objetivo" value={process.objetivo} />
            <FichaItem label="Responsável" value={process.responsavel} />
            <FichaItem label="Entradas" value={process.entradas} />
            <FichaItem label="Saídas" value={process.saidas} />
          </dl>
        </div>
      ) : null}

      {tab === "fluxo" ? (
        <div>
          <ProcessFlowchart process={process} />
          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-500">
            <Legend swatch="line">fluxo normal</Legend>
            <Legend swatch="gold">quebra / 2ª chance</Legend>
            <Legend swatch="emerald">sucesso</Legend>
            <Legend swatch="rose">escalonamento</Legend>
          </div>
        </div>
      ) : null}

      {tab === "regras" ? (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[#edf1f5] text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="py-2 pr-3 font-semibold">De</th>
              <th className="py-2 pr-3 font-semibold">Gatilho</th>
              <th className="py-2 pr-3 font-semibold">Para</th>
              <th className="py-2 font-semibold">Tipo</th>
            </tr>
          </thead>
          <tbody>
            {process.transicoes.map((transition, index) => (
              <tr className="border-b border-[#f3f6f9] align-top" key={index}>
                <td className="py-2 pr-3 font-medium text-slate-700">
                  {stateLabel.get(transition.de) ?? transition.de}
                </td>
                <td className="py-2 pr-3 text-slate-600">
                  {transition.gatilho}
                  {transition.tag ? (
                    <span className="ml-2 rounded-full bg-[#A07C3B]/10 px-2 py-0.5 text-[11px] font-semibold text-[#8A6A2F]">
                      {transition.tag}
                    </span>
                  ) : null}
                </td>
                <td className="py-2 pr-3 font-medium text-slate-700">
                  {stateLabel.get(transition.para) ?? transition.para}
                </td>
                <td className="py-2">
                  <ModeBadge mode={transition.modo} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {tab === "sla" ? (
        <div className="grid gap-5 lg:grid-cols-2">
          {process.sla && process.sla.length > 0 ? (
            <div>
              <SectionTitle>SLA &amp; parâmetros</SectionTitle>
              <dl className="mt-2 space-y-2.5">
                {process.sla.map((item) => (
                  <div className="flex items-baseline justify-between gap-3" key={item.item}>
                    <dt className="text-sm text-slate-500">{item.item}</dt>
                    <dd className="text-right text-sm font-semibold text-slate-800">{item.valor}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
          {process.decisoes && process.decisoes.length > 0 ? (
            <div>
              <SectionTitle>Decisões de negócio</SectionTitle>
              <ul className="mt-2 space-y-2">
                {process.decisoes.map((decision, index) => (
                  <li className="flex gap-2 text-sm leading-6 text-slate-600" key={index}>
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-[#A07C3B]" />
                    <span>{decision}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function FichaItem({ label, value }: { label: string; value?: string | string[] }) {
  if (!value || (Array.isArray(value) && value.length === 0)) {
    return null;
  }

  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      {Array.isArray(value) ? (
        <ul className="mt-1 space-y-1">
          {value.map((entry, index) => (
            <li className="text-sm leading-6 text-slate-700" key={index}>
              {entry}
            </li>
          ))}
        </ul>
      ) : (
        <dd className="mt-1 text-sm leading-6 text-slate-700">{value}</dd>
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <p className="text-[11px] font-semibold tracking-[0.18em] text-slate-400">{children}</p>;
}

function ModeBadge({ mode }: { mode: "auto" | "manual" }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${
        mode === "auto"
          ? "bg-slate-50 text-slate-600 ring-slate-200"
          : "bg-amber-50 text-amber-700 ring-amber-100"
      }`}
    >
      {mode === "auto" ? "Automático" : "Manual"}
    </span>
  );
}

const LEGEND_SWATCH = {
  emerald: "bg-emerald-400",
  gold: "bg-[#A07C3B]",
  line: "bg-slate-400",
  rose: "bg-rose-400",
} as const;

function Legend({ children, swatch }: { children: ReactNode; swatch: keyof typeof LEGEND_SWATCH }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`size-2.5 rounded-full ${LEGEND_SWATCH[swatch]}`} />
      {children}
    </span>
  );
}
