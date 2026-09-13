'use client';

import * as React from 'react';

import { useDraggable, useDropLine } from '@platejs/dnd';
import {
  BlockSelectionPlugin,
  useBlockSelected,
} from '@platejs/selection/react';
import { resizeLengthClampStatic } from '@platejs/resizable';
import {
  getCellTypes,
  getSelectedCellEntries,
  getTableColumnCount,
  setCellBackground,
  setTableColSize,
  setTableMarginLeft,
  setTableRowSize,
} from '@platejs/table';
import {
  TablePlugin,
  TableProvider,
  roundCellSizeToStep,
  useCellIndices,
  useOverrideColSize,
  useOverrideMarginLeft,
  useOverrideRowSize,
  useTableCellBorders,
  useTableBordersDropdownMenuContentState,
  useTableColSizes,
  useTableElement,
  useTableMergeState,
  useTableSelectionDom,
  useTableValue,
} from '@platejs/table/react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CombineIcon,
  EraserIcon,
  Grid2X2Icon,
  GripVertical,
  PaintBucketIcon,
  SquareSplitHorizontalIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import {
  type TElement,
  type TTableCellElement,
  type TTableElement,
  type TTableRowElement,
  ElementApi,
  KEYS,
  PathApi,
} from 'platejs';
import {
  type PlateElementProps,
  PlateElement,
  useComposedRef,
  useEditorPlugin,
  useEditorRef,
  useEditorSelector,
  useElement,
  useFocusedLast,
  usePluginOption,
  useReadOnly,
  useRemoveNodeButton,
  useSelected,
  withHOC,
} from 'platejs/react';
import { useElementSelector } from 'platejs/react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

import { blockSelectionVariants } from './block-selection';
import {
  ColorDropdownMenuItems,
  DEFAULT_COLORS,
} from './font-color-toolbar-button';
import {
  BorderAllIcon,
  BorderBottomIcon,
  BorderLeftIcon,
  BorderNoneIcon,
  BorderRightIcon,
  BorderTopIcon,
} from './table-icons';
import {
  Toolbar,
  ToolbarButton,
  ToolbarGroup,
  ToolbarMenuGroup,
} from './toolbar';

type TableResizeDirection = 'bottom' | 'left' | 'right';

type TableResizeStartOptions = {
  colIndex: number;
  direction: TableResizeDirection;
  handleKey: string;
  rowIndex: number;
};

type TableResizeDragState = {
  colIndex: number;
  direction: TableResizeDirection;
  initialPosition: number;
  initialSize: number;
  marginLeft: number;
  rowIndex: number;
};

type TableResizeContextValue = {
  disableMarginLeft: boolean;
  clearResizePreview: (handleKey: string) => void;
  setResizePreview: (
    event: React.PointerEvent<HTMLDivElement>,
    options: TableResizeStartOptions
  ) => void;
  startResize: (
    event: React.PointerEvent<HTMLDivElement>,
    options: TableResizeStartOptions
  ) => void;
};

const TABLE_CONTROL_COLUMN_WIDTH = 8;
const TABLE_DEFAULT_COLUMN_WIDTH = 120;
const TABLE_DEFERRED_COLUMN_RESIZE_CELL_COUNT = 1200;
const TABLE_MULTI_SELECTION_TOOLBAR_DELAY_MS = 150;

const TableResizeContext = React.createContext<TableResizeContextValue | null>(
  null
);

function useTableResizeContext() {
  const context = React.useContext(TableResizeContext);

  if (!context) {
    throw new Error('TableResizeContext is missing');
  }

  return context;
}

