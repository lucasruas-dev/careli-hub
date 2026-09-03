import { NextResponse, type NextRequest } from "next/server";

import { createAnthropic } from "@ai-sdk/anthropic";
import {
  type LanguageModel,
  type UIMessageStreamWriter,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateText,
  Output,
  streamText,
  tool,
  toUIMessageStream,
} from "ai";
import { type SlateEditor, createSlateEditor, nanoid } from "platejs";
import { z } from "zod";

import type { ChatMessage, ToolName } from "@/components/editor/use-chat";
import { CLAUDE_MODEL, isClaudeConfigured } from "@/lib/ai/claude";
import { authorizeApoloWrite } from "@/lib/apolo/auth";
import { markdownJoinerTransform } from "@/lib/markdown-joiner-transform";
import { BaseEditorKitTemis } from "@/modules/temis/editor-base-kit-temis";

import {
  buildEditTableMultiCellPrompt,
  getChooseToolPrompt,
  getCommentPrompt,
  getEditPrompt,
  getGeneratePrompt,
} from "./prompt";

// IA DO EDITOR DE MINUTAS (Têmis) — a rota que o `AIChatPlugin` do Plate chama (`chatOptions.api`).
//
// Segunda pilha de IA do app, só para o editor da Têmis: o Plate exige o UI Message Stream do
// `ai@7`/`@ai-sdk/react` (chunks `data-toolName`, `data-comment`, `data-table` + texto em
// streaming). NÃO unificar com `lib/ai/claude.ts` (Cacá/Athena usam o SDK oficial, sem stream).
//
// Pedido do Lucas (02/09/2026): "revise as documentações pois quero isso completo, estamos muito
// simples" — o editor com o conjunto inteiro do Plate UI, IA incluída. Provider: Anthropic via
// `@ai-sdk/anthropic`, modelo `CLAUDE_MODEL.default` (= claude-sonnet-5), chave `ANTHROPIC_API_KEY`
// (a mesma das outras rotas).
//
// ⚠️ O kit do Plate manda `apiKey` e `model` no corpo (o template deles aceitava chave do browser).
// Aqui a rota NUNCA lê esses campos: chave é do servidor, modelo é fixo. Quem manda `model:
// "gpt-4o"` recebe o Claude do mesmo jeito (testado em route.test.ts).
//
// ⚠️ Auth: `authorizeApoloWrite` (Bearer da sessão do hub, papel operator+). Não copiar o
// `authorizeHubAiRequest` de app/api/ai/chat — aquele é da Athena.
//
// Variáveis do sistema (`[nome_cliente]`): o documento vai ao modelo em markdown, onde a regra de
// serialização da Têmis (editor-base-kit-temis) emite o nó `variavel` como `[nome]`; os prompts
// (prompt/common.ts) mandam reproduzi-las EXATAMENTE. Na volta, o `normalizeNode` do plugin de
// variável converte `[nome]` de novo em nó.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_OUTPUT_TOKENS = 4096;

// Claude Sonnet 5: thinking adaptativo é o único modo; `temperature`/`top_p` dão 400 nos modelos
// novos — por isso nenhum parâmetro de amostragem aqui. `effort` baixo para escolher a ferramenta
// (classificação de uma palavra), médio para gerar/editar/comentar texto jurídico.
function opcoesAnthropic(effort: "low" | "medium") {
  return { anthropic: { effort, thinking: { type: "adaptive" } } };
}

type CorpoDaRequisicao = {
  ctx?: {
    children?: unknown;
    selection?: unknown;
    toolName?: unknown;
  };
  messages?: unknown;
};

const FERRAMENTAS: ToolName[] = ["comment", "edit", "generate"];

