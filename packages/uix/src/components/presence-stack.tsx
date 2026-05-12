import { type HTMLAttributes } from "react";
import { cx } from "../utils/class-name";
import {
  PresenceAvatar,
  type PresenceAvatarProps,
} from "./presence-avatar";

export type PresenceStackUser = Pick<
  PresenceAvatarProps,
  "initials" | "label" | "status"
> & {
  id: string;
};

export type PresenceStackProps = HTMLAttributes<HTMLDivElement> & {
  limit?: number;
  users: readonly PresenceStackUser[];
};

export function PresenceStack({
  className,
  limit = 4,
  users,
  ...props
}: PresenceStackProps) {
  const visibleUsers = users.slice(0, limit);
  const hiddenCount = Math.max(users.length - visibleUsers.length, 0);

  return (
    <div
      aria-label={`${users.length} active users`}
      className={cx("uix-presence-stack", className)}
      role="group"
      {...props}
    >
      {visibleUsers.map((user) => (
        <PresenceAvatar
          initials={user.initials}
          key={user.id}
          label={user.label}
          status={user.status}
        />
      ))}
      {hiddenCount > 0 ? (
        <span className="uix-presence-stack__more">+{hiddenCount}</span>
      ) : null}
    </div>
  );
}
