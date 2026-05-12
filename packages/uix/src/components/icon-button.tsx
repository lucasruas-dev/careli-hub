import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { cx } from "../utils/class-name";

export type IconButtonVariant = "ghost" | "subtle" | "primary" | "danger";
export type IconButtonSize = "sm" | "md" | "lg";

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  "aria-label": string;
  icon: ReactNode;
  isLoading?: boolean;
  size?: IconButtonSize;
  variant?: IconButtonVariant;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      className,
      disabled,
      icon,
      isLoading = false,
      size = "md",
      type = "button",
      variant = "ghost",
      ...props
    },
    ref,
  ) => {
    return (
      <button
        aria-busy={isLoading || undefined}
        className={cx("uix-icon-button", className)}
        data-size={size}
        data-variant={variant}
        disabled={disabled || isLoading}
        ref={ref}
        type={type}
        {...props}
      >
        {isLoading ? (
          <span aria-hidden="true" className="uix-button__spinner" />
        ) : (
          <span aria-hidden="true" className="uix-icon-button__icon">
            {icon}
          </span>
        )}
      </button>
    );
  },
);

IconButton.displayName = "IconButton";
