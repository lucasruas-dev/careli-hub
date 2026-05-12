import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "../utils/class-name";

export type EmptyStateProps = HTMLAttributes<HTMLDivElement> & {
  action?: ReactNode;
  description?: ReactNode;
  title: ReactNode;
  visual?: ReactNode;
};

export const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ action, className, description, title, visual, ...props }, ref) => {
    return (
      <div className={cx("uix-empty-state", className)} ref={ref} {...props}>
        {visual ? <div className="uix-empty-state__visual">{visual}</div> : null}
        <div className="uix-empty-state__body">
          <h2 className="uix-empty-state__title">{title}</h2>
          {description ? (
            <p className="uix-empty-state__description">{description}</p>
          ) : null}
        </div>
        {action ? <div className="uix-empty-state__action">{action}</div> : null}
      </div>
    );
  },
);

EmptyState.displayName = "EmptyState";
