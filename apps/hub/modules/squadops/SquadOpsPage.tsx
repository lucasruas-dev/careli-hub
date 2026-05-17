"use client";

import { HubShell } from "@/layouts/hub-shell";
import { getHubSupabaseClient } from "@/lib/supabase/client";
import {
  UNKNOWN_OPERATION_VALUE,
  type EngineeringAuditRoutine,
  type EngineeringOperationRecord,
  type EngineeringOperationsResponse,
} from "@/lib/squadops/engineering-operations-parser";
import { Badge, Surface, WorkspaceHeader, WorkspaceLayout } from "@repo/uix";
import type { BadgeVariant } from "@repo/uix";
import {
  AlertTriangle,
  Bot,
  CalendarDays,
  ClipboardCheck,
  Copy,
  FileText,
  GitCommitHorizontal,
  History,
  Layers3,
  LayoutGrid,
  Loader2,
  MessageSquareText,
  Rocket,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
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

type HubOpsView = "overview" | "timeline" | "audits" | "records";

type CopilotAnswerSection = {
  id: string;
  items: string[];
  title: string;
  type: "module" | "prompt" | "risk" | "summary";
};

type PoAiChatMessage = {
  content: string;
  createdAt: string;
  id: string;
  role: "assistant" | "user";
};

const allFilterValue = "__all";

const initialFilters: OperationsFilters = {
  keyword: "",
  module: allFilterValue,
  period: allFilterValue,
  routine: allFilterValue,
  squad: allFilterValue,
  status: allFilterValue,
  type: allFilterValue,
};

const promptTargets = [
  "Guardian Core",
  "CareDesk Core",
  "PulseX Core",
  "SquadOps Core",
  "Hub SupportOps",
  "Hub ReleaseOps",
] as const;

type PromptTemplate = {
  body: string;
  description: string;
  id: string;
  label: string;
  target: (typeof promptTargets)[number];
  type: "deploy" | "daily" | "weekly" | "monthly";
};

const promptTemplates: PromptTemplate[] = [
  {
    id: "deploy-releaseops",
    label: "Deploy / ReleaseOps",
    description: "Handoff pronto para publicar um recorte validado do Hub.",
    target: "Hub ReleaseOps",
    type: "deploy",
    body: `Assunto:
[ReleaseOps] Deploy do recorte [modulo/frente]

Dev responsavel, solicito preparar o deploy deste recorte.

Contexto:
- Modulo/frente: [informar modulo ou squad]
- Ambiente atual: [local/homologacao/producao]
- Status no Engineering Operations: [AGUARDANDO RELEASEOPS / outro]
- Link, branch ou commit relacionado: [informar se existir]

Escopo do deploy:
- [alteracao principal 1]
- [alteracao principal 2]
- [alteracao principal 3]

Validacoes ja executadas:
- [check-types/lint/build/smoke/validacao visual]
- [resultado objetivo]

Pontos de atencao:
- [risco tecnico ou operacional]
- [pendencia conhecida, se houver]

Solicitacao:
- Revisar escopo e diffs envolvidos.
- Confirmar se ha risco de regressao operacional.
- Organizar commit/release com rastreabilidade.
- Executar deploy e healthchecks necessarios.
- Registrar resultado final no Engineering Operations.

Formato esperado da resposta:
- Problema/entrega identificada
- Origem
- Impacto
- Recomendacao tecnica
- Criticidade operacional
- Status final`,
  },
  {
    id: "daily-activity",
    label: "Atividade diaria",
    description: "Resumo operacional do dia com foco em continuidade.",
    target: "SquadOps Core",
    type: "daily",
    body: `Assunto:
[SquadOps] Atividade diaria do Hub

Dev responsavel, solicito consolidar a leitura operacional diaria do Careli Hub.

Periodo analisado:
- Data: [dd/mm/aaaa]
- Fonte principal: Engineering Operations
- Modulos relevantes: [Guardian/CareDesk/PulseX/HubOps/Setup]

Atividades do dia:
- [atividade 1]
- [atividade 2]
- [atividade 3]

Decisoes ou mudancas registradas:
- [decisao/mudanca 1]
- [decisao/mudanca 2]

Riscos e bloqueios:
- [risco/bloqueio 1]
- [risco/bloqueio 2]

Proximas acoes:
- [acao 1 e squad responsavel]
- [acao 2 e squad responsavel]

Formato esperado da resposta:
- Resumo executivo
- Impacto operacional
- Pendencias
- Proxima squad recomendada
- Status`,
  },
  {
    id: "weekly-activity",
    label: "Atividade semanal",
    description: "Consolidado semanal por frente, risco e entrega.",
    target: "SquadOps Core",
    type: "weekly",
    body: `Assunto:
[SquadOps] Consolidado semanal do Hub

Dev responsavel, solicito consolidar a atividade semanal da engenharia Careli Hub.

Periodo analisado:
- Semana: [dd/mm a dd/mm]
- Fonte principal: Engineering Operations
- Objetivo: identificar entregas, riscos, gargalos e proximos passos.

Entregas por frente:
- Guardian: [resumo]
- CareDesk: [resumo]
- PulseX: [resumo]
- HubOps/SquadOps: [resumo]
- SupportOps: [resumo]
- ReleaseOps: [resumo]

Riscos operacionais:
- [risco 1 com impacto]
- [risco 2 com impacto]

Pendencias para continuidade:
- [pendencia 1 e responsavel]
- [pendencia 2 e responsavel]

Recomendacao para a proxima semana:
- [prioridade 1]
- [prioridade 2]
- [prioridade 3]

Formato esperado da resposta:
- Resumo executivo semanal
- Entregas por modulo
- Riscos e gargalos
- Decisoes relevantes
- Proximas prioridades
- Criticidade operacional`,
  },
  {
    id: "monthly-activity",
    label: "Atividade mensal",
    description: "Fechamento mensal para rastreabilidade e planejamento.",
    target: "SquadOps Core",
    type: "monthly",
    body: `Assunto:
[SquadOps] Fechamento mensal do Hub

Dev responsavel, solicito preparar o fechamento mensal operacional da engenharia Careli Hub.

Periodo analisado:
- Mes: [mes/aaaa]
- Fonte principal: Engineering Operations
- Objetivo: consolidar entregas, estabilidade, riscos e prioridades.

Resumo do mes:
- [tema principal 1]
- [tema principal 2]
- [tema principal 3]

Entregas e evolucoes:
- Guardian: [resultado]
- CareDesk: [resultado]
- PulseX: [resultado]
- HubOps/SquadOps: [resultado]
- SupportOps/ReleaseOps: [resultado]

Estabilidade operacional:
- Bugs relevantes: [informar]
- Incidentes ou lentidao: [informar]
- APIs/integracoes afetadas: [informar]
- Regressao identificada: [sim/nao + contexto]

Riscos para o proximo mes:
- [risco 1]
- [risco 2]
- [risco 3]

Prioridades recomendadas:
- [prioridade 1]
- [prioridade 2]
- [prioridade 3]

Formato esperado da resposta:
- Problemas identificados
- Origem
- Impacto operacional
- Recomendacao tecnica
- Criticidade
- Status executivo do mes`,
  },
];

const hubOpsViews = [
  { id: "overview", label: "Visão geral" },
  { id: "timeline", label: "Timeline" },
  { id: "audits", label: "Auditorias" },
  { id: "records", label: "Registros" },
] as const satisfies readonly { id: HubOpsView; label: string }[];

export function SquadOpsPage() {
  const [operations, setOperations] =
    useState<EngineeringOperationsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
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
      "Sou o PO AI, o cérebro operacional do Hub. Posso cruzar diário, código, módulos, riscos, pendências e próximos passos. Não executo comandos nem exponho segredos.",
    ),
  ]);
  const [copilotError, setCopilotError] = useState<string | null>(null);
  const [isCopilotLoading, setIsCopilotLoading] = useState(false);
  const [isPoAiOpen, setIsPoAiOpen] = useState(false);
  const [promptTarget, setPromptTarget] =
    useState<(typeof promptTargets)[number]>("Hub ReleaseOps");
  const [isPromptLibraryOpen, setIsPromptLibraryOpen] = useState(false);
  const [selectedPromptTemplateId, setSelectedPromptTemplateId] = useState(
    promptTemplates[0]!.id,
  );
  const [activeView, setActiveView] = useState<HubOpsView>("overview");

  useEffect(() => {
    let isActive = true;

    async function loadOperations() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/squadops/operations", {
          cache: "no-store",
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
              : "Não foi possível carregar HubOps.",
          );
          setOperations(null);
          return;
        }

        setOperations(payload);
      } catch {
        if (isActive) {
          setError("Não foi possível conectar à API do HubOps.");
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
  }, []);

  const records = useMemo(() => operations?.records ?? [], [operations]);
  const auditRoutines = useMemo(
    () => operations?.auditRoutines ?? [],
    [operations],
  );
  const filteredRecords = useMemo(
    () => records.filter((record) => matchesFilters(record, filters)),
    [filters, records],
  );
  const latestDeploys = (operations?.releaseRecords ?? records)
    .filter((record) => record.deploy !== UNKNOWN_OPERATION_VALUE)
    .slice(0, 5);
  const supportInvestigations = records
    .filter((record) => record.isSupportInvestigation)
    .slice(0, 5);
  const moduleImprovements = records
    .filter((record) => record.isModuleImprovement)
    .slice(0, 5);
  const criticalRecords = (operations?.criticalRecords ?? records)
    .filter((record) => record.isCritical)
    .slice(0, 6);
  const releaseRecords = (operations?.releaseRecords ?? records)
    .filter((record) => record.isRelease)
    .slice(0, 6);
  const overdueRoutines = auditRoutines.filter((routine) => routine.isOverdue);
  const latestRecord = records[0] ?? null;
  const actionCount = criticalRecords.length + overdueRoutines.length;
  const nextSquad =
    criticalRecords[0]?.nextSquad ??
    releaseRecords[0]?.nextSquad ??
    latestRecord?.nextSquad ??
    "Hub ReleaseOps";
  const selectedPromptTemplate =
    promptTemplates.find(
      (template) => template.id === selectedPromptTemplateId,
    ) ?? promptTemplates[0]!;

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
      const accessToken = await getAccessToken();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }

      const response = await fetch("/api/squadops/copilot", {
        body: JSON.stringify({
          messages: nextMessages.map(({ content, role }) => ({ content, role })),
          promptTarget: target ?? null,
          question: normalizedQuestion,
        }),
        cache: "no-store",
        headers,
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as
        | { answer?: string; error?: string }
        | null;

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

  return (
    <HubShell layoutMode="module">
      <WorkspaceLayout
        header={
          <WorkspaceHeader
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <button
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200/70 bg-white px-3 text-xs font-semibold text-slate-600 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                  onClick={openHubModulesSidebar}
                  type="button"
                >
                  <LayoutGrid aria-hidden="true" className="size-4 text-[#A07C3B]" />
                  Módulos do Hub
                </button>
                <button
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#A07C3B]/20 bg-white px-3 text-xs font-semibold text-[#7A5E2C] shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:bg-[#A07C3B]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                  onClick={() => setIsPoAiOpen(true)}
                  type="button"
                >
                  <Bot aria-hidden="true" className="size-4" />
                  PO AI
                </button>
                <Badge variant="warning">AGUARDANDO RELEASEOPS</Badge>
                <Badge variant="info">Engineering Operations</Badge>
              </div>
            }
            description="Leitura operacional do diário oficial da engenharia IA do Careli Hub."
            eyebrow="SquadOps Core"
            title="HubOps"
          />
        }
      >
        <section className="rounded-xl border border-slate-200/70 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="inline-flex h-9 items-center gap-2 rounded-lg bg-slate-50 px-3 text-xs font-semibold text-slate-500 ring-1 ring-slate-200/70">
              <FileText className="size-4 text-[#A07C3B]" />
              {operations?.sourcePath ?? "docs/codex/engineering-operations.md"}
            </span>
            <span className="text-xs font-semibold text-slate-500">
              {operations
                ? `Atualizado: ${formatGeneratedAt(operations.generatedAt)}`
                : "Aguardando leitura"}
            </span>
          </div>
        </section>

        {error ? (
          <Surface bordered className="border-red-100 bg-red-50 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-red-700">
              <AlertTriangle className="size-4" />
              {error}
            </div>
          </Surface>
        ) : null}

        <HubOpsCommandCenter
          actionCount={actionCount}
          isLoading={isLoading}
          latestRecord={latestRecord}
          metrics={operations?.metrics}
          nextSquad={nextSquad}
          onOpenPoAi={() => setIsPoAiOpen(true)}
          onOpenAudits={() => setActiveView("audits")}
          onOpenTimeline={() => setActiveView("timeline")}
          onOpenCritical={() => setActiveView("overview")}
        />

        <HubOpsViewTabs
          activeView={activeView}
          actionCount={actionCount}
          filteredCount={filteredRecords.length}
          onChange={setActiveView}
          routineCount={auditRoutines.length}
        />

        {activeView === "overview" ? (
          <>
            <section className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(22rem,0.38fr)_minmax(0,1fr)]">
              <CriticalOperationsPanel
                onSelectRecord={setSelectedRecord}
                onSelectRoutine={setSelectedRoutine}
                records={criticalRecords}
                routines={overdueRoutines}
                title="Agora precisa de atenção"
              />
              <TimelinePanel
                emptyMessage="Sem registro recente para mostrar."
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
                title="Investigações SupportOps"
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

        {activeView === "timeline" ? (
          <>
            <OperationsFiltersBar
              filters={filters}
              options={operations?.filters}
              onChange={setFilters}
            />
            <section className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.36fr)]">
              <TimelinePanel
                emptyMessage="Nenhum registro encontrado para os filtros atuais."
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
            onSelectRoutine={setSelectedRoutine}
            routines={auditRoutines}
          />
        ) : null}

        {activeView === "records" ? (
          <>
            <OperationsFiltersBar
              filters={filters}
              options={operations?.filters}
              onChange={setFilters}
            />
            <section className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.36fr)]">
              <RecordsTable
                records={filteredRecords.slice(0, 40)}
                onSelectRecord={setSelectedRecord}
              />

              <div className="grid content-start gap-5">
                <OperationalList
                  icon={<Search size={18} />}
                  onSelectRecord={setSelectedRecord}
                  records={supportInvestigations}
                  title="Investigações SupportOps"
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
        onClose={() => setSelectedRoutine(null)}
        routine={selectedRoutine}
      />
      <PoAiDrawer
        error={copilotError}
        isLoading={isCopilotLoading}
        isOpen={isPoAiOpen}
        messages={poAiMessages}
        onAsk={(question) => void askCopilot(question, null)}
        onClose={() => setIsPoAiOpen(false)}
        onGeneratePrompt={() => setIsPromptLibraryOpen(true)}
        onQuestionChange={setCopilotQuestion}
        onTargetChange={setPromptTarget}
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
    </HubShell>
  );
}

