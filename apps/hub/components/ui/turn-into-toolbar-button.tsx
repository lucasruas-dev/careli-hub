'use client';

import * as React from 'react';

import type { DropdownMenuProps } from '@radix-ui/react-dropdown-menu';
import type { TElement } from 'platejs';

import { DropdownMenuItemIndicator } from '@radix-ui/react-dropdown-menu';
import {
  CheckIcon,
  ChevronRightIcon,
  Code2,
  Columns3Icon,
  FileCodeIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  Heading4Icon,
  Heading5Icon,
  Heading6Icon,
  ListIcon,
  ListOrderedIcon,
  PilcrowIcon,
  QuoteIcon,
  SquareIcon,
} from 'lucide-react';
import { KEYS } from 'platejs';
import { useEditorRef, useSelectionFragmentProp } from 'platejs/react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  getBlockType,
  setBlockType,
} from '@/components/editor/transforms';

import { ToolbarButton, ToolbarMenuGroup } from './toolbar';

export const turnIntoItems = [
  {
    icon: <PilcrowIcon />,
    keywords: ['paragrafo'],
    label: 'Texto',
    value: KEYS.p,
  },
  {
    icon: <Heading1Icon />,
    keywords: ['titulo', 'h1'],
    label: 'Título 1',
    value: 'h1',
  },
  {
    icon: <Heading2Icon />,
    keywords: ['subtitulo', 'h2'],
    label: 'Título 2',
    value: 'h2',
  },
  {
    icon: <Heading3Icon />,
    keywords: ['subtitulo', 'h3'],
    label: 'Título 3',
    value: 'h3',
  },
  {
    icon: <Heading4Icon />,
    keywords: ['subtitulo', 'h4'],
    label: 'Título 4',
    value: 'h4',
  },
  {
    icon: <Heading5Icon />,
    keywords: ['subtitulo', 'h5'],
    label: 'Título 5',
    value: 'h5',
  },
  {
    icon: <Heading6Icon />,
    keywords: ['subtitulo', 'h6'],
    label: 'Título 6',
    value: 'h6',
  },
  {
    icon: <ListIcon />,
    keywords: ['nao ordenada', 'ul', '-'],
    label: 'Lista com marcadores',
    value: KEYS.ul,
  },
  {
    icon: <ListOrderedIcon />,
    keywords: ['ordenada', 'ol', '1'],
    label: 'Lista numerada',
    value: KEYS.ol,
  },
  {
    icon: <SquareIcon />,
    keywords: ['checklist', 'tarefa', 'caixa de selecao', '[]'],
    label: 'Lista de tarefas',
    value: KEYS.listTodo,
  },
  {
    icon: <ChevronRightIcon />,
    keywords: ['recolhivel', 'expansivel'],
    label: 'Lista alternável',
    value: KEYS.toggle,
  },
  {
    icon: <FileCodeIcon />,
    keywords: ['```'],
    label: 'Código',
    value: KEYS.codeBlock,
  },
  {
    icon: <Code2 />,
    keywords: [
      'code-drawing',
      'diagrama',
      'plantuml',
      'graphviz',
      'fluxograma',
      'mermaid',
    ],
    label: 'Desenho de código',
    value: KEYS.codeDrawing,
  },
  {
    icon: <QuoteIcon />,
    keywords: ['citacao', 'blockquote', '>'],
    label: 'Citação',
    value: KEYS.blockquote,
  },
  {
    icon: <Columns3Icon />,
    label: '3 colunas',
    value: 'action_three_columns',
  },
];

export function TurnIntoToolbarButton(props: DropdownMenuProps) {
  const editor = useEditorRef();
  const [open, setOpen] = React.useState(false);

  const value = useSelectionFragmentProp({
    defaultValue: KEYS.p,
    getProp: (node) => getBlockType(node as TElement),
  });
  const selectedItem = React.useMemo(
    () =>
      turnIntoItems.find((item) => item.value === (value ?? KEYS.p)) ??
      turnIntoItems[0],
    [value]
  );

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false} {...props}>
      <DropdownMenuTrigger asChild>
        <ToolbarButton
          className="min-w-[125px]"
          pressed={open}
          tooltip="Transformar em"
          isDropdown
        >
          {selectedItem?.label /* noUncheckedIndexedAccess: turnIntoItems[0] pode ser undefined */}
        </ToolbarButton>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        className="ignore-click-outside/toolbar min-w-0"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          editor.tf.focus();
        }}
        align="start"
      >
        <ToolbarMenuGroup
          value={value}
          onValueChange={(type) => {
            setBlockType(editor, type);
          }}
          label="Transformar em"
        >
          {turnIntoItems.map(({ icon, label, value: itemValue }) => (
            <DropdownMenuRadioItem
              key={itemValue}
              className="min-w-[180px] pl-2 *:first:[span]:hidden"
              value={itemValue}
            >
              <span className="pointer-events-none absolute right-2 flex size-3.5 items-center justify-center">
                <DropdownMenuItemIndicator>
                  <CheckIcon />
                </DropdownMenuItemIndicator>
              </span>
              {icon}
              {label}
            </DropdownMenuRadioItem>
          ))}
        </ToolbarMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
