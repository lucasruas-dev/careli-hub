import { NextResponse, type NextRequest } from "next/server";

import { collectOperationsDataSources } from "@/lib/operations/data-sources";
import {
  buildOperationsMonitoringSnapshot,
  type OperationsMonitoringSnapshot,
} from "@/lib/operations/monitoring";
import {
  loadHubCodeContext,
  type HubCodeContext,
} from "@/lib/squadops/hub-code-context";
import { authorizeSquadOpsAdminRequest } from "@/lib/squadops/admin-access";
import { loadEngineeringOperationsFromFile } from "@/lib/squadops/engineering-operations-source";
import {
  loadStructuredEngineeringOperations,
  type StructuredEngineeringOperation,
} from "@/lib/squadops/engineering-operations-store";
import type {
  EngineeringAuditRoutine,
  EngineeringOperationRecord,
  EngineeringOperationsResponse,
} from "@/lib/squadops/engineering-operations-parser";

type CopilotRequest = {
  messages?: unknown;
  promptTarget?: unknown;
  question?: unknown;
};

type PoAiMessage = {
  content: string;
  role: "assistant" | "user";
};

const DEFAULT_MODEL = "gpt-5.5";
const OPENAI_TIMEOUT_MS = 45_000;
const MAX_CONTEXT_CHARS = 120_000;

const promptTargets = [
  "Guardian Core",
  "CareDesk Core",
  "PulseX Core",
  "SquadOps Core",
  "Hub SupportOps",
  "Hub ReleaseOps",
] as const;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const parsedRequest = parseCopilotRequest(await request.json().catch(() => null));

  if (!parsedRequest.ok) {
    return NextResponse.json({ error: parsedRequest.error }, { status: 400 });
  }

  const auth = await authorizeSquadOpsAdminRequest(request);

  if (!auth.ok) {
    return auth.response;
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    return NextResponse.json(
      { error: "Configure OPENAI_API_KEY para ativar o PO AI." },
      { status: 503 },
    );
  }

  const operations = await loadEngineeringOperationsFromFile();

  if (!operations.data) {
    return NextResponse.json(
      { error: operations.error ?? "Não foi possível ler Operations Center." },
      { status: 500 },
    );
  }

  const structuredOperations = await loadStructuredEngineeringOperations(120);
  const monitoringSnapshot = buildOperationsMonitoringSnapshot(
    await collectOperationsDataSources({
      origin: new URL(request.url).origin,
    }),
  );
  const codeContext = await loadHubCodeContext(parsedRequest.data.question);

  try {
    const answer = await createCopilotAnswer({
      apiKey,
      codeContext,
      messages: parsedRequest.data.messages,
      model: process.env.HUB_AI_MODEL?.trim() || DEFAULT_MODEL,
      monitoringSnapshot,
      operations: operations.data,
      promptTarget: parsedRequest.data.promptTarget,
      question: parsedRequest.data.question,
      structuredOperations: structuredOperations.ok
        ? structuredOperations.records
        : [],
      structuredStatus: structuredOperations.status,
      userId: auth.userId,
    });

    return NextResponse.json({
      answer,
      codeContext: {
        files: codeContext.files.map((file) => file.path),
        scannedFiles: codeContext.scannedFiles,
      },
      model: process.env.HUB_AI_MODEL?.trim() || DEFAULT_MODEL,
      source: "openai",
    });
  } catch (error) {
    return NextResponse.json(
      { error: getOpenAiErrorMessage(error) },
      { status: 502 },
    );
  }
}

function parseCopilotRequest(input: unknown):
  | {
      data: {
        messages: PoAiMessage[];
        promptTarget: (typeof promptTargets)[number] | null;
        question: string;
      };
      ok: true;
    }
  | { error: string; ok: false } {
  if (!input || typeof input !== "object") {
    return { error: "Informe uma pergunta para o PO AI.", ok: false };
  }

  const body = input as CopilotRequest;
  const question = typeof body.question === "string" ? body.question.trim() : "";
  const promptTarget = isPromptTarget(body.promptTarget)
    ? body.promptTarget
    : null;
  const messages = parsePoAiMessages(body.messages);

  if (!question && !promptTarget) {
    return { error: "Informe uma pergunta para o PO AI.", ok: false };
  }

  return {
    data: {
      messages,
      promptTarget,
      question:
        question ||
        `Gere um prompt operacional completo para ${promptTarget}.`,
    },
    ok: true,
  };
}

