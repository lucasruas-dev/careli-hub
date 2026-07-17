import {
  CircleDollarSign,
  Clock3,
  ContactRound,
  FileText,
  Files,
  HandCoins,
  History,
  LayoutDashboard,
  MapPinned,
  Network,
  ReceiptText,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type {
  ApoloFinancialSubtab,
  ApoloTabItem,
  ApoloUnitSubtab,
} from "../../types/apolo-local";

// Configuracao de abas do cockpit CRM (extraida do ApoloPage monolitico).

export const apoloTabs = [
  { icon: LayoutDashboard, id: "resumo", label: "Resumo" },
  { icon: ContactRound, id: "cadastro", label: "Cadastro" },
  { icon: Network, id: "relacionamentos", label: "Relacionamentos" },
  { icon: MapPinned, id: "carteira", label: "Carteira" },
  { icon: CircleDollarSign, id: "financeiro", label: "Financeiro" },
  { icon: Files, id: "documentos", label: "Documentos" },
  { icon: History, id: "timeline", label: "Histórico" },
] as const satisfies readonly ApoloTabItem[];

export const apoloUnitSubtabs = [
  { icon: LayoutDashboard, id: "summary", label: "Resumo" },
  { icon: ReceiptText, id: "installments", label: "Parcelas" },
  { icon: Clock3, id: "timeline", label: "Timeline" },
  { icon: FileText, id: "contract", label: "Contrato" },
] as const satisfies readonly {
  icon: LucideIcon;
  id: ApoloUnitSubtab;
  label: string;
}[];

export const apoloFinancialSubtabs = [
  { icon: HandCoins, id: "acordos", label: "Acordos" },
] as const satisfies readonly {
  icon: LucideIcon;
  id: ApoloFinancialSubtab;
  label: string;
}[];