export async function POST(req: NextRequest) {
  const auth = await authorizeApoloWrite(req);
  if (!auth.ok) return auth.response;

  if (!isClaudeConfigured()) {
    return NextResponse.json(
      { error: "Configure ANTHROPIC_API_KEY no ambiente do Panteon para ativar a IA do editor." },
      { status: 503 },
    );
  }

  const corpo = (await req.json().catch(() => null)) as CorpoDaRequisicao | null;
  const children = corpo?.ctx?.children;
  const messagesRaw = corpo?.messages;
  if (!Array.isArray(children) || !Array.isArray(messagesRaw)) {
    return NextResponse.json({ error: "Requisicao invalida." }, { status: 400 });
  }
  const selection = corpo?.ctx?.selection;
  const toolNameParam = corpo?.ctx?.toolName;
  const toolNamePedida: ToolName | null =
    typeof toolNameParam === "string" && (FERRAMENTAS as string[]).includes(toolNameParam)
      ? (toolNameParam as ToolName)
      : null;

  // O documento é reconstruído no servidor com os MESMOS plugins base da Têmis (sem React) para os
  // prompts serializarem markdown com `[variavel]`, ids de bloco e células.
  const editor = createSlateEditor({
    plugins: BaseEditorKitTemis,
    selection: (selection ?? null) as never,
    value: children as never,
  });

  const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY?.trim() });
  const modelo = anthropic(CLAUDE_MODEL.default);

  const isSelecting = editor.api.isExpanded();
  const mensagens = messagesRaw as ChatMessage[];

  try {
    const stream = createUIMessageStream<ChatMessage>({
      execute: async ({ writer }) => {
        let toolName: ToolName | null = toolNamePedida;

        if (!toolName) {
          const prompt = getChooseToolPrompt({ isSelecting, messages: mensagens });
          const opcoes: ToolName[] = isSelecting
            ? ["generate", "edit", "comment"]
            : ["generate", "comment"];

          // ⚠️ `maxOutputTokens: 64` CORTAVA A ESCOLHA. No Sonnet 5 os tokens do thinking adaptativo
          // contam no teto de saída: quando o modelo pensava antes de responder, a resposta era
          // cortada, `output` vinha vazio, nenhuma ferramenta era escolhida e o `streamText` rodava
          // com prompt vazio → 400 da Anthropic dentro do stream → "não respondeu" no menu de IA.
          // Intermitente, o pior tipo. 1024 dá folga para o pouco que `effort: low` pensa; e se
          // ainda assim não vier escolha, "generate" é o padrão (é o que o menu faz sem seleção).
          const { output: escolhida } = await generateText({
            maxOutputTokens: 1024,
            model: modelo,
            output: Output.choice({ options: opcoes }),
            prompt,
            providerOptions: opcoesAnthropic("low"),
          });

          const escolhaValida: ToolName | undefined = escolhida;
          toolName = escolhaValida ?? "generate";
          writer.write({ data: toolName, type: "data-toolName" });
        }

        const tools = {
          comment: getCommentTool(editor, { messagesRaw: mensagens, model: modelo, writer }),
          table: getTableTool(editor, { messagesRaw: mensagens, model: modelo, writer }),
        };

        const result = streamText({
          experimental_transform: markdownJoinerTransform(),
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          model: modelo,
          // Não usado: o prompt de verdade é montado em `prepareStep` conforme a ferramenta.
          prompt: "",
          providerOptions: opcoesAnthropic("medium"),
          tools,
          prepareStep: async (step) => {
            if (toolName === "comment") {
              return { ...step, toolChoice: { toolName: "comment", type: "tool" } };
            }

            if (toolName === "edit") {
              const [editPrompt, editType] = getEditPrompt(editor, {
                isSelecting,
                messages: mensagens,
              });

              // Edição de várias células usa a ferramenta de tabela (JSON por célula).
              if (editType === "table") {
                return { ...step, toolChoice: { toolName: "table", type: "tool" } };
              }

              return {
                ...step,
                activeTools: [],
                messages: [{ content: editPrompt, role: "user" }],
              };
            }

            if (toolName === "generate") {
              const generatePrompt = getGeneratePrompt(editor, {
                isSelecting,
                messages: mensagens,
              });

              return {
                ...step,
                activeTools: [],
                messages: [{ content: generatePrompt, role: "user" }],
              };
            }
          },
        });

        writer.merge(
          toUIMessageStream({
            sendFinish: false,
            stream: result.stream,
            tools,
          }),
        );
      },
    });

    return createUIMessageStreamResponse({ stream });
  } catch (error) {
    // Sem corpo no log: o documento é minuta de contrato.
    console.warn("[ai/command] falha:", error instanceof Error ? error.name : "erro");
    return NextResponse.json({ error: "Nao foi possivel processar o pedido de IA." }, { status: 500 });
  }
}

const getCommentTool = (
  editor: SlateEditor,
  {
    messagesRaw,
    model,
    writer,
  }: {
    messagesRaw: ChatMessage[];
    model: LanguageModel;
    writer: UIMessageStreamWriter<ChatMessage>;
  },
) =>
  tool({
    description: "Comentar o conteúdo",
    inputSchema: z.object({}),
    strict: true,
    execute: async () => {
      const commentSchema = z.object({
        blockId: z
          .string()
          .describe(
            "O id do bloco inicial. Se o comentário abrange vários blocos, use o id do primeiro.",
          ),
        comment: z.string().describe("Um comentário breve ou explicação para este trecho."),
        content: z
          .string()
          .describe(
            String.raw`O trecho ORIGINAL do documento a ser comentado, copiado ao pé da letra. Pode ser o bloco inteiro, uma parte dele ou vários blocos. Se abranger vários blocos, separe-os com dois \n\n.`,
          ),
      });

      const { elementStream } = streamText({
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        model,
        output: Output.array<z.infer<typeof commentSchema>>({ element: commentSchema }),
        prompt: getCommentPrompt(editor, { messages: messagesRaw }),
        providerOptions: opcoesAnthropic("medium"),
      });

      for await (const comment of elementStream) {
        writer.write({
          id: nanoid(),
          data: { comment, status: "streaming" },
          type: "data-comment",
        });
      }

      writer.write({
        id: nanoid(),
        data: { comment: null, status: "finished" },
        type: "data-comment",
      });
    },
  });

const getTableTool = (
  editor: SlateEditor,
  {
    messagesRaw,
    model,
    writer,
  }: {
    messagesRaw: ChatMessage[];
    model: LanguageModel;
    writer: UIMessageStreamWriter<ChatMessage>;
  },
) =>
  tool({
    description: "Editar células de tabela",
    inputSchema: z.object({}),
    strict: true,
    execute: async () => {
      const cellUpdateSchema = z.object({
        content: z
          .string()
          .describe(
            String.raw`O novo conteúdo da célula. Pode ter vários parágrafos separados por \n\n.`,
          ),
        id: z.string().describe("O id da célula da tabela a atualizar."),
      });

      const { elementStream } = streamText({
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        model,
        output: Output.array<z.infer<typeof cellUpdateSchema>>({ element: cellUpdateSchema }),
        prompt: buildEditTableMultiCellPrompt(editor, messagesRaw),
        providerOptions: opcoesAnthropic("medium"),
      });

      for await (const cellUpdate of elementStream) {
        writer.write({
          id: nanoid(),
          data: { cellUpdate, status: "streaming" },
          type: "data-table",
        });
      }

      writer.write({
        id: nanoid(),
        data: { cellUpdate: null, status: "finished" },
        type: "data-table",
      });
    },
  });
