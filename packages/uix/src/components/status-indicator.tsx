import { forwardRef, type HTMLAttributes } from "react";
import { cx } from "../utils/class-name";

export type StatusIndicatorVariant =
  | "online"
  | "offline"
  | "warning"
  | "danger"
  | "neutral"
  | "processing";

export type StatusIndicatorProps = HTMLAttributes<HTMLSpanElement> & {
  label?: string;
  variant?: StatusIndicatorVariant;
};

export const StatusIndicator = forwardRef<
  HTMLSpanElement,
  StatusIndicatorProps
>(({ className, label, variant = "neutral", ...props }, ref) => {
  return (
    <span
      className={cx("uix-status-indicator", className)}
      data-variant={variant}
      ref={ref}
      role={label ? "status" : undefined}
      {...props}
    >
      <span aria-hidden="true" className="uix-status-indicator__dot" />
      {label ? <span className="uix-status-indicator__label">{label}</span> : null}
    </span>
  );
});

StatusIndicator.displayName = "StatusIndicator";
