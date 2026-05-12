import { forwardRef, type HTMLAttributes } from "react";
import { cx } from "../utils/class-name";

export type RealtimePulseState =
  | "idle"
  | "live"
  | "syncing"
  | "delayed"
  | "offline";

export type RealtimePulseProps = HTMLAttributes<HTMLSpanElement> & {
  label?: string;
  state?: RealtimePulseState;
};

export const RealtimePulse = forwardRef<HTMLSpanElement, RealtimePulseProps>(
  ({ className, label, state = "idle", ...props }, ref) => {
    return (
      <span
        className={cx("uix-realtime-pulse", className)}
        data-state={state}
        ref={ref}
        role={label ? "status" : undefined}
        {...props}
      >
        <span aria-hidden="true" className="uix-realtime-pulse__dot" />
        {label ? <span className="uix-realtime-pulse__label">{label}</span> : null}
      </span>
    );
  },
);

RealtimePulse.displayName = "RealtimePulse";
