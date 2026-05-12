import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "../utils/class-name";

export type ToolbarProps = HTMLAttributes<HTMLDivElement> & {
  actions?: ReactNode;
  description?: ReactNode;
  title?: ReactNode;
};

export const Toolbar = forwardRef<HTMLDivElement, ToolbarProps>(
  ({ actions, children, className, description, title, ...props }, ref) => {
    return (
      <div className={cx("uix-toolbar", className)} ref={ref} {...props}>
        {title || description ? (
          <div className="uix-toolbar__main">
            {title ? <h2 className="uix-toolbar__title">{title}</h2> : null}
            {description ? (
              <p className="uix-toolbar__description">{description}</p>
            ) : null}
          </div>
        ) : null}
        {children ? <div className="uix-toolbar__content">{children}</div> : null}
        {actions ? <div className="uix-toolbar__actions">{actions}</div> : null}
      </div>
    );
  },
);

Toolbar.displayName = "Toolbar";
