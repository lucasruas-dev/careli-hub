import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "../utils/class-name";

export type WorkspaceHeaderProps = HTMLAttributes<HTMLElement> & {
  actions?: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  meta?: ReactNode;
  title: ReactNode;
};

export const WorkspaceHeader = forwardRef<HTMLElement, WorkspaceHeaderProps>(
  ({ actions, className, description, eyebrow, meta, title, ...props }, ref) => {
    return (
      <header className={cx("uix-workspace-header", className)} ref={ref} {...props}>
        <div className="uix-workspace-header__main">
          {eyebrow ? <p className="uix-workspace-header__eyebrow">{eyebrow}</p> : null}
          <h1 className="uix-workspace-header__title">{title}</h1>
          {description ? (
            <p className="uix-workspace-header__description">{description}</p>
          ) : null}
        </div>
        {meta || actions ? (
          <div className="uix-workspace-header__aside">
            {meta ? <div className="uix-workspace-header__meta">{meta}</div> : null}
            {actions ? (
              <div className="uix-workspace-header__actions">{actions}</div>
            ) : null}
          </div>
        ) : null}
      </header>
    );
  },
);

WorkspaceHeader.displayName = "WorkspaceHeader";