function useTableResizeController({
  deferColumnResize,
  dragIndicatorRef,
  hoverIndicatorRef,
  marginLeft,
  controlColumnWidth,
  tablePath,
  tableRef,
  wrapperRef,
}: {
  deferColumnResize: boolean;
  dragIndicatorRef: React.RefObject<HTMLDivElement | null>;
  hoverIndicatorRef: React.RefObject<HTMLDivElement | null>;
  marginLeft: number;
  controlColumnWidth: number;
  tablePath: number[];
  tableRef: React.RefObject<HTMLTableElement | null>;
  wrapperRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { editor, getOptions } = useEditorPlugin(TablePlugin);
  const { disableMarginLeft = false, minColumnWidth = 0 } = getOptions();
  const colSizes = useTableColSizes({
    disableOverrides: true,
  });
  const effectiveColSizes = React.useMemo(
    () => colSizes.map((colSize) => colSize || TABLE_DEFAULT_COLUMN_WIDTH),
    [colSizes]
  );
  const effectiveColSizesRef = React.useRef(effectiveColSizes);
  const activeHandleKeyRef = React.useRef<string | null>(null);
  const activeRowElementRef = React.useRef<HTMLTableRowElement | null>(null);
  const cleanupListenersRef = React.useRef<(() => void) | null>(null);
  const marginLeftRef = React.useRef(marginLeft);
  const dragStateRef = React.useRef<TableResizeDragState | null>(null);
  const frozenRowIndicesRef = React.useRef<number[] | null>(null);
  const previewHandleKeyRef = React.useRef<string | null>(null);
  const overrideColSize = useOverrideColSize();
  const overrideMarginLeft = useOverrideMarginLeft();
  const overrideRowSize = useOverrideRowSize();

  React.useEffect(() => {
    effectiveColSizesRef.current = effectiveColSizes;
  }, [effectiveColSizes]);

  React.useEffect(() => {
    marginLeftRef.current = marginLeft;
  }, [marginLeft]);

  const hideDeferredResizeIndicator = React.useCallback(() => {
    const indicator = dragIndicatorRef.current;

    if (!indicator) return;

    indicator.style.display = 'none';
    indicator.style.removeProperty('left');
  }, [dragIndicatorRef]);

  const showDeferredResizeIndicator = React.useCallback(
    (offset: number) => {
      const indicator = dragIndicatorRef.current;

      if (!indicator) return;

      indicator.style.display = 'block';
      indicator.style.left = `${offset}px`;
    },
    [dragIndicatorRef]
  );

  const hideResizeIndicator = React.useCallback(() => {
    const indicator = hoverIndicatorRef.current;

    if (!indicator) return;

    indicator.style.display = 'none';
    indicator.style.removeProperty('left');
  }, [hoverIndicatorRef]);

  const clearFrozenRowHeights = React.useCallback(() => {
    const frozenRowIndices = frozenRowIndicesRef.current;

    if (!frozenRowIndices) return;

    frozenRowIndicesRef.current = null;

    frozenRowIndices.forEach((rowIndex) => {
      overrideRowSize(rowIndex, null);
    });
  }, [overrideRowSize]);

  const freezeRowHeights = React.useCallback(() => {
    const table = tableRef.current;

    if (!table || deferColumnResize) return;

    clearFrozenRowHeights();

    const frozenRowIndices: number[] = [];

    Array.from(table.rows).forEach((row, rowIndex) => {
      const height = row.getBoundingClientRect().height;

      if (!height) return;

      overrideRowSize(rowIndex, height);
      frozenRowIndices.push(rowIndex);
    });

    frozenRowIndicesRef.current = frozenRowIndices;
  }, [clearFrozenRowHeights, deferColumnResize, overrideRowSize, tableRef]);

  const showResizeIndicatorAtOffset = React.useCallback(
    (offset: number) => {
      const indicator = hoverIndicatorRef.current;

      if (!indicator) return;

      indicator.style.display = 'block';
      indicator.style.left = `${offset}px`;
    },
    [hoverIndicatorRef]
  );

  const showResizeIndicator = React.useCallback(
    ({
      event,
      direction,
    }: Pick<TableResizeStartOptions, 'direction'> & {
      event: React.PointerEvent<HTMLDivElement>;
    }) => {
      if (direction === 'bottom') return;

      const wrapper = wrapperRef.current;

      if (!wrapper) return;

      const handleRect = event.currentTarget.getBoundingClientRect();
      const wrapperRect = wrapper.getBoundingClientRect();
      const boundaryOffset =
        handleRect.left - wrapperRect.left + handleRect.width / 2;

      showResizeIndicatorAtOffset(boundaryOffset);
    },
    [showResizeIndicatorAtOffset, wrapperRef]
  );

  const setResizePreview = React.useCallback(
    (
      event: React.PointerEvent<HTMLDivElement>,
      options: TableResizeStartOptions
    ) => {
      if (activeHandleKeyRef.current) return;

      previewHandleKeyRef.current = options.handleKey;
      showResizeIndicator({ ...options, event });
    },
    [showResizeIndicator]
  );

  const clearResizePreview = React.useCallback(
    (handleKey: string) => {
      if (activeHandleKeyRef.current) return;
      if (previewHandleKeyRef.current !== handleKey) return;

      previewHandleKeyRef.current = null;
      hideResizeIndicator();
    },
    [hideResizeIndicator]
  );

  const commitColSize = React.useCallback(
    (colIndex: number, width: number) => {
      setTableColSize(editor, { colIndex, width }, { at: tablePath });
      setTimeout(() => overrideColSize(colIndex, null), 0);
    },
    [editor, overrideColSize, tablePath]
  );

  const commitRowSize = React.useCallback(
    (rowIndex: number, height: number) => {
      setTableRowSize(editor, { height, rowIndex }, { at: tablePath });
      setTimeout(() => overrideRowSize(rowIndex, null), 0);
    },
    [editor, overrideRowSize, tablePath]
  );

  const commitMarginLeft = React.useCallback(
    (nextMarginLeft: number) => {
      setTableMarginLeft(
        editor,
        { marginLeft: nextMarginLeft },
        { at: tablePath }
      );
      setTimeout(() => overrideMarginLeft(null), 0);
    },
    [editor, overrideMarginLeft, tablePath]
  );

  const getColumnBoundaryOffset = React.useCallback(
    (colIndex: number, currentWidth: number) =>
      controlColumnWidth +
      effectiveColSizesRef.current
        .slice(0, colIndex)
        .reduce((total, colSize) => total + colSize, 0) +
      currentWidth,
    [controlColumnWidth]
  );

  const applyResize = React.useCallback(
    (event: PointerEvent, finished: boolean) => {
      const dragState = dragStateRef.current;

      if (!dragState) return;

      const currentPosition =
        dragState.direction === 'bottom' ? event.clientY : event.clientX;
      const delta = currentPosition - dragState.initialPosition;

      if (dragState.direction === 'bottom') {
        const newHeight = roundCellSizeToStep(
          dragState.initialSize + delta,
          undefined
        );

        if (finished) {
          commitRowSize(dragState.rowIndex, newHeight);
        } else {
          overrideRowSize(dragState.rowIndex, newHeight);
        }

        return;
      }

      if (dragState.direction === 'left') {
        const initial =
          effectiveColSizesRef.current[dragState.colIndex] ??
          dragState.initialSize;
        const complement = (width: number) =>
          initial + dragState.marginLeft - width;
        const nextMarginLeft = roundCellSizeToStep(
          resizeLengthClampStatic(dragState.marginLeft + delta, {
            max: complement(minColumnWidth),
            min: 0,
          }),
          undefined
        );
        const nextWidth = complement(nextMarginLeft);

        if (finished) {
          commitMarginLeft(nextMarginLeft);
          commitColSize(dragState.colIndex, nextWidth);
        } else if (deferColumnResize) {
          showDeferredResizeIndicator(
            controlColumnWidth + (nextMarginLeft - dragState.marginLeft)
          );
        } else {
          showResizeIndicatorAtOffset(
            controlColumnWidth + (nextMarginLeft - dragState.marginLeft)
          );
          overrideMarginLeft(nextMarginLeft);
          overrideColSize(dragState.colIndex, nextWidth);
        }

        return;
      }

      const currentInitial =
        effectiveColSizesRef.current[dragState.colIndex] ??
        dragState.initialSize;
      const nextInitial = effectiveColSizesRef.current[dragState.colIndex + 1];
      const complement = (width: number) =>
        currentInitial + (nextInitial ?? 0) - width; // noUncheckedIndexedAccess: complement só roda com nextInitial definido
      const currentWidth = roundCellSizeToStep(
        resizeLengthClampStatic(currentInitial + delta, {
          max: nextInitial ? complement(minColumnWidth) : undefined,
          min: minColumnWidth,
        }),
        undefined
      );
      const nextWidth = nextInitial ? complement(currentWidth) : undefined;

      if (finished) {
        commitColSize(dragState.colIndex, currentWidth);

        if (nextWidth !== undefined) {
          commitColSize(dragState.colIndex + 1, nextWidth);
        }
      } else if (deferColumnResize) {
        showDeferredResizeIndicator(
          getColumnBoundaryOffset(dragState.colIndex, currentWidth)
        );
      } else {
        showResizeIndicatorAtOffset(
          getColumnBoundaryOffset(dragState.colIndex, currentWidth)
        );
        overrideColSize(dragState.colIndex, currentWidth);

        if (nextWidth !== undefined) {
          overrideColSize(dragState.colIndex + 1, nextWidth);
        }
      }
    },
    [
      commitColSize,
      commitMarginLeft,
      commitRowSize,
      controlColumnWidth,
      deferColumnResize,
      getColumnBoundaryOffset,
      showDeferredResizeIndicator,
      showResizeIndicatorAtOffset,
      minColumnWidth,
      overrideColSize,
      overrideMarginLeft,
      overrideRowSize,
    ]
  );

  const stopResize = React.useCallback(() => {
    cleanupListenersRef.current?.();
    cleanupListenersRef.current = null;
    activeHandleKeyRef.current = null;
    previewHandleKeyRef.current = null;
    dragStateRef.current = null;

    if (activeRowElementRef.current) {
      delete activeRowElementRef.current.dataset.tableResizing;
      activeRowElementRef.current = null;
    }

    hideDeferredResizeIndicator();
    hideResizeIndicator();
    clearFrozenRowHeights();
  }, [clearFrozenRowHeights, hideDeferredResizeIndicator, hideResizeIndicator]);

  React.useEffect(() => stopResize, [stopResize]);

  const startResize = React.useCallback(
    (
      event: React.PointerEvent<HTMLDivElement>,
      { colIndex, direction, handleKey, rowIndex }: TableResizeStartOptions
    ) => {
      const rowHeight =
        tableRef.current?.rows.item(rowIndex)?.getBoundingClientRect().height ??
        0;

      dragStateRef.current = {
        colIndex,
        direction,
        initialPosition: direction === 'bottom' ? event.clientY : event.clientX,
        initialSize:
          direction === 'bottom'
            ? rowHeight
            : (effectiveColSizesRef.current[colIndex] ??
              TABLE_DEFAULT_COLUMN_WIDTH),
        marginLeft: marginLeftRef.current,
        rowIndex,
      };
      activeHandleKeyRef.current = handleKey;
      previewHandleKeyRef.current = null;

      const rowElement = tableRef.current?.rows.item(rowIndex) ?? null;

      if (
        activeRowElementRef.current &&
        activeRowElementRef.current !== rowElement
      ) {
        delete activeRowElementRef.current.dataset.tableResizing;
      }

      activeRowElementRef.current = rowElement;

      if (rowElement) {
        rowElement.dataset.tableResizing = 'true';
      }

      cleanupListenersRef.current?.();

      if (direction !== 'bottom') {
        freezeRowHeights();
      }

      const handlePointerMove = (pointerEvent: PointerEvent) => {
        applyResize(pointerEvent, false);
      };

      const handlePointerEnd = (pointerEvent: PointerEvent) => {
        applyResize(pointerEvent, true);
        stopResize();
      };

      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerEnd);
      window.addEventListener('pointercancel', handlePointerEnd);

      cleanupListenersRef.current = () => {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerEnd);
        window.removeEventListener('pointercancel', handlePointerEnd);
      };

      if (deferColumnResize && direction !== 'bottom') {
        hideResizeIndicator();
        showDeferredResizeIndicator(
          direction === 'left'
            ? controlColumnWidth
            : getColumnBoundaryOffset(
                colIndex,
                effectiveColSizesRef.current[colIndex] ??
                  TABLE_DEFAULT_COLUMN_WIDTH
              )
        );
      } else {
        showResizeIndicator({ direction, event });
      }

      event.preventDefault();
      event.stopPropagation();
    },
    [
      controlColumnWidth,
      deferColumnResize,
      getColumnBoundaryOffset,
      hideResizeIndicator,
      showDeferredResizeIndicator,
      showResizeIndicator,
      stopResize,
      tableRef,
      applyResize,
      freezeRowHeights,
    ]
  );

  return React.useMemo(
    () => ({
      clearResizePreview,
      disableMarginLeft,
      setResizePreview,
      startResize,
    }),
    [clearResizePreview, disableMarginLeft, setResizePreview, startResize]
  );
}

