import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CalendarClock,
  ChevronDown,
  ExternalLink,
  FileText,
  Filter,
  Handshake,
  Loader2,
  MapPinned,
  MessageCircle,
  PhoneCall,
  ReceiptText,
  Search,
  Sparkles,
  Trash2,
  UploadCloud,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Tooltip } from "@repo/uix";
import { apoloProfileLabels } from "@/lib/apolo/catalog";
import type { ApoloAuditSignal, ApoloEntity, ApoloInstallment, ApoloTimelineEvent } from "@/lib/apolo/types";
import type { ApoloDocumentItem } from "@/lib/apolo/documentos";

import {
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
  entityC2xId,
  financialRecordStatusClass,
  financialRecordTypeClass,
  formatMoneyLabel,
  fullAddressLabel,
  getTimelineIcon,
  hasCommercialRole,
  isCompanyEntity,
  kindLabel,
  monthYearLabel,
  normalizeText,
  portfolioUnitSubtitle,
  primaryBusinessProfile,
  primaryContact,
  primaryPhoneContact,
  relationshipSummary,
  resolveCarteiraRoles,
  responsibleLabel,
  summaryName,
  uniqueText,
} from "../../data/apolo-derive";
import type { ApoloCarteiraRoleKind } from "../../data/apolo-derive";
import { ScopedPortfolioPanel } from "./scoped-portfolio-panel";
import { StatementPanel } from "./statement-panel";
import { getApoloAccessToken } from "../../data/apolo-operations";
import type {
  ApoloFinancialRecord,
  ApoloFinancialRecordType,
  ApoloFinancialSubtab,
  ApoloPortfolioUnit,
  ApoloTab,
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
      <section className="rounded-xl border border-line bg-surface p-4">
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
        <section className="rounded-xl border border-line bg-surface p-4">
          <PanelTitle eyebrow="Atividade" title="Ultimos eventos" />
          <div className="mt-4 grid gap-2">
            {recentEvents.length ? (
              recentEvents.map((event, index) => {
                const Icon = getTimelineIcon(
                  normalizeText(`${event.title} ${event.description}`),
                );

                return (
                  <div
                    className="flex items-start gap-3 rounded-lg border border-line bg-subtle p-3"
                    key={`${event.title}-${event.date}-${index}`}
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface text-[#7a5e2c] dark:text-[#d9b877] ring-1 ring-line">
                      <Icon className="size-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="m-0 truncate text-sm font-semibold text-ink">
                          {displayText(event.title)}
                        </p>
                        <span className="shrink-0 text-xs font-medium text-ink-muted">
                          {event.date || "-"}
                        </span>
                      </div>
                      {event.description ? (
                        <p className="m-0 mt-0.5 truncate text-xs font-medium text-ink-muted">
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

        <section className="rounded-xl border border-line bg-surface p-4">
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
        <section className="rounded-xl border border-line bg-surface p-4">
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
  // O nome exibido é o FANTASIA (regra do Lucas). "Nome fantasia" era uma linha duplicada do
  // "Nome" — saiu. A razão social só aparece quando REALMENTE difere do nome (o C2X costuma
  // repetir o mesmo texto nos dois campos, e aí virava nome três vezes na tela).
  const displayName = displayHeaderName(entity);
  const legalName = isCompany ? summaryName(entity) : "";
  const showLegalName = Boolean(
    legalName && legalName.trim().toLowerCase() !== displayName.trim().toLowerCase(),
  );
  // Ficha ao vivo do C2X (enricher).
  const cad = entity.c2xCadastro;
  // Endereço completo do C2X quando houver (logradouro, número · bairro · cidade-UF).
  const cidadeUf = cad?.city
    ? `${cad.city}${cad.state ? `-${cad.state}` : ""}`
    : displayText(cityStateLabel(primaryAddress, entity.locationLabel));
  const c2xFullAddress = cad?.street
    ? [
        `${cad.street}${cad.number ? `, ${cad.number}` : ""}`,
        cad.district,
        cidadeUf,
      ]
        .filter(Boolean)
        .join(" · ")
    : fullAddress;
  const cadastroRows: Array<readonly [string, string]> = [
    ["Nome", displayName],
    ["CPF/CNPJ", entity.documentMasked],
    ...(showLegalName ? [["Razao social", legalName] as const] : []),
    ["Telefone", primaryPhone?.value ?? "-"],
    ["E-mail", primaryEmail?.value ?? "-"],
    ["Endereco", c2xFullAddress],
  ];
  // Casado (ou união estável) libera regime + cônjuge.
  const civilStatus = cad?.civilState ?? civilStatusLabel(entity);
  const isMarried = /casad|uni[aã]o est[aá]vel/i.test(civilStatus ?? "");
  // CRECI só faz sentido pra imobiliária/corretor.
  const isRealtor =
    entity.profiles.includes("imobiliaria") || entity.profiles.includes("corretor");
  const addressRows: Array<readonly [string, string]> = [
    ["Endereco", cad?.street ?? "-"],
    ["Numero", cad?.number ?? primaryAddress?.number ?? "-"],
    ["Bairro", cad?.district ?? primaryAddress?.district ?? "-"],
    ["Complemento", cad?.complement ?? primaryAddress?.complement ?? "-"],
    ["CEP", cad?.zipcode ?? primaryAddress?.postalCode ?? "-"],
    ["Cidade", cidadeUf],
  ];
  // Campos POR PERFIL (regra do Lucas): PJ é empresa, não tem nascimento/idade/RG/
  // sexo/estado civil/regime/profissão/cônjuge. Regime de bens só quando casado.
  // Relacionamento/responsável NÃO são campos aqui — vivem na aba Relacionamentos.
  const detailRows: Array<readonly [string, string]> = isCompany
    ? [
        ["Tipo pessoa", kindLabel(entity.kind)],
        ...(isRealtor ? [["CRECI", cad?.creciNumber ?? "-"] as const] : []),
        ["NIRE", cad?.nire ?? "-"],
        ["Inscricao municipal", cad?.municipalInscription ?? "-"],
        ["Data de abertura", cad?.openCompanyDate ?? "-"],
        ["Atualizacao cadastral", cad?.socialContractUpdatedAt ?? "-"],
        ...addressRows,
      ]
    : [
        ["Tipo pessoa", kindLabel(entity.kind)],
        ["RG", cad?.rg ?? "-"],
        ...(isRealtor ? [["CRECI", cad?.creciNumber ?? "-"] as const] : []),
        ["Nascimento", cad?.birthday ?? "-"],
        ["Idade", cad?.age ?? "-"],
        ["Sexo", cad?.sex ?? "-"],
        ["Estado civil", civilStatus || "-"],
        ...(isMarried ? [["Regime de bens", cad?.propertyRegime ?? "-"] as const] : []),
        ["Profissao", cad?.profession ?? "-"],
        ["Renda", cad?.salaryRange ?? "-"],
        ["Escolaridade", cad?.schooling ?? "-"],
        ["Naturalidade", cad?.naturalness ?? "-"],
        ["Nacionalidade", cad?.nacionality ?? "-"],
        ["Nome da mae", cad?.motherName ?? "-"],
        ...addressRows,
      ];

  return (
    <div className="grid gap-4">
      <section className="rounded-xl border border-line bg-surface p-4">
        <PanelTitle eyebrow="Dados do cliente" title="Cadastro" />
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {cadastroRows.map(([label, value]) => (
            <ReadonlyLine key={label} label={label} value={value || "-"} />
          ))}
        </div>
      </section>
      <section className="rounded-xl border border-line bg-surface p-4">
        <PanelTitle eyebrow="Cadastro completo" title="Dados cadastrais" />
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {detailRows.map(([label, value]) => (
            <ReadonlyLine key={label} label={label} value={value || "-"} />
          ))}
        </div>
      </section>
      {/* Cônjuge: só PF casada (PJ e solteiro não têm). Vem do C2X (spouses) e
          também aparece na aba Relacionamentos como contato. */}
      {!isCompany && (isMarried || cad?.spouse) ? (
        <section className="rounded-xl border border-line bg-surface p-4">
          <PanelTitle eyebrow="Conjuge" title="Dados do conjuge" />
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <ReadonlyLine label="Conjuge" value={cad?.spouse?.name ?? "-"} />
            <ReadonlyLine label="CPF" value={cad?.spouse?.cpf ?? "-"} />
            <ReadonlyLine label="Telefone" value={cad?.spouse?.phone ?? "-"} />
            <ReadonlyLine label="E-mail" value={cad?.spouse?.email ?? "-"} />
            <ReadonlyLine label="Nascimento" value={cad?.spouse?.birthday ?? "-"} />
            <ReadonlyLine label="Documento" value={cad?.spouse?.document ?? "-"} />
            <ReadonlyLine label="Profissao" value={cad?.spouse?.profession ?? "-"} />
          </div>
        </section>
      ) : null}
    </div>
  );
}

// Roteia a aba Carteira pelo PAPEL da entidade. Comprador puro = ficha detalhada (unidades).
// Incorporador/imobiliária/corretor = carteira agregada com drill-down. Múltiplos papéis =
// seletor pra alternar. Ver [[project-apolo-empreendimento-tela]].
function PortfolioPanel({
  entity,
  onOpenEntity,
}: {
  entity: ApoloEntity;
  onOpenEntity: (label: string, entityId: string, tab?: ApoloTab) => void;
}) {
  const roles = useMemo(() => resolveCarteiraRoles(entity), [entity]);
  const [activeKind, setActiveKind] = useState<ApoloCarteiraRoleKind | null>(
    roles[0]?.kind ?? null,
  );

  useEffect(() => {
    setActiveKind((current) =>
      current && roles.some((role) => role.kind === current)
        ? current
        : (roles[0]?.kind ?? null),
    );
  }, [roles]);

  if (!roles.length || !activeKind) {
    return <EmptyPanel text="Nenhuma carteira disponivel para este relacionamento." />;
  }

  const selector =
    roles.length > 1 ? (
      <div className="inline-flex rounded-lg border border-line bg-subtle p-0.5">
        {roles.map((role) => (
          <button
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              role.kind === activeKind
                ? "bg-surface text-ink shadow-sm ring-1 ring-line"
                : "text-ink-muted hover:text-ink"
            }`}
            key={role.kind}
            onClick={() => setActiveKind(role.kind)}
            type="button"
          >
            {role.label}
          </button>
        ))}
      </div>
    ) : null;

  if (activeKind === "comprador") {
    return (
      <div className="grid gap-4">
        {selector ? <div className="flex justify-end">{selector}</div> : null}
        <BuyerPortfolioPanel entity={entity} />
      </div>
    );
  }

  const c2xId = entityC2xId(entity);

  if (c2xId == null) {
    return <EmptyPanel text="Cadastro sem vinculo com o C2X para montar a carteira." />;
  }

  return (
    <ScopedPortfolioPanel
      c2xId={c2xId}
      key={activeKind}
      kind={activeKind}
      onOpenEntity={onOpenEntity}
      roleSelector={selector}
    />
  );
}

function BuyerPortfolioPanel({ entity }: { entity: ApoloEntity }) {
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
      <aside className="rounded-xl border border-line bg-surface p-4">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-[#A07C3B]/5 text-[#7a5e2c] dark:text-[#d9b877] ring-1 ring-[#A07C3B]/15">
            <MapPinned className="size-4" aria-hidden="true" />
          </span>
          <div>
            <p className="m-0 text-sm font-semibold text-ink">Unidades e lotes</p>
            <p className="m-0 mt-1 text-xs font-medium text-ink-muted">
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
                    : "border-line bg-subtle hover:border-[#A07C3B]/20 hover:bg-[#A07C3B]/5"
                }`}
                key={unit.id}
                onClick={() => {
                  setSelectedUnitId(unit.id);
                  setActiveUnitSubtab("summary");
                }}
                type="button"
              >
                <p className="m-0 text-sm font-semibold text-ink">{unit.enterprise}</p>
                <p className="m-0 mt-1 text-xs font-medium text-ink-muted">
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
      <section className="rounded-xl border border-line bg-surface p-4">
        <div className="flex flex-col gap-3 border-b border-line pb-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#A07C3B]/5 text-[#7a5e2c] dark:text-[#d9b877] ring-1 ring-[#A07C3B]/15">
                <MapPinned className="size-4" aria-hidden="true" />
              </span>
              <p className="m-0 text-sm font-semibold text-ink">Unidade selecionada</p>
            </div>
            <h3 className="m-0 mt-3 text-xl font-semibold text-ink">
              {selectedUnit.enterprise}
            </h3>
            <p className="m-0 mt-2 text-sm font-medium text-ink-muted">
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
    <nav aria-label="Detalhes da unidade" className="mt-4 flex w-fit flex-wrap gap-1 rounded-xl border border-line bg-surface p-1">
      {apoloUnitSubtabs.map((tab) => {
        const Icon = tab.icon;
        const active = activeSubtab === tab.id;

        return (
          <Tooltip content={tab.label} key={tab.id} placement="bottom">
            <button
              aria-label={tab.label}
              className={`inline-flex size-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset transition-colors ${
                active
                  ? "bg-[#A07C3B]/8 text-[#7a5e2c] dark:text-[#d9b877] ring-[#A07C3B]/20"
                  : "bg-surface text-ink-soft ring-line hover:bg-subtle"
              }`}
              onClick={() => onChange(tab.id)}
              type="button"
            >
              <Icon
                aria-hidden="true"
                className={`size-3.5 ${active ? "text-[#A07C3B]" : "text-ink-muted"}`}
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

      <div className="rounded-xl border border-line bg-subtle p-4">
        <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="m-0 text-sm font-semibold text-ink">Lista de parcelas</p>
            <p className="m-0 mt-1 text-xs font-medium text-ink-muted">
              {unit.enterprise} / {unit.unitLabel}
            </p>
          </div>
          <span className="w-fit rounded-full bg-surface px-2.5 py-1 text-[11px] font-semibold text-ink-soft ring-1 ring-line">
            Leitura Apolo
          </span>
        </div>

        {installments.length ? (
          <div className="grid max-h-[34rem] gap-3 overflow-y-auto pr-1">
            {installments.map((installment) => {
              const boletoUrl = installment.paymentUrl ?? installment.invoiceUrl;

              return (
                <article
                  className="rounded-xl border border-line bg-surface p-3"
                  key={installment.id}
                >
                  <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-start 2xl:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="m-0 text-sm font-semibold text-ink">
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
                      <Tooltip content="Abrir boleto">
                        <a
                          aria-label="Abrir boleto"
                          className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-[#A07C3B]/20 bg-[#A07C3B]/5 text-[#7a5e2c] dark:text-[#d9b877] transition-colors hover:bg-[#A07C3B]/10"
                          href={boletoUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          <ExternalLink className="size-4" aria-hidden="true" />
                        </a>
                      </Tooltip>
                    ) : (
                      <Tooltip content="Sem boleto">
                        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-subtle text-ink-muted">
                          <ExternalLink className="size-4 opacity-40" aria-hidden="true" />
                        </span>
                      </Tooltip>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-line bg-surface px-4 py-6 text-center text-sm font-medium text-ink-muted">
            Nenhuma parcela real encontrada para esta unidade.
          </div>
        )}
      </div>
    </div>
  );
}

function InstallmentStatusBadge({ status }: { status: ApoloInstallment["status"] }) {
  const className = {
    "A vencer": "bg-sky-50 dark:bg-sky-500/12 text-sky-700 dark:text-sky-300 ring-sky-100 dark:ring-sky-500/20",
    Liquidada: "bg-emerald-50 dark:bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 ring-emerald-100 dark:ring-emerald-500/20",
    Vencida: "bg-rose-50 dark:bg-rose-500/12 text-rose-700 dark:text-rose-300 ring-rose-100 dark:ring-rose-500/20",
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
        <article className="rounded-xl border border-line bg-subtle p-3" key={`${event.title}-${event.date}`}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="m-0 text-sm font-semibold text-ink">{event.title}</p>
              <p className="m-0 mt-1 text-sm leading-6 text-ink-soft">{event.description}</p>
            </div>
            <span className="w-fit rounded-full bg-surface px-2.5 py-1 text-[11px] font-semibold text-ink-soft ring-1 ring-line">
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
    <div className="rounded-xl border border-line bg-subtle p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="m-0 text-sm font-semibold text-ink">Contrato</p>
          <p className="m-0 mt-2 text-lg font-semibold text-[#7a5e2c] dark:text-[#d9b877]">{unit.unitCode}</p>
          <p className="m-0 mt-1 text-sm font-medium text-ink-muted">
            {unit.enterprise} / {unit.unitLabel}
          </p>
        </div>
        <span className="w-fit rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-ink-soft ring-1 ring-line">
          {unit.contractStatus ?? "Nao localizado"}
        </span>
      </div>
      {contractUrl ? (
        <a
          className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg border border-[#A07C3B]/20 bg-[#A07C3B]/5 px-3 text-sm font-semibold text-[#7a5e2c] dark:text-[#d9b877] transition-colors hover:bg-[#A07C3B]/10"
          href={contractUrl}
          rel="noreferrer"
          target="_blank"
        >
          Abrir contrato
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
      ) : (
        <button
          className="mt-4 inline-flex h-9 cursor-not-allowed items-center rounded-lg border border-line bg-surface px-3 text-sm font-semibold text-ink-muted"
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
    <div className="rounded-lg border border-line bg-surface p-3">
      <p className="m-0 text-[11px] font-medium text-ink-muted">{label}</p>
      <p className="m-0 mt-1 break-words text-sm font-semibold text-ink">
        {value || "-"}
      </p>
    </div>
  );
}

// Roteia a aba Financeiro: papel comercial (imobiliária/incorporador/corretor) vê o extrato
// por participante (split); comprador vê acordos e promessas. Ver [[project-apolo-acessos-externos]].
function FinancialPanel({ entity }: { entity: ApoloEntity }) {
  if (hasCommercialRole(entity)) {
    return <StatementPanel entity={entity} />;
  }

  return <AgreementsFinancialPanel entity={entity} />;
}

function AgreementsFinancialPanel({ entity }: { entity: ApoloEntity }) {
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
      <section className="rounded-xl border border-line bg-surface p-4">
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
        <p className="m-0 mt-3 text-xs font-medium text-ink-muted">
          Pagamentos, acordos e promessas abaixo. (mock para validacao — registro/escrita
          depende da API do Apolo)
        </p>
      </section>
      <section className="rounded-xl border border-line bg-surface p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <PanelTitle eyebrow="Financeiro" title="Area financeira" />
            <p className="m-0 mt-2 text-sm font-medium text-ink-muted">
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
          <section className="rounded-xl border border-line bg-surface p-4">
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
          <section className="rounded-xl border border-line bg-surface p-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <PanelTitle eyebrow="Central operacional" title="Acordos e promessas" />
                <p className="m-0 mt-2 text-sm font-medium text-ink-muted">
                  Estrutura nativa do Apolo para compromissos financeiros do relacionamento.
                </p>
              </div>
              <div className="flex gap-2">
                <Tooltip content="Nova promessa depende da API de escrita do Apolo" placement="bottom">
                  <button className="inline-flex size-9 cursor-not-allowed items-center justify-center rounded-lg border border-[#A07C3B]/20 bg-[#A07C3B]/5 text-[#7a5e2c] dark:text-[#d9b877] opacity-70" disabled type="button">
                    <CalendarClock className="size-4" aria-hidden="true" />
                  </button>
                </Tooltip>
                <Tooltip content="Novo acordo depende da API de escrita do Apolo" placement="bottom">
                  <button className="inline-flex size-9 cursor-not-allowed items-center justify-center rounded-lg bg-subtle text-ink-muted" disabled type="button">
                    <Handshake className="size-4" aria-hidden="true" />
                  </button>
                </Tooltip>
              </div>
            </div>

            <div className="mt-4 grid gap-3 rounded-xl border border-line bg-subtle p-3 xl:grid-cols-[minmax(0,1fr)_300px]">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    aria-expanded={filtersExpanded}
                    className="inline-flex h-8 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-xs font-semibold text-ink-soft hover:bg-[#A07C3B]/5"
                    onClick={() => setFiltersExpanded((current) => !current)}
                    type="button"
                  >
                    <Filter className="size-3.5 text-[#A07C3B]" aria-hidden="true" />
                    Filtros{activeFilters.length > 0 ? ` (${activeFilters.length})` : ""}
                    <ChevronDown className={`size-3.5 text-[#A07C3B] transition-transform ${filtersExpanded ? "rotate-180" : ""}`} aria-hidden="true" />
                  </button>
                  {activeFilters.map((filter) => (
                    <Tooltip content={`Remover ${filter.label}`} key={`${filter.label}-${filter.value}`} placement="top">
                      <button className="inline-flex h-7 max-w-44 items-center gap-1 rounded-full bg-[#A07C3B]/5 px-2 text-[11px] font-semibold text-[#7a5e2c] dark:text-[#d9b877] ring-1 ring-[#A07C3B]/15" onClick={filter.clear} type="button">
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

              <div className="rounded-xl border border-[#A07C3B]/15 bg-surface p-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="size-4 text-[#A07C3B]" aria-hidden="true" />
                  <p className="m-0 text-sm font-semibold text-ink">Leitura operacional</p>
                </div>
                <p className="m-0 mt-2 text-xs leading-5 text-ink-soft">
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
    <nav aria-label="Areas financeiras" className="mt-4 flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1">
      {apoloFinancialSubtabs.map((tab) => {
        const Icon = tab.icon;
        const active = activeSubtab === tab.id;

        return (
          <button
            aria-current={active ? "page" : undefined}
            className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#A07C3B] ${
              active
                ? "bg-inverse text-brand-ink"
                : "text-ink-soft hover:bg-subtle hover:text-ink"
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
    danger: "bg-rose-50 dark:bg-rose-500/12 text-rose-700 dark:text-rose-300 ring-rose-100 dark:ring-rose-500/20",
    gold: "bg-[#A07C3B]/5 text-[#7a5e2c] dark:text-[#d9b877] ring-[#A07C3B]/15",
    neutral: "bg-subtle text-ink ring-line",
  }[tone];

  return (
    <div className={`min-w-0 rounded-xl px-3 py-2.5 ring-1 ${toneClass}`}>
      <p className="truncate text-xs font-medium text-ink-muted">{label}</p>
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
      <span className="text-xs font-medium text-ink-muted">{label}</span>
      <select
        className="mt-1 h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink outline-none transition-colors hover:bg-subtle"
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
      <div className="mt-4 rounded-xl border border-dashed border-line bg-surface px-4 py-8 text-center text-sm font-semibold text-ink-muted">
        Nenhum acordo ou promessa materializado no Apolo para os filtros selecionados.
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-line bg-surface">
      <div className="grid grid-cols-[0.95fr_0.85fr_0.9fr_0.85fr_0.8fr_0.85fr] gap-3 border-b border-line bg-subtle px-4 py-2.5 text-xs font-semibold text-ink-muted max-lg:hidden">
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
            className="grid gap-3 border-b border-line px-4 py-3 last:border-b-0 lg:grid-cols-[0.95fr_0.85fr_0.9fr_0.85fr_0.8fr_0.85fr] lg:items-center"
            key={record.id}
          >
            <div className="min-w-0">
              <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${financialRecordTypeClass(record.type)}`}>
                {record.type}
              </span>
              <p className="m-0 mt-1 truncate text-sm font-semibold text-ink">{record.enterprise}</p>
              <p className="m-0 mt-0.5 truncate text-xs text-ink-muted">{record.unitLabel}</p>
            </div>
            <div>
              <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${financialRecordStatusClass(record.status)}`}>
                {record.status}
              </span>
            </div>
            <div className="min-w-0">
              <p className="m-0 truncate text-xs text-ink-muted lg:hidden">Registro</p>
              <p className="m-0 mt-1 truncate text-sm font-semibold text-ink lg:mt-0">{record.title}</p>
              <p className="m-0 mt-0.5 w-fit rounded-full bg-[#A07C3B]/5 px-2 py-0.5 text-[11px] font-semibold text-[#7a5e2c] dark:text-[#d9b877] ring-1 ring-[#A07C3B]/15">
                {record.protocol}
              </p>
            </div>
            <div className="min-w-0">
              <p className="m-0 truncate text-xs text-ink-muted lg:hidden">Cod. unidade</p>
              <p className="m-0 mt-1 truncate text-sm font-semibold text-ink lg:mt-0">{record.unitCode}</p>
            </div>
            <div className="min-w-0">
              <p className="m-0 text-xs font-medium text-ink-muted">Valor</p>
              <p className="m-0 mt-1 truncate text-sm font-semibold text-ink">{record.value}</p>
            </div>
            <div className="min-w-0">
              <p className="m-0 text-xs font-medium text-ink-muted">Data</p>
              <p className="m-0 mt-1 truncate text-sm font-semibold text-ink">{record.date}</p>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

// Teto client-side do anexo (espelha o teto da rota). Docs de cadastro cabem folgado.
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Nao foi possivel ler o arquivo."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function formatAttachmentSize(bytes: number | null): string | null {
  if (!bytes || bytes <= 0) {
    return null;
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function attachmentMeta(document: ApoloDocumentItem): string {
  const date = new Date(document.createdAt);
  const dateLabel = Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const size = formatAttachmentSize(document.sizeBytes);

  return [document.uploadedBy, dateLabel, size].filter(Boolean).join(" · ") || "Anexo";
}

function attachmentStatusLabel(status: string): string {
  const map: Record<string, string> = {
    archived: "Arquivado",
    blocked: "Restrito",
    pending_review: "Em revisao",
    ready: "Pronto",
  };
  return map[status] ?? status;
}

function attachmentStatusClass(status: string): string {
  if (status === "blocked") {
    return "bg-rose-50 dark:bg-rose-500/12 text-rose-700 dark:text-rose-300 ring-rose-100 dark:ring-rose-500/20";
  }
  if (status === "pending_review") {
    return "bg-amber-50 dark:bg-amber-500/12 text-amber-800 dark:text-amber-300 ring-amber-100 dark:ring-amber-500/20";
  }
  return "bg-emerald-50 dark:bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 ring-emerald-100 dark:ring-emerald-500/20";
}

function DocumentsPanel({
  entity,
}: {
  entity: ApoloEntity;
}) {
  const [attachments, setAttachments] = useState<ApoloDocumentItem[]>([]);
  const [loadingAttachments, setLoadingAttachments] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [openingDocumentId, setOpeningDocumentId] = useState<string | null>(null);
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const contractDocuments = contractDocumentItems(entity);
  const entityId = entity.id;

  const loadAttachments = useCallback(async () => {
    setLoadingAttachments(true);

    try {
      const accessToken = await getApoloAccessToken();
      const response = await fetch(
        `/api/apolo/documentos?entityId=${encodeURIComponent(entityId)}`,
        {
          cache: "no-store",
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | { documents?: ApoloDocumentItem[]; error?: string }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Nao foi possivel carregar os documentos.");
      }

      setAttachments(payload?.documents ?? []);
      setDocumentError(null);
    } catch (error) {
      setDocumentError(
        error instanceof Error ? error.message : "Nao foi possivel carregar os documentos.",
      );
    } finally {
      setLoadingAttachments(false);
    }
  }, [entityId]);

  useEffect(() => {
    void loadAttachments();
  }, [loadAttachments]);

  async function uploadFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);

    if (!files.length) {
      return;
    }

    setUploading(true);
    setDocumentError(null);

    try {
      const accessToken = await getApoloAccessToken();

      for (const file of files) {
        if (file.size > MAX_ATTACHMENT_BYTES) {
          throw new Error(`"${file.name}" passa de 15 MB.`);
        }

        const fileBase64 = await readFileAsDataUrl(file);
        const response = await fetch("/api/apolo/documentos", {
          body: JSON.stringify({
            entityId,
            fileBase64,
            fileName: file.name,
            mimeType: file.type || null,
          }),
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          method: "POST",
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;

          throw new Error(payload?.error ?? "Nao foi possivel enviar o documento.");
        }
      }

      await loadAttachments();
    } catch (error) {
      setDocumentError(
        error instanceof Error ? error.message : "Nao foi possivel enviar o documento.",
      );
    } finally {
      setUploading(false);
    }
  }

  async function openAttachment(documentId: string) {
    const previewWindow = window.open("about:blank", "_blank");

    if (previewWindow) {
      previewWindow.opener = null;
    }

    try {
      setOpeningDocumentId(documentId);
      setDocumentError(null);

      const accessToken = await getApoloAccessToken();
      const response = await fetch(
        `/api/apolo/documentos/${encodeURIComponent(documentId)}?scope=entidade`,
        {
          cache: "no-store",
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; url?: string }
        | null;

      if (!response.ok || !payload?.url) {
        throw new Error(payload?.error ?? "Nao foi possivel abrir o documento.");
      }

      if (previewWindow) {
        previewWindow.location.href = payload.url;
      } else {
        window.open(payload.url, "_blank", "noreferrer");
      }
    } catch (error) {
      previewWindow?.close();
      setDocumentError(
        error instanceof Error ? error.message : "Nao foi possivel abrir o documento.",
      );
    } finally {
      setOpeningDocumentId(null);
    }
  }

  async function removeAttachment(documentId: string) {
    if (!window.confirm("Remover este documento? Essa acao nao pode ser desfeita.")) {
      return;
    }

    try {
      setDeletingDocumentId(documentId);
      setDocumentError(null);

      const accessToken = await getApoloAccessToken();
      const response = await fetch(
        `/api/apolo/documentos/${encodeURIComponent(documentId)}?scope=entidade`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          method: "DELETE",
        },
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;

        throw new Error(payload?.error ?? "Nao foi possivel remover o documento.");
      }

      setAttachments((current) => current.filter((item) => item.id !== documentId));
    } catch (error) {
      setDocumentError(
        error instanceof Error ? error.message : "Nao foi possivel remover o documento.",
      );
    } finally {
      setDeletingDocumentId(null);
    }
  }

  // Contrato do C2X (D4Sign) segue lido via blob autenticado -- e outro backend.
  async function openContractDocument(documentUrl: string, documentId: string) {
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
        headers: { Authorization: `Bearer ${accessToken}` },
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
        error instanceof Error ? error.message : "Nao foi possivel abrir o documento.",
      );
    } finally {
      setOpeningDocumentId(null);
    }
  }

  return (
    <section className="grid gap-4">
      {documentError ? (
        <p className="m-0 rounded-lg border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/12 px-3 py-2 text-xs font-semibold text-rose-700 dark:text-rose-300">
          {documentError}
        </p>
      ) : null}

      <section className="rounded-xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PanelTitle eyebrow="Documentos" title="Anexos do cadastro" />
          <label
            className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border px-3 text-xs font-semibold transition-colors ${
              uploading
                ? "cursor-wait border-line bg-subtle text-ink-muted"
                : "cursor-pointer border-[#A07C3B]/25 bg-surface text-[#7a5e2c] dark:text-[#d9b877] hover:bg-[#A07C3B]/10"
            }`}
          >
            {uploading ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <UploadCloud className="size-3.5" aria-hidden="true" />
            )}
            {uploading ? "Enviando" : "Enviar documento"}
            <input
              accept="image/*,application/pdf"
              className="sr-only"
              disabled={uploading}
              multiple
              onChange={(event) => {
                if (event.target.files?.length) {
                  void uploadFiles(event.target.files);
                }
                event.target.value = "";
              }}
              type="file"
            />
          </label>
        </div>

        <div
          className={`mt-4 rounded-xl border border-dashed p-6 text-center transition-colors ${
            dragActive ? "border-[#A07C3B] bg-[#A07C3B]/5" : "border-line bg-subtle"
          }`}
          onDragLeave={(event) => {
            event.preventDefault();
            setDragActive(false);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragActive(false);
            if (event.dataTransfer.files?.length) {
              void uploadFiles(event.dataTransfer.files);
            }
          }}
        >
          <UploadCloud className="mx-auto size-6 text-ink-muted" aria-hidden="true" />
          <p className="m-0 mt-2 text-sm font-semibold text-ink">
            Arraste arquivos aqui ou use o botao acima
          </p>
          <p className="m-0 mt-1 text-xs text-ink-muted">
            PDF ou imagem, ate 15 MB por arquivo
          </p>
        </div>

        <div className="mt-4 grid gap-3">
          {loadingAttachments ? (
            <div className="flex items-center gap-2 rounded-lg border border-line bg-subtle px-3 py-3 text-xs font-semibold text-ink-muted">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              Carregando documentos
            </div>
          ) : attachments.length ? (
            attachments.map((document) => (
              <article
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-subtle p-4"
                key={document.id}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface text-[#A07C3B] ring-1 ring-line">
                    <FileText className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="m-0 truncate text-sm font-semibold text-ink">
                      {document.label || document.fileName || "Documento"}
                    </p>
                    <p className="m-0 mt-1 truncate text-xs text-ink-muted">
                      {attachmentMeta(document)}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${attachmentStatusClass(document.status)}`}
                  >
                    {attachmentStatusLabel(document.status)}
                  </span>
                  <button
                    aria-label="Abrir documento"
                    className="inline-flex size-8 items-center justify-center rounded-lg border border-line bg-surface text-ink-soft transition-colors hover:bg-[#A07C3B]/10 hover:text-[#7a5e2c] disabled:cursor-not-allowed disabled:opacity-50 dark:hover:text-[#d9b877]"
                    disabled={!document.hasFile || openingDocumentId === document.id}
                    onClick={() => void openAttachment(document.id)}
                    type="button"
                  >
                    {openingDocumentId === document.id ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <ExternalLink className="size-3.5" aria-hidden="true" />
                    )}
                  </button>
                  <button
                    aria-label="Remover documento"
                    className="inline-flex size-8 items-center justify-center rounded-lg border border-line bg-surface text-ink-soft transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-wait disabled:opacity-50 dark:hover:bg-rose-500/12 dark:hover:text-rose-300"
                    disabled={deletingDocumentId === document.id}
                    onClick={() => void removeAttachment(document.id)}
                    type="button"
                  >
                    {deletingDocumentId === document.id ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </article>
            ))
          ) : (
            <EmptyPanel text="Nenhum documento anexado ainda. Arraste um arquivo ou use o botao acima." />
          )}
        </div>
      </section>

      {contractDocuments.length ? (
        <section className="rounded-xl border border-line bg-surface p-4">
          <PanelTitle eyebrow="Documentos" title="Contrato" />
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {contractDocuments.map((document) => (
              <article
                className="rounded-xl border border-line bg-subtle p-4"
                key={document.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="m-0 truncate text-sm font-semibold text-ink">
                      {document.title}
                    </p>
                    {document.href ? (
                      <button
                        className="mt-1 inline-flex max-w-full items-center gap-1.5 rounded-lg border border-[#A07C3B]/20 bg-surface px-2 py-1 text-xs font-semibold text-[#7a5e2c] dark:text-[#d9b877] transition-colors hover:bg-[#A07C3B]/10 disabled:cursor-wait disabled:opacity-70"
                        disabled={openingDocumentId === document.id}
                        onClick={() => {
                          if (document.href) {
                            void openContractDocument(document.href, document.id);
                          }
                        }}
                        type="button"
                      >
                        <span className="truncate">{document.detail}</span>
                        <ExternalLink className="size-3" aria-hidden="true" />
                      </button>
                    ) : (
                      <p className="m-0 mt-1 truncate text-xs text-ink-muted">
                        {document.detail}
                      </p>
                    )}
                    <p className="m-0 mt-1 truncate text-xs font-medium text-ink-muted">
                      {document.meta}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <span className="rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-[#7a5e2c] dark:text-[#d9b877] ring-1 ring-[#A07C3B]/20">
                      {document.unitBadge}
                    </span>
                    <span className="rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-ink-soft ring-1 ring-line">
                      {document.status}
                    </span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
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
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <PanelTitle eyebrow={`${filteredEvents.length}/${events.length} eventos`} title="Timeline operacional do relacionamento" />
        <div className="flex flex-wrap gap-2">
          <label className="flex h-8 min-w-[16rem] items-center gap-2 rounded-lg border border-line bg-subtle px-2.5 text-ink-muted">
            <Search className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="sr-only">Buscar na timeline</span>
            <input
              className="w-full bg-transparent text-xs font-semibold text-ink outline-none placeholder:text-ink-muted"
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
                  className="inline-flex h-8 shrink-0 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-xs font-semibold text-ink transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-ink"
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
      <div className="relative space-y-3 before:absolute before:left-[18px] before:top-2 before:h-[calc(100%-1rem)] before:w-px before:bg-subtle">
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
    attention: "bg-amber-50 dark:bg-amber-500/12 text-amber-800 dark:text-amber-300 ring-amber-100 dark:ring-amber-500/20",
    blocked: "bg-rose-50 dark:bg-rose-500/12 text-rose-700 dark:text-rose-300 ring-rose-100 dark:ring-rose-500/20",
    ok: "bg-emerald-50 dark:bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 ring-emerald-100 dark:ring-emerald-500/20",
  } as const satisfies Record<ApoloTimelineEvent["status"], string>;

  return (
    <article
      className={`rounded-xl border border-line bg-surface p-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)] ${
        compact ? "" : "relative ml-11"
      }`}
    >
      {!compact ? (
        <span className="absolute -left-[3rem] top-3 grid size-9 place-items-center rounded-lg border border-line bg-surface">
          <span className="grid size-5 place-items-center rounded-full bg-emerald-50 dark:bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">
            <Icon className="size-3.5" aria-hidden="true" />
          </span>
        </span>
      ) : null}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {compact ? (
              <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-[#A07C3B]/5 text-[#7a5e2c] dark:text-[#d9b877] ring-1 ring-[#A07C3B]/15">
                <Icon className="size-3.5" aria-hidden="true" />
              </span>
            ) : null}
            <p className="m-0 truncate text-sm font-semibold text-ink">
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
          <p className="m-0 mt-2 text-sm font-medium text-ink-soft">
            {event.description}
          </p>
        </div>
        <time className="shrink-0 text-xs font-medium text-ink-muted">
          {event.date}
        </time>
      </div>
    </article>
  );
}

function AuditPanel({ audit }: { audit: readonly ApoloAuditSignal[] }) {
  return (
    <section className="overflow-x-auto rounded-lg border border-line bg-surface">
      <div className="min-w-[38rem]">
        <div className="grid grid-cols-[minmax(0,1fr)_8rem_8rem] gap-3 border-b border-line bg-subtle px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">
          <span>Campo</span>
          <span>Status</span>
          <span>Atualizado</span>
        </div>
        {audit.map((item) => (
          <div
            className="grid grid-cols-[minmax(0,1fr)_8rem_8rem] gap-3 border-b border-line px-4 py-3 text-sm font-medium text-ink-soft last:border-b-0"
            key={item.field}
          >
            <span className="min-w-0 truncate font-semibold text-ink">
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
