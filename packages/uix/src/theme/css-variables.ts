import type { CssVariableMap } from "../utils/css-variables";
import type { Density } from "./density";
import { density } from "./density";
import { darkTheme, lightTheme } from "./themes";
import type { SemanticTheme } from "./types";

export function getThemeCssVariables(theme: SemanticTheme): CssVariableMap {
  return {
    "--uix-color-brand-primary": theme.colorScheme.brand,
    "--uix-color-brand-foreground": theme.colorScheme.brandForeground,
    "--uix-color-focus": theme.colorScheme.focus,
    "--uix-color-success": theme.colorScheme.success,
    "--uix-color-warning": theme.colorScheme.warning,
    "--uix-color-danger": theme.colorScheme.danger,
    "--uix-surface-canvas": theme.colorScheme.background,
    "--uix-surface-base": theme.colorScheme.surface,
    "--uix-surface-raised": theme.colorScheme.surfaceRaised,
    "--uix-surface-subtle": theme.colorScheme.surfaceSubtle,
    "--uix-surface-inverse": theme.colorScheme.surfaceInverse,
    "--uix-text-primary": theme.colorScheme.foreground,
    "--uix-text-secondary": theme.colorScheme.foregroundSecondary,
    "--uix-text-muted": theme.colorScheme.muted,
    "--uix-border-subtle": theme.colorScheme.border,
    "--uix-border-strong": theme.colorScheme.borderStrong,
  };
}

export function getDensityCssVariables(
  densityConfig: Density[keyof Density],
): CssVariableMap {
  return {
    "--uix-density-control-height": densityConfig.controlHeight,
    "--uix-density-gap": densityConfig.gap,
    "--uix-density-padding-x": densityConfig.paddingX,
    "--uix-density-padding-y": densityConfig.paddingY,
  };
}

export const themeCssVariables = {
  light: getThemeCssVariables(lightTheme),
  dark: getThemeCssVariables(darkTheme),
} as const;

export const densityCssVariables = {
  comfortable: getDensityCssVariables(density.comfortable),
  compact: getDensityCssVariables(density.compact),
} as const;
