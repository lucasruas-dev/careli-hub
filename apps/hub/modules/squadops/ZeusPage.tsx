"use client";

import { HubShell } from "@/layouts/hub-shell";
import {
  getHubPresenceLabel,
  HUB_PRESENCE_HEARTBEAT_MS,
  hubPresenceStatusOptions,
  markHubPresence,
  type HubPresenceStatus,
} from "@/lib/hub-presence";
import { loadHubItTickets } from "@/lib/hub-it-tickets/client";
import {
  EmptyState,
  PanelTitle,
} from "@/modules/squadops/blocks/shared/operations-ui";
import {
  formatIndicatorEvidence,
  formatMetricMs,
  getAverageResponseMs,
  getCacheSummary,
  getColdStartSummary,
  getHighestPayloadCheck,
  getMaxResponseMs,
  getResponseChecksTone,
  getSlowestCheck,
  monitoringSourceTone,
  payloadPerformanceTone,
  performanceCardBorderClass,
  performanceIconClass,
  sortMonitoringChecksByLatest,
  type PerformanceTone,
} from "@/modules/squadops/blocks/monitoring/performance-utils";
import {
  OperationsAlertCenter,
  OperationsAlertsDialog,
} from "@/modules/squadops/blocks/monitoring/alerts-panel";
import { MonitoringPeakPanel } from "@/modules/squadops/blocks/monitoring/peaks-panel";
import {
  getMonitoringSourceIcon,
  getMonitoringSourceMeta,
  getMonitoringSourceOrder,
  MiniTrendBars,
  MonitoringSourceGrid,
  type MonitoringSourceSummary,
} from "@/modules/squadops/blocks/monitoring/source-grid";
import { HubItTicketsBoard } from "@/modules/squadops/blocks/helpdesk/helpdesk-board";
import {
  countItTicketsWaitingForZeus,
  countOpenItTickets,
} from "@/modules/squadops/blocks/helpdesk/helpdesk-ticket-summary";
import { PanteonAddressCatalog } from "@/modules/squadops/blocks/address/address-catalog";
import { HealthBoard } from "@/modules/squadops/blocks/health/health-board";
import { DeployView } from "@/modules/squadops/blocks/deploy/deploy-view";
import {
  getHubSupabaseClient,
  hubSupabaseConfig,
} from "@/lib/supabase/client";
import type {
  OperationsAlert,
  OperationsAlertFeedbackStatus,
  OperationsAlertProtocolSummary,
  OperationsCheckMetric,
  OperationsMonitoringSnapshot,
  OperationsRiskLevel,
  OpsWatcherDecision,
} from "@/lib/operations/monitoring";
import {
  UNKNOWN_OPERATION_VALUE,
  type EngineeringAuditRoutine,
  type EngineeringOperationRecord,
  type EngineeringOperationsResponse,
} from "@/lib/squadops/engineering-operations-parser";
import {
  buildReleaseProtocols,
  getReleaseProtocolEnvironmentLabel,
  getReleaseProtocolStatusLabel,
  type HubReleaseProtocol,
  type ReleaseProtocolStatus,
} from "@/lib/squadops/release-protocols";
import {
  ReleaseModuleGroupSection,
  type ReleaseModuleGroup,
} from "@/modules/squadops/blocks/deploys/release-cards";
import {
  ProtocolRecordCard,
  RecordsTable,
  TimelinePanel,
} from "@/modules/squadops/blocks/records/timeline-records";
import {
  AuditRoutineDetailDrawer,
  AuditRoutinesPanel,
} from "@/modules/squadops/blocks/audits/audit-routines";
import {
  PoAiDrawer,
  PromptLibraryModal,
  createPoAiMessage,
  type PoAiChatMessage,
  type PromptTemplate,
} from "@/modules/squadops/blocks/po-ai/po-ai-panel";
import { useAuth } from "@/providers/auth-provider";
import type { HubUserContext } from "@repo/shared";
import {
  Badge,
  EmptyState as UixEmptyState,
  Surface,
  Tooltip,
  WorkspaceLayout,
} from "@repo/uix";
import type { BadgeVariant } from "@repo/uix";
import {
  AlertTriangle,
  Activity,
  Bell,
  Bot,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Copy,
  Database,
  FileText,
  GitCommitHorizontal,
  History,
  Layers3,
  LayoutGrid,
  LogOut,
  Loader2,
  Maximize2,
  Minimize2,
  Plus,
  RefreshCcw,
  Rocket,
  Search,
  Settings,
  ShieldAlert,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";

type OperationsFilters = {
  keyword: string;
  module: string;
  period: string;
  routine: string;
  squad: string;
  status: string;
  type: string;
};

type ZeusView =
  | "overview"
  | "health"
  | "monitoring"
  | "itTickets"
  | "address"
  | "deploys"
  | "timeline"
  | "audits"
  | "records";

type MonitoringIntervalMs = 0 | 10_000 | 30_000 | 60_000;

type WatcherApiResponse = {
  watcher?: OpsWatcherDecision;
};

type AlertProtocolsApiResponse = {
  protocols?: OperationsAlertProtocolSummary[];
};

type AlertFeedbackApiResponse = {
  protocol?: OperationsAlertProtocolSummary;
  error?: string;
};

type HomologationReviewsApiResponse = {
  error?: string;
  review?: {
    itemProtocol: string;
    note: string;
    releaseProtocol: string;
    status: HomologationReviewStatus;
    updatedAt: string;
  };
  state?: HomologationReviewState;
  status?: string;
};

type StructuredOperationApiRecord = {
  affectedFiles: string | null;
  changeCategory: string;
  commit: string | null;
  createdAt: string;
  deploy: string | null;
  healthchecks: string | null;
  how: string | null;
  id: string;
  isCritical: boolean;
  isModuleImprovement: boolean;
  isRelease: boolean;
  isSupportInvestigation: boolean;
  lineStart: number;
  localDateTime: string | null;
  localOccurredAt: string | null;
  logic: string | null;
  macroSummary: string | null;
  module: string;
  nextSquad: string | null;
  protocol: string;
  rawContent: string;
  reason: string | null;
  risks: string | null;
  routine: string | null;
  screen: string;
  shortSummary: string | null;
  sourceIndex: number;
  sourcePath: string;
  squad: string;
  status: string;
  subject: string;
  type: string;
  updatedAt: string;
  validation: string | null;
};

type StructuredSyncRun = {
  created_at: string;
  error_message: string | null;
  executed_by_user_id: string | null;
  handoffs_upserted: number;
  healthchecks_upserted: number;
  id: string;
  records_total: number;
  records_upserted: number;
  releases_upserted: number;
  source_path: string;
  status: string;
};

type StructuredOperationsApiResponse = {
  error?: string;
  storage?: {
    record?: StructuredOperationApiRecord;
    records?: StructuredOperationApiRecord[];
    status?: string;
    syncRuns?: StructuredSyncRun[];
  };
};

type ReleaseRegisterSourceApiSummary = {
  environment: "homologacao" | "producao";
  error: string | null;
  exists: boolean;
  path: string;
  recordsCount: number;
};

type ReleaseRegistersApiResponse = {
  error?: string;
  filters: EngineeringOperationsResponse["filters"];
  generatedAt: string;
  records: EngineeringOperationRecord[];
  releaseRecords: EngineeringOperationRecord[];
  sourcePath: string;
  sourcePaths: string[];
  sources: ReleaseRegisterSourceApiSummary[];
  status?: string;
};

type AuthDiagnosticsApiResponse = {
  generatedAt?: string;
  meta?: {
    activeProfileWithoutAuth: number;
    activeProfiles: number;
    authUsers: number;
    authWithoutProfile: number;
    disabledProfiles: number;
    hubProfiles: number;
    invalidRoleProfiles: number;
    sampledAuthUsers: boolean;
    sampledHubProfiles: boolean;
  };
  recommendations?: string[];
  status?: "bloqueado" | "desalinhado" | "indisponivel" | "sincronizado";
  error?: string;
};

type OperationsSourceState = {
  description: string;
  error: string | null;
  label: string;
  mode: "structured" | "fallback" | "loading";
  recordsCount: number;
  status: string;
  syncRuns: StructuredSyncRun[];
};

type OperationRecordFormState = {
  macroSummary: string;
  module: string;
  needsDeploy: boolean;
  nextSquad: string;
  reason: string;
  risks: string;
  screen: string;
  squad: string;
  status: string;
  subject: string;
  type: string;
  validation: string;
};

type HomologationReviewStatus =
  | "aguardando_teste"
  | "em_teste"
  | "aprovado"
  | "reprovado"
  | "bloqueado";

type HomologationItemReview = {
  note: string;
  status: HomologationReviewStatus;
  updatedAt: string;
};

type HomologationReviewState = Record<
  string,
  Record<string, HomologationItemReview>
>;

type HomologationItem = {
  kind:
    | "alerta"
    | "atendimento"
    | "cobranca"
    | "deploy"
    | "operacao"
    | "ticket";
  module: string;
  protocol: string;
  record: EngineeringOperationRecord | null;
  title: string;
  type: string;
};

type HomologationSummary = {
  approved: number;
  blocked: number;
  canGeneratePrompt: boolean;
  hasBlocker: boolean;
  inTest: number;
  isReady: boolean;
  isPartial: boolean;
  rejected: number;
  total: number;
  waiting: number;
};

type HomologationModuleSummary = {
  approved: number;
  blocked: number;
  readyPackages: number;
  total: number;
};

const allFilterValue = "__all";
const hubTimeZone = "America/Sao_Paulo";
const homologationStorageKey =
  "careli-hub:squadops:homologation-reviews:v1";
const alertProtocolOverrideStorageKey =
  "careli-hub:squadops:alert-protocol-overrides:v1";

const initialOperationsSourceState: OperationsSourceState = {
  description: "Aguardando leitura da fonte operacional.",
  error: null,
  label: "Carregando fonte",
  mode: "loading",
  recordsCount: 0,
  status: "pendente",
  syncRuns: [],
};

const initialFilters: OperationsFilters = {
  keyword: "",
  module: allFilterValue,
  period: allFilterValue,
  routine: allFilterValue,
  squad: allFilterValue,
  status: allFilterValue,
  type: allFilterValue,
};

const initialOperationRecordForm: OperationRecordFormState = {
  macroSummary: "",
  module: "Zeus",
  needsDeploy: false,
  nextSquad: "Hefesto",
  reason: "",
  risks: "",
  screen: "Operations Center",
  squad: "Zeus Core",
  status: "REGISTRADO",
  subject: "",
  type: "MELHORIA",
  validation: "",
};

const operationModuleOptions = [
  "Zeus",
  "Hades",
  "Iris",
  "Hermes",
  "Panteon Core",
  "Panteon UIX",
  "Hefesto",
] as const;

const operationSquadOptions = [
  "Zeus Core",
  "Hades Core",
  "Iris Core",
  "Hermes Core",
  "Zeus",
  "Hefesto",
] as const;

const operationTypeOptions = [
  "CORRECAO",
  "MELHORIA",
  "CRIACAO",
  "RELEASE",
  "AUDITORIA",
  "SUPORTE",
  "MONITORAMENTO",
  "DECISAO",
] as const;

const operationStatusOptions = [
  "REGISTRADO",
  "EM ANALISE",
  "EM EXECUCAO",
  "AGUARDANDO RELEASEOPS",
  "EM HOMOLOGACAO",
  "EM PRODUCAO",
  "FINALIZADO",
  "BLOQUEADO",
] as const;

const homologationStatusOptions = [
  { label: "Aguardando teste", value: "aguardando_teste" },
  { label: "Em teste", value: "em_teste" },
  { label: "Aprovado", value: "aprovado" },
  { label: "Reprovado", value: "reprovado" },
  { label: "Bloqueado", value: "bloqueado" },
] as const satisfies readonly {
  label: string;
  value: HomologationReviewStatus;
}[];

const promptTargets = [
  "Hades Core",
  "Iris Core",
  "Hermes Core",
  "Zeus Core",
  "Zeus",
  "Hefesto",
] as const;

type PromptTarget = (typeof promptTargets)[number];

const alertFeedbackOptions = [
  { label: "Em analise", value: "em_analise" },
  { label: "Persiste", value: "persiste" },
  { label: "Corrigido", value: "corrigido" },
  { label: "Nao observado", value: "nao_observado" },
  { label: "Bloqueado", value: "bloqueado" },
  { label: "Falso positivo", value: "falso_positivo" },
] as const satisfies readonly {
  label: string;
  value: OperationsAlertFeedbackStatus;
}[];

const promptTemplates: PromptTemplate<PromptTarget>[] = [
  {
    id: "deploy-hefesto",
    label: "Producao por modulo",
    description:
      "Hefesto recebe modulos homologados e promove apenas o que estiver aprovado.",
    target: "Hefesto",
    type: "deploy",
    body: `Assunto:
[Hefesto] Planejamento de producao por modulo homologado

Hefesto, solicito planejar e executar producao somente por modulo homologado e autorizado.

Este pedido NAO autoriza deploy de todo o worktree.
O deploy de producao deve ser programado a partir do Engineering Operations, do Zeus/Operations Center e confirmado contra o Git.

Fontes obrigatorias:
- Diario operacional: docs/operations/engineering-operations.md.
- Git/worktree: git status, git diff, git log e arquivos alterados.
- Validacoes e deployment de homologacao registrados pelo agente do modulo.
- Healthchecks e Vercel quando o recorte for promovido para producao.

Como descobrir o recorte:
- Ler os registros mais recentes do Engineering Operations.
- Identificar registros com status PRONTO PARA PRODUCAO, HOMOLOGADO ou AGUARDANDO PRODUCAO.
- Agrupar por modulo/frente/squad: Zeus, Hades, Hermes, Iris, Chronos, Atlas ou Setup.
- Para cada grupo, listar assunto, arquivos/modulos afetados, validacoes, riscos e proxima squad.
- Cruzar os arquivos citados no diario com o Git diff real.
- Confirmar se o diff pertence ao mesmo modulo/frente.
- Ignorar registros ja marcados como EM PRODUCAO, salvo se houver novo diff local relacionado.

Protocolo de deploy:
- Usar o pacote homologado pelo agente do modulo no padrao DP-0001 ou equivalente.
- O DP deve agrupar todos os protocolos AT-*, CB-*, TI-*, OP-* e AL-* incluidos no modulo.
- O DP deve ter homologacao registrada antes de producao.
- O commit deve citar o DP no titulo e os protocolos incluidos no corpo.
- Exemplo de commit: feat(zeus): publish operations center updates [DP-0007].

Regras de release:
- Nao usar deploy geral se houver mais de um recorte misturado.
- Nao usar stage amplo de arquivos sem revisar o escopo.
- Nao misturar Hades, Hermes, Iris, Setup ou Zeus no mesmo commit/deploy sem autorizacao explicita do diario.
- Nao publicar arquivos que nao estejam relacionados ao recorte aprovado.
- Nao expor secrets, tokens, chaves ou valores sensiveis.
- Nao chamar checks pesados como Hades queue limit=1000 automaticamente.
- Se houver duvida de escopo, bloquear com motivo tecnico concreto.

Quando publicar:
- Somente se o recorte tiver status PRONTO PARA PRODUCAO, HOMOLOGADO ou AGUARDANDO PRODUCAO.
- Somente se os arquivos do Git baterem com o recorte do diario.
- Somente se as validacoes minimas e a homologacao registrada estiverem coerentes.
- Criar ou selecionar commit semantico por modulo.
- Fazer deploy Vercel Production apenas depois do commit coerente e autorizacao do Lucas.
- Executar healthchecks pos-deploy.
- Atualizar o Engineering Operations com commit, deployment, healthchecks, riscos, pendencias e status final.

Quando bloquear:
- Recorte sem modulo/frente claro.
- Arquivos alterados nao batem com o diario.
- Diffs de varios modulos misturados sem autorizacao.
- Validacao obrigatoria falhando.
- Risco de secret exposto.
- Dependencia de validacao visual/autenticada ainda pendente e essencial.
- Status no diario diferente de PRONTO PARA PRODUCAO, HOMOLOGADO ou AGUARDANDO PRODUCAO.

Saida esperada antes de agir:
- Recortes encontrados no diario.
- Recorte selecionado para deploy.
- Arquivos incluidos.
- Arquivos excluidos por pertencerem a outro recorte.
- Validacoes que serao executadas.
- Riscos ou pendencias.
- Decisao: PUBLICAR, SEPARAR ou BLOQUEAR.

Se a decisao for PUBLICAR:
- Executar commit semantico do recorte.
- Executar deploy.
- Rodar healthchecks pos-deploy.
- Registrar resultado no Engineering Operations.

Formato esperado da resposta:
- Recortes encontrados
- Recorte selecionado
- Coerencia diario x Git
- Arquivos incluidos
- Arquivos separados ou bloqueados
- Validacoes executadas
- Commit realizado, se houver
- Deploy realizado, se houver
- Protocolo DP, ambiente e protocolos AT/CB/TI/OP/AL incluidos
- Homologacao executada ou pendente
- Healthchecks executados
- Riscos ou pendencias
- Status final

Status esperado:
EM HOMOLOGACAO quando estiver aguardando validacao; EM PRODUCAO quando publicado; BLOQUEADO quando houver risco real; AGUARDANDO RECORTE quando o diario/Git nao permitirem separar o deploy com seguranca.`,
  },
  {
    id: "daily-activity",
    label: "Atividade diaria",
    description: "Comando preenchido para consolidar o dia operacional atual.",
    target: "Zeus Core",
    type: "daily",
    body: `Assunto:
[Zeus] Atividade diaria do Panteon

Dev responsavel, solicito consolidar a leitura operacional diaria do Panteon.

Este pedido NAO e um template com placeholders. Use os registros reais do Engineering Operations e, para estado atual de banco/APIs, use o Database Monitoring.

Periodo analisado:
- Data: 17/05/2026.
- Fonte historica: docs/operations/engineering-operations.md.
- Fonte de estado atual: Database Monitoring / APIs reais / healthchecks.
- Modulos relevantes: Zeus, Hades, Hermes, Iris e Hefesto quando houver registro no diario.

Objetivo:
- Consolidar o que foi implementado, corrigido, validado ou bloqueado no dia.
- Separar entregas por modulo/frente.
- Identificar riscos, pendencias e proximas squads.
- Nao alterar codigo, nao fazer deploy e nao executar comandos destrutivos.

Foco da leitura:
- Zeus / Operations Center: Database Monitoring, Ops Watcher, PO AI, prompts, layout, sidebar e acesso adm.
- Hefesto: itens aguardando publicacao, recortes que precisam de commit/deploy e healthchecks esperados.
- Zeus: gargalos, falhas locais, riscos de build, APIs, banco, infraestrutura ou performance.
- Hades/Hermes/Iris: citar somente o que estiver registrado no diario ou nos checks reais.

Regras:
- Se um dado nao estiver no diario ou no monitoramento, escrever "nao informado".
- Para banco, APIs, payload e tempo de resposta, priorizar o snapshot real do monitoring.
- Nao misturar recortes de deploy sem indicar claramente a frente responsavel.

Formato esperado da resposta:
- Resumo executivo do dia.
- Entregas por modulo.
- Riscos e gargalos.
- Pendencias para continuidade.
- Proxima squad recomendada.
- Status operacional final.

Status esperado:
AGUARDANDO RELEASEOPS quando houver entrega local pendente de publicacao; FINALIZADO apenas se for leitura sem acao pendente.`,
  },
  {
    id: "weekly-activity",
    label: "Atividade semanal",
    description:
      "Comando preenchido para Zeus consolidar a semana operacional.",
    target: "Zeus",
    type: "weekly",
    body: `Assunto:
[Zeus] Consolidado semanal do Panteon

Zeus, solicito consolidar a atividade semanal da engenharia do Panteon.

Este pedido NAO e um template com placeholders. A semana e o escopo ja estao definidos.
Agente executor: Zeus.

Periodo analisado:
- Semana: 11/05/2026 a 17/05/2026.
- Fonte historica: docs/operations/engineering-operations.md.
- Fonte de estado atual: Database Monitoring / APIs reais / healthchecks.
- Objetivo: identificar entregas, riscos, gargalos e proximos passos.

Frentes obrigatorias:
- Hades: consolidar apenas registros e riscos presentes no diario.
- Iris: apontar estado atual e lacunas registradas.
- Hermes: consolidar correcoes, validacoes pendentes e riscos de realtime/chamadas.
- Zeus: consolidar Operations Center, Database Monitoring, Ops Watcher, PO AI, prompts e UX.
- Zeus: consolidar gargalos, troubleshooting, EADDRINUSE, build errors, APIs, banco, infraestrutura e performance.
- Hefesto: consolidar itens aguardando publicacao, commits/deploys e healthchecks.

Riscos a observar:
- Recortes locais aguardando Hefesto podem se misturar se nao houver stage/commit por responsabilidade.
- Hades queue limit=1000 nao deve ser chamado automaticamente.
- Validacoes visuais autenticadas ainda dependem de Lucas quando o diario indicar pendencia.
- Warning Turbopack/NFT da leitura filesystem do Engineering Operations segue conhecido.

Regras:
- Para estado atual de banco, APIs, payload e tempo, usar Database Monitoring.
- Para historico, decisoes e rastreabilidade, usar Engineering Operations.
- Se nao houver evidencia, responder "nao informado".
- Nao executar deploy, commit ou comando; apenas consolidar e orientar.

Recomendacao esperada:
- Prioridade 1: separar/publicar recortes Zeus que ja estao AGUARDANDO RELEASEOPS.
- Prioridade 2: acompanhar riscos tecnicos de build, realtime e payload.
- Prioridade 3: reforcar governanca de prompts, healthchecks e registros operacionais.

Formato esperado da resposta:
- Resumo executivo semanal
- Entregas por modulo
- Riscos e gargalos
- Decisoes relevantes
- Proximas prioridades
- Criticidade operacional

Status esperado:
AGUARDANDO RELEASEOPS se houver recorte local pendente; OPERACIONAL COM ATENCAO se a semana tiver riscos sem bloqueio.`,
  },
  {
    id: "supportops-technical-monitoring",
    label: "Monitoramento tecnico",
    description: "Acompanhamento Zeus dos riscos tecnicos.",
    target: "Zeus",
    type: "monitoring",
    body: `Assunto:
[Zeus] Monitoramento tecnico

Zeus, manter acompanhamento dos riscos tecnicos da semana.

Este pedido NAO e um template com placeholders. O escopo de monitoramento ja esta definido.
Agente executor: Zeus.

Fonte historica:
- docs/operations/engineering-operations.md.

Fonte de estado atual:
- Database Monitoring / APIs reais / healthchecks do Operations Center.

Itens em acompanhamento:
- Warning Turbopack/NFT da rota que le Engineering Operations.
- Possivel recorrencia de porta 3001 ocupada no dev local.
- Build errors em Zeus.
- APIs e payload do Operations Center.

Regras:
- Nao executar deploy, commit ou alteracao de codigo.
- Nao chamar Hades queue limit=1000 automaticamente.
- Usar monitoramento real para banco, APIs, payload, tempo de resposta e healthchecks.
- Usar Engineering Operations apenas como historico, rastreabilidade e memoria operacional.
- Se nao houver evidencia atual, responder "nao informado".

Quando informar Lucas:
- Se warning virar erro de build.
- Se porta 3001 voltar a bloquear o dev local.
- Se API protegida responder 200 sem bearer.
- Se payload entrar em nivel pesado ou critico.
- Se qualquer item virar bloqueio operacional.

Formato esperado da resposta:
- Estado atual dos riscos.
- Evidencias observadas.
- Impacto operacional.
- Recomendacao tecnica.
- Agente recomendado, se houver bloqueio.
- Status final.

Status esperado:
OPERACIONAL COM ATENCAO quando houver risco sem bloqueio; BLOQUEADO se algum item impedir desenvolvimento, validacao ou release.`,
  },
  {
    id: "monthly-activity",
    label: "Atividade mensal",
    description: "Comando preenchido para fechamento mensal parcial.",
    target: "Zeus Core",
    type: "monthly",
    body: `Assunto:
[Zeus] Fechamento mensal do Panteon

Dev responsavel, solicito preparar o fechamento mensal operacional da engenharia do Panteon.

Este pedido NAO e um template com placeholders. O fechamento e parcial do mes corrente.

Periodo analisado:
- Mes: maio/2026, acumulado ate 17/05/2026.
- Fonte historica: docs/operations/engineering-operations.md.
- Fonte de estado atual: Database Monitoring / APIs reais / healthchecks.
- Objetivo: consolidar entregas, estabilidade, riscos e prioridades.

Temas principais:
- Evolucao do Zeus para Operations Center.
- Implantacao de Database Monitoring, Ops Watcher e PO AI orientado por monitoramento real.
- Ajustes de governanca Hefesto e rastreabilidade no Engineering Operations.
- Pendencias tecnicas e operacionais em Hades, Hermes, Iris, Zeus e build quando registradas.

Entregas e evolucoes:
- Hades: consolidar estado, pendencias D4Sign/fila/performance e riscos somente com evidencia registrada.
- Iris: registrar estado atual e lacunas de evolucao real quando constarem no diario.
- Hermes: consolidar realtime/chamadas, queries, experiencia de conversa e validacoes pendentes.
- Zeus: consolidar Operations Center, Database Monitoring, PO AI, prompts, UX e acesso adm.
- Zeus/Hefesto: consolidar troubleshooting, releases, deploys, healthchecks e bloqueios.

Estabilidade operacional:
- Bugs relevantes: levantar do Engineering Operations.
- Incidentes ou lentidao: cruzar diario com Database Monitoring.
- APIs/integracoes afetadas: citar endpoints e healthchecks reais quando disponiveis.
- Regressao identificada: responder apenas com evidencia; caso contrario, "nao informado".

Riscos para o proximo ciclo:
- Mistura de recortes locais se Hefesto nao separar commits por frente.
- Validacoes visuais autenticadas pendentes.
- Risco de payload/performance em filas se limites seguros forem ignorados.
- Warning Turbopack/NFT e pendencias tecnicas de build/auditoria devem ser acompanhados.

Prioridades recomendadas:
- Publicar recortes Zeus ja validados e AGUARDANDO RELEASEOPS.
- Consolidar monitoramento real como fonte primaria de estado operacional.
- Resolver pendencias de Hefesto/Zeus antes de ampliar automacoes.
- Manter o Engineering Operations como historico, auditoria e memoria viva.

Formato esperado da resposta:
- Problemas identificados
- Origem
- Impacto operacional
- Recomendacao tecnica
- Criticidade
- Status executivo do mes

Status esperado:
OPERACIONAL COM ATENCAO se houver pendencias abertas; AGUARDANDO RELEASEOPS quando houver recortes locais prontos para publicacao.`,
  },
];

const zeusViews = [
  { id: "itTickets", label: "HelpDesk" },
  { id: "health", label: "Monitoring" },
  { id: "deploys", label: "Deploys" },
] as const satisfies readonly { id: ZeusView; label: string }[];

export function ZeusPage({
  standalone = false,
}: {
  standalone?: boolean;
} = {}) {
  const { authState, hubUser, profileStatus, signOut } = useAuth();
  const canAccessZeus = canAccessZeusAsAdmin(hubUser);
  const authAccessToken = authState.session?.accessToken ?? null;
  const [resolvedAccessToken, setResolvedAccessToken] = useState<string | null>(
    null,
  );
  const zeusAccessToken = authAccessToken ?? resolvedAccessToken;
  const operationsFileInputRef = useRef<HTMLInputElement | null>(null);
  const [operations, setOperations] =
    useState<EngineeringOperationsResponse | null>(null);
  const [structuredOperations, setStructuredOperations] =
    useState<EngineeringOperationsResponse | null>(null);
  const [releaseRegisters, setReleaseRegisters] =
    useState<ReleaseRegistersApiResponse | null>(null);
  const [releaseRegistersError, setReleaseRegistersError] = useState<
    string | null
  >(null);
  const [operationsSource, setOperationsSource] =
    useState<OperationsSourceState>(initialOperationsSourceState);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncingOperations, setIsSyncingOperations] = useState(false);
  const [isImportingOperationsFile, setIsImportingOperationsFile] =
    useState(false);
  const [isCreatingOperationRecord, setIsCreatingOperationRecord] =
    useState(false);
  const [isOperationRecordModalOpen, setIsOperationRecordModalOpen] =
    useState(false);
  const [operationRecordForm, setOperationRecordForm] =
    useState<OperationRecordFormState>(initialOperationRecordForm);
  const [operationRecordFormError, setOperationRecordFormError] = useState<
    string | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<OperationsFilters>(initialFilters);
  const [selectedRecord, setSelectedRecord] =
    useState<EngineeringOperationRecord | null>(null);
  const [selectedRoutine, setSelectedRoutine] =
    useState<EngineeringAuditRoutine | null>(null);
  const [copilotQuestion, setCopilotQuestion] = useState("");
  const [poAiMessages, setPoAiMessages] = useState<PoAiChatMessage[]>(() => [
    createPoAiMessage(
      "assistant",
      "Sou o PO AI, o cérebro operacional do Panteon. Para banco, performance e estabilidade eu priorizo o monitoramento real; o diário fica como histórico e rastreabilidade. Não executo comandos nem exponho segredos.",
    ),
  ]);
  const [copilotError, setCopilotError] = useState<string | null>(null);
  const [isCopilotLoading, setIsCopilotLoading] = useState(false);
  const [isPoAiOpen, setIsPoAiOpen] = useState(false);
  const [promptTarget, setPromptTarget] =
    useState<PromptTarget>("Hefesto");
  const [isPromptLibraryOpen, setIsPromptLibraryOpen] = useState(false);
  const [selectedPromptTemplateId, setSelectedPromptTemplateId] = useState(
    promptTemplates[0]!.id,
  );
  const [activeView, setActiveView] = useState<ZeusView>("itTickets");
  const [monitoringSnapshot, setMonitoringSnapshot] =
    useState<OperationsMonitoringSnapshot | null>(null);
  const [monitoringHistory, setMonitoringHistory] = useState<
    OperationsCheckMetric[]
  >([]);
  const [monitoringError, setMonitoringError] = useState<string | null>(null);
  const [isMonitoringLoading, setIsMonitoringLoading] = useState(false);
  const [monitoringIntervalMs, setMonitoringIntervalMs] =
    useState<MonitoringIntervalMs>(30_000);
  const [watcherDecision, setWatcherDecision] =
    useState<OpsWatcherDecision | null>(null);
  const [watcherNotifications, setWatcherNotifications] = useState<
    OpsWatcherDecision[]
  >([]);
  const [alertProtocols, setAlertProtocols] = useState<
    OperationsAlertProtocolSummary[]
  >(() => readLocalAlertProtocolOverrides());
  const [selectedAlertProtocol, setSelectedAlertProtocol] =
    useState<OperationsAlertProtocolSummary | null>(null);
  const [itTicketCount, setItTicketCount] = useState(0);
  const [itTicketAttentionCount, setItTicketAttentionCount] = useState(0);
  const [addressCatalogCount, setAddressCatalogCount] = useState(0);
  const [zeusPresenceLastSeenAt, setZeusPresenceLastSeenAt] = useState<
    string | null
  >(null);
  const [zeusPresenceStatus, setZeusPresenceStatus] =
    useState<HubPresenceStatus>("online");
  const [alertFeedbackStatus, setAlertFeedbackStatus] =
    useState<OperationsAlertFeedbackStatus>("em_analise");
  const [alertFeedbackText, setAlertFeedbackText] = useState("");
  const [alertFeedbackError, setAlertFeedbackError] = useState<string | null>(
    null,
  );
  const [isAlertFeedbackSaving, setIsAlertFeedbackSaving] = useState(false);
  const [acknowledgingProtocol, setAcknowledgingProtocol] = useState<
    string | null
  >(null);
  const [ignoringProtocol, setIgnoringProtocol] = useState<string | null>(null);
  const [copiedCommandId, setCopiedCommandId] = useState<string | null>(null);
  const watcherCooldownsRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (profileStatus === "loading" || !canAccessZeus) {
      setResolvedAccessToken(null);
      return;
    }

    if (authAccessToken) {
      setResolvedAccessToken(authAccessToken);
      return;
    }

    let isActive = true;

    void getZeusAccessToken().then((accessToken) => {
      if (isActive) {
        setResolvedAccessToken(accessToken);
      }
    });

    return () => {
      isActive = false;
    };
  }, [authAccessToken, canAccessZeus, profileStatus]);

  useEffect(() => {
    if (!canAccessZeus || profileStatus === "loading" || !zeusAccessToken) {
      return;
    }

    let isMounted = true;

    const markZeusPresence = (status: HubPresenceStatus) => {
      if (!isMounted) {
        return;
      }

      const heartbeatAt = new Date().toISOString();

      setZeusPresenceLastSeenAt(heartbeatAt);

      void markHubPresence({
        metadata: {
          activeView,
          keepOnline: true,
          module: "zeus",
          surface: "operations-center",
        },
        reason: "heartbeat",
        source: "zeus-operations-center",
        status,
      })
        .then((presence) => {
          if (isMounted) {
            setZeusPresenceLastSeenAt(presence?.lastSeenAt ?? heartbeatAt);
          }
        })
        .catch(() => {
          // Presenca nao deve interromper a operacao do Zeus.
        });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        markZeusPresence(zeusPresenceStatus);
      }
    };

    markZeusPresence(zeusPresenceStatus);

    const heartbeatId = window.setInterval(
      () => markZeusPresence(zeusPresenceStatus),
      Math.max(15_000, HUB_PRESENCE_HEARTBEAT_MS - 5_000),
    );

    const handleFocus = () => markZeusPresence(zeusPresenceStatus);

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isMounted = false;
      window.clearInterval(heartbeatId);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    activeView,
    canAccessZeus,
    profileStatus,
    zeusAccessToken,
    zeusPresenceStatus,
  ]);

  const handleZeusPresenceStatusChange = useCallback(
    (nextStatus: HubPresenceStatus) => {
      setZeusPresenceStatus(nextStatus);

      if (!canAccessZeus || profileStatus !== "ready" || !zeusAccessToken) {
        return;
      }

      const heartbeatAt = new Date().toISOString();

      setZeusPresenceLastSeenAt(heartbeatAt);

      void markHubPresence({
        metadata: {
          activeView,
          keepOnline: true,
          module: "zeus",
          surface: "operations-center",
        },
        reason: "manual",
        source: "zeus-operations-center",
        status: nextStatus,
      })
        .then((presence) => {
          setZeusPresenceLastSeenAt(presence?.lastSeenAt ?? heartbeatAt);
        })
        .catch(() => {
          // Presenca nao deve interromper a operacao do Zeus.
        });
    },
    [activeView, canAccessZeus, profileStatus, zeusAccessToken],
  );

  useEffect(() => {
    if (profileStatus === "loading") {
      return;
    }

    if (!canAccessZeus) {
      setIsLoading(false);
      setError(null);
      setOperations(null);
      return;
    }

    let isActive = true;

    async function loadOperations() {
      setIsLoading(true);
      setError(null);

      try {
        const accessToken = await getZeusAccessToken(zeusAccessToken);
        const headers: Record<string, string> = {};

        if (accessToken) {
          headers.Authorization = `Bearer ${accessToken}`;
        }

        const response = await fetch("/api/zeus/operations", {
          cache: "no-store",
          headers,
        });
        const payload = (await response.json().catch(() => null)) as
          | EngineeringOperationsResponse
          | { error?: string }
          | null;

        if (!isActive) {
          return;
        }

        if (!response.ok || !isOperationsResponse(payload)) {
          const maybeError =
            payload && typeof payload === "object" && "error" in payload
              ? payload.error
              : null;
          setError(
            typeof maybeError === "string"
              ? maybeError
              : "Não foi possível carregar Zeus.",
          );
          setOperations(null);
          return;
        }

        setOperations(payload);
      } catch {
        if (isActive) {
          setError("Não foi possível conectar à API do Zeus.");
          setOperations(null);
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    void loadOperations();

    return () => {
      isActive = false;
    };
  }, [canAccessZeus, profileStatus, zeusAccessToken]);

  const loadReleaseRegisters = useCallback(async () => {
    if (!canAccessZeus || profileStatus === "loading") {
      return;
    }

    try {
      const accessToken = await getZeusAccessToken(zeusAccessToken);
      const headers: Record<string, string> = {};

      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }

      const response = await fetch("/api/zeus/release-registers", {
        cache: "no-store",
        headers,
      });
      const payload = (await response.json().catch(() => null)) as
        | ReleaseRegistersApiResponse
        | { error?: string }
        | null;

      if (!response.ok || !isReleaseRegistersResponse(payload)) {
        const maybeError =
          payload && typeof payload === "object" && "error" in payload
            ? payload.error
            : null;

        throw new Error(
          typeof maybeError === "string"
            ? maybeError
            : "Nao foi possivel carregar os registros de deploy por ambiente.",
        );
      }

      setReleaseRegisters(payload);
      setReleaseRegistersError(null);
    } catch (error) {
      setReleaseRegisters(null);
      setReleaseRegistersError(getReleaseRegistersErrorMessage(error));
    }
  }, [canAccessZeus, profileStatus, zeusAccessToken]);

  useEffect(() => {
    if (!canAccessZeus || profileStatus === "loading") {
      setReleaseRegisters(null);
      setReleaseRegistersError(null);
      return;
    }

    void loadReleaseRegisters();
  }, [canAccessZeus, loadReleaseRegisters, profileStatus]);

  const loadStructuredOperations = useCallback(async () => {
    if (!canAccessZeus || profileStatus === "loading") {
      return;
    }

    try {
      const accessToken = await getZeusAccessToken(zeusAccessToken);
      const headers: Record<string, string> = {};

      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }

      const result = await fetchStructuredOperationsSnapshot(headers);

      if (result.ok && result.records.length > 0) {
        setStructuredOperations(
          buildOperationsResponseFromStructuredRecords({
            fallback: operations,
            records: result.records,
            syncRuns: result.syncRuns,
          }),
        );
        setOperationsSource({
          description:
            "Fonte principal: tabelas Supabase estruturadas. O diario segue como memoria e fallback.",
          error: null,
          label: "Supabase estruturado",
          mode: "structured",
          recordsCount: result.records.length,
          status: result.status,
          syncRuns: result.syncRuns,
        });
        return;
      }

      setStructuredOperations(null);
      const structuredError = result.ok
        ? null
        : getStructuredOperationsFriendlyError(result.error);
      setOperationsSource({
        description:
          "Fallback ativo: diario lido porque a base estruturada esta vazia ou indisponivel.",
        error: structuredError,
        label: "Fallback Engineering Operations",
        mode: "fallback",
        recordsCount: operations?.records.length ?? 0,
        status: result.ok
          ? "estrutura vazia"
          : isStructuredOperationsMigrationMissingError(result.error)
            ? "migration pendente"
            : "indisponivel",
        syncRuns: result.ok ? result.syncRuns : [],
      });
    } catch {
      setStructuredOperations(null);
      const errorMessage = "Falha de conexao com a base estruturada.";
      setOperationsSource({
        description:
          "Falha ao consultar a base estruturada; a tela preserva o fallback do diario.",
        error: getStructuredOperationsFriendlyError(errorMessage),
        label: "Fallback Engineering Operations",
        mode: "fallback",
        recordsCount: operations?.records.length ?? 0,
        status: "indisponivel",
        syncRuns: [],
      });
    }
  }, [canAccessZeus, operations, profileStatus, zeusAccessToken]);

  useEffect(() => {
    void loadStructuredOperations();
  }, [loadStructuredOperations]);

  const loadAlertProtocols = useCallback(async () => {
    if (!canAccessZeus || profileStatus === "loading") {
      return;
    }

    try {
      const accessToken = await getZeusAccessToken(zeusAccessToken);
      const headers: Record<string, string> = {};

      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }

      const response = await fetch("/api/operations/alert-protocols?limit=60", {
        cache: "no-store",
        headers,
      });
      const payload = (await response.json().catch(() => null)) as
        | AlertProtocolsApiResponse
        | { error?: string }
        | null;

      if (
        !response.ok ||
        !payload ||
        !("protocols" in payload) ||
        !Array.isArray(payload.protocols)
      ) {
        return;
      }

      setAlertProtocols((current) =>
        mergeAlertProtocols(payload.protocols ?? [], current),
      );
    } catch {
      setAlertProtocols((current) => current);
    }
  }, [canAccessZeus, profileStatus, zeusAccessToken]);

  useEffect(() => {
    void loadAlertProtocols();
  }, [loadAlertProtocols]);

  const loadItTicketSummary = useCallback(async () => {
    if (!canAccessZeus || profileStatus === "loading") {
      return;
    }

    try {
      const tickets = await loadHubItTickets({
        accessToken: zeusAccessToken,
        details: "list",
        scope: "all",
      });

      setItTicketCount(countOpenItTickets(tickets));
      setItTicketAttentionCount(countItTicketsWaitingForZeus(tickets));
    } catch {
      setItTicketCount((current) => current);
      setItTicketAttentionCount((current) => current);
    }
  }, [canAccessZeus, profileStatus, zeusAccessToken]);

  useEffect(() => {
    void loadItTicketSummary();
  }, [loadItTicketSummary]);

  useEffect(() => {
    if (!canAccessZeus || profileStatus === "loading") {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      void loadItTicketSummary();
    }, 60_000);

    return () => window.clearInterval(intervalId);
  }, [canAccessZeus, loadItTicketSummary, profileStatus]);

  const registerWatcherDecision = useCallback(
    (decision: OpsWatcherDecision) => {
      setWatcherDecision(decision);

      if (!decision.notifyLucas) {
        return;
      }

      const now = Date.now();
      const lastNotifiedAt =
        watcherCooldownsRef.current[decision.dedupeKey] ?? 0;

      if (now - lastNotifiedAt < decision.cooldownSeconds * 1000) {
        return;
      }

      watcherCooldownsRef.current[decision.dedupeKey] = now;
      setWatcherNotifications((current) => [decision, ...current].slice(0, 12));
    },
    [],
  );

  const runOpsWatcher = useCallback(
    async (snapshot: OperationsMonitoringSnapshot) => {
      const accessToken = await getZeusAccessToken(zeusAccessToken);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }

      const response = await fetch("/api/operations/watcher", {
        body: JSON.stringify({ snapshot }),
        cache: "no-store",
        headers,
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as
        | WatcherApiResponse
        | { error?: string }
        | null;

      if (
        !response.ok ||
        !payload ||
        !("watcher" in payload) ||
        !payload.watcher
      ) {
        const message =
          payload && "error" in payload && typeof payload.error === "string"
            ? payload.error
            : "Nao foi possivel analisar o Ops Watcher.";
        throw new Error(message);
      }

      registerWatcherDecision(payload.watcher);
    },
    [registerWatcherDecision, zeusAccessToken],
  );

  const loadMonitoringSnapshot = useCallback(
    async ({ analyze = false }: { analyze?: boolean } = {}) => {
      if (!canAccessZeus || profileStatus === "loading") {
        return;
      }

      setIsMonitoringLoading(true);
      setMonitoringError(null);

      try {
        const accessToken = await getZeusAccessToken(zeusAccessToken);
        const headers: Record<string, string> = {};

        if (accessToken) {
          headers.Authorization = `Bearer ${accessToken}`;
        }

        const response = await fetch("/api/operations/monitoring", {
          cache: "no-store",
          headers,
        });
        const payload = (await response.json().catch(() => null)) as
          | OperationsMonitoringSnapshot
          | { error?: string }
          | null;

        if (!response.ok || !isMonitoringSnapshot(payload)) {
          const message =
            payload && "error" in payload && typeof payload.error === "string"
              ? payload.error
              : "Nao foi possivel carregar Database Monitoring.";
          throw new Error(message);
        }

        setMonitoringSnapshot(payload);
        setAlertProtocols((current) =>
          mergeAlertProtocols(payload.alertProtocols ?? [], current),
        );
        setMonitoringHistory((current) =>
          [...payload.checks, ...current].slice(0, 120),
        );

        if (
          analyze ||
          payload.alerts.some(
            (alert) => alert.level === "alto" || alert.level === "critico",
          )
        ) {
          await runOpsWatcher(payload);
        }
      } catch (monitoringLoadError) {
        setMonitoringError(
          monitoringLoadError instanceof Error
            ? monitoringLoadError.message
            : "Nao foi possivel carregar Database Monitoring.",
        );
      } finally {
        setIsMonitoringLoading(false);
      }
    },
    [canAccessZeus, profileStatus, runOpsWatcher, zeusAccessToken],
  );

  useEffect(() => {
    if (
      !canAccessZeus ||
      profileStatus === "loading" ||
      (activeView !== "monitoring" && activeView !== "health")
    ) {
      return;
    }

    void loadMonitoringSnapshot({ analyze: true });
  }, [activeView, canAccessZeus, loadMonitoringSnapshot, profileStatus]);

  useEffect(() => {
    if (
      !canAccessZeus ||
      profileStatus === "loading" ||
      (activeView !== "monitoring" && activeView !== "health") ||
      monitoringIntervalMs === 0
    ) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadMonitoringSnapshot();
    }, monitoringIntervalMs);

    return () => window.clearInterval(interval);
  }, [
    activeView,
    canAccessZeus,
    loadMonitoringSnapshot,
    monitoringIntervalMs,
    profileStatus,
  ]);

  const handleAddressCatalogSummaryChange = useCallback(
    (summary: { totalAddresses: number } | null) => {
      setAddressCatalogCount(summary?.totalAddresses ?? 0);
    },
    [],
  );

  const activeOperations = structuredOperations ?? operations;
  const records = useMemo(
    () => activeOperations?.records ?? [],
    [activeOperations],
  );
  const auditRoutines = useMemo(
    () => activeOperations?.auditRoutines ?? [],
    [activeOperations],
  );
  const filteredRecords = useMemo(
    () => records.filter((record) => matchesFilters(record, filters)),
    [filters, records],
  );
  const allReleaseRecords =
    activeOperations?.releaseRecords ??
    records.filter((record) => record.isRelease);
  const releaseRegisterRecords = releaseRegisters?.records ?? [];
  const deployRecords =
    releaseRegisterRecords.length > 0 ? releaseRegisterRecords : allReleaseRecords;
  const deployFilterOptions =
    releaseRegisterRecords.length > 0
      ? releaseRegisters?.filters
      : activeOperations?.filters;
  const latestDeploys = allReleaseRecords
    .filter((record) => record.deploy !== UNKNOWN_OPERATION_VALUE)
    .slice(0, 5);
  const supportInvestigations = records
    .filter((record) => record.isSupportInvestigation)
    .slice(0, 5);
  const moduleImprovements = records
    .filter((record) => record.isModuleImprovement)
    .slice(0, 5);
  const criticalRecords = (activeOperations?.criticalRecords ?? records)
    .filter((record) => record.isCritical)
    .slice(0, 6);
  const releaseRecords = allReleaseRecords.slice(0, 6);
  const overdueRoutines = auditRoutines.filter((routine) => routine.isOverdue);
  const latestRecord = records[0] ?? null;
  const visibleMonitoringAlertCount = (monitoringSnapshot?.alerts ?? []).filter(
    (alert) => !isProtocolCleared(alert.protocol, alertProtocols),
  ).length;
  const actionCount = criticalRecords.length + overdueRoutines.length;
  const nextSquad =
    criticalRecords[0]?.nextSquad ??
    releaseRecords[0]?.nextSquad ??
    latestRecord?.nextSquad ??
    "Hefesto";
  const selectedPromptTemplate =
    promptTemplates.find(
      (template) => template.id === selectedPromptTemplateId,
    ) ?? promptTemplates[0]!;

  if (profileStatus === "loading" && !canAccessZeus) {
    return (
      <ZeusAccessState
        description="Carregando perfil operacional para validar permissao adm."
        standalone={standalone}
        title="Preparando Zeus"
      />
    );
  }

  if (!canAccessZeus) {
    return (
      <ZeusAccessState
        description="Zeus e o Operations Center da engenharia IA e fica liberado somente para perfil adm."
        standalone={standalone}
        title="Acesso restrito"
      />
    );
  }

  async function askCopilot(question: string, target?: string | null) {
    const normalizedQuestion = question.trim();

    if (!normalizedQuestion && !target) {
      setCopilotError("Informe uma pergunta para o PO AI.");
      return;
    }

    const userMessage = createPoAiMessage("user", normalizedQuestion);
    const nextMessages = [...poAiMessages, userMessage];

    setPoAiMessages(nextMessages);
    setCopilotQuestion("");
    setIsCopilotLoading(true);
    setCopilotError(null);

    try {
      const accessToken = await getZeusAccessToken(zeusAccessToken);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }

      const response = await fetch("/api/zeus/copilot", {
        body: JSON.stringify({
          messages: nextMessages.map(({ content, role }) => ({
            content,
            role,
          })),
          promptTarget: target ?? null,
          question: normalizedQuestion,
        }),
        cache: "no-store",
        headers,
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as {
        answer?: string;
        error?: string;
      } | null;

      if (!response.ok || !payload?.answer) {
        throw new Error(payload?.error ?? "PO AI não respondeu.");
      }

      setPoAiMessages([
        ...nextMessages,
        createPoAiMessage("assistant", payload.answer),
      ]);
    } catch (error) {
      setCopilotError(
        error instanceof Error
          ? getPoAiErrorMessage(error)
          : "Não foi possível consultar o PO AI.",
      );
    } finally {
      setIsCopilotLoading(false);
    }
  }

  function openAlertProtocol(protocol: OperationsAlertProtocolSummary) {
    setSelectedAlertProtocol(protocol);
    setAlertFeedbackStatus(
      protocol.technicalFeedbackStatus === "pendente"
        ? "em_analise"
        : protocol.technicalFeedbackStatus,
    );
    setAlertFeedbackText(protocol.technicalFeedback ?? "");
    setAlertFeedbackError(null);
  }

  function openAlertProtocolFromCode(protocolCode?: string) {
    if (!protocolCode) {
      return;
    }

    const protocol =
      alertProtocols.find((item) => item.protocol === protocolCode) ??
      monitoringSnapshot?.alerts
        .map(alertToProtocolSummary)
        .find((item) => item.protocol === protocolCode);

    if (protocol) {
      openAlertProtocol(protocol);
    }
  }

  function applyAlertProtocolUpdate(protocol: OperationsAlertProtocolSummary) {
    setAlertProtocols((current) => mergeAlertProtocols([protocol], current));
    setSelectedAlertProtocol((current) =>
      current?.protocol === protocol.protocol ? protocol : current,
    );
    setMonitoringSnapshot((current) =>
      current
        ? {
            ...current,
            alertProtocols: mergeAlertProtocols(
              [protocol],
              current.alertProtocols ?? [],
            ),
            alerts: current.alerts.map((alert) =>
              alert.protocol === protocol.protocol
                ? mergeProtocolIntoAlert(alert, protocol)
                : alert,
            ),
          }
        : current,
    );
    setWatcherNotifications((current) =>
      shouldHideProtocolAlert(protocol)
        ? current.filter(
            (notification) => notification.protocol !== protocol.protocol,
          )
        : current.map((notification) =>
            notification.protocol === protocol.protocol
              ? {
                  ...notification,
                  command: protocol.command,
                }
              : notification,
          ),
    );
    setWatcherDecision((current) =>
      current?.protocol === protocol.protocol && shouldHideProtocolAlert(protocol)
        ? {
            ...current,
            notifyLucas: false,
            reason:
              protocol.status === "silenciado"
                ? "Alerta ignorado por Lucas."
                : "Leitura confirmada por Lucas.",
            status: "silencioso",
          }
        : current,
    );
  }

  function applyLocalAlertProtocolUpdate(
    protocolCode: string,
    status: "monitorando" | "silenciado",
  ) {
    const protocol = createLocalAlertProtocolOverride({
      protocol:
        alertProtocols.find((item) => item.protocol === protocolCode) ??
        monitoringSnapshot?.alerts
          .map(alertToProtocolSummary)
          .find((item) => item.protocol === protocolCode),
      status,
    });

    if (!protocol) {
      return false;
    }

    saveLocalAlertProtocolOverride(protocol);
    applyAlertProtocolUpdate(protocol);
    setMonitoringError(null);

    return true;
  }

  async function saveAlertFeedback() {
    if (!selectedAlertProtocol) {
      return;
    }

    if (!alertFeedbackText.trim()) {
      setAlertFeedbackError("Cole ou escreva a devolutiva tecnica do dev.");
      return;
    }

    setIsAlertFeedbackSaving(true);
    setAlertFeedbackError(null);

    try {
      const accessToken = await getZeusAccessToken(zeusAccessToken);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }

      const response = await fetch("/api/operations/alert-protocols", {
        body: JSON.stringify({
          feedback: alertFeedbackText,
          protocol: selectedAlertProtocol.protocol,
          status: alertFeedbackStatus,
        }),
        cache: "no-store",
        headers,
        method: "PATCH",
      });
      const payload = (await response
        .json()
        .catch(() => null)) as AlertFeedbackApiResponse | null;

      if (!response.ok || !payload?.protocol) {
        throw new Error(
          payload?.error ?? "Nao foi possivel registrar a devolutiva tecnica.",
        );
      }

      applyAlertProtocolUpdate(payload.protocol);
      setSelectedAlertProtocol(payload.protocol);
      setAlertFeedbackText(payload.protocol.technicalFeedback ?? "");
    } catch (error) {
      setAlertFeedbackError(getAlertProtocolActionErrorMessage(error));
    } finally {
      setIsAlertFeedbackSaving(false);
    }
  }

  async function acknowledgeAlertProtocol(protocolCode?: string) {
    if (!protocolCode) {
      return;
    }

    setAcknowledgingProtocol(protocolCode);

    try {
      const accessToken = await getZeusAccessToken(zeusAccessToken);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }

      const response = await fetch("/api/operations/alert-protocols", {
        body: JSON.stringify({
          action: "acknowledge",
          protocol: protocolCode,
        }),
        cache: "no-store",
        headers,
        method: "PATCH",
      });
      const payload = (await response
        .json()
        .catch(() => null)) as AlertFeedbackApiResponse | null;

      if (!response.ok || !payload?.protocol) {
        throw new Error(
          payload?.error ?? "Nao foi possivel confirmar leitura do alerta.",
        );
      }

      applyAlertProtocolUpdate(payload.protocol);
    } catch (error) {
      if (
        error instanceof Error &&
        isAlertProtocolSchemaMissingError(error.message) &&
        applyLocalAlertProtocolUpdate(protocolCode, "monitorando")
      ) {
        return;
      }

      setMonitoringError(getAlertProtocolActionErrorMessage(error));
    } finally {
      setAcknowledgingProtocol(null);
    }
  }

  async function ignoreAlertProtocol(protocolCode?: string) {
    if (!protocolCode) {
      return;
    }

    setIgnoringProtocol(protocolCode);

    try {
      const accessToken = await getZeusAccessToken(zeusAccessToken);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }

      const response = await fetch("/api/operations/alert-protocols", {
        body: JSON.stringify({
          action: "ignore",
          protocol: protocolCode,
        }),
        cache: "no-store",
        headers,
        method: "PATCH",
      });
      const payload = (await response
        .json()
        .catch(() => null)) as AlertFeedbackApiResponse | null;

      if (!response.ok || !payload?.protocol) {
        throw new Error(payload?.error ?? "Nao foi possivel ignorar o alerta.");
      }

      applyAlertProtocolUpdate(payload.protocol);
    } catch (error) {
      if (
        error instanceof Error &&
        isAlertProtocolSchemaMissingError(error.message) &&
        applyLocalAlertProtocolUpdate(protocolCode, "silenciado")
      ) {
        return;
      }

      setMonitoringError(getAlertProtocolActionErrorMessage(error));
    } finally {
      setIgnoringProtocol(null);
    }
  }

  async function copyAgentCommand(command: string, id: string) {
    await navigator.clipboard.writeText(command);
    setCopiedCommandId(id);
    window.setTimeout(() => {
      setCopiedCommandId((currentId) => (currentId === id ? null : currentId));
    }, 1800);
  }

  async function syncStructuredOperations() {
    setIsSyncingOperations(true);
    setError(null);

    try {
      const accessToken = await getZeusAccessToken(zeusAccessToken);
      const headers: Record<string, string> = {};

      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }

      const response = await fetch("/api/zeus/operations/structured", {
        cache: "no-store",
        headers,
        method: "POST",
      });
      const payload = (await response
        .json()
        .catch(() => null)) as StructuredOperationsApiResponse | null;

      if (!response.ok) {
        throw new Error(
          payload?.error ?? "Nao foi possivel sincronizar para o Supabase.",
        );
      }

      await loadStructuredOperations();
    } catch (syncError) {
      const syncErrorMessage =
        syncError instanceof Error
          ? syncError.message
          : "Nao foi possivel sincronizar para o Supabase.";
      setOperationsSource((current) => ({
        ...current,
        description:
          "A sincronizacao precisa da migration estruturada aplicada no Supabase real. O fallback pelo diario continua ativo.",
        error: getStructuredOperationsFriendlyError(syncErrorMessage),
        status: isStructuredOperationsMigrationMissingError(syncErrorMessage)
          ? "migration pendente"
          : "sync indisponivel",
      }));
    } finally {
      setIsSyncingOperations(false);
    }
  }

  async function importLocalOperationsFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";

    if (!file) {
      return;
    }

    setIsImportingOperationsFile(true);
    setError(null);

    try {
      const content = await file.text();
      const accessToken = await getZeusAccessToken(zeusAccessToken);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }

      const response = await fetch("/api/zeus/operations/structured", {
        body: JSON.stringify({
          action: "sync-markdown-content",
          content,
          sourcePath: "docs/operations/engineering-operations.md",
        }),
        cache: "no-store",
        headers,
        method: "POST",
      });
      const payload = (await response
        .json()
        .catch(() => null)) as StructuredOperationsApiResponse | null;

      if (!response.ok) {
        throw new Error(
          payload?.error ?? "Nao foi possivel importar o diario local.",
        );
      }

      await loadStructuredOperations();
    } catch (importError) {
      const importErrorMessage =
        importError instanceof Error
          ? importError.message
          : "Nao foi possivel importar o diario local.";

      setOperationsSource((current) => ({
        ...current,
        error: getStructuredOperationsFriendlyError(importErrorMessage),
        status: "importacao indisponivel",
      }));
    } finally {
      setIsImportingOperationsFile(false);
    }
  }

  async function createOperationRecord() {
    const subject = operationRecordForm.subject.trim();

    if (!subject) {
      setOperationRecordFormError("Informe o titulo do registro.");
      return;
    }

    setIsCreatingOperationRecord(true);
    setOperationRecordFormError(null);

    try {
      const accessToken = await getZeusAccessToken(zeusAccessToken);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }

      const response = await fetch("/api/zeus/operations/structured", {
        body: JSON.stringify({
          action: "create-record",
          record: operationRecordForm,
        }),
        cache: "no-store",
        headers,
        method: "POST",
      });
      const payload = (await response
        .json()
        .catch(() => null)) as StructuredOperationsApiResponse | null;

      if (!response.ok) {
        throw new Error(
          payload?.error ?? "Nao foi possivel registrar a operacao.",
        );
      }

      setOperationRecordForm(initialOperationRecordForm);
      setIsOperationRecordModalOpen(false);
      setActiveView("timeline");
      await loadStructuredOperations();
    } catch (createError) {
      setOperationRecordFormError(
        createError instanceof Error
          ? createError.message
          : "Nao foi possivel registrar a operacao.",
      );
    } finally {
      setIsCreatingOperationRecord(false);
    }
  }

  function updateOperationRecordForm<Key extends keyof OperationRecordFormState>(
    key: Key,
    value: OperationRecordFormState[Key],
  ) {
    setOperationRecordForm((currentForm) => ({
      ...currentForm,
      [key]: value,
      ...(key === "needsDeploy"
        ? {
            status:
              value === true
                ? "AGUARDANDO RELEASEOPS"
                : currentForm.status === "AGUARDANDO RELEASEOPS"
                  ? "REGISTRADO"
                  : currentForm.status,
          }
        : {}),
    }));
  }

  const isHelpDeskView = activeView === "itTickets";

  const pageContent = (
    <>
      <WorkspaceLayout>
        {error ? (
          <Surface bordered className="border-red-100 bg-red-50 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-red-700">
              <AlertTriangle className="size-4" />
              {error}
            </div>
          </Surface>
        ) : null}

        {/* ZeusOpsPresenceBar removido: o Zeus usa o chrome PADRAO do hub
            (central de notificacao + barra do avatar do HubShell). Sem header
            proprio -> sem duplicacao. */}

        <ZeusViewTabs
          activeView={activeView}
          addressCatalogCount={addressCatalogCount}
          actionCount={actionCount}
          deployCount={deployRecords.length}
          filteredCount={filteredRecords.length}
          itTicketAttentionCount={itTicketAttentionCount}
          itTicketCount={itTicketCount}
          monitoringAlertCount={visibleMonitoringAlertCount}
          onChange={setActiveView}
          routineCount={auditRoutines.length}
        />

        {activeView === "itTickets" ? (
          <HubItTicketsBoard
            accessToken={zeusAccessToken}
            isActive={activeView === "itTickets"}
            onOpenPoAi={() => setIsPoAiOpen(true)}
            onTicketAttentionCountChange={setItTicketAttentionCount}
            onTicketCountChange={setItTicketCount}
          />
        ) : null}

        {activeView === "address" ? (
          <PanteonAddressCatalog
            accessToken={zeusAccessToken}
            isActive={activeView === "address"}
            onSummaryChange={handleAddressCatalogSummaryChange}
          />
        ) : null}

        {activeView === "overview" ? (
          <>
            <section className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)]">
              <CriticalOperationsPanel
                onSelectRecord={setSelectedRecord}
                onSelectRoutine={setSelectedRoutine}
                records={criticalRecords}
                routines={overdueRoutines}
                title="Agora precisa de atenção"
              />
              <TimelinePanel
                emptyMessage="Sem registro recente para mostrar."
                formatDateTime={formatOperationDateTime}
                getStatusVariant={statusVariant}
                limit={5}
                onSelectRecord={setSelectedRecord}
                records={records}
                title="Últimos movimentos"
              />
            </section>

            <section className="grid grid-cols-1 gap-5 xl:grid-cols-3">
              <OperationalList
                icon={<Rocket size={18} />}
                onSelectRecord={setSelectedRecord}
                records={releaseRecords}
                title="Releases e deploys"
              />
              <OperationalList
                icon={<Search size={18} />}
                onSelectRecord={setSelectedRecord}
                records={supportInvestigations}
                title="Investigações Zeus"
              />
              <OperationalList
                icon={<Sparkles size={18} />}
                onSelectRecord={setSelectedRecord}
                records={moduleImprovements}
                title="Melhorias por módulo"
              />
            </section>
          </>
        ) : null}

        {activeView === "health" ? (
          <HealthBoard
            accessToken={zeusAccessToken}
            acknowledgingProtocol={acknowledgingProtocol}
            copiedCommandId={copiedCommandId}
            generatedAt={monitoringSnapshot?.generatedAt}
            ignoringProtocol={ignoringProtocol}
            isLoading={isMonitoringLoading}
            onAcknowledgeProtocol={(protocol) =>
              void acknowledgeAlertProtocol(protocol)
            }
            onCopyCommand={(command, id) => void copyAgentCommand(command, id)}
            onIgnoreProtocol={(protocol) => void ignoreAlertProtocol(protocol)}
            onRefresh={() => void loadMonitoringSnapshot()}
            snapshot={monitoringSnapshot}
            watcher={watcherDecision}
          />
        ) : null}

        {activeView === "monitoring" ? (
          <DatabaseMonitoringView
            acknowledgingProtocol={acknowledgingProtocol}
            accessToken={zeusAccessToken}
            alertProtocols={alertProtocols}
            copiedCommandId={copiedCommandId}
            error={monitoringError}
            history={monitoringHistory}
            ignoringProtocol={ignoringProtocol}
            intervalMs={monitoringIntervalMs}
            isLoading={isMonitoringLoading}
            notifications={watcherNotifications}
            onAnalyze={() => void loadMonitoringSnapshot({ analyze: true })}
            onAcknowledgeProtocol={(protocol) =>
              void acknowledgeAlertProtocol(protocol)
            }
            onCopyCommand={(command, id) => void copyAgentCommand(command, id)}
            onIgnoreProtocol={(protocol) => void ignoreAlertProtocol(protocol)}
            onIntervalChange={setMonitoringIntervalMs}
            onOpenAlertProtocol={openAlertProtocol}
            onOpenAlertProtocolByCode={openAlertProtocolFromCode}
            onRefresh={() => void loadMonitoringSnapshot()}
            onOpenPoAi={() => setIsPoAiOpen(true)}
            snapshot={monitoringSnapshot}
            watcher={watcherDecision}
          />
        ) : null}

        {activeView === "deploys" ? <DeployView /> : null}

        {activeView === "timeline" ? (
          <>
            <OperationsFiltersBar
              filters={filters}
              options={activeOperations?.filters}
              onChange={setFilters}
            />
            <section className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.36fr)]">
              <TimelinePanel
                emptyMessage="Nenhum registro encontrado para os filtros atuais."
                formatDateTime={formatOperationDateTime}
                getStatusVariant={statusVariant}
                limit={16}
                onSelectRecord={setSelectedRecord}
                records={filteredRecords}
                title="Timeline operacional"
              />
              <div className="grid content-start gap-5">
                <CriticalOperationsPanel
                  onSelectRecord={setSelectedRecord}
                  onSelectRoutine={setSelectedRoutine}
                  records={criticalRecords}
                  routines={overdueRoutines}
                  title="Pendências críticas"
                />
                <OperationalList
                  icon={<Rocket size={18} />}
                  onSelectRecord={setSelectedRecord}
                  records={releaseRecords}
                  title="Releases e deploys"
                />
              </div>
            </section>
          </>
        ) : null}

        {activeView === "audits" ? (
          <AuditRoutinesPanel
            formatDateTime={formatOperationDateTime}
            getStatusVariant={statusVariant}
            onSelectRoutine={setSelectedRoutine}
            routines={auditRoutines}
          />
        ) : null}

        {activeView === "records" ? (
          <>
            <OperationsFiltersBar
              filters={filters}
              options={activeOperations?.filters}
              onChange={setFilters}
            />
            <section className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.36fr)]">
              <RecordsTable
                formatDateTime={formatOperationDateTime}
                getStatusVariant={statusVariant}
                records={filteredRecords.slice(0, 40)}
                onSelectRecord={setSelectedRecord}
              />

              <div className="grid content-start gap-5">
                <OperationalList
                  icon={<Search size={18} />}
                  onSelectRecord={setSelectedRecord}
                  records={supportInvestigations}
                  title="Investigações Zeus"
                />
                <OperationalList
                  icon={<ClipboardCheck size={18} />}
                  onSelectRecord={setSelectedRecord}
                  records={latestDeploys}
                  title="Últimos deploys"
                />
              </div>
            </section>
          </>
        ) : null}
      </WorkspaceLayout>

      <OperationDetailDrawer
        onClose={() => setSelectedRecord(null)}
        record={selectedRecord}
      />
      <AuditRoutineDetailDrawer
        formatDateTime={formatOperationDateTime}
        getStatusVariant={statusVariant}
        onClose={() => setSelectedRoutine(null)}
        routine={selectedRoutine}
      />
      <PoAiDrawer
        error={copilotError}
        formatDateTime={formatOperationDateTime}
        isLoading={isCopilotLoading}
        isOpen={isPoAiOpen}
        messages={poAiMessages}
        onAsk={(question) => void askCopilot(question, null)}
        onClose={() => setIsPoAiOpen(false)}
        onGeneratePrompt={() => setIsPromptLibraryOpen(true)}
        onQuestionChange={setCopilotQuestion}
        onTargetChange={setPromptTarget}
        promptTargets={promptTargets}
        question={copilotQuestion}
        target={promptTarget}
      />
      <PromptLibraryModal
        isOpen={isPromptLibraryOpen}
        onClose={() => setIsPromptLibraryOpen(false)}
        onSelectTemplate={setSelectedPromptTemplateId}
        selectedTemplate={selectedPromptTemplate}
        templates={promptTemplates}
      />
      <OperationRecordModal
        error={operationRecordFormError}
        form={operationRecordForm}
        isOpen={isOperationRecordModalOpen}
        isSaving={isCreatingOperationRecord}
        onChange={updateOperationRecordForm}
        onClose={() => setIsOperationRecordModalOpen(false)}
        onSave={() => void createOperationRecord()}
      />
      <AlertProtocolFeedbackDrawer
        error={alertFeedbackError}
        feedback={alertFeedbackText}
        isSaving={isAlertFeedbackSaving}
        onClose={() => setSelectedAlertProtocol(null)}
        onFeedbackChange={setAlertFeedbackText}
        onSave={() => void saveAlertFeedback()}
        onStatusChange={setAlertFeedbackStatus}
        protocol={selectedAlertProtocol}
        status={alertFeedbackStatus}
      />
    </>
  );

  if (standalone) {
    return (
      <main className="min-h-screen bg-slate-50 text-slate-950">
        {pageContent}
      </main>
    );
  }

  return <HubShell layoutMode="module">{pageContent}</HubShell>;
}

