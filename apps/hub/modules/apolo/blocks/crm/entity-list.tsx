import { Filter, Search } from "lucide-react";

import { PanteonLoadingState } from "@/components/panteon/panteon-loading";
import { apoloProfileLabels, apoloProfileOptions } from "@/lib/apolo/catalog";
import type { ApoloEntity } from "@/lib/apolo/types";

import { formatCount } from "../shared/apolo-utils";
import {
  buyerFinancialBadge,
  buyerStatusLabel,
  displayHeaderName,
  displayText,
  kindLabel,
  primaryBusinessProfile,
} from "../../data/apolo-derive";
import type { ApoloProfileFilter } from "../../types/apolo-local";
function EntityColumn({
  entities,
  error,
  loading,
  profileFilter,
  query,
  selectedEntityId,
  totalCount,
  onChangeProfileFilter,
  onChangeQuery,
  onSelect,
}: {
  entities: readonly ApoloEntity[];
  error: string | null;
  loading: boolean;
  profileFilter: ApoloProfileFilter;
  query: string;
  selectedEntityId: string;
  totalCount: number;
  onChangeProfileFilter: (profile: ApoloProfileFilter) => void;
  onChangeQuery: (query: string) => void;
  onSelect: (entityId: string) => void;
}) {
  return (
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="shrink-0 border-b border-slate-100 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="m-0 text-base font-semibold text-slate-950">CRM 360</h2>
            <p className="m-0 mt-1 text-xs font-medium text-slate-500">
              Pessoas, empresas, carteira e responsaveis.
            </p>
          </div>
          <span className="rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200/70">
            {formatCount(entities.length)}/{formatCount(totalCount)}
          </span>
        </div>
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-slate-200/70 bg-slate-50/80 px-3 py-2 text-slate-500">
          <Search className="size-4 shrink-0" aria-hidden="true" />
          <input
            className="w-full bg-transparent text-sm font-medium text-slate-900 outline-none placeholder:text-slate-400"
            disabled={loading || Boolean(error)}
            onChange={(event) => onChangeQuery(event.target.value)}
            placeholder="Buscar nome, comprador, documento, unidade, e-mail ou responsavel"
            type="search"
            value={query}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="relative">
            <span className="sr-only">Filtrar perfil</span>
            <Filter
              aria-hidden="true"
              className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[#A07C3B]"
            />
            <select
              className="h-8 rounded-lg border border-slate-200/70 bg-white pl-8 pr-7 text-xs font-semibold text-slate-600 outline-none transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 focus:border-[#A07C3B]/35 focus:ring-2 focus:ring-[#A07C3B]/10"
              disabled={loading || Boolean(error)}
              onChange={(event) =>
                onChangeProfileFilter(event.target.value as ApoloProfileFilter)
              }
              value={profileFilter}
            >
              <option value="all">Filtros</option>
              {apoloProfileOptions.map((profile) => (
                <option key={profile} value={profile}>
                  {apoloProfileLabels[profile]}
                </option>
              ))}
            </select>
          </label>
          {profileFilter !== "all" ? (
            <button
              className="inline-flex h-7 items-center rounded-full bg-[#A07C3B]/5 px-2 text-[11px] font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15"
              onClick={() => onChangeProfileFilter("all")}
              type="button"
            >
              {apoloProfileLabels[profileFilter]} x
            </button>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {loading ? <EntityLoadingState /> : null}
        {!loading && error ? <EntityEmptyState message={error} tone="error" /> : null}
        {!loading && !error && entities.length === 0 ? (
          <EntityEmptyState message="Nenhum relacionamento encontrado." tone="empty" />
        ) : null}
        {!loading && !error
          ? entities.map((entity) => (
              <EntityListItem
                entity={entity}
                key={entity.id}
                onSelect={() => onSelect(entity.id)}
                selected={entity.id === selectedEntityId}
              />
            ))
          : null}
      </div>
    </aside>
  );
}

function EntityLoadingState() {
  return (
    <PanteonLoadingState
      minHeightClassName="min-h-48"
      title="Carregando relacionamentos reais"
    />
  );
}

function EntityEmptyState({
  message,
  tone,
}: {
  message: string;
  tone: "empty" | "error";
}) {
  return (
    <div
      className={`grid min-h-48 place-items-center rounded-lg border border-dashed p-4 text-center text-sm font-semibold ${
        tone === "error"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-slate-200 text-slate-500"
      }`}
    >
      {message}
    </div>
  );
}

function EntityListItem({
  entity,
  onSelect,
  selected,
}: {
  entity: ApoloEntity;
  onSelect: () => void;
  selected: boolean;
}) {
  const primaryProfile = primaryBusinessProfile(entity);
  const buyerLabel = buyerStatusLabel(entity);
  const financialBadge = buyerFinancialBadge(entity);
  const primaryRelationship = displayText(entity.relationships[0]?.label ?? "Vinculo em revisao");
  const isUsuario = entity.profiles.includes("usuario");
  const title = displayHeaderName(entity);

  return (
    <article
      className={`rounded-xl border p-3 transition-all ${
        selected
          ? "border-[#A07C3B]/35 bg-[#A07C3B]/5 shadow-[0_10px_30px_rgba(160,124,59,0.08)]"
          : "border-slate-100 bg-white hover:border-slate-200/80 hover:bg-slate-50/80"
      }`}
    >
      <button className="w-full text-left" onClick={onSelect} type="button">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="m-0 truncate text-sm font-semibold text-slate-950">
              {title}
            </p>
            <p className="m-0 mt-1 truncate text-xs text-slate-500">
              {displayText(entity.locationLabel)}
            </p>
          </div>
          {financialBadge ? (
            <span
              className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${financialBadge.className}`}
            >
              {financialBadge.label}
            </span>
          ) : null}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {/* Pro cliente, o chip Comprador/Prospect (abaixo) já é o perfil — some o "Usuario". */}
          {!isUsuario ? (
            <span className="rounded-full bg-[#A07C3B]/8 px-2 py-1 text-[11px] font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
              {apoloProfileLabels[primaryProfile]}
            </span>
          ) : null}
          <span className="rounded-full bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200/70">
            {kindLabel(entity.kind)}
          </span>
          {isUsuario ? (
            <span
              className={`rounded-full px-2 py-1 text-[11px] font-semibold ring-1 ring-inset ${
                buyerLabel === "Comprador"
                  ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
                  : "bg-amber-50 text-amber-800 ring-amber-100"
              }`}
            >
              {buyerLabel}
            </span>
          ) : null}
        </div>
        {isUsuario ? (
          <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
            <p className="m-0 text-[11px] font-medium text-slate-500">Vinculo</p>
            <p className="m-0 mt-1 truncate text-sm font-semibold text-slate-950">
              {primaryRelationship}
            </p>
          </div>
        ) : null}
      </button>
    </article>
  );
}


export { EntityColumn };
