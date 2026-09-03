"use client";

import type { MarkdownPlugin } from "@platejs/markdown";
import { KEYS } from "platejs";

import { EditorKit } from "@/components/editor/editor-kit";
import { discussionPlugin } from "@/components/editor/plugins/discussion-kit";

import { FindReplaceKit } from "./plugins/find-replace-kit";
import { TemisToolbarKit } from "./plugins/temis-toolbar-kit";
import { VariavelInputKit } from "./plugins/variavel-input-kit";
import { VariavelKit } from "./plugins/variavel-kit";
import { REGRAS_MARKDOWN_VARIAVEL } from "./plugins/variavel-kit-base";

// O KIT DO EDITOR DA TÊMIS — o `EditorKit` inteiro do Plate UI (IA, comentários, sugestões, mídia,
// equações, colunas, callout, toggle, sumário, código, data, emoji, menção, link, listas, recuo,
// alinhamento, fontes, autoformat, slash, menu de bloco, seleção de bloco, arrastar, docx e
// markdown, exportar, barras fixa e flutuante, histórico) mais o que é nosso.
//
// Pedido do Lucas (02/09/2026): *"não temos todas essas ferramentas, revise as documentações pois
// quero isso completo, estamos muito simples"*.
//
// O QUE É NOSSO, na ordem em que entra (a ordem importa — ver cada nota):
// - a regra de markdown da variável, aplicada por `.extend()` nas ocorrências do `MarkdownPlugin`
//   (há duas no EditorKit: via AIKit e via Parsers; o Plate fica com a última, então as duas são
//   estendidas). `.configure()` substituiria os `remarkPlugins` do kit — medido em 02/09/2026;
// - as discussões com usuário real, sem os mocks "alice/bob/charlie" do registro. O id de verdade
//   entra em tempo de execução (`editor.setOption`, no editor), aqui vai um provisório para o
//   `currentUser` nunca ser `undefined` antes da sessão carregar;
// - a barra fixa da Têmis no lugar da do registro (mesma chave);
// - a variável (chip), o combobox do `[` (depois do Autoformat, para interceptar o `[` antes dele)
//   e buscar/substituir.
//
// ⚠️ COMENTÁRIOS E SUGESTÕES VIVEM SÓ NA SESSÃO. Não há tabela `temis_*` para discussões: fechar a
// aba apaga o que foi comentado. O que persiste são as MARCAS de sugestão dentro do `conteudo`
// (é o que `temSugestoesPendentes` acusa na tela).

export const USUARIO_PROVISORIO = { avatarUrl: "", id: "eu", name: "Você" };

export const EditorKitTemis = [
  ...EditorKit.filter((plugin) => plugin.key !== "fixed-toolbar").map((plugin) => {
    if (plugin.key === KEYS.markdown) {
      return (plugin as unknown as typeof MarkdownPlugin).extend({
        options: { rules: REGRAS_MARKDOWN_VARIAVEL },
      });
    }
    if (plugin.key === discussionPlugin.key) {
      return (plugin as unknown as typeof discussionPlugin).extend({
        options: {
          currentUserId: USUARIO_PROVISORIO.id,
          discussions: [],
          users: { [USUARIO_PROVISORIO.id]: USUARIO_PROVISORIO },
        },
      });
    }
    return plugin;
  }),
  ...VariavelKit,
  ...VariavelInputKit,
  ...FindReplaceKit,
  ...TemisToolbarKit,
];
