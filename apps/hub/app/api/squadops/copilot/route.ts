import { NextResponse, type NextRequest } from "next/server";

import {
  loadHubCodeContext,
  type HubCodeContext,
} from "@/lib/squadops/hub-code-context";
import { loadEngineeringOperationsFromFile } from "@/lib/squadops/engineering-operations-source";
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

type SupabaseUserPayload = {
  id?: unknown;
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

  const auth = await authorizeCopilotRequest(request);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
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

  const codeContext = await loadHubCodeContext(parsedRequest.data.question);

  try {
    const answer = await createCopilotAnswer({
      apiKey,
      codeContext,
      messages: parsedRequest.data.messages,
      model: process.env.HUB_AI_MODEL?.trim() || DEFAULT_MODEL,
      operations: operations.data,
      promptTarget: parsedRequest.data.promptTarget,
      question: parsedRequest.data.question,
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
  operations,
  promptTarget,
  question,
  userId,
}: {
  apiKey: string;
  codeContext: HubCodeContext;
  messages: PoAiMessage[];
  model: string;
  operations: EngineeringOperationsResponse;
  promptTarget: (typeof promptTargets)[number] | null;
  question: string;
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
              operations,
              promptTarget,
              question,
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
    "Você é o PO AI, o cérebro operacional do Careli Hub dentro do HubOps.",
    "Responda sempre em português do Brasil, com linguagem executiva, simples, instrucional e direta para Lucas.",
    "Use somente o contexto recebido: diário Engineering Operations, histórico da conversa e mapa seguro do código do Hub.",
    "Você conhece arquitetura, módulos, rotas, componentes, APIs, riscos, pendências, deploys e decisões registradas quando esse conteúdo estiver no contexto.",
    "Quando o Lucas perguntar sobre código, use o mapa e os trechos de código recebidos. Se o trecho necessário não estiver no contexto, diga qual arquivo precisa ser aberto/indexado em seguida.",
    "Você pode explicar o que foi feito, impactos, riscos, pendências, squads recomendadas, validações faltantes, prompts para agentes e próximos passos.",
    "Você não pode alterar arquivos, executar comandos, fazer deploy, mudar status, chamar agentes automaticamente ou prometer ações feitas.",
    "Quando gerar prompt para agente, use exatamente: Assunto, Contexto, Objetivo, Tarefas, Validações esperadas e Retorno esperado.",
    "Nunca exponha nem peça chaves, tokens, senhas, variáveis .env ou credenciais. Se algo sensível for necessário, oriente Lucas a validar server-side sem revelar o valor.",
    "Se faltar informação no contexto, diga que não está informado no diário/código recebido em vez de inventar.",
    "Responda em blocos curtos por frente ou módulo. Use títulos como `Frente: ReleaseOps / Engineering Operations`, `Frente: Guardian`, `Frente: PulseX`, `Frente: HubOps / SquadOps` ou `Frente: SupportOps` quando houver informação para aquela frente.",
    "Evite markdown pesado. Prefira frases curtas, bullets simples e uma conclusão objetiva com risco, pendência e próximo passo.",
  ].join("\n");
}

function buildCopilotInput({
  codeContext,
  messages,
  operations,
  promptTarget,
  question,
}: {
  codeContext: HubCodeContext;
  messages: PoAiMessage[];
  operations: EngineeringOperationsResponse;
  promptTarget: (typeof promptTargets)[number] | null;
  question: string;
}) {
  const context = {
    auditorias: operations.auditRoutines.map(summarizeRoutine),
    codigoDoHub: summarizeCodeContext(codeContext),
    historicoDaConversa: messages.slice(-8),
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

async function authorizeCopilotRequest(request: NextRequest): Promise<
  | { ok: true; userId: string }
  | { error: string; ok: false; status: number }
> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    return {
      ok: true,
      userId: "local-squadops-po",
    };
  }

  const accessToken = getBearerToken(request);

  if (!accessToken) {
    return {
      error: "Sessão ausente para usar o PO AI.",
      ok: false,
      status: 401,
    };
  }

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: anonKey,
      },
    });
    const payload = (await response.json().catch(() => null)) as
      | SupabaseUserPayload
      | null;

    if (!response.ok || typeof payload?.id !== "string") {
      return {
        error: "Sessão inválida para usar o PO AI.",
        ok: false,
        status: response.status === 400 ? 401 : response.status,
      };
    }

    return {
      ok: true,
      userId: payload.id,
    };
  } catch {
    return {
      error: "Não foi possível validar a sessão do PO AI.",
      ok: false,
      status: 503,
    };
  }
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

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim() || null;
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
