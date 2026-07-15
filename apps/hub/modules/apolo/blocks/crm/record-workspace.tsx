import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Building2,
  CalendarClock,
  Clock3,
  ContactRound,
  FileText,
  HandCoins,
  LayoutDashboard,
  MapPinned,
  MessageCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Tooltip } from "@repo/uix";
import { PanteonLoadingMark, PanteonLoadingState } from "@/components/panteon/panteon-loading";
import { apoloProfileLabels } from "@/lib/apolo/catalog";
import { ClientDetailPanel } from "@/modules/guardian/attendance/components/ClientDetailPanel";
import type { OperationalTimelineEvent, QueueClient } from "@/modules/guardian/attendance/types";
import type { ApoloEntity } from "@/lib/apolo/types";

import { InfoTile, PanelTitle } from "../shared/apolo-ui";
import {
  activeRegistrationLabel,
  businessRoleProfiles,
  buyerFinancialBadge,
  buyerStatusLabel,
  canUseHadesWorkspace,
  displayHeaderName,
  displayText,
  documentLabel,
  isApoloTabUnavailableForEntity,
  isCompanyEntity,
  profileLabelList,
  sanitizeOperationalMessage,
  summaryName,
} from "../../data/apolo-derive";
import {
  emptyManualHadesOperations,
  getApoloAccessToken,
  loadHadesManualOperations,
  persistHadesManualOperation,
  upsertById,
} from "../../data/apolo-operations";
import type { ApoloTab, ManualHadesOperations } from "../../types/apolo-local";
import { apoloTabs } from "./crm-tabs";
import {
  AuditPanel,
  FinancialPanel,
  PortfolioPanel,
  RegistrationPanel,
  SummaryPanel,
  TimelinePanel,
} from "./panels";
import { RelationshipsPanel } from "./relationships-panel";
import { HeaderAction } from "../shell/apolo-shell";

function RecordWorkspace({
  activeTab,
  backLabel,
  entity,
  loading,
  onBack,
  onChangeTab,
  onOpenCommercialRelationship,
  onOpenEnterprise,
  onOpenEntity,
  onRelationshipCreated,
}: {
  activeTab: ApoloTab;
  backLabel: string | null;
  entity: ApoloEntity | null;
  loading: boolean;
  onBack: () => void;
  onChangeTab: (tab: ApoloTab) => void;
  onOpenCommercialRelationship: (label: string) => void;
  onOpenEnterprise: (name: string) => void;
  onOpenEntity: (label: string, entityId: string) => void;
  onRelationshipCreated: () => void;
}) {
  if (entity && canUseHadesWorkspace()) {
    return <HadesRecordWorkspace entity={entity} />;
  }

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      {backLabel ? (
        <button
          className="flex w-full items-center gap-1.5 border-b border-line px-4 py-2 text-left text-xs font-semibold text-ink-soft transition-colors hover:bg-[#A07C3B]/5 hover:text-[#7A5E2C] dark:hover:text-[#d9b877]"
          onClick={onBack}
          type="button"
        >
          <ArrowLeft aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="truncate">Voltar para {displayText(backLabel)}</span>
        </button>
      ) : null}
      {entity ? <RecordHeader entity={entity} /> : <RecordHeaderEmpty loading={loading} />}
      <TabStrip activeTab={activeTab} disabled={!entity} entity={entity} onChangeTab={onChangeTab} />
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {entity ? (
          <TabPanel
            activeTab={activeTab}
            entity={entity}
            onOpenCommercialRelationship={onOpenCommercialRelationship}
            onOpenEnterprise={onOpenEnterprise}
            onOpenEntity={onOpenEntity}
            onRelationshipCreated={onRelationshipCreated}
          />
        ) : (
          <div className="grid min-h-64 place-items-center rounded-lg border border-dashed border-line p-6 text-center text-sm font-semibold text-ink-muted">
            {loading ? "Carregando detalhe 360" : "Selecione um relacionamento"}
          </div>
        )}
      </div>
    </section>
  );
}

