export type SquadOpsDemandStatus =
  | "intake"
  | "implementing"
  | "validating"
  | "waiting-architect"
  | "waiting-qa"
  | "waiting-deploy";

export type SquadOpsEnvironmentStatus =
  | "stable"
  | "pending"
  | "blocked"
  | "watching";

export type SquadOpsDemand = {
  architectOwner: string;
  commits: readonly SquadOpsCommit[];
  deploys: readonly SquadOpsDeploy[];
  dueAt: string;
  environment: Record<SquadOpsEnvironmentName, SquadOpsEnvironmentStatus>;
  handoff: string;
  id: string;
  module: string;
  nextAgent: string;
  priority: "alta" | "media" | "critica";
  protocol: string;
  qa: readonly SquadOpsQaRecord[];
  requester: string;
  squadId: string;
  status: SquadOpsDemandStatus;
  summary: string;
  timeline: readonly SquadOpsTimelineEvent[];
  title: string;
};

export type SquadOpsEnvironmentName =
  | "desenvolvimento"
  | "qa"
  | "homologacao"
  | "producao";

export type SquadOpsCommit = {
  author: string;
  hash: string;
  message: string;
  status: "registrado" | "aguardando push";
  timestamp: string;
};

export type SquadOpsQaRecord = {
  owner: string;
  result: "pendente" | "aprovado" | "ajuste";
  scope: string;
  timestamp: string;
};

export type SquadOpsDeploy = {
  environment: SquadOpsEnvironmentName;
  owner: string;
  status: "pendente" | "bloqueado" | "publicado";
  timestamp: string;
};

export type SquadOpsTimelineEvent = {
  actor: string;
  detail: string;
  id: string;
  status: SquadOpsDemandStatus;
  timestamp: string;
  title: string;
};

export type SquadOpsSquad = {
  focus: string;
  id: string;
  lead: string;
  members: readonly string[];
  name: string;
  nextProtocol: string;
  status: "ativa" | "aguardando handoff" | "planejada";
};

export const squadOpsStatusLabels = {
  intake: "Entrada",
  implementing: "Implementando",
  validating: "Validando",
  "waiting-architect": "Aguardando Architect",
  "waiting-qa": "Aguardando QA",
  "waiting-deploy": "Aguardando deploy",
} as const satisfies Record<SquadOpsDemandStatus, string>;

export const squadOpsStatusOrder = [
  "intake",
  "implementing",
  "validating",
  "waiting-architect",
  "waiting-qa",
  "waiting-deploy",
] as const satisfies readonly SquadOpsDemandStatus[];

export const squadOpsEnvironmentLabels = {
  desenvolvimento: "Desenvolvimento",
  homologacao: "Homologacao",
  producao: "Producao",
  qa: "QA",
} as const satisfies Record<SquadOpsEnvironmentName, string>;

export const squadOpsSquads = [
  {
    focus: "Modulo SquadOps, protocolos da engenharia IA e handoffs.",
    id: "squadops-core",
    lead: "SquadOps Core",
    members: ["Codex Senior", "Hub Architect", "Hub QA"],
    name: "SquadOps Core",
    nextProtocol: "SQD-20260517-001",
    status: "ativa",
  },
  {
    focus: "Revisao de arquitetura, fronteiras de modulo e modelagem futura.",
    id: "hub-architect",
    lead: "Hub Architect",
    members: ["Architect", "DataOps"],
    name: "Hub Architect",
    nextProtocol: "ARC-20260517-004",
    status: "aguardando handoff",
  },
  {
    focus: "Validacao visual, responsiva, regressao e criterios de aceite.",
    id: "hub-qa",
    lead: "Hub QA",
    members: ["QA Desktop", "QA Mobile"],
    name: "Hub QA",
    nextProtocol: "QA-20260517-006",
    status: "aguardando handoff",
  },
] as const satisfies readonly SquadOpsSquad[];

