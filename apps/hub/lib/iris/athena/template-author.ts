import type Anthropic from "@anthropic-ai/sdk";

import { getAnthropicClient, resolveClaudeModel } from "@/lib/ai/claude";

// Athena (copiloto INTERNO do time) — capacidade de AUTORIA DE TEMPLATES do
// WhatsApp/Meta. O colaborador descreve o que quer em portugues e a Athena
// devolve um template pronto e valido (nome, categoria, corpo com variaveis
// sequenciais, botoes, sugestao de anexo) que pre-preenche o formulario do
// Setup -> Templates. Sempre Claude/Opus — nunca OpenAI. NUNCA envia sozinha:
// devolve um rascunho para o operador revisar e mandar pra Meta.

export type TemplateAuthorVariable = {
  key: string;
  label?: string | null;
  example?: string | null;
  readiness?: string | null;
};

export type TemplateAuthorRequest = {
  prompt: string;
  variables: TemplateAuthorVariable[];
  existingNames?: string[];
  contextHint?: string | null;
};

export type TemplateAuthorDraft = {
  displayName: string;
  name: string;
  category: "UTILITY" | "MARKETING" | "AUTHENTICATION";
  language: string;
  bodyText: string;
  variables: { key: string; placeholder: string }[];
  buttons: string[];
  headerFormat: "NONE" | "IMAGE" | "VIDEO" | "DOCUMENT";
  headerHint: string;
  rationale: string;
  warnings: string[];
};

export type TemplateAuthorResult =
  | { ok: true; draft: TemplateAuthorDraft; model: string }
  | { ok: false; error: string };

const CATEGORIES = new Set(["UTILITY", "MARKETING", "AUTHENTICATION"]);
const HEADER_FORMATS = new Set(["NONE", "IMAGE", "VIDEO", "DOCUMENT"]);

const TEMPLATE_TOOL: Anthropic.Tool = {
  description:
    "Emite UM template de WhatsApp/Meta pronto para revisao e envio. Sempre chame esta ferramenta.",
  input_schema: {
    type: "object",
    properties: {
      displayName: {
        type: "string",
        description: "Nome amigavel interno (ex.: 'Cobranca · parcelas em aberto').",
      },
      name: {
        type: "string",
        description:
          "Nome tecnico da Meta: minusculas, numeros e underscore; sem acento/espaco; com sufixo de versao _v1. Ex.: financeiro_cobranca_parcelas_v1.",
      },
      category: {
        type: "string",
        enum: ["UTILITY", "MARKETING", "AUTHENTICATION"],
      },
      language: { type: "string", description: "Sempre pt_BR." },
      bodyText: {
        type: "string",
        description:
          "Corpo da mensagem com as variaveis {{1}}, {{2}}... sequenciais e sem buraco. Nunca comecar/terminar com variavel nem colar duas.",
      },
      variables: {
        type: "array",
        description:
          "Ordem = posicao no corpo. Cada item liga um placeholder {{n}} a uma CHAVE do catalogo permitido.",
        items: {
          type: "object",
          properties: {
            key: { type: "string" },
            placeholder: { type: "string", description: "{{1}}, {{2}}, ..." },
          },
          required: ["key", "placeholder"],
        },
      },
      buttons: {
        type: "array",
        description: "Ate 3 botoes de resposta rapida, cada um com <= 25 caracteres.",
        items: { type: "string" },
      },
      headerFormat: {
        type: "string",
        enum: ["NONE", "IMAGE", "VIDEO", "DOCUMENT"],
      },
      headerHint: {
        type: "string",
        description:
          "Se headerFormat != NONE, o que o operador deve anexar. Se NONE, string vazia.",
      },
      rationale: {
        type: "string",
        description: "1-2 frases: por que essa categoria e estrutura.",
      },
      warnings: {
        type: "array",
        description:
          "Avisos ao operador (ex.: variavel pedida que sairia '-', risco de reclassificacao). Vazio se nao houver.",
        items: { type: "string" },
      },
    },
    required: [
      "displayName",
      "name",
      "category",
      "language",
      "bodyText",
      "variables",
      "buttons",
      "headerFormat",
      "rationale",
    ],
  },
  name: "emitir_template",
};