export const TableElement = withHOC(
  TableProvider,
  function TableElement({
    children,
    ...props
  }: PlateElementProps<TTableElement>) {
    const readOnly = useReadOnly();
    const isSelectionAreaVisible = usePluginOption(
      BlockSelectionPlugin,
      'isSelectionAreaVisible'
    );
    const hasControls = !readOnly && !isSelectionAreaVisible;
    const { marginLeft, props: tableProps } = useTableElement();
    const colSizes = useTableColSizes();
    const controlColumnWidth = hasControls ? TABLE_CONTROL_COLUMN_WIDTH : 0;
    const dragIndicatorRef = React.useRef<HTMLDivElement>(null);
    const hoverIndicatorRef = React.useRef<HTMLDivElement>(null);
    const deferColumnResize =
      colSizes.length * props.element.children.length >
      TABLE_DEFERRED_COLUMN_RESIZE_CELL_COUNT;
    const tablePath = useElementSelector(([, path]) => path, [], {
      key: KEYS.table,
    });
    const tableRef = React.useRef<HTMLTableElement>(null);
    const wrapperRef = React.useRef<HTMLDivElement>(null);
    useTableSelectionDom(tableRef);
    const resizeController = useTableResizeController({
      controlColumnWidth,
      deferColumnResize,
      dragIndicatorRef,
      hoverIndicatorRef,
      marginLeft,
      tablePath,
      tableRef,
      wrapperRef,
    });
    const resolvedColSizes = React.useMemo(() => {
      if (colSizes.length > 0) {
        return colSizes.map((colSize) => colSize || TABLE_DEFAULT_COLUMN_WIDTH);
      }

      return Array.from(
        { length: getTableColumnCount(props.element) },
        () => TABLE_DEFAULT_COLUMN_WIDTH
      );
    }, [colSizes, props.element]);
    const tableVariableStyle = React.useMemo(() => {
      if (resolvedColSizes.length === 0) {
        return;
      }

      return {
        ...Object.fromEntries(
          resolvedColSizes.map((colSize, index) => [
            `--table-col-${index}`,
            `${colSize}px`,
          ])
        ),
      } as React.CSSProperties;
    }, [resolvedColSizes]);
    const tableStyle = React.useMemo(
      () =>
        ({
          width: `${
            resolvedColSizes.reduce((total, colSize) => total + colSize, 0) +
            controlColumnWidth
          }px`,
        }) as React.CSSProperties,
      [controlColumnWidth, resolvedColSizes]
    );

    const isSelectingTable = useBlockSelected(props.element.id as string);

    const content = (
      <PlateElement
        {...props}
        className={cn(
          'overflow-x-auto py-5',
          hasControls && '-ml-2 *:data-[slot=block-selection]:left-2'
        )}
        style={{ paddingLeft: marginLeft }}
      >
        <TableResizeContext.Provider value={resizeController}>
          <div
            ref={wrapperRef}
            className="group/table relative w-fit"
            style={tableVariableStyle}
          >
            <div
              ref={dragIndicatorRef}
              className="-translate-x-[1.5px] pointer-events-none absolute inset-y-0 z-36 hidden w-[3px] bg-ring/70"
              contentEditable={false}
            />
            <div
              ref={hoverIndicatorRef}
              className="-translate-x-[1.5px] pointer-events-none absolute inset-y-0 z-35 hidden w-[3px] bg-ring/80"
              contentEditable={false}
            />
            <table
              ref={tableRef}
              className={cn(
                'mr-0 ml-px table h-px table-fixed border-collapse',
                'data-[table-selecting=true]:[&_*::selection]:!bg-transparent',
                'data-[table-selecting=true]:[&_*::selection]:!text-inherit',
                'data-[table-selecting=true]:[&_*::-moz-selection]:!bg-transparent',
                'data-[table-selecting=true]:[&_*::-moz-selection]:!text-inherit',
                'data-[table-selecting=true]:[&_*]:!caret-transparent'
              )}
              style={tableStyle}
              {...tableProps}
            >
              {resolvedColSizes.length > 0 && (
                <colgroup>
                  {hasControls && (
                    <col
                      style={{
                        maxWidth: TABLE_CONTROL_COLUMN_WIDTH,
                        minWidth: TABLE_CONTROL_COLUMN_WIDTH,
                        width: TABLE_CONTROL_COLUMN_WIDTH,
                      }}
                    />
                  )}
                  {resolvedColSizes.map((colSize, index) => (
                    <col
                      key={index}
                      style={{
                        maxWidth: colSize,
                        minWidth: colSize,
                        width: colSize,
                      }}
                    />
                  ))}
                </colgroup>
              )}
              <tbody className="min-w-full">{children}</tbody>
            </table>

            {isSelectingTable && (
              <div
                className={blockSelectionVariants()}
                contentEditable={false}
              />
            )}
          </div>
        </TableResizeContext.Provider>
      </PlateElement>
    );

    if (readOnly) {
      return content;
    }

    return <TableFloatingToolbar>{content}</TableFloatingToolbar>;
  }
);

