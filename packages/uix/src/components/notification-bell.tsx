import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cx } from "../utils/class-name";

export type NotificationBellProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> & {
  count?: number;
  unread?: boolean;
};

export const NotificationBell = forwardRef<
  HTMLButtonElement,
  NotificationBellProps
>(
  (
    {
      "aria-label": ariaLabel = "Open notifications",
      className,
      count,
      type = "button",
      unread = false,
      ...props
    },
    ref,
  ) => {
    const hasCount = typeof count === "number" && count > 0;

    return (
      <button
        aria-label={ariaLabel}
        className={cx("uix-notification-bell", className)}
        data-unread={unread || hasCount || undefined}
        ref={ref}
        type={type}
        {...props}
      >
        <span aria-hidden="true" className="uix-notification-bell__icon">
          N
        </span>
        {hasCount ? (
          <span className="uix-notification-bell__count">
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </button>
    );
  },
);

NotificationBell.displayName = "NotificationBell";
