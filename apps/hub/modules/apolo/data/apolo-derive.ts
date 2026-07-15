import {
  CircleDollarSign,
  ClipboardList,
  Handshake,
  MessageCircle,
  PhoneCall,
  ReceiptText,
  Scale,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { apoloProfileLabels } from "@/lib/apolo/catalog";
import type {
  ApoloEntity,
  ApoloProfile,
  ApoloTimelineEvent,
} from "@/lib/apolo/types";

import type {
  ApoloFinancialRecord,
  ApoloFinancialRecordType,
  ApoloPortfolioUnit,
  ApoloProfileFilter,
  ApoloTab,
} from "../types/apolo-local";

// Helpers de derivacao do Apolo (funcoes puras extraidas do ApoloPage monolitico).

export function sanitizeOperationalMessage(message: string | null | undefined) {
  if (!message) {
    return null;
  }

  if (/c2x|legado|legacy/i.test(message)) {
    return "Cadastro sem carteira operacional vinculada.";
  }

  return message;
}

export function canUseHadesWorkspace() {
  return false;
}

export function isApoloTabUnavailableForEntity(tab: ApoloTab, entity: ApoloEntity | null) {
  if (!entity) {
    return false;
  }

  // Carteira: liberada pra QUALQUER papel com carteira (incorporador/imobiliária/corretor/
  // comprador) — a aba se adapta ao papel. Antes só o comprador via. Ver [[project-apolo-empreendimento-tela]].
  if (tab === "carteira") {
    return resolveCarteiraRoles(entity).length === 0;
  }

  // Financeiro: comprador vê acordos/promessas; imobiliária/incorporador/corretor veem o
  // extrato por participante (split). Indisponível só pra quem não é nenhum dos dois.
  if (tab === "financeiro") {
    return buyerStatusLabel(entity) !== "Comprador" && !hasCommercialRole(entity);
  }

  return false;
}

// Papel comercial no split: imobiliária, incorporador ou corretor. Define quem tem extrato.
export function hasCommercialRole(entity: ApoloEntity | null): boolean {
  return Boolean(
    entity &&
      (entity.profiles.includes("imobiliaria") ||
        entity.profiles.includes("incorporador") ||
        entity.profiles.includes("corretor")),
  );
}

export type ApoloCarteiraRoleKind =
  | "comprador"
  | "corretor"
  | "imobiliaria"
  | "incorporador";

export type ApoloCarteiraRole = {
  kind: ApoloCarteiraRoleKind;
  label: string;
};

const CARTEIRA_ROLE_LABELS: Record<ApoloCarteiraRoleKind, string> = {
  comprador: "Comprador",
  corretor: "Corretor",
  imobiliaria: "Imobiliária",
  incorporador: "Incorporador",
};

// ID do usuário no C2X, extraído do hadesClientId ("c2x-client-<id>"). Todo papel (comprador/
// imobiliária/corretor/incorporador) é um `users` no C2X, então o mesmo id serve pra escopar
// a carteira. Pega os dígitos FINAIS (evita o bug do "c2x" virar "2"). Ver [[project-apolo-crm-grafo]].
export function entityC2xId(entity: ApoloEntity | null): number | null {
  const match = entity?.hadesClientId ? /(\d+)$/.exec(entity.hadesClientId)?.[1] : undefined;
  const id = match ? Number(match) : Number.NaN;

  return Number.isInteger(id) && id > 0 ? id : null;
}

// Papéis da entidade que têm carteira, do MAIOR escopo pro menor (incorporador > imobiliária >
// corretor > comprador). O primeiro é o padrão; se houver mais de um, a aba mostra um seletor.
export function resolveCarteiraRoles(entity: ApoloEntity | null): ApoloCarteiraRole[] {
  if (!entity || entityC2xId(entity) == null) {
    return [];
  }

  const roles: ApoloCarteiraRole[] = [];
  const add = (kind: ApoloCarteiraRoleKind) => {
    roles.push({ kind, label: CARTEIRA_ROLE_LABELS[kind] });
  };

  if (entity.profiles.includes("incorporador")) {
    add("incorporador");
  }

  if (entity.profiles.includes("imobiliaria")) {
    add("imobiliaria");
  }

  if (entity.profiles.includes("corretor")) {
    add("corretor");
  }

  if (buyerStatusLabel(entity) === "Comprador") {
    add("comprador");
  }

  return roles;
}

export function matchesApoloFilters(
  entity: ApoloEntity,
  query: string,
  profileFilter: ApoloProfileFilter,
) {
  if (profileFilter === "comprador") {
    if (buyerStatusLabel(entity) !== "Comprador") {
      return false;
    }
  } else if (profileFilter === "prospect") {
    if (buyerStatusLabel(entity) !== "Prospect") {
      return false;
    }
  } else if (profileFilter !== "all" && !entity.profiles.includes(profileFilter)) {
    return false;
  }

  const normalizedQuery = normalizeText(query);

  if (!normalizedQuery) {
    return true;
  }

  return normalizeText(
    [
      entity.displayName,
      entity.legalName ?? "",
      entity.tradeName ?? "",
      entity.documentMasked,
      entity.locationLabel,
      entity.nextAction,
      buyerStatusLabel(entity),
      buyerFinancialBadge(entity)?.label ?? "",
      entity.profiles.map((profile) => apoloProfileLabels[profile]).join(" "),
      entity.commercialLinks
        .map((link) => `${link.enterprise} ${link.unit} ${link.role} ${link.referenceLabel}`)
        .join(" "),
      entity.contacts.map((contact) => contact.value).join(" "),
      entity.relationships
        .map((relationship) => `${relationship.label} ${relationship.relation}`)
        .join(" "),
      entity.documents.map((document) => document.label).join(" "),
      entity.serviceSignals
        .map((signal) => `${signal.protocol} ${signal.channel} ${signal.lastEvent}`)
        .join(" "),
      entity.timeline
        .map((event) => `${event.title} ${event.description} ${event.date}`)
        .join(" "),
    ].join(" "),
  ).includes(normalizedQuery);
}

// Perfis que NÃO são papel de negócio: PF/PJ (natureza jurídica) e o genérico
// "usuario"/"acesso_incorporador". Não viram chip de papel. Papel real = Comprador/
// Prospect (derivado da carteira) + imobiliaria/corretor/incorporador/colaborador.
export const NON_ROLE_PROFILES = new Set<ApoloProfile>([
  "acesso_incorporador",
  "pessoa_fisica",
  "pessoa_juridica",
  "usuario",
]);

export function businessRoleProfiles(entity: ApoloEntity): ApoloProfile[] {
  return entity.profiles.filter((profile) => !NON_ROLE_PROFILES.has(profile));
}

export function primaryBusinessProfile(entity: ApoloEntity): ApoloProfile {
  const profilePriority = [
    "usuario",
    "incorporador",
    "imobiliaria",
    "corretor",
    "parceiro",
    "fornecedor",
    "colaborador",
    "acesso_incorporador",
    "pessoa_juridica",
    "pessoa_fisica",
  ] as const satisfies readonly ApoloProfile[];

  return (
    profilePriority.find((profile) => entity.profiles.includes(profile)) ??
    entity.profiles[0] ??
    "pessoa_fisica"
  );
}

export function buyerStatusLabel(entity: ApoloEntity) {
  if (!entity.profiles.includes("usuario")) {
    return "Nao aplicavel";
  }

  // Comprador = cliente na CARTEIRA do C2X (faturado vigente COM pagamento). O loader
  // marca entity.isBuyer com o MESMO conjunto da KPI, pra card e painel baterem. Quando
  // isBuyer não vem (ex.: fallback live-c2x), cai na heurística do estágio "Faturado" do
  // link. Antes classificava pelo papel "Usuario comprador" (over-count ~3.400). Ver
  // [[project-apolo-empreendimento-tela]].
  const isBuyer =
    entity.isBuyer ??
    entity.commercialLinks.some((link) => {
      const stage = normalizeText(link.stage);
      return stage.includes("faturado") || stage.includes("finalizado");
    });

  return isBuyer ? "Comprador" : "Prospect";
}

export function buyerFinancialBadge(entity: ApoloEntity) {
  if (buyerStatusLabel(entity) !== "Comprador") {
    return null;
  }

  if (entity.financial.overdueInstallments > 0 || currencyLabelToNumber(entity.financial.overdueAmount) > 0) {
    return {
      className: "bg-rose-50 dark:bg-rose-500/12 text-rose-700 dark:text-rose-300 ring-rose-100 dark:ring-rose-500/20",
      label: "Inadimplente",
    };
  }

  return {
    className: "bg-emerald-50 dark:bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 ring-emerald-100 dark:ring-emerald-500/20",
    label: "Adimplente",
  };
}

export function currencyLabelToNumber(value: string) {
  if (!value || value === "A consultar") {
    return 0;
  }

  const normalized = value
    .replace(/[^\d,.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatMoneyLabel(value: number, fallback: string) {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return new Intl.NumberFormat("pt-BR", {
    currency: "BRL",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(value);
}

export function displayText(value: string | null | undefined) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");

  if (!normalized || normalized === "-") {
    return "-";
  }

  if (normalized.includes("@")) {
    return normalized;
  }

  const preserved = new Set([
    "C2X",
    "CRM",
    "CPF",
    "CNPJ",
    "LBF",
    "LBP",
    "LBR",
    "MG",
    "RDP",
    "RJ",
    "SP",
  ]);
  const smallWords = new Set(["a", "as", "da", "das", "de", "do", "dos", "e"]);

  return normalized
    .toLocaleLowerCase("pt-BR")
    .split(" ")
    .map((word, index) => {
      const original = normalized.split(" ")[index] ?? word;
      const originalUpper = original.toUpperCase();

      if (preserved.has(originalUpper)) {
        return originalUpper;
      }

      if (/^[a-z]{2,5}\d{2,}$/i.test(original)) {
        return originalUpper;
      }

      if (index > 0 && smallWords.has(word)) {
        return word;
      }

      return word.charAt(0).toLocaleUpperCase("pt-BR") + word.slice(1);
    })
    .join(" ");
}

export function profileLabelList(entity: ApoloEntity) {
  return entity.profiles.map((profile) => apoloProfileLabels[profile]).join(", ");
}

export function displayHeaderName(entity: ApoloEntity) {
  if (isCompanyEntity(entity)) {
    return displayText(entity.tradeName || entity.displayName || entity.legalName || "-");
  }

  return displayText(entity.displayName || entity.tradeName || entity.legalName || "-");
}

export function summaryName(entity: ApoloEntity) {
  if (isCompanyEntity(entity)) {
    return displayText(entity.legalName || entity.displayName || entity.tradeName || "-");
  }

  return displayText(entity.displayName || entity.legalName || entity.tradeName || "-");
}

export function documentLabel(entity: ApoloEntity) {
  if (entity.kind === "pj" || entity.kind === "organization") {
    return "CNPJ";
  }

  if (entity.kind === "pf" || entity.kind === "internal") {
    return "CPF";
  }

  return "CPF/CNPJ";
}

export function activeRegistrationLabel(entity: ApoloEntity) {
  return `Ativo: ${monthYearLabel(entity.createdAt || entity.updatedAt)}`;
}

export function monthYearLabel(value: string) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);

  if (match?.[2] && match[3]) {
    return `${match[2]}/${match[3].slice(-2)}`;
  }

  return "--/--";
}

export function civilStatusLabel(entity: ApoloEntity) {
  return entity.kind === "pf" ? "A consultar" : "";
}

export function primaryContact(entity: ApoloEntity, type: ApoloEntity["contacts"][number]["type"]) {
  return entity.contacts.find((contact) => contact.type === type);
}

export function primaryPhoneContact(entity: ApoloEntity) {
  return entity.contacts.find((contact) => contact.type === "whatsapp" || contact.type === "phone");
}

export function acquiredUnitsCount(entity: ApoloEntity) {
  if (buyerStatusLabel(entity) !== "Comprador") {
    return 0;
  }

  return entity.commercialLinks.length;
}

export function commercialRelationshipLabel(entity: ApoloEntity) {
  if (!entity.profiles.includes("usuario")) {
    return "";
  }

  const relationship = entity.relationships.find((item) =>
    normalizeText(`${item.relation} ${item.label}`).includes("imobiliaria"),
  );

  if (relationship?.label) {
    return displayText(relationship.label);
  }

  const link = entity.commercialLinks.find((item) => {
    const normalized = normalizeText(`${item.referenceLabel} ${item.role}`);

    return normalized.includes("imobiliaria") || normalized.includes("responsavel");
  });

  return displayText(link?.brokerAgency || link?.referenceLabel || "");
}

export function responsibleLabel(entity: ApoloEntity) {
  const relationship = entity.relationships.find((item) =>
    normalizeText(`${item.relation} ${item.label}`).includes("responsavel"),
  );

  if (relationship?.label) {
    return displayText(relationship.label);
  }

  const link = entity.commercialLinks.find((item) =>
    normalizeText(`${item.referenceLabel} ${item.role}`).includes("responsavel"),
  );

  return displayText(link?.brokerAgency || link?.referenceLabel || entity.relationships[0]?.label || "");
}

export function isCompanyEntity(entity: ApoloEntity) {
  return entity.kind === "pj" || entity.kind === "organization";
}

export function cityStateLabel(
  address: ApoloEntity["addresses"][number] | undefined,
  fallback: string,
) {
  if (!address) {
    return fallback || "-";
  }

  return `${address.city}-${address.state}`;
}

export function fullAddressLabel(address: ApoloEntity["addresses"][number] | undefined) {
  if (!address) {
    return "-";
  }

  const addressLine = [
    address.value,
    address.number,
    address.complement,
    address.district,
  ]
    .filter(Boolean)
    .join(" - ");
  const cityLine = cityStateLabel(address, "");
  const postalCode = address.postalCode ? `CEP ${address.postalCode}` : "";

  return [addressLine, cityLine, postalCode].filter(Boolean).join(" - ") || "-";
}

export function relationshipSummary(entity: ApoloEntity) {
  if (buyerStatusLabel(entity) === "Comprador") {
    return `${acquiredUnitsCount(entity)} unidade(s) adquirida(s)`;
  }

  return displayText(entity.relationships[0]?.label ?? "-");
}

export function contractDocumentItems(entity: ApoloEntity) {
  return entity.commercialLinks
    .filter((link) => normalizeText(`${link.role} ${link.stage}`).includes("comprador"))
    .slice(0, 6)
    .map((link, index) => {
      const contractDocumentId = link.contractDocumentId?.trim();
      const detail = link.unitCode || link.unit || "Contrato";

      return {
        detail,
        href: contractDocumentId
          ? `/api/hades/d4sign/contracts/${encodeURIComponent(contractDocumentId)}`
          : undefined,
        id: `${detail}-${index}`,
        meta: displayText(`${link.enterprise} ${link.brokerAgency || link.referenceLabel}`.trim()),
        status: link.contractStatus ?? (contractDocumentId ? "Assinado" : "Nao localizado"),
        title: "Contrato",
        unitBadge: detail,
      };
    });
}

export function buildPortfolioUnits(entity: ApoloEntity): ApoloPortfolioUnit[] {
  return entity.commercialLinks.map((link, index) => {
    const parsedUnit = parsePortfolioUnitLabel(link.unit);
    const legacyReference = isLegacyCommercialPlaceholder(link.referenceLabel);
    const legacyEnterprise = isLegacyCommercialPlaceholder(link.enterprise);
    const legacyUnitCarriesBroker = legacyReference && !extractUnitCode(link.unit);
    const unitCode =
      link.unitCode ??
      extractUnitCode(link.unit) ??
      extractUnitCode(link.referenceLabel) ??
      "-";
    const block = normalizePortfolioDimension(link.block ?? parsedUnit.block, "Sem quadra");
    const lot = normalizePortfolioDimension(link.lot ?? parsedUnit.lot, "Sem lote");
    const area = normalizePortfolioDimension(link.area ?? parsedUnit.area);

    return {
      area,
      block,
      contractDocumentId: link.contractDocumentId,
      contractStatus: link.contractStatus,
      contractUrl: link.contractUrl,
      enterprise: displayText(legacyEnterprise ? "-" : link.enterprise || "-"),
      id: `${portfolioKey(link)}::${index}`,
      installments: link.installments ?? [],
      lot,
      referenceLabel: displayText(
        link.brokerAgency ||
          (legacyUnitCarriesBroker ? link.unit : undefined) ||
          (legacyReference ? "-" : link.referenceLabel) ||
          "-",
      ),
      role: displayText(link.role || "-"),
      stage: displayText(link.stage || "-"),
      tableValue: link.tableValue ?? "-",
      unitCode,
      unitLabel: displayText(legacyUnitCarriesBroker ? "-" : link.unit || "-"),
    };
  });
}

export function isLegacyCommercialPlaceholder(value: string | undefined) {
  const normalized = normalizeText(value ?? "");

  return [
    "carteira comercial",
    "vinculo identificado",
    "vinculo pendente",
    "sem carteira por pagamento",
  ].includes(normalized);
}

export function normalizePortfolioDimension(value: string | undefined, emptyMarker?: string) {
  const normalized = String(value ?? "").trim();

  if (!normalized || normalized === "-" || normalized === emptyMarker) {
    return "-";
  }

  return normalized;
}

export function parsePortfolioUnitLabel(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  const blockMatch =
    /\b(?:quadra|qd|q)\s*[-.:]?\s*([a-z0-9]+)/i.exec(normalized) ??
    /\b(Q[0-9a-z-]+)\b/i.exec(normalized);
  const lotMatch =
    /\b(?:lote|lt|l)\s*[-.:]?\s*([a-z0-9]+)/i.exec(normalized) ??
    /\b(L[0-9a-z-]+)\b/i.exec(normalized);
  const areaMatch = /(\d+(?:[,.]\d+)?)\s*m(?:2|²)?/i.exec(normalized);

  return {
    area: areaMatch?.[0] ?? "-",
    block: blockMatch?.[1]?.toUpperCase() ?? "-",
    lot: lotMatch?.[1]?.toUpperCase() ?? "-",
  };
}

export function extractUnitCode(value: string) {
  const match = /\b[A-Z]{2,5}\d{2,}\b/i.exec(value);
  return match?.[0]?.toUpperCase();
}

export function portfolioUnitSubtitle(unit: ApoloPortfolioUnit) {
  const parts = [
    unit.block !== "-" ? `Quadra ${unit.block}` : null,
    unit.lot !== "-" ? `Lote ${unit.lot}` : null,
    unit.area !== "-" ? unit.area : null,
  ].filter(Boolean);

  return parts.length ? parts.join(" · ") : unit.unitLabel !== "-" ? unit.unitLabel : unit.unitCode;
}

export function buildApoloFinancialRecords(entity: ApoloEntity): ApoloFinancialRecord[] {
  const units = buildPortfolioUnits(entity);

  return entity.timeline
    .map((event, index) => {
      const normalized = normalizeText(`${event.title} ${event.description}`);

      if (!normalized.includes("acordo") && !normalized.includes("promessa")) {
        return null;
      }

      const unit = findUnitForText(units, normalized) ?? units[0];
      const type: ApoloFinancialRecordType = normalized.includes("acordo")
        ? "Acordo"
        : "Promessa de pagamento";

      return {
        date: event.date || "-",
        enterprise: unit?.enterprise ?? "Relacionamento financeiro",
        id: `${event.title}-${event.date}-${index}`,
        operator: "Apolo",
        protocol: `APO-${String(index + 1).padStart(5, "0")}`,
        status: financialTimelineStatusLabel(event.status),
        title: event.title,
        type,
        unitCode: unit?.unitCode ?? "-",
        unitLabel: unit?.unitLabel ?? "-",
        value: inferFinancialRecordValue(event.description, entity),
      };
    })
    .filter((record): record is ApoloFinancialRecord => Boolean(record));
}

export function findUnitForText(units: ApoloPortfolioUnit[], normalizedText: string) {
  return units.find((unit) => {
    const candidates = [
      unit.enterprise,
      unit.unitLabel,
      unit.unitCode,
      unit.referenceLabel,
    ]
      .map(normalizeText)
      .filter((value) => value.length > 2);

    return candidates.some((candidate) => normalizedText.includes(candidate));
  });
}

export function financialTimelineStatusLabel(status: ApoloTimelineEvent["status"]) {
  if (status === "ok") {
    return "Registrado";
  }

  if (status === "blocked") {
    return "Bloqueado";
  }

  return "Acompanhar";
}

export function inferFinancialRecordValue(description: string, entity: ApoloEntity) {
  const moneyMatch = /R\$\s*[\d.]+(?:,\d{2})?/i.exec(description);

  if (moneyMatch?.[0]) {
    return moneyMatch[0];
  }

  if (currencyLabelToNumber(entity.financial.overdueAmount) > 0) {
    return entity.financial.overdueAmount;
  }

  return "-";
}

export function buildApoloFinancialSummary(records: ApoloFinancialRecord[]) {
  const promises = records.filter((record) => record.type === "Promessa de pagamento");
  const agreements = records.filter((record) => record.type === "Acordo");
  const fulfilledPromises = promises.filter((record) =>
    normalizeText(record.status).includes("cumpr"),
  ).length;
  const brokenPromises = promises.filter((record) =>
    ["bloqueado", "quebrado", "cancelado"].some((status) => normalizeText(record.status).includes(status)),
  ).length;
  const openPromises = promises.length - fulfilledPromises - brokenPromises;
  const activeAgreements = agreements.filter((record) =>
    !["bloqueado", "cancelado", "quebrado"].some((status) => normalizeText(record.status).includes(status)),
  ).length;

  return {
    activeAgreements,
    brokenPromises,
    fulfilledPromises,
    openPromises,
  };
}

export function uniqueText(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function financialRecordTypeClass(type: ApoloFinancialRecordType) {
  if (type === "Acordo") {
    return "bg-[#A07C3B]/8 text-[#7a5e2c] dark:text-[#d9b877] ring-[#A07C3B]/15";
  }

  return "bg-subtle text-ink ring-line";
}

export function financialRecordStatusClass(status: string) {
  const normalized = normalizeText(status);

  if (normalized.includes("bloqueado") || normalized.includes("quebrado")) {
    return "bg-rose-50 dark:bg-rose-500/12 text-rose-700 dark:text-rose-300 ring-rose-100 dark:ring-rose-500/20";
  }

  if (normalized.includes("acompanhar") || normalized.includes("negoci")) {
    return "bg-amber-50 dark:bg-amber-500/12 text-amber-700 dark:text-amber-300 ring-amber-100 dark:ring-amber-500/20";
  }

  return "bg-emerald-50 dark:bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 ring-emerald-100 dark:ring-emerald-500/20";
}

export function portfolioKey(link: ApoloEntity["commercialLinks"][number] | undefined) {
  if (!link) {
    return "";
  }

  return `${link.enterprise}::${link.unit}::${link.role}::${link.referenceLabel}`;
}

export function getTimelineIcon(normalizedText: string): LucideIcon {
  if (normalizedText.includes("boleto")) {
    return ReceiptText;
  }

  if (normalizedText.includes("acordo") || normalizedText.includes("promessa")) {
    return Handshake;
  }

  if (normalizedText.includes("whatsapp") || normalizedText.includes("contato")) {
    return MessageCircle;
  }

  if (normalizedText.includes("ligacao") || normalizedText.includes("telefone")) {
    return PhoneCall;
  }

  if (normalizedText.includes("jurid")) {
    return Scale;
  }

  if (normalizedText.includes("pagamento") || normalizedText.includes("parcela")) {
    return CircleDollarSign;
  }

  return ClipboardList;
}

export function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .toLowerCase()
    .trim();
}

export function kindLabel(kind: ApoloEntity["kind"]) {
  if (kind === "pf") {
    return "Pessoa fisica";
  }

  if (kind === "pj" || kind === "organization") {
    return "Pessoa juridica";
  }

  return "Colaborador";
}

export function countPendingSignals(entity: ApoloEntity) {
  return (
    entity.contacts.filter((contact) => contact.status !== "verified").length +
    entity.addresses.filter((address) => address.status !== "verified").length +
    entity.relationships.filter(
      (relationship) => relationship.status !== "verified",
    ).length +
    entity.documents.filter((document) => document.status !== "ready").length
  );
}
