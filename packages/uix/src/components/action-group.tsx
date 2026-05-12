import { forwardRef, type HTMLAttributes } from "react";
import { cx } from "../utils/class-name";

export type ActionGroupAlign = "start" | "center" | "end" | "between";

export type ActionGroupProps = HTMLAttributes<HTMLDivElement> & {
  align?: ActionGroupAlign;
};

export const ActionGroup = forwardRef<HTMLDivElement, ActionGroupProps>(
  ({ align = "start", className, ...props }, ref) => {
    return (
      <div
        className={cx("uix-action-group", className)}
        data-align={align}
        ref={ref}
        {...props}
      />
    );
  },
);

ActionGroup.displayName = "ActionGroup";
