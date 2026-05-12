import type { density } from "./density";

export type ThemeMode = "light" | "dark";
export type DensityMode = keyof typeof density;

export type SemanticTheme = {
  mode: ThemeMode;
  density: DensityMode;
  colorScheme: {
    background: string;
    surface: string;
    surfaceRaised: string;
    surfaceSubtle: string;
    surfaceInverse: string;
    foreground: string;
    foregroundSecondary: string;
    muted: string;
    border: string;
    borderStrong: string;
    brand: string;
    brandForeground: string;
    focus: string;
    success: string;
    warning: string;
    danger: string;
  };
};
