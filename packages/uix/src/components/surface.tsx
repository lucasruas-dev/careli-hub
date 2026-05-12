import { forwardRef, type HTMLAttributes } from "react";
import { cx } from "../utils/class-name";

export type SurfaceProps = HTMLAttributes<HTMLDivElement> & {
  bordered?: boolean;
  elevated?: boolean;
  muted?: boolean;
};

export const Surface = forwardRef<HTMLDivElement, SurfaceProps>(
  (
    { bordered = true, className, elevated = false, muted = false, ...props },
    ref,
  ) => {
    return (
      <div
        className={cx("uix-surface", className)}
        data-bordered={bordered || undefined}
        data-elevated={elevated || undefined}
        data-muted={muted || undefined}
        ref={ref}
        {...props}
      />
    );
  },
);

Surface.displayName = "Surface";
