import {
  forwardRef,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { cx } from "../utils/class-name";

export type SplitPanelOrientation = "horizontal" | "vertical";

export type SplitPanelProps = HTMLAttributes<HTMLDivElement> & {
  primary: ReactNode;
  primarySize?: string;
  secondary: ReactNode;
  secondarySize?: string;
  orientation?: SplitPanelOrientation;
};

export const SplitPanel = forwardRef<HTMLDivElement, SplitPanelProps>(
  (
    {
      className,
      orientation = "horizontal",
      primary,
      primarySize = "minmax(0, 1fr)",
      secondary,
      secondarySize = "minmax(20rem, 24rem)",
      style,
      ...props
    },
    ref,
  ) => {
    const panelStyle = {
      "--uix-split-primary-size": primarySize,
      "--uix-split-secondary-size": secondarySize,
      ...style,
    } as CSSProperties;

    return (
      <div
        className={cx("uix-split-panel", className)}
        data-orientation={orientation}
        ref={ref}
        style={panelStyle}
        {...props}
      >
        <section className="uix-split-panel__primary">{primary}</section>
        <section className="uix-split-panel__secondary">{secondary}</section>
      </div>
    );
  },
);

SplitPanel.displayName = "SplitPanel";
