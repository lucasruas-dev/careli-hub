"use client";

import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { EmptyState } from "./empty-state";

export type CommandPaletteCommand = {
  disabled?: boolean;
  group?: string;
  id: string;
  keywords?: readonly string[];
  label: ReactNode;
  onSelect?: () => void;
  shortcut?: ReactNode;
};

export type CommandPaletteProps = {
  commands: readonly CommandPaletteCommand[];
  emptyState?: ReactNode;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  placeholder?: string;
  title?: ReactNode;
};

export function CommandPalette({
  commands,
  emptyState,
  onOpenChange,
  open,
  placeholder = "Search commands",
  title = "Command palette",
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) {
      setQuery("");
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        onOpenChange(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onOpenChange, open]);

  const filteredCommands = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return commands;
    }

    return commands.filter((command) => {
      const label =
        typeof command.label === "string" ? command.label.toLowerCase() : "";
      const keywords = command.keywords?.join(" ").toLowerCase() ?? "";

      return `${label} ${keywords}`.includes(normalizedQuery);
    });
  }, [commands, query]);

  const groups = useMemo(() => {
    return filteredCommands.reduce<Record<string, CommandPaletteCommand[]>>(
      (accumulator, command) => {
        const group = command.group ?? "Commands";
        accumulator[group] = [...(accumulator[group] ?? []), command];

        return accumulator;
      },
      {},
    );
  }, [filteredCommands]);

  if (!open) {
    return null;
  }

  const handleCommandKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    command: CommandPaletteCommand,
  ) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      command.onSelect?.();
      onOpenChange(false);
    }
  };

  return (
    <div
      aria-modal="true"
      className="uix-command-palette"
      role="dialog"
      aria-label={typeof title === "string" ? title : "Command palette"}
    >
      <button
        aria-label="Close command palette"
        className="uix-command-palette__backdrop"
        onClick={() => onOpenChange(false)}
        type="button"
      />
      <div className="uix-command-palette__panel">
        <div className="uix-command-palette__header">
          <h2 className="uix-command-palette__title">{title}</h2>
          <input
            autoFocus
            className="uix-command-palette__input"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={placeholder}
            type="search"
            value={query}
          />
        </div>
        <div className="uix-command-palette__body">
          {filteredCommands.length > 0 ? (
            Object.entries(groups).map(([group, groupCommands]) => (
              <section className="uix-command-palette__group" key={group}>
                <h3 className="uix-command-palette__group-title">{group}</h3>
                <div className="uix-command-palette__items">
                  {groupCommands.map((command) => (
                    <button
                      className="uix-command-palette__item"
                      disabled={command.disabled}
                      key={command.id}
                      onClick={() => {
                        command.onSelect?.();
                        onOpenChange(false);
                      }}
                      onKeyDown={(event) =>
                        handleCommandKeyDown(event, command)
                      }
                      type="button"
                    >
                      <span className="uix-command-palette__item-label">
                        {command.label}
                      </span>
                      {command.shortcut ? (
                        <kbd className="uix-command-palette__shortcut">
                          {command.shortcut}
                        </kbd>
                      ) : null}
                    </button>
                  ))}
                </div>
              </section>
            ))
          ) : (
            <div className="uix-command-palette__empty">
              {emptyState ?? (
                <EmptyState
                  description="Try another search term."
                  title="No commands found"
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
