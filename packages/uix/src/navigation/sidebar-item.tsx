import {
  forwardRef,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type Ref,
  type ReactNode,
} from "react";
import { cx } from "../utils/class-name";

export type SidebarItemProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> & {
  active?: boolean;
  badge?: ReactNode;
  collapsed?: boolean;
  href?: string;
  icon?: ReactNode;
  label: ReactNode;
};

export const SidebarItem = forwardRef<
  HTMLAnchorElement | HTMLButtonElement,
  SidebarItemProps
>(
  (
    {
      active = false,
      badge,
      className,
      collapsed = false,
      href,
      icon,
      label,
      type = "button",
      ...props
    },
    ref,
  ) => {
    const content = (
      <>
        {icon ? (
          <span aria-hidden="true" className="uix-sidebar-item__icon">
            {icon}
          </span>
        ) : null}
        <span className="uix-sidebar-item__label">{label}</span>
        {badge ? <span className="uix-sidebar-item__badge">{badge}</span> : null}
      </>
    );

    if (href) {
      const anchorProps = props as AnchorHTMLAttributes<HTMLAnchorElement>;

      return (
        <a
          aria-current={active ? "page" : undefined}
          className={cx("uix-sidebar-item", className)}
          data-active={active || undefined}
          data-collapsed={collapsed || undefined}
          href={href}
          ref={ref as Ref<HTMLAnchorElement>}
          {...anchorProps}
        >
          {content}
        </a>
      );
    }

    return (
      <button
        aria-current={active ? "page" : undefined}
        className={cx("uix-sidebar-item", className)}
        data-active={active || undefined}
        data-collapsed={collapsed || undefined}
        ref={ref as Ref<HTMLButtonElement>}
        type={type}
        {...props}
      >
        {content}
      </button>
    );
  },
);

SidebarItem.displayName = "SidebarItem";
