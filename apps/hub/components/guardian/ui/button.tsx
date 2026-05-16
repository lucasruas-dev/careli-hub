/* eslint-disable */
// @ts-nocheck
import * as React from "react";

type ButtonVariant = "default" | "destructive" | "ghost" | "link" | "outline" | "secondary";
type ButtonSize =
  | "default"
  | "icon"
  | "icon-lg"
  | "icon-sm"
  | "icon-xs"
  | "lg"
  | "sm"
  | "xs";

type ButtonVariantOptions = {
  className?: string;
  size?: ButtonSize;
  variant?: ButtonVariant;
};

type ButtonProps = React.ComponentProps<"button"> &
  ButtonVariantOptions & {
    asChild?: boolean;
  };

const baseClass =
  "inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent text-sm font-medium whitespace-nowrap transition-all outline-none select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

const variantClasses: Record<ButtonVariant, string> = {
  default: "bg-slate-950 text-white hover:bg-slate-800",
  destructive: "bg-rose-50 text-rose-700 hover:bg-rose-100",
  ghost: "text-slate-700 hover:bg-slate-100",
  link: "text-[#A07C3B] underline-offset-4 hover:underline",
  outline: "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
  secondary: "bg-slate-100 text-slate-900 hover:bg-slate-200",
};

const sizeClasses: Record<ButtonSize, string> = {
  default: "h-8 gap-1.5 px-2.5",
  icon: "size-8",
  "icon-lg": "size-9",
  "icon-sm": "size-7",
  "icon-xs": "size-6",
  lg: "h-9 gap-1.5 px-2.5",
  sm: "h-7 gap-1 px-2.5 text-[0.8rem]",
  xs: "h-6 gap-1 px-2 text-xs",
};

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function buttonVariants({
  className,
  size = "default",
  variant = "default",
}: ButtonVariantOptions = {}) {
  return cn(baseClass, variantClasses[variant], sizeClasses[size], className);
}

function Button({
  asChild: _asChild,
  className,
  size = "default",
  variant = "default",
  ...props
}: ButtonProps) {
  return (
    <button
      data-size={size}
      data-slot="button"
      data-variant={variant}
      className={buttonVariants({ className, size, variant })}
      {...props}
    />
  );
}

export { Button, buttonVariants };