function AlertProtocolFeedbackDrawer({
  error,
  feedback,
  isSaving,
  onClose,
  onFeedbackChange,
  onSave,
  onStatusChange,
  protocol,
  status,
}: {
  error: string | null;
  feedback: string;
  isSaving: boolean;
  onClose: () => void;
  onFeedbackChange: (feedback: string) => void;
  onSave: () => void;
  onStatusChange: (status: OperationsAlertFeedbackStatus) => void;
  protocol: OperationsAlertProtocolSummary | null;
  status: OperationsAlertFeedbackStatus;
}) {
  if (!protocol) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50">
      <button
        aria-label="Fechar devolutiva tecnica"
        className="absolute inset-0 bg-slate-950/25 backdrop-blur-[1px]"
        onClick={onClose}
        type="button"
      />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-xl flex-col overflow-hidden border-l border-slate-200/80 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5">
          <div>
            <p className="m-0 text-xs font-semibold uppercase text-[#7A5E2C]">
              Devolutiva tecnica
            </p>
            <h2 className="m-0 mt-1 text-xl font-semibold text-slate-950">
              {protocol.protocol}
            </h2>
            <p className="m-0 mt-2 text-sm leading-6 text-slate-600">
              {protocol.title}
            </p>
          </div>
          <button
            aria-label="Fechar"
            className="inline-flex size-10 items-center justify-center rounded-lg border border-slate-200/70 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-950"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="grid gap-3 rounded-xl border border-slate-200/70 bg-slate-50/70 p-4 text-sm leading-6 text-slate-700">
            <div className="flex flex-wrap gap-2">
              <Badge variant={riskToBadgeVariant(protocol.level)}>
                {protocol.level}
              </Badge>
              <Badge variant={alertFeedbackStatusVariant(status)}>
                {alertFeedbackStatusLabel(status)}
              </Badge>
              <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-500 ring-1 ring-slate-200/70">
                {protocol.occurrenceCount} ocorrencias
              </span>
            </div>
            <p className="m-0">
              <span className="font-semibold text-slate-950">Origem: </span>
              {protocol.module} / {protocol.origin}
            </p>
            <p className="m-0">
              <span className="font-semibold text-slate-950">Impacto: </span>
              {protocol.impact}
            </p>
            <p className="m-0">
              <span className="font-semibold text-slate-950">
                Recomendacao:{" "}
              </span>
              {protocol.recommendation}
            </p>
          </div>

          <label className="mt-5 block">
            <span className="text-xs font-semibold uppercase text-slate-500">
              Status do parecer
            </span>
            <select
              className="mt-2 h-11 w-full rounded-lg border border-slate-200/80 bg-white px-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-[#A07C3B] focus:ring-2 focus:ring-[#A07C3B]/15"
              onChange={(event) =>
                onStatusChange(
                  event.target.value as OperationsAlertFeedbackStatus,
                )
              }
              value={status}
            >
              {alertFeedbackOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="mt-4 block">
            <span className="text-xs font-semibold uppercase text-slate-500">
              Parecer do dev
            </span>
            <textarea
              className="mt-2 min-h-40 w-full resize-y rounded-xl border border-slate-200/80 bg-white p-3 text-sm leading-6 text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-[#A07C3B] focus:ring-2 focus:ring-[#A07C3B]/15"
              onChange={(event) => onFeedbackChange(event.target.value)}
              placeholder="Cole aqui a devolutiva: persiste, corrigido, nao observado, bloqueio, evidencia e proxima acao."
              value={feedback}
            />
          </label>

          {error ? (
            <p className="mt-3 rounded-lg border border-red-100 bg-red-50 p-3 text-sm font-semibold text-red-700">
              {error}
            </p>
          ) : null}

          {protocol.technicalFeedbackAt ? (
            <p className="m-0 mt-4 text-xs font-semibold text-slate-500">
              Ultima devolutiva:{" "}
              {formatOperationDateTime(protocol.technicalFeedbackAt)}
            </p>
          ) : null}
        </div>

        <div className="border-t border-slate-100 p-5">
          <button
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#101820] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#1b2533] disabled:cursor-not-allowed disabled:bg-slate-400"
            disabled={isSaving}
            onClick={onSave}
            type="button"
          >
            {isSaving ? <Loader2 className="size-4 animate-spin" /> : null}
            Registrar parecer
          </button>
        </div>
      </aside>
    </div>
  );
}

