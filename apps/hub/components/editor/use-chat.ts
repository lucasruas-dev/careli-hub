"use client";

import * as React from "react";

import { type UseChatHelpers, useChat as useBaseChat } from "@ai-sdk/react";
import { withAIBatch } from "@platejs/ai";
import { AIChatPlugin, aiCommentToRange, applyTableCellSuggestion } from "@platejs/ai/react";
import { getCommentKey, getTransientCommentKey } from "@platejs/comment";
import { deserializeMd } from "@platejs/markdown";
import { BlockSelectionPlugin } from "@platejs/selection/react";
import { type UIMessage, DefaultChatTransport } from "ai";
import { type TNode, KEYS, nanoid, NodeApi, TextApi } from "platejs";
import { type PlateEditor, useEditorRef, usePluginOption } from "platejs/react";

import { aiChatPlugin } from "@/components/editor/plugins/ai-kit";
import { getApoloAccessToken } from "@/modules/apolo/data/apolo-operations";

import { discussionPlugin } from "./plugins/discussion-kit";

// Cliente do chat de IA do editor de minutas (Têmis). REESCRITO por cima do `use-chat` do registro
// do Plate (item `ai-kit`): aquele vinha com um stream FALSO (`faker` + lorem ipsum) que entrava em
// ação sempre que a rota respondia erro — a tela "funcionava" com texto inventado e o defeito da
// rota nunca aparecia. Aqui erro é erro: o `AIMenu` mostra `chat.error`.
//
// O que ficou do registro: o transporte (`DefaultChatTransport` para `/api/ai/command`), o merge de
// `chatOptions.body` e o `onData` que aplica `data-toolName` / `data-table` / `data-comment`.
// O que entrou: `Authorization: Bearer` da sessão do hub em todo pedido (a rota exige
// `authorizeApoloWrite`).
//
// ⚠️ `_abortFakeStream` continua no objeto `chat` como no-op: `components/ui/ai-menu.tsx` (gerado
// pelo registro, não editamos) chama `(chat as any)._abortFakeStream()` ao fechar o menu.

export type ToolName = "comment" | "edit" | "generate";

export type TComment = {
  comment: {
    blockId: string;
    comment: string;
    content: string;
  } | null;
  status: "finished" | "streaming";
};

export type TTableCellUpdate = {
  cellUpdate: {
    content: string;
    id: string;
  } | null;
  status: "finished" | "streaming";
};

export type MessageDataPart = {
  toolName: ToolName;
  comment?: TComment;
  table?: TTableCellUpdate;
};

export type Chat = UseChatHelpers<ChatMessage>;

export type ChatMessage = UIMessage<{}, MessageDataPart>;

async function mensagemDoErro(resposta: Response): Promise<string> {
  try {
    const corpo = (await resposta.json()) as { error?: unknown };
    if (typeof corpo?.error === "string" && corpo.error.trim()) return corpo.error;
  } catch {
    // corpo não é JSON
  }
  if (resposta.status === 401 || resposta.status === 403) {
    return "Sua sessão não tem acesso à IA do editor. Entre de novo no Panteon.";
  }
  if (resposta.status === 503) {
    return "A IA do editor não está configurada neste ambiente.";
  }
  return `A IA do editor não respondeu (HTTP ${resposta.status}).`;
}

function createChatTransport({ api, editor }: { api: string; editor: PlateEditor }) {
  return new DefaultChatTransport({
    api,
    fetch: (async (input, init) => {
      // `chatOptions.body` (o kit manda `{}`; a Têmis pode pôr metadados) entra por cima do corpo
      // que o `@ai-sdk/react` monta (messages + ctx).
      const bodyOptions = editor.getOptions(aiChatPlugin).chatOptions?.body;
      const initBody = typeof init?.body === "string" ? (JSON.parse(init.body) as object) : {};
      const body = { ...initBody, ...(bodyOptions ?? {}) };

      const token = await getApoloAccessToken();
      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Bearer ${token}`);
      headers.set("Content-Type", "application/json");

      const res = await fetch(input, {
        ...init,
        body: JSON.stringify(body),
        headers,
      });

      if (!res.ok) {
        throw new Error(await mensagemDoErro(res));
      }

      return res;
    }) as typeof fetch,
  });
}

export const useChat = () => {
  const editor = useEditorRef();
  const options = usePluginOption(aiChatPlugin, "chatOptions");

  const transport = React.useMemo(
    () =>
      createChatTransport({
        api: options.api || "/api/ai/command",
        editor,
      }),
    [editor, options.api],
  );

  const baseChat = useBaseChat<ChatMessage>({
    id: "editor",
    transport,
    onData(data) {
      if (data.type === "data-toolName") {
        editor.setOption(AIChatPlugin, "toolName", data.data as ToolName);
      }

      if (data.type === "data-table" && data.data) {
        const tableData = data.data as TTableCellUpdate;

        if (tableData.status === "finished") {
          const chatSelection = editor.getOption(AIChatPlugin, "chatSelection");

          if (!chatSelection) return;

          editor.tf.setSelection(chatSelection);

          return;
        }

        const cellUpdate = tableData.cellUpdate;
        if (!cellUpdate) return;

        withAIBatch(editor, () => {
          applyTableCellSuggestion(editor, cellUpdate);
        });
      }

      if (data.type === "data-comment" && data.data) {
        const commentData = data.data as TComment;

        if (commentData.status === "finished") {
          editor.getApi(BlockSelectionPlugin).blockSelection.deselect();

          return;
        }

        const aiComment = commentData.comment;
        if (!aiComment) return;
        const range = aiCommentToRange(editor, aiComment);

        if (!range) return console.warn("[ai/command] comentário sem trecho correspondente");

        const discussions = editor.getOption(discussionPlugin, "discussions") || [];

        const discussionId = nanoid();

        const newComment = {
          id: nanoid(),
          contentRich: [{ children: [{ text: aiComment.comment }], type: "p" }],
          createdAt: new Date(),
          discussionId,
          isEdited: false,
          userId: editor.getOption(discussionPlugin, "currentUserId"),
        };

        const newDiscussion = {
          id: discussionId,
          comments: [newComment],
          createdAt: new Date(),
          documentContent: deserializeMd(editor, aiComment.content)
            .map((node: TNode) => NodeApi.string(node))
            .join("\n"),
          isResolved: false,
          userId: editor.getOption(discussionPlugin, "currentUserId"),
        };

        editor.setOption(discussionPlugin, "discussions", [...discussions, newDiscussion]);

        // Marca de comentário no trecho (transiente: some se a IA for descartada).
        editor.tf.withMerging(() => {
          editor.tf.setNodes(
            {
              [getCommentKey(newDiscussion.id)]: true,
              [getTransientCommentKey()]: true,
              [KEYS.comment]: true,
            },
            {
              at: range,
              match: TextApi.isText,
              split: true,
            },
          );
        });
      }
    },

    ...options,
  });

  // No-op mantido pelo `ai-menu.tsx` do registro (ver cabeçalho).
  const _abortFakeStream = React.useCallback(() => {}, []);

  const chat = {
    ...baseChat,
    _abortFakeStream,
  };

  React.useEffect(() => {
    editor.setOption(AIChatPlugin, "chat", chat as never);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.status, chat.messages, chat.error, _abortFakeStream]);

  return chat;
};
