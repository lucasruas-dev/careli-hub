import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "../utils/class-name";

export type WorkspaceLayoutProps = HTMLAttributes<HTMLDivElement> & {
  aside?: ReactNode;
  footer?: ReactNode;
  header?: ReactNode;
};

export const WorkspaceLayout = forwardRef<HTMLDivElement, WorkspaceLayoutProps>(
  ({ aside, children, className, footer, header, ...props }, ref) => {
    return (
      <section className={cx("uix-workspace-layout", className)} ref={ref} {...props}>
        {header}
        <div className="uix-workspace-layout__body">
          <div className="uix-workspace-layout__content">{children}</div>
          {aside ? <aside className="uix-workspace-layout__aside">{aside}</aside> : null}
        </div>
        {footer ? <footer className="uix-workspace-layout__footer">{footer}</footer> : null}
      </section>
    );
  },
);

WorkspaceLayout.displayName = "WorkspaceLayout";