function buildSystemPrompt(
  variables: TemplateAuthorVariable[],
  existingNames: string[],
  contextHint: string | null,
): string {
  const catalogo = variables
    .map((variable) => {
      const parts = [`- ${variable.key}`];
      if (variable.label) parts.push(`(${variable.label})`);
      if (variable.readiness) parts.push(`[${variable.readiness}]`);
      if (variable.example) parts.push(`ex.: ${variable.example}`);
      return parts.join(" ");
    })
    .join("\n");

  const nomes = existingNames.length
    ? existingNames.slice(0, 40).join(", ")
    : "(nenhum)";

  return [
    "Voce e a Athena, copiloto INTERNO do time da Careli (administradora de carteiras de loteamentos/financiamento). Sua tarefa aqui: redigir templates de WhatsApp/Meta assertivos e profissionais, que aprovem de primeira e preencham corretamente no envio.",
    "",
    "CATALOGO DE VARIAVEIS PERMITIDAS (use SOMENTE estas chaves):",
    catalogo,
    "",
    "O que cada readiness significa no ENVIO real:",
    "- [Pronta]: preenche sempre.",
    "- [Iris]: preenche pela Iris/operador (operador, assunto, parcelas).",
    "- [Cobranca]: preenche ao abrir o atendimento pela FILA FINANCEIRA (contexto Parcelas do cliente). Fora desse contexto sairia '-' — so use se o template for de cobranca/financeiro.",
    "Se o usuario pedir um dado que NAO existe no catalogo, nao invente variavel: escreva fixo no texto ou registre um aviso em warnings.",
    "",
    "REGRAS DA META (obrigatorias):",
    "- Categoria: UTILITY = transacional atrelado a conta/acao (cobranca, aviso de vencimento, recibo). MARKETING = promocao, comunicado em massa, reengajamento, oferta. AUTHENTICATION = apenas codigo OTP.",
    "- NUNCA misture promocional em UTILITY — a Meta reclassifica para MARKETING (e passa a cobrar). Se o pedido tiver pitch/oferta, marque MARKETING.",
    "- Variaveis numeradas {{1}}..{{n}} SEQUENCIAIS e sem buraco; o corpo nao pode comecar nem terminar com variavel, nem ter duas variaveis coladas.",
    "- Corpo <= 1024 caracteres. Ate 3 botoes de resposta rapida, cada um <= 25 caracteres.",
    "- language sempre pt_BR. name em snake_case minusculo, sem acento, com sufixo _v1; NAO repita um nome ja existente.",
    "",
    "ANEXO (headerFormat): use NONE por padrao. Sugira IMAGE (banner) em comunicado de massa/marketing quando ajudar; DOCUMENT (PDF) quando o conteudo for um documento (ex.: boleto/contrato). Explique em headerHint o que anexar.",
    "",
    "TOM: cordial e firme, profissional, direto. Portugues do Brasil. Sem emoji excessivo. Trate o cliente por " +
      "{{primeiro_nome}} quando fizer sentido.",
    "",
    `Nomes de templates JA existentes (evite colidir): ${nomes}.`,
    contextHint ? `Contexto sugerido pelo operador: ${contextHint}.` : "",
    "",
    "Responda SEMPRE chamando a ferramenta emitir_template — nunca texto solto.",
  ]
    .filter(Boolean)
    .join("\n");
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeDraft(input: unknown): TemplateAuthorDraft {
  const raw = (input ?? {}) as Record<string, unknown>;

  const category = asString(raw.category, "UTILITY").toUpperCase();
  const headerFormat = asString(raw.headerFormat, "NONE").toUpperCase();

  const variables = Array.isArray(raw.variables)
    ? raw.variables
        .map((item) => {
          const entry = (item ?? {}) as Record<string, unknown>;
          return {
            key: asString(entry.key).trim(),
            placeholder: asString(entry.placeholder).trim(),
          };
        })
        .filter((entry) => entry.key && entry.placeholder)
    : [];

  const buttons = Array.isArray(raw.buttons)
    ? raw.buttons
        .map((button) => asString(button).trim())
        .filter(Boolean)
        .slice(0, 3)
    : [];

  const warnings = Array.isArray(raw.warnings)
    ? raw.warnings.map((warning) => asString(warning).trim()).filter(Boolean)
    : [];

  return {
    bodyText: asString(raw.bodyText).trim(),
    buttons,
    category: (CATEGORIES.has(category)
      ? category
      : "UTILITY") as TemplateAuthorDraft["category"],
    displayName: asString(raw.displayName, "Novo template").trim(),
    headerFormat: (HEADER_FORMATS.has(headerFormat)
      ? headerFormat
      : "NONE") as TemplateAuthorDraft["headerFormat"],
    headerHint: asString(raw.headerHint).trim(),
    language: asString(raw.language, "pt_BR").trim() || "pt_BR",
    name: asString(raw.name).trim(),
    rationale: asString(raw.rationale).trim(),
    variables,
    warnings,
  };
}

export async function authorTemplate(
  request: TemplateAuthorRequest,
): Promise<TemplateAuthorResult> {
  const prompt = request.prompt?.trim() ?? "";
  if (!prompt) {
    return { error: "Descreva o template que voce quer.", ok: false };
  }

  const client = getAnthropicClient();
  if (!client) {
    return {
      error: "IA indisponivel (ANTHROPIC_API_KEY nao configurada).",
      ok: false,
    };
  }

  try {
    const response = await client.messages.create({
      max_tokens: 1500,
      messages: [{ content: prompt, role: "user" }],
      model: resolveClaudeModel("heavy"),
      system: buildSystemPrompt(
        request.variables ?? [],
        request.existingNames ?? [],
        request.contextHint ?? null,
      ),
      tool_choice: { name: "emitir_template", type: "tool" },
      tools: [TEMPLATE_TOOL],
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );
    if (!toolUse) {
      return { error: "A Athena nao conseguiu montar o template.", ok: false };
    }

    const draft = normalizeDraft(toolUse.input);
    if (!draft.bodyText || draft.variables.length === 0) {
      return {
        error: "O rascunho da Athena veio incompleto — tente descrever de novo.",
        ok: false,
      };
    }

    return { draft, model: response.model, ok: true };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Falha ao gerar o template com a Athena.",
      ok: false,
    };
  }
}
