import type { MarkdownPlugin } from "@platejs/markdown";
import { KEYS } from "platejs";

import { BaseEditorKit } from "@/components/editor/editor-base-kit";

import { BaseVariavelPlugin, REGRAS_MARKDOWN_VARIAVEL } from "./plugins/variavel-kit-base";
import { VariavelElementStatic } from "./plugins/variavel-node-static";

// O KIT BASE DA TÊMIS — o `BaseEditorKit` do Plate mais a variável. Sem `platejs/react`.
//
// Quem usa: a rota `/api/ai/command` (`createSlateEditor` no servidor, Frente D), o round-trip
// (`lib/temis/round-trip.test.ts`, Frente C) e a exportação estática. É a lista ÚNICA de plugins
// base: se o editor React ganhar um plugin com nó novo, ele entra no `BaseEditorKit` do registro e
// chega aqui sozinho.
//
// ⚠️ `.extend()`, E NUNCA `.configure()`, para acrescentar a regra de markdown: medido em
// 02/09/2026, `configure` guarda UMA configuração e a última substitui a anterior — chamar
// `MarkdownPlugin.configure({ rules })` de novo apagaria os `remarkPlugins` e o `plainMarks` que o
// kit já definiu. `extend` mescla. E o mapeamento é por chave em TODAS as ocorrências porque o
// kit pode trazer o mesmo plugin mais de uma vez (o `EditorKit` React traz o markdown via AIKit e
// via Parsers); quando há chave repetida, o Plate fica com a última — que precisa ser a estendida.
export const BaseEditorKitTemis = [
  ...BaseEditorKit.map((plugin) =>
    plugin.key === KEYS.markdown
      ? (plugin as unknown as typeof MarkdownPlugin).extend({
          options: { rules: REGRAS_MARKDOWN_VARIAVEL },
        })
      : plugin,
  ),
  BaseVariavelPlugin.withComponent(VariavelElementStatic),
];
