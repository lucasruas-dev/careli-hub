import type { HubModule, HubModuleStatus } from "./types";

export const hubModules = [
  {
    id: "hades",
    name: "Hades",
    description: "Cobranca, carteira, risco e recuperacao financeira do Panteon.",
    category: "core",
    status: "active",
    basePath: "/hades",
    iconKey: "hades",
    realtimeEnabled: true,
    order: 10,
    requiredPermissions: ["hades:view"],
    routes: [
      {
        id: "hades-overview",
        label: "Visao geral",
        path: "/hades",
        description: "Resumo operacional do Hades.",
      },
    ],
    navigationItems: [
      {
        id: "hades-overview",
        label: "Hades",
        path: "/hades",
        iconKey: "hades",
        order: 10,
      },
    ],
  },
  {
    id: "iris",
    name: "Iris",
    description: "Atendimento multicanal e mensagens operacionais do Panteon.",
    category: "operations",
    status: "active",
    basePath: "/iris",
    iconKey: "iris",
    realtimeEnabled: true,
    order: 18,
    requiredPermissions: ["iris:view"],
    routes: [
      {
        id: "iris-overview",
        label: "Operacao",
        path: "/iris",
        description: "Fila, tickets e atendimento multicanal do Panteon.",
      },
    ],
    navigationItems: [
      {
        badge: "live",
        id: "iris-overview",
        label: "Iris",
        path: "/iris",
        iconKey: "iris",
        order: 10,
      },
    ],
  },
  {
    id: "setup",
    name: "Setup",
    description: "Configuracao central de usuarios, estrutura e modulos do Panteon.",
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
    id: "hermes",
    name: "Hermes",
    description: "Comunicacao interna, sinais e pulso realtime das operacoes.",
    category: "operations",
    status: "active",
    basePath: "/hermes",
    iconKey: "hermes",
    realtimeEnabled: true,
    order: 20,
    requiredPermissions: ["hermes:view"],
    routes: [
      {
        id: "hermes-overview",
        label: "Visao geral",
        path: "/hermes",
        description: "Acompanhamento inicial do Hermes.",
      },
    ],
    navigationItems: [
      {
        badge: "live",
        id: "hermes-overview",
        label: "Hermes",
        path: "/hermes",
        iconKey: "hermes",
        order: 10,
      },
    ],
  },
  {
    id: "chronos",
    name: "Chronos",
    description: "Reunioes executivas, atas, transcricoes e memoria formal.",
    category: "operations",
    status: "active",
    basePath: "/chronos",
    iconKey: "chronos",
    realtimeEnabled: true,
    order: 22,
    requiredPermissions: ["chronos:view"],
    routes: [
      {
        id: "chronos-overview",
        label: "Reunioes",
        path: "/chronos",
        description: "Salas, reunioes formais, atas e follow-ups.",
      },
    ],
    navigationItems: [
      {
        badge: "v1",
        id: "chronos-overview",
        label: "Chronos",
        path: "/chronos",
        iconKey: "chronos",
        order: 10,
      },
    ],
  },
  {
    id: "atlas",
    name: "Atlas",
    description: "Performance operacional, ocorrencias, merito e cultura Careli.",
    category: "operations",
    status: "active",
    basePath: "/atlas",
    iconKey: "atlas",
    realtimeEnabled: true,
    order: 23,
    requiredPermissions: ["atlas:view"],
    routes: [
      {
        id: "atlas-overview",
        label: "Performance",
        path: "/atlas",
        description: "Indicadores, ocorrencias e acompanhamento operacional.",
      },
    ],
    navigationItems: [
      {
        badge: "v1",
        id: "atlas-overview",
        label: "Atlas",
        path: "/atlas",
        iconKey: "atlas",
        order: 10,
      },
    ],
  },
  {
    id: "zeus",
    name: "Zeus",
    description: "Comando operacional, engenharia IA, auditorias, riscos, dados, infra e suporte.",
    category: "core",
    status: "active",
    basePath: "/zeus",
    iconKey: "zeus",
    realtimeEnabled: false,
    order: 25,
    requiredPermissions: ["zeus:view"],
    routes: [
      {
        id: "zeus-overview",
        label: "Zeus",
        path: "/zeus",
        description: "Historico operacional, squads, auditorias e comando IA.",
      },
    ],
    navigationItems: [
      {
        id: "zeus-overview",
        label: "Zeus",
        path: "/zeus",
        iconKey: "zeus",
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
