import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { cx } from "../utils/class-name";

export type CommandTriggerProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: ReactNode;
  label?: ReactNode;
  shortcut?: ReactNode;
};

export const CommandTrigger = forwardRef<
  HTMLButtonElement,
  CommandTriggerProps
>(
  (
    {
      className,
      icon,
      label = "Command palette",
      shortcut = "Ctrl K",
      type = "button",
      ...props
    },
    ref,
  ) => {
    return (
      <button
        className={cx("uix-command-trigger", className)}
        ref={ref}
        type={type}
        {...props}
      >
        {icon ? (
          <span aria-hidden="true" className="uix-command-trigger__icon">
            {icon}
          </span>
        ) : null}
        <span className="uix-command-trigger__label">{label}</span>
        {shortcut ? (
          <kbd className="uix-command-trigger__shortcut">{shortcut}</kbd>
        ) : null}
      </button>
    );
  },
);

CommandTrigger.displayName = "CommandTrigger";
