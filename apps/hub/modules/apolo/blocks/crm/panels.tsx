import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CalendarClock,
  ChevronDown,
  ExternalLink,
  Filter,
  Handshake,
  MapPinned,
  MessageCircle,
  PhoneCall,
  ReceiptText,
  Search,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Tooltip } from "@repo/uix";
import { apoloProfileLabels } from "@/lib/apolo/catalog";
import type { ApoloAuditSignal, ApoloEntity, ApoloInstallment, ApoloTimelineEvent } from "@/lib/apolo/types";

import {
  DocumentPill,
  EmptyPanel,
  InfoButtonTile,
  InfoTile,
  PanelTitle,
  Pill,
  ReadonlyLine,
} from "../shared/apolo-ui";
import {
  acquiredUnitsCount,
  buildApoloFinancialRecords,
  buildApoloFinancialSummary,
  buildPortfolioUnits,
  buyerFinancialBadge,
  buyerStatusLabel,
  cityStateLabel,
  civilStatusLabel,
  commercialRelationshipLabel,
  contractDocumentItems,
  currencyLabelToNumber,
  displayHeaderName,
  displayText,
  documentLabel,
  financialRecordStatusClass,
  financialRecordTypeClass,
  formatMoneyLabel,
  fullAddressLabel,
  getTimelineIcon,
  isCompanyEntity,
  kindLabel,
  monthYearLabel,
  normalizeText,
  portfolioUnitSubtitle,
  primaryBusinessProfile,
  primaryContact,
  primaryPhoneContact,
  relationshipSummary,
  responsibleLabel,
  summaryName,
  uniqueText,
} from "../../data/apolo-derive";
import { getApoloAccessToken } from "../../data/apolo-operations";
import type {
  ApoloFinancialRecord,
  ApoloFinancialRecordType,
  ApoloFinancialSubtab,
  ApoloPortfolioUnit,
  ApoloUnitSubtab,
} from "../../types/apolo-local";import { apoloFinancialSubtabs, apoloUnitSubtabs } from "./crm-tabs";
function SummaryPanel({
  entity,
  onOpenCommercialRelationship,
}: {
  entity: ApoloEntity;
  onOpenCommercialRelationship: (label: string) => void;
}) {
  const financialBadge = buyerFinancialBadge(entity);
  const primaryEmail = primaryContact(entity, "email");
  const primaryPhone = primaryPhoneContact(entity);
  const primaryAddress = entity.addresses[0];
  const acquiredUnits = acquiredUnitsCount(entity);
  const commercialRelationship = commercialRelationshipLabel(entity);
  const isCompany = isCompanyEntity(entity);
  const isUsuario = entity.profiles.includes("usuario");
  const buyerStatus = buyerStatusLabel(entity);
  const isBuyer = buyerStatus === "Comprador";
  const activeSince = monthYearLabel(entity.createdAt || entity.updatedAt);
  const recentEvents = entity.timeline.slice(0, 5);
  const cityLabel = displayText(
    primaryAddress
      ? `${primaryAddress.city}-${primaryAddress.state}`
      : entity.locationLabel,
  );

  return (
    <div className="grid gap-4">
      {/* Cabecalho do relacionamento */}
      <section className="rounded-xl border border-slate-200/70 bg-white p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <PanelTitle eyebrow="Resumo" title={summaryName(entity)} />
          <div className="flex flex-wrap gap-1.5">
            <Pill>{apoloProfileLabels[primaryBusinessProfile(entity)]}</Pill>
            <Pill>{kindLabel(entity.kind)}</Pill>
            {isUsuario ? <Pill>{buyerStatus}</Pill> : null}
            {financialBadge ? (
              <span
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${financialBadge.className}`}
              >
                {financialBadge.label}
              </span>
            ) : null}
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <InfoTile label="Ativo desde" value={activeSince} />
          <InfoTile
            label="Perfil"
            value={apoloProfileLabels[primaryBusinessProfile(entity)]}
          />
          <InfoTile
            label="Situacao"
            value={isUsuario ? buyerStatus : "Nao aplicavel"}
          />
          <InfoTile label="Unidades adquiridas" value={String(acquiredUnits)} />
        </div>
      </section>

      {/* Ultimos eventos + contato/vinculo */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section className="rounded-xl border border-slate-200/70 bg-white p-4">
          <PanelTitle eyebrow="Atividade" title="Ultimos eventos" />
          <div className="mt-4 grid gap-2">
            {recentEvents.length ? (
              recentEvents.map((event, index) => {
                const Icon = getTimelineIcon(
                  normalizeText(`${event.title} ${event.description}`),
                );

                return (
                  <div
                    className="flex items-start gap-3 rounded-lg border border-slate-200/70 bg-slate-50/70 p-3"
                    key={`${event.title}-${event.date}-${index}`}
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white text-[#7A5E2C] ring-1 ring-slate-200/70">
                      <Icon className="size-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="m-0 truncate text-sm font-semibold text-slate-950">
                          {displayText(event.title)}
                        </p>
                        <span className="shrink-0 text-xs font-medium text-slate-400">
                          {event.date || "-"}
                        </span>
                      </div>
                      {event.description ? (
                        <p className="m-0 mt-0.5 truncate text-xs font-medium text-slate-500">
                          {displayText(event.description)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                );
              })
            ) : (
              <EmptyPanel text="Sem eventos recentes para este relacionamento." />
            )}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200/70 bg-white p-4">
          <PanelTitle eyebrow="Contato e vinculo" title="Como falar e por quem veio" />
          <div className="mt-4 grid gap-3">
            <InfoTile label="Telefone" value={primaryPhone?.value ?? "-"} />
            <InfoTile label="E-mail" value={primaryEmail?.value ?? "-"} />
            <InfoTile label="Cidade" value={cityLabel} />
            {isUsuario ? (
              <InfoButtonTile
                disabled={!commercialRelationship}
                label="Imobiliaria / vinculo"
                onClick={() => onOpenCommercialRelationship(commercialRelationship)}
                value={commercialRelationship || "-"}
              />
            ) : isCompany ? (
              <InfoTile label="Responsavel" value={responsibleLabel(entity) || "-"} />
            ) : (
              <InfoTile label="Proxima acao" value={entity.nextAction} />
            )}
          </div>
        </section>
      </div>

      {/* Cenario financeiro (somente comprador) */}
      {isBuyer ? (
        <section className="rounded-xl border border-slate-200/70 bg-white p-4">
          <PanelTitle eyebrow="Financeiro" title="Cenario financeiro" />
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <InfoTile
              label="Carteira"
              value={formatMoneyLabel(
                currencyLabelToNumber(entity.financial.totalPortfolio),
                entity.financial.totalPortfolio || "-",
              )}
            />
            <InfoTile
              label="Pago"
              value={formatMoneyLabel(
                currencyLabelToNumber(entity.financial.paidAmount),
                entity.financial.paidAmount || "-",
              )}
            />
            <InfoTile
              label="Vencido"
              value={formatMoneyLabel(
                currencyLabelToNumber(entity.financial.overdueAmount),
                entity.financial.overdueAmount || "-",
              )}
            />
            <InfoTile
              label="Parcelas vencidas"
              value={String(entity.financial.overdueInstallments)}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}

function RegistrationPanel({ entity }: { entity: ApoloEntity }) {
  const primaryEmail = primaryContact(entity, "email");
  const primaryPhone = primaryPhoneContact(entity);
  const primaryAddress = entity.addresses[0];
  const fullAddress = fullAddressLabel(primaryAddress);
  const isCompany = isCompanyEntity(entity);
  const cadastroRows = [
    ["Nome", displayHeaderName(entity)],
    ["CPF/CNPJ", entity.documentMasked],
    ["Razao social", isCompany ? summaryName(entity) : "-"],
    ["Nome fantasia", isCompany ? displayHeaderName(entity) : "-"],
    ["Telefone", primaryPhone?.value ?? "-"],
    ["E-mail", primaryEmail?.value ?? "-"],
    ["Endereco", fullAddress],
  ] as const;
  const detailRows = [
    ["Tipo pessoa", kindLabel(entity.kind)],
    ["RG", "-"],
    ["Documento", `${documentLabel(entity)} ${entity.documentMasked}`],
    ["Nascimento", "-"],
    ["Idade", "-"],
    ["Sexo", "-"],
    ["Estado civil", civilStatusLabel(entity) || "-"],
    ["Regime de bens", "-"],
    ["Profissao", "-"],
    ["Renda", "-"],
    ["Escolaridade", "-"],
    ["Cidade", displayText(cityStateLabel(primaryAddress, entity.locationLabel))],
    ["CEP", primaryAddress?.postalCode ?? "-"],
    ["Bairro", primaryAddress?.district ?? "-"],
    ["Numero", primaryAddress?.number ?? "-"],
    ["Complemento", primaryAddress?.complement ?? "-"],
    ["Naturalidade", "-"],
    ["Nacionalidade", "-"],
    ["Nome da mae", "-"],
    ["Relacionamento", relationshipSummary(entity)],
    ["Responsavel", isCompany ? responsibleLabel(entity) || "-" : "-"],
  ] as const;

  return (
    <div className="grid gap-4">
      <section className="rounded-xl border border-slate-200/70 bg-white p-4">
        <PanelTitle eyebrow="Dados do cliente" title="Cadastro" />
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {cadastroRows.map(([label, value]) => (
            <ReadonlyLine key={label} label={label} value={value || "-"} />
          ))}
        </div>
      </section>
      <section className="rounded-xl border border-slate-200/70 bg-white p-4">
        <PanelTitle eyebrow="Cadastro completo" title="Dados cadastrais" />
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {detailRows.map(([label, value]) => (
            <ReadonlyLine key={label} label={label} value={value || "-"} />
          ))}
        </div>
      </section>
      <section className="rounded-xl border border-slate-200/70 bg-white p-4">
        <PanelTitle eyebrow="Conjuge e representantes" title="Dados complementares" />
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <ReadonlyLine label="Conjuge" value="-" />
          <ReadonlyLine label="CPF" value="-" />
          <ReadonlyLine label="Telefone" value="-" />
          <ReadonlyLine label="E-mail" value="-" />
          <ReadonlyLine label="Nascimento" value="-" />
          <ReadonlyLine label="Documento" value="-" />
          <ReadonlyLine label="Profissao" value="-" />
          <ReadonlyLine label="Naturalidade" value="-" />
          <ReadonlyLine label="Nacionalidade" value="-" />
          <ReadonlyLine
            label={isCompany ? "Responsavel" : "Endereco"}
            value={isCompany ? responsibleLabel(entity) || "-" : fullAddress}
          />
        </div>
      </section>
    </div>
  );
}

function PortfolioPanel({ entity }: { entity: ApoloEntity }) {
  const units = useMemo(() => buildPortfolioUnits(entity), [entity]);
  const [selectedUnitId, setSelectedUnitId] = useState(units[0]?.id ?? "");
  const [activeUnitSubtab, setActiveUnitSubtab] = useState<ApoloUnitSubtab>("summary");

  useEffect(() => {
    if (!units.length) {
      setSelectedUnitId("");
      return;
    }

    const firstUnit = units[0];

    if (!firstUnit) {
      return;
    }

    setSelectedUnitId((current) =>
      units.some((unit) => unit.id === current) ? current : firstUnit.id,
    );
  }, [units]);

  const firstUnit = units[0];

  if (!firstUnit) {
    return <EmptyPanel text="Nenhuma carteira disponivel para este relacionamento." />;
  }

  const selectedUnit = units.find((unit) => unit.id === selectedUnitId) ?? firstUnit;

  return (
    <section className="grid gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
      <aside className="rounded-xl border border-slate-200/70 bg-white p-4">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-[#A07C3B]/5 text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
            <MapPinned className="size-4" aria-hidden="true" />
          </span>
          <div>
            <p className="m-0 text-sm font-semibold text-slate-950">Unidades e lotes</p>
            <p className="m-0 mt-1 text-xs font-medium text-slate-500">
              Selecione uma unidade para operar.
            </p>
          </div>
        </div>
        <div className="mt-4 grid max-h-[34rem] gap-3 overflow-y-auto pr-1">
          {units.map((unit) => {
            const active = unit.id === selectedUnit.id;

            return (
              <button
                className={`rounded-xl border p-4 text-left transition-colors ${
                  active
                    ? "border-[#A07C3B]/30 bg-[#A07C3B]/5"
                    : "border-slate-200/70 bg-slate-50/60 hover:border-[#A07C3B]/20 hover:bg-[#A07C3B]/5"
                }`}
                key={unit.id}
                onClick={() => {
                  setSelectedUnitId(unit.id);
                  setActiveUnitSubtab("summary");
                }}
                type="button"
              >
                <p className="m-0 text-sm font-semibold text-slate-950">{unit.enterprise}</p>
                <p className="m-0 mt-1 text-xs font-medium text-slate-500">
                  {portfolioUnitSubtitle(unit)}
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <CompactInfo label="Cod. unidade" value={unit.unitCode} />
                  <CompactInfo label="Valor" value={unit.tableValue} />
                </div>
              </button>
            );
          })}
        </div>
      </aside>
      <section className="rounded-xl border border-slate-200/70 bg-white p-4">
        <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#A07C3B]/5 text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
                <MapPinned className="size-4" aria-hidden="true" />
              </span>
              <p className="m-0 text-sm font-semibold text-slate-950">Unidade selecionada</p>
            </div>
            <h3 className="m-0 mt-3 text-xl font-semibold text-slate-950">
              {selectedUnit.enterprise}
            </h3>
            <p className="m-0 mt-2 text-sm font-medium text-slate-500">
              {portfolioUnitSubtitle(selectedUnit)}
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <CompactInfo label="Cod. unidade" value={selectedUnit.unitCode} />
            <CompactInfo label="Valor de tabela" value={selectedUnit.tableValue} />
            <CompactInfo label="Imobiliaria/corretor" value={selectedUnit.referenceLabel} />
          </div>
        </div>

        <ApoloUnitSubtabNav activeSubtab={activeUnitSubtab} onChange={setActiveUnitSubtab} />

        <div className="mt-5">
          {renderApoloUnitSubtab({
            activeSubtab: activeUnitSubtab,
            entity,
            unit: selectedUnit,
          })}
        </div>
      </section>
    </section>
  );
}

function ApoloUnitSubtabNav({
  activeSubtab,
  onChange,
}: {
  activeSubtab: ApoloUnitSubtab;
  onChange: (subtab: ApoloUnitSubtab) => void;
}) {
  return (
    <nav aria-label="Detalhes da unidade" className="mt-4 flex w-fit flex-wrap gap-1 rounded-xl border border-slate-200/70 bg-white p-1">
      {apoloUnitSubtabs.map((tab) => {
        const Icon = tab.icon;
        const active = activeSubtab === tab.id;

        return (
          <Tooltip content={tab.label} key={tab.id} placement="bottom">
            <button
              aria-label={tab.label}
              className={`inline-flex size-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset transition-colors ${
                active
                  ? "bg-[#A07C3B]/8 text-[#7A5E2C] ring-[#A07C3B]/20"
                  : "bg-white text-slate-600 ring-slate-200/70 hover:bg-slate-50"
              }`}
              onClick={() => onChange(tab.id)}
              type="button"
            >
              <Icon
                aria-hidden="true"
                className={`size-3.5 ${active ? "text-[#A07C3B]" : "text-slate-400"}`}
              />
            </button>
          </Tooltip>
        );
      })}
    </nav>
  );
}

function renderApoloUnitSubtab({
  activeSubtab,
  entity,
  unit,
}: {
  activeSubtab: ApoloUnitSubtab;
  entity: ApoloEntity;
  unit: ApoloPortfolioUnit;
}) {
  if (activeSubtab === "installments") {
    return <ApoloInstallmentsPanel entity={entity} unit={unit} />;
  }

  if (activeSubtab === "timeline") {
    return <ApoloUnitTimelinePanel entity={entity} unit={unit} />;
  }

  if (activeSubtab === "contract") {
    return <ApoloUnitContractPanel unit={unit} />;
  }

  return <ApoloUnitSummary unit={unit} />;
}

function ApoloUnitSummary({
  unit,
}: {
  unit: ApoloPortfolioUnit;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <CompactInfo label="Empreendimento" value={unit.enterprise} />
      <CompactInfo label="Quadra" value={unit.block} />
      <CompactInfo label="Lote" value={unit.lot} />
      <CompactInfo label="Cod. unidade" value={unit.unitCode} />
      <CompactInfo label="Area" value={unit.area} />
      <CompactInfo label="Valor de tabela" value={unit.tableValue} />
      <CompactInfo label="Status do contrato" value={unit.stage} />
      <CompactInfo label="Imobiliaria/corretor" value={unit.referenceLabel} />
      <CompactInfo label="Papel no relacionamento" value={unit.role} />
    </div>
  );
}

function ApoloInstallmentsPanel({
  entity,
  unit,
}: {
  entity: ApoloEntity;
  unit: ApoloPortfolioUnit;
}) {
  const installments = unit.installments;
  const overdueInstallments = installments.filter((installment) => installment.status === "Vencida");
  const paidAmount = installments
    .filter((installment) => installment.status === "Liquidada")
    .reduce((total, installment) => total + installment.valueNumber, 0);
  const overdueAmount = overdueInstallments.reduce(
    (total, installment) => total + installment.valueNumber,
    0,
  );
  const totalAmount = installments.reduce(
    (total, installment) => total + installment.valueNumber,
    0,
  );
  const risk =
    overdueInstallments.length >= 7
      ? "critico"
      : overdueInstallments.length >= 3
        ? "alto"
        : overdueInstallments.length > 0
          ? "medio"
          : "baixo";

  return (
    <div className="grid gap-4">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <CompactInfo label="Valor em carteira" value={formatMoneyLabel(totalAmount, entity.financial.totalPortfolio)} />
        <CompactInfo label="Valor pago" value={formatMoneyLabel(paidAmount, entity.financial.paidAmount)} />
        <CompactInfo label="Valor em atraso" value={formatMoneyLabel(overdueAmount, entity.financial.overdueAmount)} />
        <CompactInfo label="Parcelas vencidas" value={String(overdueInstallments.length)} />
        <CompactInfo label="Risco" value={risk} />
      </div>

      <div className="rounded-xl border border-slate-200/70 bg-slate-50/60 p-4">
        <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="m-0 text-sm font-semibold text-slate-950">Lista de parcelas</p>
            <p className="m-0 mt-1 text-xs font-medium text-slate-500">
              {unit.enterprise} / {unit.unitLabel}
            </p>
          </div>
          <span className="w-fit rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200">
            Leitura Apolo
          </span>
        </div>

        {installments.length ? (
          <div className="grid max-h-[34rem] gap-3 overflow-y-auto pr-1">
            {installments.map((installment) => {
              const boletoUrl = installment.paymentUrl ?? installment.invoiceUrl;

              return (
                <article
                  className="rounded-xl border border-slate-200/70 bg-white p-3"
                  key={installment.id}
                >
                  <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-start 2xl:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="m-0 text-sm font-semibold text-slate-950">
                          Parcela {installment.number}
                        </p>
                        <InstallmentStatusBadge status={installment.status} />
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                        <CompactInfo label="Referencia" value={installment.reference} />
                        <CompactInfo label="Vencimento" value={installment.dueDate} />
                        <CompactInfo label="Pagamento" value={installment.paidAt ?? "-"} />
                        <CompactInfo label="Valor" value={installment.value} />
                        <CompactInfo label="Dias de atraso" value={String(installment.overdueDays)} />
                      </div>
                    </div>
                    {boletoUrl ? (
                      <a
                        className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-[#A07C3B]/20 bg-[#A07C3B]/5 px-3 text-sm font-semibold text-[#7A5E2C] transition-colors hover:bg-[#A07C3B]/10"
                        href={boletoUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Abrir boleto
                        <ExternalLink className="size-3.5" aria-hidden="true" />
                      </a>
                    ) : (
                      <span className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-slate-200/70 bg-slate-50 px-3 text-sm font-semibold text-slate-400">
                        Sem boleto
                      </span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200/70 bg-white px-4 py-6 text-center text-sm font-medium text-slate-500">
            Nenhuma parcela real encontrada para esta unidade.
          </div>
        )}
      </div>
    </div>
  );
}

function InstallmentStatusBadge({ status }: { status: ApoloInstallment["status"] }) {
  const className = {
    "A vencer": "bg-sky-50 text-sky-700 ring-sky-100",
    Liquidada: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    Vencida: "bg-rose-50 text-rose-700 ring-rose-100",
  }[status];

  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${className}`}>
      {status}
    </span>
  );
}

function ApoloUnitTimelinePanel({
  entity,
  unit,
}: {
  entity: ApoloEntity;
  unit: ApoloPortfolioUnit;
}) {
  const normalizedUnit = normalizeText(`${unit.enterprise} ${unit.unitLabel} ${unit.unitCode}`);
  const events = entity.timeline.filter((event) => {
    const normalizedEvent = normalizeText(`${event.title} ${event.description}`);
    return normalizedUnit
      .split(" ")
      .filter((part) => part.length > 2)
      .some((part) => normalizedEvent.includes(part));
  });
  const visibleEvents = events.length ? events : entity.timeline.slice(0, 4);

  if (!visibleEvents.length) {
    return <EmptyPanel text="Nenhum registro de timeline materializado para esta unidade." />;
  }

  return (
    <div className="grid gap-3">
      {visibleEvents.map((event) => (
        <article className="rounded-xl border border-slate-200/70 bg-slate-50/60 p-3" key={`${event.title}-${event.date}`}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="m-0 text-sm font-semibold text-slate-950">{event.title}</p>
              <p className="m-0 mt-1 text-sm leading-6 text-slate-600">{event.description}</p>
            </div>
            <span className="w-fit rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200">
              {event.date}
            </span>
          </div>
        </article>
      ))}
    </div>
  );
}

function ApoloUnitContractPanel({ unit }: { unit: ApoloPortfolioUnit }) {
  const contractUrl = unit.contractDocumentId
    ? `/api/hades/d4sign/contracts/${encodeURIComponent(unit.contractDocumentId)}`
    : unit.contractUrl;

  return (
    <div className="rounded-xl border border-slate-200/70 bg-slate-50/60 p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="m-0 text-sm font-semibold text-slate-950">Contrato</p>
          <p className="m-0 mt-2 text-lg font-semibold text-[#7A5E2C]">{unit.unitCode}</p>
          <p className="m-0 mt-1 text-sm font-medium text-slate-500">
            {unit.enterprise} / {unit.unitLabel}
          </p>
        </div>
        <span className="w-fit rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
          {unit.contractStatus ?? "Nao localizado"}
        </span>
      </div>
      {contractUrl ? (
        <a
          className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg border border-[#A07C3B]/20 bg-[#A07C3B]/5 px-3 text-sm font-semibold text-[#7A5E2C] transition-colors hover:bg-[#A07C3B]/10"
          href={contractUrl}
          rel="noreferrer"
          target="_blank"
        >
          Abrir contrato
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
      ) : (
        <button
          className="mt-4 inline-flex h-9 cursor-not-allowed items-center rounded-lg border border-slate-200/70 bg-white px-3 text-sm font-semibold text-slate-400"
          disabled
          type="button"
        >
          Contrato nao materializado
        </button>
      )}
    </div>
  );
}

function CompactInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200/70 bg-white p-3">
      <p className="m-0 text-[11px] font-medium text-slate-500">{label}</p>
      <p className="m-0 mt-1 break-words text-sm font-semibold text-slate-950">
        {value || "-"}
      </p>
    </div>
  );
}

