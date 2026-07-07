"use client";

import { type ApoloScreen } from "@/lib/apolo/catalog";
import { DashboardScreen } from "./blocks/dashboard/apolo-dashboard";
import { ReportsScreen } from "./blocks/reports/apolo-reports";
import { ApoloHeader } from "./blocks/shell/apolo-shell";
import { CrmCommandCenter } from "./blocks/crm/command-center";
import { EntityColumn } from "./blocks/crm/entity-list";
import { RecordWorkspace } from "./blocks/crm/record-workspace";
import { isApoloTabUnavailableForEntity, matchesApoloFilters } from "./data/apolo-derive";
import { getApoloAccessToken } from "./data/apolo-operations";
import type { ApoloProfileFilter, ApoloTab } from "./types/apolo-local";
import type { ApoloDashboardData } from "@/lib/apolo/types";
import { useEffect, useMemo, useState } from "react";

import { usePersistedState } from "@/hooks/use-persisted-state";

// Tipos locais (ApoloTab, ApoloProfileFilter, ApoloTabItem, ApoloUnitSubtab,
// ApoloFinancialSubtab, ApoloPortfolioUnit, ApoloFinancialRecord*) movidos para
// ./types/apolo-local.


// ManualHadesOperations + emptyManualHadesOperations movidos para ./data/apolo-operations
// (tipo em ./types/apolo-local).

export function ApoloPage() {
  // Persistidos: a tela/aba/filtro/busca e o registro aberto do Apolo "continuam
  // de onde estavam" ao navegar e voltar. Ver [[use-persisted-state]].
  const [activeScreen, setActiveScreen] = usePersistedState<ApoloScreen>(
    "apolo.activeScreen",
    "crm",
  );
  const [activeTab, setActiveTab] = usePersistedState<ApoloTab>(
    "apolo.activeTab",
    "resumo",
  );
  const [dashboard, setDashboard] = useState<ApoloDashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = usePersistedState("apolo.query", "");
  const [profileFilter, setProfileFilter] =
    usePersistedState<ApoloProfileFilter>("apolo.profileFilter", "all");
  const [selectedEntityId, setSelectedEntityId] = usePersistedState(
    "apolo.selectedEntityId",
    "",
  );

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void loadDashboard();
    }, query.trim() ? 280 : 0);

    async function loadDashboard() {
      try {
        setLoading(true);
        setError(null);
        const params = new URLSearchParams();
        const normalizedQuery = query.trim();

        if (normalizedQuery) {
          params.set("q", normalizedQuery);
        }

        if (profileFilter !== "all") {
          params.set("profile", profileFilter);
        }

        if (!normalizedQuery) {
          params.set("limit", "20");
        }

        const accessToken = await getApoloAccessToken();
        const response = await fetch(`/api/apolo/relationships?${params.toString()}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          signal: controller.signal,
        });
        const payload = (await response.json()) as {
          data?: ApoloDashboardData;
          error?: string;
        };

        if (!response.ok || !payload.data) {
          throw new Error("Nao foi possivel carregar o CRM.");
        }

        if (active) {
          setDashboard(payload.data);
          setSelectedEntityId(payload.data.entities[0]?.id ?? "");
        }
      } catch (loadError) {
        if (active) {
          if (loadError instanceof DOMException && loadError.name === "AbortError") {
            return;
          }

          setError(loadError instanceof Error ? loadError.message : "Falha ao carregar o Apolo.");
          setDashboard(null);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [profileFilter, query]);

  const entities = useMemo(() => dashboard?.entities ?? [], [dashboard]);
  const filteredEntities = useMemo(
    () =>
      entities.filter((entity) =>
        matchesApoloFilters(entity, query, profileFilter),
      ),
    [entities, profileFilter, query],
  );
  const selectedEntity = useMemo(
    () =>
      filteredEntities.find((entity) => entity.id === selectedEntityId) ??
      filteredEntities[0] ??
      entities[0] ??
      null,
    [entities, filteredEntities, selectedEntityId],
  );

  useEffect(() => {
    if (!filteredEntities.some((entity) => entity.id === selectedEntityId)) {
      setSelectedEntityId(filteredEntities[0]?.id ?? "");
    }
  }, [filteredEntities, selectedEntityId]);

  useEffect(() => {
    if (selectedEntity && isApoloTabUnavailableForEntity(activeTab, selectedEntity)) {
      setActiveTab("resumo");
    }
  }, [activeTab, selectedEntity]);

  function openCommercialRelationship(label: string) {
    const normalizedLabel = label.trim();

    if (!normalizedLabel) {
      return;
    }

    setActiveScreen("crm");
    setActiveTab("resumo");
    setProfileFilter("imobiliaria");
    setQuery(normalizedLabel);
  }

  return (
    <div className="flex h-[calc(100dvh-3.25rem)] min-h-0 max-h-[calc(100dvh-3.25rem)] overflow-hidden bg-[#F8FAFC] text-slate-950">
      <main className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden p-3 sm:p-4">
        <ApoloHeader
          dashboard={dashboard}
          screen={activeScreen}
          onChangeScreen={setActiveScreen}
        />
        {activeScreen === "dashboard" ? (
          <DashboardScreen dashboard={dashboard} entities={entities} loading={loading} />
        ) : null}
        {activeScreen === "relatorios" ? (
          <ReportsScreen dashboard={dashboard} entities={entities} loading={loading} />
        ) : null}
        {activeScreen === "crm" ? (
          <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-3 overflow-hidden">
            <CrmCommandCenter
              dashboard={dashboard}
              entities={entities}
              filteredCount={filteredEntities.length}
              loading={loading}
              selectedEntity={selectedEntity}
            />
            <section
              className="grid min-h-0 gap-3 xl:grid-cols-[minmax(22rem,0.4fr)_minmax(0,1.6fr)]"
            >
              <EntityColumn
                entities={filteredEntities}
                error={error}
                loading={loading}
                profileFilter={profileFilter}
                query={query}
                selectedEntityId={selectedEntity?.id ?? ""}
                totalCount={dashboard?.totalCount ?? entities.length}
                onChangeProfileFilter={setProfileFilter}
                onChangeQuery={setQuery}
                onSelect={setSelectedEntityId}
              />
              <RecordWorkspace
                activeTab={activeTab}
                entity={selectedEntity}
                loading={loading}
                onChangeTab={setActiveTab}
                onOpenCommercialRelationship={openCommercialRelationship}
              />
            </section>
          </div>
        ) : null}
      </main>
    </div>
  );
}

// ApoloHeader + HeaderAction movidos para ./blocks/shell/apolo-shell.

// DashboardScreen + ReportsScreen movidos para ./blocks/{dashboard,reports}.

// InsightCard movido para ./blocks/shared/apolo-ui; ApoloProfileMetrics e
// MetricCard movidos para ./blocks/dashboard/apolo-dashboard.

