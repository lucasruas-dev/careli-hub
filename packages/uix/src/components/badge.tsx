import { forwardRef, type HTMLAttributes } from "react";
import { cx } from "../utils/class-name";

export type BadgeVariant = "neutral" | "success" | "warning" | "danger" | "info";

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
};

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = "neutral", ...props }, ref) => {
    return (
      <span
        className={cx("uix-badge", className)}
        data-variant={variant}
        ref={ref}
        {...props}
      />
    );
  },
);

Badge.displayName = "Badge";
