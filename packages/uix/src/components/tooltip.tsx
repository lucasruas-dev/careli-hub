import { type ReactNode, useId } from "react";

export type TooltipPlacement = "top" | "right" | "bottom" | "left";

export type TooltipProps = {
  children: ReactNode;
  className?: string;
  content: ReactNode;
  contentClassName?: string;
  placement?: TooltipPlacement;
  triggerClassName?: string;
};

export function Tooltip({
  children,
  className,
  content,
  contentClassName,
  placement = "top",
  triggerClassName,
}: TooltipProps) {
  const tooltipId = useId();

  return (
    <span className={cx("uix-tooltip", className)} data-placement={placement}>
      <span aria-describedby={tooltipId} className={cx("uix-tooltip__trigger", triggerClassName)}>
        {children}
      </span>
      <span className={cx("uix-tooltip__content", contentClassName)} id={tooltipId} role="tooltip">
        {content}
      </span>
    </span>
  );
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}
