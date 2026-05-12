import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "../utils/class-name";

export type SidebarProps = HTMLAttributes<HTMLElement> & {
  collapsed?: boolean;
  footer?: ReactNode;
  header?: ReactNode;
};

export const Sidebar = forwardRef<HTMLElement, SidebarProps>(
  ({ children, className, collapsed = false, footer, header, ...props }, ref) => {
    return (
      <aside
        aria-label={props["aria-label"] ?? "Primary navigation"}
        className={cx("uix-sidebar", className)}
        data-collapsed={collapsed || undefined}
        ref={ref}
        {...props}
      >
        {header ? <div className="uix-sidebar__header">{header}</div> : null}
        <nav className="uix-sidebar__nav">{children}</nav>
        {footer ? <div className="uix-sidebar__footer">{footer}</div> : null}
      </aside>
    );
  },
);

Sidebar.displayName = "Sidebar";
