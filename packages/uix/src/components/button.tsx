import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { cx } from "../utils/class-name";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  endIcon?: ReactNode;
  isLoading?: boolean;
  size?: ButtonSize;
  startIcon?: ReactNode;
  variant?: ButtonVariant;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      className,
      disabled,
      endIcon,
      isLoading = false,
      size = "md",
      startIcon,
      type = "button",
      variant = "secondary",
      ...props
    },
    ref,
  ) => {
    return (
      <button
        aria-busy={isLoading || undefined}
        className={cx("uix-button", className)}
        data-size={size}
        data-variant={variant}
        disabled={disabled || isLoading}
        ref={ref}
        type={type}
        {...props}
      >
        {isLoading ? (
          <span aria-hidden="true" className="uix-button__spinner" />
        ) : null}
        {!isLoading && startIcon ? (
          <span aria-hidden="true" className="uix-button__icon">
            {startIcon}
          </span>
        ) : null}
        <span className="uix-button__label">{children}</span>
        {!isLoading && endIcon ? (
          <span aria-hidden="true" className="uix-button__icon">
            {endIcon}
          </span>
        ) : null}
      </button>
    );
  },
);

Button.displayName = "Button";
