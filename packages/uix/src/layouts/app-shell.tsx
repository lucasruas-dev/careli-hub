import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "../utils/class-name";

export type AppShellProps = HTMLAttributes<HTMLDivElement> & {
  layoutMode?: "dashboard" | "fullscreen" | "module";
  sidebarVisibility?: "hidden" | "visible";
  sidebar?: ReactNode;
  topbar?: ReactNode;
};

export const AppShell = forwardRef<HTMLDivElement, AppShellProps>(
  (
    {
      children,
      className,
      layoutMode = "dashboard",
      sidebar,
      sidebarVisibility = "visible",
      topbar,
      ...props
    },
    ref,
  ) => {
    return (
      <div
        className={cx("uix-app-shell", className)}
        data-layout-mode={layoutMode}
        data-sidebar-visibility={sidebarVisibility}
        ref={ref}
        {...props}
      >
        {sidebar}
        <div className="uix-app-shell__main">
          {topbar}
          {children}
        </div>
      </div>
    );
  },
);

AppShell.displayName = "AppShell";