function FinancialPanel({ entity }: { entity: ApoloEntity }) {
  const [activeFinancialSubtab, setActiveFinancialSubtab] =
    useState<ApoloFinancialSubtab>("acordos");
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [typeFilter, setTypeFilter] = useState<"Todos" | ApoloFinancialRecordType>("Todos");
  const [statusFilter, setStatusFilter] = useState("Todos");
  const [unitFilter, setUnitFilter] = useState("Todas");
  const units = useMemo(() => buildPortfolioUnits(entity), [entity]);
  const records = useMemo(() => buildApoloFinancialRecords(entity), [entity]);
  const statuses = useMemo(
    () => uniqueText(records.map((record) => record.status)),
    [records],
  );
  const filteredRecords = useMemo(
    () =>
      records.filter((record) => {
        const matchesType = typeFilter === "Todos" || record.type === typeFilter;
        const matchesStatus = statusFilter === "Todos" || record.status === statusFilter;
        const matchesUnit = unitFilter === "Todas" || record.unitCode === unitFilter;

        return matchesType && matchesStatus && matchesUnit;
      }),
    [records, statusFilter, typeFilter, unitFilter],
  );
  const summary = buildApoloFinancialSummary(filteredRecords);
  const activeFilters = [
    typeFilter !== "Todos" ? { label: "Tipo", value: typeFilter, clear: () => setTypeFilter("Todos") } : null,
    statusFilter !== "Todos" ? { label: "Status", value: statusFilter, clear: () => setStatusFilter("Todos") } : null,
    unitFilter !== "Todas" ? { label: "Unidade", value: unitFilter, clear: () => setUnitFilter("Todas") } : null,
  ].filter(Boolean) as Array<{ clear: () => void; label: string; value: string }>;

  return (
    <section className="grid gap-4">
      <section className="rounded-xl border border-slate-200/70 bg-white p-4">
        <PanelTitle eyebrow="Financeiro" title="Cenario financeiro do cliente" />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <FinancialMetric
            label="Carteira"
            tone="gold"
            value={formatMoneyLabel(
              currencyLabelToNumber(entity.financial.totalPortfolio),
              entity.financial.totalPortfolio || "-",
            )}
          />
          <FinancialMetric
            label="Pago"
            value={formatMoneyLabel(
              currencyLabelToNumber(entity.financial.paidAmount),
              entity.financial.paidAmount || "-",
            )}
          />
          <FinancialMetric
            label="Vencido"
            tone={currencyLabelToNumber(entity.financial.overdueAmount) > 0 ? "danger" : undefined}
            value={formatMoneyLabel(
              currencyLabelToNumber(entity.financial.overdueAmount),
              entity.financial.overdueAmount || "-",
            )}
          />
          <FinancialMetric
            label="Parcelas vencidas"
            tone={entity.financial.overdueInstallments > 0 ? "danger" : undefined}
            value={String(entity.financial.overdueInstallments)}
          />
          <FinancialMetric
            label="Comportamento"
            value={entity.financial.paymentBehavior || "-"}
          />
          <FinancialMetric label="Risco" tone="gold" value={entity.financial.risk} />
        </div>
        <p className="m-0 mt-3 text-xs font-medium text-slate-400">
          Pagamentos, acordos e promessas abaixo. (mock para validacao — registro/escrita
          depende da API do Apolo)
        </p>
      </section>
      <section className="rounded-xl border border-slate-200/70 bg-white p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <PanelTitle eyebrow="Financeiro" title="Area financeira" />
            <p className="m-0 mt-2 text-sm font-medium text-slate-500">
              Acordos agora ficam em subaba propria para abrir espaco para novas leituras financeiras.
            </p>
          </div>
        </div>
        <FinancialSubtabNav
          activeSubtab={activeFinancialSubtab}
          onChange={setActiveFinancialSubtab}
        />
      </section>
      {activeFinancialSubtab === "acordos" ? (
        <>
          <section className="rounded-xl border border-slate-200/70 bg-white p-4">
            <PanelTitle eyebrow="Acordos" title="Indicadores de acordos e promessas" />
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
              <FinancialMetric label="Promessas abertas" value={String(summary.openPromises)} tone="gold" />
              <FinancialMetric label="Promessas cumpridas" value={String(summary.fulfilledPromises)} />
              <FinancialMetric label="Promessas quebradas" value={String(summary.brokenPromises)} tone="danger" />
              <FinancialMetric label="Acordos ativos" value={String(summary.activeAgreements)} tone="gold" />
              <FinancialMetric label="Valor em atraso" value={entity.financial.overdueAmount} tone="danger" />
              <FinancialMetric label="Risco de quebra" value={entity.financial.risk} tone="gold" />
            </div>
          </section>
          <section className="rounded-xl border border-slate-200/70 bg-white p-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <PanelTitle eyebrow="Central operacional" title="Acordos e promessas" />
                <p className="m-0 mt-2 text-sm font-medium text-slate-500">
                  Estrutura nativa do Apolo para compromissos financeiros do relacionamento.
                </p>
              </div>
              <div className="flex gap-2">
                <Tooltip content="Nova promessa depende da API de escrita do Apolo" placement="bottom">
                  <button className="inline-flex size-9 cursor-not-allowed items-center justify-center rounded-lg border border-[#A07C3B]/20 bg-[#A07C3B]/5 text-[#7A5E2C] opacity-70" disabled type="button">
                    <CalendarClock className="size-4" aria-hidden="true" />
                  </button>
                </Tooltip>
                <Tooltip content="Novo acordo depende da API de escrita do Apolo" placement="bottom">
                  <button className="inline-flex size-9 cursor-not-allowed items-center justify-center rounded-lg bg-slate-100 text-slate-400" disabled type="button">
                    <Handshake className="size-4" aria-hidden="true" />
                  </button>
                </Tooltip>
              </div>
            </div>

            <div className="mt-4 grid gap-3 rounded-xl border border-slate-200/70 bg-slate-50/60 p-3 xl:grid-cols-[minmax(0,1fr)_300px]">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    aria-expanded={filtersExpanded}
                    className="inline-flex h-8 items-center gap-2 rounded-lg border border-slate-200/70 bg-white px-2.5 text-xs font-semibold text-slate-600 hover:bg-[#A07C3B]/5"
                    onClick={() => setFiltersExpanded((current) => !current)}
                    type="button"
                  >
                    <Filter className="size-3.5 text-[#A07C3B]" aria-hidden="true" />
                    Filtros{activeFilters.length > 0 ? ` (${activeFilters.length})` : ""}
                    <ChevronDown className={`size-3.5 text-[#A07C3B] transition-transform ${filtersExpanded ? "rotate-180" : ""}`} aria-hidden="true" />
                  </button>
                  {activeFilters.map((filter) => (
                    <Tooltip content={`Remover ${filter.label}`} key={`${filter.label}-${filter.value}`} placement="top">
                      <button className="inline-flex h-7 max-w-44 items-center gap-1 rounded-full bg-[#A07C3B]/5 px-2 text-[11px] font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15" onClick={filter.clear} type="button">
                        <span className="truncate">{filter.value}</span>
                        <span aria-hidden="true">x</span>
                      </button>
                    </Tooltip>
                  ))}
                </div>
                <div className={`grid transition-all duration-300 ease-out ${filtersExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
                  <div className="min-h-0 overflow-hidden">
                    <div className="grid gap-2 pt-3 md:grid-cols-3">
                      <ApoloFilterSelect label="Tipo" onChange={(value) => setTypeFilter(value as "Todos" | ApoloFinancialRecordType)} value={typeFilter}>
                        <option>Todos</option>
                        <option>Promessa de pagamento</option>
                        <option>Acordo</option>
                      </ApoloFilterSelect>
                      <ApoloFilterSelect label="Status" onChange={setStatusFilter} value={statusFilter}>
                        <option>Todos</option>
                        {statuses.map((status) => (
                          <option key={status}>{status}</option>
                        ))}
                      </ApoloFilterSelect>
                      <ApoloFilterSelect label="Unidade/lote" onChange={setUnitFilter} value={unitFilter}>
                        <option value="Todas">Todas</option>
                        {units.map((unit) => (
                          <option key={unit.id} value={unit.unitCode}>
                            {unit.unitCode} / {unit.unitLabel}
                          </option>
                        ))}
                      </ApoloFilterSelect>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-[#A07C3B]/15 bg-white p-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="size-4 text-[#A07C3B]" aria-hidden="true" />
                  <p className="m-0 text-sm font-semibold text-slate-950">Leitura operacional</p>
                </div>
                <p className="m-0 mt-2 text-xs leading-5 text-slate-600">
                  {entity.financial.paymentBehavior}
                </p>
              </div>
            </div>

            <ApoloFinancialRecordList records={filteredRecords} />
          </section>
        </>
      ) : null}
    </section>
  );
}

function FinancialSubtabNav({
  activeSubtab,
  onChange,
}: {
  activeSubtab: ApoloFinancialSubtab;
  onChange: (subtab: ApoloFinancialSubtab) => void;
}) {
  return (
    <nav aria-label="Areas financeiras" className="mt-4 flex flex-wrap gap-1 rounded-xl border border-slate-200/70 bg-white p-1">
      {apoloFinancialSubtabs.map((tab) => {
        const Icon = tab.icon;
        const active = activeSubtab === tab.id;

        return (
          <button
            aria-current={active ? "page" : undefined}
            className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#A07C3B] ${
              active
                ? "bg-slate-950 text-white"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
            }`}
            key={tab.id}
            onClick={() => onChange(tab.id)}
            type="button"
          >
            <Icon className="size-4" aria-hidden="true" />
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}

function FinancialMetric({
  label,
  tone = "neutral",
  value,
}: {
  label: string;
  tone?: "neutral" | "gold" | "danger";
  value: string;
}) {
  const toneClass = {
    danger: "bg-rose-50 text-rose-700 ring-rose-100",
    gold: "bg-[#A07C3B]/5 text-[#7A5E2C] ring-[#A07C3B]/15",
    neutral: "bg-slate-50/70 text-slate-950 ring-slate-200/70",
  }[tone];

  return (
    <div className={`min-w-0 rounded-xl px-3 py-2.5 ring-1 ${toneClass}`}>
      <p className="truncate text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 truncate text-lg font-semibold tracking-normal">{value}</p>
    </div>
  );
}

function ApoloFilterSelect({
  children,
  label,
  onChange,
  value,
}: {
  children: ReactNode;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label>
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <select
        className="mt-1 h-9 w-full rounded-lg border border-slate-200/70 bg-white px-3 text-sm font-medium text-slate-700 outline-none transition-colors hover:bg-slate-50"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {children}
      </select>
    </label>
  );
}

function ApoloFinancialRecordList({ records }: { records: ApoloFinancialRecord[] }) {
  if (!records.length) {
    return (
      <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm font-semibold text-slate-500">
        Nenhum acordo ou promessa materializado no Apolo para os filtros selecionados.
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-slate-200/70 bg-white">
      <div className="grid grid-cols-[0.95fr_0.85fr_0.9fr_0.85fr_0.8fr_0.85fr] gap-3 border-b border-slate-100 bg-slate-50/80 px-4 py-2.5 text-xs font-semibold text-slate-500 max-lg:hidden">
        <span>Tipo</span>
        <span>Status</span>
        <span>Registro</span>
        <span>Cod. unidade</span>
        <span>Valor</span>
        <span>Data</span>
      </div>
      <div className="max-h-[520px] overflow-y-auto [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300">
        {records.map((record) => (
          <article
            className="grid gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0 lg:grid-cols-[0.95fr_0.85fr_0.9fr_0.85fr_0.8fr_0.85fr] lg:items-center"
            key={record.id}
          >
            <div className="min-w-0">
              <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${financialRecordTypeClass(record.type)}`}>
                {record.type}
              </span>
              <p className="m-0 mt-1 truncate text-sm font-semibold text-slate-950">{record.enterprise}</p>
              <p className="m-0 mt-0.5 truncate text-xs text-slate-500">{record.unitLabel}</p>
            </div>
            <div>
              <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${financialRecordStatusClass(record.status)}`}>
                {record.status}
              </span>
            </div>
            <div className="min-w-0">
              <p className="m-0 truncate text-xs text-slate-500 lg:hidden">Registro</p>
              <p className="m-0 mt-1 truncate text-sm font-semibold text-slate-950 lg:mt-0">{record.title}</p>
              <p className="m-0 mt-0.5 w-fit rounded-full bg-[#A07C3B]/5 px-2 py-0.5 text-[11px] font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
                {record.protocol}
              </p>
            </div>
            <div className="min-w-0">
              <p className="m-0 truncate text-xs text-slate-500 lg:hidden">Cod. unidade</p>
              <p className="m-0 mt-1 truncate text-sm font-semibold text-slate-950 lg:mt-0">{record.unitCode}</p>
            </div>
            <div className="min-w-0">
              <p className="m-0 text-xs font-medium text-slate-500">Valor</p>
              <p className="m-0 mt-1 truncate text-sm font-semibold text-slate-950">{record.value}</p>
            </div>
            <div className="min-w-0">
              <p className="m-0 text-xs font-medium text-slate-500">Data</p>
              <p className="m-0 mt-1 truncate text-sm font-semibold text-slate-950">{record.date}</p>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function DocumentsPanel({
  entity,
}: {
  entity: ApoloEntity;
}) {
  const [openingDocumentId, setOpeningDocumentId] = useState<string | null>(null);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const contractDocuments = contractDocumentItems(entity);
  const identityDocuments = entity.documents.map((document) => ({
    detail: document.updatedAt,
    id: `document-${document.label}`,
    meta: "Documento cadastral",
    status: document.status,
    title: document.label,
  }));

  async function openApoloDocument(documentUrl: string, documentId: string) {
    const previewWindow = window.open("about:blank", "_blank");

    if (previewWindow) {
      previewWindow.opener = null;
    }

    try {
      setOpeningDocumentId(documentId);
      setDocumentError(null);

      const accessToken = await getApoloAccessToken();
      const response = await fetch(documentUrl, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;

        throw new Error(payload?.error ?? "Nao foi possivel abrir o documento.");
      }

      const documentBlob = await response.blob();
      const objectUrl = window.URL.createObjectURL(documentBlob);

      if (previewWindow) {
        previewWindow.location.href = objectUrl;
      } else {
        window.open(objectUrl, "_blank", "noreferrer");
      }

      window.setTimeout(() => {
        window.URL.revokeObjectURL(objectUrl);
      }, 60000);
    } catch (error) {
      previewWindow?.close();
      setDocumentError(
        error instanceof Error
          ? error.message
          : "Nao foi possivel abrir o documento.",
      );
    } finally {
      setOpeningDocumentId(null);
    }
  }

  return (
    <section className="grid gap-4">
      {documentError ? (
        <p className="m-0 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
          {documentError}
        </p>
      ) : null}
      <section className="rounded-xl border border-slate-200/70 bg-white p-4">
        <PanelTitle eyebrow="Documentos" title="Contrato" />
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {contractDocuments.map((document) => (
            <article
              className="rounded-xl border border-slate-200/70 bg-slate-50/70 p-4"
              key={document.id}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="m-0 truncate text-sm font-semibold text-slate-950">
                    {document.title}
                  </p>
                  {document.href ? (
                    <button
                      className="mt-1 inline-flex max-w-full items-center gap-1.5 rounded-lg border border-[#A07C3B]/20 bg-white px-2 py-1 text-xs font-semibold text-[#7A5E2C] transition-colors hover:bg-[#A07C3B]/10 disabled:cursor-wait disabled:opacity-70"
                      disabled={openingDocumentId === document.id}
                      onClick={() => {
                        if (document.href) {
                          void openApoloDocument(document.href, document.id);
                        }
                      }}
                      type="button"
                    >
                      <span className="truncate">{document.detail}</span>
                      <ExternalLink className="size-3" aria-hidden="true" />
                    </button>
                  ) : (
                    <p className="m-0 mt-1 truncate text-xs text-slate-500">
                      {document.detail}
                    </p>
                  )}
                  <p className="m-0 mt-1 truncate text-xs font-medium text-slate-500">
                    {document.meta}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/20">
                    {document.unitBadge}
                  </span>
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
                    {document.status}
                  </span>
                </div>
              </div>
            </article>
          ))}
          {!contractDocuments.length ? (
            <EmptyPanel text="Nenhum contrato localizado para este relacionamento." />
          ) : null}
        </div>
      </section>
      <section className="rounded-xl border border-slate-200/70 bg-white p-4">
        <PanelTitle eyebrow="Documentos" title="Cadastro e anexos" />
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {identityDocuments.map((document) => (
            <article
              className="rounded-xl border border-slate-200/70 bg-slate-50/70 p-4"
              key={document.id}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="m-0 text-sm font-semibold text-slate-950">
                    {document.title}
                  </p>
                  <p className="m-0 mt-1 text-xs text-slate-500">
                    {document.detail}
                  </p>
                  <p className="m-0 mt-1 text-xs font-medium text-slate-500">
                    {document.meta}
                  </p>
                </div>
                <DocumentPill status={document.status} />
              </div>
            </article>
          ))}
          {!identityDocuments.length ? (
            <EmptyPanel text="Nenhum documento cadastral consolidado neste relacionamento." />
          ) : null}
        </div>
      </section>
    </section>
  );
}

function TimelinePanel({
  events,
}: {
  events: readonly ApoloTimelineEvent[];
}) {
  const [timelineQuery, setTimelineQuery] = useState("");
  const filteredEvents = useMemo(() => {
    const normalizedQuery = normalizeText(timelineQuery);

    if (!normalizedQuery) {
      return events;
    }

    return events.filter((event) =>
      normalizeText(`${event.title} ${event.description} ${event.date}`).includes(normalizedQuery),
    );
  }, [events, timelineQuery]);
  const timelineActions = [
    { icon: MessageCircle, label: "WhatsApp" },
    { icon: PhoneCall, label: "Ligacao" },
    { icon: Handshake, label: "Acordo" },
    { icon: ReceiptText, label: "Boleto" },
  ] as const satisfies readonly { icon: LucideIcon; label: string }[];

  return (
    <section className="rounded-xl border border-slate-200/70 bg-white p-4">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <PanelTitle eyebrow={`${filteredEvents.length}/${events.length} eventos`} title="Timeline operacional do relacionamento" />
        <div className="flex flex-wrap gap-2">
          <label className="flex h-8 min-w-[16rem] items-center gap-2 rounded-lg border border-slate-200/70 bg-slate-50/80 px-2.5 text-slate-500">
            <Search className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="sr-only">Buscar na timeline</span>
            <input
              className="w-full bg-transparent text-xs font-semibold text-slate-900 outline-none placeholder:text-slate-400"
              onChange={(event) => setTimelineQuery(event.target.value)}
              placeholder="Buscar evento, protocolo ou unidade"
              type="search"
              value={timelineQuery}
            />
          </label>
          <div className="flex gap-2 overflow-x-auto pb-1 lg:pb-0">
            {timelineActions.map((action) => {
              const Icon = action.icon;

              return (
                <button
                  className="inline-flex h-8 shrink-0 items-center gap-2 rounded-lg border border-slate-200/70 bg-white px-2.5 text-xs font-semibold text-slate-700 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-slate-950"
                  key={action.label}
                  type="button"
                >
                  <Icon className="size-3.5 text-[#A07C3B]" aria-hidden="true" />
                  {action.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="relative space-y-3 before:absolute before:left-[18px] before:top-2 before:h-[calc(100%-1rem)] before:w-px before:bg-slate-200">
        {filteredEvents.map((event) => (
          <TimelineRow event={event} key={`${event.date}-${event.title}`} />
        ))}
        {!filteredEvents.length ? (
          <EmptyPanel text="Nenhum evento encontrado para a consulta atual." />
        ) : null}
      </div>
    </section>
  );
}

function TimelineRow({
  compact = false,
  event,
}: {
  compact?: boolean;
  event: ApoloTimelineEvent;
}) {
  const normalized = normalizeText(`${event.title} ${event.description}`);
  const isAction = [
    "acordo",
    "boleto",
    "cobranca",
    "contato",
    "ligacao",
    "pagamento",
    "promessa",
    "whatsapp",
  ].some((term) => normalized.includes(term));
  const Icon = getTimelineIcon(normalized);
  const statusTone = {
    attention: "bg-amber-50 text-amber-800 ring-amber-100",
    blocked: "bg-rose-50 text-rose-700 ring-rose-100",
    ok: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  } as const satisfies Record<ApoloTimelineEvent["status"], string>;

  return (
    <article
      className={`rounded-xl border border-slate-200/70 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)] ${
        compact ? "" : "relative ml-11"
      }`}
    >
      {!compact ? (
        <span className="absolute -left-[3rem] top-3 grid size-9 place-items-center rounded-lg border border-slate-200/70 bg-white">
          <span className="grid size-5 place-items-center rounded-full bg-emerald-50 text-emerald-700">
            <Icon className="size-3.5" aria-hidden="true" />
          </span>
        </span>
      ) : null}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {compact ? (
              <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-[#A07C3B]/5 text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
                <Icon className="size-3.5" aria-hidden="true" />
              </span>
            ) : null}
            <p className="m-0 truncate text-sm font-semibold text-slate-950">
              {event.title}
            </p>
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${statusTone[event.status]}`}
            >
              {event.status === "ok" ? "Registrado" : "Atencao"}
            </span>
            <Pill>{isAction ? "Acao operacional" : "Informativo"}</Pill>
            {isAction ? <Pill>Protocolo pendente</Pill> : null}
          </div>
          <p className="m-0 mt-2 text-sm font-medium text-slate-600">
            {event.description}
          </p>
        </div>
        <time className="shrink-0 text-xs font-medium text-slate-500">
          {event.date}
        </time>
      </div>
    </article>
  );
}

function AuditPanel({ audit }: { audit: readonly ApoloAuditSignal[] }) {
  return (
    <section className="overflow-x-auto rounded-lg border border-slate-200/70 bg-white">
      <div className="min-w-[38rem]">
        <div className="grid grid-cols-[minmax(0,1fr)_8rem_8rem] gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
          <span>Campo</span>
          <span>Status</span>
          <span>Atualizado</span>
        </div>
        {audit.map((item) => (
          <div
            className="grid grid-cols-[minmax(0,1fr)_8rem_8rem] gap-3 border-b border-slate-100 px-4 py-3 text-sm font-medium text-slate-600 last:border-b-0"
            key={item.field}
          >
            <span className="min-w-0 truncate font-semibold text-slate-950">
              {item.field}
            </span>
            <span>{item.status}</span>
            <span>{item.updatedAt}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// Primitivos visuais movidos para ./blocks/shared/apolo-ui.tsx

// Helpers de derivacao movidos para ./data/apolo-derive.
// Acesso a dados / operacoes manuais movidos para ./data/apolo-operations.

export { AuditPanel, DocumentsPanel, FinancialPanel, PortfolioPanel, RegistrationPanel, SummaryPanel, TimelinePanel };
