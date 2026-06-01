import type { HadesCustomerServiceWindow } from "@/modules/guardian/attendance/hades-customer-service-window";
import type { HadesWhatsAppTicketStatus } from "@/modules/guardian/attendance/hades-whatsapp-thread";

export type OperationDrawerMode = "promise" | "agreement" | "boleto" | "installments";

export type ContextTab = "info" | "actions" | "ai" | "history";

export type TicketOrigin = "Cliente iniciou" | "Careli iniciou";

export type HadesTicketPriority = "-" | "Crítica" | "Alta" | "Média" | "Baixa";

export type WhatsAppTicket = {
  attendanceProtocol?: string;
  collectionProtocol?: string;
  customerServiceWindow?: HadesCustomerServiceWindow | null;
  irisMessageId?: string;
  irisTicketId?: string;
  protocol: string;
  origin: TicketOrigin;
  profileId: string;
  profileName: string;
  profileCategory: string;
  priority: HadesTicketPriority;
  slaHours: number;
  relatedInstallments: string[];
  status: HadesWhatsAppTicketStatus;
  openedAt?: string;
  closedAt?: string;
  duration?: string;
  result?: string;
  nextStep?: string;
  finalNote?: string;
};

export type TicketChecklistItem = {
  id: string;
  label: string;
  ok: boolean;
  warning?: boolean;
};