function getPoAiErrorMessage(error: Error) {
  if (
    error.message === "Failed to fetch" ||
    error.message.includes("fetch")
  ) {
    return "Não foi possível conectar ao PO AI. Recarregue a página e tente novamente.";
  }

  return error.message;
}

function openHubModulesSidebar() {
  window.dispatchEvent(new Event("careli:toggle-module-launcher"));
}

function createPoAiMessage(
  role: PoAiChatMessage["role"],
  content: string,
): PoAiChatMessage {
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `po-ai-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return {
    content,
    createdAt: new Date().toISOString(),
    id,
    role,
  };
}

function HubOpsCommandCenter({
  actionCount,
  isLoading,
  latestRecord,
  metrics,
  nextSquad,
  onOpenPoAi,
  onOpenAudits,
  onOpenCritical,
  onOpenTimeline,
}: {
  actionCount: number;
  isLoading: boolean;
  latestRecord: EngineeringOperationRecord | null;
  metrics?: EngineeringOperationsResponse["metrics"];
  nextSquad: string;
  onOpenPoAi: () => void;
  onOpenAudits: () => void;
  onOpenCritical: () => void;
  onOpenTimeline: () => void;
}) {
  return (
    <Surface bordered className="flex min-h-0 flex-1 flex-col overflow-hidden border-slate-200/70 bg-white p-0 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_25rem]">
        <div className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="m-0 text-xs font-semibold uppercase text-[#A07C3B]">
                leitura guiada
              </p>
              <h2 className="m-0 mt-1 text-xl font-semibold tracking-normal text-slate-950">
                Prioridade operacional
              </h2>
              <p className="m-0 mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                Riscos, pendências e handoffs consolidados a partir do diário
                oficial da engenharia IA.
              </p>
            </div>
            <Badge variant={actionCount > 0 ? "warning" : "success"}>
              {actionCount > 0 ? `${actionCount} pontos de atenção` : "sem alerta crítico"}
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
              label="releaseops"
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
            {latestRecord?.shortSummary ?? "Aguardando leitura do diário operacional."}
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

function HubOpsViewTabs({
  activeView,
  actionCount,
  filteredCount,
  onChange,
  routineCount,
}: {
  activeView: HubOpsView;
  actionCount: number;
  filteredCount: number;
  onChange: (view: HubOpsView) => void;
  routineCount: number;
}) {
  const counters = {
    audits: routineCount,
    overview: actionCount,
    records: filteredCount,
    timeline: filteredCount,
  } as const satisfies Record<HubOpsView, number>;

  return (
    <nav
      aria-label="Visões do HubOps"
      className="flex w-full flex-wrap gap-1 rounded-xl border border-slate-200/70 bg-white p-1 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
      {hubOpsViews.map((view) => {
        const isActive = activeView === view.id;

        return (
          <button
            aria-pressed={isActive}
            className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors ${
              isActive
                ? "bg-[#101820] text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
            }`}
            key={view.id}
            onClick={() => onChange(view.id)}
            type="button"
          >
            {view.label}
            <span
              className={`rounded-full px-1.5 py-0.5 text-[0.65rem] ${
                isActive
                  ? "bg-white/15 text-white"
                  : "bg-slate-100 text-slate-500"
              }`}
            >
              {counters[view.id]}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

