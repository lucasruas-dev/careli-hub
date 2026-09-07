'use client';

import * as React from 'react';

import type { PlateEditor, PlateElementProps } from 'platejs/react';

import { AIChatPlugin } from '@platejs/ai/react';
import {
  CalendarIcon,
  ChevronRightIcon,
  Code2,
  Columns3Icon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  LightbulbIcon,
  ListIcon,
  ListOrdered,
  PilcrowIcon,
  Quote,
  RadicalIcon,
  SparklesIcon,
  Square,
  SuperscriptIcon,
  Table,
  TableOfContentsIcon,
} from 'lucide-react';
import { type TComboboxInputElement, KEYS } from 'platejs';
import { PlateElement } from 'platejs/react';

import {
  insertBlock,
  insertInlineElement,
} from '@/components/editor/transforms';

import {
  InlineCombobox,
  InlineComboboxContent,
  InlineComboboxEmpty,
  InlineComboboxGroup,
  InlineComboboxGroupLabel,
  InlineComboboxInput,
  InlineComboboxItem,
} from './inline-combobox';

type Group = {
  group: string;
  items: {
    icon: React.ReactNode;
    value: string;
    onSelect: (editor: PlateEditor, value: string) => void;
    className?: string;
    focusEditor?: boolean;
    keywords?: string[];
    label?: string;
  }[];
};

const groups: Group[] = [
  {
    group: 'IA',
    items: [
      {
        focusEditor: false,
        icon: <SparklesIcon />,
        label: 'IA',
        value: 'AI',
        onSelect: (editor) => {
          editor.getApi(AIChatPlugin).aiChat.show();
        },
      },
    ],
  },
  {
    group: 'Blocos básicos',
    items: [
      {
        icon: <PilcrowIcon />,
        keywords: ['paragrafo', 'parágrafo'],
        label: 'Texto',
        value: KEYS.p,
      },
      {
        icon: <Heading1Icon />,
        keywords: ['titulo', 'título', 'h1'],
        label: 'Título 1',
        value: KEYS.h1,
      },
      {
        icon: <Heading2Icon />,
        keywords: ['subtitulo', 'subtítulo', 'h2'],
        label: 'Título 2',
        value: KEYS.h2,
      },
      {
        icon: <Heading3Icon />,
        keywords: ['subtitulo', 'subtítulo', 'h3'],
        label: 'Título 3',
        value: KEYS.h3,
      },
      {
        icon: <ListIcon />,
        keywords: ['lista', 'marcadores', 'ul', '-'],
        label: 'Lista com marcadores',
        value: KEYS.ul,
      },
      {
        icon: <ListOrdered />,
        keywords: ['lista', 'numerada', 'ol', '1'],
        label: 'Lista numerada',
        value: KEYS.ol,
      },
      {
        icon: <Square />,
        keywords: ['tarefas', 'checklist', 'caixa de selecao', '[]'],
        label: 'Lista de tarefas',
        value: KEYS.listTodo,
      },
      {
        icon: <ChevronRightIcon />,
        keywords: ['recolhivel', 'expansivel'],
        label: 'Alternar',
        value: KEYS.toggle,
      },
      {
        icon: <Code2 />,
        keywords: ['```'],
        label: 'Bloco de código',
        value: KEYS.codeBlock,
      },
      {
        icon: <Table />,
        label: 'Tabela',
        value: KEYS.table,
      },
      {
        icon: <Quote />,
        keywords: ['citacao', 'citação', 'bloco de citacao', '>'],
        label: 'Citação',
        value: KEYS.blockquote,
      },
      {
        description: 'Inserir um bloco destacado.',
        icon: <LightbulbIcon />,
        keywords: ['nota'],
        label: 'Destaque',
        value: KEYS.callout,
      },
    ].map((item) => ({
      ...item,
      onSelect: (editor, value) => {
        insertBlock(editor, value, { upsert: true });
      },
    })),
  },
  {
    group: 'Blocos avançados',
    items: [
      {
        icon: <TableOfContentsIcon />,
        keywords: ['sumario', 'sumário', 'indice', 'índice', 'toc'],
        label: 'Sumário',
        value: KEYS.toc,
      },
      {
        icon: <Columns3Icon />,
        label: '3 colunas',
        value: 'action_three_columns',
      },
      {
        focusEditor: false,
        icon: <RadicalIcon />,
        label: 'Equação',
        value: KEYS.equation,
      },
      // Excalidraw removido: o kit não está instalado no editor da Têmis (ver editor-kit.tsx).
      {
        icon: <Code2 />,
        keywords: [
          'code-drawing',
          'diagram',
          'plantuml',
          'graphviz',
          'flowchart',
          'mermaid',
        ],
        label: 'Diagrama de código',
        value: KEYS.codeDrawing,
      },
    ].map((item) => ({
      ...item,
      onSelect: (editor, value) => {
        insertBlock(editor, value, { upsert: true });
      },
    })),
  },
  {
    group: 'Em linha',
    items: [
      {
        focusEditor: true,
        icon: <CalendarIcon />,
        keywords: ['data', 'hora'],
        label: 'Data',
        value: KEYS.date,
      },
      {
        focusEditor: true,
        icon: <SuperscriptIcon />,
        keywords: ['nota', 'rodape', 'rodapé', 'fn', '[^]'],
        label: 'Nota de rodapé',
        value: 'action_footnote',
      },
      {
        focusEditor: false,
        icon: <RadicalIcon />,
        label: 'Equação em linha',
        value: KEYS.inlineEquation,
      },
    ].map((item) => ({
      ...item,
      onSelect: (editor, value) => {
        insertInlineElement(editor, value);
      },
    })),
  },
];

export function SlashInputElement(
  props: PlateElementProps<TComboboxInputElement>
) {
  const { editor, element } = props;

  return (
    <PlateElement {...props} as="span">
      <InlineCombobox element={element} trigger="/">
        <InlineComboboxInput />

        <InlineComboboxContent>
          <InlineComboboxEmpty>Nada encontrado</InlineComboboxEmpty>

          {groups.map(({ group, items }) => (
            <InlineComboboxGroup key={group}>
              <InlineComboboxGroupLabel>{group}</InlineComboboxGroupLabel>

              {items.map(
                ({ focusEditor, icon, keywords, label, value, onSelect }) => (
                  <InlineComboboxItem
                    key={value}
                    value={value}
                    onClick={() => onSelect(editor, value)}
                    label={label}
                    focusEditor={focusEditor}
                    group={group}
                    keywords={keywords}
                  >
                    <div className="mr-2 text-muted-foreground">{icon}</div>
                    {label ?? value}
                  </InlineComboboxItem>
                )
              )}
            </InlineComboboxGroup>
          ))}
        </InlineComboboxContent>
      </InlineCombobox>

      {props.children}
    </PlateElement>
  );
}