function TableFloatingToolbar({
  children,
  ...props
}: React.ComponentProps<typeof PopoverContent>) {
  const selectedCellCount = useEditorSelector(
    (editor) =>
      editor.getApi(TablePlugin).table.getSelectedCellIds()?.length ?? 0,
    []
  );
  const selected = useSelected();
  const isFocusedLast = useFocusedLast();
  const [isExpandedSelectionToolbarReady, setIsExpandedSelectionToolbarReady] =
    React.useState(false);
  // `getSelectedCellIds` only reports cells once a range spans more than one
  // cell, so a count of zero means the selection (a caret or an expanded
  // range) is confined to a single cell. Gating on it instead of
  // `editor.api.isCollapsed()` keeps the row/column controls available while a
  // cell's content is fully selected (e.g. select-all inside a cell), not just
  // while the caret is collapsed in it.
  const isSingleCellToolbarOpen =
    isFocusedLast && selected && selectedCellCount === 0;
  const isExpandedSelectionPending = isFocusedLast && selectedCellCount > 1;

  React.useEffect(() => {
    if (!isExpandedSelectionPending) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Reset the delayed toolbar gate when selection is no longer expanded.
      setIsExpandedSelectionToolbarReady(false);

      return;
    }

    const timeoutId = window.setTimeout(() => {
      setIsExpandedSelectionToolbarReady(true);
    }, TABLE_MULTI_SELECTION_TOOLBAR_DELAY_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isExpandedSelectionPending]);

  const shouldRenderExpandedSelectionToolbar =
    isExpandedSelectionToolbarReady && isExpandedSelectionPending;
  const isToolbarOpen =
    isSingleCellToolbarOpen || shouldRenderExpandedSelectionToolbar;

  return (
    <Popover open={isToolbarOpen} modal={false}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      {isSingleCellToolbarOpen && (
        <SingleCellTableFloatingToolbarContent {...props} />
      )}
      {shouldRenderExpandedSelectionToolbar && (
        <ExpandedSelectionTableFloatingToolbarContent {...props} />
      )}
    </Popover>
  );
}

function ExpandedSelectionTableFloatingToolbarContent(
  props: React.ComponentProps<typeof PopoverContent>
) {
  const { tf } = useEditorPlugin(TablePlugin);
  const { canMerge, canSplit } = useTableMergeState();

  if (!canMerge && !canSplit) return null;

  return (
    <TableFloatingToolbarContent
      canMerge={canMerge}
      canSplit={canSplit}
      onMerge={() => tf.table.merge()}
      onSplit={() => tf.table.split()}
      {...props}
    />
  );
}