async function createCopilotAnswer({
  apiKey,
  codeContext,
  messages,
  model,
  monitoringSnapshot,
  operations,
  promptTarget,
  question,
  structuredOperations,
  structuredStatus,
  userId,
}: {
  apiKey: string;
  codeContext: HubCodeContext;
  messages: PoAiMessage[];
  model: string;
  monitoringSnapshot: OperationsMonitoringSnapshot;
  operations: EngineeringOperationsResponse;
  promptTarget: (typeof promptTargets)[number] | null;
  question: string;
  structuredOperations: StructuredEngineeringOperation[];
  structuredStatus: string;
  userId: string;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      body: JSON.stringify({
        input: [
          {
            content: buildCopilotInput({
              codeContext,
              messages,
              monitoringSnapshot,
              operations,
              promptTarget,
              question,
              structuredOperations,
              structuredStatus,
            }),
            role: "user",
          },
        ],
        instructions: buildCopilotInstructions(),
        max_output_tokens: 2_200,
        model,
        user: userId,
      }),
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: controller.signal,
    });
    const result = (await response.json().catch(() => null)) as
      | Record<string, unknown>
      | null;

    if (!response.ok) {
      throw new Error(extractOpenAiError(result) || "Falha ao consultar OpenAI.");
    }

    const answer = extractOutputText(result);

    if (!answer) {
      throw new Error("OpenAI não retornou resposta para o PO AI.");
    }

    return answer;
  } finally {
    clearTimeout(timeout);
  }
}

function buildCopilotInstructions() {
  return [
    "Você é o PO AI, o cérebro operacional do Careli Hub dentro do SquadOps.",
    "Responda sempre em português do Brasil, com linguagem executiva, simples, instrucional e direta para Lucas.",
    "Use somente o contexto recebido: monitoramentoRealtime, diário Engineering Operations, histórico da conversa e mapa seguro do código do Hub.",
    "Para perguntas sobre banco de dados, performance, estabilidade, APIs, filas, payload, Supabase, C2X ou alertas, use `monitoramentoRealtime` como fonte principal do estado atual.",
    "Para historico operacional, protocolos, releases, healthchecks e handoffs, use `baseEstruturadaSupabase` como fonte principal quando ela estiver preenchida.",
    "O diário Engineering Operations é histórico, auditoria e rastreabilidade. Não use o diário como fonte principal para afirmar estado atual de banco, tempo de resposta ou payload quando houver `monitoramentoRealtime` disponível.",
    "Você conhece arquitetura, módulos, rotas, componentes, APIs, riscos, pendências, deploys e decisões registradas quando esse conteúdo estiver no contexto.",
    "Quando o Lucas perguntar sobre código, use o mapa e os trechos de código recebidos. Se o trecho necessário não estiver no contexto, diga qual arquivo precisa ser aberto/indexado em seguida.",
    "Você pode explicar o que foi feito, impactos, riscos, pendências, squads recomendadas, validações faltantes, prompts para agentes e próximos passos.",
    "Você não pode alterar arquivos, executar comandos, fazer deploy, mudar status, chamar agentes automaticamente ou prometer ações feitas.",
    "Quando gerar prompt para agente, use exatamente: Assunto, Contexto, Objetivo, Tarefas, Validações esperadas e Retorno esperado.",
    "Nunca exponha nem peça chaves, tokens, senhas, variáveis .env ou credenciais. Se algo sensível for necessário, oriente Lucas a validar server-side sem revelar o valor.",
    "Se faltar monitoramentoRealtime para uma pergunta de performance ou banco, diga que o dado real não está disponível no snapshot recebido em vez de inferir pelo diário.",
    "Se faltar informação no contexto, diga que não está informado no monitoramento/diário/código recebido em vez de inventar.",
    "Responda em blocos curtos por frente ou módulo. Use títulos como `Frente: ReleaseOps / Engineering Operations`, `Frente: Guardian`, `Frente: PulseX`, `Frente: SquadOps` ou `Frente: SupportOps` quando houver informação para aquela frente.",
    "Evite markdown pesado. Prefira bullets simples, agrupados e elegantes; nao quebre cada frase como se fosse uma resposta isolada.",
    "Feche com uma conclusão objetiva contendo risco, pendência e próximo passo quando fizer sentido.",
  ].join("\n");
}

function buildCopilotInput({
  codeContext,
  messages,
  monitoringSnapshot,
  operations,
  promptTarget,
  question,
  structuredOperations,
  structuredStatus,
}: {
  codeContext: HubCodeContext;
  messages: PoAiMessage[];
  monitoringSnapshot: OperationsMonitoringSnapshot;
  operations: EngineeringOperationsResponse;
  promptTarget: (typeof promptTargets)[number] | null;
  question: string;
  structuredOperations: StructuredEngineeringOperation[];
  structuredStatus: string;
}) {
  const context = {
    auditorias: operations.auditRoutines.map(summarizeRoutine),
    baseEstruturadaSupabase: {
      registros: structuredOperations.slice(0, 40).map(summarizeStructuredRecord),
      status: structuredStatus,
      totalRecebido: structuredOperations.length,
    },
    codigoDoHub: summarizeCodeContext(codeContext),
    fonteDoEstadoAtual:
      "Para banco, performance, APIs, filas, payload, Supabase, C2X e alertas, use monitoramentoRealtime como fonte principal. Para historico estruturado, protocolos, releases, healthchecks e handoffs, use baseEstruturadaSupabase quando preenchida. Engineering Operations e memoria narrativa/fallback.",
    historicoDaConversa: messages.slice(-8),
    monitoramentoRealtime: summarizeMonitoringSnapshot(monitoringSnapshot),
    perguntaDoLucas: question,
    pendenciasCriticas: operations.criticalRecords.slice(0, 10).map(summarizeRecord),
    promptTarget,
    registrosRecentes: operations.records.slice(0, 18).map(summarizeRecord),
    releasesRecentes: operations.releaseRecords.slice(0, 8).map(summarizeRecord),
    statusConsolidado: operations.statusConsolidated,
    totais: operations.metrics,
  };

  return JSON.stringify(context, null, 2).slice(0, MAX_CONTEXT_CHARS);
}