function HadesRecordWorkspace({ entity }: { entity: ApoloEntity }) {
  const [client, setClient] = useState<QueueClient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [manualOperations, setManualOperations] = useState<ManualHadesOperations>(
    emptyManualHadesOperations,
  );

  useEffect(() => {
    let cancelled = false;

    async function loadHadesClient() {
      const clientId = entity.hadesClientId;

      setClient(null);
      setError(null);
      setLoading(true);
      setManualOperations(emptyManualHadesOperations);

      if (!clientId) {
        setLoading(false);
        setError("Cadastro sem compra vinculada.");
        return;
      }

      try {
        const accessToken = await getApoloAccessToken(false);
        const headers = accessToken
          ? { Authorization: `Bearer ${accessToken}` }
          : undefined;
        const response = await fetch(
          `/api/hades/attendance/client/${encodeURIComponent(clientId)}`,
          {
            cache: "no-store",
            headers,
          },
        );
        const payload = (await response.json().catch(() => null)) as
          | { client?: QueueClient; error?: string }
          | null;

        if (cancelled) {
          return;
        }

        if (!response.ok || !payload?.client) {
          throw new Error(payload?.error ?? "Cadastro sem carteira operacional.");
        }

        setClient(payload.client);

        if (!accessToken) {
          return;
        }

        const manualPayload = await loadHadesManualOperations(payload.client.id, accessToken);

        if (!cancelled) {
          setManualOperations(manualPayload);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? sanitizeOperationalMessage(loadError.message)
              : "Nao foi possivel carregar a carteira operacional.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadHadesClient();

    return () => {
      cancelled = true;
    };
  }, [entity.hadesClientId]);

  async function saveManualTimelineEvent(event: OperationalTimelineEvent) {
    if (!client) {
      return;
    }

    const payload = await persistHadesManualOperation({
      body: {
        client: {
          c2xAcquisitionRequestId: client.c2xAcquisitionRequestId,
          id: client.id,
          name: client.nome,
        },
        event,
        kind: "timeline",
      },
      method: "POST",
    });

    upsertManualOperations(payload);
  }

  async function saveManualCommitment(record: QueueClient["commitments"][number]) {
    if (!client) {
      return;
    }

    const payload = await persistHadesManualOperation({
      body: {
        client: {
          c2xAcquisitionRequestId: client.c2xAcquisitionRequestId,
          id: client.id,
          name: client.nome,
        },
        commitment: record,
        kind: "commitment",
      },
      method: "POST",
    });

    upsertManualOperations(payload);
  }

  async function updateManualCommitment(record: QueueClient["commitments"][number]) {
    const isPersistedRecord = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.id);

    if (!isPersistedRecord) {
      await saveManualCommitment(record);
      return;
    }

    const payload = await persistHadesManualOperation({
      body: {
        commitment: record,
        id: record.id,
        kind: "commitment",
      },
      method: "PATCH",
    });

    upsertManualOperations(payload);
  }

  function upsertManualOperations(payload: ManualHadesOperations) {
    setManualOperations((current) => ({
      commitments: upsertById(payload.commitments ?? [], current.commitments),
      events: upsertById(payload.events ?? [], current.events),
    }));
  }

  if (loading) {
    return <HadesWorkspaceLoading entity={entity} />;
  }

  if (!client) {
    return <HadesUnavailableWorkspace entity={entity} message={error} />;
  }

  const clientWithManualOperations = {
    ...client,
    commitments: upsertById(manualOperations.commitments, client.commitments),
  };
  const extraTimelineEvents = upsertById(manualOperations.events, []);

  return (
    <ClientDetailPanel
      key={client.id}
      client={clientWithManualOperations}
      extraTimelineEvents={extraTimelineEvents}
      onCreateCommitment={saveManualCommitment}
      onCreateTimelineEvent={saveManualTimelineEvent}
      onOpenWhatsApp={() => {
        window.location.href = "/iris";
      }}
      onUpdateCommitment={updateManualCommitment}
    />
  );
}

function HadesWorkspaceLoading({ entity }: { entity: ApoloEntity }) {
  return (
    <section className="flex min-h-0 flex-col rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)] xl:h-[calc(100vh-112px)]">
      <RecordHeader entity={entity} />
      <PanteonLoadingState
        className="flex-1 rounded-none border-0 bg-subtle"
        minHeightClassName="min-h-72"
        title="Carregando carteira, acordos, documentos e contrato"
      />
    </section>
  );
}

function HadesUnavailableWorkspace({
  entity,
  message,
}: {
  entity: ApoloEntity;
  message: string | null;
}) {
  const statusMessage =
    sanitizeOperationalMessage(message) ??
    "Carteira detalhada ainda nao encontrada no modulo operacional.";
  const disabledTabs = [
    { icon: LayoutDashboard, label: "Visao geral", enabled: true },
    { icon: Building2, label: "Cliente", enabled: true },
    { icon: MapPinned, label: "Carteira", enabled: false },
    { icon: Clock3, label: "Timeline", enabled: true },
    { icon: HandCoins, label: "Acordos", enabled: false },
  ] as const satisfies readonly {
    enabled: boolean;
    icon: LucideIcon;
    label: string;
  }[];

  return (
    <section className="flex min-h-0 flex-col rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)] xl:h-[calc(100vh-112px)]">
      <RecordHeader entity={entity} />
      <nav
        aria-label="Workspace operacional"
        className="shrink-0 border-b border-line px-4 py-3"
      >
        <div className="flex w-fit flex-wrap gap-1 rounded-xl border border-line bg-surface p-1">
          {disabledTabs.map((tab) => {
            const Icon = tab.icon;

            return (
              <Tooltip content={tab.label} key={tab.label} placement="bottom">
                <button
                  aria-label={tab.label}
                  className={`inline-flex size-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${
                    tab.enabled
                      ? "bg-surface text-ink-soft ring-line"
                      : "cursor-not-allowed bg-subtle text-ink-muted ring-line"
                  }`}
                  disabled={!tab.enabled}
                  type="button"
                >
                  <Icon className="size-4" aria-hidden="true" />
                </button>
              </Tooltip>
            );
          })}
        </div>
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto bg-subtle p-4 sm:p-5">
        <div className="grid gap-5">
          <section className="rounded-xl border border-line bg-surface p-5">
            <PanelTitle eyebrow="Visao geral" title="Cadastro no CRM com carteira operacional pendente" />
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <InfoTile label={isCompanyEntity(entity) ? "Razao social" : "Nome"} value={summaryName(entity)} />
              <InfoTile label={documentLabel(entity)} value={entity.documentMasked} />
              <InfoTile label="Perfil" value={profileLabelList(entity)} />
              <InfoTile label="Compra" value={buyerStatusLabel(entity)} />
            </div>
            <p className="m-0 mt-4 text-sm font-medium text-ink-muted">
              {statusMessage}
            </p>
          </section>
          <section className="grid gap-3 md:grid-cols-3">
            <DisabledOperationCard
              icon={MapPinned}
              label="Carteira"
              value="Detalhe financeiro ainda indisponivel"
            />
            <DisabledOperationCard
              icon={HandCoins}
              label="Acordos"
              value="Aguardando carteira detalhada"
            />
            <DisabledOperationCard
              icon={FileText}
              label="Contrato"
              value="Contrato nao localizado no detalhe operacional"
            />
          </section>
          <RegistrationPanel entity={entity} />
        </div>
      </div>
    </section>
  );
}

function DisabledOperationCard({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <article className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-subtle text-ink-muted ring-1 ring-line">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="m-0 text-sm font-semibold text-ink">{label}</p>
          <p className="m-0 mt-1 text-xs font-medium text-ink-muted">{value}</p>
          <button
            className="mt-3 inline-flex h-8 cursor-not-allowed items-center rounded-lg border border-line bg-subtle px-3 text-xs font-semibold text-ink-muted"
            disabled
            type="button"
          >
            Indisponivel
          </button>
        </div>
      </div>
    </article>
  );
}

function RecordHeader({ entity }: { entity: ApoloEntity }) {
  const registrationLabel = activeRegistrationLabel(entity);
  const headerName = displayHeaderName(entity);
  // Papéis reais (não o PF/PJ nem o genérico "usuario"). Comprador/Prospect é derivado
  // da carteira e vira o primeiro chip quando a entidade é cliente.
  const papeis = businessRoleProfiles(entity);
  const buyerLabel = buyerStatusLabel(entity);
  const showBuyerChip = buyerLabel !== "Nao aplicavel";
  const financialBadge = buyerFinancialBadge(entity);
  const buyerChipClass =
    buyerLabel === "Comprador"
      ? financialBadge?.label === "Inadimplente"
        ? "bg-rose-50 dark:bg-rose-500/12 text-rose-700 dark:text-rose-300 ring-rose-100 dark:ring-rose-500/20"
        : "bg-emerald-50 dark:bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 ring-emerald-100 dark:ring-emerald-500/20"
      : "bg-amber-50 dark:bg-amber-500/12 text-amber-800 dark:text-amber-300 ring-amber-100 dark:ring-amber-500/20";

  return (
    <header className="shrink-0 border-b border-line px-4 py-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-subtle text-[#A07C3B] ring-1 ring-line">
              {entity.kind === "pj" || entity.kind === "organization" ? (
                <Building2 className="size-4" aria-hidden="true" />
              ) : (
                <ContactRound className="size-4" aria-hidden="true" />
              )}
            </div>
            <div className="min-w-0">
              <h2 className="m-0 truncate text-lg font-semibold tracking-normal text-ink">
                {headerName}
              </h2>
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-xs">
                <span className="truncate text-ink-muted">
                  {entity.locationLabel}
                </span>
                {showBuyerChip ? (
                  <span
                    className={`inline-flex shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold ring-1 ring-inset ${buyerChipClass}`}
                  >
                    {buyerLabel}
                  </span>
                ) : null}
                {papeis.map((role) => (
                  <span
                    key={role}
                    className="inline-flex shrink-0 rounded-full bg-[#A07C3B]/8 px-2 py-1 text-[11px] font-semibold text-[#7a5e2c] dark:text-[#d9b877] ring-1 ring-[#A07C3B]/15"
                  >
                    {apoloProfileLabels[role] ?? role}
                  </span>
                ))}
                <span className="inline-flex shrink-0 rounded-full bg-subtle px-2 py-1 text-[11px] font-semibold text-ink-soft ring-1 ring-line">
                  {registrationLabel}
                </span>
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <HeaderAction icon={MessageCircle} label="Abrir atendimento" tone="emerald" />
          <HeaderAction icon={CalendarClock} label="Agenda" tone="amber" />
        </div>
      </div>
    </header>
  );
}

function RecordHeaderEmpty({ loading }: { loading: boolean }) {
  return (
    <header className="shrink-0 border-b border-line px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-subtle text-ink-muted ring-1 ring-line">
          {loading ? (
            <PanteonLoadingMark size="xs" />
          ) : (
            <ContactRound className="size-4" aria-hidden="true" />
          )}
        </div>
        <div>
          <h2 className="m-0 text-lg font-semibold text-ink">
            {loading ? "Carregando" : "Sem relacionamento selecionado"}
          </h2>
          <p className="m-0 mt-1 text-xs text-ink-muted">
            O detalhe aparece quando houver um item selecionado.
          </p>
        </div>
      </div>
    </header>
  );
}

function TabStrip({
  activeTab,
  disabled,
  entity,
  onChangeTab,
}: {
  activeTab: ApoloTab;
  disabled: boolean;
  entity: ApoloEntity | null;
  onChangeTab: (tab: ApoloTab) => void;
}) {
  return (
    <nav
      aria-label="Areas do relacionamento"
      className="shrink-0 overflow-x-auto border-b border-line px-3 py-2"
    >
      <div className="flex gap-1">
        {apoloTabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          const tabDisabled = disabled || isApoloTabUnavailableForEntity(tab.id, entity);
          const tooltipContent = tabDisabled && entity ? `${tab.label} indisponivel sem pagamentos` : tab.label;

          return (
            <Tooltip content={tooltipContent} key={tab.id} placement="bottom">
              <button
                aria-current={active ? "page" : undefined}
                className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#A07C3B] disabled:cursor-not-allowed disabled:opacity-50 ${
                  active
                    ? "bg-inverse text-brand-ink"
                    : "text-ink-soft hover:bg-subtle hover:text-ink"
                }`}
                disabled={tabDisabled}
                onClick={() => onChangeTab(tab.id)}
                type="button"
              >
                <Icon className="size-4" aria-hidden="true" />
                {tab.label}
              </button>
            </Tooltip>
          );
        })}
      </div>
    </nav>
  );
}

function TabPanel({
  activeTab,
  entity,
  onOpenCommercialRelationship,
  onOpenEnterprise,
  onOpenEntity,
  onRelationshipCreated,
}: {
  activeTab: ApoloTab;
  entity: ApoloEntity;
  onOpenCommercialRelationship: (label: string) => void;
  onOpenEnterprise: (name: string) => void;
  onOpenEntity: (label: string, entityId: string) => void;
  onRelationshipCreated: () => void;
}) {
  if (activeTab === "cadastro") {
    return <RegistrationPanel entity={entity} />;
  }

  if (activeTab === "relacionamentos") {
    return (
      <RelationshipsPanel
        entity={entity}
        onCreated={onRelationshipCreated}
        onOpenEnterprise={onOpenEnterprise}
        onOpenEntity={onOpenEntity}
      />
    );
  }

  if (activeTab === "carteira") {
    return <PortfolioPanel entity={entity} />;
  }

  if (activeTab === "financeiro") {
    return <FinancialPanel entity={entity} />;
  }

  if (activeTab === "timeline") {
    return <TimelinePanel events={entity.timeline} />;
  }

  if (activeTab === "auditoria") {
    return <AuditPanel audit={entity.audit} />;
  }

  return (
    <SummaryPanel
      entity={entity}
      onOpenCommercialRelationship={onOpenCommercialRelationship}
    />
  );
}


export { RecordWorkspace };