function SingleCellTableFloatingToolbarContent(
  props: React.ComponentProps<typeof PopoverContent>
) {
  const { tf } = useEditorPlugin(TablePlugin);
  const element = useElement<TTableElement>();
  const { props: buttonProps } = useRemoveNodeButton({ element });
  const { canSplit } = useTableMergeState();

  return (
    <TableFloatingToolbarContent
      buttonProps={buttonProps}
      canSplit={canSplit}
      singleCellMode
      onDeleteColumn={() => {
        tf.remove.tableColumn();
      }}
      onDeleteRow={() => {
        tf.remove.tableRow();
      }}
      onInsertColumnAfter={() => {
        tf.insert.tableColumn();
      }}
      onInsertColumnBefore={() => {
        tf.insert.tableColumn({ before: true });
      }}
      onInsertRowAfter={() => {
        tf.insert.tableRow();
      }}
      onInsertRowBefore={() => {
        tf.insert.tableRow({ before: true });
      }}
      onSplit={() => tf.table.split()}
      {...props}
    />
  );
}

function TableFloatingToolbarContent({
  buttonProps,
  canMerge = false,
  canSplit = false,
  singleCellMode = false,
  onDeleteColumn,
  onDeleteRow,
  onInsertColumnAfter,
  onInsertColumnBefore,
  onInsertRowAfter,
  onInsertRowBefore,
  onMerge,
  onSplit,
  ...props
}: React.ComponentProps<typeof PopoverContent> & {
  buttonProps?: React.ComponentProps<typeof ToolbarButton>;
  canMerge?: boolean;
  canSplit?: boolean;
  singleCellMode?: boolean;
  onDeleteColumn?: () => void;
  onDeleteRow?: () => void;
  onInsertColumnAfter?: () => void;
  onInsertColumnBefore?: () => void;
  onInsertRowAfter?: () => void;
  onInsertRowBefore?: () => void;
  onMerge?: () => void;
  onSplit?: () => void;
}) {
  return (
    <PopoverContent
      asChild
      onOpenAutoFocus={(e) => e.preventDefault()}
      contentEditable={false}
      {...props}
    >
      <Toolbar
        className="scrollbar-hide flex w-auto max-w-[80vw] flex-row overflow-x-auto rounded-md border bg-popover p-1 shadow-md print:hidden"
        contentEditable={false}
      >
        <ToolbarGroup>
          <ColorDropdownMenu tooltip="Cor de fundo">
            <PaintBucketIcon />
          </ColorDropdownMenu>
          {canMerge && onMerge && (
            <ToolbarButton
              onClick={onMerge}
              onMouseDown={(e) => e.preventDefault()}
              tooltip="Mesclar células"
            >
              <CombineIcon />
            </ToolbarButton>
          )}
          {canSplit && onSplit && (
            <ToolbarButton
              onClick={onSplit}
              onMouseDown={(e) => e.preventDefault()}
              tooltip="Dividir célula"
            >
              <SquareSplitHorizontalIcon />
            </ToolbarButton>
          )}

          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <ToolbarButton tooltip="Bordas da célula">
                <Grid2X2Icon />
              </ToolbarButton>
            </DropdownMenuTrigger>

            <DropdownMenuPortal>
              <TableBordersDropdownMenuContent />
            </DropdownMenuPortal>
          </DropdownMenu>

          {singleCellMode && (
            <ToolbarGroup>
              <ToolbarButton tooltip="Excluir tabela" {...buttonProps}>
                <Trash2Icon />
              </ToolbarButton>
            </ToolbarGroup>
          )}
        </ToolbarGroup>

        {singleCellMode && (
          <ToolbarGroup>
            <ToolbarButton
              onClick={onInsertRowBefore}
              onMouseDown={(e) => e.preventDefault()}
              tooltip="Inserir linha acima"
            >
              <ArrowUp />
            </ToolbarButton>
            <ToolbarButton
              onClick={onInsertRowAfter}
              onMouseDown={(e) => e.preventDefault()}
              tooltip="Inserir linha abaixo"
            >
              <ArrowDown />
            </ToolbarButton>
            <ToolbarButton
              onClick={onDeleteRow}
              onMouseDown={(e) => e.preventDefault()}
              tooltip="Excluir linha"
            >
              <XIcon />
            </ToolbarButton>
          </ToolbarGroup>
        )}

        {singleCellMode && (
          <ToolbarGroup>
            <ToolbarButton
              onClick={onInsertColumnBefore}
              onMouseDown={(e) => e.preventDefault()}
              tooltip="Inserir coluna à esquerda"
            >
              <ArrowLeft />
            </ToolbarButton>
            <ToolbarButton
              onClick={onInsertColumnAfter}
              onMouseDown={(e) => e.preventDefault()}
              tooltip="Inserir coluna à direita"
            >
              <ArrowRight />
            </ToolbarButton>
            <ToolbarButton
              onClick={onDeleteColumn}
              onMouseDown={(e) => e.preventDefault()}
              tooltip="Excluir coluna"
            >
              <XIcon />
            </ToolbarButton>
          </ToolbarGroup>
        )}
      </Toolbar>
    </PopoverContent>
  );
}

/**
 * CARELI — ESPESSURA E TIPO DE LINHA DA BORDA.
 *
 * Pedido do Lucas (13/09/2026): *"na parte de construção da minuta, gostaria de editar as bordas,
 * tipo, aumentar a espessura tipo de linha, tem como?"*, e logo depois: *"falo da tabela"*.
 *
 * ⚠️ O DADO SEMPRE EXISTIU, E NINGUÉM ESCREVIA NELE. O Plate guarda `{ color, size, style }` por
 * lado da célula; o menu de bordas só ligava e desligava, a tela desenhava com classe fixa de 1px e
 * o serializador do contrato nem escrevia. As três pontas foram destravadas juntas — ver
 * `variaveisDaBorda` aqui e `bordaDaCelula` em `lib/temis/documento-html.ts`.
 *
 * ⚠️ NÃO USAR O `setBorderSize` DO PLATE. Ele grava `{ size }` puro, jogando fora `style` e
 * `color`: engrossar uma linha tracejada a devolveria sólida. E ele mexe em UMA célula, a do cursor,
 * ignorando a seleção — num quadro-resumo de 17 linhas isso seriam 17 cliques.
 */
const ESPESSURAS_DA_BORDA = [1, 2, 3] as const;

const ESTILOS_DA_BORDA = [
  { rotulo: 'Sólida', valor: 'solid' },
  { rotulo: 'Tracejada', valor: 'dashed' },
  { rotulo: 'Pontilhada', valor: 'dotted' },
  { rotulo: 'Dupla', valor: 'double' },
] as const;

