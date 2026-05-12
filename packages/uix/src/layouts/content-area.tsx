import { forwardRef, type HTMLAttributes } from "react";
import { cx } from "../utils/class-name";

export type ContentAreaProps = HTMLAttributes<HTMLElement> & {
  padded?: boolean;
};

export const ContentArea = forwardRef<HTMLElement, ContentAreaProps>(
  ({ className, padded = true, ...props }, ref) => {
    return (
      <main
        className={cx("uix-content-area", className)}
        data-padded={padded || undefined}
        ref={ref}
        {...props}
      />
    );
  },
);

ContentArea.displayName = "ContentArea";
