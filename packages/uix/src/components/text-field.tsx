import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  useId,
} from "react";
import { cx } from "../utils/class-name";

export type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  endIcon?: ReactNode;
  error?: ReactNode;
  hint?: ReactNode;
  label?: ReactNode;
  startIcon?: ReactNode;
};

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  (
    {
      className,
      disabled,
      endIcon,
      error,
      hint,
      id,
      label,
      startIcon,
      ...props
    },
    ref,
  ) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const hintId = hint ? `${inputId}-hint` : undefined;
    const errorId = error ? `${inputId}-error` : undefined;
    const describedBy = [hintId, errorId].filter(Boolean).join(" ");

    return (
      <div className="uix-text-field" data-disabled={disabled || undefined}>
        {label ? (
          <label className="uix-text-field__label" htmlFor={inputId}>
            {label}
          </label>
        ) : null}
        <div
          className={cx("uix-text-field__control", className)}
          data-invalid={error ? true : undefined}
        >
          {startIcon ? (
            <span aria-hidden="true" className="uix-text-field__icon">
              {startIcon}
            </span>
          ) : null}
          <input
            aria-describedby={describedBy || undefined}
            aria-invalid={error ? true : undefined}
            className="uix-text-field__input"
            disabled={disabled}
            id={inputId}
            ref={ref}
            {...props}
          />
          {endIcon ? (
            <span aria-hidden="true" className="uix-text-field__icon">
              {endIcon}
            </span>
          ) : null}
        </div>
        {hint ? (
          <p className="uix-text-field__hint" id={hintId}>
            {hint}
          </p>
        ) : null}
        {error ? (
          <p className="uix-text-field__error" id={errorId}>
            {error}
          </p>
        ) : null}
      </div>
    );
  },
);

TextField.displayName = "TextField";