const LADOS_DA_CELULA = ['bottom', 'left', 'right', 'top'] as const;

type LadoDaBordaDaCelula = { color?: string; size?: number; style?: string };

function useAjusteDaBorda() {
  const editor = useEditorRef();

  return React.useCallback(
    (mudanca: { size?: number; style?: string }) => {
      const ehCelula = (n: unknown) =>
        ElementApi.isElement(n) && getCellTypes(editor).includes(n.type);

      // Com duas ou mais células marcadas o Plate devolve as entradas; com o cursor dentro de uma só
      // ele devolve vazio de propósito, e aí o alvo é a célula do cursor.
      const selecionadas = getSelectedCellEntries(editor);
      const alvos = selecionadas.length
        ? selecionadas
        : [editor.api.node({ match: ehCelula })].filter(Boolean);

      if (alvos.length === 0) return;

      editor.tf.withoutNormalizing(() => {
        for (const alvo of alvos) {
          const [no, caminho] = alvo as unknown as [TTableCellElement, number[]];
          const atuais = (no.borders ?? {}) as Record<
            string,
            LadoDaBordaDaCelula | undefined
          >;

          // ⚠️ SÓ OS LADOS QUE JÁ TÊM LINHA. Engrossar não pode LIGAR uma borda que o operador
          // desligou: seria desfazer a escolha dele com um clique que promete outra coisa. Quando a
          // célula não tem borda nenhuma, os quatro entram — é o único jeito de a ação ser visível.
          const temAlgum = LADOS_DA_CELULA.some((lado) => atuais[lado]?.size);
          const novos: Record<string, LadoDaBordaDaCelula> = {
            ...atuais,
          } as Record<string, LadoDaBordaDaCelula>;

          for (const lado of LADOS_DA_CELULA) {
            const antigo = atuais[lado];
            if (temAlgum && !antigo?.size) continue;
            novos[lado] = {
              ...antigo,
              size: mudanca.size ?? antigo?.size ?? 1,
              style: mudanca.style ?? antigo?.style ?? 'solid',
            };
          }

          editor.tf.setNodes({ borders: novos }, { at: caminho, match: ehCelula });
        }
      });

      editor.tf.focus();
    },
    [editor],
  );
}