function summarizeMonitoringSnapshot(snapshot: OperationsMonitoringSnapshot) {
  return {
    alertasAtivos: snapshot.alerts.slice(0, 12).map((alert) => ({
      agenteRecomendado: alert.recommendedAgent,
      impacto: alert.impact,
      modulo: alert.module,
      nivel: alert.level,
      origem: alert.origin,
      recomendacao: alert.recommendation,
      titulo: alert.title,
      tipo: alert.type,
    })),
    checksRecentes: snapshot.checks.map((check) => ({
      endpoint: check.endpoint,
      esperado: check.expected.description,
      modulo: check.module,
      payloadBytes: check.payloadBytes,
      recebido: check.received,
      risco: check.risk,
      statusHttp: check.statusCode,
      tempoMs: check.responseMs,
    })),
    geradoEm: snapshot.generatedAt,
    metricas: snapshot.metrics,
    statusGeral: snapshot.cards.status,
    supabase: snapshot.cards.supabase,
  };
}

function summarizeRecord(record: EngineeringOperationRecord) {
  return {
    assunto: record.subject,
    commit: record.commit,
    dataHora: record.localDateTime,
    deploy: record.deploy,
    modulo: record.module,
    pendenciasOuRiscos: record.risks,
    proximaSquad: record.nextSquad,
    resumo: record.shortSummary,
    rotina: record.routine,
    squad: record.squad,
    status: record.status,
    tipo: record.type,
    validacao: record.validation,
  };
}

function summarizeStructuredRecord(record: StructuredEngineeringOperation) {
  return {
    assunto: record.subject,
    commit: record.commit,
    dataHora: record.localOccurredAt ?? record.localDateTime,
    deploy: record.deploy,
    healthchecks: record.healthchecks,
    modulo: record.module,
    pendenciasOuRiscos: record.risks,
    protocolo: record.protocol,
    proximaSquad: record.nextSquad,
    resumo: record.macroSummary ?? record.validation,
    squad: record.squad,
    status: record.status,
    tela: record.screen,
    tipo: record.type,
    validacao: record.validation,
  };
}

function summarizeRoutine(routine: EngineeringAuditRoutine) {
  return {
    frequencia: routine.frequency,
    historico: routine.history.slice(0, 4).map(summarizeRecord),
    nome: routine.name,
    resultadoConsolidado: routine.consolidatedResult,
    responsavelSugerido: routine.responsible,
    status: routine.lastStatus,
    ultimaExecucao: routine.lastExecution,
    vencida: routine.isOverdue,
  };
}

function summarizeCodeContext(codeContext: HubCodeContext) {
  return {
    arquivos: codeContext.files.map((file) => ({
      caminho: file.path,
      motivo: file.reason,
      tamanhoBytes: file.size,
      trecho: file.excerpt,
    })),
    arquivosEscaneados: codeContext.scannedFiles,
    excluidosPorSeguranca: codeContext.excluded,
    geradoEm: codeContext.generatedAt,
    raiz: codeContext.root,
    resumo: codeContext.summary,
  };
}

function isPromptTarget(value: unknown): value is (typeof promptTargets)[number] {
  return promptTargets.some((target) => target === value);
}

function parsePoAiMessages(value: unknown): PoAiMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((message): PoAiMessage | null => {
      if (!message || typeof message !== "object") {
        return null;
      }

      const role = (message as { role?: unknown }).role;
      const content = (message as { content?: unknown }).content;

      if (
        (role !== "assistant" && role !== "user") ||
        typeof content !== "string"
      ) {
        return null;
      }

      return {
        content: content.trim().slice(0, 4_000),
        role,
      };
    })
    .filter((message): message is PoAiMessage => Boolean(message?.content))
    .slice(-10);
}

function extractOutputText(payload: Record<string, unknown> | null) {
  if (!payload) {
    return "";
  }

  if (typeof payload.output_text === "string") {
    return payload.output_text.trim();
  }

  const output = Array.isArray(payload.output) ? payload.output : [];
  const chunks: string[] = [];

  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const content = (item as { content?: unknown }).content;

    if (!Array.isArray(content)) {
      continue;
    }

    for (const part of content) {
      if (
        part &&
        typeof part === "object" &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        chunks.push((part as { text: string }).text);
      }
    }
  }

  return chunks.join("\n").trim();
}

function extractOpenAiError(payload: Record<string, unknown> | null) {
  const error = payload?.error;

  if (!error || typeof error !== "object") {
    return "";
  }

  const message = (error as { message?: unknown }).message;

  return typeof message === "string" ? message : "";
}

function getOpenAiErrorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "PO AI demorou para responder. Tente novamente em instantes.";
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Não foi possível consultar o PO AI agora.";
}
