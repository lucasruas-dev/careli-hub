import {
  BarChart3,
  BriefcaseBusiness,
  Building2,
  ContactRound,
  FileSpreadsheet,
  Handshake,
  IdCard,
  Landmark,
  LayoutDashboard,
  LayoutGrid,
  ShieldCheck,
  Store,
  UserRoundCog,
  UserRoundSearch,
  UsersRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { ApoloProfile } from "./types";

export type ApoloScreen =
  | "board"
  | "dashboard"
  | "crm"
  | "empreendimentos"
  | "relatorios";

export type ApoloScreenItem = {
  description: string;
  // Oculto do sidebar por enquanto (o Lucas libera as telas uma a uma).
  hidden?: boolean;
  icon: LucideIcon;
  id: ApoloScreen;
  label: string;
  profileFilter?: ApoloProfile;
};

export const apoloProfileLabels = {
  acesso_incorporador: "Incorporador",
  colaborador: "Colaborador",
  corretor: "Corretor",
  fornecedor: "Fornecedor",
  imobiliaria: "Imobiliaria",
  incorporador: "Incorporador",
  parceiro: "Parceiro",
  pessoa_fisica: "Pessoa fisica",
  pessoa_juridica: "Pessoa juridica",
  prospect: "Prospect",
  usuario: "Usuario",
} as const satisfies Record<ApoloProfile, string>;

// Lista que VALIDA o papel vindo do banco (normalizeApoloProfile). Papel fora daqui e
// descartado na leitura -- foi o que segurava o 'prospect' de aparecer na ficha.
export const apoloProfileOptions = [
  "usuario",
  "prospect",
  "incorporador",
  "imobiliaria",
  "corretor",
  "parceiro",
  "fornecedor",
  "colaborador",
  "acesso_incorporador",
  "pessoa_fisica",
  "pessoa_juridica",
] as const satisfies readonly ApoloProfile[];

export const apoloProfileCardOrder = [
  "usuario",
  "incorporador",
  "imobiliaria",
  "corretor",
  "parceiro",
  "fornecedor",
  "colaborador",
] as const satisfies readonly ApoloProfile[];

export const apoloScreens = [
  {
    description: "Fila de validacao: imobiliarias, corretores e CADs ate o credenciamento.",
    hidden: false,
    icon: LayoutGrid,
    id: "board",
    label: "Board",
  },
  {
    description: "Cadastro, consulta, carteira e timeline 360.",
    hidden: false,
    icon: ContactRound,
    id: "crm",
    label: "CRM 360",
  },
  {
    description: "Cenario geral, unidades e relacionamentos por empreendimento.",
    hidden: false,
    icon: Building2,
    id: "empreendimentos",
    label: "Empreendimento",
  },
  {
    description: "Insights executivos do cadastro mestre.",
    hidden: true,
    icon: LayoutDashboard,
    id: "dashboard",
    label: "Dashboard",
  },
  {
    description: "Relatorios de perfis, qualidade e operacao.",
    hidden: true,
    icon: FileSpreadsheet,
    id: "relatorios",
    label: "Relatorios",
  },
] as const satisfies readonly ApoloScreenItem[];

export function getApoloScreenTitle(screen: ApoloScreen) {
  return apoloScreens.find((item) => item.id === screen)?.label ?? "CRM";
}

export function getApoloScreenDescription(screen: ApoloScreen) {
  return (
    apoloScreens.find((item) => item.id === screen)?.description ??
    "Visao operacional do cadastro mestre."
  );
}

export function getApoloProfileIcon(profile: ApoloProfile): LucideIcon {
  const icons = {
    acesso_incorporador: BarChart3,
    colaborador: UserRoundCog,
    corretor: IdCard,
    fornecedor: BriefcaseBusiness,
    imobiliaria: Store,
    incorporador: Landmark,
    parceiro: Handshake,
    pessoa_fisica: ContactRound,
    pessoa_juridica: Building2,
    prospect: UserRoundSearch,
    usuario: UsersRound,
  } as const satisfies Record<ApoloProfile, LucideIcon>;

  return icons[profile] ?? ShieldCheck;
}
