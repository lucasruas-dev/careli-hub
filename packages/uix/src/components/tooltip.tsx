import { type ReactNode, useId } from "react";

export type TooltipPlacement = "top" | "right" | "bottom" | "left";

export type TooltipProps = {
  children: ReactNode;
  content: ReactNode;
  placement?: TooltipPlacement;
};

export function Tooltip({
  children,
  content,
  placement = "top",
}: TooltipProps) {
  const tooltipId = useId();

  return (
    <span className="uix-tooltip" data-placement={placement}>
      <span aria-describedby={tooltipId} className="uix-tooltip__trigger">
        {children}
      </span>
      <span className="uix-tooltip__content" id={tooltipId} role="tooltip">
        {content}
      </span>
    </span>
  );
}
