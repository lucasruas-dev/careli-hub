import { colors } from "../tokens/colors";
import type { SemanticTheme } from "./types";

export const lightTheme = {
  mode: "light",
  density: "comfortable",
  colorScheme: {
    background: colors.neutral[50],
    surface: colors.neutral[0],
    surfaceRaised: colors.neutral[0],
    surfaceSubtle: colors.neutral[100],
    surfaceInverse: colors.neutral[900],
    foreground: colors.neutral[900],
    foregroundSecondary: colors.neutral[600],
    muted: colors.neutral[500],
    border: colors.neutral[200],
    borderStrong: colors.neutral[300],
    brand: colors.brand.primary,
    brandForeground: colors.neutral[0],
    focus: colors.intent.info,
    success: colors.intent.success,
    warning: colors.intent.warning,
    danger: colors.intent.danger,
  },
} as const satisfies SemanticTheme;

export const darkTheme = {
  mode: "dark",
  density: "comfortable",
  colorScheme: {
    background: colors.neutral[950],
    surface: colors.neutral[900],
    surfaceRaised: colors.neutral[800],
    surfaceSubtle: colors.neutral[800],
    surfaceInverse: colors.neutral[0],
    foreground: colors.neutral[50],
    foregroundSecondary: colors.neutral[200],
    muted: colors.neutral[300],
    border: colors.neutral[700],
    borderStrong: colors.neutral[600],
    brand: colors.brand.primary,
    brandForeground: colors.neutral[950],
    focus: colors.intent.info,
    success: colors.intent.success,
    warning: colors.intent.warning,
    danger: colors.intent.danger,
  },
} as const satisfies SemanticTheme;

export const themes = {
  light: lightTheme,
  dark: darkTheme,
} as const;

export const defaultTheme = lightTheme;

export type Themes = typeof themes;
