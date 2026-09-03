'use client';

/**
 * Kit completo do editor (Plate UI) usado pela Têmis.
 *
 * Escrito à mão a partir do item `editor-kit` do registro do Plate (02/09/2026), com o MESMO
 * array e na MESMA ordem, menos dois itens decididos no plano:
 *  - sem `ExcalidrawKit`: bundle de vários MB para desenho livre, que não cabe em minuta
 *    (diagrama por código já vem no `CodeDrawingKit`);
 *  - sem `CopilotKit`: ghost-text a cada pausa de digitação = uma chamada de modelo por frase.
 *
 * Pedido do Lucas: "não temos todas essas ferramentas, revise as documentações pois quero isso
 * completo, estamos muito simples".
 *
 * ⚠️ Este arquivo NÃO veio do CLI: `npx shadcn add @plate/editor-kit` traria o excalidraw de volta.
 * ⚠️ NÃO rodar o CLI com `--overwrite` nesta pasta: os arquivos gerados em components/ui e
 *    components/editor levam correções marcadas com `// noUncheckedIndexedAccess:` que se perderiam.
 * ⚠️ `IndentKit` já vem dentro de `ListKit` (list-kit.tsx faz `...IndentKit`); não repetir aqui.
 *
 * A Têmis não usa este array diretamente: `modules/temis/editor-kit-temis.tsx` (Frente B) parte
 * dele, troca a barra fixa pela barra da Têmis e acrescenta o plugin de variáveis.
 */

import { type Value, TrailingBlockPlugin } from 'platejs';
import { type TPlateEditor, useEditorRef } from 'platejs/react';

import { AIKit } from './plugins/ai-kit';
import { AlignKit } from './plugins/align-kit';
import { AutoformatKit } from './plugins/autoformat-kit';
import { BasicBlocksKit } from './plugins/basic-blocks-kit';
import { BasicMarksKit } from './plugins/basic-marks-kit';
import { BlockMenuKit } from './plugins/block-menu-kit';
import { BlockPlaceholderKit } from './plugins/block-placeholder-kit';
import { CalloutKit } from './plugins/callout-kit';
import { CodeBlockKit } from './plugins/code-block-kit';
import { CodeDrawingKit } from './plugins/code-drawing-kit';
import { ColumnKit } from './plugins/column-kit';
import { CommentKit } from './plugins/comment-kit';
import { CursorOverlayKit } from './plugins/cursor-overlay-kit';
import { DateKit } from './plugins/date-kit';
import { DiscussionKit } from './plugins/discussion-kit';
import { DndKit } from './plugins/dnd-kit';
import { DocxKit } from './plugins/docx-kit';
import { EmojiKit } from './plugins/emoji-kit';
import { ExitBreakKit } from './plugins/exit-break-kit';
import { FixedToolbarKit } from './plugins/fixed-toolbar-kit';
import { FloatingToolbarKit } from './plugins/floating-toolbar-kit';
import { FootnoteKit } from './plugins/footnote-kit';
import { FontKit } from './plugins/font-kit';
import { LineHeightKit } from './plugins/line-height-kit';
import { LinkKit } from './plugins/link-kit';
import { ListKit } from './plugins/list-kit';
import { MarkdownKit } from './plugins/markdown-kit';
import { MathKit } from './plugins/math-kit';
import { MediaKit } from './plugins/media-kit';
import { MentionKit } from './plugins/mention-kit';
import { SlashKit } from './plugins/slash-kit';
import { SuggestionKit } from './plugins/suggestion-kit';
import { TableKit } from './plugins/table-kit';
import { TocKit } from './plugins/toc-kit';
import { ToggleKit } from './plugins/toggle-kit';

export const EditorKit = [
  ...AIKit,
  ...BlockMenuKit,

  // Elements
  ...BasicBlocksKit,
  ...CodeBlockKit,
  ...CodeDrawingKit,
  ...TableKit,
  ...ToggleKit,
  ...TocKit,
  ...MediaKit,
  ...CalloutKit,
  ...ColumnKit,
  ...MathKit,
  ...DateKit,
  ...LinkKit,
  ...MentionKit,

  // Marks
  ...BasicMarksKit,
  ...FontKit,

  // Block Style
  ...ListKit,
  ...AlignKit,
  ...LineHeightKit,

  // Collaboration
  ...DiscussionKit,
  ...CommentKit,
  ...SuggestionKit,

  // Editing
  ...SlashKit,
  ...AutoformatKit,
  ...CursorOverlayKit,
  ...DndKit,
  ...EmojiKit,
  ...ExitBreakKit,
  TrailingBlockPlugin,

  // Parsers
  ...DocxKit,
  ...MarkdownKit,
  ...FootnoteKit,

  // UI
  ...BlockPlaceholderKit,
  ...FixedToolbarKit,
  ...FloatingToolbarKit,
];

export type MyEditor = TPlateEditor<Value, (typeof EditorKit)[number]>;

export const useEditor = () => useEditorRef<MyEditor>();