function TimelinePanel({
  emptyMessage,
  limit,
  onSelectRecord,
  records,
  title,
}: {
  emptyMessage: string;
  limit: number;
  onSelectRecord: (record: EngineeringOperationRecord) => void;
  records: EngineeringOperationRecord[];
  title: string;
}) {
  return (
    <Surface bordered className="overflow-hidden border-slate-200/70 bg-white p-0 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="border-b border-slate-100 p-5">
        <PanelTitle
          icon={<History size={18} />}
          eyebrow={`${records.length} registros`}
          title={title}
        />
      </div>
      <div className="grid max-h-[58vh] gap-3 overflow-y-auto overscroll-contain p-4 pr-3">
        {records.length > 0 ? (
          records.slice(0, limit).map((record) => (
            <TimelineItem
              key={record.id}
              onSelect={() => onSelectRecord(record)}
              record={record}
            />
          ))
        ) : (
          <EmptyState message={emptyMessage} />
        )}
      </div>
    </Surface>
  );
}

function RecordsTable({
  onSelectRecord,
  records,
}: {
  onSelectRecord: (record: EngineeringOperationRecord) => void;
  records: EngineeringOperationRecord[];
}) {
  return (
    <Surface bordered className="overflow-hidden border-slate-200/70 bg-white p-0 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="border-b border-slate-100 p-5">
        <PanelTitle
          icon={<Layers3 size={18} />}
          eyebrow={`${records.length} registros`}
          title="Registros estruturados"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[62rem] w-full border-collapse text-left text-sm">
          <thead className="bg-slate-50/80 text-xs font-semibold uppercase text-slate-400">
            <tr>
              <th className="px-4 py-3">Assunto</th>
              <th className="px-4 py-3">Módulo</th>
              <th className="px-4 py-3">Squad</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Data</th>
              <th className="px-4 py-3">Próxima squad</th>
              <th className="px-4 py-3">Pendências</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr
                className="cursor-pointer border-t border-slate-100 transition-colors hover:bg-[#A07C3B]/5"
                key={record.id}
                onClick={() => onSelectRecord(record)}
              >
                <td className="max-w-64 px-4 py-3">
                  <p className="m-0 truncate font-semibold text-slate-950">
                    {record.subject}
                  </p>
                </td>
                <td className="px-4 py-3 text-slate-600">{record.module}</td>
                <td className="px-4 py-3 text-slate-600">{record.squad}</td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200/70">
                    {record.type}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <Badge variant={statusVariant(record.status)}>
                    {record.status}
                  </Badge>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                  {formatOperationDateTime(record.localDateTime)}
                </td>
                <td className="max-w-52 px-4 py-3 text-slate-600">
                  <span className="line-clamp-2">{record.nextSquad}</span>
                </td>
                <td className="max-w-56 px-4 py-3 text-slate-600">
                  <span className="line-clamp-2">{record.risks}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {records.length === 0 ? (
        <div className="p-4">
          <EmptyState message="Nenhum registro encontrado para os filtros atuais." />
        </div>
      ) : null}
    </Surface>
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
    <Surface bordered className="border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
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
              placeholder="Buscar assunto, módulo, risco..."
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

function TimelineItem({
  onSelect,
  record,
}: {
  onSelect: () => void;
  record: EngineeringOperationRecord;
}) {
  return (
    <button
      className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-3 rounded-xl border border-slate-200/70 bg-white p-4 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
      onClick={onSelect}
      type="button"
    >
      <span className="mt-1 h-2.5 w-2.5 rounded-full bg-[#A07C3B]" />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="m-0 truncate text-sm font-semibold text-[#101820]">
            {record.subject}
          </p>
          <Badge variant={statusVariant(record.status)}>{record.status}</Badge>
          <span className="rounded-full bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200/70">
            {record.type}
          </span>
        </div>
        <p className="m-0 mt-2 text-xs leading-5 text-[#667085]">
          {record.shortSummary}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
          <span>{record.squad}</span>
          <span>/</span>
          <span>{record.module}</span>
          {record.isCritical ? (
            <>
              <span>/</span>
              <span className="text-[#A07C3B]">risco ou pendência</span>
            </>
          ) : null}
        </div>
      </div>
      <span className="whitespace-nowrap text-right text-xs font-semibold text-[#667085]">
        {formatOperationDateTime(record.localDateTime)}
      </span>
    </button>
  );
}

function AuditRoutinesPanel({
  onSelectRoutine,
  routines,
}: {
  onSelectRoutine: (routine: EngineeringAuditRoutine) => void;
  routines: EngineeringAuditRoutine[];
}) {
  const overdueRoutines = routines.filter((routine) => routine.isOverdue);
  const stableRoutines = routines.filter((routine) => !routine.isOverdue);
  const latestExecution =
    routines.find(
      (routine) => routine.lastExecution !== UNKNOWN_OPERATION_VALUE,
    )?.lastExecution ?? UNKNOWN_OPERATION_VALUE;

  return (
    <Surface bordered className="border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PanelTitle
          eyebrow={`${routines.length} rotinas`}
          icon={<ClipboardCheck size={18} />}
          title="Auditorias operacionais"
        />
        <Badge variant={overdueRoutines.length > 0 ? "warning" : "success"}>
          {overdueRoutines.length > 0
            ? `${overdueRoutines.length} vencidas`
            : "rotinas em dia"}
        </Badge>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <AuditSummaryPill label="vencidas" value={overdueRoutines.length} />
        <AuditSummaryPill label="em acompanhamento" value={stableRoutines.length} />
        <AuditSummaryPill label="última execução" value={latestExecution} />
      </div>

      <div className="mt-5 grid gap-5">
        {overdueRoutines.length > 0 ? (
          <AuditRoutineGroup
            onSelectRoutine={onSelectRoutine}
            routines={overdueRoutines}
            title="Precisa de atenção"
          />
        ) : null}
        <AuditRoutineGroup
          onSelectRoutine={onSelectRoutine}
          routines={stableRoutines}
          title="Em acompanhamento"
        />
      </div>
    </Surface>
  );
}

function AuditSummaryPill({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-xl border border-slate-200/70 bg-slate-50/70 p-3">
      <p className="m-0 text-xs font-semibold uppercase text-slate-400">
        {label}
      </p>
      <p className="m-0 mt-1 text-sm font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function AuditRoutineGroup({
  onSelectRoutine,
  routines,
  title,
}: {
  onSelectRoutine: (routine: EngineeringAuditRoutine) => void;
  routines: EngineeringAuditRoutine[];
  title: string;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="m-0 text-sm font-semibold text-slate-950">{title}</h3>
        <span className="text-xs font-semibold text-slate-400">
          {routines.length} rotinas
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {routines.length > 0 ? (
          routines.map((routine) => (
            <AuditRoutineCard
              key={routine.id}
              onSelect={() => onSelectRoutine(routine)}
              routine={routine}
            />
          ))
        ) : (
          <EmptyState message="Nenhuma rotina nesta categoria." />
        )}
      </div>
    </section>
  );
}

function AuditRoutineCard({
  onSelect,
  routine,
}: {
  onSelect: () => void;
  routine: EngineeringAuditRoutine;
}) {
  return (
    <button
      className="rounded-xl border border-slate-200/70 bg-white p-4 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
      onClick={onSelect}
      type="button"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 truncate text-sm font-semibold text-slate-950">
            {routine.name}
          </p>
          <p className="m-0 mt-1 text-xs font-semibold text-slate-500">
            {routine.frequency} / {routine.responsible}
          </p>
        </div>
        <Badge variant={routine.isOverdue ? "warning" : statusVariant(routine.lastStatus)}>
          {routine.isOverdue ? "vencida" : routine.lastStatus}
        </Badge>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-slate-500">
        <span className="rounded-full bg-slate-50 px-2.5 py-1 ring-1 ring-slate-200/70">
          Última: {routine.lastExecution}
        </span>
        <span className="rounded-full bg-slate-50 px-2.5 py-1 ring-1 ring-slate-200/70">
          Histórico: {routine.history.length}
        </span>
      </div>
      <p className="m-0 mt-3 line-clamp-2 text-xs leading-5 text-slate-600">
        {routine.consolidatedResult}
      </p>
      <p className="m-0 mt-3 line-clamp-2 rounded-lg bg-slate-50/70 p-3 text-xs leading-5 text-slate-600 ring-1 ring-slate-200/70">
        {routine.script}
      </p>
    </button>
  );
}

function PoAiChannelPanel({
  error,
  isLoading,
  messages,
  onAsk,
  onGeneratePrompt,
  onQuestionChange,
  onTargetChange,
  question,
  target,
}: {
  error: string | null;
  isLoading: boolean;
  messages: PoAiChatMessage[];
  onAsk: (question: string) => void;
  onGeneratePrompt: () => void;
  onQuestionChange: (question: string) => void;
  onTargetChange: (target: (typeof promptTargets)[number]) => void;
  question: string;
  target: (typeof promptTargets)[number];
}) {
  return (
    <Surface bordered className="flex min-h-0 flex-1 flex-col overflow-hidden border-slate-200/70 bg-white p-0 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="border-b border-slate-100 p-5">
        <PanelTitle
          eyebrow="Cérebro do Hub"
          icon={<Bot size={18} />}
          title="PO AI"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100">
            diário operacional
          </span>
          <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700 ring-1 ring-sky-100">
            código do Hub
          </span>
          <span className="rounded-full bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200/70">
            sem execução automática
          </span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50/70 p-4">
          {messages.map((message) => (
            <PoAiMessageBubble key={message.id} message={message} />
          ))}
          {isLoading ? (
            <div className="flex justify-start">
              <div className="rounded-2xl border border-slate-200/70 bg-white px-3 py-2 text-sm font-semibold text-slate-500 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin text-[#A07C3B]" />
                  PO AI lendo diário e código do Hub
                </span>
              </div>
            </div>
          ) : null}
        </div>

        <div className="border-t border-slate-100 bg-white p-4">
          {error ? (
            <p className="m-0 mb-3 rounded-lg bg-red-50 p-3 text-xs font-semibold text-red-700 ring-1 ring-red-100">
              {error}
            </p>
          ) : null}
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-slate-500">
              Conversar com o PO AI
            </span>
            <textarea
              className={`${fieldClassName} h-20 resize-none py-2`}
              onChange={(event) => onQuestionChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  onAsk(question);
                }
              }}
              placeholder="Pergunte sobre código, risco, módulo, decisão, deploy ou próximo passo..."
              value={question}
            />
          </label>

          <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <select
              className={fieldClassName}
              onChange={(event) =>
                onTargetChange(event.target.value as (typeof promptTargets)[number])
              }
              value={target}
            >
              {promptTargets.map((promptTarget) => (
                <option key={promptTarget} value={promptTarget}>
                  {promptTarget}
                </option>
              ))}
            </select>
            <button
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#A07C3B]/20 bg-white px-3 text-xs font-semibold text-[#7A5E2C] transition-colors hover:bg-[#A07C3B]/5 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isLoading}
              onClick={onGeneratePrompt}
              type="button"
            >
              <WandSparkles className="size-4" />
              Prompt
            </button>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200/70 bg-white px-3 text-xs font-semibold text-slate-600 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-slate-950"
              onClick={() => onQuestionChange("O que foi feito hoje?")}
              type="button"
            >
              <MessageSquareText className="size-4 text-[#A07C3B]" />
              Hoje
            </button>
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200/70 bg-white px-3 text-xs font-semibold text-slate-600 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-slate-950"
              onClick={() => onQuestionChange("Leia o código do Hub e me diga onde está o principal risco operacional agora.")}
              type="button"
            >
              <Bot className="size-4 text-[#A07C3B]" />
              Código
            </button>
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200/70 bg-white px-3 text-xs font-semibold text-slate-600 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-slate-950"
              onClick={() => onQuestionChange("O que precisa ir para ReleaseOps?")}
              type="button"
            >
              <Rocket className="size-4 text-[#A07C3B]" />
              ReleaseOps
            </button>
          </div>

          <button
            className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#101820] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#1b2533] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isLoading}
            onClick={() => onAsk(question)}
            type="button"
          >
            {isLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            Enviar
          </button>
        </div>
      </div>
    </Surface>
  );
}

function PoAiDrawer({
  error,
  isLoading,
  isOpen,
  messages,
  onAsk,
  onClose,
  onGeneratePrompt,
  onQuestionChange,
  onTargetChange,
  question,
  target,
}: {
  error: string | null;
  isLoading: boolean;
  isOpen: boolean;
  messages: PoAiChatMessage[];
  onAsk: (question: string) => void;
  onClose: () => void;
  onGeneratePrompt: () => void;
  onQuestionChange: (question: string) => void;
  onTargetChange: (target: (typeof promptTargets)[number]) => void;
  question: string;
  target: (typeof promptTargets)[number];
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/20 backdrop-blur-[1px]">
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col border-l border-slate-200 bg-slate-50 p-4 shadow-2xl">
        <button
          className="absolute right-7 top-7 z-10 grid size-9 place-items-center rounded-lg border border-slate-200/70 bg-white text-slate-500 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:bg-slate-50 hover:text-slate-950"
          onClick={onClose}
          type="button"
        >
          <X className="size-4" />
        </button>
        <PoAiChannelPanel
          error={error}
          isLoading={isLoading}
          messages={messages}
          onAsk={onAsk}
          onGeneratePrompt={onGeneratePrompt}
          onQuestionChange={onQuestionChange}
          onTargetChange={onTargetChange}
          question={question}
          target={target}
        />
      </aside>
    </div>
  );
}

function PromptLibraryModal({
  isOpen,
  onClose,
  onSelectTemplate,
  selectedTemplate,
  templates,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSelectTemplate: (templateId: string) => void;
  selectedTemplate: PromptTemplate;
  templates: PromptTemplate[];
}) {
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null);

  if (!isOpen) {
    return null;
  }

  async function copyPrompt(template: PromptTemplate) {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }

    try {
      await navigator.clipboard.writeText(template.body);
      setCopiedPromptId(template.id);
      window.setTimeout(() => setCopiedPromptId(null), 1400);
    } catch {
      setCopiedPromptId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] bg-slate-950/35 p-4 backdrop-blur-[2px]">
      <div
        aria-label="Biblioteca de prompts do PO AI"
        aria-modal="true"
        className="mx-auto flex h-full max-h-[48rem] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
        role="dialog"
      >
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 p-5">
          <PanelTitle
            eyebrow="modelos prontos"
            icon={<WandSparkles size={18} />}
            title="Biblioteca de prompts"
          />
          <button
            className="grid size-9 place-items-center rounded-lg border border-slate-200/70 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-950"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[21rem_minmax(0,1fr)]">
          <aside className="min-h-0 overflow-y-auto border-b border-slate-100 bg-slate-50/70 p-4 lg:border-b-0 lg:border-r">
            <div className="grid gap-2">
              {templates.map((template) => {
                const isSelected = template.id === selectedTemplate.id;

                return (
                  <button
                    aria-pressed={isSelected}
                    className={`rounded-lg border p-3 text-left transition-colors ${
                      isSelected
                        ? "border-[#A07C3B]/35 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.06)]"
                        : "border-slate-200/70 bg-white/70 hover:border-[#A07C3B]/25 hover:bg-white"
                    }`}
                    key={template.id}
                    onClick={() => onSelectTemplate(template.id)}
                    type="button"
                  >
                    <div className="flex items-start gap-3">
                      <span className="flex size-9 items-center justify-center rounded-lg bg-slate-50 text-[#A07C3B] ring-1 ring-slate-200/70">
                        {promptTemplateIcon(template)}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-slate-950">
                          {template.label}
                        </span>
                        <span className="mt-1 block text-xs leading-5 text-slate-500">
                          {template.description}
                        </span>
                        <span className="mt-2 inline-flex rounded-full bg-white px-2.5 py-1 text-[0.68rem] font-semibold uppercase text-slate-500 ring-1 ring-slate-200/70">
                          {promptTemplateTypeLabel(template.type)}
                        </span>
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="flex min-h-0 flex-col p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="m-0 text-xs font-semibold uppercase text-[#7A5E2C]">
                  {selectedTemplate.target}
                </p>
                <h3 className="m-0 mt-1 text-lg font-semibold text-slate-950">
                  {selectedTemplate.label}
                </h3>
                <p className="m-0 mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                  Texto pronto para copiar e enviar ao dev responsavel.
                </p>
              </div>
              <span className="inline-flex items-center gap-2 rounded-full bg-[#A07C3B]/10 px-3 py-1.5 text-xs font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
                {promptTemplateIcon(selectedTemplate)}
                {promptTemplateTypeLabel(selectedTemplate.type)}
              </span>
            </div>

            <textarea
              aria-label="Prompt selecionado"
              className="mt-4 min-h-0 flex-1 resize-none rounded-lg border border-slate-200 bg-slate-50/80 p-4 font-mono text-xs leading-5 text-slate-800 outline-none focus:border-[#A07C3B]/35 focus:ring-2 focus:ring-[#A07C3B]/10"
              readOnly
              spellCheck={false}
              value={selectedTemplate.body}
            />

            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#101820] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#1b2533]"
                onClick={() => void copyPrompt(selectedTemplate)}
                type="button"
              >
                <Copy className="size-4" />
                {copiedPromptId === selectedTemplate.id
                  ? "Texto copiado"
                  : "Copiar para enviar ao dev"}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function promptTemplateIcon(template: PromptTemplate) {
  if (template.type === "deploy") {
    return <Rocket className="size-4" />;
  }

  if (template.type === "daily") {
    return <MessageSquareText className="size-4" />;
  }

  if (template.type === "weekly") {
    return <ClipboardCheck className="size-4" />;
  }

  return <CalendarDays className="size-4" />;
}

function promptTemplateTypeLabel(type: PromptTemplate["type"]) {
  if (type === "deploy") {
    return "deploy";
  }

  if (type === "daily") {
    return "diario";
  }

  if (type === "weekly") {
    return "semanal";
  }

  return "mensal";
}

function PoAiMessageBubble({ message }: { message: PoAiChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[86%] rounded-2xl bg-[#101820] px-4 py-3 text-sm leading-6 text-white shadow-[0_1px_2px_rgba(15,23,42,0.08)]">
          <p className="m-0 whitespace-pre-wrap">{message.content}</p>
          <p className="m-0 mt-2 text-right text-[0.68rem] font-semibold text-white/55">
            {formatOperationDateTime(message.createdAt)}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[94%]">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-500">
          <span className="flex size-7 items-center justify-center rounded-lg bg-white text-[#A07C3B] ring-1 ring-slate-200/70">
            <Bot className="size-4" />
          </span>
          <span>PO AI</span>
          <span>/</span>
          <span>{formatOperationDateTime(message.createdAt)}</span>
        </div>
        <CopilotAnswerBubbles answer={message.content} compact />
      </div>
    </div>
  );
}

function CopilotAnswerBubbles({
  answer,
  compact = false,
}: {
  answer: string;
  compact?: boolean;
}) {
  const sections = parseCopilotAnswer(answer);

  return (
    <div
      className={
        compact
          ? "grid gap-3"
          : "mt-4 rounded-xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
      }
    >
      {!compact ? (
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-slate-50 text-[#A07C3B] ring-1 ring-slate-200/70">
            <Bot className="size-4" />
          </span>
          <div>
            <p className="m-0 text-xs font-semibold uppercase text-[#7A5E2C]">
              Resposta do PO AI
            </p>
            <p className="m-0 mt-0.5 text-xs text-slate-500">
              Organizado por frente para leitura rápida
            </p>
          </div>
        </div>
      ) : null}

      <div className={compact ? "grid gap-3" : "mt-4 grid gap-3"}>
        {sections.map((section) => (
          <article
            className="rounded-xl border border-slate-200/70 bg-slate-50/70 p-3"
            key={section.id}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="m-0 text-sm font-semibold text-slate-950">
                {section.title}
              </h3>
              <span
                className={`rounded-full px-2.5 py-1 text-[0.68rem] font-semibold uppercase ${copilotSectionBadgeClass(section.type)}`}
              >
                {copilotSectionLabel(section.type)}
              </span>
            </div>
            <div className="mt-3 grid gap-2">
              {section.items.map((item, index) => (
                <p
                  className="m-0 rounded-xl border border-slate-200/70 bg-white px-3 py-2 text-sm leading-6 text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
                  key={`${section.id}-${index}`}
                >
                  {item}
                </p>
              ))}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function parseCopilotAnswer(answer: string): CopilotAnswerSection[] {
  const sections: CopilotAnswerSection[] = [];
  let current: CopilotAnswerSection | null = null;

  function ensureSection(title = "Resumo executivo") {
    if (!current) {
      current = {
        id: `copilot-section-${sections.length + 1}`,
        items: [],
        title,
        type: inferCopilotSectionType(title),
      };
      sections.push(current);
    }

    return current;
  }

  function getOrCreateModuleSection(title: string) {
    const normalizedTitle = normalizeSearchText(title);
    const existingSection = sections.find(
      (section) => normalizeSearchText(section.title) === normalizedTitle,
    );

    if (existingSection) {
      return existingSection;
    }

    const section: CopilotAnswerSection = {
      id: `copilot-section-${sections.length + 1}`,
      items: [],
      title,
      type: "module",
    };

    sections.push(section);
    return section;
  }

  answer
    .split(/\r?\n/)
    .map(cleanCopilotLine)
    .filter(Boolean)
    .forEach((line) => {
      const title = extractCopilotTitle(line);

      if (title) {
        current = {
          id: `copilot-section-${sections.length + 1}`,
          items: [],
          title,
          type: inferCopilotSectionType(title),
        };
        sections.push(current);
        return;
      }

      const item = cleanCopilotItem(line);

      if (!item || item === "---") {
        return;
      }

      const moduleTitle = detectCopilotModuleTitle(item);

      if (moduleTitle && current?.type !== "module") {
        getOrCreateModuleSection(moduleTitle).items.push(item);
        return;
      }

      ensureSection().items.push(item);
    });

  return sections
    .map((section) => ({
      ...section,
      items: section.items.length > 0 ? section.items : ["Não informado."],
    }))
    .filter((section) => section.items.length > 0);
}

function detectCopilotModuleTitle(text: string) {
  const normalizedText = normalizeSearchText(text);

  if (
    normalizedText.includes("releaseops") ||
    normalizedText.includes("engineering operations") ||
    normalizedText.includes("producao") ||
    normalizedText.includes("deploy")
  ) {
    return "ReleaseOps / Engineering Operations";
  }

  if (
    normalizedText.includes("hubops") ||
    normalizedText.includes("squadops")
  ) {
    return "HubOps / SquadOps";
  }

  if (normalizedText.includes("supportops")) {
    return "Hub SupportOps";
  }

  if (normalizedText.includes("guardian")) {
    return "Guardian";
  }

  if (normalizedText.includes("pulsex")) {
    return "PulseX";
  }

  if (normalizedText.includes("caredesk")) {
    return "CareDesk";
  }

  if (normalizedText.includes("setup")) {
    return "Setup";
  }

  return null;
}

function extractCopilotTitle(line: string) {
  const front = line.match(/^Frente:\s+(.+)$/i);

  if (front?.[1]) {
    return cleanCopilotItem(front[1]);
  }

  const heading = line.match(/^#{2,6}\s+(.+)$/);

  if (heading?.[1]) {
    return cleanCopilotItem(heading[1]);
  }

  const numberedModule = line.match(
    /^(?:\d+\.\s+)?((?:Guardian|CareDesk|PulseX|HubOps|SquadOps|ReleaseOps|SupportOps|Setup|Engineering Operations)[\w\s/.-]*)$/i,
  );

  if (numberedModule?.[1]) {
    return cleanCopilotItem(numberedModule[1]);
  }

  return null;
}

function cleanCopilotLine(line: string) {
  return line.trim();
}

function cleanCopilotItem(line: string) {
  return line
    .replace(/^[-*]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function inferCopilotSectionType(title: string): CopilotAnswerSection["type"] {
  const normalizedTitle = normalizeSearchText(title);

  if (
    normalizedTitle.includes("risco") ||
    normalizedTitle.includes("pendencia") ||
    normalizedTitle.includes("atencao")
  ) {
    return "risk";
  }

  if (normalizedTitle.includes("prompt")) {
    return "prompt";
  }

  if (
    normalizedTitle.includes("guardian") ||
    normalizedTitle.includes("caredesk") ||
    normalizedTitle.includes("pulsex") ||
    normalizedTitle.includes("hubops") ||
    normalizedTitle.includes("squadops") ||
    normalizedTitle.includes("releaseops") ||
    normalizedTitle.includes("supportops") ||
    normalizedTitle.includes("setup") ||
    normalizedTitle.includes("engineering operations")
  ) {
    return "module";
  }

  return "summary";
}

function copilotSectionLabel(type: CopilotAnswerSection["type"]) {
  if (type === "module") {
    return "módulo";
  }

  if (type === "prompt") {
    return "prompt";
  }

  if (type === "risk") {
    return "atenção";
  }

  return "resumo";
}

function copilotSectionBadgeClass(type: CopilotAnswerSection["type"]) {
  if (type === "module") {
    return "bg-sky-50 text-sky-700 ring-1 ring-sky-100";
  }

  if (type === "prompt") {
    return "bg-violet-50 text-violet-700 ring-1 ring-violet-100";
  }

  if (type === "risk") {
    return "bg-amber-50 text-amber-800 ring-1 ring-amber-100";
  }

  return "bg-[#A07C3B]/10 text-[#7A5E2C] ring-1 ring-[#A07C3B]/15";
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
      candidate.trim() &&
      candidate.trim() !== UNKNOWN_OPERATION_VALUE,
  );

  return summary ?? "Resumo operacional nao informado.";
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
    <Surface bordered className="border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <PanelTitle
        eyebrow={`${records.length + routines.length} itens`}
        icon={<ShieldAlert size={18} />}
        title={title}
      />
      <div className="mt-4 grid gap-2">
        {routines.map((routine) => (
          <button
            className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-left transition-colors hover:border-amber-300 hover:bg-amber-100/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            key={routine.id}
            onClick={() => onSelectRoutine(routine)}
            type="button"
          >
            <p className="m-0 text-sm font-semibold text-amber-900">
              {routine.name}
            </p>
            <p className="m-0 mt-1 text-xs leading-5 text-amber-800">
              Rotina vencida ou não executada. Última execução:{" "}
              {routine.lastExecution}.
            </p>
          </button>
        ))}
        {records.length > 0 ? (
          records.map((record) => (
            <button
              className="rounded-xl border border-slate-200/70 bg-white p-3 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
              key={record.id}
              onClick={() => onSelectRecord(record)}
              type="button"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="m-0 truncate text-sm font-semibold text-slate-950">
                    {record.subject}
                  </p>
                  <p className="m-0 mt-1 text-xs leading-5 text-slate-500">
                    {record.module} / {record.routine}
                  </p>
                </div>
                <Badge variant={statusVariant(record.status)}>
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
    <Surface bordered className="border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <PanelTitle eyebrow={`${records.length} itens`} icon={icon} title={title} />
      <div className="mt-4 grid gap-2">
        {records.length > 0 ? (
          records.map((record) => (
            <button
              className="rounded-xl border border-slate-200/70 bg-white p-3 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
              key={record.id}
              onClick={() => onSelectRecord(record)}
              type="button"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="m-0 truncate text-sm font-semibold text-slate-950">
                    {record.subject}
                  </p>
                  <p className="m-0 mt-1 text-xs leading-5 text-slate-500">
                    {record.module} / {record.type}
                  </p>
                </div>
                <Badge variant={statusVariant(record.status)}>
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

function AuditRoutineDetailDrawer({
  onClose,
  routine,
}: {
  onClose: () => void;
  routine: EngineeringAuditRoutine | null;
}) {
  if (!routine) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/20 backdrop-blur-[1px]">
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col border-l border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5">
          <PanelTitle
            eyebrow={routine.frequency}
            icon={<ClipboardCheck size={18} />}
            title={routine.name}
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
            <Badge variant={routine.isOverdue ? "warning" : statusVariant(routine.lastStatus)}>
              {routine.isOverdue ? "vencida" : routine.lastStatus}
            </Badge>
            <span className="rounded-full bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200/70">
              {routine.responsible}
            </span>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <DetailField label="Responsavel" value={routine.responsible} />
            <DetailField label="Ultima execucao" value={routine.lastExecution} />
            <DetailField label="Frequencia" value={routine.frequency} />
            <DetailField label="Historico" value={`${routine.history.length} registros`} />
          </div>

          <div className="mt-5 grid gap-3">
            <DetailBlock
              label="Resultado consolidado"
              value={routine.consolidatedResult}
            />
            <DetailBlock label="Script operacional" value={routine.script} />
          </div>

          <div className="mt-5 rounded-xl border border-slate-200/70 bg-slate-50/70 p-4">
            <p className="m-0 text-xs font-semibold uppercase text-slate-400">
              Historico relacionado
            </p>
            <div className="mt-3 grid gap-3">
              {routine.history.length > 0 ? (
                routine.history.map((record) => (
                  <article
                    className="rounded-lg border border-slate-200/70 bg-white p-3"
                    key={record.id}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="m-0 truncate text-sm font-semibold text-slate-950">
                          {record.subject}
                        </p>
                        <p className="m-0 mt-1 text-xs font-semibold text-slate-500">
                          {record.module} / {formatOperationDateTime(record.localDateTime)}
                        </p>
                      </div>
                      <Badge variant={statusVariant(record.status)}>
                        {record.status}
                      </Badge>
                    </div>
                    <pre className="m-0 mt-3 max-h-64 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-slate-700">
                      {record.rawContent}
                    </pre>
                  </article>
                ))
              ) : (
                <EmptyState message="Sem registro historico relacionado." />
              )}
            </div>
          </div>
        </div>
      </aside>
    </div>
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
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col border-l border-slate-200 bg-white shadow-2xl">
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
            <Badge variant={statusVariant(record.status)}>{record.status}</Badge>
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

          <div className="mt-5 grid grid-cols-2 gap-3">
            <DetailField label="Squad/agente" value={record.squad} />
            <DetailField label="Próxima squad" value={record.nextSquad} />
            <DetailField label="Commit" value={record.commit} />
            <DetailField label="Deploy" value={record.deploy} />
          </div>

          <div className="mt-5 grid gap-3">
            <DetailBlock label="Motivo da mudança" value={record.reason} />
            <DetailBlock label="Arquivos/módulos afetados" value={record.affectedFiles} />
            <DetailBlock label="Como foi feito" value={record.how} />
            <DetailBlock label="Lógica utilizada" value={record.logic} />
            <DetailBlock label="Validação executada" value={record.validation} />
            <DetailBlock label="Pendências ou riscos conhecidos" value={record.risks} />
            <DetailBlock label="Resultado dos healthchecks" value={record.healthchecks} />
            <DetailBlock label="Resumo macro" value={record.macroSummary} />
          </div>

          <div className="mt-5 rounded-xl border border-slate-200/70 bg-slate-50/70 p-4">
            <p className="m-0 text-xs font-semibold uppercase text-slate-400">
              Conteúdo bruto do registro
            </p>
            <pre className="m-0 mt-3 max-h-80 whitespace-pre-wrap text-xs leading-5 text-slate-700">
              {record.rawContent}
            </pre>
          </div>
        </div>
      </aside>
    </div>
  );
}

function PanelTitle({
  eyebrow,
  icon,
  title,
}: {
  eyebrow: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-10 items-center justify-center rounded-xl bg-slate-50 text-[#A07C3B] ring-1 ring-slate-200/70">
        {icon}
      </span>
      <div>
        <p className="m-0 text-xs font-semibold text-slate-500">{eyebrow}</p>
        <h2 className="m-0 mt-1 text-base font-semibold text-slate-950">
          {title}
        </h2>
      </div>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200/70 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <p className="m-0 text-xs font-semibold text-slate-500">{label}</p>
      <p className="m-0 mt-1 text-sm font-semibold leading-5 text-slate-950">
        {value}
      </p>
    </div>
  );
}

function DetailBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <p className="m-0 text-xs font-semibold text-slate-500">{label}</p>
      <p className="m-0 mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
        {value}
      </p>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <p className="m-0 rounded-xl bg-slate-50/70 p-4 text-sm text-slate-500 ring-1 ring-slate-200/70">
      {message}
    </p>
  );
}

function matchesFilters(
  record: EngineeringOperationRecord,
  filters: OperationsFilters,
) {
  const searchable = normalizeSearchText(
    [
      record.subject,
      record.module,
      record.squad,
      record.type,
      record.status,
      record.shortSummary,
      record.risks,
      record.nextSquad,
      record.rawContent,
    ].join(" "),
  );
  const keyword = normalizeSearchText(filters.keyword);
  return (
    (filters.module === allFilterValue || record.module === filters.module) &&
    (filters.squad === allFilterValue || record.squad === filters.squad) &&
    (filters.type === allFilterValue || record.type === filters.type) &&
    (filters.routine === allFilterValue || record.routine === filters.routine) &&
    (filters.status === allFilterValue || record.status === filters.status) &&
    matchesPeriod(record.localDateTime, filters.period) &&
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

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function formatGeneratedAt(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  });
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
      year: "2-digit",
    }),
    date.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    }),
  ].join(" ");
}

async function getAccessToken() {
  const client = getHubSupabaseClient();

  if (!client) {
    return null;
  }

  try {
    const { data } = await client.auth.getSession();

    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
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

const fieldClassName =
  "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-[#A07C3B]/40 focus:ring-2 focus:ring-[#A07C3B]/10";
