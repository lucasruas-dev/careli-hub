import {
  Building2,
  Clock3,
  FileText,
  HandCoins,
  LayoutDashboard,
  MapPinned,
  ReceiptText,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";

export type ClientDetailWorkspaceTab =
  | "overview"
  | "client"
  | "portfolio"
  | "timeline"
  | "agreements";

export type ClientDetailUnitSubtab =
  | "summary"
  | "installments"
  | "agreements"
  | "timeline"
  | "risk"
  | "documents";

export const workspaceTabs: Array<{
  id: ClientDetailWorkspaceTab;
  label: string;
  icon: LucideIcon;
}> = [
  { id: "overview", label: "Visão geral", icon: LayoutDashboard },
  { id: "client", label: "Cliente", icon: Building2 },
  { id: "portfolio", label: "Carteira", icon: MapPinned },
  { id: "timeline", label: "Timeline", icon: Clock3 },
  { id: "agreements", label: "Acordos", icon: HandCoins },
];

export const unitSubtabs: Array<{
  id: ClientDetailUnitSubtab;
  label: string;
  icon: LucideIcon;
}> = [
  { id: "summary", label: "Resumo da unidade", icon: LayoutDashboard },
  { id: "installments", label: "Parcelas", icon: ReceiptText },
  { id: "agreements", label: "Acordos", icon: HandCoins },
  { id: "timeline", label: "Timeline", icon: Clock3 },
  { id: "risk", label: "Risco", icon: ShieldAlert },
  { id: "documents", label: "Documentos da unidade", icon: FileText },
];
