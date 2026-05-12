import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "../utils/class-name";

export type SidebarGroupProps = HTMLAttributes<HTMLDivElement> & {
  title?: ReactNode;
};

export const SidebarGroup = forwardRef<HTMLDivElement, SidebarGroupProps>(
  ({ children, className, title, ...props }, ref) => {
    return (
      <div className={cx("uix-sidebar-group", className)} ref={ref} {...props}>
        {title ? <div className="uix-sidebar-group__title">{title}</div> : null}
        <div className="uix-sidebar-group__items">{children}</div>
      </div>
    );
  },
);

SidebarGroup.displayName = "SidebarGroup";
