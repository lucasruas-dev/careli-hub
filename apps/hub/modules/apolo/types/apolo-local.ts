import type { LucideIcon } from "lucide-react";

import type { ApoloInstallment, ApoloProfile } from "@/lib/apolo/types";
import type {
  OperationalTimelineEvent,
  QueueClient,
} from "@/modules/guardian/attendance/types";

// Tipos locais do Apolo (extraidos do ApoloPage monolitico).

export type ApoloTab =
  | "resumo"
  | "cadastro"
  | "relacionamentos"
  | "carteira"
  | "financeiro"
  | "documentos"
  | "timeline"
  | "auditoria";

// "comprador" e "prospect" não são profiles (são derivados da carteira do C2X),
// mas entram como opções do filtro do CRM 360.
export type ApoloProfileFilter = ApoloProfile | "all" | "comprador" | "prospect";

export type ApoloTabItem = {
  icon: LucideIcon;
  id: ApoloTab;
  label: string;
};

export type ApoloUnitSubtab = "summary" | "installments" | "timeline" | "contract";
export type ApoloFinancialSubtab = "acordos";

export type ApoloPortfolioUnit = {
  area: string;
  block: string;
  contractDocumentId?: string;
  contractStatus?: string;
  contractUrl?: string;
  enterprise: string;
  id: string;
  installments: ApoloInstallment[];
  lot: string;
  referenceLabel: string;
  role: string;
  stage: string;
  tableValue: string;
  unitCode: string;
  unitLabel: string;
};

export type ApoloFinancialRecordType = "Promessa de pagamento" | "Acordo";

export type ApoloFinancialRecord = {
  date: string;
  enterprise: string;
  id: string;
  operator: string;
  protocol: string;
  status: string;
  title: string;
  type: ApoloFinancialRecordType;
  unitCode: string;
  unitLabel: string;
  value: string;
};

export type ManualHadesOperations = {
  commitments: QueueClient["commitments"];
  events: OperationalTimelineEvent[];
};
