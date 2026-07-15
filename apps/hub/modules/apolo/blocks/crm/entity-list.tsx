import { Filter, Search } from "lucide-react";

import { PanteonLoadingState } from "@/components/panteon/panteon-loading";
import { apoloProfileLabels } from "@/lib/apolo/catalog";
import type { ApoloEntity } from "@/lib/apolo/types";

import {
  businessRoleProfiles,
  buyerFinancialBadge,
  buyerStatusLabel,
  displayHeaderName,
  displayText,
} from "../../data/apolo-derive";
import type { ApoloProfileFilter } from "../../types/apolo-local";

// Opções do filtro do CRM 360 = papéis que importam (Comprador/Prospect são derivados
// da carteira; os demais são profiles). Fora: Usuario/Pessoa física/jurídica/duplicados.
// Captador, Coordenador de Vendas e Colaborador Interno/Temporário nascem no Apolo depois.
const CRM_FILTERS: { label: string; value: ApoloProfileFilter }[] = [
  { label: "Comprador", value: "comprador" },
  { label: "Prospect", value: "prospect" },
  { label: "Imobiliaria", value: "imobiliaria" },
  { label: "Corretor", value: "corretor" },
  { label: "Fornecedor", value: "fornecedor" },
  { label: "Parceiro", value: "parceiro" },
  { label: "Colaborador", value: "colaborador" },
  { label: "Incorporador", value: "incorporador" },
];
function EntityColumn({
  entities,
  error,
  loading,
  profileFilter,
  query,
  selectedEntityId,
  onChangeProfileFilter,
  onChangeQuery,
  onSubmitQuery,
  onSelect,
}: {
  entities: readonly ApoloEntity[];
  error: string | null;
  loading: boolean;
  profileFilter: ApoloProfileFilter;
  query: string;
  selectedEntityId: string;
  onChangeProfileFilter: (profile: ApoloProfileFilter) => void;
  onChangeQuery: (query: string) => void;
  onSubmitQuery: () => void;
  onSelect: (entityId: string) => void;
}) {
  return (
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="shrink-0 border-b border-line px-4 py-3">
        {/* Busca só no Enter (ou clicando a lupa) — não filtra a cada tecla. */}
        <div className="flex items-center gap-2 rounded-xl border border-line bg-subtle px-3 py-2 text-ink-muted">
          <button
            aria-label="Buscar"
            className="shrink-0 text-ink-muted transition-colors hover:text-[#A07C3B] disabled:cursor-default disabled:hover:text-ink-muted"
            disabled={loading || Boolean(error)}
            onClick={() => onSubmitQuery()}
            type="button"
          >
            <Search className="size-4" aria-hidden="true" />
          </button>
          <input
            className="w-full bg-transparent text-sm font-medium text-ink outline-none placeholder:text-ink-muted"
            disabled={loading || Boolean(error)}
            onChange={(event) => onChangeQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onSubmitQuery();
              }
            }}
            placeholder="Buscar e apertar Enter (nome, documento, unidade...)"
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
              className="h-8 rounded-lg border border-line bg-surface pl-8 pr-7 text-xs font-semibold text-ink-soft outline-none transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 focus:border-[#A07C3B]/35 focus:ring-2 focus:ring-[#A07C3B]/10"
              disabled={loading || Boolean(error)}
              onChange={(event) =>
                onChangeProfileFilter(event.target.value as ApoloProfileFilter)
              }
              value={profileFilter}
            >
              <option value="all">Filtros</option>
              {CRM_FILTERS.map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </select>
          </label>
          {profileFilter !== "all" ? (
            <button
              className="inline-flex h-7 items-center rounded-full bg-[#A07C3B]/5 px-2 text-[11px] font-semibold text-[#7a5e2c] dark:text-[#d9b877] ring-1 ring-[#A07C3B]/15"
              onClick={() => onChangeProfileFilter("all")}
              type="button"
            >
              {CRM_FILTERS.find((filter) => filter.value === profileFilter)?.label ??
                profileFilter}{" "}
              x
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
          ? "border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/12 text-rose-700 dark:text-rose-300"
          : "border-line text-ink-muted"
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
  const buyerLabel = buyerStatusLabel(entity);
  const financialBadge = buyerFinancialBadge(entity);
  const primaryRelationship = displayText(entity.relationships[0]?.label ?? "Em revisao");
  const isUsuario = entity.profiles.includes("usuario");
  const title = displayHeaderName(entity);
  // Papéis que a entidade exerce (acumuláveis) — não o PF/PJ.
  const papeis = businessRoleProfiles(entity);
  // Comprador: a COR do chip diz a adimplência (verde = adimplente, vermelho =
  // inadimplente), sem badge separado. Prospect fica âmbar.
  const buyerChipClass =
    buyerLabel === "Comprador"
      ? financialBadge?.label === "Inadimplente"
        ? "bg-rose-50 dark:bg-rose-500/12 text-rose-700 dark:text-rose-300 ring-rose-100 dark:ring-rose-500/20"
        : "bg-emerald-50 dark:bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 ring-emerald-100 dark:ring-emerald-500/20"
      : "bg-amber-50 dark:bg-amber-500/12 text-amber-800 dark:text-amber-300 ring-amber-100 dark:ring-amber-500/20";

  return (
    <article
      className={`rounded-xl border p-3 transition-all ${
        selected
          ? "border-[#A07C3B]/35 bg-[#A07C3B]/5 shadow-[0_10px_30px_rgba(160,124,59,0.08)]"
          : "border-line bg-surface hover:border-line hover:bg-subtle"
      }`}
    >
      <button className="w-full text-left" onClick={onSelect} type="button">
        <div className="min-w-0">
          <p className="m-0 truncate text-sm font-semibold text-ink">{title}</p>
          <p className="m-0 mt-1 truncate text-xs text-ink-muted">
            {displayText(entity.locationLabel)}
          </p>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {papeis.map((papel) => (
            <span
              className="rounded-full bg-[#A07C3B]/8 px-2 py-1 text-[11px] font-semibold text-[#7a5e2c] dark:text-[#d9b877] ring-1 ring-[#A07C3B]/15"
              key={papel}
            >
              {apoloProfileLabels[papel]}
            </span>
          ))}
          {isUsuario ? (
            <span
              className={`rounded-full px-2 py-1 text-[11px] font-semibold ring-1 ring-inset ${buyerChipClass}`}
            >
              {buyerLabel}
            </span>
          ) : null}
        </div>
        {isUsuario ? (
          <div className="mt-3 rounded-lg border border-line bg-subtle px-3 py-2">
            <p className="m-0 text-[11px] font-medium text-ink-muted">Imobiliária</p>
            <p className="m-0 mt-1 truncate text-sm font-semibold text-ink">
              {primaryRelationship}
            </p>
          </div>
        ) : null}
      </button>
    </article>
  );
}


export { EntityColumn };
