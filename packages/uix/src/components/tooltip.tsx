"use client";

import {
  type CSSProperties,
  type ReactNode,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

export type TooltipPlacement = "top" | "right" | "bottom" | "left";

export type TooltipProps = {
  children: ReactNode;
  className?: string;
  content: ReactNode;
  contentClassName?: string;
  placement?: TooltipPlacement;
  triggerClassName?: string;
};

const TOOLTIP_GAP = 8;

// Tooltip renderizado via portal no <body>: nao e cortado por ancestrais com
// overflow:hidden (composer, header, listas com scroll). Posicao calculada a
// partir do retangulo do gatilho; visual reaproveita .uix-tooltip__content.
export function Tooltip({
  children,
  className,
  content,
  contentClassName,
  placement = "top",
  triggerClassName,
}: TooltipProps) {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [style, setStyle] = useState<CSSProperties | null>(null);

  const show = () => {
    const element = triggerRef.current;
    if (!element) {
      return;
    }
    setStyle(computeStyle(placement, element.getBoundingClientRect()));
  };
  const hide = () => setStyle(null);

  return (
    <span
      className={cx("uix-tooltip", className)}
      data-placement={placement}
      onBlur={hide}
      onFocus={show}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      <span
        aria-describedby={style ? tooltipId : undefined}
        className={cx("uix-tooltip__trigger", triggerClassName)}
        ref={triggerRef}
      >
        {children}
      </span>
      {style && typeof document !== "undefined"
        ? createPortal(
            <span
              className={cx("uix-tooltip__content", contentClassName)}
              id={tooltipId}
              role="tooltip"
              style={style}
            >
              {content}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}

function computeStyle(placement: TooltipPlacement, rect: DOMRect): CSSProperties {
  const base: CSSProperties = {
    opacity: 1,
    pointerEvents: "none",
    position: "fixed",
    transform: "none",
  };

  switch (placement) {
    case "bottom":
      return {
        ...base,
        left: rect.left + rect.width / 2,
        top: rect.bottom + TOOLTIP_GAP,
        transform: "translateX(-50%)",
      };
    case "right":
      return {
        ...base,
        left: rect.right + TOOLTIP_GAP,
        top: rect.top + rect.height / 2,
        transform: "translateY(-50%)",
      };
    case "left":
      return {
        ...base,
        left: rect.left - TOOLTIP_GAP,
        top: rect.top + rect.height / 2,
        transform: "translate(-100%, -50%)",
      };
    default:
      return {
        ...base,
        left: rect.left + rect.width / 2,
        top: rect.top - TOOLTIP_GAP,
        transform: "translate(-50%, -100%)",
      };
  }
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}
