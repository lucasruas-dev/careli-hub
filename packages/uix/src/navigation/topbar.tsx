import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "../utils/class-name";

export type TopbarProps = HTMLAttributes<HTMLElement> & {
  actions?: ReactNode;
  command?: ReactNode;
  context?: ReactNode;
  realtime?: ReactNode;
  user?: ReactNode;
};

export const Topbar = forwardRef<HTMLElement, TopbarProps>(
  ({ actions, className, command, context, realtime, user, ...props }, ref) => {
    return (
      <header className={cx("uix-topbar", className)} ref={ref} {...props}>
        <div className="uix-topbar__context">{context}</div>
        {command ? <div className="uix-topbar__command">{command}</div> : null}
        <div className="uix-topbar__meta">
          {realtime ? <div className="uix-topbar__realtime">{realtime}</div> : null}
          {actions ? <div className="uix-topbar__actions">{actions}</div> : null}
          {user ? <div className="uix-topbar__user">{user}</div> : null}
        </div>
      </header>
    );
  },
);

Topbar.displayName = "Topbar";
