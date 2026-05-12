import { forwardRef, type HTMLAttributes } from "react";
import { cx } from "../utils/class-name";

export type PresenceAvatarStatus = "online" | "away" | "busy" | "offline";

export type PresenceAvatarProps = HTMLAttributes<HTMLSpanElement> & {
  initials: string;
  label?: string;
  status?: PresenceAvatarStatus;
};

export const PresenceAvatar = forwardRef<HTMLSpanElement, PresenceAvatarProps>(
  ({ className, initials, label, status = "offline", ...props }, ref) => {
    return (
      <span
        aria-label={label ? `${label}, ${status}` : undefined}
        className={cx("uix-presence-avatar", className)}
        data-status={status}
        ref={ref}
        role={label ? "img" : undefined}
        title={label}
        {...props}
      >
        <span className="uix-presence-avatar__initials">{initials}</span>
        <span aria-hidden="true" className="uix-presence-avatar__status" />
      </span>
    );
  },
);

PresenceAvatar.displayName = "PresenceAvatar";
