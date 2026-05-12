import { type ReactNode } from "react";
import { cx } from "../utils/class-name";
import { EmptyState } from "./empty-state";

export type DataTableColumn<Row extends object> = {
  align?: "left" | "center" | "right";
  cell?: (row: Row) => ReactNode;
  header: ReactNode;
  id: string;
  width?: string;
};

export type DataTableProps<Row extends object> = {
  "aria-label"?: string;
  className?: string;
  columns: readonly DataTableColumn<Row>[];
  emptyState?: ReactNode;
  getRowId?: (row: Row, index: number) => string;
  isLoading?: boolean;
  loadingLabel?: ReactNode;
  rows: readonly Row[];
};

export function DataTable<Row extends object>({
  "aria-label": ariaLabel = "Data table",
  className,
  columns,
  emptyState,
  getRowId,
  isLoading = false,
  loadingLabel = "Loading data",
  rows,
}: DataTableProps<Row>) {
  const hasRows = rows.length > 0;

  return (
    <div
      aria-busy={isLoading || undefined}
      className={cx("uix-data-table", className)}
    >
      <table aria-label={ariaLabel} className="uix-data-table__table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                data-align={column.align}
                key={column.id}
                scope="col"
                style={{ width: column.width }}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {hasRows
            ? rows.map((row, rowIndex) => (
                <tr key={getRowId ? getRowId(row, rowIndex) : rowIndex}>
                  {columns.map((column) => (
                    <td data-align={column.align} key={column.id}>
                      {column.cell ? column.cell(row) : null}
                    </td>
                  ))}
                </tr>
              ))
            : null}
        </tbody>
      </table>
      {isLoading ? (
        <div className="uix-data-table__state" role="status">
          <span aria-hidden="true" className="uix-button__spinner" />
          <span>{loadingLabel}</span>
        </div>
      ) : null}
      {!isLoading && !hasRows ? (
        <div className="uix-data-table__state">
          {emptyState ?? (
            <EmptyState
              description="No records are available for this workspace yet."
              title="No data"
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
