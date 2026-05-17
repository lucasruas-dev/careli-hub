import type { HubModule, HubModuleStatus } from "./types";

export const hubModules = [
  {
    id: "guardian",
    name: "Guardian",
    description: "Operacao, seguranca e inteligencia operacional do ecossistema.",
    category: "core",
    status: "active",
    basePath: "/guardian",
    iconKey: "guardian",
    realtimeEnabled: true,
    order: 10,
    requiredPermissions: ["guardian:view"],
    routes: [
      {
        id: "guardian-overview",
        label: "Visao geral",
        path: "/guardian",
        description: "Resumo operacional do Guardian.",
      },
    ],
    navigationItems: [
      {
        id: "guardian-overview",
        label: "Guardian",
        path: "/guardian",
        iconKey: "guardian",
        order: 10,
      },
    ],
  },
  {
    id: "caredesk",
    name: "CareDesk",
    description: "Atendimento multicanal compartilhado para os modulos do Hub.",
    category: "operations",
    status: "active",
    basePath: "/caredesk",
    iconKey: "caredesk",
    realtimeEnabled: true,
    order: 18,
    requiredPermissions: ["caredesk:view"],
    routes: [
      {
        id: "caredesk-overview",
        label: "Operacao",
        path: "/caredesk",
        description: "Fila, tickets e atendimento multicanal do Hub.",
      },
    ],
    navigationItems: [
      {
        badge: "live",
        id: "caredesk-overview",
        label: "CareDesk",
        path: "/caredesk",
        iconKey: "caredesk",
        order: 10,
      },
    ],
  },
  {
    id: "setup",
    name: "Setup",
    description: "Configuracao central de usuarios, estrutura e modulos do Hub.",
    category: "core",
    status: "active",
    basePath: "/setup",
    iconKey: "setup",
    realtimeEnabled: false,
    order: 15,
    requiredPermissions: ["setup:view"],
    routes: [
      {
        id: "setup-overview",
        label: "Central",
        path: "/setup",
        description: "Configuracao global do Hub.",
      },
    ],
    navigationItems: [
      {
        id: "setup-overview",
        label: "Setup",
        path: "/setup",
        iconKey: "setup",
        order: 10,
      },
    ],
  },
  {
    id: "pulsex",
    name: "PulseX",
    description: "Sinais, eventos e pulso realtime das operacoes.",
    category: "operations",
    status: "active",
    basePath: "/pulsex",
    iconKey: "pulsex",
    realtimeEnabled: true,
    order: 20,
    requiredPermissions: ["pulsex:view"],
    routes: [
      {
        id: "pulsex-overview",
        label: "Visao geral",
        path: "/pulsex",
        description: "Acompanhamento inicial do PulseX.",
      },
    ],
    navigationItems: [
      {
        badge: "live",
        id: "pulsex-overview",
        label: "PulseX",
        path: "/pulsex",
        iconKey: "pulsex",
        order: 10,
      },
    ],
  },
  {
    id: "squadops",
    name: "SquadOps",
    description: "Orquestracao de squads, demandas, handoffs, QA e deploys da engenharia IA.",
    category: "core",
    status: "active",
    basePath: "/squadops",
    iconKey: "squadops",
    realtimeEnabled: false,
    order: 25,
    requiredPermissions: ["squadops:view"],
    routes: [
      {
        id: "squadops-overview",
        label: "Operacao",
        path: "/squadops",
        description: "Painel operacional das squads de engenharia IA.",
      },
    ],
    navigationItems: [
      {
        id: "squadops-overview",
        label: "SquadOps",
        path: "/squadops",
        iconKey: "squadops",
        order: 10,
      },
    ],
  },
  {
    id: "agenda",
    name: "Agenda",
    description: "Calendarios, compromissos e rotinas operacionais.",
    category: "productivity",
    status: "planned",
    basePath: "/agenda",
    iconKey: "agenda",
    realtimeEnabled: true,
    order: 30,
    requiredPermissions: ["agenda:view"],
    routes: [
      {
        id: "agenda-overview",
        label: "Visao geral",
        path: "/agenda",
      },
    ],
    navigationItems: [
      {
        id: "agenda-overview",
        label: "Agenda",
        path: "/agenda",
        iconKey: "agenda",
        order: 10,
      },
    ],
  },
  {
    id: "financeiro",
    name: "Financeiro",
    description: "Fluxos financeiros, controle e acompanhamento executivo.",
    category: "finance",
    status: "planned",
    basePath: "/financeiro",
    iconKey: "financeiro",
    realtimeEnabled: false,
    order: 40,
    requiredPermissions: ["financeiro:view"],
    routes: [
      {
        id: "financeiro-overview",
        label: "Visao geral",
        path: "/financeiro",
      },
    ],
    navigationItems: [
      {
        id: "financeiro-overview",
        label: "Financeiro",
        path: "/financeiro",
        iconKey: "financeiro",
        order: 10,
      },
    ],
  },
  {
    id: "drive",
    name: "Drive",
    description: "Documentos, arquivos e ativos compartilhados.",
    category: "productivity",
    status: "planned",
    basePath: "/drive",
    iconKey: "drive",
    realtimeEnabled: false,
    order: 50,
    requiredPermissions: ["drive:view"],
    routes: [
      {
        id: "drive-overview",
        label: "Arquivos",
        path: "/drive",
      },
    ],
    navigationItems: [
      {
        id: "drive-overview",
        label: "Drive",
        path: "/drive",
        iconKey: "drive",
        order: 10,
      },
    ],
  },
  {
    id: "contatos",
    name: "Contatos",
    description: "Pessoas, organizacoes e relacionamento operacional.",
    category: "commercial",
    status: "planned",
    basePath: "/contatos",
    iconKey: "contatos",
    realtimeEnabled: false,
    order: 60,
    requiredPermissions: ["contatos:view"],
    routes: [
      {
        id: "contatos-overview",
        label: "Lista",
        path: "/contatos",
      },
    ],
    navigationItems: [
      {
        id: "contatos-overview",
        label: "Contatos",
        path: "/contatos",
        iconKey: "contatos",
        order: 10,
      },
    ],
  },
  {
    id: "compras",
    name: "Compras",
    description: "Solicitacoes, fornecedores e processos de aquisicao.",
    category: "procurement",
    status: "planned",
    basePath: "/compras",
    iconKey: "compras",
    realtimeEnabled: false,
    order: 70,
    requiredPermissions: ["compras:view"],
    routes: [
      {
        id: "compras-overview",
        label: "Solicitacoes",
        path: "/compras",
      },
    ],
    navigationItems: [
      {
        id: "compras-overview",
        label: "Compras",
        path: "/compras",
        iconKey: "compras",
        order: 10,
      },
    ],
  },
] as const satisfies readonly HubModule[];

export const hubModulesById = Object.fromEntries(
  hubModules.map((module) => [module.id, module]),
);

export const orderedHubModules = [...hubModules].sort(
  (firstModule, secondModule) => firstModule.order - secondModule.order,
);

export function getHubModuleById(moduleId: string): HubModule | undefined {
  return hubModulesById[moduleId];
}

export function isHubModuleActive(module: HubModule): boolean {
  return module.status === "active";
}

export function getHubModuleStatusLabel(status: HubModuleStatus): string {
  const labels = {
    active: "Ativo",
    disabled: "Indisponivel",
    locked: "Em preparacao",
    planned: "Em preparacao",
  } as const satisfies Record<HubModuleStatus, string>;

  return labels[status];
}