function ZeusAccessState({
  description,
  standalone = false,
  title,
}: {
  description: string;
  standalone?: boolean;
  title: string;
}) {
  const content = (
    <WorkspaceLayout>
        <Surface bordered className="border-slate-200/70 bg-white p-6">
          <UixEmptyState
            description={description}
            title={title}
            visual={
              <span className="flex size-12 items-center justify-center rounded-xl bg-slate-50 text-[#A07C3B] ring-1 ring-slate-200/70">
                <ShieldAlert className="size-5" />
              </span>
            }
          />
        </Surface>
    </WorkspaceLayout>
  );

  if (standalone) {
    return (
      <main className="min-h-screen bg-slate-50 text-slate-950">
        {content}
      </main>
    );
  }

  return <HubShell layoutMode="module">{content}</HubShell>;
}

function canAccessZeusAsAdmin(user: HubUserContext | null) {
  return (
    user?.role === "admin" || user?.operationalProfile?.profileRole === "adm"
  );
}

function getPoAiErrorMessage(error: Error) {
  if (error.message === "Failed to fetch" || error.message.includes("fetch")) {
    return "Não foi possível conectar ao PO AI. Recarregue a página e tente novamente.";
  }

  return error.message;
}

function openHubModulesSidebar() {
  window.dispatchEvent(new Event("careli:toggle-module-launcher"));
}

function OperationsSourcePanel({
  isImportingLocalFile,
  isSyncing,
  onCreateRecord,
  onImportLocalFile,
  onRefresh,
  onSync,
  source,
}: {
  isImportingLocalFile: boolean;
  isSyncing: boolean;
  onCreateRecord: () => void;
  onImportLocalFile: () => void;
  onRefresh: () => void;
  onSync: () => void;
  source: OperationsSourceState;
}) {
  const latestSync = source.syncRuns[0] ?? null;
  const isStructured = source.mode === "structured";

  return (
    <section className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
      <div className="rounded-xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-[#A07C3B] ring-1 ring-slate-200/70">
              {isStructured ? (
                <Database className="size-5" />
              ) : (
                <FileText className="size-5" />
              )}
            </span>
            <div className="min-w-0">
              <p className="m-0 text-xs font-semibold uppercase text-slate-400">
                fonte operacional
              </p>
              <h2 className="m-0 mt-1 text-base font-semibold text-slate-950">
                {source.label}
              </h2>
              <p className="m-0 mt-1 text-sm leading-6 text-slate-600">
                {source.description}
              </p>
              {source.error ? (
                <p className="m-0 mt-2 text-xs font-semibold text-amber-700">
                  {source.error}
                </p>
              ) : null}
            </div>
          </div>
          <Badge variant={isStructured ? "success" : "warning"}>
            {source.status}
          </Badge>
        </div>
      </div>

      <div className="grid min-w-[18rem] gap-2 rounded-xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex items-center justify-between gap-3 text-xs font-semibold text-slate-500">
          <span>{source.recordsCount} registros</span>
          <span>
            {latestSync
              ? `ultimo sync ${formatGeneratedAt(latestSync.created_at)}`
              : "sem sync registrado"}
          </span>
        </div>
        <button
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200/70 bg-white px-3 text-sm font-semibold text-slate-700 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={onRefresh}
          type="button"
        >
          <RefreshCcw className="size-4 text-[#A07C3B]" />
          Atualizar tela
        </button>
        <button
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#101820] px-3 text-sm font-semibold text-white transition-colors hover:bg-[#1b2533]"
          onClick={onCreateRecord}
          type="button"
        >
          <Plus className="size-4" />
          Novo registro
        </button>
        <button
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200/70 bg-white px-3 text-sm font-semibold text-slate-700 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isSyncing}
          onClick={onSync}
          type="button"
        >
          <RefreshCcw
            className={`size-4 text-[#A07C3B] ${isSyncing ? "animate-spin" : ""}`}
          />
          {isSyncing ? "Sincronizando" : "Sincronizar diário"}
        </button>
        <button
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-[#A07C3B]/25 bg-[#A07C3B]/5 px-3 text-sm font-semibold text-[#7A5B24] transition-colors hover:border-[#A07C3B]/40 hover:bg-[#A07C3B]/10 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isImportingLocalFile}
          onClick={onImportLocalFile}
          type="button"
        >
          {isImportingLocalFile ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Upload className="size-4" />
          )}
          {isImportingLocalFile ? "Importando" : "Importar arquivo local"}
        </button>
      </div>
    </section>
  );
}