export const squadOpsDemands = [
  {
    architectOwner: "Hub Architect",
    commits: [
      {
        author: "SquadOps Core",
        hash: "pendente",
        message: "feat(hub): create squadops operational module",
        status: "aguardando push",
        timestamp: "17/05 10:42",
      },
    ],
    deploys: [
      {
        environment: "desenvolvimento",
        owner: "SquadOps Core",
        status: "pendente",
        timestamp: "17/05 11:10",
      },
      {
        environment: "qa",
        owner: "Hub QA",
        status: "pendente",
        timestamp: "apos validacao local",
      },
    ],
    dueAt: "17/05 14:00",
    environment: {
      desenvolvimento: "pending",
      homologacao: "blocked",
      producao: "blocked",
      qa: "pending",
    },
    handoff: "Entregar primeira versao para revisao arquitetural e QA visual.",
    id: "DEMAND-001",
    module: "SquadOps",
    nextAgent: "Hub Architect",
    priority: "critica",
    protocol: "SQD-20260517-001",
    qa: [
      {
        owner: "Hub QA",
        result: "pendente",
        scope: "Desktop, mobile, navegacao e leitura do board.",
        timestamp: "aguardando build local",
      },
    ],
    requester: "Lucas",
    squadId: "squadops-core",
    status: "waiting-architect",
    summary:
      "Criar a primeira tela operacional do SquadOps com demandas, squads, protocolos, commits, QA, deploys e ambientes.",
    timeline: [
      {
        actor: "Lucas",
        detail: "Nova frente SquadOps Core definida para engenharia IA do Hub.",
        id: "tl-001",
        status: "intake",
        timestamp: "17/05 10:18",
        title: "Demanda registrada",
      },
      {
        actor: "SquadOps Core",
        detail: "Escopo isolado de Guardian, CareDesk e PulseX confirmado.",
        id: "tl-002",
        status: "implementing",
        timestamp: "17/05 10:31",
        title: "Escopo validado",
      },
      {
        actor: "SquadOps Core",
        detail: "Primeira versao mockada preparada para handoff.",
        id: "tl-003",
        status: "waiting-architect",
        timestamp: "17/05 11:10",
        title: "Handoff arquitetural",
      },
    ],
    title: "Primeira tela operacional SquadOps",
  },
  {
    architectOwner: "Hub Architect",
    commits: [
      {
        author: "Hub Architect",
        hash: "ARC-PLAN",
        message: "Definir tabelas, RLS e contratos do SquadOps",
        status: "registrado",
        timestamp: "planejado",
      },
    ],
    deploys: [
      {
        environment: "homologacao",
        owner: "Hub InfraOps",
        status: "pendente",
        timestamp: "apos QA",
      },
    ],
    dueAt: "18/05 10:00",
    environment: {
      desenvolvimento: "watching",
      homologacao: "pending",
      producao: "blocked",
      qa: "pending",
    },
    handoff: "Validar se o modelo futuro entra em schema compartilhado do Hub.",
    id: "DEMAND-002",
    module: "SquadOps",
    nextAgent: "Hub DataOps",
    priority: "alta",
    protocol: "SQD-20260517-002",
    qa: [
      {
        owner: "Hub QA",
        result: "pendente",
        scope: "Cenarios de permissao, status e historico.",
        timestamp: "apos arquitetura",
      },
    ],
    requester: "SquadOps Core",
    squadId: "hub-architect",
    status: "waiting-qa",
    summary:
      "Propor modelagem Supabase para demandas, squads, timeline, commits, QA, deploys e recomendacao de agente.",
    timeline: [
      {
        actor: "SquadOps Core",
        detail: "Sugestao inicial de tabelas adicionada na tela e no diario.",
        id: "tl-004",
        status: "validating",
        timestamp: "17/05 11:20",
        title: "Modelo futuro sugerido",
      },
    ],
    title: "Modelagem futura Supabase",
  },
  {
    architectOwner: "Hub QA",
    commits: [],
    deploys: [
      {
        environment: "producao",
        owner: "Hub InfraOps",
        status: "bloqueado",
        timestamp: "sem aprovacao QA",
      },
    ],
    dueAt: "18/05 16:00",
    environment: {
      desenvolvimento: "stable",
      homologacao: "blocked",
      producao: "blocked",
      qa: "pending",
    },
    handoff: "Criar checklist operacional para aprovar SquadOps em desktop e mobile.",
    id: "DEMAND-003",
    module: "SquadOps",
    nextAgent: "Hub QA",
    priority: "media",
    protocol: "SQD-20260517-003",
    qa: [
      {
        owner: "Hub QA",
        result: "pendente",
        scope: "Checklist ainda nao executado.",
        timestamp: "aguardando handoff",
      },
    ],
    requester: "SquadOps Core",
    squadId: "hub-qa",
    status: "waiting-qa",
    summary:
      "Formalizar validacao de usabilidade, conteudo operacional, responsividade e regressao de shell.",
    timeline: [
      {
        actor: "Hub QA",
        detail: "Fila aberta para validar apos build local e commit semantico.",
        id: "tl-005",
        status: "waiting-qa",
        timestamp: "17/05 11:32",
        title: "QA aguardando",
      },
    ],
    title: "QA visual e operacional do SquadOps",
  },
] as const satisfies readonly SquadOpsDemand[];

export const squadOpsSupabaseModel = [
  {
    description: "Registro principal da demanda, modulo, prioridade, status e protocolo.",
    name: "hub_squadops_demands",
  },
  {
    description: "Cadastro das squads, responsaveis, escopo, status e ordem de handoff.",
    name: "hub_squadops_squads",
  },
  {
    description: "Eventos imutaveis da timeline operacional por demanda.",
    name: "hub_squadops_timeline_events",
  },
  {
    description: "Commits vinculados a demanda, squad, autor e validacao local.",
    name: "hub_squadops_commits",
  },
  {
    description: "Registros de QA com escopo, resultado, evidencias e responsavel.",
    name: "hub_squadops_qa_records",
  },
  {
    description: "Deploys por ambiente, status, artefato e aprovador.",
    name: "hub_squadops_deploys",
  },
  {
    description: "Recomendacoes de proximo agente com motivo e status do handoff.",
    name: "hub_squadops_agent_recommendations",
  },
] as const;
