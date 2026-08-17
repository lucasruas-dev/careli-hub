import {
  AlertTriangle,
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
  | "logErros"
  | "relatorios";

/**
 * A tela ativa é PERSISTIDA no localStorage, então o valor guardado sobrevive à remoção de uma
 * tela do catálogo.
 *
 * ⚠️ SEM ESTE SANEAMENTO, QUEM ESTAVA NA TELA REMOVIDA ABRE O APOLO EM BRANCO: nenhum bloco casa
 * com o id antigo, o sidebar não destaca nada, e não há como sair a não ser clicando em outra
 * coisa. Foi o que aconteceria com quem tinha "importacao" salva quando a importação do Asana saiu
 * (17/08/2026), que é justamente quem mais usava a tela.
 */
export function telaValida(bruto: unknown): ApoloScreen | null {
  return apoloScreens.some((item) => item.id === bruto) ? (bruto as ApoloScreen) : null;
}

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
  // A tela "Importar CADs" (Asana) saiu em 17/08/2026, a pedido do Lucas: "não faz mais sentido
  // importação do Asana, pode tirar". A fonte da CAD passou a ser o próprio Apolo (portal público
  // do corretor), então trazer ficha da central do Asana virou caminho morto.
  //
  // ⚠️ O BACKEND CONTINUA DE PÉ, e não é sobra esquecida: `lib/apolo/asana-import.ts` também
  // alimenta o diagnóstico de CAD, o backfill de empreendimento e o relatório das imobiliárias.
  // Arrancar as rotas junto com a tela quebraria os três.
  {
    // Quem tentou enviar CAD ou se credenciar e NÃO conseguiu. O sucesso não entra aqui: ele já é
    // a CAD que aparece no Board (observação do Lucas, 17/08).
    description: "Tentativas recusadas no cadastro publico: quem travou, onde e por que.",
    hidden: false,
    icon: AlertTriangle,
    id: "logErros",
    label: "Log Erros",
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