function OperationRecordModal({
  error,
  form,
  isOpen,
  isSaving,
  onChange,
  onClose,
  onSave,
}: {
  error: string | null;
  form: OperationRecordFormState;
  isOpen: boolean;
  isSaving: boolean;
  onChange: <Key extends keyof OperationRecordFormState>(
    key: Key,
    value: OperationRecordFormState[Key],
  ) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[80] bg-slate-950/25 p-4 backdrop-blur-[1px]">
      <button
        aria-label="Fechar novo registro operacional"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        type="button"
      />
      <form
        className="relative ml-auto flex h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.24)]"
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5">
          <div>
            <p className="m-0 text-xs font-semibold uppercase text-[#A07C3B]">
              Supabase vivo
            </p>
            <h2 className="m-0 mt-1 text-xl font-semibold text-slate-950">
              Novo registro operacional
            </h2>
              <p className="m-0 mt-2 text-sm leading-6 text-slate-600">
                Registra direto no banco. A tela atualiza pela API; deploy fica
                reservado para mudanca de codigo.
              </p>
          </div>
          <button
            aria-label="Fechar novo registro operacional"
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-slate-200/70 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-950"
            onClick={onClose}
            type="button"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-5">
          <label className="grid gap-2">
            <span className="text-xs font-semibold uppercase text-slate-500">
              Titulo
            </span>
            <input
              className="h-11 rounded-lg border border-slate-200/70 bg-white px-3 text-sm font-semibold text-slate-950 outline-none transition-colors focus:border-[#A07C3B]"
              onChange={(event) => onChange("subject", event.target.value)}
              placeholder="Ex.: [Zeus] Registro vivo no banco"
              value={form.subject}
            />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <SelectField
              label="Modulo"
              onChange={(value) => onChange("module", value)}
              options={operationModuleOptions}
              value={form.module}
            />
            <SelectField
              label="Squad"
              onChange={(value) => onChange("squad", value)}
              options={operationSquadOptions}
              value={form.squad}
            />
            <SelectField
              label="Tipo"
              onChange={(value) => onChange("type", value)}
              options={operationTypeOptions}
              value={form.type}
            />
            <SelectField
              label="Status"
              onChange={(value) => onChange("status", value)}
              options={operationStatusOptions}
              value={form.status}
            />
          </div>

          <label className="grid gap-2">
            <span className="text-xs font-semibold uppercase text-slate-500">
              Tela ou area
            </span>
            <input
              className="h-11 rounded-lg border border-slate-200/70 bg-white px-3 text-sm text-slate-950 outline-none transition-colors focus:border-[#A07C3B]"
              onChange={(event) => onChange("screen", event.target.value)}
              value={form.screen}
            />
          </label>

          <TextAreaField
            label="Motivo"
            onChange={(value) => onChange("reason", value)}
            placeholder="Por que esta acao foi registrada?"
            value={form.reason}
          />
          <TextAreaField
            label="Resumo executivo"
            onChange={(value) => onChange("macroSummary", value)}
            placeholder="O que muda para a operacao?"
            value={form.macroSummary}
          />

          <div className="grid gap-4 md:grid-cols-2">
            <TextAreaField
              label="Validacao"
              onChange={(value) => onChange("validation", value)}
              placeholder="Checks, smoke, resultado ou pendencia."
              value={form.validation}
            />
            <TextAreaField
              label="Riscos"
              onChange={(value) => onChange("risks", value)}
              placeholder="Nao informado se nao houver risco conhecido."
              value={form.risks}
            />
          </div>

          <label className="grid gap-2">
            <span className="text-xs font-semibold uppercase text-slate-500">
              Proxima squad recomendada
            </span>
            <input
              className="h-11 rounded-lg border border-slate-200/70 bg-white px-3 text-sm text-slate-950 outline-none transition-colors focus:border-[#A07C3B]"
              onChange={(event) => onChange("nextSquad", event.target.value)}
              value={form.nextSquad}
            />
          </label>

          <label className="flex items-center gap-3 rounded-xl border border-slate-200/70 bg-slate-50/70 p-3 text-sm font-semibold text-slate-700">
            <input
              checked={form.needsDeploy}
              className="size-4 accent-[#A07C3B]"
              onChange={(event) => onChange("needsDeploy", event.target.checked)}
              type="checkbox"
            />
            Precisa entrar na fila de Hefesto/deploy
          </label>

          {error ? (
            <p className="m-0 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700 ring-1 ring-red-100">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 p-5">
          <button
            className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-200/70 bg-white px-4 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-950"
            onClick={onClose}
            type="button"
          >
            Cancelar
          </button>
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#101820] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#1b2533] disabled:cursor-not-allowed disabled:bg-slate-400"
            disabled={isSaving}
            type="submit"
          >
            {isSaving ? <Loader2 className="size-4 animate-spin" /> : null}
            Registrar no banco
          </button>
        </div>
      </form>
    </div>
  );
}

function SelectField({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: readonly string[];
  value: string;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-xs font-semibold uppercase text-slate-500">
        {label}
      </span>
      <select
        className="h-11 rounded-lg border border-slate-200/70 bg-white px-3 text-sm font-semibold text-slate-950 outline-none transition-colors focus:border-[#A07C3B]"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function TextAreaField({
  label,
  onChange,
  placeholder,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-xs font-semibold uppercase text-slate-500">
        {label}
      </span>
      <textarea
        className="min-h-24 rounded-lg border border-slate-200/70 bg-white px-3 py-2 text-sm leading-6 text-slate-950 outline-none transition-colors focus:border-[#A07C3B]"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
    </label>
  );
}

function ZeusCommandCenter({
  actionCount,
  isLoading,
  latestRecord,
  metrics,
  monitoringAlertCount,
  nextSquad,
  onOpenPoAi,
  onOpenAudits,
  onOpenCritical,
  onOpenMonitoring,
  onOpenTimeline,
}: {
  actionCount: number;
  isLoading: boolean;
  latestRecord: EngineeringOperationRecord | null;
  metrics?: EngineeringOperationsResponse["metrics"];
  monitoringAlertCount: number;
  nextSquad: string;
  onOpenPoAi: () => void;
  onOpenAudits: () => void;
  onOpenCritical: () => void;
  onOpenMonitoring: () => void;
  onOpenTimeline: () => void;
}) {
  return (
    <Surface
      bordered
      className="flex min-h-0 flex-1 flex-col overflow-hidden border-slate-200/70 bg-white p-0 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
      <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_25rem]">
        <div className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="m-0 text-xs font-semibold uppercase text-[#A07C3B]">
                centro operacional
              </p>
              <h2 className="m-0 mt-1 text-xl font-semibold tracking-normal text-slate-950">
                Operacao do Panteon em tempo real
              </h2>
              <p className="m-0 mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                Alertas, historico, releases e pendencias organizados para
                decidir a proxima acao sem repetir informacao na tela.
              </p>
              <p className="sr-only">
                Riscos, pendências e handoffs consolidados a partir do diário
                oficial da engenharia IA.
              </p>
            </div>
            <Badge
              variant={
                actionCount + monitoringAlertCount > 0 ? "warning" : "success"
              }
            >
              {monitoringAlertCount > 0
                ? `${monitoringAlertCount} alerta(s) ativo(s)`
                : actionCount > 0
                ? `${actionCount} pontos de atenção`
                : "sem alerta crítico"}
            </Badge>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <FocusMetric
              icon={<ShieldAlert size={17} />}
              label="atenção"
              value={actionCount}
              detail="riscos, bloqueios ou rotinas vencidas"
            />
            <FocusMetric
              icon={<GitCommitHorizontal size={17} />}
              label="hefesto"
              value={metrics?.waitingReleaseOps ?? (isLoading ? "..." : 0)}
              detail="entregas aguardando publicação"
            />
            <FocusMetric
              icon={<History size={17} />}
              label="registros"
              value={metrics?.totalRecords ?? (isLoading ? "..." : 0)}
              detail="histórico lido do Engineering Operations"
            />
            <FocusMetric
              icon={<Rocket size={17} />}
              label="deploys"
              value={metrics?.latestDeploys ?? 0}
              detail="registros com rastreabilidade de deploy"
            />
          </div>
        </div>

        <aside className="border-t border-slate-100 bg-slate-50/60 p-5 xl:border-l xl:border-t-0">
          <p className="m-0 text-xs font-semibold uppercase text-slate-400">
            próximo encaminhamento
          </p>
          <p className="m-0 mt-2 text-lg font-semibold text-slate-950">
            {nextSquad}
          </p>
          <p className="m-0 mt-3 line-clamp-3 text-sm leading-6 text-slate-600">
            {latestRecord?.shortSummary ??
              "Aguardando leitura do diário operacional."}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#101820] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#1b2533]"
              onClick={onOpenCritical}
              type="button"
            >
              <ShieldAlert className="size-4" />
              Atenção
            </button>
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200/70 bg-white px-3 text-xs font-semibold text-slate-600 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-slate-950"
              onClick={onOpenPoAi}
              type="button"
            >
              <Bot className="size-4 text-[#A07C3B]" />
              PO AI
            </button>
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200/70 bg-white px-3 text-xs font-semibold text-slate-600 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-slate-950"
              onClick={onOpenTimeline}
              type="button"
            >
              <History className="size-4 text-[#A07C3B]" />
              Timeline
            </button>
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200/70 bg-white px-3 text-xs font-semibold text-slate-600 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-slate-950"
              onClick={onOpenMonitoring}
              type="button"
            >
              <Database className="size-4 text-[#A07C3B]" />
              Monitoring
            </button>
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200/70 bg-white px-3 text-xs font-semibold text-slate-600 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-slate-950"
              onClick={onOpenAudits}
              type="button"
            >
              <ClipboardCheck className="size-4 text-[#A07C3B]" />
              Auditorias
            </button>
          </div>
        </aside>
      </div>
    </Surface>
  );
}

function FocusMetric({
  detail,
  icon,
  label,
  value,
}: {
  detail: string;
  icon: ReactNode;
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="m-0 text-xs font-semibold uppercase text-slate-400">
            {label}
          </p>
          <p className="m-0 mt-2 text-2xl font-semibold text-slate-950">
            {value}
          </p>
        </div>
        <span className="flex size-9 items-center justify-center rounded-lg bg-slate-50 text-[#A07C3B] ring-1 ring-slate-200/70">
          {icon}
        </span>
      </div>
      <p className="m-0 mt-2 line-clamp-2 text-xs leading-5 text-slate-500">
        {detail}
      </p>
    </div>
  );
}

function DatabaseMonitoringView({
  acknowledgingProtocol,
  accessToken,
  alertProtocols,
  copiedCommandId,
  error,
  history,
  ignoringProtocol,
  intervalMs,
  isLoading,
  notifications,
  onAnalyze,
  onAcknowledgeProtocol,
  onCopyCommand,
  onIgnoreProtocol,
  onIntervalChange,
  onOpenAlertProtocol,
  onOpenAlertProtocolByCode,
  onOpenPoAi,
  onRefresh,
  snapshot,
  watcher,
}: {
  acknowledgingProtocol: string | null;
  accessToken: string | null;
  alertProtocols: OperationsAlertProtocolSummary[];
  copiedCommandId: string | null;
  error: string | null;
  history: OperationsCheckMetric[];
  ignoringProtocol: string | null;
  intervalMs: MonitoringIntervalMs;
  isLoading: boolean;
  notifications: OpsWatcherDecision[];
  onAnalyze: () => void;
  onAcknowledgeProtocol: (protocolCode?: string) => void;
  onCopyCommand: (command: string, id: string) => void;
  onIgnoreProtocol: (protocolCode?: string) => void;
  onIntervalChange: (intervalMs: MonitoringIntervalMs) => void;
  onOpenAlertProtocol: (protocol: OperationsAlertProtocolSummary) => void;
  onOpenAlertProtocolByCode: (protocolCode?: string) => void;
  onOpenPoAi: () => void;
  onRefresh: () => void;
  snapshot: OperationsMonitoringSnapshot | null;
  watcher: OpsWatcherDecision | null;
}) {
  const [authDiagnostics, setAuthDiagnostics] =
    useState<AuthDiagnosticsApiResponse | null>(null);
  const [authDiagnosticsError, setAuthDiagnosticsError] = useState<
    string | null
  >(null);
  const [isAuthDiagnosticsLoading, setIsAuthDiagnosticsLoading] =
    useState(false);
  const [isAlertsDialogOpen, setIsAlertsDialogOpen] = useState(false);
  const [isTvMode, setIsTvMode] = useState(false);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const visibleAlerts = (snapshot?.alerts ?? []).filter(
    (alert) => !isProtocolCleared(alert.protocol, alertProtocols),
  );
  const visibleNotifications = notifications.filter(
    (notification) =>
      !notification.protocol ||
      !isProtocolCleared(notification.protocol, alertProtocols),
  );
  const highestVisibleAlert = visibleAlerts.reduce<OperationsAlert | null>(
    (highest, alert) =>
      !highest || riskPriority(alert.level) > riskPriority(highest.level)
        ? alert
        : highest,
    null,
  );
  const visibleWatcher =
    watcher?.protocol && isProtocolCleared(watcher.protocol, alertProtocols)
      ? null
      : watcher;
  const bannerNotification = visibleWatcher?.notifyLucas
    ? visibleWatcher
    : null;
  const latestNotification = visibleNotifications[0] ?? null;
  const sourceCards = useMemo(
    () => buildMonitoringSourceCards(snapshot, history),
    [history, snapshot],
  );
  const selectedSource =
    sourceCards.find((source) => source.id === selectedSourceId) ?? null;
  const monitoringChecks = snapshot?.checks.length ? snapshot.checks : history;
  const performanceChecks = history.length ? history : monitoringChecks;
  const performanceIndicators = useMemo(
    () =>
      buildPanteonPerformanceIndicators({
        checks: performanceChecks,
        snapshot,
      }),
    [performanceChecks, snapshot],
  );
  const runAuthDiagnostics = useCallback(async () => {
    if (!accessToken) {
      setAuthDiagnosticsError(
        "Sessao Zeus indisponivel para diagnostico protegido.",
      );
      return;
    }

    setIsAuthDiagnosticsLoading(true);
    setAuthDiagnosticsError(null);

    try {
      const response = await fetch("/api/zeus/auth-diagnostics", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const payload = (await response.json().catch(() => null)) as
        | AuthDiagnosticsApiResponse
        | null;

      if (!response.ok) {
        setAuthDiagnosticsError(
          payload?.error ??
            "Nao foi possivel executar diagnostico Auth x hub_users.",
        );
        return;
      }

      setAuthDiagnostics(payload);
    } catch {
      setAuthDiagnosticsError(
        "Nao foi possivel executar diagnostico Auth x hub_users.",
      );
    } finally {
      setIsAuthDiagnosticsLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (!isTvMode) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isTvMode]);

  return (
    <section
      className={
        isTvMode
          ? "fixed inset-0 z-[60] h-screen overflow-hidden bg-slate-100 p-4"
          : "grid gap-5"
      }
    >
      <Surface
        bordered
        className={`border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${
          isTvMode ? "flex h-full min-h-0 flex-col overflow-hidden p-4" : "p-5"
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <PanelTitle
            eyebrow="fontes reais / 30s padrao"
            icon={<Database size={18} />}
            title="Database Monitoring"
          />
          <div className="flex flex-wrap items-center gap-2">
            <MonitoringIntervalControl
              intervalMs={intervalMs}
              onChange={onIntervalChange}
            />
            <button
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200/70 bg-white px-3 text-xs font-semibold text-slate-600 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-slate-950"
              onClick={onRefresh}
              type="button"
            >
              <RefreshCcw
                className={`size-4 text-[#A07C3B] ${isLoading ? "animate-spin" : ""}`}
              />
              Atualizar agora
            </button>
            <button
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[#101820] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#1b2533]"
              onClick={onAnalyze}
              type="button"
            >
              <Activity className="size-4" />
              Analisar agora
            </button>
            <button
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[#A07C3B]/20 bg-white px-3 text-xs font-semibold text-[#7A5E2C] transition-colors hover:bg-[#A07C3B]/5"
              onClick={onOpenPoAi}
              type="button"
            >
              <Bot className="size-4" />
              Ops Copilot
            </button>
            <button
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200/70 bg-white px-3 text-xs font-semibold text-slate-600 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isAuthDiagnosticsLoading}
              onClick={() => void runAuthDiagnostics()}
              type="button"
            >
              <ShieldAlert
                className={`size-4 text-[#A07C3B] ${
                  isAuthDiagnosticsLoading ? "animate-pulse" : ""
                }`}
              />
              Auth
            </button>
            <button
              aria-label={
                isTvMode
                  ? "Sair do modo tela cheia"
                  : "Abrir modo tela cheia"
              }
              className={`inline-flex size-9 items-center justify-center rounded-lg text-xs font-semibold transition-colors ${
                isTvMode
                  ? "bg-[#101820] text-white hover:bg-[#1b2533]"
                  : "border border-slate-200/70 bg-white text-slate-600 hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-slate-950"
              }`}
              onClick={() => setIsTvMode((current) => !current)}
              type="button"
            >
              {isTvMode ? (
                <Minimize2 className="size-4" />
              ) : (
                <Maximize2 className="size-4" />
              )}
            </button>
          </div>
        </div>

        {error ? (
          <p className="mt-4 rounded-xl border border-red-100 bg-red-50 p-3 text-sm font-semibold text-red-700">
            {error}
          </p>
        ) : null}

        <OperationsAlertCenter
          alertCount={visibleAlerts.length}
          getRiskVariant={riskToBadgeVariant}
          highestAlert={highestVisibleAlert}
          latestNotification={bannerNotification ?? latestNotification}
          onOpen={() => setIsAlertsDialogOpen(true)}
        />

        <AuthDiagnosticsPanel
          diagnostics={authDiagnostics}
          error={authDiagnosticsError}
          isLoading={isAuthDiagnosticsLoading}
        />

        <PanteonPerformanceIndicators
          indicators={performanceIndicators}
          isTvMode={isTvMode}
        />

        <MonitoringSourceGrid
          formatPayload={formatBytes}
          formatStatus={generalStatusLabel}
          getStatusVariant={statusToBadgeVariant}
          isTvMode={isTvMode}
          onSelectSource={setSelectedSourceId}
          sources={sourceCards}
        />

        <div
          className={
            isTvMode
              ? "mt-4 grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(22rem,0.48fr)] gap-4 overflow-hidden"
              : "mt-5 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.55fr)]"
          }
        >
          <MonitoringPeakPanel
            checks={monitoringChecks}
            formatDateTime={formatOperationDateTime}
            formatPayload={formatBytes}
            getRiskVariant={riskToBadgeVariant}
            isTvMode={isTvMode}
          />
          <MonitoringHotspotsPanel
            isTvMode={isTvMode}
            onSelectSource={setSelectedSourceId}
            sources={sourceCards}
          />
        </div>
      </Surface>

      {isAlertsDialogOpen ? (
        <OperationsAlertsDialog
          acknowledgingProtocol={acknowledgingProtocol}
          alertProtocols={alertProtocols}
          alerts={visibleAlerts}
          copiedCommandId={copiedCommandId}
          formatDateTime={formatOperationDateTime}
          getFeedbackStatusLabel={alertFeedbackStatusLabel}
          getFeedbackStatusVariant={alertFeedbackStatusVariant}
          getRiskVariant={riskToBadgeVariant}
          ignoringProtocol={ignoringProtocol}
          notifications={visibleNotifications}
          onAcknowledgeProtocol={onAcknowledgeProtocol}
          onClose={() => setIsAlertsDialogOpen(false)}
          onCopyCommand={onCopyCommand}
          onIgnoreProtocol={onIgnoreProtocol}
          onOpenAlert={(alert) =>
            onOpenAlertProtocol(alertToProtocolSummary(alert))
          }
          onOpenAlertProtocol={onOpenAlertProtocol}
          onOpenAlertProtocolByCode={onOpenAlertProtocolByCode}
          watcher={visibleWatcher}
        />
      ) : null}
      {selectedSource ? (
        <MonitoringSourceDialog
          onClose={() => setSelectedSourceId(null)}
          source={selectedSource}
        />
      ) : null}
      <ChecksHistoryPanel checks={history} />
    </section>
  );
}

type PanteonPerformanceIndicatorId =
  | "api"
  | "cache"
  | "cold-start"
  | "page"
  | "payload"
  | "supabase-query";

type PanteonPerformanceIndicator = {
  detail: string;
  evidence: string;
  id: PanteonPerformanceIndicatorId;
  label: string;
  tone: PerformanceTone;
  value: string;
};

function AuthDiagnosticsPanel({
  diagnostics,
  error,
  isLoading,
}: {
  diagnostics: AuthDiagnosticsApiResponse | null;
  error: string | null;
  isLoading: boolean;
}) {
  if (!diagnostics && !error && !isLoading) {
    return null;
  }

  const meta = diagnostics?.meta;
  const status = diagnostics?.status ?? (error ? "indisponivel" : "bloqueado");
  const statusVariant: BadgeVariant =
    status === "sincronizado"
      ? "success"
      : status === "desalinhado"
        ? "danger"
        : "warning";

  return (
    <div className="mt-4 rounded-2xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PanelTitle
          eyebrow="diagnostico sob demanda"
          icon={<ShieldAlert size={18} />}
          title="Auth x hub_users"
        />
        <Badge variant={statusVariant}>
          {isLoading ? "verificando" : status}
        </Badge>
      </div>
      {error ? (
        <p className="m-0 mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
          {error}
        </p>
      ) : null}
      {meta ? (
        <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
          <AuthDiagnosticsMetric label="Auth users" value={meta.authUsers} />
          <AuthDiagnosticsMetric label="hub_users" value={meta.hubProfiles} />
          <AuthDiagnosticsMetric
            label="perfis ativos"
            value={meta.activeProfiles}
          />
          <AuthDiagnosticsMetric
            label="Auth sem perfil"
            tone={meta.authWithoutProfile > 0 ? "danger" : "neutral"}
            value={meta.authWithoutProfile}
          />
          <AuthDiagnosticsMetric
            label="ativo sem Auth"
            tone={meta.activeProfileWithoutAuth > 0 ? "danger" : "neutral"}
            value={meta.activeProfileWithoutAuth}
          />
          <AuthDiagnosticsMetric
            label="roles invalidas"
            tone={meta.invalidRoleProfiles > 0 ? "danger" : "neutral"}
            value={meta.invalidRoleProfiles}
          />
          <AuthDiagnosticsMetric
            label="inativos"
            tone={meta.disabledProfiles > 0 ? "warning" : "neutral"}
            value={meta.disabledProfiles}
          />
        </div>
      ) : null}
      {diagnostics?.recommendations?.length ? (
        <div className="mt-3 grid gap-2">
          {diagnostics.recommendations.map((recommendation) => (
            <p
              className="m-0 rounded-xl bg-slate-50 px-3 py-2 text-xs font-medium leading-5 text-slate-600 ring-1 ring-slate-200/70"
              key={recommendation}
            >
              {recommendation}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AuthDiagnosticsMetric({
  label,
  tone = "neutral",
  value,
}: {
  label: string;
  tone?: "danger" | "neutral" | "warning";
  value: number;
}) {
  const toneClass =
    tone === "danger"
      ? "border-red-200 bg-red-50 text-red-700"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-slate-200 bg-slate-50 text-slate-700";

  return (
    <div className={`rounded-xl border p-3 ${toneClass}`}>
      <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.08em] opacity-75">
        {label}
      </p>
      <p className="m-0 mt-1 text-xl font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function PanteonPerformanceIndicators({
  indicators,
  isTvMode,
}: {
  indicators: PanteonPerformanceIndicator[];
  isTvMode: boolean;
}) {
  return (
    <div className="mt-5 rounded-2xl border border-slate-200/70 bg-slate-50/60 p-4">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="m-0 text-xs font-semibold uppercase tracking-[0.16em] text-[#A07C3B]">
            Vercel + Supabase
          </p>
          <h3 className="m-0 mt-1 text-lg font-semibold text-slate-950">
            Minha visao pro Panteon
          </h3>
          <p className="m-0 mt-1 text-xs leading-5 text-slate-500">
            Vercel mede entrada e funcao; Supabase mostra dados, consultas e
            estabilidade.
          </p>
        </div>
        <Badge variant="neutral">6 indicadores</Badge>
      </div>
      <div
        className={`grid grid-cols-1 gap-3 md:grid-cols-2 ${
          isTvMode ? "xl:grid-cols-6" : "xl:grid-cols-3 2xl:grid-cols-6"
        }`}
      >
        {indicators.map((indicator) => (
          <PanteonPerformanceIndicatorCard
            indicator={indicator}
            key={indicator.id}
          />
        ))}
      </div>
    </div>
  );
}

function PanteonPerformanceIndicatorCard({
  indicator,
}: {
  indicator: PanteonPerformanceIndicator;
}) {
  return (
    <div
      className={`min-w-0 rounded-xl border bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${performanceCardBorderClass(indicator.tone)}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 truncate text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
            {indicator.label}
          </p>
          <p className="m-0 mt-2 truncate text-2xl font-semibold text-slate-950">
            {indicator.value}
          </p>
        </div>
        <span
          className={`flex size-9 shrink-0 items-center justify-center rounded-lg ring-1 ${performanceIconClass(indicator.tone)}`}
        >
          {getPanteonIndicatorIcon(indicator.id)}
        </span>
      </div>
      <p className="m-0 mt-3 line-clamp-2 text-xs leading-5 text-slate-500">
        {indicator.detail}
      </p>
      <p className="m-0 mt-2 truncate text-[0.68rem] font-semibold text-slate-400">
        {indicator.evidence}
      </p>
    </div>
  );
}

function buildPanteonPerformanceIndicators({
  checks,
  snapshot,
}: {
  checks: OperationsCheckMetric[];
  snapshot: OperationsMonitoringSnapshot | null;
}): PanteonPerformanceIndicator[] {
  const latestChecks = getLatestChecksByEndpoint(
    sortMonitoringChecksByLatest(checks),
  );
  const pageChecks = latestChecks.filter((check) => check.group === "page");
  const apiChecks = latestChecks.filter((check) =>
    ["api", "guardian-queue", "protected-api"].includes(check.group),
  );
  const supabaseChecks = latestChecks.filter(
    (check) => check.group === "supabase",
  );
  const highestPayloadCheck = getHighestPayloadCheck(latestChecks);
  const coldStartSummary = getColdStartSummary(checks);
  const cacheSummary = getCacheSummary(latestChecks);
  const slowestPageCheck = getSlowestCheck(pageChecks);
  const slowestApiCheck = getSlowestCheck(apiChecks);
  const slowestSupabaseCheck = getSlowestCheck(supabaseChecks);
  const supabaseStatus = snapshot?.cards.supabase
    ? [
        `Auth ${generalStatusLabel(snapshot.cards.supabase.auth)}`,
        `REST ${generalStatusLabel(snapshot.cards.supabase.rest)}`,
        `Realtime ${generalStatusLabel(snapshot.cards.supabase.realtime)}`,
      ].join(" / ")
    : `${supabaseChecks.length} leitura(s)`;

  return [
    {
      detail: slowestPageCheck
        ? `Abertura HTML mais lenta em ${slowestPageCheck.label}.`
        : "Aguardando leitura de abertura do Login e Zeus.",
      evidence: formatIndicatorEvidence(pageChecks),
      id: "page",
      label: "Pagina",
      tone: getResponseChecksTone(pageChecks),
      value: formatMetricMs(getMaxResponseMs(pageChecks)),
    },
    {
      detail: slowestApiCheck
        ? `Maior tempo em ${slowestApiCheck.label}; media ${formatMetricMs(
            getAverageResponseMs(apiChecks),
          )}.`
        : "Aguardando leitura das APIs operacionais.",
      evidence: `${apiChecks.length} endpoint(s)`,
      id: "api",
      label: "APIs",
      tone: getResponseChecksTone(apiChecks),
      value: formatMetricMs(getMaxResponseMs(apiChecks)),
    },
    {
      detail: slowestSupabaseCheck
        ? `Supabase mais lento em ${slowestSupabaseCheck.label}.`
        : "Aguardando Auth, REST e Realtime.",
      evidence: supabaseStatus,
      id: "supabase-query",
      label: "Supabase",
      tone: getResponseChecksTone(supabaseChecks),
      value: formatMetricMs(getMaxResponseMs(supabaseChecks)),
    },
    {
      detail: highestPayloadCheck
        ? `${highestPayloadCheck.label} concentra o maior payload atual.`
        : "Aguardando payload das fontes monitoradas.",
      evidence: highestPayloadCheck
        ? `${highestPayloadCheck.module} / ${highestPayloadCheck.payloadRisk}`
        : "sem leitura",
      id: "payload",
      label: "Payload",
      tone: highestPayloadCheck
        ? payloadPerformanceTone(highestPayloadCheck.payloadRisk)
        : "neutral",
      value: highestPayloadCheck
        ? formatBytes(highestPayloadCheck.payloadBytes)
        : "--",
    },
    {
      detail: coldStartSummary.detail,
      evidence: coldStartSummary.evidence,
      id: "cold-start",
      label: "Cold start",
      tone: coldStartSummary.tone,
      value: coldStartSummary.value,
    },
    {
      detail: cacheSummary.detail,
      evidence: cacheSummary.evidence,
      id: "cache",
      label: "Cache",
      tone: cacheSummary.tone,
      value: cacheSummary.value,
    },
  ];
}

function getPanteonIndicatorIcon(id: PanteonPerformanceIndicatorId) {
  if (id === "page") {
    return <LayoutGrid size={17} />;
  }

  if (id === "api") {
    return <Activity size={17} />;
  }

  if (id === "supabase-query") {
    return <Database size={17} />;
  }

  if (id === "payload") {
    return <Layers3 size={17} />;
  }

  if (id === "cold-start") {
    return <Rocket size={17} />;
  }

  return <RefreshCcw size={17} />;
}

function MonitoringHotspotsPanel({
  isTvMode,
  onSelectSource,
  sources,
}: {
  isTvMode: boolean;
  onSelectSource: (sourceId: string) => void;
  sources: MonitoringSourceSummary[];
}) {
  const hotspots = [...sources]
    .sort((first, second) => {
      const riskDelta = riskPriority(second.risk) - riskPriority(first.risk);
      return riskDelta || second.responseMs - first.responseMs;
    })
    .slice(0, isTvMode ? 4 : 5);

  return (
    <Surface
      bordered
      className={`min-w-0 border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${
        isTvMode ? "min-h-0 overflow-hidden p-4" : "p-5"
      }`}
    >
      <PanelTitle
        eyebrow="prevenção"
        icon={<ShieldAlert size={18} />}
        title="Fontes que pedem atenção"
      />
      <div className="mt-4 grid gap-2">
        {hotspots.length > 0 ? (
          hotspots.map((source) => (
            <button
              className={`flex items-center justify-between gap-3 rounded-xl border bg-white p-3 text-left transition hover:bg-slate-50 ${performanceCardBorderClass(monitoringSourceTone(source.risk, source.status))}`}
              key={source.id}
              onClick={() => onSelectSource(source.id)}
              type="button"
            >
              <div className="min-w-0">
                <p className="m-0 truncate text-sm font-semibold text-slate-950">
                  {source.label}
                </p>
                <p className="m-0 mt-1 text-xs text-slate-500">
                  pico {source.peakResponseMs}ms / payload{" "}
                  {formatBytes(source.peakPayloadBytes)}
                </p>
              </div>
              <Badge variant={riskToBadgeVariant(source.risk)}>
                {source.risk}
              </Badge>
            </button>
          ))
        ) : (
          <EmptyState message="Aguardando leitura das fontes." />
        )}
      </div>
    </Surface>
  );
}

function MonitoringSourceDialog({
  onClose,
  source,
}: {
  onClose: () => void;
  source: MonitoringSourceSummary;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-slate-950/35 px-4 py-6 backdrop-blur-[2px]">
      <div className="flex max-h-[calc(100vh-3rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-2xl">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <PanelTitle
            eyebrow="detalhe da instancia"
            icon={getMonitoringSourceIcon(source.id)}
            title={source.label}
          />
          <button
            aria-label="Fechar detalhe da fonte"
            className="inline-flex size-9 items-center justify-center rounded-lg border border-slate-200/70 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-950"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="grid gap-3 md:grid-cols-4">
            <MonitoringDetailMetric
              label="Status"
              value={generalStatusLabel(source.status)}
            />
            <MonitoringDetailMetric
              label="Tempo atual"
              value={`${source.responseMs}ms`}
            />
            <MonitoringDetailMetric
              label="Pico"
              value={`${source.peakResponseMs}ms`}
            />
            <MonitoringDetailMetric
              label="Payload"
              value={formatBytes(source.payloadBytes)}
            />
          </div>
          <div className="mt-4 rounded-xl border border-slate-200/70 bg-slate-50/40 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="m-0 text-sm font-semibold text-slate-950">
                Tendencia de resposta
              </p>
              <p className="m-0 text-xs text-slate-500">
                ultimo check:{" "}
                {source.lastCheckAt
                  ? formatOperationDateTime(source.lastCheckAt)
                  : "nao informado"}
              </p>
            </div>
            <MiniTrendBars tall values={source.trend} />
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {source.currentChecks.map((check) => (
              <CheckMetricCard
                check={check}
                key={`${source.id}-${check.id}-${check.checkedAt}`}
              />
            ))}
          </div>
          <div className="mt-4 grid gap-3">
            {source.currentChecks.map((check) => (
              <div
                className="rounded-xl border border-slate-200/70 bg-white p-4 text-xs leading-5 text-slate-600"
                key={`${source.id}-${check.id}-detail`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="m-0 font-semibold text-slate-950">
                    {check.label}
                  </p>
                  <Badge variant={riskToBadgeVariant(check.risk)}>
                    {check.risk}
                  </Badge>
                </div>
                <p className="m-0 mt-2">
                  Esperado: {check.expected.description} / Recebido:{" "}
                  {check.received}
                </p>
                <p className="m-0 mt-1 break-all text-slate-500">
                  {check.method} {check.endpoint}
                </p>
                {check.error ? (
                  <p className="m-0 mt-2 rounded-lg bg-red-50 p-2 font-semibold text-red-700">
                    {check.error}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function MonitoringDetailMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200/70 bg-white p-4">
      <p className="m-0 text-xs font-semibold uppercase text-slate-400">
        {label}
      </p>
      <p className="m-0 mt-2 truncate text-lg font-semibold text-slate-950">
        {value}
      </p>
    </div>
  );
}

function MonitoringIntervalControl({
  intervalMs,
  onChange,
}: {
  intervalMs: MonitoringIntervalMs;
  onChange: (intervalMs: MonitoringIntervalMs) => void;
}) {
  const options = [
    { label: "10s", value: 10_000 },
    { label: "30s", value: 30_000 },
    { label: "60s", value: 60_000 },
    { label: "Manual", value: 0 },
  ] as const satisfies readonly {
    label: string;
    value: MonitoringIntervalMs;
  }[];

  return (
    <div className="inline-flex rounded-lg border border-slate-200/70 bg-white p-1">
      {options.map((option) => (
        <button
          className={`h-7 rounded-md px-2.5 text-xs font-semibold transition-colors ${
            intervalMs === option.value
              ? "bg-[#101820] text-white"
              : "text-slate-500 hover:bg-slate-50 hover:text-slate-950"
          }`}
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ChecksHistoryPanel({ checks }: { checks: OperationsCheckMetric[] }) {
  const groups = useMemo(() => buildCheckHistoryGroups(checks), [checks]);
  const [expandedGroupKey, setExpandedGroupKey] = useState<string | null>(null);
  const activeGroupKey = expandedGroupKey;

  return (
    <Surface
      bordered
      className="overflow-hidden border-slate-200/70 bg-white p-0 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
      <div className="border-b border-slate-100 p-5">
        <PanelTitle
          eyebrow={`${checks.length} checks nesta sessao`}
          icon={<History size={18} />}
          title="Historico de checks"
        />
      </div>
      <div className="max-h-[46vh] overflow-y-auto p-4">
        {groups.length > 0 ? (
          <div className="grid gap-3">
            {groups.map((group) => {
              const isExpanded = activeGroupKey === group.key;

              return (
                <div
                  className="overflow-hidden rounded-xl border border-slate-200/70 bg-white"
                  key={group.key}
                >
                  <button
                    aria-expanded={isExpanded}
                    className="flex w-full flex-wrap items-center justify-between gap-3 bg-slate-50/70 px-4 py-3 text-left transition hover:bg-slate-100/70"
                    onClick={() =>
                      setExpandedGroupKey(isExpanded ? null : group.key)
                    }
                    type="button"
                  >
                    <div>
                      <p className="m-0 text-sm font-semibold text-slate-950">
                        {group.label}
                      </p>
                      <p className="m-0 mt-1 text-xs font-medium text-slate-500">
                        {group.checks.length} checks / {group.alertCount}{" "}
                        alertas
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={riskToBadgeVariant(group.highestRisk)}>
                        {group.highestRisk}
                      </Badge>
                      <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">
                        Status Panteon:{" "}
                        {generalStatusLabel(
                          riskToGeneralStatus(group.highestRisk),
                        )}
                      </span>
                      <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
                        maior tempo {group.maxResponseMs}ms
                      </span>
                      <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
                        payload {formatBytes(group.maxPayloadBytes)}
                      </span>
                      <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/20">
                        {isExpanded ? "recolher" : "expandir"}
                      </span>
                      {isExpanded ? (
                        <ChevronDown className="size-4 text-[#A07C3B]" />
                      ) : (
                        <ChevronRight className="size-4 text-[#A07C3B]" />
                      )}
                    </div>
                  </button>

                  {isExpanded ? (
                    <div className="grid gap-3 border-t border-slate-100 bg-white p-4 md:grid-cols-2 xl:grid-cols-3">
                      {group.checks.map((check, index) => (
                        <CheckMetricCard
                          check={check}
                          key={`${check.id}-${check.checkedAt}-${index}`}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState message="Nenhum check registrado nesta sessao." />
        )}
      </div>
    </Surface>
  );
}

function CheckMetricCard({ check }: { check: OperationsCheckMetric }) {
  const metaEntries = formatCheckMetaEntries(check);

  return (
    <article className="rounded-xl border border-slate-200/70 bg-slate-50/40 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-xs font-semibold text-slate-500">
            {formatOperationDateTime(check.checkedAt)}
          </p>
          <p className="m-0 mt-1 line-clamp-2 text-sm font-semibold text-slate-950">
            {check.label}
          </p>
          <p className="m-0 mt-1 truncate text-xs text-slate-500">
            {check.module}
          </p>
        </div>
        <Badge variant={riskToBadgeVariant(check.risk)}>{check.risk}</Badge>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-white p-2 ring-1 ring-slate-200/70">
          <p className="m-0 font-semibold uppercase text-slate-400">Status</p>
          <p className="m-0 mt-1 truncate text-slate-700">{check.received}</p>
        </div>
        <div className="rounded-lg bg-white p-2 ring-1 ring-slate-200/70">
          <p className="m-0 font-semibold uppercase text-slate-400">Tempo</p>
          <p className="m-0 mt-1 text-slate-700">{check.responseMs}ms</p>
        </div>
        <div className="rounded-lg bg-white p-2 ring-1 ring-slate-200/70">
          <p className="m-0 font-semibold uppercase text-slate-400">Payload</p>
          <p className="m-0 mt-1 text-slate-700">
            {formatBytes(check.payloadBytes)}
          </p>
        </div>
        <div className="rounded-lg bg-white p-2 ring-1 ring-slate-200/70">
          <p className="m-0 font-semibold uppercase text-slate-400">Alerta</p>
          <p className="m-0 mt-1 text-slate-700">
            {check.alertGenerated ? "sim" : "nao"}
          </p>
        </div>
      </div>
      {metaEntries.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {metaEntries.map((entry) => (
            <span
              className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200/70"
              key={entry.key}
            >
              {entry.label}:{" "}
              <span className="text-slate-950">{entry.value}</span>
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function formatCheckMetaEntries(check: OperationsCheckMetric) {
  const meta = check.meta;

  if (!meta) {
    return [];
  }

  const labels: Record<string, string> = {
    activeProfiles: "perfis ativos",
    activeProfileWithoutAuth: "perfis ativos sem Auth",
    age: "age",
    authUsers: "Auth users",
    authWithoutProfile: "Auth sem perfil",
    cacheControl: "cache",
    cacheStatus: "cache local",
    count: "count",
    database: "database",
    disabledProfiles: "perfis inativos",
    elapsedMs: "tempo fonte",
    hadesQueueCache: "cache Hades",
    hubProfiles: "hub_users",
    invalidRoleProfiles: "roles invalidas",
    limit: "limit",
    loadedCount: "carregados",
    sampledAuthUsers: "Auth amostrado",
    sampledHubProfiles: "Hub amostrado",
    source: "source",
    status: "status",
    vercelCache: "cache Vercel",
  };
  const preferredKeys = [
    "authUsers",
    "hubProfiles",
    "activeProfiles",
    "authWithoutProfile",
    "activeProfileWithoutAuth",
    "invalidRoleProfiles",
    "disabledProfiles",
    "sampledAuthUsers",
    "sampledHubProfiles",
    "database",
    "source",
    "status",
    "count",
    "loadedCount",
    "limit",
    "cacheStatus",
    "hadesQueueCache",
    "vercelCache",
    "cacheControl",
    "age",
    "elapsedMs",
  ];

  return preferredKeys
    .filter((key) => key in meta)
    .map((key) => ({
      key,
      label: labels[key] ?? key,
      value: formatCheckMetaValue(meta[key]),
    }))
    .filter((entry) => entry.value.length > 0)
    .slice(0, 10);
}

function formatCheckMetaValue(value: unknown) {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }

  return "";
}

type CheckHistoryGroup = {
  alertCount: number;
  checks: OperationsCheckMetric[];
  highestRisk: OperationsRiskLevel | "nenhum";
  key: string;
  label: string;
  maxPayloadBytes: number;
  maxResponseMs: number;
};

function buildCheckHistoryGroups(
  checks: OperationsCheckMetric[],
): CheckHistoryGroup[] {
  const groupsByHour = new Map<
    string,
    {
      checks: OperationsCheckMetric[];
      label: string;
    }
  >();

  checks.slice(0, 120).forEach((check) => {
    const bucket = getCheckHistoryHourBucket(check.checkedAt);
    const group = groupsByHour.get(bucket.key) ?? {
      checks: [],
      label: bucket.label,
    };

    group.checks.push(check);
    groupsByHour.set(bucket.key, group);
  });

  return Array.from(groupsByHour.entries()).map(([key, group]) => {
    const highestRisk = group.checks.reduce<OperationsRiskLevel | "nenhum">(
      (currentRisk, check) =>
        riskPriority(check.risk) > riskPriority(currentRisk)
          ? check.risk
          : currentRisk,
      "nenhum",
    );

    return {
      alertCount: group.checks.filter((check) => check.alertGenerated).length,
      checks: group.checks,
      highestRisk,
      key,
      label: group.label,
      maxPayloadBytes: Math.max(
        0,
        ...group.checks.map((check) => check.payloadBytes),
      ),
      maxResponseMs: Math.max(
        0,
        ...group.checks.map((check) => check.responseMs),
      ),
    };
  });
}

function getCheckHistoryHourBucket(value: string) {
  const date = parseLocalDateTime(value);

  if (!date) {
    return {
      key: `sem-horario-${value}`,
      label: value,
    };
  }

  const parts = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    month: "2-digit",
    timeZone: hubTimeZone,
    year: "2-digit",
  }).formatToParts(date);
  const getPart = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "--";
  const day = getPart("day");
  const hour = getPart("hour");
  const month = getPart("month");
  const year = getPart("year");

  return {
    key: `${year}-${month}-${day}-${hour}`,
    label: `${day}/${month}/${year} ${hour}:00`,
  };
}

function buildMonitoringSourceCards(
  snapshot: OperationsMonitoringSnapshot | null,
  history: OperationsCheckMetric[],
): MonitoringSourceSummary[] {
  const checks = [...(snapshot?.checks ?? []), ...history].slice(0, 220);
  const groups = new Map<string, OperationsCheckMetric[]>();

  checks.forEach((check) => {
    const sourceId = getMonitoringSourceId(check);
    const sourceChecks = groups.get(sourceId) ?? [];

    sourceChecks.push(check);
    groups.set(sourceId, sourceChecks);
  });

  return Array.from(groups.entries())
    .map(([sourceId, sourceChecks]) => {
      const currentChecks = getLatestChecksByEndpoint(sourceChecks);
      const highestRisk = currentChecks.reduce<OperationsRiskLevel | "nenhum">(
        (currentRisk, check) =>
          riskPriority(check.risk) > riskPriority(currentRisk)
            ? check.risk
            : currentRisk,
        "nenhum",
      );
      const meta = getMonitoringSourceMeta(sourceId);
      const responseMs = Math.max(
        0,
        ...currentChecks.map((check) => check.responseMs),
      );
      const payloadBytes = Math.max(
        0,
        ...currentChecks.map((check) => check.payloadBytes),
      );
      const averageResponseMs = Math.round(
        currentChecks.reduce((total, check) => total + check.responseMs, 0) /
          Math.max(1, currentChecks.length),
      );

      return {
        alertCount: currentChecks.filter((check) => check.alertGenerated)
          .length,
        averageResponseMs,
        checks: sourceChecks,
        currentChecks,
        description: meta.description,
        endpointCount: currentChecks.length,
        errorCount: currentChecks.filter((check) => !check.ok).length,
        healthyCount: currentChecks.filter((check) => check.ok).length,
        id: sourceId,
        label: meta.label,
        lastCheckAt: sourceChecks[0]?.checkedAt ?? null,
        peakPayloadBytes: Math.max(
          0,
          ...sourceChecks.map((check) => check.payloadBytes),
        ),
        peakResponseMs: Math.max(
          0,
          ...sourceChecks.map((check) => check.responseMs),
        ),
        payloadBytes,
        responseMs,
        risk: highestRisk,
        status: currentChecks.length ? riskToGeneralStatus(highestRisk) : undefined,
        trend: sourceChecks
          .slice(0, 18)
          .map((check) => check.responseMs)
          .reverse(),
      };
    })
    .sort((first, second) => {
      const firstOrder = getMonitoringSourceOrder(first.id);
      const secondOrder = getMonitoringSourceOrder(second.id);

      return firstOrder - secondOrder || first.label.localeCompare(second.label);
    });
}

function getLatestChecksByEndpoint(checks: OperationsCheckMetric[]) {
  const checksById = new Map<string, OperationsCheckMetric>();

  checks.forEach((check) => {
    if (!checksById.has(check.id)) {
      checksById.set(check.id, check);
    }
  });

  return Array.from(checksById.values());
}

function getMonitoringSourceId(check: OperationsCheckMetric) {
  if (check.group === "api") {
    return `api-${normalizeSearchText(check.module) || "hub"}`;
  }

  return check.group;
}

function ZeusViewTabs({
  activeView,
  addressCatalogCount,
  actionCount,
  deployCount,
  filteredCount,
  itTicketAttentionCount,
  itTicketCount,
  monitoringAlertCount,
  onChange,
  routineCount,
}: {
  activeView: ZeusView;
  addressCatalogCount: number;
  actionCount: number;
  deployCount: number;
  filteredCount: number;
  itTicketAttentionCount: number;
  itTicketCount: number;
  monitoringAlertCount: number;
  onChange: (view: ZeusView) => void;
  routineCount: number;
}) {
  const counters = {
    address: addressCatalogCount,
    audits: routineCount,
    deploys: deployCount,
    health: monitoringAlertCount,
    itTickets: itTicketCount,
    monitoring: monitoringAlertCount,
    overview: actionCount,
    records: filteredCount,
    timeline: filteredCount,
  } as const satisfies Record<ZeusView, number>;

  return (
    <nav
      aria-label="Visões do Zeus"
      className="flex w-full flex-wrap gap-1 rounded-xl border border-slate-200/70 bg-white p-1 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
      {zeusViews.map((view) => {
        const isActive = activeView === view.id;
        const hasNewTickets =
          view.id === "itTickets" && itTicketAttentionCount > 0;
        const buttonClassName = isActive
          ? "bg-[#101820] text-white shadow-sm"
          : hasNewTickets
            ? "bg-[#A07C3B]/10 text-[#7A5E2C] ring-1 ring-[#A07C3B]/25 hover:bg-[#A07C3B]/15 hover:text-[#101820]"
            : "text-slate-600 hover:bg-slate-50 hover:text-slate-950";
        const counterClassName = isActive
          ? "bg-white/15 text-white"
          : hasNewTickets
            ? "bg-[#A07C3B]/15 text-[#7A5E2C]"
            : "bg-slate-100 text-slate-500";
        const tabTooltip = hasNewTickets
          ? `${itTicketAttentionCount} ticket(s) novo(s) aguardando Zeus`
          : view.label;

        return (
          <Tooltip content={tabTooltip} key={view.id} placement="top">
            <button
              aria-pressed={isActive}
              className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors ${buttonClassName}`}
              onClick={() => onChange(view.id)}
              type="button"
            >
              {hasNewTickets ? (
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full bg-[#A07C3B]"
                />
              ) : null}
              {view.label}
              <span
                className={`rounded-full px-1.5 py-0.5 text-[0.65rem] ${counterClassName}`}
              >
                {counters[view.id]}
              </span>
            </button>
          </Tooltip>
        );
      })}
    </nav>
  );
}

function ZeusOpsPresenceBar({
  activeView,
  avatarUrl,
  isOnline,
  itTicketAttentionCount,
  lastSeenAt,
  monitoringAlertCount,
  onOpenHelpDesk,
  onOpenMonitoring,
  onPresenceStatusChange,
  onSignOut,
  operationActionCount,
  presenceStatus,
  userName,
}: {
  activeView: ZeusView;
  avatarUrl?: string | null;
  isOnline: boolean;
  itTicketAttentionCount: number;
  lastSeenAt: string | null;
  monitoringAlertCount: number;
  onOpenHelpDesk: () => void;
  onOpenMonitoring: () => void;
  onPresenceStatusChange: (status: HubPresenceStatus) => void;
  onSignOut: () => void;
  operationActionCount: number;
  presenceStatus: HubPresenceStatus;
  userName: string;
}) {
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [isPresenceMenuOpen, setIsPresenceMenuOpen] = useState(false);
  const activeViewLabel =
    zeusViews.find((view) => view.id === activeView)?.label ?? "Zeus";
  const notificationCount =
    itTicketAttentionCount + monitoringAlertCount + operationActionCount;
  const effectivePresenceStatus = isOnline ? presenceStatus : "offline";
  const presenceTone = getZeusPresenceTone(effectivePresenceStatus);

  return (
    <section className="rounded-xl border border-slate-200/70 bg-white px-3 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-slate-500">
          <span className="inline-flex h-8 items-center gap-2 rounded-lg bg-slate-50 px-2.5 ring-1 ring-slate-200">
            <Activity className="size-4 text-emerald-600" />
            connected
          </span>
          <span className="hidden h-8 items-center gap-2 rounded-lg bg-slate-50 px-2.5 ring-1 ring-slate-200 sm:inline-flex">
            <Activity className="size-4 text-[#A07C3B]" />
            OPS / {activeViewLabel}
          </span>
          <span className="hidden h-8 items-center rounded-lg bg-slate-50 px-2.5 ring-1 ring-slate-200 lg:inline-flex">
            {lastSeenAt
              ? `Pulso: ${formatOperationDateTime(lastSeenAt)}`
              : "Pulso: aguardando"}
          </span>
        </div>

        <div className="flex min-w-0 items-center gap-2">
          <div className="relative">
            <Tooltip content="Notificacoes">
              <button
                aria-expanded={isNotificationOpen}
                aria-label="Abrir notificacoes Zeus"
                className="relative grid size-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-950"
                onClick={() => setIsNotificationOpen((current) => !current)}
                type="button"
              >
                <Bell className="size-4" />
                {notificationCount > 0 ? (
                  <span className="absolute -right-1 -top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[0.62rem] font-bold leading-none text-white">
                    {notificationCount > 99 ? "99+" : notificationCount}
                  </span>
                ) : null}
              </button>
            </Tooltip>
            {isNotificationOpen ? (
              <div className="absolute right-0 top-11 z-[90] w-[22rem] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
                <div className="border-b border-slate-100 px-4 py-3">
                  <p className="m-0 text-sm font-semibold text-slate-950">
                    Notificacoes Zeus
                  </p>
                  <p className="m-0 mt-1 text-xs text-slate-500">
                    Sinais acionaveis do OPS.
                  </p>
                </div>
                <div className="grid gap-2 p-2">
                  <ZeusNotificationButton
                    count={itTicketAttentionCount}
                    label="Tickets aguardando Zeus"
                    onClick={() => {
                      setIsNotificationOpen(false);
                      onOpenHelpDesk();
                    }}
                  />
                  <ZeusNotificationButton
                    count={monitoringAlertCount}
                    label="Alertas de monitoramento"
                    onClick={() => {
                      setIsNotificationOpen(false);
                      onOpenMonitoring();
                    }}
                  />
                  <ZeusNotificationButton
                    count={operationActionCount}
                    label="Acoes operacionais"
                    onClick={() => setIsNotificationOpen(false)}
                  />
                </div>
              </div>
            ) : null}
          </div>
          <Tooltip content="Ajustes">
            <button
              aria-label="Abrir ajustes"
              className="grid size-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-950"
              type="button"
            >
              <Settings className="size-4" />
            </button>
          </Tooltip>
          <div className="relative">
            <button
              aria-expanded={isPresenceMenuOpen}
              aria-label="Alterar status de presenca"
              className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-semibold outline-none transition hover:brightness-95 focus-visible:ring-2 focus-visible:ring-[#A07C3B] ${presenceTone.button}`}
              onClick={() => setIsPresenceMenuOpen((current) => !current)}
              type="button"
            >
              <span className={`h-2 w-2 rounded-full ${presenceTone.dot}`} />
              <span className="capitalize">
                {isOnline
                  ? getHubPresenceLabel(effectivePresenceStatus)
                  : "Conectando"}
              </span>
              <ChevronDown className="size-3.5" />
            </button>
            {isPresenceMenuOpen ? (
              <div className="absolute right-0 top-11 z-[90] w-44 rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl">
                {hubPresenceStatusOptions.map((option) => {
                  const optionTone = getZeusPresenceTone(option);

                  return (
                    <button
                      className="flex h-9 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm text-slate-800 transition hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                      key={option}
                      onClick={() => {
                        setIsPresenceMenuOpen(false);
                        onPresenceStatusChange(option);
                      }}
                      type="button"
                    >
                      <span className={`h-2.5 w-2.5 rounded-full ${optionTone.dot}`} />
                      <span className="capitalize">
                        {getHubPresenceLabel(option)}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          <span className="grid size-9 place-items-center overflow-hidden rounded-full bg-[#101820] text-xs font-semibold text-white ring-2 ring-white">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt=""
                className="size-full object-cover"
                src={avatarUrl}
              />
            ) : (
              getZeusUserInitials(userName)
            )}
          </span>
          <span className="hidden max-w-28 truncate text-sm font-medium text-slate-600 sm:inline">
            {userName}
          </span>
          <Tooltip content="Sair">
            <button
              aria-label="Sair"
              className="grid size-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-950"
              onClick={onSignOut}
              type="button"
            >
              <LogOut className="size-4" />
            </button>
          </Tooltip>
        </div>
      </div>
    </section>
  );
}

function ZeusNotificationButton({
  count,
  label,
  onClick,
}: {
  count: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-slate-50"
      onClick={onClick}
      type="button"
    >
      <span className="text-sm font-semibold text-slate-800">{label}</span>
      <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-xs font-semibold text-slate-600">
        {count}
      </span>
    </button>
  );
}

function getZeusUserInitials(name: string) {
  const [first = "", second = ""] = name.trim().split(/\s+/);

  return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase() || "Z";
}

function getZeusPresenceTone(status: HubPresenceStatus) {
  const normalizedStatus = status === "busy" ? "agenda" : status;
  const tones = {
    agenda: {
      button: "border-sky-200 bg-sky-50 text-sky-700",
      dot: "bg-sky-500",
    },
    away: {
      button: "border-red-200 bg-red-50 text-red-700",
      dot: "bg-red-500",
    },
    lunch: {
      button: "border-yellow-200 bg-yellow-50 text-yellow-700",
      dot: "bg-yellow-400",
    },
    offline: {
      button: "border-zinc-200 bg-zinc-50 text-zinc-500",
      dot: "bg-zinc-400",
    },
    online: {
      button: "border-emerald-200 bg-emerald-50 text-emerald-700",
      dot: "bg-emerald-500",
    },
  } as const satisfies Record<
    Exclude<HubPresenceStatus, "busy">,
    {
      button: string;
      dot: string;
    }
  >;

  return tones[normalizedStatus];
}

function DeployProtocolsView({
  accessToken,
  copiedCommandId,
  filters,
  onCopyCommand,
  onSelectRecord,
  records,
  releaseRegisterError,
  releaseRegisters,
}: {
  accessToken: string | null;
  copiedCommandId: string | null;
  filters: OperationsFilters;
  onCopyCommand: (command: string, id: string) => void;
  onSelectRecord: (record: EngineeringOperationRecord) => void;
  records: EngineeringOperationRecord[];
  releaseRegisterError: string | null;
  releaseRegisters: ReleaseRegistersApiResponse | null;
}) {
  const [homologationReviews, setHomologationReviews] =
    useState<HomologationReviewState>(() => readHomologationReviews());
  const [homologationReviewSource, setHomologationReviewSource] = useState<
    "local" | "loading" | "shared"
  >("loading");
  const [homologationReviewError, setHomologationReviewError] = useState<
    string | null
  >(null);
  const filteredRecords = records.filter((record) =>
    matchesFilters(record, filters),
  );
  const filteredReleaseProtocols = buildReleaseProtocols(records).filter(
    (releaseProtocol) => matchesReleaseProtocolFilters(releaseProtocol, filters),
  );
  const homologationProtocols = filteredReleaseProtocols
    .filter(isReleaseProtocolInHomologation)
    .slice(0, 8);
  const releaseModuleGroups = buildReleaseModuleGroups(
    filteredReleaseProtocols,
  ).slice(0, 8);
  const deployCount = filteredReleaseProtocols.length;
  const moduleGroups = buildProtocolModuleGroups(filteredRecords.slice(0, 120));
  const usingReleaseRegisters = Boolean(
    releaseRegisters && releaseRegisters.records.length > 0,
  );

  useEffect(() => {
    writeHomologationReviews(homologationReviews);
  }, [homologationReviews]);

  useEffect(() => {
    let isActive = true;

    async function loadSharedHomologationReviews() {
      setHomologationReviewSource("loading");
      setHomologationReviewError(null);

      try {
        const currentAccessToken = await getZeusAccessToken(accessToken);
        const headers: Record<string, string> = {};

        if (currentAccessToken) {
          headers.Authorization = `Bearer ${currentAccessToken}`;
        }

        const response = await fetch("/api/zeus/homologation-reviews", {
          cache: "no-store",
          headers,
        });
        const payload = (await response
          .json()
          .catch(() => null)) as HomologationReviewsApiResponse | null;

        if (!isActive) {
          return;
        }

        if (!response.ok || !payload?.state) {
          throw new Error(
            payload?.error ??
              "Nao foi possivel carregar homologacao compartilhada.",
          );
        }

        setHomologationReviews(payload.state);
        setHomologationReviewSource("shared");
      } catch (error) {
        if (!isActive) {
          return;
        }

        setHomologationReviewSource("local");
        setHomologationReviewError(getHomologationReviewErrorMessage(error));
      }
    }

    void loadSharedHomologationReviews();

    return () => {
      isActive = false;
    };
  }, [accessToken]);

  function updateHomologationItem(
    deployProtocol: string,
    item: HomologationItem,
    patch: Partial<Pick<HomologationItemReview, "note" | "status">>,
  ) {
    const currentItem = homologationReviews[deployProtocol]?.[item.protocol] ?? {
      note: "",
      status: "aguardando_teste" as HomologationReviewStatus,
      updatedAt: "",
    };
    const nextReview: HomologationItemReview = {
      ...currentItem,
      ...patch,
      updatedAt: new Date().toISOString(),
    };

    setHomologationReviews((current) => {
      const currentDeploy = current[deployProtocol] ?? {};

      return {
        ...current,
        [deployProtocol]: {
          ...currentDeploy,
          [item.protocol]: nextReview,
        },
      };
    });

    void persistHomologationItem(deployProtocol, item, nextReview);
  }

  async function persistHomologationItem(
    deployProtocol: string,
    item: HomologationItem,
    review: HomologationItemReview,
  ) {
    try {
      const currentAccessToken = await getZeusAccessToken(accessToken);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (currentAccessToken) {
        headers.Authorization = `Bearer ${currentAccessToken}`;
      }

      const response = await fetch("/api/zeus/homologation-reviews", {
        body: JSON.stringify({
          itemKind: item.kind,
          itemProtocol: item.protocol,
          itemTitle: item.title,
          itemType: item.type,
          module: item.module,
          note: review.note,
          releaseProtocol: deployProtocol,
          status: review.status,
        }),
        cache: "no-store",
        headers,
        method: "PATCH",
      });
      const payload = (await response
        .json()
        .catch(() => null)) as HomologationReviewsApiResponse | null;

      if (!response.ok || !payload?.review) {
        throw new Error(
          payload?.error ?? "Nao foi possivel salvar homologacao.",
        );
      }

      const savedReview = payload.review;

      setHomologationReviewSource("shared");
      setHomologationReviewError(null);
      setHomologationReviews((current) => {
        const currentDeploy = current[deployProtocol] ?? {};

        return {
          ...current,
          [deployProtocol]: {
            ...currentDeploy,
            [item.protocol]: {
              note: savedReview.note,
              status: savedReview.status,
              updatedAt: savedReview.updatedAt,
            },
          },
        };
      });
    } catch (error) {
      setHomologationReviewSource("local");
      setHomologationReviewError(getHomologationReviewErrorMessage(error));
    }
  }

  return (
    <section className="grid gap-5">
      <ReleaseRegistersSourcePanel
        error={releaseRegisterError}
        recordsCount={records.length}
        releaseRegisters={releaseRegisters}
        usingReleaseRegisters={usingReleaseRegisters}
      />

      <HomologationOperationsPanel
        copiedCommandId={copiedCommandId}
        reviewError={homologationReviewError}
        reviewSource={homologationReviewSource}
        onCopyCommand={onCopyCommand}
        onSelectRecord={onSelectRecord}
        onUpdateItem={updateHomologationItem}
        protocols={homologationProtocols}
        reviews={homologationReviews}
      />

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,0.42fr)_minmax(0,0.58fr)]">
        <div className="grid content-start gap-5">
        <Surface
          bordered
          className="min-w-0 overflow-hidden border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
        >
          <PanelTitle
            eyebrow={`${releaseModuleGroups.length} modulos / ${deployCount} pacotes`}
            icon={<Rocket size={18} />}
            title="Deploys por modulo"
          />
          <p className="m-0 mt-3 text-sm leading-6 text-slate-600">
            Cada agente de modulo publica o proprio recorte em homologacao.
            Zeus organiza modulo, pacote e atividades para Hefesto promover
            somente o que estiver pronto para producao.
          </p>

          <div className="mt-4 grid max-h-[58vh] gap-3 overflow-y-auto pr-1">
            {releaseModuleGroups.length > 0 ? (
              releaseModuleGroups.map((moduleGroup) => (
                <ReleaseModuleGroupSection
                  formatDateTime={formatOperationDateTime}
                  formatModuleList={formatReleaseModuleList}
                  getStatusVariant={releaseProtocolStatusVariant}
                  group={moduleGroup}
                  isInHomologation={isReleaseProtocolInHomologation}
                  isReadyForProduction={isReleaseProtocolReadyForProduction}
                  key={moduleGroup.module}
                  onSelectRecord={onSelectRecord}
                />
              ))
            ) : (
              <EmptyState message="Sem deploy registrado para os filtros atuais." />
            )}
          </div>
        </Surface>

        <Surface
          bordered
          className="border-slate-200/70 bg-slate-50/60 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
        >
          <PanelTitle
            eyebrow="Regra V1"
            icon={<GitCommitHorizontal size={18} />}
            title="Como o protocolo nasce"
          />
          <ul className="m-0 mt-4 grid list-none gap-2 p-0 text-sm leading-6 text-slate-600">
            <li>Atendimento Iris: AT-0001.</li>
            <li>Cobranca: CB-0001.</li>
            <li>HelpDesk tecnico: TI-000001.</li>
            <li>Atividade operacional Zeus: OP-0001.</li>
            <li>Alerta operacional: AL-0001.</li>
            <li>Deploy/release macro: DP-0001.</li>
            <li>Agente do modulo publica homologacao autorizada.</li>
            <li>O handoff informa modulo, pacote, atividades e validacoes.</li>
            <li>Hefesto promove producao somente do homologado.</li>
            <li>
              O status final fecha o ciclo: homologado, em producao, bloqueado
              ou rollback.
            </li>
          </ul>
        </Surface>
        </div>

        <Surface
          bordered
          className="min-w-0 overflow-hidden border-slate-200/70 bg-white p-0 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
        >
          <div className="border-b border-slate-100 p-5">
            <PanelTitle
              eyebrow={`${records.length} protocolos`}
              icon={<Layers3 size={18} />}
              title="Protocolos por modulo e tipo"
            />
          </div>
          <div className="grid max-h-[72vh] gap-5 overflow-y-auto p-5 pr-4">
            {moduleGroups.length > 0 ? (
              moduleGroups.map((moduleGroup) => (
                <section className="grid gap-3" key={moduleGroup.module}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="m-0 text-base font-semibold text-slate-950">
                      {formatPanteonModuleName(moduleGroup.module)}
                    </h3>
                    <span className="rounded-full bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-500 ring-1 ring-slate-200/70">
                      {moduleGroup.count} protocolos
                    </span>
                  </div>
                  <div className="grid gap-3">
                    {moduleGroup.categories.map((category) => (
                      <div
                        className="rounded-xl border border-slate-200/70 bg-slate-50/50 p-3"
                        key={`${moduleGroup.module}-${category.category}`}
                      >
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                          <Badge
                            variant={protocolCategoryVariant(category.category)}
                          >
                            {category.category}
                          </Badge>
                          <span className="text-xs font-semibold text-slate-500">
                            {category.records.length} alteracoes
                          </span>
                        </div>
                        <div className="grid gap-2">
                          {category.records.map((record) => (
                            <ProtocolRecordCard
                              formatDateTime={formatOperationDateTime}
                              getChangeSummary={getRecordChangeSummary}
                              getReasonSummary={getRecordReasonSummary}
                              getStatusVariant={statusVariant}
                              key={record.id}
                              onSelect={() => onSelectRecord(record)}
                              record={record}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))
            ) : (
              <EmptyState message="Sem protocolo encontrado para os filtros atuais." />
            )}
          </div>
        </Surface>
      </section>
    </section>
  );
}

function ReleaseRegistersSourcePanel({
  error,
  recordsCount,
  releaseRegisters,
  usingReleaseRegisters,
}: {
  error: string | null;
  recordsCount: number;
  releaseRegisters: ReleaseRegistersApiResponse | null;
  usingReleaseRegisters: boolean;
}) {
  const homologationCount =
    releaseRegisters?.sources.find(
      (source) => source.environment === "homologacao",
    )?.recordsCount ?? 0;
  const productionCount =
    releaseRegisters?.sources.find((source) => source.environment === "producao")
      ?.recordsCount ?? 0;

  return (
    <Surface
      bordered
      className="border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PanelTitle
          eyebrow={`${recordsCount} registros de deploy`}
          icon={<Rocket size={18} />}
          title="Fonte da aba Deploy"
        />
        <Badge variant={usingReleaseRegisters ? "success" : "warning"}>
          {usingReleaseRegisters ? "indices por ambiente" : "fallback diario"}
        </Badge>
      </div>
      <p className="m-0 mt-3 text-sm leading-6 text-slate-600">
        {usingReleaseRegisters
          ? "Homologacao e producao agora alimentam a tela a partir dos registros operacionais separados."
          : "Sem registros por ambiente disponiveis; a tela preserva o diario canonico como fallback."}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <span className="rounded-full bg-[#A07C3B]/10 px-3 py-1 text-xs font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
          Homologacao {homologationCount}
        </span>
        <span className="rounded-full bg-slate-950 px-3 py-1 text-xs font-semibold text-white">
          Producao {productionCount}
        </span>
        <span className="rounded-full bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200/70">
          {releaseRegisters?.sourcePath ??
            "docs/operations/engineering-operations.md"}
        </span>
      </div>
      {error ? (
        <p className="m-0 mt-3 rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-800 ring-1 ring-amber-200/70">
          {error}
        </p>
      ) : null}
    </Surface>
  );
}

function HomologationOperationsPanel({
  copiedCommandId,
  onCopyCommand,
  onSelectRecord,
  onUpdateItem,
  protocols,
  reviewError,
  reviewSource,
  reviews,
}: {
  copiedCommandId: string | null;
  onCopyCommand: (command: string, id: string) => void;
  onSelectRecord: (record: EngineeringOperationRecord) => void;
  onUpdateItem: (
    deployProtocol: string,
    item: HomologationItem,
    patch: Partial<Pick<HomologationItemReview, "note" | "status">>,
  ) => void;
  protocols: HubReleaseProtocol[];
  reviewError: string | null;
  reviewSource: "local" | "loading" | "shared";
  reviews: HomologationReviewState;
}) {
  const summaries = protocols.map((protocol) =>
    getHomologationSummary(protocol, reviews),
  );
  const moduleGroups = buildReleaseModuleGroups(protocols);
  const approvedItems = summaries.reduce(
    (sum, summary) => sum + summary.approved,
    0,
  );
  const blockedItems = summaries.reduce(
    (sum, summary) => sum + summary.blocked + summary.rejected,
    0,
  );
  const readyDeploys = summaries.filter(
    (summary) => summary.canGeneratePrompt,
  ).length;

  return (
    <Surface
      bordered
      className="min-w-0 overflow-hidden border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <PanelTitle
            eyebrow={`${moduleGroups.length} modulos em homologacao`}
            icon={<ClipboardCheck size={18} />}
            title="Homologacao por modulo"
          />
          <p className="m-0 mt-3 max-w-4xl text-sm leading-6 text-slate-600">
            Valide cada pacote publicado pelo agente do modulo em homologacao.
            No final, a Athena gera o prompt por modulo para Hefesto publicar
            somente os itens aprovados; reprovados ou bloqueados ficam fora do
            recorte de producao.
          </p>
        </div>
        <Badge variant={blockedItems > 0 ? "danger" : "info"}>
          {blockedItems > 0 ? "Com bloqueio" : "Controle manual"}
        </Badge>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-semibold">
        <Badge
          variant={
            reviewSource === "shared"
              ? "success"
              : reviewSource === "loading"
                ? "neutral"
                : "warning"
          }
        >
          {reviewSource === "shared"
            ? "Banco compartilhado"
            : reviewSource === "loading"
              ? "Carregando persistencia"
              : "Fallback local"}
        </Badge>
        {reviewError ? (
          <span className="text-[#B26A00]">{reviewError}</span>
        ) : null}
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-4">
        <HomologationMetric label="Modulos" value={String(moduleGroups.length)} />
        <HomologationMetric label="Aprovados" value={String(approvedItems)} />
        <HomologationMetric label="Com bloqueio" value={String(blockedItems)} />
        <HomologationMetric label="Prompts Hefesto" value={String(readyDeploys)} />
      </div>

      <div className="mt-5 grid max-h-[62vh] gap-3 overflow-y-auto pr-1">
        {moduleGroups.length > 0 ? (
          moduleGroups.map((moduleGroup) => (
            <HomologationModuleGroupSection
              copiedCommandId={copiedCommandId}
              group={moduleGroup}
              key={`homologation-${moduleGroup.module}`}
              onCopyCommand={onCopyCommand}
              onSelectRecord={onSelectRecord}
              onUpdateItem={onUpdateItem}
              reviews={reviews}
            />
          ))
        ) : (
          <EmptyState message="Nenhum modulo em homologacao para os filtros atuais." />
        )}
      </div>
    </Surface>
  );
}

function HomologationMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200/70 bg-slate-50/50 p-4">
      <p className="m-0 text-[0.68rem] font-semibold uppercase text-slate-400">
        {label}
      </p>
      <p className="m-0 mt-2 text-xl font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function HomologationModuleGroupSection({
  copiedCommandId,
  group,
  onCopyCommand,
  onSelectRecord,
  onUpdateItem,
  reviews,
}: {
  copiedCommandId: string | null;
  group: ReleaseModuleGroup;
  onCopyCommand: (command: string, id: string) => void;
  onSelectRecord: (record: EngineeringOperationRecord) => void;
  onUpdateItem: (
    deployProtocol: string,
    item: HomologationItem,
    patch: Partial<Pick<HomologationItemReview, "note" | "status">>,
  ) => void;
  reviews: HomologationReviewState;
}) {
  const summary = getHomologationModuleSummary(group.protocols, reviews);

  return (
    <section className="grid gap-3 border-b border-slate-100 pb-4 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-slate-50/70 p-3 ring-1 ring-slate-200/70">
        <div className="min-w-0">
          <p className="m-0 text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-[#7A5E2C]">
            {group.agent}
          </p>
          <h3 className="m-0 mt-1 text-sm font-semibold text-slate-950">
            {group.module}
          </h3>
          <p className="m-0 mt-1 text-xs leading-5 text-slate-500">
            {group.protocols.length} pacote(s), {summary.total} item(ns) de
            homologacao e {summary.readyPackages} prompt(s) liberado(s).
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Badge variant="success">{summary.approved} aprovados</Badge>
          <Badge variant={summary.blocked > 0 ? "danger" : "info"}>
            {summary.blocked} bloqueios
          </Badge>
        </div>
      </div>

      {group.protocols.map((releaseProtocol) => (
        <HomologationReleaseCard
          copiedCommandId={copiedCommandId}
          key={`homologation-${group.module}-${releaseProtocol.protocol}`}
          onCopyCommand={onCopyCommand}
          onSelectRecord={onSelectRecord}
          onUpdateItem={onUpdateItem}
          releaseProtocol={releaseProtocol}
          reviews={reviews}
        />
      ))}
    </section>
  );
}

function HomologationReleaseCard({
  copiedCommandId,
  onCopyCommand,
  onSelectRecord,
  onUpdateItem,
  releaseProtocol,
  reviews,
}: {
  copiedCommandId: string | null;
  onCopyCommand: (command: string, id: string) => void;
  onSelectRecord: (record: EngineeringOperationRecord) => void;
  onUpdateItem: (
    deployProtocol: string,
    item: HomologationItem,
    patch: Partial<Pick<HomologationItemReview, "note" | "status">>,
  ) => void;
  releaseProtocol: HubReleaseProtocol;
  reviews: HomologationReviewState;
}) {
  const summary = getHomologationSummary(releaseProtocol, reviews);
  const items = getHomologationItems(releaseProtocol);
  const promptId = `production-prompt-${releaseProtocol.protocol}`;
  const productionPrompt = buildProductionReleasePrompt(
    releaseProtocol,
    items,
    reviews,
    summary,
  );
  const promptTooltip = summary.canGeneratePrompt
    ? summary.isPartial
      ? `Gerar prompt parcial de producao para ${releaseProtocol.protocol}`
      : `Gerar prompt de producao para ${releaseProtocol.protocol}`
    : summary.approved === 0
      ? "Aprove pelo menos um item antes de gerar o prompt"
      : "Conclua itens em teste ou aguardando teste antes do prompt";

  return (
    <article className="rounded-xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 font-mono text-xs font-semibold text-[#7A5E2C]">
            {releaseProtocol.protocol}
          </p>
          <h3 className="m-0 mt-1 line-clamp-2 text-sm font-semibold text-slate-950">
            {releaseProtocol.title}
          </h3>
          <p className="m-0 mt-1 text-xs font-semibold text-slate-500">
            {formatReleaseModuleList(releaseProtocol)} /{" "}
            {formatOperationDateTime(releaseProtocol.plannedAt)}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Badge variant={summary.hasBlocker ? "danger" : "warning"}>
            {summary.approved}/{summary.total} aprovados
          </Badge>
          {summary.isPartial ? <Badge variant="warning">Parcial</Badge> : null}
          <Badge variant="info">Homologacao</Badge>
        </div>
      </div>

      <div className="mt-4 grid gap-2">
        {items.map((item) => (
          <HomologationItemRow
            deployProtocol={releaseProtocol.protocol}
            item={item}
            key={`${releaseProtocol.protocol}-${item.protocol}`}
            onSelectRecord={onSelectRecord}
            onUpdateItem={onUpdateItem}
            review={getHomologationItemReview(
              reviews,
              releaseProtocol.protocol,
              item.protocol,
            )}
          />
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50/80 p-3 ring-1 ring-slate-200/70">
        <p className="m-0 text-xs leading-5 text-slate-600">
          {summary.canGeneratePrompt
            ? summary.isPartial
              ? "Homologacao parcial concluida. A Athena gera o prompt levando somente os aprovados para producao."
              : "Homologacao concluida. A Athena ja pode gerar o prompt para producao."
            : summary.approved === 0
              ? "Aprove pelo menos um item para liberar o prompt final."
              : "Ainda existem itens aguardando teste ou em teste."}
        </p>
        <Tooltip content={promptTooltip} placement="top">
          <button
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#101820] px-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#1f2d3a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B] disabled:cursor-not-allowed disabled:bg-slate-300"
            disabled={!summary.canGeneratePrompt}
            onClick={() => onCopyCommand(productionPrompt, promptId)}
            type="button"
          >
            {copiedCommandId === promptId ? (
              <ClipboardCheck className="size-4" />
            ) : (
              <Copy className="size-4" />
            )}
            {copiedCommandId === promptId
              ? "Prompt copiado"
              : summary.isPartial
                ? "Gerar prompt parcial"
                : "Gerar prompt para producao"}
          </button>
        </Tooltip>
      </div>
    </article>
  );
}

function HomologationItemRow({
  deployProtocol,
  item,
  onSelectRecord,
  onUpdateItem,
  review,
}: {
  deployProtocol: string;
  item: HomologationItem;
  onSelectRecord: (record: EngineeringOperationRecord) => void;
  onUpdateItem: (
    deployProtocol: string,
    item: HomologationItem,
    patch: Partial<Pick<HomologationItemReview, "note" | "status">>,
  ) => void;
  review: HomologationItemReview;
}) {
  return (
    <div className="grid gap-3 rounded-lg border border-slate-200/70 bg-slate-50/40 p-3 lg:grid-cols-[minmax(0,1fr)_12rem_minmax(14rem,0.9fr)]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {item.record ? (
            <button
              className="font-mono text-xs font-semibold text-[#7A5E2C] underline-offset-2 hover:underline"
              onClick={() => onSelectRecord(item.record!)}
              type="button"
            >
              {item.protocol}
            </button>
          ) : (
            <span className="font-mono text-xs font-semibold text-[#7A5E2C]">
              {item.protocol}
            </span>
          )}
          <Badge variant={homologationKindVariant(item.kind)}>
            {item.kind}
          </Badge>
        </div>
        <p className="m-0 mt-1 line-clamp-2 text-sm font-semibold text-slate-950">
          {item.title}
        </p>
        <p className="m-0 mt-1 text-xs font-semibold text-slate-500">
          {item.module} / {item.type}
        </p>
      </div>

      <label className="block">
        <span className="mb-1 block text-[0.68rem] font-semibold uppercase text-slate-400">
          Validacao
        </span>
        <select
          className={fieldClassName}
          onChange={(event) =>
            onUpdateItem(deployProtocol, item, {
              status: event.target.value as HomologationReviewStatus,
            })
          }
          value={review.status}
        >
          {homologationStatusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-[0.68rem] font-semibold uppercase text-slate-400">
          Observacao
        </span>
        <input
          className={fieldClassName}
          onChange={(event) =>
            onUpdateItem(deployProtocol, item, {
              note: event.target.value,
            })
          }
          placeholder="Ex.: testado e aprovado"
          value={review.note}
        />
      </label>
    </div>
  );
}

function OperationsFiltersBar({
  filters,
  onChange,
  options,
}: {
  filters: OperationsFilters;
  onChange: (filters: OperationsFilters) => void;
  options?: EngineeringOperationsResponse["filters"];
}) {
  function updateFilter<Key extends keyof OperationsFilters>(
    key: Key,
    value: OperationsFilters[Key],
  ) {
    onChange({
      ...filters,
      [key]: value,
    });
  }

  return (
    <Surface
      bordered
      className="border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[repeat(6,minmax(0,1fr))_minmax(14rem,1.4fr)]">
        <FilterSelect
          label="Módulo"
          options={options?.modules ?? []}
          value={filters.module}
          onChange={(value) => updateFilter("module", value)}
        />
        <FilterSelect
          label="Squad"
          options={options?.squads ?? []}
          value={filters.squad}
          onChange={(value) => updateFilter("squad", value)}
        />
        <FilterSelect
          label="Tipo"
          options={options?.types ?? []}
          value={filters.type}
          onChange={(value) => updateFilter("type", value)}
        />
        <FilterSelect
          label="Status"
          options={options?.statuses ?? []}
          value={filters.status}
          onChange={(value) => updateFilter("status", value)}
        />
        <FilterSelect
          label="Rotina"
          options={options?.routines ?? []}
          value={filters.routine}
          onChange={(value) => updateFilter("routine", value)}
        />
        <FilterSelect
          label="Período"
          options={["Hoje", "7 dias", "30 dias", "90 dias"]}
          value={filters.period}
          onChange={(value) => updateFilter("period", value)}
        />
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-slate-500">
            Palavra-chave
          </span>
          <span className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#A07C3B]" />
            <input
              className={`${fieldClassName} pl-9`}
              onChange={(event) => updateFilter("keyword", event.target.value)}
              placeholder="Buscar protocolo, assunto, modulo, risco..."
              value={filters.keyword}
            />
          </span>
        </label>
      </div>
    </Surface>
  );
}

function FilterSelect({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: string[];
  value: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-slate-500">
        {label}
      </span>
      <select
        className={fieldClassName}
        onChange={(event: ChangeEvent<HTMLSelectElement>) =>
          onChange(event.target.value)
        }
        value={value}
      >
        <option value={allFilterValue}>Todos</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function getRecordCardSummary(record: EngineeringOperationRecord) {
  const candidates = [
    record.shortSummary,
    record.risks,
    record.reason,
    record.deploy,
    record.macroSummary,
  ];
  const summary = candidates.find(
    (candidate) =>
      candidate.trim() && candidate.trim() !== UNKNOWN_OPERATION_VALUE,
  );

  return summary ?? "Resumo operacional nao informado.";
}

function getRecordChangeSummary(record: EngineeringOperationRecord) {
  return getKnownRecordValue([
    record.macroSummary,
    record.how,
    record.shortSummary,
    record.affectedFiles,
  ]);
}

function getRecordReasonSummary(record: EngineeringOperationRecord) {
  return getKnownRecordValue([record.reason, record.logic, record.risks]);
}

function getKnownRecordValue(values: string[]) {
  return (
    values.find(
      (value) => value.trim() && value.trim() !== UNKNOWN_OPERATION_VALUE,
    ) ?? "Nao informado."
  );
}

function buildProtocolModuleGroups(records: EngineeringOperationRecord[]) {
  const moduleMap = new Map<
    string,
    Map<string, EngineeringOperationRecord[]>
  >();

  for (const record of records) {
    const moduleName = record.module || UNKNOWN_OPERATION_VALUE;
    const categoryName =
      record.changeCategory || record.type || UNKNOWN_OPERATION_VALUE;
    const categoryMap =
      moduleMap.get(moduleName) ??
      new Map<string, EngineeringOperationRecord[]>();
    const categoryRecords = categoryMap.get(categoryName) ?? [];

    categoryRecords.push(record);
    categoryMap.set(categoryName, categoryRecords);
    moduleMap.set(moduleName, categoryMap);
  }

  return Array.from(moduleMap.entries()).map(([moduleName, categoryMap]) => {
    const categories = Array.from(categoryMap.entries()).map(
      ([category, categoryRecords]) => ({
        category,
        records: categoryRecords.slice(0, 8),
      }),
    );

    return {
      categories,
      count: categories.reduce(
        (total, category) => total + category.records.length,
        0,
      ),
      module: moduleName,
    };
  });
}

function protocolCategoryVariant(category: string): BadgeVariant {
  const normalizedCategory = normalizeSearchText(category);

  if (normalizedCategory.includes("release")) {
    return "success";
  }

  if (
    normalizedCategory.includes("correcao") ||
    normalizedCategory.includes("investigacao")
  ) {
    return "warning";
  }

  if (
    normalizedCategory.includes("melhoria") ||
    normalizedCategory.includes("criacao")
  ) {
    return "info";
  }

  return "neutral";
}

function releaseProtocolStatusVariant(
  status: ReleaseProtocolStatus,
): BadgeVariant {
  if (
    status === "em_producao" ||
    status === "finalizado" ||
    status === "homologado"
  ) {
    return "success";
  }

  if (status === "em_homologacao" || status === "aguardando_producao") {
    return "info";
  }

  if (status === "bloqueado" || status === "rollback") {
    return "danger";
  }

  if (status === "aguardando_homologacao") {
    return "warning";
  }

  return "neutral";
}

function CriticalOperationsPanel({
  onSelectRecord,
  onSelectRoutine,
  records,
  routines,
  title,
}: {
  onSelectRecord: (record: EngineeringOperationRecord) => void;
  onSelectRoutine: (routine: EngineeringAuditRoutine) => void;
  records: EngineeringOperationRecord[];
  routines: EngineeringAuditRoutine[];
  title: string;
}) {
  return (
    <Surface
      bordered
      className="min-w-0 overflow-hidden border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
      <PanelTitle
        eyebrow={`${records.length + routines.length} itens`}
        icon={<ShieldAlert size={18} />}
        title={title}
      />
      <div className="mt-4 grid max-h-[58vh] min-w-0 gap-2 overflow-y-auto overscroll-contain pr-1">
        {routines.map((routine) => (
          <button
            className="w-full min-w-0 overflow-hidden rounded-xl border border-amber-200 bg-amber-50 p-3 text-left transition-colors hover:border-amber-300 hover:bg-amber-100/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            key={routine.id}
            onClick={() => onSelectRoutine(routine)}
            type="button"
          >
            <p className="m-0 line-clamp-2 break-words text-sm font-semibold text-amber-900">
              {routine.name}
            </p>
            <p className="m-0 mt-1 text-xs leading-5 text-amber-800">
              Rotina vencida ou não executada. Última execução:{" "}
              {formatOperationDateTime(routine.lastExecution)}.
            </p>
          </button>
        ))}
        {records.length > 0 ? (
          records.map((record) => (
            <button
              className="w-full min-w-0 overflow-hidden rounded-xl border border-slate-200/70 bg-white p-3 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
              key={record.id}
              onClick={() => onSelectRecord(record)}
              type="button"
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="m-0 line-clamp-2 break-words text-sm font-semibold text-slate-950">
                    {record.subject}
                  </p>
                  <p className="m-0 mt-1 truncate text-xs leading-5 text-slate-500">
                    {record.module} / {record.routine}
                  </p>
                </div>
                <Badge
                  className="max-w-[9.5rem] shrink-0 truncate"
                  variant={statusVariant(record.status)}
                >
                  {record.status}
                </Badge>
              </div>
              <p className="m-0 mt-2 line-clamp-2 text-xs leading-5 text-slate-600">
                {getRecordCardSummary(record)}
              </p>
            </button>
          ))
        ) : routines.length === 0 ? (
          <EmptyState message="Sem pendência crítica consolidada." />
        ) : null}
      </div>
    </Surface>
  );
}

function OperationalList({
  icon,
  onSelectRecord,
  records,
  title,
}: {
  icon: ReactNode;
  onSelectRecord: (record: EngineeringOperationRecord) => void;
  records: EngineeringOperationRecord[];
  title: string;
}) {
  return (
    <Surface
      bordered
      className="min-w-0 overflow-hidden border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
      <PanelTitle
        eyebrow={`${records.length} itens`}
        icon={icon}
        title={title}
      />
      <div className="mt-4 grid max-h-[46vh] min-w-0 gap-2 overflow-y-auto overscroll-contain pr-1">
        {records.length > 0 ? (
          records.map((record) => (
            <button
              className="w-full min-w-0 overflow-hidden rounded-xl border border-slate-200/70 bg-white p-3 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
              key={record.id}
              onClick={() => onSelectRecord(record)}
              type="button"
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="m-0 line-clamp-2 break-words text-sm font-semibold text-slate-950">
                    {record.subject}
                  </p>
                  <p className="m-0 mt-1 truncate text-xs leading-5 text-slate-500">
                    {record.module} / {record.type}
                  </p>
                </div>
                <Badge
                  className="max-w-[9.5rem] shrink-0 truncate"
                  variant={statusVariant(record.status)}
                >
                  {record.status}
                </Badge>
              </div>
              <p className="m-0 mt-2 line-clamp-2 text-xs leading-5 text-slate-600">
                {getRecordCardSummary(record)}
              </p>
            </button>
          ))
        ) : (
          <EmptyState message="Sem registro nesta categoria." />
        )}
      </div>
    </Surface>
  );
}

function OperationDetailDrawer({
  onClose,
  record,
}: {
  onClose: () => void;
  record: EngineeringOperationRecord | null;
}) {
  if (!record) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/20 backdrop-blur-[1px]">
      <button
        aria-label="Fechar detalhe operacional"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        type="button"
      />
      <aside className="absolute inset-y-0 right-0 z-10 flex w-full max-w-2xl flex-col border-l border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5">
          <PanelTitle
            icon={<FileText size={18} />}
            eyebrow={formatOperationDateTime(record.localDateTime)}
            title="Detalhe operacional"
          />
          <button
            className="grid size-9 place-items-center rounded-lg border border-slate-200/70 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-950"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[#A07C3B]/10 px-2.5 py-1 text-xs font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
              {record.protocol}
            </span>
            <Badge variant={statusVariant(record.status)}>
              {record.status}
            </Badge>
            <span className="rounded-full bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200/70">
              {record.type}
            </span>
            <span className="rounded-full bg-[#A07C3B]/5 px-2.5 py-1 text-xs font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
              {record.module}
            </span>
          </div>
          <h2 className="m-0 mt-4 text-xl font-semibold text-slate-950">
            {record.subject}
          </h2>
          <p className="m-0 mt-2 text-sm leading-6 text-slate-600">
            {record.shortSummary}
          </p>

          <OperationalDetailSummary record={record} />

          <details className="mt-5 rounded-xl border border-slate-200/70 bg-slate-50/70 p-4">
            <summary className="cursor-pointer text-xs font-semibold uppercase text-slate-500">
              Conteudo bruto do registro
            </summary>
            <pre className="m-0 mt-3 max-h-80 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-slate-700">
              {record.rawContent}
            </pre>
          </details>
        </div>
      </aside>
    </div>
  );
}

function OperationalDetailSummary({
  record,
}: {
  record: EngineeringOperationRecord;
}) {
  const metadata = [
    { label: "Tela", value: record.screen },
    { label: "Categoria", value: record.changeCategory },
    { label: "Squad", value: record.squad },
    { label: "Proxima squad", value: record.nextSquad },
    { label: "Commit", value: record.commit },
    { label: "Deploy", value: record.deploy },
  ].filter((item) => isKnownDetailValue(item.value));

  const sections = [
    {
      items: [record.reason],
      title: "Por que mudou",
    },
    {
      items: [record.macroSummary, record.affectedFiles],
      title: "O que foi alterado",
    },
    {
      items: [record.how, record.logic],
      title: "Como foi conduzido",
    },
    {
      items: [record.validation, record.healthchecks],
      title: "Validacao e deploy",
    },
    {
      items: [record.risks],
      title: "Riscos e pendencias",
    },
  ]
    .map((section) => ({
      ...section,
      items: section.items.filter(isKnownDetailValue),
    }))
    .filter((section) => section.items.length > 0);

  return (
    <div className="mt-5 rounded-xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex flex-wrap gap-2">
        {metadata.length > 0 ? (
          metadata.map((item) => (
            <span
              className="rounded-full bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200/70"
              key={`${item.label}-${item.value}`}
            >
              {item.label}: {item.value}
            </span>
          ))
        ) : (
          <span className="text-sm text-slate-500">
            Dados principais nao informados.
          </span>
        )}
      </div>

      <div className="mt-5 grid gap-4">
        {sections.length > 0 ? (
          sections.map((section) => (
            <section
              className="border-t border-slate-100 pt-4 first:border-t-0 first:pt-0"
              key={section.title}
            >
              <h3 className="m-0 text-sm font-semibold text-slate-950">
                {section.title}
              </h3>
              <ul className="m-0 mt-2 grid list-none gap-2 p-0 text-sm leading-6 text-slate-700">
                {section.items.map((item, index) => (
                  <li
                    className="grid grid-cols-[0.45rem_minmax(0,1fr)] gap-3"
                    key={`${section.title}-${index}`}
                  >
                    <span className="mt-[0.62rem] size-1.5 rounded-full bg-[#A07C3B]" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))
        ) : (
          <p className="m-0 text-sm text-slate-500">
            Detalhamento operacional nao informado.
          </p>
        )}
      </div>
    </div>
  );
}

function isKnownDetailValue(value: string) {
  return Boolean(value.trim() && value.trim() !== UNKNOWN_OPERATION_VALUE);
}

function readHomologationReviews(): HomologationReviewState {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const rawValue = window.localStorage.getItem(homologationStorageKey);

    if (!rawValue) {
      return {};
    }

    const parsedValue = JSON.parse(rawValue) as HomologationReviewState;

    if (!parsedValue || typeof parsedValue !== "object") {
      return {};
    }

    return parsedValue;
  } catch {
    return {};
  }
}

function writeHomologationReviews(reviews: HomologationReviewState) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(homologationStorageKey, JSON.stringify(reviews));
  } catch {
    // A homologacao continua utilizavel mesmo sem persistencia local.
  }
}

function buildReleaseModuleGroups(
  releaseProtocols: HubReleaseProtocol[],
): ReleaseModuleGroup[] {
  const groups = new Map<string, HubReleaseProtocol[]>();

  releaseProtocols.forEach((releaseProtocol) => {
    const moduleNames = getReleaseProtocolModules(releaseProtocol);

    moduleNames.forEach((moduleName) => {
      const current = groups.get(moduleName) ?? [];
      groups.set(moduleName, [...current, releaseProtocol]);
    });
  });

  return Array.from(groups.entries())
    .map(([moduleName, protocols]) => {
      const sortedProtocols = protocols.sort(
        (first, second) =>
          parseReleaseProtocolTime(second) - parseReleaseProtocolTime(first),
      );
      const activityCount = new Set(
        sortedProtocols.flatMap((protocol) => protocol.includedProtocols),
      ).size;

      return {
        activityCount,
        agent: getModuleHomologationAgent(moduleName),
        latestAt: sortedProtocols[0]?.plannedAt ?? "",
        module: moduleName,
        protocols: sortedProtocols,
      } satisfies ReleaseModuleGroup;
    })
    .sort(
      (first, second) =>
        parseOperationDateTime(second.latestAt) -
        parseOperationDateTime(first.latestAt),
    );
}

function getHomologationModuleSummary(
  protocols: HubReleaseProtocol[],
  reviews: HomologationReviewState,
): HomologationModuleSummary {
  const summaries = protocols.map((protocol) =>
    getHomologationSummary(protocol, reviews),
  );

  return {
    approved: summaries.reduce((sum, summary) => sum + summary.approved, 0),
    blocked: summaries.reduce(
      (sum, summary) => sum + summary.blocked + summary.rejected,
      0,
    ),
    readyPackages: summaries.filter((summary) => summary.canGeneratePrompt)
      .length,
    total: summaries.reduce((sum, summary) => sum + summary.total, 0),
  };
}

function isReleaseProtocolReadyForProduction(
  releaseProtocol: HubReleaseProtocol,
) {
  return (
    releaseProtocol.status === "homologado" ||
    releaseProtocol.status === "aguardando_producao"
  );
}

function getReleaseProtocolModules(releaseProtocol: HubReleaseProtocol) {
  const modules = releaseProtocol.modules.length
    ? releaseProtocol.modules
    : [releaseProtocol.module];

  const normalizedModules = Array.from(
    new Set(
      modules
        .filter(isKnownOperationValue)
        .map((moduleName) => formatPanteonModuleName(moduleName)),
    ),
  );

  return normalizedModules.length ? normalizedModules : ["Panteon"];
}

function formatReleaseModuleList(releaseProtocol: HubReleaseProtocol) {
  return getReleaseProtocolModules(releaseProtocol).join(", ");
}

function formatPrimaryReleaseModule(releaseProtocol: HubReleaseProtocol) {
  return getReleaseProtocolModules(releaseProtocol)[0] ?? "Panteon";
}

function formatPanteonModuleName(moduleName: string) {
  const normalized = normalizeSearchText(moduleName);

  if (
    normalized.includes("squadops") ||
    normalized.includes("hubops") ||
    normalized.includes("operations")
  ) {
    return "Zeus";
  }

  if (normalized.includes("guardian") || normalized.includes("hades")) {
    return "Hades";
  }

  if (
    normalized.includes("caredesk") ||
    normalized.includes("coredesk") ||
    normalized.includes("iris")
  ) {
    return "Iris";
  }

  if (normalized.includes("pulsex") || normalized.includes("hermes")) {
    return "Hermes";
  }

  if (normalized.includes("chronos")) {
    return "Chronos";
  }

  if (normalized.includes("atlas")) {
    return "Atlas";
  }

  if (normalized.includes("setup")) {
    return "Setup";
  }

  return moduleName.trim() || "Panteon";
}

function getModuleHomologationAgent(moduleName: string) {
  const normalizedModule = formatPanteonModuleName(moduleName);

  if (normalizedModule === "Panteon") {
    return "Agente do modulo";
  }

  return `${normalizedModule} Core`;
}

function parseReleaseProtocolTime(releaseProtocol: HubReleaseProtocol) {
  return parseOperationDateTime(releaseProtocol.plannedAt);
}

function parseOperationDateTime(value: string) {
  return parseLocalDateTime(value)?.getTime() ?? 0;
}

function isReleaseProtocolInHomologation(releaseProtocol: HubReleaseProtocol) {
  const text = normalizeSearchText(
    [
      releaseProtocol.environment,
      releaseProtocol.status,
      releaseProtocol.title,
      releaseProtocol.summary,
      releaseProtocol.record.status,
      releaseProtocol.record.reason,
      releaseProtocol.record.how,
    ].join(" "),
  );

  return (
    releaseProtocol.environment === "homologacao" ||
    releaseProtocol.status === "aguardando_homologacao" ||
    releaseProtocol.status === "em_homologacao" ||
    releaseProtocol.status === "homologado" ||
    text.includes("homolog")
  );
}

function getHomologationItems(
  releaseProtocol: HubReleaseProtocol,
): HomologationItem[] {
  const protocolRecords = new Map(
    [releaseProtocol.record, ...releaseProtocol.records].map((record) => [
      record.protocol,
      record,
    ]),
  );
  const deployItem: HomologationItem = {
    kind: "deploy",
    module: releaseProtocol.modules.join(", ") || releaseProtocol.module,
    protocol: releaseProtocol.protocol,
    record: releaseProtocol.record,
    title: releaseProtocol.title,
    type: "Release",
  };
  const relatedItems = releaseProtocol.includedProtocols.map((protocol) => {
    const record = protocolRecords.get(protocol) ?? null;

    return {
      kind: getHomologationProtocolKind(protocol),
      module: record?.module ?? releaseProtocol.module,
      protocol,
      record,
      title: record?.subject ?? `Registro ${protocol}`,
      type: record?.type ?? "Registro operacional",
    } satisfies HomologationItem;
  });

  return [deployItem, ...relatedItems];
}

function getHomologationItemReview(
  reviews: HomologationReviewState,
  deployProtocol: string,
  itemProtocol: string,
): HomologationItemReview {
  return (
    reviews[deployProtocol]?.[itemProtocol] ?? {
      note: "",
      status: "aguardando_teste",
      updatedAt: "",
    }
  );
}

function getHomologationSummary(
  releaseProtocol: HubReleaseProtocol,
  reviews: HomologationReviewState,
): HomologationSummary {
  const items = getHomologationItems(releaseProtocol);
  const statuses = items.map(
    (item) =>
      getHomologationItemReview(
        reviews,
        releaseProtocol.protocol,
        item.protocol,
      ).status,
  );
  const approved = statuses.filter((status) => status === "aprovado").length;
  const rejected = statuses.filter((status) => status === "reprovado").length;
  const blocked = statuses.filter((status) => status === "bloqueado").length;
  const inTest = statuses.filter((status) => status === "em_teste").length;
  const waiting = statuses.filter(
    (status) => status === "aguardando_teste",
  ).length;
  const hasBlocker = blocked > 0 || rejected > 0;
  const hasOpenReview = waiting > 0 || inTest > 0;
  const isReady = items.length > 0 && approved === items.length && !hasBlocker;
  const canGeneratePrompt = approved > 0 && !hasOpenReview;

  return {
    approved,
    blocked,
    canGeneratePrompt,
    hasBlocker,
    inTest,
    isPartial: canGeneratePrompt && !isReady,
    isReady,
    rejected,
    total: items.length,
    waiting,
  };
}

function buildProductionReleasePrompt(
  releaseProtocol: HubReleaseProtocol,
  items: HomologationItem[],
  reviews: HomologationReviewState,
  summary: HomologationSummary,
) {
  const moduleLabel = formatPrimaryReleaseModule(releaseProtocol);
  const moduleAgent = getModuleHomologationAgent(moduleLabel);
  const itemLines = items.map((item) => {
    const review = getHomologationItemReview(
      reviews,
      releaseProtocol.protocol,
      item.protocol,
    );
    const note = review.note.trim() ? ` - ${review.note.trim()}` : "";

    return `- ${item.protocol} | ${item.module} | ${item.type} | ${getHomologationStatusLabel(review.status)}${note}`;
  });
  const approvedItems = items.filter(
    (item) =>
      getHomologationItemReview(
        reviews,
        releaseProtocol.protocol,
        item.protocol,
      ).status === "aprovado",
  );
  const notPublishedItems = items.filter((item) => {
    const status = getHomologationItemReview(
      reviews,
      releaseProtocol.protocol,
      item.protocol,
    ).status;

    return status !== "aprovado";
  });
  const productionMode = summary.isPartial
    ? "aprovacao parcial"
    : "aprovacao completa";

  return [
    "Assunto:",
    `[Hefesto] Publicar producao por ${productionMode} do ${releaseProtocol.protocol}`,
    "",
    "Contexto:",
    `Athena gerou este prompt a partir da homologacao operacional validada pelo Lucas no Zeus.`,
    `Modulo homologado: ${moduleLabel}.`,
    `Agente responsavel pela homologacao: ${moduleAgent}.`,
    `Pacote homologado: ${releaseProtocol.protocol}.`,
    `Titulo: ${releaseProtocol.title}.`,
    `Ambiente homologado: ${getReleaseProtocolEnvironmentLabel(releaseProtocol.environment)}.`,
    "Regra vigente: agente de modulo publica homologacao; Hefesto promove producao somente do recorte aprovado.",
    summary.isPartial
      ? "A homologacao foi parcial: publicar somente os itens aprovados e deixar os demais fora desta rodada."
      : "A homologacao foi completa: todos os itens listados foram aprovados para producao.",
    "",
    "Protocolo de deploy:",
    `- ${releaseProtocol.protocol}`,
    `- Modulo: ${moduleLabel}`,
    `- Agente homologacao: ${moduleAgent}`,
    "",
    "Resultado completo da homologacao:",
    ...itemLines,
    "",
    "Resumo da homologacao:",
    `- ${summary.approved}/${summary.total} itens aprovados.`,
    `- Itens em teste: ${summary.inTest}.`,
    `- Itens aguardando teste: ${summary.waiting}.`,
    `- Itens reprovados/bloqueados: ${summary.rejected + summary.blocked}.`,
    "",
    "Publicar em producao nesta rodada:",
    ...(approvedItems.length > 0
      ? approvedItems.map((item) => `- ${item.protocol} - ${item.title}`)
      : ["- nao informado"]),
    "",
    "Nao publicar nesta rodada:",
    ...(notPublishedItems.length > 0
      ? notPublishedItems.map((item) => {
          const review = getHomologationItemReview(
            reviews,
            releaseProtocol.protocol,
            item.protocol,
          );
          const note = review.note.trim() ? ` - ${review.note.trim()}` : "";

          return `- ${item.protocol} - ${item.title} | ${getHomologationStatusLabel(review.status)}${note}`;
        })
      : ["- nenhum item ficou fora desta rodada"]),
    "",
    "Regra de recorte:",
    "- Publicar somente os itens aprovados acima.",
    "- Se o commit atual misturar aprovados e reprovados, criar novo recorte/commit contendo apenas os aprovados antes do deploy.",
    "- Manter os itens nao aprovados em homologacao, bloqueados ou aguardando correcao conforme a devolutiva.",
    "",
    "Riscos conhecidos:",
    `- ${releaseProtocol.record.risks}`,
    "",
    "Healthchecks esperados:",
    `- ${releaseProtocol.healthchecks}`,
    "",
    "Tarefas para publicacao:",
    "- Confirmar commit/branch do recorte homologado pelo agente do modulo.",
    "- Publicar em producao somente os protocolos aprovados na secao de producao.",
    "- Executar healthchecks pos-deploy.",
    "- Registrar commit, deploy, ambiente e resultado no Engineering Operations.",
    "",
    "Retorno esperado:",
    "- Commit publicado.",
    "- Deployment/alias de producao.",
    "- Healthchecks executados.",
    "- Riscos ou pendencias remanescentes.",
    "",
    "Status esperado:",
    summary.isPartial
      ? "EM PRODUCAO para os aprovados; BLOQUEADO ou AGUARDANDO CORRECAO para os itens que ficaram fora."
      : "EM PRODUCAO se os healthchecks passarem; OPERACIONAL COM ATENCAO se houver risco sem bloqueio.",
  ].join("\n");
}

function getHomologationStatusLabel(status: HomologationReviewStatus) {
  return (
    homologationStatusOptions.find((option) => option.value === status)?.label ??
    "Aguardando teste"
  );
}

function homologationKindVariant(kind: HomologationItem["kind"]): BadgeVariant {
  if (kind === "deploy") {
    return "success";
  }

  if (kind === "alerta" || kind === "cobranca") {
    return "warning";
  }

  return "info";
}

function getHomologationProtocolKind(
  protocol: string,
): Exclude<HomologationItem["kind"], "deploy"> {
  if (protocol.startsWith("AL-")) {
    return "alerta";
  }

  if (protocol.startsWith("AT-")) {
    return "atendimento";
  }

  if (protocol.startsWith("CB-")) {
    return "cobranca";
  }

  if (protocol.startsWith("TI-")) {
    return "ticket";
  }

  return "operacao";
}

function matchesFilters(
  record: EngineeringOperationRecord,
  filters: OperationsFilters,
) {
  const searchable = normalizeSearchText(
    [
      record.protocol,
      record.subject,
      record.module,
      record.squad,
      record.type,
      record.status,
      record.shortSummary,
      record.risks,
      record.nextSquad,
      record.commit,
      record.deploy,
      record.rawContent,
    ].join(" "),
  );
  const keyword = normalizeSearchText(filters.keyword);
  return (
    (filters.module === allFilterValue || record.module === filters.module) &&
    (filters.squad === allFilterValue || record.squad === filters.squad) &&
    (filters.type === allFilterValue || record.type === filters.type) &&
    (filters.routine === allFilterValue ||
      record.routine === filters.routine) &&
    (filters.status === allFilterValue || record.status === filters.status) &&
    matchesPeriod(record.localDateTime, filters.period) &&
    (!keyword || searchable.includes(keyword))
  );
}

function matchesReleaseProtocolFilters(
  releaseProtocol: HubReleaseProtocol,
  filters: OperationsFilters,
) {
  const relatedRecords = [releaseProtocol.record, ...releaseProtocol.records];
  const searchable = normalizeSearchText(
    [
      releaseProtocol.protocol,
      releaseProtocol.title,
      releaseProtocol.summary,
      releaseProtocol.module,
      releaseProtocol.modules.join(" "),
      releaseProtocol.includedProtocols.join(" "),
      releaseProtocol.commit,
      releaseProtocol.deployment,
      releaseProtocol.healthchecks,
      getReleaseProtocolStatusLabel(releaseProtocol.status),
      getReleaseProtocolEnvironmentLabel(releaseProtocol.environment),
      ...relatedRecords.flatMap((record) => [
        record.protocol,
        record.subject,
        record.module,
        record.squad,
        record.type,
        record.status,
        record.shortSummary,
        record.risks,
      ]),
    ].join(" "),
  );
  const keyword = normalizeSearchText(filters.keyword);

  return (
    (filters.module === allFilterValue ||
      releaseProtocol.module === filters.module ||
      releaseProtocol.modules.includes(filters.module) ||
      relatedRecords.some((record) => record.module === filters.module)) &&
    (filters.squad === allFilterValue ||
      relatedRecords.some((record) => record.squad === filters.squad)) &&
    (filters.type === allFilterValue ||
      relatedRecords.some((record) => record.type === filters.type)) &&
    (filters.routine === allFilterValue ||
      relatedRecords.some((record) => record.routine === filters.routine)) &&
    (filters.status === allFilterValue ||
      relatedRecords.some((record) => record.status === filters.status)) &&
    matchesPeriod(releaseProtocol.plannedAt, filters.period) &&
    (!keyword || searchable.includes(keyword))
  );
}

function isOperationsResponse(
  value: EngineeringOperationsResponse | { error?: string } | null,
): value is EngineeringOperationsResponse {
  return Boolean(
    value &&
    "records" in value &&
    Array.isArray(value.records) &&
    "metrics" in value &&
    "filters" in value,
  );
}

function isReleaseRegistersResponse(
  value: ReleaseRegistersApiResponse | { error?: string } | null,
): value is ReleaseRegistersApiResponse {
  return Boolean(
    value &&
      "records" in value &&
      Array.isArray(value.records) &&
      "filters" in value &&
      "sources" in value &&
      Array.isArray(value.sources),
  );
}

function getReleaseRegistersErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Nao foi possivel carregar os registros de deploy por ambiente.";
}

function isStructuredOperationsMigrationMissingError(error: string) {
  const normalizedError = normalizeSearchText(error);

  return (
    normalizedError.includes("hub_engineering_operation_records") &&
    (normalizedError.includes("schema cache") ||
      normalizedError.includes("could not find the table") ||
      normalizedError.includes("does not exist"))
  );
}

function getStructuredOperationsFriendlyError(error: string | null) {
  if (!error) {
    return null;
  }

  if (isStructuredOperationsMigrationMissingError(error)) {
    return "Migration 0013 ainda nao aplicada no Supabase real. A tela continua usando o fallback do Engineering Operations.";
  }

  return error;
}

type StructuredOperationsFetchResult =
  | {
      ok: true;
      records: EngineeringOperationRecord[];
      status: string;
      syncRuns: StructuredSyncRun[];
    }
  | { error: string; ok: false };

async function fetchStructuredOperationsSnapshot(
  headers: Record<string, string>,
): Promise<StructuredOperationsFetchResult> {
  const response = await fetch(
    "/api/zeus/operations/structured?limit=500",
    {
      cache: "no-store",
      headers,
    },
  );
  const payload = (await response
    .json()
    .catch(() => null)) as StructuredOperationsApiResponse | null;

  if (!response.ok || !payload?.storage) {
    return {
      error: payload?.error ?? "Base estruturada de operacoes indisponivel.",
      ok: false,
    };
  }

  return {
    ok: true,
    records: (payload.storage.records ?? []).map(
      mapStructuredApiRecordToRecord,
    ),
    status: payload.storage.status ?? "sincronizado",
    syncRuns: payload.storage.syncRuns ?? [],
  };
}

function buildOperationsResponseFromStructuredRecords({
  fallback,
  records,
  syncRuns,
}: {
  fallback: EngineeringOperationsResponse | null;
  records: EngineeringOperationRecord[];
  syncRuns: StructuredSyncRun[];
}): EngineeringOperationsResponse {
  const sortedRecords = [...records].sort(compareOperationRecordsDesc);
  const generatedAt =
    syncRuns[0]?.created_at ??
    fallback?.generatedAt ??
    new Date().toISOString();
  const auditRoutines = buildStructuredAuditRoutines(
    sortedRecords,
    generatedAt,
  );
  const metrics = buildStructuredMetrics(sortedRecords, auditRoutines);

  return {
    auditRoutines,
    criticalRecords: sortedRecords.filter((record) => record.isCritical),
    filters: buildStructuredFilters(sortedRecords),
    generatedAt,
    metrics,
    records: sortedRecords,
    releaseRecords: sortedRecords.filter((record) => record.isRelease),
    sourcePath: "Supabase: public.hub_engineering_operation_records",
    statusConsolidated: buildStructuredStatus(metrics),
  };
}

function mapStructuredApiRecordToRecord(
  record: StructuredOperationApiRecord,
): EngineeringOperationRecord {
  const rawContent = normalizeStructuredText(record.rawContent);
  const reason = normalizeStructuredText(record.reason);
  const how = normalizeStructuredText(record.how);
  const macroSummary = normalizeStructuredText(record.macroSummary);
  const risks = normalizeStructuredText(record.risks);
  const shortSummary = normalizeStructuredText(record.shortSummary);
  const type = normalizeStructuredText(record.type);
  const status = normalizeStructuredText(record.status);
  const deploy = normalizeStructuredText(record.deploy);
  const commit = normalizeStructuredText(record.commit);
  const moduleName = normalizeModuleAlias(
    normalizeStructuredText(record.module),
  );

  return {
    affectedFiles: normalizeStructuredText(record.affectedFiles),
    changeCategory: normalizeStructuredText(record.changeCategory),
    commit,
    deploy,
    healthchecks: normalizeStructuredText(record.healthchecks),
    how,
    id: `structured-${record.id}`,
    isCritical:
      record.isCritical ||
      hasStructuredCriticalSignal(status, risks, rawContent),
    isModuleImprovement:
      record.isModuleImprovement ||
      normalizeSearchText(type).includes("melhoria") ||
      normalizeSearchText(record.changeCategory).includes("melhoria"),
    isRelease:
      record.isRelease ||
      isKnownOperationValue(deploy) ||
      isKnownOperationValue(commit) ||
      normalizeSearchText(type).includes("release"),
    isSupportInvestigation:
      record.isSupportInvestigation ||
      normalizeSearchText(`${moduleName} ${type}`).includes("supportops") ||
      normalizeSearchText(type).includes("investigacao"),
    lineStart: record.lineStart,
    localDateTime: normalizeStructuredText(
      record.localOccurredAt ?? record.localDateTime,
    ),
    logic: normalizeStructuredText(record.logic),
    macroSummary,
    module: moduleName,
    nextSquad: normalizeStructuredText(record.nextSquad),
    protocol: normalizeStructuredText(record.protocol),
    rawContent,
    reason,
    risks,
    routine: normalizeStructuredText(record.routine),
    screen: normalizeStructuredText(record.screen),
    shortSummary: isKnownOperationValue(shortSummary)
      ? shortSummary
      : compactStructuredSummary(
          getKnownRecordValue([macroSummary, reason, how, risks, rawContent]),
        ),
    sourceIndex: record.sourceIndex,
    squad: normalizeStructuredText(record.squad),
    status,
    subject: normalizeZeusNaming(normalizeStructuredText(record.subject)),
    type,
    validation: normalizeStructuredText(record.validation),
  };
}

function buildStructuredMetrics(
  records: EngineeringOperationRecord[],
  auditRoutines: EngineeringAuditRoutine[],
): EngineeringOperationsResponse["metrics"] {
  return {
    latestDeploys: records.filter((record) =>
      isKnownOperationValue(record.deploy),
    ).length,
    moduleImprovements: records.filter((record) => record.isModuleImprovement)
      .length,
    productionRecords: records.filter((record) =>
      normalizeSearchText(record.status).includes("em producao"),
    ).length,
    riskRecords: records.filter((record) => record.isCritical).length,
    routinesOverdue: auditRoutines.filter((routine) => routine.isOverdue)
      .length,
    supportInvestigations: records.filter(
      (record) => record.isSupportInvestigation,
    ).length,
    totalRecords: records.length,
    waitingReleaseOps: records.filter((record) =>
      normalizeSearchText(record.status).includes("aguardando releaseops"),
    ).length,
  };
}

function buildStructuredFilters(
  records: EngineeringOperationRecord[],
): EngineeringOperationsResponse["filters"] {
  return {
    modules: uniqueStructuredValues(records.map((record) => record.module)),
    routines: uniqueStructuredValues(records.map((record) => record.routine)),
    squads: uniqueStructuredValues(records.map((record) => record.squad)),
    statuses: uniqueStructuredValues(records.map((record) => record.status)),
    types: uniqueStructuredValues(records.map((record) => record.type)),
  };
}

function buildStructuredAuditRoutines(
  records: EngineeringOperationRecord[],
  generatedAt: string,
): EngineeringAuditRoutine[] {
  const definitions = [
    {
      frequency: "Diaria",
      id: "daily-audit",
      name: "Auditoria diaria",
      responsible: "Hefesto",
      script:
        "Revisar registros das ultimas 24h, status abertos, pendencias criticas e handoffs para Hefesto.",
    },
    {
      frequency: "Semanal",
      id: "weekly-audit",
      name: "Auditoria semanal",
      responsible: "Hefesto",
      script:
        "Consolidar releases da semana, modulos com maior risco, bugs recorrentes e prioridades.",
    },
    {
      frequency: "Mensal",
      id: "monthly-audit",
      name: "Auditoria mensal",
      responsible: "Hefesto",
      script:
        "Revisar evolucao mensal, saude dos modulos, riscos estruturais e qualidade das releases.",
    },
    {
      frequency: "Diaria",
      id: "operational-healthcheck",
      name: "Healthcheck operacional",
      responsible: "Hefesto",
      script:
        "Checar rotas principais, APIs protegidas, Supabase, Vercel e logs criticos.",
    },
    {
      frequency: "Por release",
      id: "deploy-audit",
      name: "Auditoria de deploy",
      responsible: "Hefesto",
      script:
        "Confirmar commit, deploy, ambiente, healthchecks, logs e status final da release.",
    },
    {
      frequency: "Sob demanda",
      id: "bugs-bottlenecks-audit",
      name: "Auditoria de bugs/gargalos",
      responsible: "Zeus",
      script:
        "Separar evidencia de hipotese, revisar logs, APIs instaveis e gargalos.",
    },
    {
      frequency: "Diaria",
      id: "critical-pending-audit",
      name: "Auditoria de pendencias criticas",
      responsible: "Hefesto",
      script:
        "Consolidar riscos conhecidos, status criticos, pendencias e rotinas vencidas.",
    },
  ];

  return definitions.map((definition) => {
    const history = records
      .filter(
        (record) =>
          normalizeSearchText(record.routine) ===
          normalizeSearchText(definition.name),
      )
      .slice(0, 6);
    const lastRecord = history[0];
    const lastExecution = lastRecord?.localDateTime ?? UNKNOWN_OPERATION_VALUE;

    return {
      consolidatedResult:
        lastRecord?.shortSummary ??
        "Rotina ainda nao possui registro estruturado explicito.",
      frequency: definition.frequency,
      history,
      id: definition.id,
      isOverdue: isStructuredRoutineOverdue(
        definition.frequency,
        lastExecution,
        generatedAt,
      ),
      lastExecution,
      lastStatus: lastRecord?.status ?? "nao executada",
      name: definition.name,
      responsible: definition.responsible,
      script: definition.script,
    };
  });
}

function buildStructuredStatus(
  metrics: EngineeringOperationsResponse["metrics"],
) {
  if (metrics.riskRecords > 0 || metrics.routinesOverdue > 0) {
    return "OPERACIONAL COM ATENCAO";
  }

  if (metrics.waitingReleaseOps > 0) {
    return "AGUARDANDO RELEASEOPS";
  }

  return "FINALIZADO";
}

function compareOperationRecordsDesc(
  first: EngineeringOperationRecord,
  second: EngineeringOperationRecord,
) {
  const firstTime = parseLocalDateTime(first.localDateTime)?.getTime() ?? 0;
  const secondTime = parseLocalDateTime(second.localDateTime)?.getTime() ?? 0;

  if (secondTime !== firstTime) {
    return secondTime - firstTime;
  }

  return second.sourceIndex - first.sourceIndex;
}

function uniqueStructuredValues(values: string[]) {
  return Array.from(
    new Set(values.filter((value) => isKnownOperationValue(value))),
  ).sort((first, second) => first.localeCompare(second, "pt-BR"));
}

function normalizeStructuredText(value: string | null | undefined) {
  const trimmed = value?.trim();

  return trimmed ? trimmed : UNKNOWN_OPERATION_VALUE;
}

function normalizeModuleAlias(moduleName: string) {
  return normalizeSearchText(moduleName) === "hubops" ? "Zeus" : moduleName;
}

function normalizeZeusNaming(value: string) {
  return value.replace(/\bHubOps\b/g, "Zeus");
}

function isKnownOperationValue(value: string) {
  return Boolean(value.trim() && value.trim() !== UNKNOWN_OPERATION_VALUE);
}

function compactStructuredSummary(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "Resumo operacional nao informado.";
  }

  return normalized.length > 220
    ? `${normalized.slice(0, 217).trim()}...`
    : normalized;
}

function hasStructuredCriticalSignal(
  status: string,
  risks: string,
  rawContent: string,
) {
  const text = normalizeSearchText(`${status} ${risks} ${rawContent}`);

  return (
    text.includes("necessita correcao") ||
    text.includes("operacional com atencao") ||
    text.includes("bloqueado") ||
    text.includes("aguardando releaseops") ||
    text.includes("risco")
  );
}

function isStructuredRoutineOverdue(
  frequency: string,
  lastExecution: string,
  generatedAt: string,
) {
  if (lastExecution === UNKNOWN_OPERATION_VALUE) {
    return true;
  }

  if (frequency === "Sob demanda" || frequency === "Por release") {
    return false;
  }

  const lastDate = parseLocalDateTime(lastExecution);
  const currentDate = new Date(generatedAt);

  if (!lastDate || Number.isNaN(currentDate.getTime())) {
    return true;
  }

  const elapsedDays =
    (currentDate.getTime() - lastDate.getTime()) / (24 * 60 * 60 * 1000);

  if (frequency === "Diaria") {
    return elapsedDays > 1.5;
  }

  if (frequency === "Semanal") {
    return elapsedDays > 8;
  }

  if (frequency === "Mensal") {
    return elapsedDays > 35;
  }

  return false;
}

function statusVariant(status: string): BadgeVariant {
  const normalizedStatus = normalizeSearchText(status);

  if (
    normalizedStatus.includes("em producao") ||
    normalizedStatus.includes("finalizado")
  ) {
    return "success";
  }

  if (
    normalizedStatus.includes("necessita correcao") ||
    normalizedStatus.includes("bloqueado") ||
    normalizedStatus.includes("operacional com atencao")
  ) {
    return "warning";
  }

  if (
    normalizedStatus.includes("aguardando") ||
    normalizedStatus.includes("validando")
  ) {
    return "info";
  }

  return "neutral";
}

function isMonitoringSnapshot(
  value: unknown,
): value is OperationsMonitoringSnapshot {
  const snapshot = value as Partial<OperationsMonitoringSnapshot> | null;

  return Boolean(
    snapshot &&
    typeof snapshot === "object" &&
    Array.isArray(snapshot.alerts) &&
    Array.isArray(snapshot.checks) &&
    snapshot.cards &&
    typeof snapshot.cards === "object" &&
    typeof snapshot.generatedAt === "string" &&
    snapshot.metrics &&
    typeof snapshot.metrics === "object",
  );
}

function mergeAlertProtocols(
  incoming: OperationsAlertProtocolSummary[],
  current: OperationsAlertProtocolSummary[],
) {
  const protocolsByCode = new Map<string, OperationsAlertProtocolSummary>();

  [...incoming, ...current].forEach((protocol) => {
    const existingProtocol = protocolsByCode.get(protocol.protocol);

    if (!existingProtocol) {
      protocolsByCode.set(protocol.protocol, protocol);
      return;
    }

    if (
      shouldHideProtocolAlert(protocol) &&
      !shouldHideProtocolAlert(existingProtocol)
    ) {
      protocolsByCode.set(protocol.protocol, protocol);
    }
  });

  return Array.from(protocolsByCode.values())
    .sort(
      (first, second) =>
        new Date(second.lastSeenAt).getTime() -
        new Date(first.lastSeenAt).getTime(),
    )
    .slice(0, 80);
}

function readLocalAlertProtocolOverrides(): OperationsAlertProtocolSummary[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const rawValue = window.localStorage.getItem(alertProtocolOverrideStorageKey);
    const parsedValue = rawValue ? (JSON.parse(rawValue) as unknown) : null;

    if (!Array.isArray(parsedValue)) {
      return [];
    }

    return parsedValue.filter(isAlertProtocolSummary).slice(0, 80);
  } catch {
    return [];
  }
}

function saveLocalAlertProtocolOverride(
  protocol: OperationsAlertProtocolSummary,
) {
  if (typeof window === "undefined") {
    return;
  }

  const nextProtocols = mergeAlertProtocols(
    [protocol],
    readLocalAlertProtocolOverrides(),
  ).slice(0, 80);

  window.localStorage.setItem(
    alertProtocolOverrideStorageKey,
    JSON.stringify(nextProtocols),
  );
}

function createLocalAlertProtocolOverride({
  protocol,
  status,
}: {
  protocol?: OperationsAlertProtocolSummary;
  status: "monitorando" | "silenciado";
}) {
  if (!protocol) {
    return null;
  }

  const now = new Date().toISOString();
  const isIgnored = status === "silenciado";

  return {
    ...protocol,
    acknowledgedAt: protocol.acknowledgedAt ?? now,
    analysis: {
      action: isIgnored ? "ignorar" : "acompanhar",
      label: isIgnored ? "Ignorado" : "Lido",
      reason: isIgnored
        ? `O protocolo ${protocol.protocol} foi silenciado localmente por Lucas enquanto a migration de alertas esta pendente.`
        : `Lucas confirmou leitura local do protocolo ${protocol.protocol} enquanto a migration de alertas esta pendente.`,
      status: isIgnored ? "ignorado" : "em_tratamento",
    },
    status,
    updatedAt: now,
  } satisfies OperationsAlertProtocolSummary;
}

function isAlertProtocolSummary(
  value: unknown,
): value is OperationsAlertProtocolSummary {
  const protocol = value as Partial<OperationsAlertProtocolSummary> | null;

  return Boolean(
    protocol &&
      typeof protocol === "object" &&
      typeof protocol.protocol === "string" &&
      typeof protocol.title === "string" &&
      typeof protocol.lastSeenAt === "string" &&
      typeof protocol.status === "string",
  );
}

function isAlertProtocolSchemaMissingError(message: string) {
  const normalizedMessage = normalizeSearchText(message);

  return (
    normalizedMessage.includes("hub_operations_alert_protocols") &&
    (normalizedMessage.includes("schema cache") ||
      normalizedMessage.includes("could not find the table") ||
      normalizedMessage.includes("tabela") ||
      normalizedMessage.includes("migration"))
  );
}

function getAlertProtocolActionErrorMessage(error: unknown) {
  const message =
    error instanceof Error && error.message.trim()
      ? error.message
      : "Nao foi possivel atualizar o protocolo do alerta.";

  if (isAlertProtocolSchemaMissingError(message)) {
    return "Persistencia de protocolos pendente: aplicar a migration 0012_hub_operations_alert_protocols no Supabase real.";
  }

  return message;
}

function isProtocolCleared(
  protocolCode: string,
  protocols: OperationsAlertProtocolSummary[],
) {
  const protocol = protocols.find((item) => item.protocol === protocolCode);

  return protocol ? shouldHideProtocolAlert(protocol) : false;
}

function shouldHideProtocolAlert(protocol: OperationsAlertProtocolSummary) {
  return (
    protocol.status === "em_analise" ||
    protocol.status === "monitorando" ||
    protocol.status === "silenciado" ||
    protocol.status === "tratado"
  );
}

function alertToProtocolSummary(
  alert: OperationsAlert,
): OperationsAlertProtocolSummary {
  return {
    acknowledgedAt: null,
    analysis: alert.analysis,
    command: alert.command,
    createdAt: alert.generatedAt,
    endpoint: alert.endpoint,
    expectedResult: alert.expectedResult,
    fingerprint: alert.fingerprint,
    firstSeenAt: alert.generatedAt,
    httpStatus: alert.httpStatus,
    id: alert.protocolId ?? alert.id,
    impact: alert.impact,
    lastSeenAt: alert.lastSeenAt ?? alert.generatedAt,
    level: alert.level,
    module: alert.module,
    occurrenceCount: alert.occurrenceCount ?? 1,
    origin: alert.origin,
    payloadBytes: alert.payloadBytes,
    protocol: alert.protocol,
    receivedResult: alert.receivedResult,
    recommendation: alert.recommendation,
    recommendedAgent: alert.recommendedAgent,
    responseMs: alert.responseMs,
    status:
      alert.protocolStatus ??
      (alert.technicalFeedbackStatus ? "em_analise" : "ativo"),
    technicalFeedback: alert.technicalFeedback ?? null,
    technicalFeedbackAt: alert.technicalFeedbackAt ?? null,
    technicalFeedbackStatus: alert.technicalFeedbackStatus ?? "pendente",
    title: alert.title,
    treatedAt: null,
    type: alert.type,
    updatedAt: alert.lastSeenAt ?? alert.generatedAt,
  };
}

function mergeProtocolIntoAlert(
  alert: OperationsAlert,
  protocol: OperationsAlertProtocolSummary,
): OperationsAlert {
  return {
    ...alert,
    analysis: protocol.analysis,
    command: protocol.command,
    lastSeenAt: protocol.lastSeenAt,
    occurrenceCount: protocol.occurrenceCount,
    protocolStatus: protocol.status,
    protocolId: protocol.id,
    technicalFeedback: protocol.technicalFeedback,
    technicalFeedbackAt: protocol.technicalFeedbackAt,
    technicalFeedbackStatus: protocol.technicalFeedbackStatus,
  };
}

function generalStatusLabel(
  status?: OperationsMonitoringSnapshot["cards"]["status"]["value"],
) {
  if (status === "operacional") {
    return "Operacional";
  }

  if (status === "operacional_com_atencao") {
    return "Operacional com atencao";
  }

  if (status === "critico") {
    return "Critico";
  }

  if (status === "indisponivel") {
    return "Indisponivel";
  }

  return "Aguardando";
}

function statusToBadgeVariant(
  status?: OperationsMonitoringSnapshot["cards"]["status"]["value"],
): BadgeVariant {
  if (status === "operacional") {
    return "success";
  }

  if (status === "critico" || status === "indisponivel") {
    return "danger";
  }

  if (status === "operacional_com_atencao") {
    return "warning";
  }

  return "neutral";
}

function riskToBadgeVariant(
  risk?: OperationsRiskLevel | "nenhum",
): BadgeVariant {
  if (risk === "critico") {
    return "danger";
  }

  if (risk === "alto" || risk === "medio") {
    return "warning";
  }

  if (risk === "baixo") {
    return "success";
  }

  return "neutral";
}

function riskPriority(risk?: OperationsRiskLevel | "nenhum") {
  const priorities = {
    alto: 3,
    baixo: 1,
    critico: 4,
    medio: 2,
    nenhum: 0,
  } as const satisfies Record<OperationsRiskLevel | "nenhum", number>;

  return priorities[risk ?? "nenhum"];
}

function alertFeedbackStatusLabel(status: OperationsAlertFeedbackStatus) {
  const labels = {
    bloqueado: "Bloqueado",
    corrigido: "Corrigido",
    em_analise: "Em analise",
    falso_positivo: "Falso positivo",
    nao_observado: "Nao observado",
    pendente: "Pendente",
    persiste: "Persiste",
  } as const satisfies Record<OperationsAlertFeedbackStatus, string>;

  return labels[status];
}

function alertFeedbackStatusVariant(
  status: OperationsAlertFeedbackStatus,
): BadgeVariant {
  if (status === "corrigido" || status === "nao_observado") {
    return "success";
  }

  if (status === "bloqueado" || status === "persiste") {
    return "warning";
  }

  if (status === "falso_positivo") {
    return "neutral";
  }

  if (status === "em_analise") {
    return "info";
  }

  return "neutral";
}

function riskToGeneralStatus(
  risk?: OperationsRiskLevel | "nenhum",
): OperationsMonitoringSnapshot["cards"]["status"]["value"] {
  if (risk === "critico") {
    return "critico";
  }

  if (risk === "alto" || risk === "medio") {
    return "operacional_com_atencao";
  }

  if (risk === "baixo" || risk === "nenhum") {
    return "operacional";
  }

  return "operacional_com_atencao";
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const kilobytes = bytes / 1024;

  if (kilobytes < 1024) {
    return `${kilobytes.toFixed(kilobytes >= 100 ? 0 : 1)} KB`;
  }

  const megabytes = kilobytes / 1024;

  return `${megabytes.toFixed(megabytes >= 10 ? 1 : 2)} MB`;
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function formatGeneratedAt(value: string) {
  const date = parseServerDateTime(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return `${date.toLocaleString("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    timeZone: hubTimeZone,
  })} BRT`;
}

function parseServerDateTime(value: string) {
  const trimmedValue = value.trim();
  const normalizedValue = normalizeDateTimeForParsing(trimmedValue);

  if (hasExplicitTimeZone(trimmedValue)) {
    return new Date(normalizedValue);
  }

  if (/^\d{4}-\d{2}-\d{2}[T\s]+\d{2}:\d{2}/.test(trimmedValue)) {
    const isoLikeValue = normalizedValue.includes("T")
      ? normalizedValue
      : normalizedValue.replace(/\s+/, "T");

    return new Date(`${isoLikeValue}Z`);
  }

  return new Date(trimmedValue);
}

function formatOperationDateTime(value: string) {
  const date = parseLocalDateTime(value);

  if (!date) {
    return value;
  }

  return [
    date.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      timeZone: hasExplicitTimeZone(value) ? hubTimeZone : undefined,
      year: "2-digit",
    }),
    date.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: hasExplicitTimeZone(value) ? hubTimeZone : undefined,
    }),
  ].join(" ");
}

async function getZeusAccessToken(fallback?: string | null) {
  if (fallback) {
    return fallback;
  }

  const client = getHubSupabaseClient();

  if (client) {
    try {
      const { data } = await client.auth.getSession();
      const sessionAccessToken = data.session?.access_token;

      if (sessionAccessToken) {
        return sessionAccessToken;
      }
    } catch {
      // Keep the Operations Center usable when the provider state exists but
      // the Supabase client cannot hydrate synchronously.
    }
  }

  return getCahedZeusAccessTokenFromStorage();
}

function getCahedZeusAccessTokenFromStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  const candidateKeys = new Set<string>();
  const storageKey = getSupabaseAuthStorageKey(hubSupabaseConfig.url);

  if (storageKey) {
    candidateKeys.add(storageKey);
  }

  if (isLocalRuntime()) {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);

      if (
        key &&
        (key.includes("auth-token") ||
          key.includes("supabase") ||
          key.startsWith("sb-"))
      ) {
        candidateKeys.add(key);
      }
    }
  }

  for (const key of candidateKeys) {
    const rawValue = window.localStorage.getItem(key);

    if (!rawValue) {
      continue;
    }

    try {
      const token = extractZeusAccessToken(JSON.parse(rawValue) as unknown);

      if (token) {
        return token;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function getSupabaseAuthStorageKey(url?: string) {
  const projectRef = getSupabaseProjectRef(url);

  return projectRef ? `sb-${projectRef}-auth-token` : null;
}

function getSupabaseProjectRef(url?: string) {
  if (!url?.trim()) {
    return null;
  }

  try {
    return new URL(url).hostname.split(".")[0] || null;
  } catch {
    return null;
  }
}

function isLocalRuntime() {
  return ["localhost", "127.0.0.1"].includes(window.location.hostname);
}

function extractZeusAccessToken(input: unknown): string | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const maybeSession = input as {
    accessToken?: unknown;
    access_token?: unknown;
    currentSession?: unknown;
    data?: unknown;
    session?: unknown;
  };

  const directToken =
    typeof maybeSession.access_token === "string"
      ? maybeSession.access_token
      : typeof maybeSession.accessToken === "string"
        ? maybeSession.accessToken
        : null;

  if (directToken?.trim()) {
    return directToken;
  }

  return (
    extractZeusAccessToken(maybeSession.currentSession) ??
    extractZeusAccessToken(maybeSession.session) ??
    extractZeusAccessToken(maybeSession.data)
  );
}

function getHomologationReviewErrorMessage(error: unknown) {
  const message =
    error instanceof Error && error.message.trim()
      ? error.message
      : "Homologacao salva localmente; banco compartilhado indisponivel.";
  const normalizedMessage = message
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (
    normalizedMessage.includes("hub_squadops_homologation_reviews") ||
    normalizedMessage.includes("0021_squadops_center_persistence")
  ) {
    return "Migration 0021 pendente; validacao fica local ate o Supabase receber a tabela.";
  }

  return message;
}

function matchesPeriod(localDateTime: string, period: string) {
  if (period === allFilterValue) {
    return true;
  }

  const recordDate = parseLocalDateTime(localDateTime);

  if (!recordDate) {
    return false;
  }

  const now = new Date();
  const elapsedDays =
    (now.getTime() - recordDate.getTime()) / (24 * 60 * 60 * 1000);

  if (period === "Hoje") {
    return now.toDateString() === recordDate.toDateString();
  }

  if (period === "7 dias") {
    return elapsedDays <= 7;
  }

  if (period === "30 dias") {
    return elapsedDays <= 30;
  }

  if (period === "90 dias") {
    return elapsedDays <= 90;
  }

  return true;
}

function parseLocalDateTime(value: string) {
  const normalizedValue = normalizeDateTimeForParsing(value);
  const parsedWithTimeZone = hasExplicitTimeZone(value)
    ? new Date(normalizedValue)
    : null;

  if (parsedWithTimeZone && !Number.isNaN(parsedWithTimeZone.getTime())) {
    return parsedWithTimeZone;
  }

  const match = value.match(
    /(\d{4})-(\d{2})-(\d{2})(?:[T\s]+(\d{2}):(\d{2}):(\d{2}))?/,
  );

  if (!match) {
    return null;
  }

  const [, year, month, day, hour = "00", minute = "00", second = "00"] = match;

  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
}

function hasExplicitTimeZone(value: string) {
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value.trim());
}

function normalizeDateTimeForParsing(value: string) {
  return value
    .trim()
    .replace(
      /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)\s+([+-]\d{2}:?\d{2})$/,
      "$1T$2$3",
    );
}

const fieldClassName =
  "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-[#A07C3B]/40 focus:ring-2 focus:ring-[#A07C3B]/10";