function TableBordersDropdownMenuContent(
  props: React.ComponentProps<typeof DropdownMenuContent>
) {
  const editor = useEditorRef();
  const {
    getOnSelectTableBorder,
    hasBottomBorder,
    hasLeftBorder,
    hasNoBorders,
    hasOuterBorders,
    hasRightBorder,
    hasTopBorder,
  } = useTableBordersDropdownMenuContentState();
  const ajustarBorda = useAjusteDaBorda();

  return (
    <DropdownMenuContent
      className="min-w-[220px]"
      onCloseAutoFocus={(e) => {
        e.preventDefault();
        editor.tf.focus();
      }}
      align="start"
      side="right"
      sideOffset={0}
      {...props}
    >
      <DropdownMenuGroup>
        <DropdownMenuCheckboxItem
          checked={hasTopBorder}
          onCheckedChange={getOnSelectTableBorder('top')}
        >
          <BorderTopIcon />
          <div>Borda superior</div>
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={hasRightBorder}
          onCheckedChange={getOnSelectTableBorder('right')}
        >
          <BorderRightIcon />
          <div>Borda direita</div>
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={hasBottomBorder}
          onCheckedChange={getOnSelectTableBorder('bottom')}
        >
          <BorderBottomIcon />
          <div>Borda inferior</div>
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={hasLeftBorder}
          onCheckedChange={getOnSelectTableBorder('left')}
        >
          <BorderLeftIcon />
          <div>Borda esquerda</div>
        </DropdownMenuCheckboxItem>
      </DropdownMenuGroup>

      <DropdownMenuGroup>
        <DropdownMenuCheckboxItem
          checked={hasNoBorders}
          onCheckedChange={getOnSelectTableBorder('none')}
        >
          <BorderNoneIcon />
          <div>Sem borda</div>
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={hasOuterBorders}
          onCheckedChange={getOnSelectTableBorder('outer')}
        >
          <BorderAllIcon />
          <div>Bordas externas</div>
        </DropdownMenuCheckboxItem>
      </DropdownMenuGroup>

      {/* CARELI: espessura e tipo de linha. Valem para as células marcadas, ou para a do cursor. */}
      <DropdownMenuGroup>
        <DropdownMenuLabel>Espessura</DropdownMenuLabel>
        {ESPESSURAS_DA_BORDA.map((espessura) => (
          <DropdownMenuItem
            key={espessura}
            onSelect={(e) => {
              e.preventDefault();
              ajustarBorda({ size: espessura });
            }}
          >
            {/* A amostra é a própria linha na espessura do item: número em pixel não diz nada a quem
                está montando um contrato. */}
            <span
              className="mr-1 inline-block w-6 border-ink border-b-(length:--amostra)"
              style={{ '--amostra': `${espessura}px` } as React.CSSProperties}
            />
            <div>{espessura} pt</div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuGroup>

      <DropdownMenuGroup>
        <DropdownMenuLabel>Tipo de linha</DropdownMenuLabel>
        {ESTILOS_DA_BORDA.map((estilo) => (
          <DropdownMenuItem
            key={estilo.valor}
            onSelect={(e) => {
              e.preventDefault();
              ajustarBorda({ style: estilo.valor });
            }}
          >
            <span
              className="mr-1 inline-block w-6 border-ink border-b-2 border-b-(style:--amostra)"
              style={{ '--amostra': estilo.valor } as React.CSSProperties}
            />
            <div>{estilo.rotulo}</div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuGroup>
    </DropdownMenuContent>
  );
}

function ColorDropdownMenu({
  children,
  tooltip,
}: {
  children: React.ReactNode;
  tooltip: string;
}) {
  const [open, setOpen] = React.useState(false);

  const editor = useEditorRef();

  const onUpdateColor = React.useCallback(
    (color: string) => {
      setOpen(false);
      setCellBackground(editor, {
        color,
        selectedCells:
          editor.getApi(TablePlugin).table.getSelectedCells() ?? [],
      });
    },
    [editor]
  );

  const onClearColor = React.useCallback(() => {
    setOpen(false);
    setCellBackground(editor, {
      color: null,
      selectedCells: editor.getApi(TablePlugin).table.getSelectedCells() ?? [],
    });
  }, [editor]);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        <ToolbarButton tooltip={tooltip}>{children}</ToolbarButton>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start">
        <ToolbarMenuGroup label="Cores">
          <ColorDropdownMenuItems
            className="px-2"
            colors={DEFAULT_COLORS}
            updateColor={onUpdateColor}
          />
        </ToolbarMenuGroup>
        <DropdownMenuGroup>
          <DropdownMenuItem className="p-2" onClick={onClearColor}>
            <EraserIcon />
            <span>Limpar</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TableRowElement({
  children,
  ...props
}: PlateElementProps<TTableRowElement>) {
  const { element } = props;
  const readOnly = useReadOnly();
  const editor = useEditorRef();
  const rowIndex = useElementSelector(([, path]) => path.at(-1) as number, [], {
    key: KEYS.tr,
  });
  const rowSize = useElementSelector(
    ([node]) => (node as TTableRowElement).size,
    [],
    {
      key: KEYS.tr,
    }
  );
  const rowSizeOverrides = useTableValue('rowSizeOverrides');
  const rowMinHeight = rowSizeOverrides.get?.(rowIndex) ?? rowSize;
  const isSelectionAreaVisible = usePluginOption(
    BlockSelectionPlugin,
    'isSelectionAreaVisible'
  );
  const hasControls = !readOnly && !isSelectionAreaVisible;

  const { isDragging, nodeRef, previewRef, handleRef } = useDraggable({
    element,
    type: element.type,
    canDropNode: ({ dragEntry, dropEntry }) =>
      // noUncheckedIndexedAccess: dragEntry pode vir undefined no tipo do @platejs/dnd
      !!dragEntry &&
      PathApi.equals(
        PathApi.parent(dragEntry[1]),
        PathApi.parent(dropEntry[1])
      ),
    onDropHandler: (_, { dragItem }) => {
      const dragElement = (dragItem as { element: TElement }).element;

      if (dragElement) {
        editor.tf.select(dragElement);
      }
    },
  });

  return (
    <PlateElement
      {...props}
      ref={useComposedRef(props.ref, previewRef, nodeRef)}
      as="tr"
      className={cn('group/row', isDragging && 'opacity-50')}
      style={
        {
          ...props.style,
          '--tableRowMinHeight': rowMinHeight ? `${rowMinHeight}px` : undefined,
        } as React.CSSProperties
      }
    >
      {hasControls && (
        <td
          className="w-2 min-w-2 max-w-2 select-none p-0"
          contentEditable={false}
        >
          <RowDragHandle dragRef={handleRef} />
          <RowDropLine />
        </td>
      )}

      {children}
    </PlateElement>
  );
}

/**
 * O dado de borda do Plate virando variáveis de CSS.
 *
 * ⚠️ VARIÁVEL, E NÃO ESTILO DIRETO, porque a linha é desenhada no `::before` da célula — e
 * pseudo-elemento não aceita `style` inline. A variável posta na célula é herdada pelo `::before`,
 * que é o único caminho para a espessura chegar lá.
 *
 * ⚠️ A COR PADRÃO É A DO TEMA (`--border`), e não preto: na tela a tabela conviveu com o tema
 * claro e escuro desde sempre, e cravar preto aqui deixaria a linha invisível no escuro. No PAPEL a
 * regra é outra e vive em `documento-html.ts`, onde o padrão é preto — os dois não se misturam.
 */
function variaveisDaBorda(borders: {
  bottom?: { color?: string; size?: number; style?: string };
  left?: { color?: string; size?: number; style?: string };
  right?: { color?: string; size?: number; style?: string };
  top?: { color?: string; size?: number; style?: string };
}): Record<string, string> {
  const vars: Record<string, string> = {};
  const lados = [
    ['b', borders.bottom],
    ['l', borders.left],
    ['r', borders.right],
    ['t', borders.top],
  ] as const;

  for (const [sigla, lado] of lados) {
    if (!lado?.size) continue;
    vars[`--borda-${sigla}-espessura`] = `${lado.size}px`;
    vars[`--borda-${sigla}-estilo`] = lado.style ?? 'solid';
    vars[`--borda-${sigla}-cor`] = lado.color ?? 'var(--border)';
  }

  return vars;
}

function useTableCellPresentation(element: TTableCellElement) {
  const { api } = useEditorPlugin(TablePlugin);
  const borders = useTableCellBorders({ element });
  const { col, row } = useCellIndices();

  const colSpan = api.table.getColSpan(element);
  const rowSpan = api.table.getRowSpan(element);
  const width = React.useMemo(() => {
    const terms = Array.from(
      { length: colSpan },
      (_, offset) => `var(--table-col-${col + offset}, 120px)`
    );

    return terms.length === 1 ? terms[0]! : `calc(${terms.join(' + ')})`;
  }, [col, colSpan]);

  return {
    borders,
    colIndex: col + colSpan - 1,
    colSpan,
    rowIndex: row + rowSpan - 1,
    rowSpan,
    width,
  };
}

function RowDragHandle({ dragRef }: { dragRef: React.Ref<any> }) {
  const editor = useEditorRef();
  const element = useElement();

  return (
    <Button
      ref={dragRef}
      variant="outline"
      className={cn(
        '-translate-y-1/2 absolute top-1/2 left-0 z-51 h-6 w-4 p-0 focus-visible:ring-0 focus-visible:ring-offset-0',
        'cursor-grab active:cursor-grabbing',
        'opacity-0 transition-opacity duration-100 group-hover/row:opacity-100 group-data-[table-resizing=true]/row:opacity-0'
      )}
      onClick={() => {
        editor.tf.select(element);
      }}
    >
      <GripVertical className="text-muted-foreground" />
    </Button>
  );
}

function RowDropLine() {
  const { dropLine } = useDropLine();

  if (!dropLine) return null;

  return (
    <div
      className={cn(
        'absolute inset-x-0 left-2 z-50 h-0.5 bg-brand/50',
        dropLine === 'top' ? '-top-px' : '-bottom-px'
      )}
    />
  );
}

export function TableCellElement({
  isHeader,
  ...props
}: PlateElementProps<TTableCellElement> & {
  isHeader?: boolean;
}) {
  const readOnly = useReadOnly();
  const element = props.element;

  const tableId = useElementSelector(([node]) => node.id as string, [], {
    key: KEYS.table,
  });
  const rowId = useElementSelector(([node]) => node.id as string, [], {
    key: KEYS.tr,
  });
  const isSelectingTable = useBlockSelected(tableId);
  const isSelectingRow = useBlockSelected(rowId) || isSelectingTable;
  const isSelectionAreaVisible = usePluginOption(
    BlockSelectionPlugin,
    'isSelectionAreaVisible'
  );

  const { borders, colIndex, colSpan, rowIndex, rowSpan, width } =
    useTableCellPresentation(element);

  return (
    <PlateElement
      {...props}
      as={isHeader ? 'th' : 'td'}
      className={cn(
        'relative h-full overflow-visible border-none bg-background p-0',
        element.background ? 'bg-(--cellBackground)' : 'bg-background',
        isHeader && 'text-left *:m-0',
        'before:size-full',
        'data-[table-cell-selected=true]:before:z-10',
        'data-[table-cell-selected=true]:before:bg-brand/5',
        "before:absolute before:box-border before:select-none before:content-['']",
        /* ⚠️ A ESPESSURA VINHA SENDO JOGADA FORA. Antes estas quatro linhas testavam
           `borders.bottom?.size` só para decidir SE desenhava, e aplicavam a classe fixa
           `border-b` — 1px, cor do tema. Uma borda de 3px desenhava idêntica a uma de 1px, e o
           estilo (tracejada, dupla) não existia na tela. O dado sempre esteve lá: o Plate guarda
           `{ color, size, style }` por lado. Agora as propriedades saem das variáveis do `style`. */
        borders.bottom?.size &&
          'before:[border-bottom-color:var(--borda-b-cor)] before:[border-bottom-style:var(--borda-b-estilo)] before:[border-bottom-width:var(--borda-b-espessura)]',
        borders.right?.size &&
          'before:[border-right-color:var(--borda-r-cor)] before:[border-right-style:var(--borda-r-estilo)] before:[border-right-width:var(--borda-r-espessura)]',
        borders.left?.size &&
          'before:[border-left-color:var(--borda-l-cor)] before:[border-left-style:var(--borda-l-estilo)] before:[border-left-width:var(--borda-l-espessura)]',
        borders.top?.size &&
          'before:[border-top-color:var(--borda-t-cor)] before:[border-top-style:var(--borda-t-estilo)] before:[border-top-width:var(--borda-t-espessura)]'
      )}
      style={
        {
          '--cellBackground': element.background,
          ...variaveisDaBorda(borders),
          maxWidth: width,
          minWidth: width,
        } as React.CSSProperties
      }
      attributes={{
        ...props.attributes,
        colSpan,
        'data-table-cell-id': element.id,
        rowSpan,
      }}
    >
      <div
        className="relative z-20 box-border h-full px-3 py-2"
        style={
          rowSpan === 1
            ? { minHeight: 'var(--tableRowMinHeight, 0px)' }
            : undefined
        }
      >
        {props.children}
      </div>

      {!readOnly && !isSelectionAreaVisible && (
        <TableCellResizeControls colIndex={colIndex} rowIndex={rowIndex} />
      )}

      {isSelectingRow && (
        <div className={blockSelectionVariants()} contentEditable={false} />
      )}
    </PlateElement>
  );
}

export function TableCellHeaderElement(
  props: React.ComponentProps<typeof TableCellElement>
) {
  return <TableCellElement {...props} isHeader />;
}

const TableCellResizeControls = React.memo(function TableCellResizeControls({
  colIndex,
  rowIndex,
}: {
  colIndex: number;
  rowIndex: number;
}) {
  const {
    clearResizePreview,
    disableMarginLeft,
    setResizePreview,
    startResize,
  } = useTableResizeContext();
  const rightHandleKey = `right:${rowIndex}:${colIndex}`;
  const bottomHandleKey = `bottom:${rowIndex}:${colIndex}`;
  const leftHandleKey = `left:${rowIndex}:${colIndex}`;
  const isLeftHandle = colIndex === 0 && !disableMarginLeft;

  return (
    <div
      className="group/resize pointer-events-none absolute inset-0 z-30 select-none"
      contentEditable={false}
      suppressContentEditableWarning={true}
    >
      <div
        className="-top-2 -right-1 pointer-events-auto absolute z-40 h-[calc(100%_+_8px)] w-2 cursor-col-resize touch-none"
        onPointerEnter={(event) => {
          setResizePreview(event, {
            colIndex,
            direction: 'right',
            handleKey: rightHandleKey,
            rowIndex,
          });
        }}
        onPointerLeave={() => {
          clearResizePreview(rightHandleKey);
        }}
        onPointerDown={(event) => {
          startResize(event, {
            colIndex,
            direction: 'right',
            handleKey: rightHandleKey,
            rowIndex,
          });
        }}
      />
      <div
        className="-bottom-1 pointer-events-auto absolute left-0 z-40 h-2 w-full cursor-row-resize touch-none"
        onPointerEnter={(event) => {
          setResizePreview(event, {
            colIndex,
            direction: 'bottom',
            handleKey: bottomHandleKey,
            rowIndex,
          });
        }}
        onPointerLeave={() => {
          clearResizePreview(bottomHandleKey);
        }}
        onPointerDown={(event) => {
          startResize(event, {
            colIndex,
            direction: 'bottom',
            handleKey: bottomHandleKey,
            rowIndex,
          });
        }}
      />
      {isLeftHandle && (
        <div
          className="-left-1 pointer-events-auto absolute top-0 z-40 h-full w-2 cursor-col-resize touch-none"
          onPointerEnter={(event) => {
            setResizePreview(event, {
              colIndex,
              direction: 'left',
              handleKey: leftHandleKey,
              rowIndex,
            });
          }}
          onPointerLeave={() => {
            clearResizePreview(leftHandleKey);
          }}
          onPointerDown={(event) => {
            startResize(event, {
              colIndex,
              direction: 'left',
              handleKey: leftHandleKey,
              rowIndex,
            });
          }}
        />
      )}
    </div>
  );
});

TableCellResizeControls.displayName = 'TableCellResizeControls';
