"use client";

import { type ApoloScreen } from "@/lib/apolo/catalog";
import { DashboardScreen } from "./blocks/dashboard/apolo-dashboard";
import { BoardView } from "./blocks/board/board-view";
import { EmpreendimentosScreen } from "./blocks/empreendimentos/empreendimentos-view";
import { ReportsScreen } from "./blocks/reports/apolo-reports";
import type {
  ApoloEnterpriseRow,
  ApoloEnterpriseTab,
  ApoloEnterprisesData,
} from "@/lib/apolo/empreendimentos";
import { toTitleCase } from "@/lib/format/name-case";
import { ArrowLeft, PanelLeftOpen } from "lucide-react";
import { ApoloSidebar } from "./blocks/shell/apolo-sidebar";
import { CrmCommandCenter } from "./blocks/crm/command-center";
import { EntityColumn } from "./blocks/crm/entity-list";
import { RecordWorkspace } from "./blocks/crm/record-workspace";
import { isApoloTabUnavailableForEntity, matchesApoloFilters } from "./data/apolo-derive";
import { getApoloAccessToken } from "./data/apolo-operations";
import type { ApoloProfileFilter, ApoloTab } from "./types/apolo-local";
import type { ApoloDashboardData } from "@/lib/apolo/types";
import { useEffect, useMemo, useRef, useState } from "react";

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
  const [sidebarCollapsed, setSidebarCollapsed] = usePersistedState<boolean>(
    "apolo.sidebarCollapsed",
    false,
  );
  // Recolhe a lista de entidades (cards ao lado) pra o cockpit ganhar tela.
  const [entityListCollapsed, setEntityListCollapsed] = usePersistedState<boolean>(
    "apolo.entityListCollapsed",
    false,
  );
  const [activeTab, setActiveTab] = usePersistedState<ApoloTab>(
    "apolo.activeTab",
    "resumo",
  );
  const [dashboard, setDashboard] = useState<ApoloDashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // A busca dispara só no Enter (não filtra a cada tecla). `queryInput` é o texto do
  // campo; `query` é o termo efetivamente buscado. Deep-links que setam `query`
  // programaticamente seguem buscando — o effect sincroniza o campo.
  const [query, setQuery] = usePersistedState("apolo.query", "");
  const [queryInput, setQueryInput] = useState(query);
  useEffect(() => {
    setQueryInput(query);
  }, [query]);
  // Recarrega o dashboard após criar/editar algo (ex.: novo relacionamento).
  const [reloadKey, setReloadKey] = useState(0);
  const [profileFilter, setProfileFilter] =
    usePersistedState<ApoloProfileFilter>("apolo.profileFilter", "all");
  const [selectedEntityId, setSelectedEntityId] = usePersistedState(
    "apolo.selectedEntityId",
    "",
  );
  // Empreendimentos: cenário comercial (C2X). Carrega sob demanda ao abrir a tela.
  const [enterprises, setEnterprises] = useState<ApoloEnterprisesData | null>(
    null,
  );
  const [enterprisesError, setEnterprisesError] = useState<string | null>(null);
  const [enterprisesLoading, setEnterprisesLoading] = useState(false);
  // A ficha do empreendimento vive aqui (não dentro da tela) pra sobreviver à ida ao CRM:
  // é o que permite o "voltar" trazer o usuário de volta pro empreendimento onde ele estava.
  const [enterpriseDetail, setEnterpriseDetail] =
    useState<ApoloEnterpriseRow | null>(null);
  // A ABA da ficha também vive aqui: sem isso, voltar do CRM remontava a ficha e caía no
  // Resumo, em vez de devolver o usuário na aba onde ele estava (ex.: Unidades).
  const [enterpriseTab, setEnterpriseTab] = useState<ApoloEnterpriseTab>("resumo");
  // Pilha de navegação pro "voltar": guarda de onde viemos (ficha do CRM OU
  // empreendimento), pra o botão de voltar funcionar dos dois lados.
  const [navStack, setNavStack] = useState<
    Array<{ id: string; kind: "entity" | "enterprise"; name: string; tab?: ApoloTab }>
  >([]);

  // Entidade que o usuário pediu pra abrir (clique num player). Fica pendente até a busca
  // trazer o resultado, aí a seleção cai NELA em vez de na primeira da lista.
  const pendingEntityIdRef = useRef<string | null>(null);

  // Carrega no mount (não só na tela de Empreendimentos): o CRM precisa da lista pra
  // resolver o clique num relacionamento de empreendimento -> abrir a tela dele.
  // `cancelled` é POR EXECUÇÃO do efeito (não um ref global): no StrictMode/dev o efeito roda
  // montar→desmontar→montar; a 1ª execução é cancelada e a 2ª (nova closure) seta o estado.
  // Um ref-guard global bloqueava a 2ª e deixava a tela presa no skeleton.
  useEffect(() => {
    let cancelled = false;

    async function loadEnterprises() {
      try {
        setEnterprisesLoading(true);
        setEnterprisesError(null);

        const accessToken = await getApoloAccessToken();
        const response = await fetch("/api/apolo/empreendimentos", {
          cache: "no-store",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const payload = (await response.json()) as {
          data?: ApoloEnterprisesData;
          error?: string;
        };

        if (cancelled) {
          return;
        }

        if (!response.ok || !payload.data) {
          throw new Error(
            payload.error ?? "Nao foi possivel carregar os empreendimentos.",
          );
        }

        setEnterprises(payload.data);
      } catch (loadError) {
        if (!cancelled) {
          setEnterprisesError(
            loadError instanceof Error
              ? loadError.message
              : "Falha ao carregar os empreendimentos.",
          );
        }
      } finally {
        if (!cancelled) {
          setEnterprisesLoading(false);
        }
      }
    }

    void loadEnterprises();

    return () => {
      cancelled = true;
    };
  }, []);

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

          // Se veio de um clique numa entidade (ex.: player do empreendimento), seleciona
          // ELA — não a primeira do resultado. Buscar por nome casa homônimos, e o reset
          // cego pro primeiro item abria a ficha da pessoa errada.
          const target = pendingEntityIdRef.current;
          const matched = target
            ? payload.data.entities.find((entity) => entity.id === target)
            : null;

          if (matched) {
            pendingEntityIdRef.current = null;
            setSelectedEntityId(matched.id);
          } else {
            setSelectedEntityId(payload.data.entities[0]?.id ?? "");
          }
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
  }, [profileFilter, query, reloadKey, setSelectedEntityId]);

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
  }, [filteredEntities, selectedEntityId, setSelectedEntityId]);

  useEffect(() => {
    // Navegação em curso (ex.: clicou num comprador na Carteira): espera a entidade certa
    // resolver antes de decidir a aba, senão um render intermediário derruba a aba destino.
    if (pendingEntityIdRef.current) {
      return;
    }

    if (selectedEntity && isApoloTabUnavailableForEntity(activeTab, selectedEntity)) {
      setActiveTab("resumo");
    }
  }, [activeTab, selectedEntity, setActiveTab]);

  // Clicar num player do empreendimento leva ao CADASTRO dele no CRM 360 (regra do Lucas).
  // A busca por nome só CARREGA os candidatos; quem escolhe a ficha certa é o `entityId`
  // (derivado do id do C2X) — por isso ele fica pendente até o resultado chegar.
  // Navega pra uma ficha do CRM (sem empilhar). A busca por nome só CARREGA os
  // candidatos; quem escolhe a ficha certa é o `entityId` (fica pendente até o resultado).
  function applyOpenEntity(name: string, entityId: string, tab: ApoloTab = "cadastro") {
    pendingEntityIdRef.current = entityId;
    setActiveScreen("crm");
    setActiveTab(tab);
    setProfileFilter("all");
    setQuery(name);
  }

  // Navega pra a tela de cadastro de um empreendimento (sem empilhar).
  function applyOpenEnterprise(row: ApoloEnterpriseRow) {
    setEnterpriseDetail(row);
    setActiveScreen("empreendimentos");
    setEnterpriseTab("cadastro");
  }

  function normalizeEnterpriseName(value: string): string {
    return value
      .normalize("NFD")
      .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function findEnterpriseInList(
    list: ApoloEnterprisesData | null,
    name: string,
  ): ApoloEnterpriseRow | null {
    const target = normalizeEnterpriseName(name);
    if (!target || !list) {
      return null;
    }
    const candidates: ApoloEnterpriseRow[] = [];
    for (const row of list.rows) {
      candidates.push(row, ...row.stages);
    }
    return (
      candidates.find((row) => normalizeEnterpriseName(row.name) === target) ??
      candidates.find((row) => {
        const value = normalizeEnterpriseName(row.name);
        return value.includes(target) || target.includes(value);
      }) ??
      null
    );
  }

  // Empilha de onde estamos (ficha do CRM ou empreendimento) antes de navegar. Guarda a aba
  // ativa pra que o "voltar" retorne exatamente pra ela (ex.: sair da Carteira e voltar pra Carteira).
  function pushCurrentToNav() {
    if (activeScreen === "crm" && selectedEntity) {
      setNavStack((stack) => [
        ...stack,
        { id: selectedEntity.id, kind: "entity", name: selectedEntity.displayName, tab: activeTab },
      ]);
    } else if (activeScreen === "empreendimentos" && enterpriseDetail) {
      setNavStack((stack) => [
        ...stack,
        { id: enterpriseDetail.id, kind: "enterprise", name: enterpriseDetail.name },
      ]);
    }
  }

  // `tab` = aba em que a ficha destino deve abrir (ex.: clicar num comprador na Carteira abre
  // a Carteira dele). Default = cadastro (fluxo dos relacionamentos).
  function openEntityInCrm(name: string, entityId: string, tab?: ApoloTab) {
    const normalized = name.trim();
    if (!normalized) {
      return;
    }
    if (!(activeScreen === "crm" && selectedEntity?.id === entityId)) {
      pushCurrentToNav();
    }
    applyOpenEntity(normalized, entityId, tab);
  }

  // Abre a tela de cadastro do empreendimento pelo nome (relacionamento de trabalho).
  // Se a lista ainda não carregou, busca sob demanda antes de resolver.
  async function openEnterpriseByName(name: string) {
    let list = enterprises;
    if (!list) {
      try {
        const token = await getApoloAccessToken();
        const response = await fetch("/api/apolo/empreendimentos", {
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}` },
        });
        const payload = (await response.json()) as { data?: ApoloEnterprisesData };
        if (response.ok && payload.data) {
          list = payload.data;
          setEnterprises(payload.data);
        }
      } catch {
        // silencioso: sem lista, não navega
      }
    }
    const row = findEnterpriseInList(list, name);
    if (!row) {
      return;
    }
    pushCurrentToNav();
    applyOpenEnterprise(row);
  }

  // Volta pra de onde viemos (desempilha), seja ficha do CRM ou empreendimento.
  function goBack() {
    const previous = navStack[navStack.length - 1];
    if (!previous) {
      return;
    }
    setNavStack((stack) => stack.slice(0, -1));
    if (previous.kind === "entity") {
      // Volta pra aba de onde saiu (guardada ao empilhar); fallback = relacionamentos.
      applyOpenEntity(previous.name, previous.id, previous.tab ?? "relacionamentos");
    } else {
      const row = findEnterpriseInList(enterprises, previous.name);
      if (row) {
        applyOpenEnterprise(row);
      }
    }
  }

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
    <div
      className={`flex h-[calc(100dvh-3.25rem)] min-h-0 max-h-[calc(100dvh-3.25rem)] overflow-hidden bg-canvas text-ink transition-[padding-left] duration-300 ease-out ${
        sidebarCollapsed ? "lg:pl-[72px]" : "lg:pl-60"
      }`}
    >
      <ApoloSidebar
        active={activeScreen}
        collapsed={sidebarCollapsed}
        onSelect={(screen) => {
          setNavStack([]);
          setActiveScreen(screen);
        }}
        onToggle={() => setSidebarCollapsed((value) => !value)}
      />
      <main className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden p-3 sm:p-4">
        {/* Na tela de Empreendimento o "voltar" fica no topo; no CRM ele vai pro painel
            da ficha (passado ao RecordWorkspace). */}
        {navStack.length > 0 && activeScreen === "empreendimentos" ? (
          <button
            className="inline-flex w-fit max-w-full shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:border-[#A07C3B]/40 hover:bg-[#A07C3B]/8 hover:text-[#7A5E2C] dark:hover:text-[#d9b877]"
            onClick={goBack}
            type="button"
          >
            <ArrowLeft aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate">
              Voltar para {toTitleCase(navStack[navStack.length - 1]?.name ?? "")}
            </span>
          </button>
        ) : null}
        {/* O "+ novo cadastro" e os KPIs ficam no cabeçalho do CRM (CrmCommandCenter). */}
        {activeScreen === "board" ? <BoardView /> : null}
        {activeScreen === "dashboard" ? (
          <DashboardScreen dashboard={dashboard} entities={entities} loading={loading} />
        ) : null}
        {activeScreen === "relatorios" ? (
          <ReportsScreen dashboard={dashboard} entities={entities} loading={loading} />
        ) : null}
        {activeScreen === "empreendimentos" ? (
          <EmpreendimentosScreen
            data={enterprises}
            detail={enterpriseDetail}
            error={enterprisesError}
            loading={enterprisesLoading}
            onDetailChange={setEnterpriseDetail}
            onOpenEntity={openEntityInCrm}
            onTabChange={setEnterpriseTab}
            tab={enterpriseTab}
          />
        ) : null}
        {activeScreen === "crm" ? (
          <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-3 overflow-hidden">
            <CrmCommandCenter
              dashboard={dashboard}
              entities={entities}
              filteredCount={filteredEntities.length}
              loading={loading}
            />
            <section
              className={`grid min-h-0 gap-3 ${
                entityListCollapsed
                  ? "grid-cols-[auto_minmax(0,1fr)]"
                  : "xl:grid-cols-[minmax(22rem,0.4fr)_minmax(0,1.6fr)]"
              }`}
            >
              {entityListCollapsed ? (
                <button
                  aria-label="Expandir lista"
                  className="group flex h-full w-10 shrink-0 flex-col items-center gap-2 rounded-xl border border-line bg-surface py-3 text-ink-muted transition-colors hover:border-[#A07C3B]/40 hover:text-[#7a5e2c] dark:hover:text-[#d9b877]"
                  onClick={() => setEntityListCollapsed(false)}
                  title="Expandir lista"
                  type="button"
                >
                  <PanelLeftOpen className="size-4" aria-hidden="true" />
                  <span className="text-[11px] font-semibold uppercase tracking-wide [writing-mode:vertical-rl]">
                    Lista
                  </span>
                </button>
              ) : (
                <EntityColumn
                  entities={filteredEntities}
                  error={error}
                  loading={loading}
                  profileFilter={profileFilter}
                  query={queryInput}
                  selectedEntityId={selectedEntity?.id ?? ""}
                  onChangeProfileFilter={setProfileFilter}
                  onChangeQuery={setQueryInput}
                  onClearFilters={() => {
                    // Zera os três de uma vez: o input, a busca submetida (persistida) e o papel.
                    setQueryInput("");
                    setQuery("");
                    setProfileFilter("all");
                  }}
                  onCollapse={() => setEntityListCollapsed(true)}
                  onSubmitQuery={() => setQuery(queryInput)}
                  onSelect={setSelectedEntityId}
                  temFiltro={
                    query.trim().length > 0 ||
                    queryInput.trim().length > 0 ||
                    profileFilter !== "all"
                  }
                />
              )}
              <RecordWorkspace
                activeTab={activeTab}
                backLabel={navStack.length > 0 ? navStack[navStack.length - 1]?.name ?? null : null}
                entity={selectedEntity}
                loading={loading}
                onBack={goBack}
                onChangeTab={setActiveTab}
                onOpenCommercialRelationship={openCommercialRelationship}
                onOpenEnterprise={openEnterpriseByName}
                onOpenEntity={openEntityInCrm}
                onRelationshipCreated={() => setReloadKey((key) => key + 1)}
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

