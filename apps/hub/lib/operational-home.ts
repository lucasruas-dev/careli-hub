import type {
  Department,
  DepartmentModuleAccess,
  OperationalProfileRole,
  Sector,
} from "@repo/shared";

export type OperationStatus =
  | "online"
  | "away"
  | "lunch"
  | "offline"
  | "meeting";

export type OperationalTeamMember = {
  departmentId: Department["id"];
  id: string;
  initials: string;
  lastSignal: string;
  name: string;
  profileRole: OperationalProfileRole;
  roleLabel: string;
  sectorId: Sector["id"];
  status: OperationStatus;
};

export type OperationalActivityStatus =
  | "overdue"
  | "pending"
  | "tracking"
  | "done";

export type OperationalActivity = {
  assigneeId: OperationalTeamMember["id"];
  due: string;
  id: string;
  moduleId?: string;
  status: OperationalActivityStatus;
  title: string;
};

export type HubImprovementType =
  | "melhoria"
  | "correcao"
  | "novo recurso"
  | "ajuste visual";

export type HubImprovement = {
  date: string;
  description: string;
  id: string;
  moduleId?: string;
  title: string;
  type: HubImprovementType;
};

export const operationalDepartments: readonly Department[] = [
  {
    id: "dep-operations",
    name: "Operacao",
    slug: "operacao",
  },
  {
    id: "dep-relationship",
    name: "Relacionamento",
    slug: "relacionamento",
  },
  {
    id: "dep-technology",
    name: "Tecnologia",
    slug: "tecnologia",
  },
];

export const operationalSectors: readonly Sector[] = [
  {
    departmentId: "dep-operations",
    id: "sec-desk",
    name: "CareDesk",
    slug: "desk",
  },
  {
    departmentId: "dep-operations",
    id: "sec-billing",
    name: "Cobranca",
    slug: "cobranca",
  },
  {
    departmentId: "dep-relationship",
    id: "sec-care",
    name: "Atendimento",
    slug: "atendimento",
  },
  {
    departmentId: "dep-technology",
    id: "sec-platform",
    name: "Plataforma",
    slug: "plataforma",
  },
];

export const departmentModuleAccess: readonly DepartmentModuleAccess[] = [
  {
    departmentId: "dep-operations",
    moduleId: "pulsex",
    status: "enabled",
  },
  {
    departmentId: "dep-relationship",
    moduleId: "pulsex",
    status: "enabled",
  },
  {
    departmentId: "dep-technology",
    moduleId: "pulsex",
    status: "enabled",
  },
  {
    departmentId: "dep-admin",
    moduleId: "setup",
    status: "enabled",
  },
];

export const operationalTeam: readonly OperationalTeamMember[] = [
  {
    departmentId: "dep-operations",
    id: "user-nivea",
    initials: "NC",
    lastSignal: "agora",
    name: "Nivea Careli",
    profileRole: "cdr",
    roleLabel: "Coordenacao",
    sectorId: "sec-desk",
    status: "online",
  },
  {
    departmentId: "dep-operations",
    id: "user-gustavo",
    initials: "GF",
    lastSignal: "4 min",
    name: "Gustavo Freitas",
    profileRole: "ldr",
    roleLabel: "Lider de cobranca",
    sectorId: "sec-billing",
    status: "meeting",
  },
  {
    departmentId: "dep-relationship",
    id: "user-marina",
    initials: "MS",
    lastSignal: "12 min",
    name: "Marina Souza",
    profileRole: "op2",
    roleLabel: "Atendimento",
    sectorId: "sec-care",
    status: "away",
  },
  {
    departmentId: "dep-operations",
    id: "user-larissa",
    initials: "LA",
    lastSignal: "almoco",
    name: "Larissa Alves",
    profileRole: "op1",
    roleLabel: "CareDesk",
    sectorId: "sec-desk",
    status: "lunch",
  },
  {
    departmentId: "dep-technology",
    id: "user-lucas",
    initials: "LR",
    lastSignal: "agora",
    name: "Lucas Ruas",
    profileRole: "adm",
    roleLabel: "Tecnologia",
    sectorId: "sec-platform",
    status: "online",
  },
  {
    departmentId: "dep-relationship",
    id: "user-bruna",
    initials: "BR",
    lastSignal: "1h18",
    name: "Bruna Rocha",
    profileRole: "op1",
    roleLabel: "Relacionamento",
    sectorId: "sec-care",
    status: "offline",
  },
];

export const operationalActivities: readonly OperationalActivity[] = [
  {
    assigneeId: "user-gustavo",
    due: "09:40",
    id: "activity-desk-returns",
    moduleId: "caredesk",
    status: "overdue",
    title: "Retornos pendentes do CareDesk",
  },
  {
    assigneeId: "user-nivea",
    due: "10:30",
    id: "activity-directors-brief",
    moduleId: "pulsex",
    status: "tracking",
    title: "Leitura para diretoria",
  },
  {
    assigneeId: "user-marina",
    due: "11:00",
    id: "activity-care-followup",
    status: "pending",
    title: "Acompanhamento de relacionamento",
  },
  {
    assigneeId: "user-lucas",
    due: "08:50",
    id: "activity-auth-polish",
    moduleId: "hub",
    status: "done",
    title: "Polimento do acesso ao Hub",
  },
  {
    assigneeId: "user-larissa",
    due: "14:00",
    id: "activity-billing-check",
    status: "pending",
    title: "Conferencia de cobranca sensivel",
  },
];

// Every visible Codex delivery should add a concise entry here.
export const hubImprovements: readonly HubImprovement[] = [
  {
    date: "14/05",
    description:
      "Home passou a organizar ritmo da equipe, painel do dia, historico de status e acesso rapido a foto do perfil.",
    id: "hub-home-operational-center",
    moduleId: "hub",
    title: "Central inicial do Hub",
    type: "melhoria",
  },
  {
    date: "14/05",
    description:
      "Status ausente agora respeita 10 minutos sem atividade e fica alinhado ao controle macro do Hub.",
    id: "hub-presence-ten-minute-idle",
    moduleId: "hub",
    title: "Presenca com regra de 10 minutos",
    type: "correcao",
  },
  {
    date: "14/05",
    description:
      "PulseX recebeu respostas, tags, anexos, audio, chamadas e indicadores de leitura preparados para operacao diaria.",
    id: "pulsex-operations-suite",
    moduleId: "pulsex",
    title: "PulseX mais completo",
    type: "novo recurso",
  },
  {
    date: "13/05",
    description: "Sidebar recebeu logo C2X, Guardian dedicado e ordenacao alfabetica.",
    id: "hub-sidebar-branding",
    moduleId: "hub",
    title: "Identidade do shell refinada",
    type: "ajuste visual",
  },
  {
    date: "13/05",
    description: "Mensagens de autenticacao foram traduzidas para linguagem institucional.",
    id: "hub-auth-messaging",
    moduleId: "hub",
    title: "Acesso mais claro",
    type: "melhoria",
  },
  {
    date: "13/05",
    description: "PulseX ganhou mencoes estruturadas para notificacoes futuras.",
    id: "pulsex-mentions",
    moduleId: "pulsex",
    title: "Mencoes operacionais",
    type: "novo recurso",
  },
];
